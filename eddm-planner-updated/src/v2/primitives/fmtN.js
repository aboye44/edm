/**
 * Format an integer with thousands separators. `1234 -> "1,234"`.
 *
 * Used everywhere numeric values show in the sidebar, hero, and chips.
 * Guards against NaN / undefined by returning "0".
 */
export default function fmtN(n) {
  if (n == null || Number.isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}
