import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch EDDM carrier routes for one or more ZIP codes via MPA's existing
 * Netlify function proxy (ported from EDDMMapper.js).
 *
 * The endpoint returns ArcGIS-style FeatureCollections; we normalize them
 * into a shape that matches the V4R2 design spec:
 *
 *   {
 *     id:          'ZZZZZ-<CRID>',
 *     name:        '<CRID>',                        // "C 001", route code
 *     zip:         '33801',
 *     hh:          number,                          // residential HH
 *     allHH:       number,                          // residential + business
 *     businesses:  number,
 *     income:      number | null,                   // avg/median HH income
 *     coordinates: Array<Array<{lat, lng}>>,        // array of paths
 *     centerLat:   number,
 *     centerLng:   number,
 *   }
 *
 * Usage:
 *   const { routes, loading, error, fetchZip, clearRoutes } = useRoutes();
 *   fetchZip('33801');              // append routes for one ZIP
 *   // or:
 *   const { routes } = useRoutes(['33801', '33803']);  // auto-fetch on mount
 */
const EDDM_API_ENDPOINT = '/.netlify/functions/eddm-routes';

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

  const clearRoutes = useCallback(() => {
    setRoutes([]);
    setError(null);
    fetchedZipsRef.current = new Set();
  }, []);

  const removeZip = useCallback((zip) => {
    setRoutes((prev) => prev.filter((r) => r.zip !== zip));
    fetchedZipsRef.current.delete(zip);
  }, []);

  const fetchZip = useCallback(async (zip) => {
    if (!zip || !/^\d{5}$/.test(zip)) {
      setError('Enter a 5-digit ZIP (e.g. 33801).');
      return { ok: false, reason: 'invalid-zip' };
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${EDDM_API_ENDPOINT}?zip=${zip}`);
      if (!resp.ok) throw new Error('USPS route service did not respond.');
      const data = await resp.json();
      const features = data?.results?.[0]?.value?.features;
      if (!Array.isArray(features) || features.length === 0) {
        throw new Error(`No carrier routes found for ${zip}.`);
      }
      const transformed = features.map((f, i) => transformFeature(f, zip, i));
      setRoutes((prev) => {
        const filtered = prev.filter((r) => r.zip !== zip);
        return [...filtered, ...transformed];
      });
      fetchedZipsRef.current.add(zip);
      setLoading(false);
      return { ok: true, routes: transformed };
    } catch (err) {
      setError(err.message || 'Failed to load routes.');
      setLoading(false);
      return { ok: false, reason: 'fetch-error', error: err };
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

  return { routes, loading, error, fetchZip, removeZip, clearRoutes };
}
