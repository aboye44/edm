/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the React component tree and
 * displays a fallback UI instead of crashing.
 *
 * Note: Sentry was removed in the P1 cleanup pass — the DSN was never
 * configured in any environment so the SDK was dead weight in the bundle.
 * If we add error tracking back, lazy-load it so an unconfigured deploy
 * doesn't ship the SDK.
 */

import React from 'react';
import './ErrorBoundary.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Capture for the dev-mode details pane and log to console.
    this.setState({ error, errorInfo });
    // eslint-disable-next-line no-console
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReload = () => {
    // Reload the page to recover from error
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-card">
            <div className="error-boundary-eyebrow">Something went wrong</div>

            <h1 className="error-boundary-title">
              We hit an unexpected error.
            </h1>

            <p className="error-boundary-body">
              Try reloading the page. If this keeps happening, give us a
              call at{' '}
              <a className="error-boundary-link" href="tel:+18636876945">
                (863) 687-6945
              </a>{' '}
              and we'll help you finish your quote by phone.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-boundary-details">
                <summary className="error-boundary-details-summary">
                  Error details (development only)
                </summary>
                <pre className="error-boundary-details-pre">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <button
              type="button"
              onClick={this.handleReload}
              className="error-boundary-cta"
            >
              Reload page
            </button>

            <p className="error-boundary-footer">
              Need a quote now? Email{' '}
              <a
                className="error-boundary-link"
                href="mailto:orders@mailpro.org"
              >
                orders@mailpro.org
              </a>
              .
            </p>
          </div>
        </div>
      );
    }

    // No error, render children normally
    return this.props.children;
  }
}

export default ErrorBoundary;
