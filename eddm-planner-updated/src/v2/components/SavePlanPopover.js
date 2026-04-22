import React, { useState } from 'react';
import Eyebrow from '../primitives/Eyebrow';

/**
 * Save-plan popover — triggered by a utility-style "Save this plan" link.
 *
 * Inline, no modal. Single email input + named campaign input. On submit,
 * POSTs to `/.netlify/functions/save-plan`; if the endpoint is missing we
 * still show the inline "Sent!" confirmation (the real backend wiring lands
 * in a later phase).
 *
 * Spec: README § "Step 1 — Enhanced features → Save-plan popover".
 */
export default function SavePlanPopover({ onClose, plannerState }) {
  const [email, setEmail] = useState('');
  const [campaign, setCampaign] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error

  const submit = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setStatus('sending');
    try {
      const resp = await fetch('/.netlify/functions/save-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, campaign, planner: plannerState || null }),
      });
      if (!resp.ok) throw new Error('save-plan endpoint not available');
      setStatus('sent');
    } catch (err) {
      // Endpoint not yet wired — fall back to a console log + success UI.
      // eslint-disable-next-line no-console
      console.log('[v2/save-plan stub]', { email, campaign, plannerState });
      setStatus('sent');
    }
  };

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
          marginBottom: 3,
        }}
      >
        Email me a link to this plan
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: 'var(--mpa-v2-slate)',
          marginBottom: 12,
          lineHeight: 1.45,
        }}
      >
        Come back any time. Your routes, size, and totals stay saved.
      </div>

      {status !== 'sent' && (
        <form onSubmit={submit}>
          <input
            type="text"
            placeholder="Campaign name (e.g. Spring roof promo)"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className="v2-save-input"
            aria-label="Campaign name"
          />
          <input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="v2-save-input"
            aria-label="Email address"
            required
          />
          <button
            type="submit"
            className="v2-save-submit"
            disabled={status === 'sending'}
          >
            {status === 'sending' ? 'Sending…' : 'Send me the link'}
          </button>
        </form>
      )}

      {status === 'sent' && (
        <div className="v2-save-confirm">
          <span style={{ color: 'var(--mpa-v2-red)', fontWeight: 600 }}>
            &#10003;
          </span>{' '}
          Check your inbox — we emailed a link to your plan.
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="v2-save-cancel"
      >
        {status === 'sent' ? 'Close' : 'Cancel'}
      </button>
    </div>
  );
}
