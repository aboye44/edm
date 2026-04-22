import React from 'react';

/**
 * Bottom-left map mode switcher. Three segmented buttons: Click / Draw / Radius.
 * `Click` is the default and only fully-wired mode in Phase 3 — Draw uses the
 * Google DrawingManager (wired in MapPane) and Radius shows a Circle.
 *
 * V4R2 styling: white bg, 1px line border, small map-overlay shadow, zero
 * radius. Active button fills with ink, inactive stays slate.
 *
 * Props:
 *   mode      — 'click' | 'draw' | 'radius'
 *   onChange  — (next) => void
 *   radius    — optional current radius in miles (for the slider)
 *   onRadiusChange — optional (miles) => void
 */
const MODES = [
  { id: 'click', label: 'Click' },
  { id: 'draw', label: 'Draw' },
  { id: 'radius', label: 'Radius' },
];

export default function ModeSwitcher({
  mode = 'click',
  onChange,
  radius = 1,
  onRadiusChange,
}) {
  return (
    <div className="v2-mode-switcher">
      <div className="v2-mode-switcher-group" role="tablist" aria-label="Selection mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`v2-mode-btn ${mode === m.id ? 'is-active' : ''}`}
            onClick={() => onChange && onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'radius' && (
        <div className="v2-mode-radius-slider">
          <label style={{ fontSize: 11, color: 'var(--mpa-v2-slate)' }}>
            Radius: <strong style={{ color: 'var(--mpa-v2-ink)' }}>{radius} mi</strong>
          </label>
          <input
            type="range"
            min="0.25"
            max="5"
            step="0.25"
            value={radius}
            onChange={(e) =>
              onRadiusChange && onRadiusChange(parseFloat(e.target.value))
            }
          />
        </div>
      )}
    </div>
  );
}
