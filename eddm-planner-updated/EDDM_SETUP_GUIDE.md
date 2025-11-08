# EDDM Campaign Planner - Setup & Deployment Guide

## Overview

The EDDM Campaign Planner is an interactive tool that allows potential clients to:
- Search for USPS EDDM routes by ZIP code
- Visualize routes on an interactive map
- See demographic data (households, income, age, homeowner %)
- Get instant pricing estimates
- Submit quote requests with pre-qualified campaign data

This tool will **significantly increase qualified leads** for Mail Processing Associates.

---

## 1. Getting Google Maps API Key

### Step 1: Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a Project" → "New Project"
3. Name it "MPA EDDM Mapper" or similar
4. Click "Create"

### Step 2: Enable Maps JavaScript API
1. In your project, go to "APIs & Services" → "Library"
2. Search for "Maps JavaScript API"
3. Click on it and press "Enable"

### Step 3: Create API Credentials
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "API Key"
3. Copy the API key (it will look like: `AIzaSyA...`)
4. Click "Restrict Key" for security:
   - Application restrictions: HTTP referrers
   - Add your domain: `*.mailpro.org/*` and `localhost:3000/*`
   - API restrictions: Restrict to "Maps JavaScript API"

### Step 4: Enable Billing
- Google Maps requires a billing account (but includes $200/month free credit)
- For typical usage (100-500 users/month), you'll stay within free tier
- Go to "Billing" → Set up billing account

---

## 2. Local Development Setup

### Install Dependencies
```bash
npm install
```

### Configure Environment
1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` and add your Google Maps API key:
```
REACT_APP_GOOGLE_MAPS_API_KEY=AIzaSyA...your_actual_key_here
```

### Run Development Server
```bash
npm start
```

The app will open at `http://localhost:3000`

### Test the EDDM Mapper
1. Click "EDDM Campaign Planner" in the navigation
2. Enter ZIP code: **33815** or **33803** (sample data loaded)
3. Click routes on map to select them
4. View pricing estimate
5. Click "Get Detailed Quote" to test the form

---

## 3. Customizing for Your Business

### Update Pricing (EDDMMapper.js lines 118-125)

```javascript
// Current pricing (adjust to your rates)
const printingCost = totalHouseholds * 0.15; // $0.15 per piece
const postageCost = totalHouseholds * 0.196; // EDDM postage rate
const serviceFee = totalHouseholds * 0.05; // $0.05 handling fee
```

**Adjust these values** to match your actual pricing:
- Printing cost per piece (varies by size/finish)
- Current USPS EDDM postage rate
- Your service/handling fees

### Add Real EDDM Route Data

Currently using sample data for demo. To add real routes:

**Option A: USPS Every Door Direct Mail API**
1. Sign up at: https://www.usps.com/business/web-tools-apis/
2. Use the EDDM Mapping Tool API
3. Replace `SAMPLE_ROUTES` object with API calls

