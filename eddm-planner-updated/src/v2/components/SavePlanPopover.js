import React from 'react';
import Eyebrow from '../primitives/Eyebrow';

/**
 * Save-plan popover — triggered by a utility-style "Save this plan" link.
 *
 * P1-1 honesty fix: the previous revision POSTed to
 * `/.netlify/functions/save-plan`, which doesn't exist on this deploy,
 * and silently fell back to showing a "Check your inbox!" confirmation
 * regardless of what the server returned. Users thought a save email
 * went out when nothing had happened.
 *
 * Current behavior: no network call, no email. PlannerContext already
 * persists state to localStorage, so bookmarking the page is enough to
 * return to the same plan. When we later wire a real save-plan endpoint
 * (post-cutover, probably on Cloudflare Functions), we can restore the
 * email flow here — the component shape can stay the same.
 */
export default function SavePlanPopover({ onClose }) {
  return (
    <div
      className="v2-save-popover"
      role="dialog"
      aria-label="Save your plan"
    >
      <Eyebrow color="var(--mpa-v2-red)">Save for later</Eyebrow>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          marginTop: 4,
          marginBottom: 8,
        }}
      >
        Your plan is saved locally
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--mpa-v2-ink-soft)',
          marginBottom: 14,
          lineHeight: 1.5,
        }}
      >
        Bookmark this page to come back — your routes, size, and totals
        stay in your browser until you clear them or hit <em>Start over</em>.
      </div>

      <button
        type="button"
        onClick={onClose}
        className="v2-save-submit"
      >
        Got it
      </button>
    </div>
  );
}
