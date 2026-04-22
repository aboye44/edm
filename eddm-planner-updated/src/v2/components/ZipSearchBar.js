import React, { useCallback, useRef, useState } from 'react';
import { Autocomplete } from '@react-google-maps/api';
import Step1LoadingOverlay from './Step1LoadingOverlay';

/**
 * Floating ZIP search bar — sits absolutely-positioned top-center of the map.
 *
 * V4R2 styling: white background, 1px line border, 6px 24px box shadow,
 * zero border-radius. Search icon + text input + SEARCH button.
 *
 * Phase 4 upgrade:
 *   - Wraps input in <Autocomplete> from @react-google-maps/api so users can
 *     pick ZIPs, cities, or addresses. On place selection:
 *     * Extracts postal_code → calls onZipChange(zip)
 *     * Extracts geometry → calls onCenterChange({ lat, lng })
 *   - Accepts pasted 5-digit ZIPs and submits them directly (bypasses
 *     Autocomplete) so nothing regresses for keyboard users.
 *   - Renders 'geocoding' loading indicator inline when `geocoding` prop true.
 *   - Shows an inline invalid-zip hint when `showInvalid` prop is true.
 *
 * Props:
 *   onZipChange   — (zip: string) => void, called with a 5-digit ZIP
 *   onCenterChange — ({ lat, lng }) => void, optional
 *   onSubmit      — (zip: string) => void  [legacy alias for onZipChange]
 *   geocoding     — boolean, show inline loading state
 *   showInvalid   — boolean, show invalid-ZIP hint + red border
 *   placeholder   — string
 */
export default function ZipSearchBar({
  onZipChange,
  onCenterChange,
  onSubmit,
  geocoding = false,
  showInvalid = false,
  placeholder = 'Enter ZIP, city, or address',
}) {
  const [val, setVal] = useState('');
  const [touched, setTouched] = useState(false);
  const autocompleteRef = useRef(null);

  const trimmed = val.trim();
  // Detect if the trimmed value contains a 5-digit sequence — this lets us
  // accept "33801" as well as "Lakeland, FL 33801".
  const zipMatch = trimmed.match(/\b(\d{5})\b/);
  const hasZipToken = Boolean(zipMatch);
  const showError =
    showInvalid || (touched && trimmed.length > 0 && !hasZipToken);

  const dispatchZip = useCallback(
    (zip) => {
      if (onZipChange) onZipChange(zip);
      if (onSubmit) onSubmit(zip);
    },
    [onZipChange, onSubmit]
  );

  const handleAutocompleteLoad = useCallback((ac) => {
    autocompleteRef.current = ac;
  }, []);

  const handlePlaceChanged = useCallback(() => {
    const ac = autocompleteRef.current;
    if (!ac) return;
    const place = ac.getPlace();
    if (!place) return;

    const components = place.address_components || [];
    const zipComponent = components.find((c) =>
      (c.types || []).includes('postal_code')
    );
    const zip = zipComponent?.long_name || null;

    // Prefer place.geometry.location when available
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

    if (lat != null && lng != null && onCenterChange) {
      onCenterChange({ lat, lng });
    }

    if (zip && /^\d{5}$/.test(zip)) {
      dispatchZip(zip);
      setVal('');
      setTouched(false);
    } else if (place.formatted_address) {
      // Rare: user picked a place without a postal_code (e.g. a region
      // with no ZIP). Surface the formatted address but don't show the
      // error banner — they picked a legitimate result, not a typo.
      setVal(place.formatted_address);
    }
  }, [dispatchZip, onCenterChange]);

  const submit = (e) => {
    if (e) e.preventDefault();
    setTouched(true);
    if (hasZipToken) {
      dispatchZip(zipMatch[1]);
      setVal('');
      setTouched(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="v2-zip-search"
      aria-label="ZIP, city, or address search"
    >
      <div
        className="v2-zip-search-box"
        data-error={showError ? 'true' : 'false'}
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

        <Autocomplete
          onLoad={handleAutocompleteLoad}
          onPlaceChanged={handlePlaceChanged}
          options={{
            // 'geocode' accepts addresses, ZIPs, cities, sublocalities — the
            // full geocoder result set. '(regions)' would block street
            // addresses, which is wrong for our use case (users paste full
            // office addresses and expect a match).
            types: ['geocode'],
            componentRestrictions: { country: 'us' },
            // Only request what we actually use — smaller payload + faster.
            fields: ['address_components', 'geometry', 'formatted_address'],
          }}
        >
          <input
            type="text"
            value={val}
            placeholder={placeholder}
            onChange={(e) => setVal(e.target.value)}
            aria-label="ZIP code, city, or address"
            aria-invalid={showError}
          />
        </Autocomplete>

        {geocoding && <Step1LoadingOverlay variant="geocoding" />}

        <button type="submit" className="v2-zip-search-btn">
          {geocoding ? 'Searching...' : 'Search'}
        </button>
      </div>
      {showError && (
        <div className="v2-zip-search-error">
          Enter a 5-digit ZIP (e.g. 33801).
        </div>
      )}
    </form>
  );
}
