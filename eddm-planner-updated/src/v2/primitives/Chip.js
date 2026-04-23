import React from 'react';
import fmtN from './fmtN';

/**
 * Route chip used in the Step 1 sidebar "Your Routes" list.
 *
 * Layout: mono route code · slate mono HH count · × remove button.
 * 1px line border, 5px/10px padding, 11.5px text. Zero border-radius.
 *
 * Spec: README § "Step 1 — Plan" → chip description; tokens.jsx MPAChip.
 */
export default function Chip({ routeId, name, hh, onRemove }) {
  return (
    <div
      className="mpa-v2-chip"
      data-route-id={routeId}
    >
      <span className="mpa-v2-chip-name">{name}</span>
      <span className="mpa-v2-chip-hh">{fmtN(hh)}</span>
      <button
        type="button"
        aria-label={`Remove route ${name}`}
        onClick={onRemove}
        className="mpa-v2-chip-remove"
      >
        &#215;
      </button>
    </div>
  );
}
