/**
 * Error Boundary Component with Sentry Integration
 *
 * This component catches JavaScript errors anywhere in the React component tree,
 * logs those errors to Sentry, and displays a fallback UI instead of crashing.
 *
 * Usage:
 * <ErrorBoundary>
 *   <YourApp />
 * </ErrorBoundary>
 */

import React from 'react';
import * as Sentry from '@sentry/react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to Sentry with component stack trace
    Sentry.withScope((scope) => {
      // Add extra context about the error
      scope.setContext('errorBoundary', {
        componentStack: errorInfo.componentStack,
      });

      // Set user feedback context if available
      scope.setLevel('error');

      // Capture the error and get event ID for user feedback
      const eventId = Sentry.captureException(error);

      // Update state with error details
      this.setState({
        error,
        errorInfo,
        eventId,
      });
    });

    // Also log to console for development
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReportFeedback = () => {
    // Allow user to provide additional feedback to Sentry
    const { eventId } = this.state;
    if (eventId) {
      Sentry.showReportDialog({ eventId });
    }
  };

  handleReload = () => {
    // Reload the page to recover from error
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f5f5f5',
          padding: '32px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{
            maxWidth: '600px',
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '48px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1)',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '72px',
              marginBottom: '24px',
            }}>
              😢
            </div>

            <h1 style={{
              fontSize: '28px',
              fontWeight: '700',
              color: '#2C3E7C',
              marginBottom: '16px',
            }}>
              Something Went Wrong
            </h1>

            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.6',
              marginBottom: '32px',
            }}>
              We're sorry, but something unexpected happened. Our team has been
              automatically notified and we're looking into it.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details style={{
                marginBottom: '24px',
                textAlign: 'left',
                backgroundColor: '#FEE',
                border: '1px solid #FCC',
                borderRadius: '8px',
                padding: '16px',
              }}>
                <summary style={{
                  cursor: 'pointer',
                  fontWeight: '600',
                  color: '#C33',
                  marginBottom: '8px',
                }}>
                  Error Details (Development Only)
                </summary>
                <pre style={{
                  fontSize: '12px',
                  color: '#C33',
                  overflow: 'auto',
                  margin: '8px 0 0 0',
                }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <div style={{
              display: 'flex',
              gap: '16px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}>
              <button
                onClick={this.handleReload}
                style={{
                  backgroundColor: '#D32F2F',
                  color: 'white',
                  border: 'none',
                  padding: '14px 28px',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#B71C1C'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#D32F2F'}
              >
                Reload Page
              </button>

              {this.state.eventId && (
                <button
                  onClick={this.handleReportFeedback}
                  style={{
                    backgroundColor: 'white',
                    color: '#4A90E2',
                    border: '2px solid #4A90E2',
                    padding: '14px 28px',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    e.target.style.backgroundColor = '#4A90E2';
                    e.target.style.color = 'white';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.backgroundColor = 'white';
                    e.target.style.color = '#4A90E2';
                  }}
                >
                  Report Feedback
                </button>
              )}
            </div>

            <p style={{
              fontSize: '14px',
              color: '#999',
              marginTop: '32px',
              lineHeight: '1.5',
            }}>
              If this problem persists, please contact us at{' '}
              <a
                href="https://www.mailpro.org/request-a-quote"
                style={{ color: '#4A90E2', textDecoration: 'none' }}
              >
                mailpro.org
              </a>
            </p>
          </div>
        </div>
      );
    }

    // No error, render children normally
    return this.props.children;
  }
}

// Export both the class component and Sentry's wrapped version
export default ErrorBoundary;

// For use with Sentry's automatic error boundary wrapper
export const SentryErrorBoundary = Sentry.withErrorBoundary(ErrorBoundary, {
  fallback: <ErrorBoundary hasError={true} />,
  showDialog: true,
});