**Option B: Use Third-Party Data Services**
- Melissa Data (https://www.melissa.com/)
- Mailers+Online (paid service with embeddable widgets)
- AccuZIP (https://www.accuzip.com/)

**Option C: Manual Data Entry**
For your most common service areas, manually add route data:
```javascript
const SAMPLE_ROUTES = {
  '33815': [
    {
      id: 'C001',
      name: 'Route C001',
      coordinates: [...], // Get from USPS EDDM Tool
      households: 1247,
      avgIncome: 65000,
      avgAge: 42,
      homeowners: 78
    }
  ]
}
```

### Update Branding

**Colors** (EDDMMapper.css):
```css
/* Primary color: Change #0066cc to your brand color */
background: #0066cc; /* Update throughout the file */

/* Secondary color: Change #00cc66 to your secondary color */
background: #00cc66;
```

**Company Name** (App.js line 13):
```javascript
<h2 className="nav-brand">Mail Processing Associates</h2>
```

### Configure Lead Capture

Quote requests currently log to console. Connect to your CRM:

**Option A: Email Integration (Simple)**
```javascript
// In EDDMMapper.js, handleSubmitQuote function
const response = await fetch('YOUR_EMAIL_WEBHOOK_URL', {
  method: 'POST',
  body: JSON.stringify(quoteData)
});
```

**Option B: Direct CRM Integration**
- Salesforce
- HubSpot
- Zoho CRM
- Custom webhook

**Option C: Google Sheets (Quick Setup)**
Use a service like Zapier or Make.com to send form data to Google Sheets

---

## 4. Building for Production

### Build the Application
```bash
npm run build
```

This creates optimized files in the `build/` folder.

---

## 5. Embedding in Webflow

### Method 1: Embed as Iframe (Easiest)

1. **Host the built files** on:
   - Netlify (free, recommended)
   - Vercel (free)
   - Your own server
   - AWS S3 + CloudFront

2. **In Webflow:**
   - Add an "Embed" component
   - Paste this code:
   ```html
   <iframe
     src="https://your-app-url.netlify.app"
     width="100%"
     height="900px"
     frameborder="0"
     style="border: none; border-radius: 12px;"
   ></iframe>
   ```

### Method 2: Direct Embed (Better UX)

1. **In Webflow**, create a new page: `/campaign-planner`

2. Add a **Custom Code** element (HTML Embed):
```html
<div id="eddm-root"></div>
<script src="https://your-app-url.netlify.app/static/js/bundle.js"></script>
<link rel="stylesheet" href="https://your-app-url.netlify.app/static/css/main.css">
```

3. The EDDM mapper will load directly in your Webflow page

### Method 3: Standalone Page (Recommended)

1. Deploy to subdomain: `planner.mailpro.org`
2. Link to it from your main Webflow site
3. Benefits:
   - Faster loading
   - Easier to update
   - Better performance tracking
   - Can use custom domain

---

## 6. Deploying to Netlify (Recommended)

### One-Time Setup

1. Create account at https://www.netlify.com (free)

2. Install Netlify CLI:
```bash
npm install -g netlify-cli
```

3. Login:
```bash
netlify login
```

4. Deploy:
```bash
npm run build
netlify deploy --prod --dir=build
```

5. Netlify will give you a URL like: `https://mpa-eddm-planner.netlify.app`

6. (Optional) Add custom domain:
   - In Netlify dashboard → Domain Settings
   - Add `planner.mailpro.org`
   - Update your DNS records as instructed

### Continuous Deployment (Automatic Updates)

1. Push your code to GitHub
2. In Netlify, connect your repository
3. Set build command: `npm run build`
4. Set publish directory: `build`
5. Every push to GitHub auto-deploys!

---

## 7. Tracking Performance

### Add Google Analytics

In `public/index.html`, add before `</head>`:
```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### Track Quote Submissions

In `EDDMMapper.js`, add to `handleSubmitQuote`:
```javascript
// Track conversion
if (window.gtag) {
  window.gtag('event', 'quote_request', {
    value: pricing.total,
    households: pricing.households,
    routes: selectedRoutes.length
  });
}
```

### Monitor These Metrics:
- Tool page views
- Time spent on page
- Routes selected (avg per session)
- Quote request conversion rate
- Cost per quote request

---

## 8. Going Live Checklist

- [ ] Google Maps API key configured and restricted
- [ ] Pricing calculator uses your actual rates
- [ ] Branding colors updated
- [ ] Lead capture connected to email/CRM
- [ ] Google Analytics installed
- [ ] Built and deployed to hosting
- [ ] Tested on desktop and mobile
- [ ] Embedded in Webflow (or linked from main site)
- [ ] Added to navigation menu
- [ ] Promoted in email signature, social media, ads

---

## 9. Next Steps to Enhance

### Phase 2 Features (4-6 weeks):
1. **Real USPS Route Data Integration**
   - Connect to USPS API for live route data
   - Expand beyond sample ZIP codes

2. **User Accounts**
   - Save campaigns
   - View quote history
   - Reorder previous campaigns

3. **Design Integration**
   - Link EDDM planner to your Design Studio
   - Pre-populate designer with EDDM postcard template

4. **Advanced Analytics**
   - Show projected response rates by industry
   - ROI calculator with industry benchmarks
   - A/B testing recommendations

5. **Multi-Location Support**
   - Draw custom areas (not just USPS routes)
   - Radius targeting
   - Upload custom mailing lists

---

## 10. Support & Maintenance

### Updating Route Data
- Review quarterly for new USPS routes
- Update demographic data annually

### Monitoring Costs
- Google Maps: ~$7 per 1,000 map loads (after free $200/month)
- Typical cost: $10-30/month for small business

### Troubleshooting

**Map not loading?**
- Check API key in `.env`
- Verify Maps JavaScript API is enabled
- Check browser console for errors

**Routes not showing?**
- Verify ZIP code has data in `SAMPLE_ROUTES`
- Check coordinates are valid lat/lng

**Form not submitting?**
- Check `handleSubmitQuote` function
- Verify webhook/email endpoint is working
- Check browser console for errors

---

## 11. Estimated ROI

### Cost to Implement:
- Google Maps API: $0-30/month
- Hosting (Netlify): $0 (free tier sufficient)
- Your time to configure: 2-4 hours
- **Total Monthly Cost: $0-30**

### Expected Return:
If this tool generates just **1 new client per month** at $10K average project value:
- **Annual New Revenue: $120,000**
- **ROI: 400,000%+**

More realistic: 5-10 qualified leads/month, 20% close rate = 1-2 new clients/month

---

## Questions or Issues?

This is a working MVP. As you use it, you'll discover what features your customers want most. Track usage and iterate!

**Quick Wins:**
1. Get it live (even with sample data) - validates concept
2. Share link with 5-10 existing clients - get feedback
3. Add one real ZIP code area you service often
4. Monitor quote requests for 30 days
5. Expand based on actual usage patterns

Let's get this deployed and start generating leads!
