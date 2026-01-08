# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EDDM Campaign Planner - A React application for Mail Processing Associates (MPA) that allows clients to plan USPS Every Door Direct Mail campaigns. Users can search for carrier routes by ZIP code or address radius, visualize routes on Google Maps, view demographics, get instant pricing estimates, and submit quote requests.

## Commands

```bash
# Install dependencies
npm install

# Development server (http://localhost:3000)
npm start

# Production build (outputs to build/)
npm run build

# Run tests
npm test
```

## Environment Variables

Copy `.env.example` to `.env` and configure:
- `REACT_APP_GOOGLE_MAPS_API_KEY` - Google Maps API key (requires Maps JavaScript API and Places API enabled)
- `REACT_APP_ZAPIER_WEBHOOK_URL` - Webhook endpoint for lead capture (optional)

## Architecture

### Main Application Flow
- `src/App.js` - Root component, wraps EDDMMapper in ErrorBoundary
- `src/components/EDDMMapper/EDDMMapper.js` - Main EDDM planning tool (1900+ lines)

### EDDMMapper Component Structure
The EDDMMapper is the primary component handling:
1. **Route Search** - ZIP code search or address-based radius search
2. **Map Visualization** - Google Maps with Polygon/Polyline overlays for USPS routes
3. **Route Selection** - Click-to-select routes with demographic filtering (all/residential/business)
4. **Pricing Calculator** - Tiered pricing based on quantity with volume discounts
5. **Quote Form** - Lead capture modal with design file upload option
6. **ROI Calculator** - Modal showing projected campaign ROI by industry

### Backend API
- `netlify/functions/eddm-routes.js` - Netlify Function that proxies requests to USPS EDDM API (avoids CORS)
- USPS API endpoint: `https://gis.usps.com/arcgis/rest/services/EDDM/selectZIP/GPServer/routes/execute`

### Key Data Flow
1. User enters ZIP or address with radius
2. For radius search: Google Geocoding API finds nearby ZIP codes via 4 cardinal direction samples
3. Netlify Function fetches USPS route data for each ZIP
4. Routes transformed to format with: coordinates (array of paths), households, residential/business counts, demographics
5. Routes filtered by `routeIntersectsRadius()` for coverage circle tool
6. Selected routes calculate tiered pricing via `calculateTotal()`

### Pricing Model (MPA Rates)
```javascript
// Fixed rates
POSTAGE_RATE = 0.25    // Includes drop shipping
BUNDLING_RATE = 0.035  // Fixed bundling fee

// Tiered print pricing (6.25x9 postcards)
500-999:    $0.230/piece
1000-2499:  $0.170/piece
2500-4999:  $0.120/piece
5000-9999:  $0.100/piece
10000+:     $0.089/piece
```

### ROI Calculator
`src/utils/roiCalculator.js` contains industry benchmarks for:
- Restaurant, Home Services, Retail, Real Estate, Professional Services, Healthcare
- Three scenarios per industry: baseline, typical, best-in-class
- Calculates response rates, conversion, LTV, and ROI projections

### Supporting Components
- `src/components/ROICalculator/ROICalculator.js` - Industry-specific ROI projections modal
- `src/components/CanvaClone/CanvaClone.js` - CE.SDK (IMG.LY) design editor integration (unused in main flow)
- `src/components/ErrorBoundary.js` - React error boundary with Sentry integration

### External Integrations
- Google Maps API (maps, places autocomplete, geocoding)
- Sentry (`@sentry/react`) for error tracking
- Zapier webhook for lead capture
- USPS EDDM API (via Netlify proxy)

## Deployment

Configured for Netlify deployment:
```bash
npm run build
netlify deploy --prod --dir=build
```

The build includes the Netlify Function at `netlify/functions/eddm-routes.js` for USPS API proxying.
