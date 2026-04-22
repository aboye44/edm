import React from 'react';

/**
 * Inline error banner for Step 1.
 *
 * Props:
 *   type        — 'no-routes' | 'timeout' | 'invalid-zip' | 'tiles-fail' | 'network'
 *   zip         — the offending ZIP (when relevant)
 *   onRetry     — () => void, for the primary retry button
 *   onContinue  — () => void, for 'tiles-fail' "continue anyway"
 *   onTryZip    — (newZip) => void, for 'no-routes' nearby-ZIP suggestion
 *   nearbyZip   — string, suggested ZIP to try (optional)
 *
 * Style: red-washed background + 3px red left border. No icons, no modals.
 * Typographic, calm. Matches the design handoff in step1-errors.jsx.
 */
export default function Step1ErrorBanner({
  type,
  zip,
  onRetry,
  onContinue,
  onTryZip,
  nearbyZip,
}) {
  if (!type) return null;

  // Invalid ZIP — rendered inline underneath ZipSearchBar. This variant is
  // tiny, slate italic, no background. (The input border turns red via CSS
  // in ZipSearchBar via data-error.)
  if (type === 'invalid-zip') {
    return (
      <div
        className="v2-error-banner v2-error-banner--invalid-zip"
        role="alert"
      >
        Enter a 5-digit ZIP (e.g. 33801).
      </div>
    );
  }

  if (type === 'no-routes') {
    return (
      <div className="v2-error-banner v2-error-banner--no-routes" role="alert">
        <div className="v2-error-banner-eyebrow">No routes here</div>
        <div className="v2-error-banner-title">
          No carrier routes found for <strong>{zip}</strong>. Try a nearby ZIP
          or contact us.
        </div>
        <div className="v2-error-banner-actions">
          {nearbyZip && onTryZip && (
            <button
              type="button"
              className="v2-error-banner-btn v2-error-banner-btn--primary"
              onClick={() => onTryZip(nearbyZip)}
            >
              Try {nearbyZip} →
            </button>
          )}
          <a
            className="v2-error-banner-btn v2-error-banner-btn--secondary"
            href="tel:+18636876945"
          >
            Call (863) 687-6945
          </a>
        </div>
      </div>
    );
  }

  if (type === 'timeout') {
    return (
      <div className="v2-error-banner v2-error-banner--timeout" role="alert">
        <div className="v2-error-banner-title">
          USPS route service didn&apos;t respond. Retrying automatically...
        </div>
        <div
          className="v2-error-banner-progress"
          aria-hidden="true"
        >
          <div className="v2-error-banner-progress-bar" />
        </div>
        <div className="v2-error-banner-actions">
          {onRetry && (
            <button
              type="button"
              className="v2-error-banner-btn v2-error-banner-btn--primary"
              onClick={onRetry}
            >
              Retry now
            </button>
          )}
        </div>
      </div>
    );
  }

  if (type === 'network') {
    return (
      <div className="v2-error-banner v2-error-banner--network" role="alert">
        <div className="v2-error-banner-title">
          Couldn&apos;t reach the USPS route service. Check your connection
          and try again.
        </div>
        <div className="v2-error-banner-actions">
          {onRetry && (
            <button
              type="button"
              className="v2-error-banner-btn v2-error-banner-btn--primary"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (type === 'tiles-fail') {
    return (
      <div
        className="v2-error-banner v2-error-banner--tiles-fail"
        role="alert"
      >
        <div className="v2-error-banner-title">
          Map couldn&apos;t load. Your routes are still saved — continue to
          design, or retry.
        </div>
        <div className="v2-error-banner-actions">
          {onRetry && (
            <button
              type="button"
              className="v2-error-banner-btn v2-error-banner-btn--primary"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          {onContinue && (
            <button
              type="button"
              className="v2-error-banner-btn v2-error-banner-btn--secondary"
              onClick={onContinue}
            >
              Continue anyway →
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
