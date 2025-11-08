# Sentry Error Monitoring Setup Guide

## 🎯 Why Sentry?

Sentry provides **real-time error tracking** for your EDDM Campaign Planner. Instead of waiting for users to report bugs, you'll know immediately when something breaks.

**What Sentry Captures:**
- ✅ JavaScript errors and crashes
- ✅ Network/API failures
- ✅ User actions leading up to errors (breadcrumbs)
- ✅ Performance bottlenecks
- ✅ Session replays (visual debugging)

**When you need it:**
- Production errors (especially ones that don't happen in development)
- API failures from USPS or Google Maps
- Webhook delivery failures
- Browser compatibility issues
- Performance monitoring

---

## Quick Setup (10 Minutes)

### Step 1: Create Sentry Project

1. Go to [https://sentry.io](https://sentry.io) and sign up (free plan works for most sites)
2. Create a new project:
   - **Platform:** React
   - **Project Name:** "EDDM Campaign Planner"
   - **Alert Frequency:** "Alert me on every new issue"
3. Copy the **DSN** (looks like: `https://abc123@o123456.ingest.sentry.io/7654321`)

### Step 2: Add DSN to Netlify

1. Go to your Netlify dashboard
2. Select your EDDM site
3. **Site settings** → **Environment variables**
4. Click **"Add a variable"**:
   - **Key:** `REACT_APP_SENTRY_DSN`
   - **Value:** Paste your Sentry DSN
5. Optional: Add environment name
   - **Key:** `REACT_APP_ENVIRONMENT`
   - **Value:** `production` (or `staging` for test site)
6. Click **"Save"**
7. **Trigger a new deploy**

### Step 3: Test It Works

1. After deploy completes, visit your live site
2. Open browser console (F12)
3. You should see: `✅ Sentry initialized for error monitoring`
4. To test error capturing:
   - Go to Sentry dashboard → Issues
   - Check for any errors from your site
   - Try triggering a test error (see Testing section below)

---

## What's Already Configured

The EDDM Campaign Planner has **comprehensive Sentry integration** built in:

### ✅ Error Boundary
- Catches React component crashes
- Shows user-friendly error page
- Automatically reports to Sentry
- Allows user to report feedback

### ✅ User Action Tracking (Breadcrumbs)
Every significant user action is tracked:
- ZIP code searches
- Coverage area searches
- Route selections/deselections
- Quote form submissions
- API calls and responses

**Example breadcrumb trail before an error:**
```
1. [user-action] ZIP search initiated (zipCode: "33815")
2. [http] GET /.netlify/functions/eddm-routes?zip=33815 → 200
3. [user-action] Route selected (routeId: "33815-C001", totalSelected: 1)
4. [user-action] Route selected (routeId: "33815-C002", totalSelected: 2)
5. [user-action] Quote form submitted (company: "ABC Restaurant", totalAddresses: 2450)
6. [http] POST https://hooks.zapier.com/... → 500
7. [error] Webhook failed with status 500
```

### ✅ Error Context
When errors occur, Sentry receives:
- **User info:** Email, name, company (from quote form)
- **Campaign details:** Routes selected, addresses, estimated cost
- **Technical context:** Browser, OS, device
- **Component stack:** Exactly where the error occurred

### ✅ Performance Monitoring
- Tracks page load times
- Monitors API call duration
- Identifies slow operations
- 10% sample rate in production (saves quota)

### ✅ Session Replay
- Records 10% of normal sessions
- Records 100% of sessions with errors
- Visual playback of user actions
- See exactly what the user saw when error occurred

---

## Understanding Sentry Alerts

### Email Notifications

When an error occurs, you'll receive an email like:

```
🚨 New Issue in EDDM Campaign Planner

Webhook failed with status 500

First seen: 2 minutes ago
Count: 3 events
Users affected: 2

View Issue: https://sentry.io/issues/123456
```

**Click "View Issue"** to see:
- Full error stack trace
- User actions leading up to error
- User info (email, company)
- Browser/device details
- Session replay (if available)

### Sentry Dashboard

**Issues Tab:**
- All errors grouped by type
- Sorted by frequency and impact
- Mark as resolved, ignore, or assign to team member

**Performance Tab:**
- Slow API calls
- Long page loads
- Performance trends over time

**Replays Tab:**
- Watch sessions with errors
- See exactly what user experienced

---

## Error Types You'll See

### 1. API Failures
**Example:** `Failed to fetch routes from USPS`

**What to check:**
- Is USPS API down?
- Is Netlify function working?
- Network issues?

**Sentry shows:**
- Which ZIP code failed
- API response status
- User's location/network

### 2. Webhook Failures
**Example:** `Webhook failed with status 500`

**What to check:**
- Is Zapier/Make working?
- Webhook URL correct?
- Webhook accepting JSON?

**Sentry shows:**
- Lead data that failed to send
- User's quote details
- Whether localStorage backup worked

### 3. Google Maps Errors
**Example:** `Google Maps failed to load`

**What to check:**
- API key valid and restricted correctly?
- Billing enabled?
- Daily quota exceeded?

**Sentry shows:**
- Which map operation failed
- User's search query
- Browser console logs

### 4. React Component Crashes
**Example:** `Cannot read property 'coordinates' of undefined`

**What to check:**
- Missing data validation?
- Unexpected API response format?
- Edge case not handled?

**Sentry shows:**
- Component stack trace
- Props/state at time of error
- User actions before crash

---

## Testing Error Monitoring

### Test 1: Trigger Test Error

Add this to your browser console on the live site:
```javascript
Sentry.captureException(new Error('Test error from EDDM Campaign Planner'));
```

**Expected:**
- Error appears in Sentry dashboard within seconds
- You receive email notification
- Error shows your user context

### Test 2: Test Error Boundary

Add this temporarily to `EDDMMapper.js` (remove after testing):
```javascript
// Inside the component
if (routes.length > 0) {
  throw new Error('Testing error boundary');
}
```

**Expected:**
- User sees friendly error page (not white screen)
- Error reported to Sentry
- User can click "Report Feedback" or "Reload Page"

### Test 3: Test Breadcrumbs

1. Search for a ZIP code
2. Select a route
3. Submit quote form
4. Trigger an error
5. Check Sentry issue

**Expected breadcrumbs:**
```
- ZIP search initiated
- Route selected
- Quote form submitted
- Error occurred
```

---

## Production Checklist

Before going live with Sentry:

- [ ] REACT_APP_SENTRY_DSN added to Netlify
- [ ] Test error captured successfully
- [ ] Email notifications working
- [ ] Sentry dashboard accessible
- [ ] Team members invited to Sentry project
- [ ] Alert rules configured (Slack, email, etc.)
- [ ] Performance monitoring enabled (optional)
- [ ] Session replay enabled (optional)

---

## Advanced Configuration

### Custom Alert Rules

In Sentry dashboard:
1. **Settings** → **Alerts**
2. Create alert rules like:
   - "Alert if error count > 10 in 1 hour"
   - "Alert if new issue appears"
   - "Alert if error affects > 5 users"

### Slack Integration

1. Sentry dashboard → **Settings** → **Integrations**
2. Add **Slack** integration
3. Configure channel: `#engineering` or `#alerts`
4. Choose notification triggers:
   - New issues
   - Resolved issues
   - Performance alerts

### Release Tracking

To track which deployment caused errors:

```bash
# In your build process or Netlify post-deploy hook
npx @sentry/cli releases new "$(git rev-parse HEAD)"
npx @sentry/cli releases set-commits "$(git rev-parse HEAD)" --auto
npx @sentry/cli releases finalize "$(git rev-parse HEAD)"
```

This lets you:
- See which commit introduced a bug
- Track error rates per deployment
- Auto-resolve errors when fixed

### Source Maps

To see original source code in stack traces (not minified):

1. Add to `package.json`:
```json
{
  "scripts": {
    "build": "GENERATE_SOURCEMAP=true react-scripts build"
  }
}
```

2. Upload source maps after build:
```bash
npx @sentry/cli sourcemaps upload --release "$(git rev-parse HEAD)" ./build/static/js
```

---

## Troubleshooting

### "Sentry disabled in development mode"

**This is expected.** Sentry only runs in production (`NODE_ENV=production`).

**To test locally:**
```bash
REACT_APP_SENTRY_DSN=your-dsn NODE_ENV=production npm start
```

### "Sentry DSN not configured"

**Problem:** Environment variable missing or misnamed.

**Solution:**
1. Check Netlify environment variables
2. Variable must be named **exactly:** `REACT_APP_SENTRY_DSN`
3. Redeploy after adding variable

### No Errors Showing in Sentry

**Possible causes:**
1. DSN not configured → Check env vars
2. beforeSend filter blocking errors → Check `src/sentry.js` filters
3. Error happened in development → Sentry disabled
4. Ad blocker blocking Sentry → Test in incognito mode

### Too Many Errors

**Problem:** Sentry quota filling up quickly.

**Solutions:**
1. **Increase sampleRate** in `src/sentry.js`:
   ```javascript
   sampleRate: 0.5, // Only capture 50% of errors
   ```

2. **Add filters** to ignore noise:
   ```javascript
   ignoreErrors: [
     'ResizeObserver',
     'NetworkError',
     // Add patterns here
   ]
   ```

3. **Upgrade Sentry plan** for higher quota

---

## Cost & Quotas

### Free Plan
- **Errors:** 5,000/month
- **Performance:** 10,000 transactions/month
- **Replays:** 50 session hours/month
- **Retention:** 30 days

**Enough for:** Small sites (<1000 users/month)

### Team Plan ($26/month)
- **Errors:** 50,000/month
- **Performance:** 100,000 transactions/month
- **Replays:** 500 session hours/month
- **Retention:** 90 days

**Good for:** Growing sites (1000-10,000 users/month)

### Reducing Quota Usage

1. **Lower sample rates:**
   ```javascript
   sampleRate: 0.5, // Capture 50% of errors
   tracesSampleRate: 0.1, // Monitor 10% of performance
   ```

2. **Filter noise:**
   ```javascript
   ignoreErrors: ['Extension error', 'Ad blocker']
   ```

3. **Archive old issues:**
   - Sentry dashboard → Issues → Bulk actions → Archive

---

## Best Practices

### 1. Act on Errors Quickly

When you see an error in Sentry:
1. **Assess severity:** How many users affected?
2. **Reproduce:** Can you trigger it locally?
3. **Fix:** Push hotfix if critical
4. **Mark resolved:** Close issue when fixed

### 2. Use Sentry Context

Add custom context for debugging:
```javascript
Sentry.setContext('campaign', {
  routesSelected: selectedRoutes.length,
  totalAddresses: pricing.addresses,
  deliveryType: deliveryType
});
```

### 3. Don't Log Sensitive Data

Sentry automatically masks:
- Credit card numbers
- Passwords
- Auth tokens

But **avoid logging:**
- Full addresses
- Phone numbers (use hash instead)
- Payment info

### 4. Set Up Alerts Wisely

**Don't:** Alert on every error (email overload)

**Do:** Alert on:
- Critical errors (payment, API failures)
- High-frequency errors (> 10/hour)
- New issues (never seen before)

### 5. Monitor Trends

Weekly review:
- Which errors are most common?
- Are errors increasing or decreasing?
- Which browsers/devices have most errors?
- What's the performance trend?

---

## Support Resources

- **Sentry Docs:** https://docs.sentry.io
- **React Guide:** https://docs.sentry.io/platforms/javascript/guides/react/
- **Community Forum:** https://forum.sentry.io
- **Status Page:** https://status.sentry.io

---

## Integration Summary

**What's Already Integrated:**
✅ Sentry SDK installed
✅ Error boundary with fallback UI
✅ User action breadcrumbs
✅ API error tracking
✅ Webhook failure monitoring
✅ User context (email, company)
✅ Performance monitoring
✅ Session replay

**What You Need to Do:**
1. Create Sentry project (5 min)
2. Add DSN to Netlify env vars (2 min)
3. Deploy and test (3 min)

**Total setup time: 10 minutes**

Once configured, Sentry runs automatically. You'll receive alerts when errors occur, and you can debug with full context.
