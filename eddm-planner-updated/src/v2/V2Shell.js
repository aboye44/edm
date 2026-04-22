import React from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import '../styles/tokens-v2.css';
import './V2Shell.css';

const STEPS = [
  { path: '/v2',         label: '1. Plan' },
  { path: '/v2/design',  label: '2. Design' },
  { path: '/v2/review',  label: '3. Review' },
  { path: '/v2/mail',    label: '4. Mail' },
];

export default function V2Shell() {
  const location = useLocation();
  const currentPath = location.pathname.replace(/\/$/, '') || '/v2';

  return (
    <div className="v2-root">
      <header className="v2-header">
        <div className="v2-brand">
          <div className="v2-logo">M</div>
          <span className="v2-brand-name">Mailpro · EDDM Planner</span>
        </div>
        <nav className="v2-stepnav">
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
        <div className="v2-help">Need help? <a href="tel:+18633446245">(844) 344-6245</a></div>
      </header>
      <main className="v2-main">
        <Outlet />
      </main>
    </div>
  );
}
