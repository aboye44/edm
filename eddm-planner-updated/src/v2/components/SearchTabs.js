import React, { useCallback, useRef, useState } from 'react';
import { Autocomplete } from '@react-google-maps/api';

/**
 * SearchTabs — intent-first search overlay for Step 1.
 *
 * Replaces the ambiguous single-input ZipSearchBar. Two tabs:
 *   1. "By ZIP"              — plain 5-digit ZIP entry, submits via onZipChange
 *   2. "By address + radius" — Google Places Autocomplete + radius dropdown,
 *                               submits via onRadiusSearch({center, radius, label})
 *
 * The parent (Step1Plan) is responsible for:
 *   - Multi-ZIP chips (shown only when mode === 'zip')
 *   - Wiring onRadiusSearch into MapPane (setting mode='radius' + circleCenter)
 *
 * Props:
 *   mode              — 'zip' | 'radius' (controlled)
 *   onModeChange      — (mode) => void
 *   onZipChange       — (zip: string) => void, for ZIP tab
 *   onRadiusSearch    — ({ center: {lat, lng}, radius: number, label: string,
 *                           zip: string | null }) => void
 *   geocoding         — boolean, shows inline loading state on ZIP tab
 *   showInvalid       — boolean, shows inline invalid-zip hint on ZIP tab
 */
const RADIUS_OPTIONS = [1, 2, 3, 5, 7, 10];

export default function SearchTabs({
  mode = 'zip',
  onModeChange,
  onZipChange,
  onRadiusSearch,
  // Phase 5.1 fix: radius is now CONTROLLED by parent (Step1Plan) so
  // changing the dropdown immediately propagates to MapPane's
  // autoSelectRadius effect. Previously local state here meant dropdown
  // changes only applied on the next SEARCH submit, which felt laggy.
  radius = 3,
  onRadiusChange,
  // Phase 5.3: Start over lives INSIDE the search card so it's always
  // in the user's field of view while they interact with search.
  // Shown only when there's something to clear.
  onStartOver,
  hasActivePlan = false,
  geocoding = false,
  showInvalid = false,
}) {
  // ── ZIP tab state ──
  const [zipVal, setZipVal] = useState('');
  const [zipTouched, setZipTouched] = useState(false);

  // ── Radius tab state ──
  const [addressVal, setAddressVal] = useState('');
  const autocompleteRef = useRef(null);

  const zipTrimmed = zipVal.trim();
  const zipOk = /^\d{5}$/.test(zipTrimmed);
  const zipShowError =
    showInvalid || (zipTouched && (zipTrimmed.length > 0) && !zipOk);

  const submitZip = (e) => {
    if (e) e.preventDefault();
    setZipTouched(true);
    if (zipOk) {
      if (onZipChange) onZipChange(zipTrimmed);
      setZipVal('');
      setZipTouched(false);
    }
  };

  const handleAutocompleteLoad = useCallback((ac) => {
    autocompleteRef.current = ac;
  }, []);

  const dispatchRadius = useCallback(
    (center, label, zip) => {
      if (!onRadiusSearch) return;
      onRadiusSearch({ center, radius, label, zip });
    },
    [onRadiusSearch, radius]
  );

  const handlePlaceChanged = useCallback(() => {
    const ac = autocompleteRef.current;
    if (!ac) return;
    const place = ac.getPlace();
    if (!place) return;

    let lat = null;
    let lng = null;
    if (place.geometry?.location) {
      try {
        lat = place.geometry.location.lat();
        lng = place.geometry.location.lng();
      } catch (_) {
        lat = place.geometry.location.lat;
        lng = place.geometry.location.lng;
      }
    }

    const components = place.address_components || [];
    const zipComponent = components.find((c) =>
      (c.types || []).includes('postal_code')
    );
    const zip =
      zipComponent && /^\d{5}$/.test(zipComponent.long_name || '')
        ? zipComponent.long_name
        : null;

    const label = place.formatted_address || addressVal;

    if (lat != null && lng != null) {
      setAddressVal(label);
      // Auto-submit on selection — user picked an autocomplete result,
      // no need to click SEARCH again.
      dispatchRadius({ lat, lng }, label, zip);
    }
  }, [addressVal, dispatchRadius]);

  const submitRadius = (e) => {
    if (e) e.preventDefault();
    // If the user typed freely without picking from autocomplete, geocode
    // via the Places service result cached on the autocomplete widget (if
    // any). Otherwise we rely on handlePlaceChanged having already fired.
    const ac = autocompleteRef.current;
    if (!ac) return;
    const place = ac.getPlace();
    if (place && place.geometry?.location) {
      // Re-fire the autocomplete path.
      handlePlaceChanged();
      return;
    }
    // No resolved place — no-op. Autocomplete will fire on selection.
  };

  const setMode = (next) => {
    if (onModeChange) onModeChange(next);
  };

  return (
    <div className="v2-search-tabs" aria-label="Search by ZIP or address">
      {/* Tab row */}
      <div className="v2-search-tabs-row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'zip'}
          className={
            mode === 'zip'
              ? 'v2-search-tab v2-search-tab--active'
              : 'v2-search-tab'
          }
          onClick={() => setMode('zip')}
        >
          By ZIP
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'radius'}
          className={
            mode === 'radius'
              ? 'v2-search-tab v2-search-tab--active'
              : 'v2-search-tab'
          }
          onClick={() => setMode('radius')}
        >
          By address + radius
        </button>
        {hasActivePlan && onStartOver && (
          <button
            type="button"
            className="v2-search-startover"
            onClick={onStartOver}
            title="Clear everything and start fresh"
          >
            ↻ Start over
          </button>
        )}
      </div>


      {/* Tab content */}
      {mode === 'zip' && (
        <form
          onSubmit={submitZip}
          className="v2-search-tab-panel"
          aria-label="ZIP search"
        >
          <div
            className="v2-search-input-box"
            data-error={zipShowError ? 'true' : 'false'}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--mpa-v2-slate)', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{5}"
              maxLength={5}
              value={zipVal}
              placeholder="Enter ZIP (e.g. 33801)"
              onChange={(e) => setZipVal(e.target.value)}
              aria-label="5-digit ZIP code"
              aria-invalid={zipShowError}
            />
            <button type="submit" className="v2-search-submit-btn">
              {geocoding ? 'Searching...' : 'Search'}
            </button>
          </div>
          {zipShowError && (
            <div className="v2-search-error">
              Enter a 5-digit ZIP (e.g. 33801).
            </div>
          )}
        </form>
      )}

      {mode === 'radius' && (
        <form
          onSubmit={submitRadius}
          className="v2-search-tab-panel"
          aria-label="Address and radius search"
        >
          <div className="v2-search-input-box">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--mpa-v2-slate)', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <Autocomplete
              onLoad={handleAutocompleteLoad}
              onPlaceChanged={handlePlaceChanged}
              options={{
                types: ['geocode'],
                componentRestrictions: { country: 'us' },
                fields: [
                  'address_components',
                  'geometry',
                  'formatted_address',
                ],
              }}
            >
              <input
                type="text"
                value={addressVal}
                placeholder="430 N Washington Ave, Lakeland FL"
                onChange={(e) => setAddressVal(e.target.value)}
                aria-label="Address"
              />
            </Autocomplete>
            <select
              className="v2-search-radius-select"
              value={radius}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (onRadiusChange) onRadiusChange(next);
              }}
              aria-label="Radius in miles"
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} mi
                </option>
              ))}
            </select>
            <button type="submit" className="v2-search-submit-btn">
              Search
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
