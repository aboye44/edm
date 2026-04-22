import React from 'react';
import fmtN from '../primitives/fmtN';

/**
 * Floating state pill (top-right of the map). White bg, 8px radius (the ONE
 * place we allow a radius in V4R2), medium map-overlay shadow. Shows either
 * an empty-state hint or `"{N} routes · {hh} homes"` with a pulsing red dot.
 *
 * Pulse keyframe is defined in Step1Plan.css (`@keyframes mpaPulse`).
 */
export default function StatePill({ count, hh }) {
  const isEmpty = !count || count === 0;
  return (
    <div className="v2-state-pill" role="status" aria-live="polite">
      {isEmpty ? (
        <>
          <span className="v2-state-pill-hint-arrow" aria-hidden="true">
            &#8598;
          </span>
          <span>Tap a shape to add a route</span>
        </>
      ) : (
        <>
          <span className="v2-state-pill-dot" aria-hidden="true" />
          <span>
            {fmtN(count)} {count === 1 ? 'route' : 'routes'} &middot; {fmtN(hh)} homes
          </span>
        </>
      )}
    </div>
  );
}
