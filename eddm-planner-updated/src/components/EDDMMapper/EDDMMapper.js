import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { GoogleMap, LoadScript, Polygon, Polyline, Marker, Circle, Autocomplete, DrawingManager } from '@react-google-maps/api';
import * as Sentry from '@sentry/react';
import ROICalculator from '../ROICalculator/ROICalculator';
import './EDDMMapper.css';

// Google Maps libraries to load
const GOOGLE_MAPS_LIBRARIES = ['places', 'drawing'];

// Netlify Function endpoint for fetching EDDM routes (proxies USPS API to avoid CORS)
const EDDM_API_ENDPOINT = '/.netlify/functions/eddm-routes';

// Calculate distance between two lat/lng points in miles using Haversine formula
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Check if a route polygon intersects with or is contained within a radius circle
// This is more accurate than just checking the center point
const routeIntersectsRadius = (route, circleCenterLat, circleCenterLng, radiusMiles) => {
  // Check all path segments in the route (routes can have multiple paths)
  for (const path of route.coordinates) {
    // Check if ANY point in the path is within the radius
    for (const point of path) {
      const distance = calculateDistance(
        circleCenterLat,
        circleCenterLng,
        point.lat,
        point.lng
      );
      if (distance <= radiusMiles) {
        return true; // At least one point is within radius
      }
    }
  }

  // Also check if circle center is inside the route polygon
  // (for cases where route surrounds the circle but no polygon points are inside)
  // This is a simple point-in-polygon check for the circle center
  const centerDistance = calculateDistance(
    circleCenterLat,
    circleCenterLng,
    route.centerLat,
    route.centerLng
  );

  // If route center is very close to circle center, include it
  if (centerDistance <= radiusMiles * 1.2) {
    return true;
  }

  return false;
};

// Calculate a point at a given distance and bearing from origin
const calculateDestinationPoint = (lat, lng, distanceMiles, bearingDegrees) => {
  const R = 3959; // Earth's radius in miles
  const d = distanceMiles / R; // Angular distance
  const brng = bearingDegrees * Math.PI / 180; // Convert to radians
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );

  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI
  };
};

// Format phone number as (XXX) XXX-XXXX
const formatPhoneNumber = (value) => {
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;

  let formatted = '';
  if (match[1]) {
    formatted = match[1].length === 3 ? `(${match[1]})` : match[1];
  }
  if (match[2]) {
    formatted += ` ${match[2]}`;
  }
  if (match[3]) {
    formatted += `-${match[3]}`;
  }
  return formatted.trim();
};

const getNumericAttribute = (attrs, keys) => {
  for (const key of keys) {
    const value = attrs[key];
    if (value !== undefined && value !== null && value !== '') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }
  }
  return null;
};

const defaultCenter = {
  lat: 28.0395,
  lng: -81.9498
};

// Helper function to format dates for campaign timeline
const formatTimelineDate = (daysFromNow) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Helper function to get heat map color based on household density
// Returns a color from blue (low) through green/yellow to red (high)
const getHeatMapColor = (value, min, max) => {
  if (max === min) return 'rgba(59, 130, 246, 0.6)'; // Default blue if no range

  // Normalize value to 0-1
  const normalized = (value - min) / (max - min);

  // Create gradient: Blue -> Cyan -> Green -> Yellow -> Orange -> Red
  let r, g, b;
  if (normalized < 0.25) {
    // Blue to Cyan
    const t = normalized / 0.25;
    r = 59; g = Math.round(130 + 81 * t); b = Math.round(246 - 8 * t);
  } else if (normalized < 0.5) {
    // Cyan to Green
    const t = (normalized - 0.25) / 0.25;
    r = Math.round(59 - 43 * t); g = Math.round(211 - 26 * t); b = Math.round(238 - 148 * t);
  } else if (normalized < 0.75) {
    // Green to Yellow
    const t = (normalized - 0.5) / 0.25;
    r = Math.round(16 + 228 * t); g = 185; b = Math.round(90 - 67 * t);
  } else {
    // Yellow to Red
    const t = (normalized - 0.75) / 0.25;
    r = 244; g = Math.round(185 - 78 * t); b = Math.round(23 + 84 * t);
  }

  return `rgba(${r}, ${g}, ${b}, 0.7)`;
};

// Simple point-in-polygon check (ray casting algorithm) - standalone function for use in useMemo
const isPointInPolygonSimple = (point, polygon) => {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const x = point.lat;
  const y = point.lng;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
};

