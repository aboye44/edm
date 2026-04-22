import { useEffect, useRef, useState } from 'react';

/**
 * RAF-based count-up hook.
 *
 * @param {number} target   The target numeric value.
 * @param {number} duration Duration in ms (default 400).
 * @returns {number}        The current animated value (rounded).
 *
 * Easing: easeOutCubic — `1 - Math.pow(1 - p, 3)`.
 *
 * Spec: README § "Interactions & motion" and tokens.jsx useMPACountUp.
 * On the hero Households Reached number this animates on every change;
 * pricing-dependent numbers (postage total, per-HH) also use this when
 * MPA_PRICING_VISIBLE is true.
 */
export default function useCountUp(target, duration = 400) {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [val, setVal] = useState(safeTarget);
  const prev = useRef(safeTarget);

  useEffect(() => {
    const from = prev.current;
    if (from === safeTarget) return undefined;

    const start = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (safeTarget - from) * ease));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prev.current = safeTarget;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safeTarget, duration]);

  return val;
}
