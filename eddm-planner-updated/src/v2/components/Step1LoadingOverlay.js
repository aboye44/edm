import React from 'react';

/**
 * Loading indicators for Step 1.
 *
 * Design decision: the original V4R2 spec called for "typographic, not
 * iconographic" subtle loaders. User testing showed that's the wrong
 * UX here — a 5-10 second multi-ZIP radius fetch with a subtle overlay
 * reads as "nothing is happening" and users start clicking impatiently.
 *
 * New pattern (Phase 5.2): aggressive blocking overlay for any fetch
 * that's going to keep the map inert. Inks the map, centers a red
 * spinner + "Loading carrier routes" in cream, un-missable. Inline
 * geocoding indicator (inside the search bar) stays subtle since the
 * map remains interactive during geocoding.
 *
 * Props:
 *   variant  — 'blocking' | 'geocoding'
 *   subLabel — optional second line for context (e.g. "This may take a
 *              moment for large radius searches")
 */
export default function Step1LoadingOverlay({ variant, subLabel }) {
  if (!variant) return null;

  // 'initial' and 'zip-change' both roll up into 'blocking' now — any
  // fetch that prevents meaningful interaction gets the aggressive
  // treatment. Legacy variant names still supported.
  const isBlocking =
    variant === 'blocking' ||
    variant === 'initial' ||
    variant === 'zip-change';

  if (isBlocking) {
    return (
      <div
        className="v2-loading-overlay v2-loading-overlay--blocking"
        role="status"
        aria-live="polite"
      >
        <div className="v2-loading-overlay-card">
          <div className="v2-loading-spinner" aria-hidden="true" />
          <div className="v2-loading-overlay-label">
            Loading carrier routes
          </div>
          {subLabel && (
            <div className="v2-loading-overlay-sublabel">{subLabel}</div>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'geocoding') {
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
