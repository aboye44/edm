# Webhook Setup Guide for EDDM Campaign Planner

## 🚨 CRITICAL: This is Required for Production

Without a configured webhook, **quote requests will only be saved to browser localStorage** and will not reach you. This means **lost leads and lost revenue**.

---

## Quick Setup (5 Minutes)

### Option 1: Zapier (Recommended - No Code Required)

**Zapier connects your EDDM tool to your CRM, email, or Google Sheets automatically.**

#### Step 1: Create a Zap

1. Go to [https://zapier.com](https://zapier.com) and sign up (free plan works!)
2. Click **"Create Zap"**
3. For the **Trigger**:
   - Search for **"Webhooks by Zapier"**
   - Choose **"Catch Hook"**
   - Click **Continue**
4. **Copy the webhook URL** Zapier provides (looks like: `https://hooks.zapier.com/hooks/catch/123456/abcdef/`)

#### Step 2: Add Webhook URL to Netlify

1. Go to your Netlify dashboard
2. Select your EDDM site
3. Go to **Site settings** → **Environment variables**
4. Click **"Add a variable"**
   - **Key:** `REACT_APP_ZAPIER_WEBHOOK_URL`
   - **Value:** Paste the webhook URL from Zapier
5. Click **"Save"**
6. **Trigger a new deploy** (Site overview → Deploys → Trigger deploy)

#### Step 3: Configure What Happens with Leads

Back in Zapier, after setting up the trigger:

1. Click **"Test trigger"** → Submit a test quote from your EDDM tool → Click **"Continue"**
2. **Add an Action** (what to do with each lead):

**Popular Actions:**

- **Send Email** (Gmail, Outlook, SendGrid)
  - To: your-email@company.com
  - Subject: "New EDDM Quote Request from {firstName} {lastName}"
  - Body: Include all lead details

- **Add to Google Sheets**
  - Spreadsheet: "EDDM Leads"
  - Row: firstName, lastName, email, phone, company, estimatedTotal, timestamp

- **Create CRM Lead** (Salesforce, HubSpot, Pipedrive)
  - Map fields: firstName → First Name, email → Email, etc.

- **Send Slack Notification**
  - Channel: #sales
  - Message: "🎯 New quote request: {firstName} {lastName} from {company} - ${estimatedTotal}"

3. **Test your Zap** → **Turn on**

Done! Every quote request now reaches you instantly.

---

### Option 2: Make.com / Integromat (Zapier Alternative)

1. Go to [https://www.make.com](https://www.make.com)
2. Create a new scenario
3. Add **"Webhooks"** → **"Custom webhook"**
4. Copy the webhook URL
5. Add to Netlify environment variables (same as Zapier)
6. Add actions (Google Sheets, Email, CRM, etc.)

---

### Option 3: Custom Webhook Endpoint (For Developers)

If you have your own backend:

```javascript
// Example Express.js endpoint
app.post('/api/eddm-leads', async (req, res) => {
  const leadData = req.body;

  // Validate lead data
  if (!leadData.email || !leadData.phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Save to your database
  await db.leads.create(leadData);

  // Send notification email
  await sendEmail({
    to: 'sales@yourcompany.com',
    subject: `New EDDM Quote: ${leadData.company}`,
    body: formatLeadEmail(leadData)
  });

  // Respond with success
  res.json({ success: true, leadId: leadData.id });
});
```

**Requirements:**
- Must accept POST requests
- Must accept `Content-Type: application/json`
- Should respond with JSON
- Timeout: Requests timeout after 10 seconds

**Lead Data Structure:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "(555) 123-4567",
  "company": "ABC Restaurant",
  "postcardSize": "6.25\" x 9\" (Standard)",
  "paperStock": "100# Gloss Cover (Most Common)",
  "printingOptions": "Full Color Both Sides (most common)",
  "timeline": "This month",
  "goals": "Generate new customers",
  "routeIds": ["33815-C001", "33815-C002"],
  "routeNames": "C001 (ZIP 33815), C002 (ZIP 33815)",
  "totalAddresses": 2450,
  "deliveryType": "all",
  "printCost": "490.00",
  "postageCost": "612.50",
  "bundlingCost": "85.75",
  "printRate": 0.20,
  "pricingTier": "Printing @ $0.20/piece",
  "estimatedTotal": "1188.25",
  "timestamp": "2025-11-06T18:30:00.000Z",
  "id": "lead-1730918400000"
}
```

---

## Testing Your Webhook

### 1. Local Testing

```bash
# Run the dev server
npm start

# Submit a test quote
# Check browser console for:
# ✅ "Webhook success" → Working!
# ❌ "Webhook error" → Check URL and configuration
```

### 2. Production Testing

1. Deploy to Netlify with webhook URL configured
2. Submit a test quote from your live site
3. Check:
   - Zapier dashboard → "Task History" → Should show new task
   - Your email/Sheets/CRM → Should receive the lead
   - Browser console → Should show "✅ Webhook success"

---

## Troubleshooting

### "No webhook URL configured - using localStorage only"

**Problem:** Environment variable not set or named incorrectly.

**Solution:**
1. Check Netlify environment variables
2. Variable must be named **exactly:** `REACT_APP_ZAPIER_WEBHOOK_URL`
3. Redeploy after adding the variable

### "Webhook failed with status 400/500"

**Problem:** Webhook endpoint rejected the request.

**Solution:**
- **Zapier:** Make sure the Zap is turned ON
- **Custom endpoint:** Check server logs for errors
- **Make.com:** Verify the scenario is active

### "Request timeout"

**Problem:** Webhook took longer than 10 seconds to respond.

**Solution:**
- Check webhook service status
- Test webhook URL directly with a tool like Postman
- Consider using async processing if webhook is slow

### "Leads in localStorage but not webhook"

**Problem:** This is the **graceful fallback** working. Webhook failed but user wasn't blocked.

**Solution:**
1. Check browser console for specific error
2. Fix webhook configuration
3. Retrieve leads from localStorage:
   ```javascript
   // In browser console
   JSON.parse(localStorage.getItem('eddm-leads'))
   ```
4. Manually enter them into your CRM

---

## Advanced: Multiple Webhooks

If you want to send leads to multiple places:

```javascript
// In handleSubmitQuote, add after the main webhook:

// Send to secondary webhook (e.g., analytics)
if (process.env.REACT_APP_ANALYTICS_WEBHOOK_URL) {
  fetch(process.env.REACT_APP_ANALYTICS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'quote_request',
      value: leadData.estimatedTotal,
      user: leadData.email
    })
  }).catch(err => console.warn('Analytics webhook failed:', err));
}
```

---

## Security Best Practices

### 1. Use HTTPS Only

Webhook URLs should always use `https://` (Zapier/Make use HTTPS by default).

### 2. Validate Webhook Responses

The code checks `response.ok` to ensure the webhook succeeded.

### 3. Don't Expose Sensitive Data in URLs

Never include API keys or passwords in the webhook URL itself.

### 4. Rate Limiting

If using a custom endpoint, implement rate limiting to prevent abuse:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.post('/api/eddm-leads', limiter, async (req, res) => {
  // Your webhook logic
});
```

---

## Production Checklist

Before going live, ensure:

- [ ] Webhook URL added to Netlify environment variables
- [ ] Test quote submitted successfully
- [ ] Lead received in destination (email/Sheets/CRM)
- [ ] Browser console shows "✅ Webhook success"
- [ ] localStorage fallback tested (disable webhook temporarily)
- [ ] Notification emails/Slack messages working
- [ ] Team knows how to access new leads

---

## Support

If you encounter issues not covered here:

1. Check browser console for detailed error messages
2. Check Netlify build logs: `Site settings → Build & deploy → Build logs`
3. Check Zapier task history for failed tasks
4. Verify webhook URL is correct (no trailing slash, correct protocol)

**Remember:** Even if webhook fails, leads are saved to localStorage as a backup. You won't lose leads, but you need webhook for real-time notifications.
