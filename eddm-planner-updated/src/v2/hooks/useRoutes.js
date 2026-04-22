import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch EDDM carrier routes for one or more ZIP codes via MPA's existing
 * Netlify function proxy (ported from EDDMMapper.js).
 *
 * Phase 4 upgrade:
 *   - `error` is now a structured object: { type, message, retry } (or null)
 *   - `error.type` ∈ 'invalid-zip' | 'no-routes' | 'timeout' | 'network'
 *   - AbortController cancels in-flight requests on new fetches
 *   - 15-second client-side timeout wraps every fetch
 *
 * The endpoint returns ArcGIS-style FeatureCollections; we normalize them
 * into a shape that matches the V4R2 design spec:
 *
 *   {
 *     id:          'ZZZZZ-<CRID>',
 *     name:        '<CRID>',
 *     zip:         '33801',
 *     hh:          number,
 *     allHH:       number,
 *     businesses:  number,
 *     income:      number | null,
 *     coordinates: Array<Array<{lat, lng}>>,
 *     centerLat:   number,
 *     centerLng:   number,
 *   }
 *
 * Usage:
 *   const { routes, loading, error, fetchZip, clearRoutes } = useRoutes();
 *   fetchZip('33801');
 *   // error shape: { type: 'no-routes', message: '...', retry: () => ... }
 */
const EDDM_API_ENDPOINT = '/.netlify/functions/eddm-routes';
const FETCH_TIMEOUT_MS = 15000;

function getNumericAttribute(attrs, keys) {
  for (const key of keys) {
    const v = attrs?.[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function transformFeature(feature, zip, index) {
  const attrs = feature.attributes || {};
  const paths = feature.geometry?.paths || [];

  // USPS returns [lng, lat], Google Maps expects {lat, lng}
  const allCoordinates = paths.map((path) =>
    path.map((coord) => ({ lat: coord[1], lng: coord[0] }))
  );
  const flat = allCoordinates.flat();
  const centerLat =
    flat.length > 0 ? flat.reduce((s, c) => s + c.lat, 0) / flat.length : 0;
  const centerLng =
    flat.length > 0 ? flat.reduce((s, c) => s + c.lng, 0) / flat.length : 0;

  const res = attrs.RES_CNT || 0;
  const bus = attrs.BUS_CNT || 0;

  return {
    id: `${zip}-${attrs.CRID_ID || index}`,
    name: attrs.CRID_ID || `Route ${index + 1}`,
    zip,
    hh: res,
    allHH: res + bus,
    businesses: bus,
    income: getNumericAttribute(attrs, [
      'AVGHHINC_CY',
      'AVGHHINC_FY',
      'AVGHHINC',
      'AVG_HH_INC',
      'MEDHHINC_CY',
    ]),
    coordinates: allCoordinates,
    centerLat,
    centerLng,
  };
}

export default function useRoutes(initialZips = null) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchedZipsRef = useRef(new Set());
  const abortRef = useRef(null);

  const clearRoutes = useCallback(() => {
    setRoutes([]);
    setError(null);
    fetchedZipsRef.current = new Set();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const removeZip = useCallback((zip) => {
    setRoutes((prev) => prev.filter((r) => r.zip !== zip));
    fetchedZipsRef.current.delete(zip);
  }, []);

  const fetchZip = useCallback(async (zip) => {
    if (!zip || !/^\d{5}$/.test(zip)) {
      const retry = () => fetchZip(zip);
      setError({
        type: 'invalid-zip',
        message: 'Enter a 5-digit ZIP (e.g. 33801).',
        zip,
        retry,
      });
      return { ok: false, reason: 'invalid-zip' };
    }

    // Cancel any in-flight request before starting a new one.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const timeoutId = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);

    setLoading(true);
    setError(null);

    const retry = () => fetchZip(zip);

    try {
      const resp = await fetch(`${EDDM_API_ENDPOINT}?zip=${zip}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw Object.assign(new Error('USPS route service did not respond.'), {
          __classify: 'network',
        });
      }

      const data = await resp.json();
      const features = data?.results?.[0]?.value?.features;

      if (!Array.isArray(features) || features.length === 0) {
        throw Object.assign(new Error(`No carrier routes found for ${zip}.`), {
          __classify: 'no-routes',
        });
      }

      const transformed = features.map((f, i) => transformFeature(f, zip, i));
      setRoutes((prev) => {
        const filtered = prev.filter((r) => r.zip !== zip);
        return [...filtered, ...transformed];
      });
      fetchedZipsRef.current.add(zip);
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
      return { ok: true, routes: transformed };
    } catch (err) {
      clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);

      // Silently ignore aborts that weren't caused by our timeout — they
      // just mean a newer fetch superseded this one.
      const isTimeout =
        err?.name === 'AbortError' && controller.signal.reason === 'timeout';
      if (err?.name === 'AbortError' && !isTimeout) {
        return { ok: false, reason: 'aborted' };
      }

      let type;
      if (isTimeout) type = 'timeout';
      else if (err.__classify === 'no-routes') type = 'no-routes';
      else if (err.__classify === 'network') type = 'network';
      else type = 'network';

      setError({
        type,
        message:
          type === 'timeout'
            ? "USPS route service didn't respond. Retrying automatically..."
            : type === 'no-routes'
            ? `No carrier routes found for ${zip}.`
            : err.message || 'Failed to load routes.',
        zip,
        retry,
      });
      return { ok: false, reason: type, error: err };
    }
  }, []);

  // Optional auto-fetch on mount / when initialZips changes shallowly.
  useEffect(() => {
    if (!Array.isArray(initialZips) || initialZips.length === 0) return;
    initialZips.forEach((zip) => {
      if (!fetchedZipsRef.current.has(zip)) fetchZip(zip);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(initialZips) ? initialZips.join(',') : '']);

  // Cleanup: abort any in-flight fetch on unmount.
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { routes, loading, error, fetchZip, removeZip, clearRoutes };
}
