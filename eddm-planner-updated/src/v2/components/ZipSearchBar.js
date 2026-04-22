import React, { useState } from 'react';

/**
 * Floating ZIP search bar — sits absolutely-positioned top-center of the map.
 *
 * V4R2 styling: white background, 1px line border, 6px 24px box shadow,
 * zero border-radius. Search icon + text input + SEARCH button.
 *
 * Accepts 5-digit ZIPs. On submit, calls `onSubmit(zip)`. Does NOT use
 * Places Autocomplete — the production EDDM flow is ZIP-driven. A future
 * enhancement can swap this input for `<Autocomplete>` from
 * `@react-google-maps/api` once we want address → ZIP geocoding.
 *
 * Validation is light (format check) — if the USPS fetch returns no routes
 * we surface the error via the standard error banner.
 */
export default function ZipSearchBar({ onSubmit, placeholder = 'Enter ZIP code' }) {
  const [val, setVal] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = val.trim();
  const valid = /^\d{5}$/.test(trimmed);
  const showError = touched && trimmed.length > 0 && !valid;

  const submit = (e) => {
    if (e) e.preventDefault();
    setTouched(true);
    if (valid && onSubmit) {
      onSubmit(trimmed);
      setVal('');
      setTouched(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="v2-zip-search"
      aria-label="ZIP search"
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
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => setTouched(true)}
          aria-label="ZIP code"
          aria-invalid={showError}
        />
        <button type="submit" className="v2-zip-search-btn">
          Search
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
