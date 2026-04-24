import React, { useCallback, useEffect, useRef, useState } from 'react';
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
 * Mobile-collapsed mode: when `hasActivePlan` is true and the viewport is
 * phone-sized, the full tab UI hides behind a compact "Change area" summary
 * chip. This stops the search card from covering the map after search.
 *
 * Props:
 *   mode              — 'zip' | 'radius' (controlled)
 *   onModeChange      — (mode) => void
 *   onZipChange       — (zip: string) => void, for ZIP tab
 *   onRadiusSearch    — ({ center: {lat, lng}, radius: number, label: string,
 *                           zip: string | null }) => void
 *   geocoding         — boolean, shows inline loading state on ZIP tab
 *   showInvalid       — boolean, shows inline invalid-zip hint on ZIP tab
 *   hasActivePlan     — boolean, when true on mobile collapses to a summary chip
 *   summaryLabel      — string, e.g. "3 ZIPs · 4,200 HH" (for the mobile chip)
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
  // Shown only when there's something to clear. Two-click arm/confirm
  // pattern — `startOverArmed` flips the button label to "Click again
  // to confirm" (red) after the first click. Parent manages the
  // 3-second auto-disarm timer.
  onStartOver,
  hasActivePlan = false,
  startOverArmed = false,
  geocoding = false,
  showInvalid = false,
  // P1-6: parent passes a ref to the ZIP input so it can focus it
  // directly from "+ Add another ZIP" without document.querySelector.
  zipInputRef,
  // Mobile collapse — summary label to show on the collapsed chip.
  summaryLabel = '',
  // Mobile-fix: when "Add another ZIP" is tapped on mobile while
  // SearchTabs is collapsed, parent increments this counter so we can
  // expand AND focus in one gesture. Parent-side .focus() alone doesn't
  // work on mobile because the input isn't in the DOM when collapsed.
  zipFocusSignal = 0,
}) {
  // ── ZIP tab state ──
  const [zipVal, setZipVal] = useState('');
  const [zipTouched, setZipTouched] = useState(false);

  // ── Radius tab state ──
  const [addressVal, setAddressVal] = useState('');
  const autocompleteRef = useRef(null);
  // P1-2: track whether the user has submitted the radius form at least
  // once so we can show an inline hint when they typed an address but
  // didn't pick from the dropdown (previously: silent no-op on Search).
  const [addressTouched, setAddressTouched] = useState(false);

  // Mobile collapse state — auto-collapse when a plan becomes active,
  // expand on user tap. The inner state lets us track user intent
  // (explicit tap to reopen) separate from hasActivePlan's truthiness.
  const [mobileOpen, setMobileOpen] = useState(!hasActivePlan);
  useEffect(() => {
    // When a plan becomes active (first routes arrive), auto-collapse.
    // When it goes away (start over), auto-expand.
    setMobileOpen(!hasActivePlan);
  }, [hasActivePlan]);

  // Mobile-fix: handle "Add another ZIP" tap from the sidebar. Parent
  // increments zipFocusSignal; we expand the collapsed tabs, switch to
  // the ZIP tab, then focus on the next tick so the input is in the DOM.
  useEffect(() => {
    if (zipFocusSignal === 0) return;
    setMobileOpen(true);
    if (onModeChange) onModeChange('zip');
    // Next tick — after expand re-renders and the input mounts.
    const id = window.setTimeout(() => {
      if (zipInputRef && zipInputRef.current) {
        try { zipInputRef.current.focus(); } catch (_) {}
      }
    }, 50);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zipFocusSignal]);

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
      // P1-2: clear the touched flag once we have a valid place — hint
      // should only appear when the user submitted without a selection.
      setAddressTouched(false);
      // Auto-submit on selection — user picked an autocomplete result,
      // no need to click SEARCH again.
      dispatchRadius({ lat, lng }, label, zip);
    }
  }, [addressVal, dispatchRadius]);

  const submitRadius = (e) => {
    if (e) e.preventDefault();
    // P1-2: mark touched so the inline hint can render if we can't
    // resolve a place. Previously this silently no-op'd when the user
    // typed an address but never picked from the dropdown.
    setAddressTouched(true);
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
    // No resolved place — hint will render via the derived addressShowHint
    // flag below. Autocomplete will fire on selection and hide the hint.
  };

  // P1-2: when the user picks from the autocomplete dropdown the hint
  // should disappear. handlePlaceChanged also updates addressVal.
  const addressShowHint = (() => {
    if (!addressTouched) return false;
    if (!addressVal.trim()) return false;
    const ac = autocompleteRef.current;
    const place = ac ? ac.getPlace() : null;
    return !(place && place.geometry?.location);
  })();

  const setMode = (next) => {
    if (onModeChange) onModeChange(next);
  };

  // Mobile collapsed summary chip — tapping expands the full tabs UI.
  const collapsed = hasActivePlan && !mobileOpen;

  return (
    <div
      className={`v2-search-tabs ${collapsed ? 'v2-search-tabs--collapsed' : ''}`}
      aria-label="Search by ZIP or address"
    >
      {/* Mobile collapsed summary — single tap target that expands tabs */}
      {hasActivePlan && (
        <button
          type="button"
          className="v2-search-summary-chip"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? 'Close search' : 'Change area'}
        >
          <span className="v2-search-summary-icon" aria-hidden="true">
            {mobileOpen ? '\u2715' : '\u270E'}
          </span>
          <span className="v2-search-summary-label">
            {mobileOpen
              ? 'Close'
              : (summaryLabel || 'Change area')}
          </span>
          {!mobileOpen && onStartOver && (
            <span
              role="button"
              tabIndex={0}
              className={
                startOverArmed
                  ? 'v2-search-summary-startover v2-search-summary-startover--armed'
                  : 'v2-search-summary-startover'
              }
              onClick={(e) => {
                e.stopPropagation();
                if (onStartOver) onStartOver();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onStartOver) onStartOver();
                }
              }}
            >
              {startOverArmed ? 'Confirm' : '\u21BB Start over'}
            </span>
          )}
        </button>
      )}

      <div className="v2-search-tabs-body">
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
            <span className="v2-search-tab-label-full">By address + radius</span>
            <span className="v2-search-tab-label-short" aria-hidden="true">
              By address
            </span>
          </button>
          {hasActivePlan && onStartOver && (
            <button
              type="button"
              className={
                startOverArmed
                  ? 'v2-search-startover v2-search-startover--armed'
                  : 'v2-search-startover'
              }
              onClick={onStartOver}
              title={
                startOverArmed
                  ? 'Click again to confirm'
                  : 'Clear everything and start fresh'
              }
            >
              {startOverArmed ? 'Click again to confirm' : '\u21BB Start over'}
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
                ref={zipInputRef}
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
                  onChange={(e) => {
                    setAddressVal(e.target.value);
                    // P1-2: reset touched on edit so the "pick a suggestion"
                    // hint clears as soon as the user starts typing again.
                    if (addressTouched) setAddressTouched(false);
                  }}
                  aria-label="Address"
                  aria-invalid={addressShowHint}
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
            {addressShowHint && (
              <div className="v2-search-error">
                Pick a suggestion from the dropdown to search.
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