function EDDMMapper() {
  const [zipCode, setZipCode] = useState('');
  const [routes, setRoutes] = useState([]);
  const [selectedRoutes, setSelectedRoutes] = useState([]);
  const [hoveredRoute, setHoveredRoute] = useState(null);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showROICalculator, setShowROICalculator] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deliveryType, setDeliveryType] = useState('all');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);

  // Coverage Circle Tool state
  const [locationAddress, setLocationAddress] = useState('');
  const [selectedRadius, setSelectedRadius] = useState(5); // Default 5 miles
  const [circleCenter, setCircleCenter] = useState(null);
  const [centerZip, setCenterZip] = useState(null); // Store center ZIP for faster initial load
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(null);
  const autocompleteRef = useRef(null);

  // Live Campaign Counter (social proof)
  const [campaignCount, setCampaignCount] = useState(47);
  const [campaignCountAnimating, setCampaignCountAnimating] = useState(false);

  // Demographic Heat Map overlay
  const [showHeatMap, setShowHeatMap] = useState(false);

  // Smart Budget Optimizer state
  const [showBudgetOptimizer, setShowBudgetOptimizer] = useState(false);
  const [targetBudget, setTargetBudget] = useState(1000);
  const [budgetOptimizing, setBudgetOptimizing] = useState(false);

  // Street View Preview state
  const [streetViewRoute, setStreetViewRoute] = useState(null);
  const [showStreetView, setShowStreetView] = useState(false);

  // Route Comparison state
  const [comparisonRoutes, setComparisonRoutes] = useState([]);
  const [showComparison, setShowComparison] = useState(false);

  // Draw on Map state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawnPolygon, setDrawnPolygon] = useState(null);
  const [drawnPolygonPath, setDrawnPolygonPath] = useState(null);
  const mapRef = useRef(null);

  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    postcardSize: '6.25" x 9" (Standard)',
    customSize: '',
    paperStock: '100# Gloss Cover (Most Common)',
    customStock: '',
    printingOptions: 'Full Color Both Sides (most common)',
    timeline: '',
    goals: '',
    designOption: 'need-design', // 'need-design' or 'have-design'
    designFile: null
  });

  // Fetch real USPS EDDM routes via Netlify Function (avoids CORS issues)
  const fetchEDDMRoutes = useCallback(async (zip, options = {}) => {
    const { clearOnError = true, setLoadingState = true } = options;

    if (setLoadingState) {
      setLoading(true);
      setError(null);
    }

    try {
      const url = `${EDDM_API_ENDPOINT}?zip=${zip}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch routes from USPS');
      }

      const data = await response.json();

      if (!data.results || !data.results[0] || !data.results[0].value || !data.results[0].value.features) {
        throw new Error('No routes found for this ZIP code');
      }

      const features = data.results[0].value.features;

      // Transform USPS data to our route format
      const transformedRoutes = features.map((feature, index) => {
        const attrs = feature.attributes;
        const paths = feature.geometry.paths;

        // Convert ALL paths to coordinates array for Google Maps
        // USPS returns [lng, lat], Google Maps expects {lat, lng}
        // Some routes have multiple path segments
        const allCoordinates = paths.map(path =>
          path.map(coord => ({
            lat: coord[1],
            lng: coord[0]
          }))
        );

        // Flatten all paths for center calculation
        const flatCoords = allCoordinates.flat();
        const centerLat = flatCoords.reduce((sum, c) => sum + c.lat, 0) / flatCoords.length;
        const centerLng = flatCoords.reduce((sum, c) => sum + c.lng, 0) / flatCoords.length;

        const averageIncome = getNumericAttribute(attrs, [
          'AVGHHINC_CY',
          'AVGHHINC_FY',
          'AVGHHINC',
          'AVG_HH_INC',
          'MEDHHINC_CY',
        ]);

        const medianAge = getNumericAttribute(attrs, [
          'MEDAGE_CY',
          'MEDAGE_FY',
          'MED_AGE',
          'MEDIANAGE',
        ]);

        return {
          id: `${zip}-${attrs.CRID_ID || index}`,
          name: attrs.CRID_ID || `Route ${index + 1}`,
          zipCode: zip,
          coordinates: allCoordinates, // Array of paths
          households: (attrs.RES_CNT || 0) + (attrs.BUS_CNT || 0),
          residential: attrs.RES_CNT || 0,
          business: attrs.BUS_CNT || 0,
          centerLat,
          centerLng,
          averageIncome,
          medianAge,
        };
      });

      // APPEND routes instead of replacing (keep routes from other ZIPs)
      setRoutes(prev => {
        // Remove any existing routes from this ZIP first
        const filtered = prev.filter(r => r.zipCode !== zip);
        return [...filtered, ...transformedRoutes];
      });

      // DON'T auto-center map here - let the calling function handle map positioning
      // This prevents jarring map jumps when using Coverage Circle Tool

      if (setLoadingState) {
        setLoading(false);
      }
    } catch (err) {
      console.error('Error fetching EDDM routes:', err);

      // Track API errors in Sentry
      Sentry.captureException(err, {
        tags: {
          errorType: 'api_failure',
          component: 'eddm_routes',
          zipCode: zip
        },
        contexts: {
          request: {
            zipCode: zip,
            endpoint: EDDM_API_ENDPOINT
          }
        }
      });

      // Only clear routes if this is a single ZIP search (clearOnError = true)
      // For multi-ZIP searches, keep existing routes from successful ZIPs
      if (clearOnError) {
        setError(err.message || 'Failed to load routes. Please try again.');
        setRoutes([]);
      }

      if (setLoadingState) {
        setLoading(false);
      }

      // Re-throw so caller can handle multi-ZIP error counting
      throw err;
    }
  }, []);

  const handleZipSearch = useCallback(async (e) => {
    e.preventDefault();
    if (zipCode && zipCode.length === 5) {
      // Track ZIP search in Sentry breadcrumbs
      Sentry.addBreadcrumb({
        category: 'user-action',
        message: 'ZIP search initiated',
        level: 'info',
        data: { zipCode }
      });

      // FIXED: Clear radius search state when switching to ZIP search mode
      console.log('Switching to ZIP search mode - clearing radius search state');
      setCircleCenter(null);
      setLocationAddress('');
      setCenterZip(null);
      setGeocodeError(null);

      // Clear existing routes from previous search
      setRoutes([]);
      setSelectedRoutes([]);

      await fetchEDDMRoutes(zipCode);

      // Center map on the ZIP code routes
      setTimeout(() => {
        setRoutes(currentRoutes => {
          if (currentRoutes.length > 0) {
            const firstRoute = currentRoutes[0];
            setMapCenter({ lat: firstRoute.centerLat, lng: firstRoute.centerLng });
          }
          return currentRoutes;
        });
      }, 100);
    } else {
      setError('Please enter a valid 5-digit ZIP code');
    }
  }, [zipCode, fetchEDDMRoutes]);

  const toggleRouteSelection = useCallback((routeId) => {
    setSelectedRoutes(prev => {
      const isRemoving = prev.includes(routeId);

      // Track route selection in Sentry
      Sentry.addBreadcrumb({
        category: 'user-action',
        message: isRemoving ? 'Route deselected' : 'Route selected',
        level: 'info',
        data: { routeId, totalSelected: isRemoving ? prev.length - 1 : prev.length + 1 }
      });

      if (isRemoving) {
        return prev.filter(id => id !== routeId);
      } else {
        return [...prev, routeId];
      }
    });
  }, []);

  const removeSelectedRoute = useCallback((routeId) => {
    setSelectedRoutes(prev => prev.filter(id => id !== routeId));
  }, []);

  // Fetch ZIP codes from points around the radius
  const fetchNearbyZipCodes = useCallback(async (centerLat, centerLng, radiusMiles, knownCenterZip = null) => {
    const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
    const zipCodes = new Set();

    // If we already know the center ZIP (from autocomplete), add it immediately
    if (knownCenterZip) {
      zipCodes.add(knownCenterZip);
      console.log('Using known center ZIP:', knownCenterZip);
    }

    // Check only 4 cardinal directions (N, E, S, W) for speed - fewer API calls
    // This catches neighboring ZIPs while being much faster than 8 directions
    const bearings = [0, 90, 180, 270];

    const promises = [];

    // Only check center if we don't already know it
    if (!knownCenterZip) {
      promises.push(
        (async () => {
          try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${centerLat},${centerLng}&key=${apiKey}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'OK' && data.results.length > 0) {
              const zipComponent = data.results[0].address_components?.find(
                component => component.types.includes('postal_code')
              );
              if (zipComponent) {
                zipCodes.add(zipComponent.long_name);
              }
            }
          } catch (err) {
            console.error('Error fetching center ZIP:', err);
          }
        })()
      );
    }

    // Edge points (at full radius) - only 4 directions
    for (const bearing of bearings) {
      promises.push(
        (async () => {
          const point = calculateDestinationPoint(centerLat, centerLng, radiusMiles, bearing);
          try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&key=${apiKey}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'OK' && data.results.length > 0) {
              const zipComponent = data.results[0].address_components?.find(
                component => component.types.includes('postal_code')
              );
              if (zipComponent) {
                zipCodes.add(zipComponent.long_name);
              }
            }
          } catch (err) {
            console.error(`Error fetching ZIP at bearing ${bearing}:`, err);
          }
        })()
      );
    }

    // Execute all requests in parallel (only 4-5 requests now)
    await Promise.all(promises);

    const uniqueZips = Array.from(zipCodes);
    console.log(`Found ${uniqueZips.length} unique ZIP codes within ${radiusMiles} mile radius:`, uniqueZips);
    return uniqueZips;
  }, []);

  // Fetch routes from multiple ZIP codes for coverage circle
  const fetchRoutesForRadius = useCallback(async (centerLat, centerLng, radiusMiles, knownCenterZip = null) => {
    setLoading(true);
    setGeocodeError(null);
    setError(null);

    // FIXED: Clear ZIP search state when switching to radius search mode
    console.log('Switching to radius search mode - clearing ZIP search state');
    setZipCode('');

    // Clear existing routes from previous search
    setRoutes([]);
    setSelectedRoutes([]);

    try {
      console.log(`🔍 Fetching routes within ${radiusMiles} miles of`, { centerLat, centerLng });

      // OPTIMIZATION: Start fetching center ZIP immediately if we know it (instant results!)
      let centerZipPromise = null;
      if (knownCenterZip) {
        console.log(`⚡ Starting instant fetch for center ZIP ${knownCenterZip}...`);
        centerZipPromise = fetchEDDMRoutes(knownCenterZip, { clearOnError: false, setLoadingState: false })
          .catch(err => {
            console.error(`Failed to fetch center ZIP ${knownCenterZip}:`, err);
            return null;
          });
      }

      // Discover all ZIP codes within radius (including center if not known)
      // This runs in parallel with center ZIP fetch above
      const zipCodesPromise = fetchNearbyZipCodes(centerLat, centerLng, radiusMiles, knownCenterZip);

      // Wait for ZIP discovery to complete
      const allZipCodes = await zipCodesPromise;

      console.log(`📍 Found ${allZipCodes.length} ZIP codes:`, allZipCodes);

      if (allZipCodes.length === 0) {
        setGeocodeError('No ZIP codes found in this area');
        setLoading(false);
        return;
      }

      // Fetch remaining ZIPs (exclude center ZIP if already fetching)
      const remainingZips = knownCenterZip
        ? allZipCodes.filter(zip => zip !== knownCenterZip)
        : allZipCodes;

      // Fetch all remaining ZIPs in parallel
      const remainingPromises = remainingZips.map(zip =>
        fetchEDDMRoutes(zip, { clearOnError: false, setLoadingState: false })
      );

      // Wait for ALL fetches to complete (center + remaining)
      const allPromises = centerZipPromise
        ? [centerZipPromise, ...remainingPromises]
        : remainingPromises;

      const results = await Promise.allSettled(allPromises);

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failCount = results.filter(r => r.status === 'rejected').length;

      console.log(`✅ Successfully loaded routes from ${successCount}/${allZipCodes.length} ZIP codes`);

      if (successCount === 0) {
        setGeocodeError(`Could not load routes from any ZIP codes in this area`);
      } else if (failCount > 0) {
        setGeocodeError(`Loaded routes from ${successCount}/${allZipCodes.length} ZIP codes (${failCount} failed)`);
      }
    } catch (err) {
      console.error('❌ Error fetching routes for radius:', err);
      setGeocodeError('Failed to load routes for this area. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [fetchNearbyZipCodes, fetchEDDMRoutes]);

  // Handle autocomplete load
  const onAutocompleteLoad = useCallback((autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  // Handle place selection from autocomplete
  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();

      if (place.geometry && place.geometry.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        setLocationAddress(place.formatted_address || '');
        setCircleCenter({ lat, lng });

        // Extract ZIP code from place result for faster initial loading
        const zipComponent = place.address_components?.find(
          component => component.types.includes('postal_code')
        );
        if (zipComponent) {
          setCenterZip(zipComponent.long_name);
          console.log('Center ZIP extracted:', zipComponent.long_name);
        } else {
          setCenterZip(null);
        }

        // Only center map if no routes exist yet (first search)
        if (routes.length === 0) {
          setMapCenter({ lat, lng });
        }

        setGeocodeError(null);

        console.log('Place selected:', { lat, lng, address: place.formatted_address });

        // DON'T auto-search - wait for user to click "Find Routes" button
      } else {
        setGeocodeError('Could not get location for this address');
      }
    }
  }, [routes.length]);

  // Find routes for the selected address (handles both autocomplete and manual entry)
  const geocodeAddress = useCallback(async (e) => {
    e.preventDefault();
    if (!locationAddress.trim()) {
      setGeocodeError('Please enter an address');
      return;
    }

    // Track coverage area search in Sentry
    Sentry.addBreadcrumb({
      category: 'user-action',
      message: 'Coverage area search initiated',
      level: 'info',
      data: { address: locationAddress, radius: selectedRadius }
    });

    setGeocoding(true);
    setGeocodeError(null);

    try {
      // If we already have coordinates from autocomplete, use them
      if (circleCenter) {
        console.log('Using existing coordinates from autocomplete:', circleCenter);
        // Pass centerZip for instant loading if available
        await fetchRoutesForRadius(circleCenter.lat, circleCenter.lng, selectedRadius, centerZip);
        setGeocoding(false);
        return;
      }

      // Otherwise, geocode the manually entered address
      const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
      const encodedAddress = encodeURIComponent(locationAddress);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

      console.log('Geocoding address:', locationAddress);
      const response = await fetch(url);
      const data = await response.json();

      console.log('Geocoding response:', data);

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;
        setCircleCenter({ lat: location.lat, lng: location.lng });

        // Extract ZIP code for faster loading
        const zipComponent = result.address_components?.find(
          component => component.types.includes('postal_code')
        );
        const extractedZip = zipComponent?.long_name || null;
        if (extractedZip) {
          setCenterZip(extractedZip);
          console.log('ZIP extracted from geocoding:', extractedZip);
        }

        // Only center map if no routes exist yet (first search)
        if (routes.length === 0) {
          setMapCenter({ lat: location.lat, lng: location.lng });
        }

        setGeocodeError(null);
        console.log('Geocoding success:', { lat: location.lat, lng: location.lng });

        // Fetch routes from all ZIP codes within the selected radius
        await fetchRoutesForRadius(location.lat, location.lng, selectedRadius, extractedZip);
      } else {
        const errorMsg = `Address not found. API Status: ${data.status}`;
        console.error('Geocoding failed:', errorMsg, data);
        setGeocodeError(errorMsg);
        setCircleCenter(null);
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setGeocodeError(`Failed to geocode address: ${err.message}`);
      setCircleCenter(null);
    } finally {
      setGeocoding(false);
    }
  }, [locationAddress, selectedRadius, fetchRoutesForRadius, routes.length, circleCenter, centerZip]);

  // Calculate routes within the selected radius
  // FIXED: Now checks if route POLYGON intersects radius, not just center point
  const routesInRadius = useMemo(() => {
    if (!circleCenter || routes.length === 0) {
      return [];
    }

    return routes.filter(route => {
      return routeIntersectsRadius(
        route,
        circleCenter.lat,
        circleCenter.lng,
        selectedRadius
      );
    });
  }, [circleCenter, routes, selectedRadius]);

  // Calculate total addresses in radius
  const addressesInRadius = useMemo(() => {
    return routesInRadius.reduce((sum, route) => {
      if (deliveryType === 'residential') {
        return sum + route.residential;
      }
      if (deliveryType === 'business') {
        return sum + route.business;
      }
      return sum + route.households;
    }, 0);
  }, [routesInRadius, deliveryType]);

  // Re-fetch routes when radius changes (if we have a center point)
  useEffect(() => {
    if (circleCenter) {
      console.log(`Radius changed to ${selectedRadius} miles, re-fetching routes...`);
      fetchRoutesForRadius(circleCenter.lat, circleCenter.lng, selectedRadius, centerZip);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRadius]); // Only re-fetch when radius changes, not when center changes

  const filteredRoutes = useMemo(() => {
    let filtered = routes;

    // First filter by delivery type
    if (deliveryType === 'residential') {
      filtered = filtered.filter(route => route.residential > 0);
    } else if (deliveryType === 'business') {
      filtered = filtered.filter(route => route.business > 0);
    }

    // If coverage circle is active, ONLY show routes with centroid inside radius
    // If coverage circle is active (and no drawn polygon), filter by radius
    if (circleCenter && !drawnPolygonPath) {
      const routeIdsInRadius = new Set(routesInRadius.map(r => r.id));
      filtered = filtered.filter(route => routeIdsInRadius.has(route.id));
    }

    // If polygon is drawn, filter to only routes within the polygon
    // This takes priority over circle filtering
    if (drawnPolygonPath && drawnPolygonPath.length >= 3) {
      filtered = filtered.filter(route => {
        // Check if route center is inside polygon
        const routeCenter = { lat: route.centerLat, lng: route.centerLng };
        return isPointInPolygonSimple(routeCenter, drawnPolygonPath);
      });
    }

    return filtered;
  }, [routes, deliveryType, circleCenter, routesInRadius, drawnPolygonPath]);

  // AI Route Recommender - memoize top 20% route IDs for performance
  const aiRecommendedRouteIds = useMemo(() => {
    if (filteredRoutes.length === 0) return new Set();
    const sortedByHouseholds = [...filteredRoutes].sort((a, b) => b.households - a.households);
    const top20PercentCount = Math.max(1, Math.ceil(sortedByHouseholds.length * 0.2));
    const topRoutes = sortedByHouseholds.slice(0, top20PercentCount);
    return new Set(topRoutes.map(r => r.id));
  }, [filteredRoutes]);

  // Heat map bounds - calculate min/max households for color normalization
  const heatMapBounds = useMemo(() => {
    if (routes.length === 0) return { min: 0, max: 1 };
    const households = routes.map(r => r.households);
    return {
      min: Math.min(...households),
      max: Math.max(...households)
    };
  }, [routes]);

  useEffect(() => {
    setSelectedRoutes(prev => {
      const filtered = prev.filter(id => filteredRoutes.some(route => route.id === id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [filteredRoutes]);

  // Live campaign counter - simulates real-time social proof
  useEffect(() => {
    // Randomly increment the counter every 15-45 seconds to simulate activity
    const interval = setInterval(() => {
      const shouldIncrement = Math.random() > 0.3; // 70% chance to increment
      if (shouldIncrement) {
        setCampaignCountAnimating(true);
        setCampaignCount(prev => prev + 1);
        // Reset animation flag after animation completes
        setTimeout(() => setCampaignCountAnimating(false), 600);
      }
    }, Math.random() * 30000 + 15000); // Random interval between 15-45 seconds

    return () => clearInterval(interval);
  }, []);

  // Select all routes within the radius (defined after filteredRoutes)
  const selectAllRoutesInRadius = useCallback(() => {
    const routeIds = filteredRoutes.map(route => route.id);
    setSelectedRoutes(routeIds);
    console.log(`Selected all ${routeIds.length} routes in radius`);
  }, [filteredRoutes]);

  // Deselect all routes
  const deselectAllRoutes = useCallback(() => {
    setSelectedRoutes([]);
    console.log('Deselected all routes');
  }, []);

  // Smart Budget Optimizer - finds optimal route combination for target budget
  // Uses a greedy algorithm that maximizes addresses per dollar
  const optimizeForBudget = useCallback((budget) => {
    if (filteredRoutes.length === 0 || budget < 100) return;

    setBudgetOptimizing(true);

    // Pricing constants (must match calculateTotal)
    const POSTAGE_RATE = 0.25;
    const BUNDLING_RATE = 0.035;
    const printPricingTiers = [
      { min: 500, max: 999, rate: 0.23 },
      { min: 1000, max: 2499, rate: 0.17 },
      { min: 2500, max: 4999, rate: 0.12 },
      { min: 5000, max: 9999, rate: 0.10 },
      { min: 10000, max: Infinity, rate: 0.089 }
    ];

    // Calculate cost for a given number of addresses
    const calculateCostForAddresses = (addresses) => {
      if (addresses < 500) return addresses * (0.23 + POSTAGE_RATE + BUNDLING_RATE);
      const tier = printPricingTiers.find(t => addresses >= t.min && addresses <= t.max);
      const printRate = tier ? tier.rate : 0.089;
      return addresses * (printRate + POSTAGE_RATE + BUNDLING_RATE);
    };

    // Get addresses for a route based on delivery type
    const getRouteAddresses = (route) => {
      if (deliveryType === 'residential') return route.residential;
      if (deliveryType === 'business') return route.business;
      return route.households;
    };

    // Sort routes by value (addresses per estimated cost) - descending
    const routesWithValue = filteredRoutes.map(route => {
      const addresses = getRouteAddresses(route);
      const estimatedCost = calculateCostForAddresses(addresses);
      return {
        ...route,
        addresses,
        estimatedCost,
        valuePerDollar: addresses / estimatedCost
      };
    }).sort((a, b) => b.valuePerDollar - a.valuePerDollar);

    // Greedy selection: keep adding routes until we exceed budget
    const selectedIds = [];
    let totalAddresses = 0;
    let runningCost = 0;

    for (const route of routesWithValue) {
      const newTotal = totalAddresses + route.addresses;
      const newCost = calculateCostForAddresses(newTotal);

      if (newCost <= budget) {
        selectedIds.push(route.id);
        totalAddresses = newTotal;
        runningCost = newCost;
      }
    }

    // If we couldn't select any routes (budget too low), select just the best value route
    if (selectedIds.length === 0 && routesWithValue.length > 0) {
      selectedIds.push(routesWithValue[0].id);
    }

    setSelectedRoutes(selectedIds);
    setBudgetOptimizing(false);
    setShowBudgetOptimizer(false);

    console.log(`Budget Optimizer: Selected ${selectedIds.length} routes for ~$${runningCost.toFixed(2)} (${totalAddresses.toLocaleString()} addresses)`);
  }, [filteredRoutes, deliveryType]);

  // Toggle route for comparison
  const toggleRouteComparison = useCallback((routeId) => {
    setComparisonRoutes(prev => {
      if (prev.includes(routeId)) {
        return prev.filter(id => id !== routeId);
      }
      if (prev.length >= 3) {
        // Max 3 routes for comparison
        return [...prev.slice(1), routeId];
      }
      return [...prev, routeId];
    });
  }, []);

  // Open Street View for a route
  const openStreetView = useCallback((route) => {
    setStreetViewRoute(route);
    setShowStreetView(true);
  }, []);

  // Check if a point is inside a polygon using ray casting algorithm
  const isPointInPolygon = useCallback((point, polygon) => {
    if (!polygon || polygon.length < 3) return false;

    let inside = false;
    const x = point.lat;
    const y = point.lng;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lat;
      const yi = polygon[i].lng;
      const xj = polygon[j].lat;
      const yj = polygon[j].lng;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }, []);

  // Check if any part of a route intersects with the drawn polygon
  const routeIntersectsPolygon = useCallback((route, polygonPath) => {
    if (!polygonPath || polygonPath.length < 3) return true; // No polygon drawn, show all

    // Check if route center is inside polygon
    const routeCenter = { lat: route.centerLat, lng: route.centerLng };
    if (isPointInPolygon(routeCenter, polygonPath)) return true;

    // Check if any polygon vertex is inside any route path
    for (const path of route.coordinates) {
      for (const point of path) {
        if (isPointInPolygon(point, polygonPath)) return true;
      }
    }

    return false;
  }, [isPointInPolygon]);

  // Auto-select routes within drawn polygon when routes are loaded
  // Use a ref to track if we've already selected for this polygon
  const lastPolygonSelectedRef = React.useRef(null);

  useEffect(() => {
    if (drawnPolygonPath && drawnPolygonPath.length >= 3 && filteredRoutes.length > 0) {
      // Create a key from the polygon path to detect new polygons
      const polygonKey = drawnPolygonPath.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');

      // Only auto-select if this is a new polygon (not already processed)
      if (lastPolygonSelectedRef.current !== polygonKey) {
        lastPolygonSelectedRef.current = polygonKey;

        // filteredRoutes already contains only routes inside the polygon
        // Just select all of them
        const routeIds = filteredRoutes.map(r => r.id);
        setSelectedRoutes(routeIds);
        console.log(`Auto-selected ${routeIds.length} routes within drawn polygon`);
      }
    }
  }, [drawnPolygonPath, filteredRoutes]);

  // Handle polygon complete from DrawingManager
  const handlePolygonComplete = useCallback(async (polygon) => {
    // Remove previous polygon if exists
    if (drawnPolygon) {
      drawnPolygon.setMap(null);
    }

    // Get the path from the drawn polygon
    const path = polygon.getPath().getArray().map(latLng => ({
      lat: latLng.lat(),
      lng: latLng.lng()
    }));

    setDrawnPolygon(polygon);
    setDrawnPolygonPath(path);
    setIsDrawingMode(false);

    // Calculate polygon center and radius for fetching routes
    const lats = path.map(p => p.lat);
    const lngs = path.map(p => p.lng);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

    // Calculate radius needed to cover the polygon (in miles)
    // Use the diagonal distance from center to furthest corner
    const maxDistanceMiles = Math.max(...path.map(p => {
      const dLat = (p.lat - centerLat) * 69; // ~69 miles per degree lat
      const dLng = (p.lng - centerLng) * 69 * Math.cos(centerLat * Math.PI / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    }));
    // Add 20% buffer and round up to nearest mile, min 3 miles
    const radiusMiles = Math.max(3, Math.ceil(maxDistanceMiles * 1.2));

    console.log(`Draw on Map: Polygon center at ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}, radius ${radiusMiles} miles`);

    // If no routes loaded, fetch routes for the drawn area
    if (routes.length === 0) {
      console.log('No routes loaded - fetching routes for drawn area...');
      setLoading(true);

      // Clear any existing circle center - we're using polygon filtering now
      setCircleCenter(null);

      try {
        // Fetch routes - this will populate the routes state
        // We use the polygon center and radius just for fetching, not for display
        await fetchRoutesForRadius(centerLat, centerLng, radiusMiles, null);

        // After routes are loaded, filteredRoutes will automatically filter by polygon
        // and useEffect will auto-select routes within the polygon
      } catch (err) {
        console.error('Failed to fetch routes for drawn area:', err);
        setError('Failed to load routes for the drawn area. Please try again.');
      } finally {
        setLoading(false);
      }
    } else {
      // Routes already loaded - just select those within polygon
      const routesInArea = filteredRoutes.filter(route => routeIntersectsPolygon(route, path));
      const routeIds = routesInArea.map(r => r.id);
      setSelectedRoutes(prev => [...new Set([...prev, ...routeIds])]);
      console.log(`Draw on Map: Selected ${routeIds.length} routes within drawn area`);
    }
  }, [drawnPolygon, filteredRoutes, routeIntersectsPolygon, routes.length, fetchRoutesForRadius]);

  // Clear drawn polygon
  const clearDrawnPolygon = useCallback(() => {
    if (drawnPolygon) {
      drawnPolygon.setMap(null);
    }
    setDrawnPolygon(null);
    setDrawnPolygonPath(null);
    lastPolygonSelectedRef.current = null; // Reset so next polygon triggers selection
  }, [drawnPolygon]);

  // Toggle drawing mode
  const toggleDrawingMode = useCallback(() => {
    if (isDrawingMode) {
      setIsDrawingMode(false);
    } else {
      clearDrawnPolygon();
      setIsDrawingMode(true);
    }
  }, [isDrawingMode, clearDrawnPolygon]);

  const calculateTotal = useCallback(() => {
    const selectedRouteData = routes.filter(r => selectedRoutes.includes(r.id));
    const totalAddresses = selectedRouteData.reduce((sum, r) => {
      if (deliveryType === 'residential') {
        return sum + r.residential;
      }
      if (deliveryType === 'business') {
        return sum + r.business;
      }
      return sum + r.households;
    }, 0);

    // MPA ACTUAL PRICING - 6.25x9 EDDM Postcards (100# Gloss Cover, 4/4)
    const POSTAGE_RATE = 0.25;      // Includes drop shipping
    const BUNDLING_RATE = 0.035;    // Fixed bundling fee

    // Tiered print pricing based on MPA's actual rates
    const printPricingTiers = [
      { min: 500, max: 999, rate: 0.23 },
      { min: 1000, max: 2499, rate: 0.17 },
      { min: 2500, max: 4999, rate: 0.12 },
      { min: 5000, max: 9999, rate: 0.10 },
      { min: 10000, max: Infinity, rate: 0.089 }
    ];

    // Find current print rate - return null if below 500 minimum
    const currentTierObj = printPricingTiers.find(
      tier => totalAddresses >= tier.min && totalAddresses <= tier.max
    );
    const printRate = currentTierObj ? currentTierObj.rate : null;

    // If below minimum (500), return special indicator
    if (!printRate) {
      return {
        addresses: totalAddresses,
        belowMinimum: true,
        minimumQuantity: 500
      };
    }

    // Calculate costs
    const printCost = totalAddresses * printRate;
    const postageCost = totalAddresses * POSTAGE_RATE;
    const bundlingCost = totalAddresses * BUNDLING_RATE;
    const totalCost = printCost + postageCost + bundlingCost;

    // Find next tier
    const currentTierIndex = printPricingTiers.findIndex(tier => tier === currentTierObj);
    const nextTierObj = currentTierIndex < printPricingTiers.length - 1
      ? printPricingTiers[currentTierIndex + 1]
      : null;

    const addressesUntilNextDiscount = nextTierObj
      ? nextTierObj.min - totalAddresses
      : 0;

    // Calculate potential savings
    let potentialSavings = 0;
    if (nextTierObj) {
      const currentTotal = totalCost;
      const nextTierPrint = nextTierObj.min * nextTierObj.rate;
      const nextTierPostage = nextTierObj.min * POSTAGE_RATE;
      const nextTierBundling = nextTierObj.min * BUNDLING_RATE;
      const nextTierTotal = nextTierPrint + nextTierPostage + nextTierBundling;
      potentialSavings = currentTotal - nextTierTotal;
    }

    return {
      addresses: totalAddresses,
      belowMinimum: false,
      printRate,
      printCost,
      postageCost,
      bundlingCost,
      total: totalCost,
      currentTier: `Printing @ $${printRate.toFixed(3)}/piece`,
      nextTier: nextTierObj ? `$${nextTierObj.rate.toFixed(3)}/piece` : null,
      addressesUntilNextDiscount,
      potentialSavings
    };
  }, [routes, selectedRoutes, deliveryType]);

  const handlePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const handleSubmitQuote = async (e) => {
    e.preventDefault();

    setSubmitting(true);
    setSubmissionError(null);

    const pricing = calculateTotal();
    const selectedRouteData = routes.filter(r => selectedRoutes.includes(r.id));

    const leadData = {
      ...formData,
      routeIds: selectedRoutes,
      routeNames: selectedRouteData.map(r => `${r.name} (ZIP ${r.zipCode})`).join(', '),
      totalAddresses: pricing.addresses,
      deliveryType,
      // Only include pricing if above minimum
      ...(pricing.belowMinimum ? {
        belowMinimum: true,
        minimumQuantity: pricing.minimumQuantity
      } : {
        printCost: pricing.printCost.toFixed(2),
        postageCost: pricing.postageCost.toFixed(2),
        bundlingCost: pricing.bundlingCost.toFixed(2),
        printRate: pricing.printRate,
        pricingTier: pricing.currentTier,
        estimatedTotal: pricing.total.toFixed(2)
      }),
      designStatus: formData.designOption === 'need-design' ? 'Needs Design Services' : 'Has Print-Ready Files',
      hasDesignFile: formData.designFile ? true : false,
      designFileName: formData.designFile ? formData.designFile.name : null,
      timestamp: new Date().toISOString(),
      id: `lead-${Date.now()}`
    };

    // Track quote submission attempt in Sentry
    Sentry.addBreadcrumb({
      category: 'user-action',
      message: 'Quote form submitted',
      level: 'info',
      data: {
        company: formData.company,
        totalAddresses: pricing.addresses,
        estimatedTotal: pricing.belowMinimum ? 'Below minimum' : pricing.total,
        routesSelected: selectedRoutes.length,
        belowMinimum: pricing.belowMinimum
      }
    });

    // Set user context for error tracking
    Sentry.setUser({
      email: formData.email,
      username: `${formData.firstName} ${formData.lastName}`,
      company: formData.company
    });

    // PRODUCTION WEBHOOK INTEGRATION
    let webhookSuccess = false;
    const webhookUrl = process.env.REACT_APP_ZAPIER_WEBHOOK_URL;

    if (webhookUrl) {
      try {
        console.log('📤 Sending lead to webhook...', leadData.id);

        // If there's a design file, we'll send leadData without the file
        // File will be emailed separately (handled by Zapier)
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(leadData),
          // Timeout after 10 seconds
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
          throw new Error(`Webhook failed with status ${response.status}`);
        }

        const responseData = await response.json().catch(() => ({}));
        console.log('✅ Webhook success:', responseData);
        webhookSuccess = true;

        // If user uploaded a file, trigger email with file attachment
        if (formData.designFile) {
          console.log('📧 File uploaded - Zapier will handle email notification');
          // Note: File handling via email will be configured in Zapier
          // The webhook already knows there's a file (hasDesignFile: true)
        }

      } catch (webhookError) {
        console.error('❌ Webhook error:', webhookError);

        // Track webhook error in Sentry with context
        Sentry.captureException(webhookError, {
          tags: {
            errorType: 'webhook_failure',
            component: 'quote_submission'
          },
          contexts: {
            lead: {
              leadId: leadData.id,
              company: leadData.company,
              estimatedTotal: leadData.estimatedTotal || 'Custom quote required'
            }
          }
        });

        // Don't block user - we'll save to localStorage as fallback
        setSubmissionError('Unable to send quote request to our server. Your information has been saved locally and we\'ll follow up soon.');
      }
    } else {
      console.warn('⚠️ No webhook URL configured - using localStorage only');
    }

    // ALWAYS save to localStorage as backup/fallback
    try {
      const existingLeads = JSON.parse(localStorage.getItem('eddm-leads') || '[]');
      existingLeads.push(leadData);
      localStorage.setItem('eddm-leads', JSON.stringify(existingLeads));
      console.log('💾 Lead saved to localStorage:', leadData.id);
    } catch (storageError) {
      console.error('❌ localStorage error:', storageError);
      // If both webhook AND localStorage fail, show error
      if (!webhookSuccess) {
        setSubmissionError('Unable to save your quote request. Please try again or contact us directly.');
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);

    // Success! Show confirmation
    if (webhookSuccess) {
      if (pricing.belowMinimum) {
        alert(`✅ Quote request received!\n\nYour selection (${pricing.addresses} addresses) requires a custom quote. We'll contact you within 2 business hours with pricing options.\n\nReference ID: ${leadData.id}`);
      } else {
        alert(`✅ Quote request received!\n\nWe'll contact you within 2 business hours with final pricing and a detailed proposal.\n\nReference ID: ${leadData.id}`);
      }
    } else {
      alert(`✅ Quote request saved!\n\nYour information has been recorded. We'll contact you within 2 business hours with ${pricing.belowMinimum ? 'pricing options' : 'final pricing and a detailed proposal'}.\n\nReference ID: ${leadData.id}`);
    }

    // Reset form and close modal
    setShowQuoteForm(false);
    setSubmissionError(null);
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      company: '',
      postcardSize: '6.25" x 9" (Standard)',
      customSize: '',
      paperStock: '100# Gloss Cover (Most Common)',
      customStock: '',
      printingOptions: 'Full Color Both Sides (most common)',
      timeline: '',
      goals: '',
      designOption: 'need-design',
      designFile: null
    });
  };

  const pricing = selectedRoutes.length > 0 ? calculateTotal() : null;
  const hasSelection = Boolean(pricing);

  const audienceLabel = {
    all: 'addresses',
    residential: 'residential addresses',
    business: 'business addresses'
  };

  return (
    <LoadScript
      googleMapsApiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'}
      libraries={GOOGLE_MAPS_LIBRARIES}
    >
      <div className="eddm-mapper">
        {/* MPA Header - Premium dark glass header */}
        <header className="mpa-header">
          <div className="mpa-header-left">
            <div className="mpa-header-logo">MPA</div>
            <div className="mpa-header-tagline">Premium Direct Mail</div>
          </div>

          {/* Live Campaign Counter - Social Proof */}
          <div className={`live-campaign-counter ${campaignCountAnimating ? 'pulse' : ''}`}>
            <span className="live-counter-pulse"></span>
            <span className="live-counter-number">{campaignCount}</span>
            <span className="live-counter-text">campaigns planned this week</span>
          </div>

          <button className="mpa-header-contact" onClick={() => window.location.href = 'https://www.mailpro.org/request-a-quote'}>
            <span className="contact-icon">🎯</span>
            Need a Targeted Campaign?
          </button>
        </header>

        {/* Content wrapper - pushes below fixed header */}
        <div className="eddm-content">
          {/* Hero Section - Premium gradient background with animated orbs */}
          <section className="eddm-hero">
            <div className="hero-glow-orb hero-glow-orb-1"></div>
            <div className="hero-glow-orb hero-glow-orb-2"></div>
            <div className="hero-glow-orb hero-glow-orb-3"></div>

            <div className="hero-content">
              <div className="hero-badge">
                <span className="hero-badge-icon">⚡</span>
                USPS EDDM® Certified Partner
              </div>
              <h1>Plan Your Direct Mail Campaign</h1>
              <p className="hero-subtitle">
                Target any neighborhood in America. See real-time carrier routes, demographic data, and instant pricing.
              </p>

              {/* Trust Indicators */}
              <div className="trust-indicators">
                <div className="trust-item">
                  <span className="trust-icon">✓</span>
                  <span>Free Route Selection</span>
                </div>
                <div className="trust-item">
                  <span className="trust-icon">✓</span>
                  <span>No Minimum Order</span>
                </div>
                <div className="trust-item">
                  <span className="trust-icon">✓</span>
                  <span>Instant Quote</span>
                </div>
              </div>
            </div>
          </section>

          {/* Route Finder Card - Floating white card */}
          <div className="route-finder-container">
            <div className="route-finder-card">
              {/* ZIP Search Section */}
              <div className="finder-section">
                <div className="finder-section-icon">📍</div>
                <div className="finder-section-label">Search by ZIP</div>
                <form onSubmit={handleZipSearch}>
                  <input
                    type="text"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    placeholder="33815"
                    className="finder-input"
                    maxLength="5"
                    pattern="[0-9]{5}"
                    required
                    disabled={loading}
                  />
                  <button type="submit" className="finder-btn-blue" disabled={loading}>
                    {loading ? 'Searching...' : 'Search'}
                  </button>
                </form>
                {error && (
                  <div className="error-message">{error}</div>
                )}
              </div>

              <div className="route-finder-divider"></div>

              {/* Coverage Circle Section */}
              <div className="finder-section">
                <div className="finder-section-icon">📐</div>
                <div className="finder-section-label">Coverage Area</div>
                <form onSubmit={geocodeAddress}>
                  <Autocomplete
                    onLoad={onAutocompleteLoad}
                    onPlaceChanged={onPlaceChanged}
                    options={{
                      types: ['address'],
                      componentRestrictions: { country: 'us' }
                    }}
                  >
                    <input
                      type="text"
                      value={locationAddress}
                      onChange={(e) => setLocationAddress(e.target.value)}
                      placeholder="Enter your business address"
                      className="finder-input"
                      disabled={geocoding || loading}
                    />
                  </Autocomplete>
                  <div className="radius-row">
                    <select
                      value={selectedRadius}
                      onChange={(e) => setSelectedRadius(Number(e.target.value))}
                      className="finder-select"
                      disabled={geocoding || loading}
                    >
                      <option value={3}>3 miles</option>
                      <option value={5}>5 miles</option>
                      <option value={10}>10 miles</option>
                      <option value={15}>15 miles</option>
                    </select>
                    <button type="submit" className="finder-btn-red" disabled={geocoding || loading}>
                      {geocoding || loading ? 'Finding...' : 'Find Routes'}
                    </button>
                  </div>
                </form>
                {geocodeError && (
                  <div className="error-message">{geocodeError}</div>
                )}
                {circleCenter && routesInRadius.length > 0 && (
                  <div className="success-message">
                    ✓ Found {routesInRadius.length} routes with {addressesInRadius.toLocaleString()} addresses
                  </div>
                )}
                {circleCenter && loading && (
                  <div className="success-message">
                    Searching for routes within {selectedRadius} miles...
                  </div>
                )}
              </div>

              <div className="route-finder-divider"></div>

              {/* Draw to Select Section - NEW prominent feature */}
              <div className="finder-section finder-section-draw">
                <div className="finder-section-icon">✏️</div>
                <div className="finder-section-label">Draw to Select</div>
                <p className="finder-section-desc">Draw a custom area on the map to auto-select routes</p>
                <button
                  type="button"
                  className={`finder-btn-draw ${isDrawingMode ? 'active' : ''}`}
                  onClick={() => {
                    setIsDrawingMode(!isDrawingMode);
                    // Scroll to map
                    const mapElement = document.querySelector('.map-container');
                    if (mapElement) {
                      mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                >
                  <span className="draw-btn-icon">{isDrawingMode ? '❌' : '✏️'}</span>
                  {isDrawingMode ? 'Cancel Drawing' : 'Start Drawing'}
                </button>
                {drawnPolygonPath && (
                  <div className="success-message">
                    ✓ Custom area selected - routes in area will highlight
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Target Audience Pills - Above map */}
          <div className="audience-pills-container">
            <span className="audience-pills-label">Show:</span>
            <div className="audience-pills">
              <button
                type="button"
                className={`audience-pill ${deliveryType === 'all' ? 'active' : ''}`}
                onClick={() => setDeliveryType('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`audience-pill ${deliveryType === 'residential' ? 'active' : ''}`}
                onClick={() => setDeliveryType('residential')}
              >
                Residential
              </button>
              <button
                type="button"
                className={`audience-pill ${deliveryType === 'business' ? 'active' : ''}`}
                onClick={() => setDeliveryType('business')}
              >
                Business
              </button>
            </div>
          </div>

          {/* Sticky Selection Bar - Shows when routes selected */}
          {selectedRoutes.length > 0 && (
            <div className="selection-bar">
              <div className="selection-info">
                {selectedRoutes.length} routes | {pricing?.addresses.toLocaleString()} addresses
              </div>
              <div className="selection-pills">
                {selectedRoutes.slice(0, 5).map(routeId => {
                  const route = routes.find(r => r.id === routeId);
                  if (!route) return null;
                  return (
                    <div key={routeId} className="selection-pill">
                      {route.name}
                      <span className="selection-pill-close" onClick={() => removeSelectedRoute(routeId)}>×</span>
                    </div>
                  );
                })}
                {selectedRoutes.length > 5 && (
                  <div className="selection-pill">+{selectedRoutes.length - 5} more</div>
                )}
              </div>
              <div className="selection-clear" onClick={() => setSelectedRoutes([])}>
                Clear all
              </div>
            </div>
          )}

          {/* Map Section - Full width, edge to edge */}
          <div className={`map-wrapper ${isDrawingMode ? 'drawing-mode' : ''}`}>
            {/* Drawing Mode Banner */}
            {isDrawingMode && (
              <div className="drawing-mode-banner">
                <span className="banner-icon">✏️</span>
                Click to draw polygon points. Connect back to start to complete.
              </div>
            )}
            {/* Map Controls - Always show Draw on Map, Heat Map only when routes loaded */}
            <div className="map-controls">
                {/* Draw on Map - ALWAYS visible, prominent */}
                <button
                  className={`draw-on-map-toggle primary ${isDrawingMode ? 'active' : ''}`}
                  onClick={toggleDrawingMode}
                  title="Draw a custom area to select routes"
                >
                  <span className="draw-icon">✏️</span>
                  <span className="draw-label">{isDrawingMode ? 'Cancel Drawing' : 'Draw to Select'}</span>
                </button>
                {/* Heat Map - only when routes loaded */}
                {routes.length > 0 && (
                  <>
                    <button
                      className={`heat-map-toggle ${showHeatMap ? 'active' : ''}`}
                      onClick={() => setShowHeatMap(!showHeatMap)}
                      title="Toggle demographic density heat map"
                    >
                      <span className="heat-map-icon">🔥</span>
                      <span className="heat-map-label">{showHeatMap ? 'Hide' : 'Show'} Density Map</span>
                    </button>
                    {showHeatMap && (
                      <div className="heat-map-legend">
                        <span className="legend-label">Low</span>
                        <div className="legend-gradient"></div>
                        <span className="legend-label">High</span>
                      </div>
                    )}
                  </>
                )}
                {drawnPolygonPath && (
                  <button
                    className="clear-polygon-btn"
                    onClick={clearDrawnPolygon}
                    title="Clear drawn area"
                  >
                    <span>🗑️</span>
                    <span className="draw-label">Clear Area</span>
                  </button>
                )}
              </div>
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '650px' }}
              center={mapCenter}
              zoom={13}
              options={{
                mapTypeControl: false,
                fullscreenControl: true,
              }}
              onLoad={(map) => { mapRef.current = map; }}
            >
              {/* Drawing Manager for custom polygon selection */}
              {isDrawingMode && (
                <DrawingManager
                  drawingMode={window.google?.maps?.drawing?.OverlayType?.POLYGON}
                  onPolygonComplete={handlePolygonComplete}
                  options={{
                    drawingControl: false,
                    polygonOptions: {
                      fillColor: '#3B82F6',
                      fillOpacity: 0.3,
                      strokeColor: '#3B82F6',
                      strokeWeight: 2,
                      editable: true,
                      draggable: true,
                    },
                  }}
                />
              )}

              {/* Coverage circle and center marker */}
              {circleCenter && (
                <>
                  <Marker
                    position={circleCenter}
                    icon={{
                      path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
                      scale: 8,
                      fillColor: '#D32F2F',
                      fillOpacity: 1,
                      strokeColor: '#ffffff',
                      strokeWeight: 2,
                    }}
                  />
                  <Circle
                    center={circleCenter}
                    radius={selectedRadius * 1609.34}
                    options={{
                      fillColor: '#4A90E2',
                      fillOpacity: 0.1,
                      strokeColor: '#4A90E2',
                      strokeOpacity: 0.5,
                      strokeWeight: 2,
                    }}
                  />
                </>
              )}

              {/* When polygon is drawn, only show routes inside polygon. Otherwise show all routes */}
              {(drawnPolygonPath && drawnPolygonPath.length >= 3 ? filteredRoutes : routes).map(route => {
                const isInRadius = circleCenter && routesInRadius.some(r => r.id === route.id);
                const isSelected = selectedRoutes.includes(route.id);

                let strokeColor, fillColor, opacity, clickable;

                // Heat map mode - override colors based on household density
                if (showHeatMap && !isSelected) {
                  const heatColor = getHeatMapColor(
                    route.households,
                    heatMapBounds.min,
                    heatMapBounds.max
                  );
                  strokeColor = heatColor;
                  fillColor = heatColor;
                  opacity = 0.9;
                  clickable = true;
                } else if (circleCenter) {
                  if (isSelected) {
                    strokeColor = '#D32F2F';
                    fillColor = '#D32F2F';
                    opacity = 0.8;
                    clickable = true;
                  } else if (isInRadius) {
                    strokeColor = showHeatMap
                      ? getHeatMapColor(route.households, heatMapBounds.min, heatMapBounds.max)
                      : '#4A90E2';
                    fillColor = strokeColor;
                    opacity = 0.8;
                    clickable = true;
                  } else {
                    strokeColor = '#cccccc';
                    fillColor = '#cccccc';
                    opacity = 0.3;
                    clickable = false;
                  }
                } else {
                  if (isSelected) {
                    strokeColor = '#D32F2F';
                    fillColor = '#D32F2F';
                  } else {
                    strokeColor = showHeatMap
                      ? getHeatMapColor(route.households, heatMapBounds.min, heatMapBounds.max)
                      : '#4A90E2';
                    fillColor = strokeColor;
                  }
                  opacity = 0.8;
                  clickable = true;
                }

                return (
                  <React.Fragment key={route.id}>
                    {route.coordinates.map((path, pathIndex) => (
                      <Polyline
                        key={`${route.id}-${pathIndex}`}
                        path={path}
                        options={{
                          strokeColor,
                          strokeOpacity: hoveredRoute === route.id ? 1 : opacity,
                          strokeWeight: hoveredRoute === route.id ? 4 : 3,
                          clickable,
                        }}
                        onClick={() => clickable && toggleRouteSelection(route.id)}
                        onMouseOver={() => clickable && setHoveredRoute(route.id)}
                        onMouseOut={() => clickable && setHoveredRoute(null)}
                      />
                    ))}

                    {route.coordinates.length > 0 && route.coordinates[0].length > 2 && (
                      <Polygon
                        paths={route.coordinates}
                        options={{
                          fillColor,
                          fillOpacity: hoveredRoute === route.id ? 0.15 : (opacity * 0.1),
                          strokeColor: 'transparent',
                          strokeWeight: 0,
                          clickable,
                        }}
                        onClick={() => clickable && toggleRouteSelection(route.id)}
                        onMouseOver={() => clickable && setHoveredRoute(route.id)}
                        onMouseOut={() => clickable && setHoveredRoute(null)}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </GoogleMap>
          </div>

          {/* Targeted Mail Planner Promotion */}
          <div className="targeted-promo-banner">
            <div className="targeted-promo-content">
              <div className="targeted-promo-text">
                <span className="targeted-promo-icon">🎯</span>
                <span>Need more precise targeting? Try our <strong>Targeted Mail Planner</strong></span>
              </div>
              <a
                href="https://www.targeted.mailpro.org"
                target="_blank"
                rel="noopener noreferrer"
                className="targeted-promo-link"
              >
                Learn More →
              </a>
            </div>
          </div>

          {/* Two-Column Layout: Routes Grid + Sticky Estimate */}
          {routes.length > 0 && (
            <div className="routes-and-estimate-wrapper">
              {/* Left Column: Routes Grid (Scrollable) */}
              <div className="routes-column">
                <div className="routes-section-header">
                  <div className="routes-header-left">
                    <h2>Available Routes</h2>
                    <div className="routes-count">
                      {filteredRoutes.length} {filteredRoutes.length === 1 ? 'route' : 'routes'} available
                    </div>
                  </div>
                  {filteredRoutes.length > 0 && (
                    <div className="routes-header-actions">
                      <button
                        className="smart-budget-btn"
                        onClick={() => setShowBudgetOptimizer(true)}
                        title="Automatically select optimal routes for your budget"
                      >
                        💰 Smart Budget
                      </button>
                      {selectedRoutes.length === filteredRoutes.length ? (
                        <button
                          className="select-all-button selected"
                          onClick={deselectAllRoutes}
                          title="Deselect all routes"
                        >
                          Deselect All
                        </button>
                      ) : (
                        <button
                          className="select-all-button"
                          onClick={selectAllRoutesInRadius}
                          title="Select all routes in this area"
                        >
                          Select All ({filteredRoutes.length})
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {filteredRoutes.length === 0 ? (
                  <div className="no-routes-message">
                    <p>No routes match the selected filters. Try changing your audience type or radius.</p>
                  </div>
                ) : (
                  <>
                  <div className="routes-grid">
                    {filteredRoutes.map((route, index) => {
                      const isSelected = selectedRoutes.includes(route.id);
                      const targetedCount = deliveryType === 'residential'
                        ? route.residential
                        : deliveryType === 'business'
                          ? route.business
                          : route.households;

                      // AI Route Recommender - use memoized set for O(1) lookup
                      const isAIRecommended = aiRecommendedRouteIds.has(route.id);

                      return (
                        <div
                          key={route.id}
                          className={`route-card ${isSelected ? 'selected' : ''} ${isAIRecommended ? 'ai-recommended' : ''}`}
                          onClick={() => toggleRouteSelection(route.id)}
                          onMouseEnter={() => setHoveredRoute(route.id)}
                          onMouseLeave={() => setHoveredRoute(null)}
                        >
                          {isAIRecommended && (
                            <div className="ai-recommender-badge">
                              <span className="ai-badge-icon">✨</span>
                              <span className="ai-badge-text">AI Recommended</span>
                            </div>
                          )}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRouteSelection(route.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="route-card-checkbox"
                          />
                          <div className="route-card-badge">{route.name}</div>
                          <div className="route-card-count">{targetedCount.toLocaleString()}</div>
                          <div className="route-card-count-label">{audienceLabel[deliveryType]}</div>
                          <div className="route-card-zip">ZIP {route.zipCode}</div>
                          <div className="route-card-actions">
                            <button
                              className="route-action-btn street-view-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openStreetView(route);
                              }}
                              title="Preview neighborhood"
                            >
                              👁️
                            </button>
                            <button
                              className={`route-action-btn compare-btn ${comparisonRoutes.includes(route.id) ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRouteComparison(route.id);
                              }}
                              title="Add to comparison"
                            >
                              ⚖️
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Comparison bar - show when routes are being compared */}
                  {comparisonRoutes.length > 0 && (
                    <div className="comparison-bar">
                      <span className="comparison-bar-text">
                        {comparisonRoutes.length} route{comparisonRoutes.length > 1 ? 's' : ''} selected for comparison
                      </span>
                      <div className="comparison-bar-actions">
                        <button
                          className="compare-now-btn"
                          onClick={() => setShowComparison(true)}
                          disabled={comparisonRoutes.length < 2}
                        >
                          Compare Now
                        </button>
                        <button
                          className="clear-compare-btn"
                          onClick={() => setComparisonRoutes([])}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}
                  </>
                )}
              </div>

              {/* Right Column: Sticky Estimate Card */}
              <div className="estimate-column">
                <div className="estimate-card-sticky">
                  <h2>Campaign Estimate</h2>

                  {hasSelection ? (
                    <>
                      <div className="estimate-header">
                        <div className="estimate-header-text">
                          {selectedRoutes.length} routes | {pricing.addresses.toLocaleString()} addresses
                        </div>
                      </div>

                      {pricing.belowMinimum ? (
                        <>
                          {/* Below Minimum - Custom Quote Required */}
                          <div className="estimate-below-minimum">
                            <div className="below-minimum-icon">⚠️</div>
                            <h3>Custom Quote Required</h3>
                            <p>
                              Your selection ({pricing.addresses.toLocaleString()} addresses) is below our 
                              {pricing.minimumQuantity}-piece minimum for instant pricing.
                            </p>
                            <p className="below-minimum-cta">
                              <strong>Next step:</strong> Submit your information below and we'll prepare 
                              a custom quote within 24 hours.
                            </p>
                          </div>

                          <button className="estimate-cta" onClick={() => setShowQuoteForm(true)}>
                            REQUEST CUSTOM QUOTE
                          </button>

                          <p className="estimate-fine-print">
                            We'll provide competitive pricing options for your campaign size and reach out within 24 hours.
                          </p>
                        </>
                      ) : (
                        <>
                          {/* Above Minimum - Show Pricing */}
                          <div className="estimate-total-display">
                            <div className="estimate-label">Estimated Campaign Cost</div>
                            <div className="estimate-total-amount">
                              ${pricing.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </div>
                            <div className="estimate-includes">
                              Includes printing, postage & delivery
                            </div>
                          </div>

                          {/* Campaign Timeline Simulator - Industry-First Feature */}
                          <div className="campaign-timeline">
                            <div className="timeline-header">
                              <span className="timeline-icon">📅</span>
                              <span className="timeline-title">Campaign Timeline</span>
                              <span className="timeline-badge">Estimated Delivery</span>
                            </div>
                            <div className="timeline-steps">
                              <div className="timeline-step completed">
                                <div className="step-marker"></div>
                                <div className="step-content">
                                  <div className="step-label">{formatTimelineDate(0)}</div>
                                  <div className="step-detail">Submit your campaign</div>
                                </div>
                              </div>
                              <div className="timeline-connector"></div>
                              <div className="timeline-step">
                                <div className="step-marker"></div>
                                <div className="step-content">
                                  <div className="step-label">{formatTimelineDate(1)} - {formatTimelineDate(2)}</div>
                                  <div className="step-detail">Design & proof approval</div>
                                </div>
                              </div>
                              <div className="timeline-connector"></div>
                              <div className="timeline-step">
                                <div className="step-marker"></div>
                                <div className="step-content">
                                  <div className="step-label">{formatTimelineDate(3)} - {formatTimelineDate(5)}</div>
                                  <div className="step-detail">Print & prepare mailing</div>
                                </div>
                              </div>
                              <div className="timeline-connector"></div>
                              <div className="timeline-step final">
                                <div className="step-marker">
                                  <span className="step-icon">📬</span>
                                </div>
                                <div className="step-content">
                                  <div className="step-label">{formatTimelineDate(7)} - {formatTimelineDate(10)}</div>
                                  <div className="step-detail">Delivered to mailboxes</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {pricing.nextTier && pricing.addressesUntilNextDiscount > 0 && (
                            <div className="estimate-incentive">
                              💡 Add {pricing.addressesUntilNextDiscount.toLocaleString()} more addresses to unlock next pricing tier and save ${pricing.potentialSavings.toFixed(2)}
                            </div>
                          )}

                          {/* Urgency & Trust Section */}
                          <div className="conversion-trust-block">
                            <div className="urgency-indicator">
                              <span className="urgency-icon">🔥</span>
                              <span className="urgency-text">Lock in this price - quotes valid for 7 days</span>
                            </div>
                            <div className="trust-badges-row">
                              <span className="mini-trust-badge">✓ No upfront payment</span>
                              <span className="mini-trust-badge">✓ Free design review</span>
                            </div>
                          </div>

                          <button className="estimate-cta" onClick={() => setShowQuoteForm(true)}>
                            🚀 REQUEST FREE QUOTE
                          </button>

                          <button className="estimate-cta estimate-cta-secondary" onClick={() => setShowROICalculator(true)}>
                            💰 SEE POTENTIAL ROI
                          </button>

                          <p className="estimate-fine-print">
                            *This is an estimate only. Contact us for final pricing and custom options. Based on 6.25x9 postcard, 100# gloss cover, full color both sides.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="estimate-empty">
                      <div className="estimate-empty-icon">📍</div>
                      <p className="estimate-empty-text">Select routes on the map to see an estimate</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Sticky Estimate Bar */}
          {hasSelection && (
            <div className="mobile-estimate-bar">
              <div className="mobile-estimate-summary">
                {pricing.belowMinimum ? (
                  <>
                    <div className="mobile-estimate-value">Custom Quote</div>
                    <div className="mobile-estimate-label">Below {pricing.minimumQuantity} min • {pricing.addresses.toLocaleString()} addresses</div>
                  </>
                ) : (
                  <>
                    <div className="mobile-estimate-value">~${pricing.total.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                    <div className="mobile-estimate-label">Estimated • {selectedRoutes.length} routes, {pricing.addresses.toLocaleString()} addresses</div>
                  </>
                )}
              </div>
              <button className="mobile-estimate-btn" onClick={() => setShowQuoteForm(true)}>
                Get Quote
              </button>
            </div>
          )}

          {/* Testimonials Section - Social Proof */}
          <section className="testimonials-section">
            <div className="testimonials-header">
              <h2>Trusted by Local Businesses</h2>
              <p>See why businesses across Florida choose MPA for their direct mail campaigns</p>
            </div>
            <div className="testimonials-grid">
              <div className="testimonial-card">
                <div className="testimonial-stars">★★★★★</div>
                <p className="testimonial-text">
                  "Our EDDM campaign brought in 47 new customers in just 2 weeks. The ROI was incredible - we spent $800 and made over $12,000 in new business."
                </p>
                <div className="testimonial-author">
                  <div className="author-avatar">JR</div>
                  <div className="author-info">
                    <div className="author-name">James Rodriguez</div>
                    <div className="author-business">Rodriguez HVAC, Lakeland</div>
                  </div>
                </div>
              </div>
              <div className="testimonial-card featured">
                <div className="testimonial-badge">Most Recent</div>
                <div className="testimonial-stars">★★★★★</div>
                <p className="testimonial-text">
                  "This tool made planning our campaign so easy. We selected 15,000 homes around our location and had postcards in mailboxes within 10 days. Highly recommend!"
                </p>
                <div className="testimonial-author">
                  <div className="author-avatar">SM</div>
                  <div className="author-info">
                    <div className="author-name">Sarah Mitchell</div>
                    <div className="author-business">Mitchell's Dental, Winter Haven</div>
                  </div>
                </div>
              </div>
              <div className="testimonial-card">
                <div className="testimonial-stars">★★★★★</div>
                <p className="testimonial-text">
                  "We've done 3 campaigns with MPA now. Each one has been flawless. The pricing is transparent and the quality is top-notch."
                </p>
                <div className="testimonial-author">
                  <div className="author-avatar">MK</div>
                  <div className="author-info">
                    <div className="author-name">Mike Kim</div>
                    <div className="author-business">Kim's Auto Repair, Bartow</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Trust Bar - Navy footer */}
          <div className="trust-bar">
            <div className="trust-item">
              <div className="trust-icon">✓</div>
              <div className="trust-text">
                <div className="trust-title">USPS Approved</div>
                <div className="trust-subtitle">Real carrier route data</div>
              </div>
            </div>
            <div className="trust-item">
              <div className="trust-icon">✓</div>
              <div className="trust-text">
                <div className="trust-title">Volume Discounts</div>
                <div className="trust-subtitle">Best rates guaranteed</div>
              </div>
            </div>
            <div className="trust-item">
              <div className="trust-icon">✓</div>
              <div className="trust-text">
                <div className="trust-title">All-Inclusive</div>
                <div className="trust-subtitle">Print, postage, delivery</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showQuoteForm && (
        <div className="modal-overlay" onClick={() => setShowQuoteForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowQuoteForm(false)}>×</button>

            {/* Conversion header with urgency */}
            <div className="modal-conversion-header">
              <span className="modal-badge">📬 FREE QUOTE</span>
              <h2>You're One Step Away From Your Campaign</h2>
              <p>Complete the form below and we'll contact you within <strong>2 business hours</strong> with final pricing and a detailed proposal customized for your campaign.</p>
              <div className="modal-guarantees">
                <span className="modal-guarantee">✓ No obligation</span>
                <span className="modal-guarantee">✓ No payment required</span>
                <span className="modal-guarantee">✓ Free design consultation</span>
              </div>
            </div>

            <form onSubmit={handleSubmitQuote}>
              <h3 className="form-section-title">Contact Information</h3>

              <div className="form-row-group">
                <div className="form-row half">
                  <input
                    type="text"
                    placeholder="First Name *"
                    value={formData.firstName}
                    onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                    required
                  />
                </div>
                <div className="form-row half">
                  <input
                    type="text"
                    placeholder="Last Name *"
                    value={formData.lastName}
                    onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <input
                  type="email"
                  placeholder="Email Address *"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  required
                />
              </div>

              <div className="form-row">
                <input
                  type="tel"
                  placeholder="Phone Number * (XXX) XXX-XXXX"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  maxLength="14"
                  required
                />
              </div>

              <div className="form-row">
                <input
                  type="text"
                  placeholder="Company Name *"
                  value={formData.company}
                  onChange={(e) => setFormData({...formData, company: e.target.value})}
                  required
                />
              </div>

              <h3 className="form-section-title">Project Specifications</h3>

              <div className="form-row">
                <label className="form-label">Postcard Size *</label>
                <select
                  value={formData.postcardSize}
                  onChange={(e) => setFormData({...formData, postcardSize: e.target.value})}
                  className="form-select"
                  required
                >
                  <option value="6.25&quot; x 9&quot; (Standard)">6.25" x 9" (Standard)</option>
                  <option value="6&quot; x 11&quot;">6" x 11"</option>
                  <option value="8.5&quot; x 11&quot;">8.5" x 11"</option>
                  <option value="Custom Size">Custom Size</option>
                </select>
                {formData.postcardSize === 'Custom Size' && (
                  <input
                    type="text"
                    placeholder='Enter dimensions (e.g., 5.5" x 8.5")'
                    value={formData.customSize}
                    onChange={(e) => setFormData({...formData, customSize: e.target.value})}
                    className="form-input-sub"
                    required
                  />
                )}
              </div>

              <div className="form-row">
                <label className="form-label">Paper Stock *</label>
                <select
                  value={formData.paperStock}
                  onChange={(e) => setFormData({...formData, paperStock: e.target.value})}
                  className="form-select"
                  required
                >
                  <option value="100# Gloss Cover (Most Common)">100# Gloss Cover (Most Common)</option>
                  <option value="14pt Cardstock">14pt Cardstock</option>
                  <option value="16pt Cardstock">16pt Cardstock</option>
                  <option value="Custom Stock">Custom Stock</option>
                </select>
                {formData.paperStock === 'Custom Stock' && (
                  <input
                    type="text"
                    placeholder="Specify paper stock"
                    value={formData.customStock}
                    onChange={(e) => setFormData({...formData, customStock: e.target.value})}
                    className="form-input-sub"
                    required
                  />
                )}
              </div>

              <div className="form-row">
                <label className="form-label">Printing Options *</label>
                <select
                  value={formData.printingOptions}
                  onChange={(e) => setFormData({...formData, printingOptions: e.target.value})}
                  className="form-select"
                  required
                >
                  <option value="Full Color Both Sides (most common)">Full Color Both Sides (most common)</option>
                  <option value="Full Color Front, Black & White Back">Full Color Front, Black & White Back</option>
                  <option value="Full Color Front, Blank Back">Full Color Front, Blank Back</option>
                  <option value="Black & White Both Sides">Black & White Both Sides</option>
                  <option value="Black & White Front, Blank Back">Black & White Front, Blank Back</option>
                </select>
              </div>

              <h3 className="form-section-title">Design & Artwork</h3>

              <div className="form-row">
                <label className="form-label">Do you need design services? *</label>
                <div className="design-options-radio">
                  <label className="radio-option">
                    <input 
                      type="radio" 
                      name="designOption"
                      value="need-design" 
                      checked={formData.designOption === 'need-design'}
                      onChange={(e) => setFormData({...formData, designOption: e.target.value, designFile: null})}
                    />
                    <span className="radio-label">
                      <strong>I need design services</strong>
                      <small>Professional design based on complexity, pricing as low as $50</small>
                    </span>
                  </label>
                  <label className="radio-option">
                    <input 
                      type="radio" 
                      name="designOption"
                      value="have-design" 
                      checked={formData.designOption === 'have-design'}
                      onChange={(e) => setFormData({...formData, designOption: e.target.value})}
                    />
                    <span className="radio-label">
                      <strong>I have print-ready files</strong>
                      <small>Upload your design below (optional now, can email later)</small>
                    </span>
                  </label>
                </div>
              </div>
              
              {formData.designOption === 'have-design' && (
                <div className="form-row file-upload-section">
                  <label className="form-label">Upload Your Design (Optional)</label>
                  <input 
                    type="file" 
                    accept=".pdf,.jpg,.jpeg,.png,.ai,.psd,.eps"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      setFormData({...formData, designFile: file});
                    }}
                    className="file-input"
                  />
                  {formData.designFile && (
                    <div className="file-selected">
                      ✓ {formData.designFile.name} ({(formData.designFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                  <p className="upload-hint">
                    Accepted formats: PDF, JPG, PNG, AI, PSD, EPS • Max 25MB<br/>
                    <em>Can't upload now? No problem - just indicate you have files and email them after submitting.</em>
                  </p>
                </div>
              )}

              <div className="form-row">
                <label className="form-label">Timeline *</label>
                <select
                  value={formData.timeline}
                  onChange={(e) => setFormData({...formData, timeline: e.target.value})}
                  className="form-select"
                  required
                >
                  <option value="">Select timeline</option>
                  <option value="This month">This month</option>
                  <option value="1-2 months">1-2 months</option>
                  <option value="3+ months">3+ months</option>
                  <option value="Just exploring options">Just exploring options</option>
                </select>
              </div>

              <div className="form-row">
                <label className="form-label">Campaign Goal (Optional)</label>
                <textarea
                  placeholder="What are you trying to accomplish? (e.g., Generate leads for financial planning services)"
                  value={formData.goals}
                  onChange={(e) => setFormData({...formData, goals: e.target.value})}
                  rows="3"
                  maxLength="500"
                ></textarea>
                <div className="char-count">{formData.goals.length}/500</div>
              </div>

              {pricing && (
                <div className="quote-summary">
                  <h4>Your Campaign Selection:</h4>
                  <p><strong>{selectedRoutes.length}</strong> route(s) selected</p>
                  <p><strong>{pricing.addresses.toLocaleString()}</strong> {audienceLabel[deliveryType]}</p>
                  {pricing.belowMinimum ? (
                    <>
                      <p className="below-minimum-notice">
                        ⚠️ Below {pricing.minimumQuantity}-piece minimum - custom pricing required
                      </p>
                      <p style={{fontSize: '12px', color: '#666', marginTop: '4px'}}>
                        We'll provide competitive pricing options and reach out within 24 hours
                      </p>
                    </>
                  ) : (
                    <>
                      <p>{pricing.currentTier}</p>
                      <p className="estimate">Estimated Cost: ${pricing.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                      <p style={{fontSize: '12px', color: '#999', marginTop: '4px'}}>Final pricing will be provided in your quote</p>
                    </>
                  )}
                </div>
              )}

              {submissionError && (
                <div className="error-message" style={{marginBottom: '16px'}}>
                  {submissionError}
                </div>
              )}

              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? 'Sending Quote Request...' : 'Submit Quote Request'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Smart Budget Optimizer Modal */}
      {showBudgetOptimizer && (
        <div className="budget-optimizer-modal">
          <div className="budget-optimizer-overlay" onClick={() => setShowBudgetOptimizer(false)}></div>
          <div className="budget-optimizer-content">
            <button className="modal-close" onClick={() => setShowBudgetOptimizer(false)}>×</button>
            <div className="budget-optimizer-header">
              <span className="budget-optimizer-icon">💰</span>
              <h2>Smart Budget Optimizer</h2>
              <p className="budget-optimizer-subtitle">
                Tell us your budget and we'll automatically select the best routes to maximize your reach
              </p>
            </div>

            <div className="budget-slider-container">
              <div className="budget-display">
                <span className="budget-label">Your Budget</span>
                <span className="budget-amount">${targetBudget.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="200"
                max="10000"
                step="100"
                value={targetBudget}
                onChange={(e) => setTargetBudget(parseInt(e.target.value))}
                className="budget-slider"
              />
              <div className="budget-range-labels">
                <span>$200</span>
                <span>$10,000</span>
              </div>
            </div>

            <div className="budget-quick-select">
              <span className="quick-select-label">Quick select:</span>
              <div className="quick-select-buttons">
                {[500, 1000, 2500, 5000].map(amount => (
                  <button
                    key={amount}
                    className={`quick-select-btn ${targetBudget === amount ? 'active' : ''}`}
                    onClick={() => setTargetBudget(amount)}
                  >
                    ${amount.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <div className="budget-estimate-preview">
              <div className="estimate-item">
                <span className="estimate-label">Available Routes</span>
                <span className="estimate-value">{filteredRoutes.length}</span>
              </div>
              <div className="estimate-item">
                <span className="estimate-label">Est. Addresses</span>
                <span className="estimate-value">
                  {Math.round(targetBudget / 0.50).toLocaleString()}+
                </span>
              </div>
            </div>

            <button
              className="optimize-btn"
              onClick={() => optimizeForBudget(targetBudget)}
              disabled={budgetOptimizing || filteredRoutes.length === 0}
            >
              {budgetOptimizing ? (
                <>Optimizing...</>
              ) : (
                <>🎯 Optimize My Campaign</>
              )}
            </button>

            <p className="budget-optimizer-note">
              Our algorithm maximizes addresses per dollar by analyzing all {filteredRoutes.length} routes
              and selecting the optimal combination for your budget.
            </p>
          </div>
        </div>
      )}

      {/* Street View Preview Modal */}
      {showStreetView && streetViewRoute && (
        <div className="street-view-modal">
          <div className="street-view-overlay" onClick={() => setShowStreetView(false)}></div>
          <div className="street-view-content">
            <button className="modal-close" onClick={() => setShowStreetView(false)}>×</button>
            <div className="street-view-header">
              <h2>📍 Neighborhood Preview</h2>
              <p className="street-view-route-name">
                {streetViewRoute.name} • ZIP {streetViewRoute.zipCode}
              </p>
            </div>
            <div className="street-view-container">
              <iframe
                title="Street View"
                width="100%"
                height="400"
                style={{ border: 0, borderRadius: '8px' }}
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps/embed/v1/streetview?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&location=${streetViewRoute.centerLat},${streetViewRoute.centerLng}&heading=210&pitch=10&fov=90`}
              />
            </div>
            <div className="street-view-stats">
              <div className="sv-stat">
                <span className="sv-stat-value">{streetViewRoute.households.toLocaleString()}</span>
                <span className="sv-stat-label">Total Addresses</span>
              </div>
              <div className="sv-stat">
                <span className="sv-stat-value">{streetViewRoute.residential.toLocaleString()}</span>
                <span className="sv-stat-label">Residential</span>
              </div>
              <div className="sv-stat">
                <span className="sv-stat-value">{streetViewRoute.business.toLocaleString()}</span>
                <span className="sv-stat-label">Business</span>
              </div>
            </div>
            <div className="street-view-actions">
              <button
                className={`sv-action-btn ${selectedRoutes.includes(streetViewRoute.id) ? 'selected' : ''}`}
                onClick={() => {
                  toggleRouteSelection(streetViewRoute.id);
                }}
              >
                {selectedRoutes.includes(streetViewRoute.id) ? '✓ Selected' : '+ Add to Campaign'}
              </button>
              <a
                href={`https://www.google.com/maps/@${streetViewRoute.centerLat},${streetViewRoute.centerLng},15z`}
                target="_blank"
                rel="noopener noreferrer"
                className="sv-action-btn secondary"
              >
                Open in Google Maps ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Route Comparison Modal */}
      {showComparison && comparisonRoutes.length >= 2 && (
        <div className="comparison-modal">
          <div className="comparison-overlay" onClick={() => setShowComparison(false)}></div>
          <div className="comparison-content">
            <button className="modal-close" onClick={() => setShowComparison(false)}>×</button>
            <div className="comparison-header">
              <h2>📊 Route Comparison</h2>
              <p>Compare demographics and reach side-by-side</p>
            </div>
            <div className="comparison-table">
              <div className="comparison-row header">
                <div className="comparison-label">Metric</div>
                {comparisonRoutes.map(routeId => {
                  const route = routes.find(r => r.id === routeId);
                  return route ? (
                    <div key={routeId} className="comparison-cell">
                      <strong>{route.name}</strong>
                      <small>ZIP {route.zipCode}</small>
                    </div>
                  ) : null;
                })}
              </div>
              {[
                { label: 'Total Addresses', key: 'households' },
                { label: 'Residential', key: 'residential' },
                { label: 'Business', key: 'business' },
                { label: 'Median Age', key: 'medianAge', suffix: ' yrs' },
                { label: 'Median Income', key: 'medianIncome', prefix: '$', format: 'currency' },
                { label: 'Avg Household Size', key: 'householdSize' }
              ].map(metric => (
                <div className="comparison-row" key={metric.key}>
                  <div className="comparison-label">{metric.label}</div>
                  {comparisonRoutes.map(routeId => {
                    const route = routes.find(r => r.id === routeId);
                    if (!route) return null;
                    let value = route[metric.key];
                    if (metric.format === 'currency') {
                      value = value ? value.toLocaleString() : 'N/A';
                    } else if (typeof value === 'number') {
                      value = value.toLocaleString();
                    }
                    return (
                      <div key={routeId} className="comparison-cell">
                        {metric.prefix || ''}{value || 'N/A'}{metric.suffix || ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="comparison-actions">
              <button
                className="comparison-select-btn"
                onClick={() => {
                  // Add all comparison routes to selection
                  const newSelection = [...new Set([...selectedRoutes, ...comparisonRoutes])];
                  setSelectedRoutes(newSelection);
                  setShowComparison(false);
                }}
              >
                Add All to Campaign
              </button>
              <button
                className="comparison-clear-btn"
                onClick={() => setComparisonRoutes([])}
              >
                Clear Comparison
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROI Calculator Modal */}
      {showROICalculator && pricing && !pricing.belowMinimum && (
        <ROICalculator
          campaignCost={pricing.total}
          totalAddresses={pricing.addresses}
          onClose={() => setShowROICalculator(false)}
        />
      )}
    </LoadScript>
  );
}

export default EDDMMapper;
