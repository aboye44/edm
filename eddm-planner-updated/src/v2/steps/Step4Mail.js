import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlanner } from '../PlannerContext';
import Eyebrow from '../primitives/Eyebrow';
import './Step4Mail.css';

/**
 * Step 4 — Thank-you page.
 *
 * Landed after a successful POST to /.netlify/functions/submit-quote-request
 * on Step 3. Confirms the email on file, sets expectations (one business day),
 * and offers two exits — start a new plan, or head back home.
 *
 * Clears v2 state on mount so a reload (or a follow-up plan later in the
 * same browser) starts clean. We snapshot the email BEFORE resetting so the
 * copy can still read "we'll email {email}" after the wipe.
 */
export default function Step4Mail() {
  const { state, reset } = usePlanner();
  // Snapshot the email once on mount — reset() will clear it, and we still
  // want the page to read "we emailed {you@company.com}" after the wipe.
  const [confirmedEmail] = useState(() => state.contact?.email || '');

  useEffect(() => {
    // Clear the v2 planner state once the thank-you has rendered. A hard
    // reload now shows a fresh planner instead of the old campaign.
    reset();
    // Belt and suspenders — if reset() ever drifts from clearing storage,
    // the direct removeItem catches that case.
    try {
      localStorage.removeItem('eddm_v2_state');
    } catch (e) { /* quota / privacy mode — ignore */ }
    // We intentionally run this only once on mount. `reset` is stable from
    // context but we keep deps empty to make the single-shot behavior explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="step4-root">
      <div className="step4-shell">
        <div className="step4-check" aria-hidden="true">&#10003;</div>
        <Eyebrow color="var(--mpa-v2-red)" className="step4-eyebrow">
          Request received
        </Eyebrow>
        <h1 className="step4-title">Thanks — we'll be in touch.</h1>
        <p className="step4-body">
          A MailPro print strategist will email{' '}
          {confirmedEmail ? (
            <strong>{confirmedEmail}</strong>
          ) : (
            <strong>you</strong>
          )}{' '}
          with your quote within one business day.
        </p>
        <p className="step4-body">
          Need to move fast? Call us at{' '}
          <a href="tel:+18636876945">(863) 687-6945</a> and reference your
          campaign — we keep hours Monday through Friday.
        </p>

        <hr className="step4-divider" />

        <div className="step4-actions">
          <Link to="/v2" className="step4-cta-primary">
            Start a new plan
          </Link>
          <a href="/" className="step4-cta-secondary">
            Back to homepage
          </a>
        </div>
      </div>
    </div>
  );
}
