import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CENSUS_API_KEY,
  CENSUS_ACS_BASE,
  CENSUS_VARS,
} from '../../config/census';

/**
 * Module-level cache: ZIP → median HH income (number | null).
 * Census ACS data updates annually, so caching for the session is safe.
 * Cache persists across component remounts.
 */
const censusIncomeCache = new Map();

/**
 * Calculate a point at a given distance (miles) + bearing (degrees) from an
 * origin. Used to sample points around the radius edge so we can discover
 * which ZIPs the circle overlaps. Ported from EDDMMapper.js.
 */
function calculateDestinationPoint(lat, lng, distanceMiles, bearingDegrees) {
  const R = 3959; // Earth radius in miles
  const d = distanceMiles / R;
  const brng = (bearingDegrees * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    (Math.sin(lat1) * Math.cos(d)) +
      (Math.cos(lat1) * Math.sin(d) * Math.cos(brng))
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - (Math.sin(lat1) * Math.sin(lat2))
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/**
 * Given a center + radius, discover the unique ZIPs the circle touches.
 * Samples at 4 cardinal points (N/E/S/W) on the radius edge + reverse-geocodes
 * each via the already-loaded Google Maps Geocoder. Falls back gracefully if
 * Geocoder isn't available yet.
 */
async function discoverZipsAroundPoint({ center, radius, centerZip }) {
  const zips = new Set();
  if (centerZip && /^\d{5}$/.test(centerZip)) zips.add(centerZip);

  const G = typeof window !== 'undefined' ? window.google : null;
  if (!G?.maps?.Geocoder) return Array.from(zips);

  const geocoder = new G.maps.Geocoder();
  const bearings = [0, 90, 180, 270];
  const points = bearings.map((b) =>
    calculateDestinationPoint(center.lat, center.lng, radius, b)
  );

  await Promise.all(
    points.map(
      (p) =>
        new Promise((resolve) => {
          try {
            geocoder.geocode({ location: p }, (results, status) => {
              if (status === 'OK' && results && results[0]) {
                const comps = results[0].address_components || [];
                const comp = comps.find((c) =>
                  (c.types || []).includes('postal_code')
                );
                if (comp && /^\d{5}$/.test(comp.long_name || '')) {
                  zips.add(comp.long_name);
                }
              }
              resolve();
            });
          } catch (_) {
            resolve();
          }
        })
    )
  );

  return Array.from(zips);
}

async function fetchCensusIncome(zip) {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  if (censusIncomeCache.has(zip)) return censusIncomeCache.get(zip);
  try {
    const vars = `NAME,${CENSUS_VARS.MEDIAN_INCOME}`;
    const url = `${CENSUS_ACS_BASE}?get=${vars}&for=zip%20code%20tabulation%20area:${zip}&key=${CENSUS_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      censusIncomeCache.set(zip, null);
      return null;
    }
    const data = await resp.json();
    // Row 0 is headers, row 1 is the data row: [name, income, zipFromApi]
    const row = Array.isArray(data) && data.length > 1 ? data[1] : null;
    if (!row) {
      censusIncomeCache.set(zip, null);
      return null;
    }
    const raw = parseInt(row[1], 10);
    // Census returns negative sentinels for "data suppressed" — treat as null.
    const value = Number.isFinite(raw) && raw > 0 ? raw : null;
    censusIncomeCache.set(zip, value);
    return value;
  } catch (_) {
    censusIncomeCache.set(zip, null);
    return null;
  }
}

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

  // USPS exposes city/state under a few different attribute keys depending
  // on the endpoint version. Pull whichever is populated so Step1Plan's
  // sidebar can show a real "Lakeland, FL · 33801" label instead of just
  // the bare ZIP. Fall back to null — the consumer renders the ZIP alone
  // when city/state aren't available.
  // USPS returns city names in ALL CAPS ("LAKELAND"). Title-case for
  // display. State stays uppercase (2-letter abbreviation).
  const rawCity = firstStringAttr(attrs, [
    'CITY',
    'PRIMARY_CITY',
    'CITY_NAME',
    'PO_NAME',
  ]);
  const city = rawCity ? titleCaseCity(rawCity) : null;
  const rawState = firstStringAttr(attrs, [
    'STATE',
    'STATE_ABBR',
    'STATE_CODE',
    'ST',
  ]);
  const state = rawState ? rawState.toUpperCase() : null;

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
    city,
    state,
    coordinates: allCoordinates,
    centerLat,
    centerLng,
  };
}

// Return the first non-empty trimmed string value for any of the given keys.
// Returns null if none are populated.
function firstStringAttr(attrs, keys) {
  for (const key of keys) {
    const v = attrs?.[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

// Convert USPS's all-caps city ("LAKELAND", "ST PETERSBURG", "O'FALLON") to
// Title Case for display. \b\w matches after apostrophes in JS regex, so
// "O'FALLON" → "O'Fallon" correctly. Keeps hyphens intact: "WINSTON-SALEM"
// → "Winston-Salem".
function titleCaseCity(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function useRoutes(initialZips = null) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);
  // Separate flag for multi-ZIP radius fetches so the per-ZIP loading
  // toggling inside fetchZip doesn't cause the blocking overlay to
  // flicker between ZIPs.
  const [radiusLoading, setRadiusLoading] = useState(false);
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

      // USPS doesn't return income — enrich with ZIP-level median HH
      // income from the US Census ACS API. Every route in the same ZIP
      // gets the same number (ZIP-level precision is the norm for
      // EDDM targeting anyway). Failures are non-fatal: we just leave
      // income = null and the UI displays "—".
      const censusIncome = await fetchCensusIncome(zip);
      if (censusIncome) {
        transformed.forEach((r) => {
          if (!r.income) r.income = censusIncome;
        });
      }

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

  /**
   * Sequential multi-ZIP fetch. Used on rehydrate (restore from
   * localStorage) so we don't abort previous fetches mid-flight —
   * fetchZip shares a single abortRef, so a parallel `forEach(fetchZip)`
   * cancels every request except the last one.
   *
   * Awaits each fetch in order; only ZIPs not already loaded are fetched.
   */
  const fetchZips = useCallback(
    async (zips) => {
      if (!Array.isArray(zips) || zips.length === 0) return { ok: true, fetched: [] };
      const fetched = [];
      for (const zip of zips) {
        if (fetchedZipsRef.current.has(zip)) continue;
        // Sequential await: next fetchZip call won't abort the prior
        // one because the prior one has already completed.
        // eslint-disable-next-line no-await-in-loop
        const r = await fetchZip(zip);
        fetched.push({ zip, ok: r?.ok !== false });
      }
      return { ok: true, fetched };
    },
    [fetchZip]
  );

  /**
   * Phase 5.2 — Radius-based route discovery.
   *
   * When user picks an address + radius, we need to load routes for EVERY
   * ZIP the circle touches, not just the center ZIP. Otherwise expanding
   * the radius just redraws the circle without pulling new routes in.
   *
   * Samples N/E/S/W at the radius edge via Google Geocoder, collects
   * unique ZIPs, then fetches any not-yet-loaded ZIP. Fetches are
   * sequential (not parallel) because fetchZip shares an abortRef —
   * parallel calls would cancel each other. 4-8 ZIPs × ~1s/fetch =
   * 4-8s worst case; acceptable for this interaction.
   */
  const fetchRadius = useCallback(
    async ({ center, radius, centerZip }) => {
      if (!center || !radius) return { ok: false, reason: 'no-args' };
      setRadiusLoading(true);
      try {
        const zips = await discoverZipsAroundPoint({
          center,
          radius,
          centerZip,
        });
        const newZips = zips.filter((z) => !fetchedZipsRef.current.has(z));
        if (newZips.length === 0) return { ok: true, zips, fetched: [] };
        const fetched = [];
        for (const zip of newZips) {
          // Sequential: await each so they don't abort each other.
          const r = await fetchZip(zip);
          fetched.push({ zip, ok: r?.ok !== false });
        }
        return { ok: true, zips, fetched };
      } finally {
        setRadiusLoading(false);
      }
    },
    [fetchZip]
  );

  // Optional auto-fetch on mount / when initialZips changes shallowly.
  // Uses sequential fetch so multi-ZIP restores don't abort each other.
  useEffect(() => {
    if (!Array.isArray(initialZips) || initialZips.length === 0) return;
    const toFetch = initialZips.filter(
      (zip) => !fetchedZipsRef.current.has(zip)
    );
    if (toFetch.length === 0) return;
    fetchZips(toFetch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(initialZips) ? initialZips.join(',') : '']);

  // Cleanup: abort any in-flight fetch on unmount.
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    routes,
    // Unified: blocking overlay should show whenever we're fetching
    // anything (single ZIP or multi-ZIP radius). Keeps the UI from
    // flickering between per-ZIP loading toggles during a radius fetch.
    loading: loading || radiusLoading,
    radiusLoading,
    error,
    fetchZip,
    fetchZips,
    fetchRadius,
    removeZip,
    clearRoutes,
  };
}
