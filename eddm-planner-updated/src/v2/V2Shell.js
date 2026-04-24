import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import '../styles/tokens-v2.css';
import './V2Shell.css';

const STEPS = [
  { path: '/v2',         label: '1. Plan',    short: 'Plan' },
  { path: '/v2/design',  label: '2. Design',  short: 'Design' },
  { path: '/v2/review',  label: '3. Review',  short: 'Review' },
  { path: '/v2/mail',    label: '4. Mail',    short: 'Mail' },
];

export default function V2Shell() {
  const location = useLocation();
  const currentPath = location.pathname.replace(/\/$/, '') || '/v2';
  const currentStepIdx = Math.max(
    0,
    STEPS.findIndex((s) => s.path === currentPath)
  );

  // Hide the v2 brand block when MPA chrome is present (injected by the IIFE
  // in public/index.html). The stepper + help link stay — they're the wizard
  // indicator, not site nav. Prevents a double-header on /eddm/.
  const [hasMpaChrome, setHasMpaChrome] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setHasMpaChrome(Boolean(document.getElementById('mpa-header')));
  }, []);

  return (
    <div className="v2-root">
      <header className="v2-header">
        {!hasMpaChrome && (
          <div className="v2-brand">
            <span className="v2-brand-name v2-brand-name--full">
              MailPro &middot; EDDM Planner
            </span>
            <span className="v2-brand-name v2-brand-name--short" aria-hidden="true">
              EDDM Planner
            </span>
          </div>
        )}
        {/* Desktop: full text step nav. Hidden on mobile. */}
        <nav className="v2-stepnav v2-stepnav--desktop" aria-label="Progress">
          {STEPS.map((step) => (
            <Link
              key={step.path}
              to={step.path}
              className={`v2-step ${currentPath === step.path ? 'v2-step-active' : ''}`}
            >
              {step.label}
            </Link>
          ))}
        </nav>
        {/* Mobile: compact progress dots + current step label. */}
        <div className="v2-stepnav v2-stepnav--mobile" aria-label="Progress">
          <span className="v2-stepnav-mobile-label">
            Step {currentStepIdx + 1} of {STEPS.length}
            <span className="v2-stepnav-mobile-name">
              {' '}&middot; {STEPS[currentStepIdx]?.short || ''}
            </span>
          </span>
          <span className="v2-stepnav-dots" aria-hidden="true">
            {STEPS.map((step, i) => (
              <span
                key={step.path}
                className={`v2-stepnav-dot ${
                  i === currentStepIdx ? 'v2-stepnav-dot--active' : ''
                } ${i < currentStepIdx ? 'v2-stepnav-dot--done' : ''}`}
              />
            ))}
          </span>
        </div>
        <div className="v2-help">
          <span className="v2-help-label">Need help?</span>
          <a href="tel:+18636876945" className="v2-help-phone">
            <span className="v2-help-phone-full">(863) 687-6945</span>
            <span className="v2-help-phone-short" aria-hidden="true">Call</span>
          </a>
        </div>
      </header>
      <main className="v2-main">
        <Outlet />
      </main>
    </div>
  );
}
