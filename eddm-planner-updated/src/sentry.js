/**
 * Sentry Error Monitoring Configuration
 *
 * This file initializes Sentry for production error tracking.
 * Sentry captures:
 * - JavaScript errors and crashes
 * - Unhandled promise rejections
 * - Network errors
 * - User actions (breadcrumbs)
 * - Performance metrics (optional)
 *
 * Setup: Add REACT_APP_SENTRY_DSN to Netlify environment variables
 * See: SENTRY_SETUP.md for complete instructions
 */

import * as Sentry from '@sentry/react';

// Only initialize Sentry in production with a valid DSN
const SENTRY_DSN = process.env.REACT_APP_SENTRY_DSN;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (SENTRY_DSN && IS_PRODUCTION) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Environment tracking (production, staging, development)
    environment: process.env.REACT_APP_ENVIRONMENT || 'production',

    // Sample rate for error events (100% = all errors)
    // In high-traffic apps, you might reduce this to 50% or lower
    sampleRate: 1.0,

    // Performance monitoring (tracks slow operations)
    // Set to 0.1 (10%) for production to reduce data volume
    tracesSampleRate: IS_PRODUCTION ? 0.1 : 1.0,

    // Filter out noise and irrelevant errors
    beforeSend(event, hint) {
      // Don't send events from browser extensions
      const error = hint.originalException;
      if (error && error.message && error.message.includes('extension://')) {
        return null;
      }

      // Don't send events from ad blockers
      if (error && error.message && error.message.includes('adsbygoogle')) {
        return null;
      }

      // Don't send Google Maps errors (they're usually user-caused)
      if (error && error.message && error.message.includes('google.maps')) {
        return null;
      }

      // Don't send network errors from CORS or ad blockers
      if (error && error.message && error.message.includes('NetworkError')) {
        return null;
      }

      // Add custom fingerprinting for better grouping
      if (event.exception) {
        event.fingerprint = ['{{ default }}', event.exception.values?.[0]?.type || 'unknown'];
      }

      return event;
    },

    // Ignore certain types of errors that are not actionable
    ignoreErrors: [
      // Browser extensions
      'top.GLOBALS',
      'chrome-extension://',
      'moz-extension://',

      // Random plugins/extensions
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',

      // Network errors (can't fix these)
      'NetworkError',
      'Failed to fetch',
      'Load failed',

      // Google Maps errors (user-caused, not our bug)
      'google.maps',

      // React DevTools
      'Can\'t find variable: __REACT_DEVTOOLS_GLOBAL_HOOK__',
    ],

    // Don't send breadcrumbs for console.log (reduces noise)
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console' && breadcrumb.level !== 'error') {
        return null;
      }
      return breadcrumb;
    },
  });

  console.log('✅ Sentry initialized for error monitoring');
} else if (!IS_PRODUCTION) {
  console.log('ℹ️ Sentry disabled in development mode');
} else {
  console.warn('⚠️ Sentry DSN not configured - error monitoring disabled');
}

// Export Sentry for manual error capturing
export default Sentry;
