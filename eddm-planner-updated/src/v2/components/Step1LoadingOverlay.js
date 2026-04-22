import React from 'react';

/**
 * Loading indicators for Step 1. Three variants, no full-screen takeovers.
 *
 * Props:
 *   variant — 'initial' | 'zip-change' | 'geocoding'
 *
 * Renders:
 *   'initial'     — soft paper-tint overlay on the map + tiny uppercase red
 *                   "LOADING ROUTES..." label. Map still visible behind.
 *   'zip-change'  — slim 2px red indeterminate progress bar at the top edge
 *                   of the map. Map stays interactive.
 *   'geocoding'   — a right-side pulse + "locating..." slate italic. This
 *                   variant is rendered INLINE inside the ZIP search bar by
 *                   ZipSearchBar itself (not as a map overlay).
 */
export default function Step1LoadingOverlay({ variant }) {
  if (!variant) return null;

  if (variant === 'initial') {
    return (
      <div
        className="v2-loading-overlay v2-loading-overlay--initial"
        role="status"
        aria-live="polite"
      >
        <div className="v2-loading-overlay-veil" aria-hidden="true" />
        <div className="v2-loading-overlay-label">Loading routes...</div>
      </div>
    );
  }

  if (variant === 'zip-change') {
    return (
      <div
        className="v2-loading-overlay v2-loading-overlay--zip-change"
        role="status"
        aria-live="polite"
      >
        <div className="v2-loading-overlay-bar" aria-hidden="true">
          <div className="v2-loading-overlay-bar-fill" />
        </div>
      </div>
    );
  }

  if (variant === 'geocoding') {
    // Subtle inline indicator — meant to be placed inside ZipSearchBar.
    return (
      <span
        className="v2-loading-inline v2-loading-inline--geocoding"
        role="status"
        aria-live="polite"
      >
        <span className="v2-loading-inline-pulse" aria-hidden="true" />
        <span className="v2-loading-inline-label">locating...</span>
      </span>
    );
  }

  return null;
}
