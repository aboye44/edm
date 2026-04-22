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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        background: 'var(--mpa-v2-white)',
        border: '1px solid var(--mpa-v2-line)',
        fontSize: 11.5,
        fontWeight: 500,
        lineHeight: 1,
        color: 'var(--mpa-v2-ink)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--mpa-v2-font-mono)',
          fontWeight: 600,
          color: 'var(--mpa-v2-ink)',
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: 'var(--mpa-v2-font-mono)',
          color: 'var(--mpa-v2-slate)',
        }}
      >
        {fmtN(hh)}
      </span>
      <button
        type="button"
        aria-label={`Remove route ${name}`}
        onClick={onRemove}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          marginLeft: 2,
          color: 'var(--mpa-v2-slate)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  );
}
