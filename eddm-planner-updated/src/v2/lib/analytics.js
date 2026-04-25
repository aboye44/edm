/**
 * Tiny gtag wrapper for the v2 wizard.
 *
 * The Google Tag is injected by public/index.html (lines 5-12) which
 * mounts a `window.gtag` shim before any React code runs. We wrap it
 * here so:
 *   - Components don't need to feature-detect `window.gtag` themselves
 *   - SSR / pre-render safe (this file is JS but might run during a
 *     test render where `window` isn't defined)
 *   - Failures are silent — analytics tracking should never break the
 *     wizard for the user
 *
 * Only fire from step transitions or terminal events (submit success /
 * fail). Don't fire on every interaction — gtag has free-tier event
 * caps and noise hurts the funnel signal anyway. Don't include PII
 * (email, phone, name) in `params`.
 */
export function track(event, params = {}) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  try {
    window.gtag('event', event, params);
  } catch (_) {
    // Best-effort. A blocked gtag (ad blocker), a thrown analytics
    // listener, or a misconfigured tag manager shouldn't surface to
    // the user.
  }
}
