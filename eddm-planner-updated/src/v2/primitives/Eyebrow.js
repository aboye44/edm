import React from 'react';

/**
 * MPA V4R2 Eyebrow label.
 *
 * 10px / 700 / 1.8 letter-spacing / uppercase.
 * Default color: --mpa-v2-slate. Pass `color` to override (e.g. --mpa-v2-red
 * for the hero "Households Reached" eyebrow).
 *
 * Spec: README § "Design tokens → Typography" and § "Shared primitives".
 */
export default function Eyebrow({ color, children, style, className }) {
  return (
    <div
      className={className}
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.8,
        lineHeight: 1,
        textTransform: 'uppercase',
        color: color || 'var(--mpa-v2-slate)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
