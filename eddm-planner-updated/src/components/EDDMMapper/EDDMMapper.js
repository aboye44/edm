import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { GoogleMap, LoadScript, Polygon, Polyline, Marker, Circle, Autocomplete } from '@react-google-maps/api';
import * as Sentry from '@sentry/react';
import ROICalculator from '../ROICalculator/ROICalculator';
import './EDDMMapper.css';

// Google Maps libraries to load
const GOOGLE_MAPS_LIBRARIES = ['places'];

// Vercel Serverless Function endpoint for fetching EDDM routes (proxies USPS API to avoid CORS)
const EDDM_API_ENDPOINT = '/api/eddm-routes';

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

  // Lead Capture Modals State
  const [showEmailEstimate, setShowEmailEstimate] = useState(false);
  const [showSaveCampaign, setShowSaveCampaign] = useState(false);
  const [showExitIntent, setShowExitIntent] = useState(false);
  const [exitIntentShown, setExitIntentShown] = useState(false);
  const [emailEstimateData, setEmailEstimateData] = useState({ email: '' });
  const [saveCampaignData, setSaveCampaignData] = useState({ email: '', firstName: '' });

  // Coverage Circle Tool state
  const [locationAddress, setLocationAddress] = useState('');
  const [selectedRadius, setSelectedRadius] = useState(5); // Default 5 miles
  const [circleCenter, setCircleCenter] = useState(null);
  const [centerZip, setCenterZip] = useState(null); // Store center ZIP for faster initial load
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(null);
  const autocompleteRef = useRef(null);

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

      // Don't clear routes or selections - allow accumulating from multiple ZIP codes
      // Users can manually clear using the "Clear" button if needed

      await fetchEDDMRoutes(zipCode);

      // Center map on the newly searched ZIP code routes
      setTimeout(() => {
        setRoutes(currentRoutes => {
          // Find routes from the ZIP code we just searched
          const newZipRoutes = currentRoutes.filter(r => r.zipCode === zipCode);
          if (newZipRoutes.length > 0) {
            const firstRoute = newZipRoutes[0];
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

    // Don't clear routes or selections - allow accumulating from multiple searches
    // Users can manually clear using the "Clear" button if needed

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

        // Center map on the selected location
        setMapCenter({ lat, lng });

        setGeocodeError(null);

        console.log('Place selected:', { lat, lng, address: place.formatted_address });

        // DON'T auto-search - wait for user to click "Find Routes" button
      } else {
        setGeocodeError('Could not get location for this address');
      }
    }
  }, []);

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

        // Center map on the searched location
        setMapCenter({ lat: location.lat, lng: location.lng });

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
  }, [locationAddress, selectedRadius, fetchRoutesForRadius, circleCenter, centerZip]);

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
    if (circleCenter) {
      const routeIdsInRadius = new Set(routesInRadius.map(r => r.id));
      filtered = filtered.filter(route => routeIdsInRadius.has(route.id));
    }

    return filtered;
  }, [routes, deliveryType, circleCenter, routesInRadius]);

  useEffect(() => {
    setSelectedRoutes(prev => {
      const filtered = prev.filter(id => filteredRoutes.some(route => route.id === id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [filteredRoutes]);

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

  // TIER 1: Email Me Estimate - Lowest friction lead capture
  const handleEmailEstimate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmissionError(null);

    const pricing = calculateTotal();
    const selectedRouteData = routes.filter(r => selectedRoutes.includes(r.id));

    const leadData = {
      leadTier: 'email_estimate_requested',
      email: emailEstimateData.email,
      routeIds: selectedRoutes,
      routeNames: selectedRouteData.map(r => `${r.name} (ZIP ${r.zipCode})`).join(', '),
      totalAddresses: pricing.addresses,
      deliveryType,
      ...(pricing.belowMinimum ? {
        belowMinimum: true,
        minimumQuantity: pricing.minimumQuantity
      } : {
        printRate: pricing.printRate,
        pricingTier: pricing.currentTier,
        estimatedTotal: pricing.total.toFixed(2)
      }),
      timestamp: new Date().toISOString(),
      id: `lead-email-${Date.now()}`
    };

    // Track in Sentry
    Sentry.addBreadcrumb({
      category: 'user-action',
      message: 'Email estimate requested',
      level: 'info',
      data: { email: emailEstimateData.email, totalAddresses: pricing.addresses }
    });

    // Send to webhook
    const webhookUrl = process.env.REACT_APP_ZAPIER_WEBHOOK_URL;

    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadData),
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          console.log('✅ Email estimate lead captured');
        }
      } catch (err) {
        console.error('❌ Webhook error:', err);
        Sentry.captureException(err, { tags: { errorType: 'webhook_failure', leadTier: 'email_estimate' } });
      }
    }

    // Save to localStorage as backup
    try {
      const existingLeads = JSON.parse(localStorage.getItem('eddm-leads') || '[]');
      existingLeads.push(leadData);
      localStorage.setItem('eddm-leads', JSON.stringify(existingLeads));
    } catch (err) {
      console.error('localStorage error:', err);
    }

    setSubmitting(false);
    setShowEmailEstimate(false);
    alert(`✅ Estimate sent to ${emailEstimateData.email}!\n\nCheck your inbox in the next few minutes. We'll also follow up within 2 business hours.\n\nReference: ${leadData.id}`);
    setEmailEstimateData({ email: '' });
  };

  // TIER 2: Save Campaign - Name + Email capture
  const handleSaveCampaign = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmissionError(null);

    const pricing = selectedRoutes.length > 0 ? calculateTotal() : { addresses: 0 };
    const selectedRouteData = routes.filter(r => selectedRoutes.includes(r.id));

    const campaignId = `camp-${Date.now()}`;
    const leadData = {
      leadTier: 'campaign_saved',
      email: saveCampaignData.email,
      firstName: saveCampaignData.firstName,
      campaignId,
      routeIds: selectedRoutes,
      routeNames: selectedRouteData.map(r => `${r.name} (ZIP ${r.zipCode})`).join(', '),
      totalAddresses: pricing.addresses,
      deliveryType,
      timestamp: new Date().toISOString(),
      id: `lead-save-${Date.now()}`
    };

    // Track in Sentry
    Sentry.addBreadcrumb({
      category: 'user-action',
      message: 'Campaign saved',
      level: 'info',
      data: { firstName: saveCampaignData.firstName, campaignId }
    });

    // Send to webhook
    const webhookUrl = process.env.REACT_APP_ZAPIER_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadData),
          signal: AbortSignal.timeout(10000)
        });
        console.log('✅ Save campaign lead captured');
      } catch (err) {
        console.error('❌ Webhook error:', err);
        Sentry.captureException(err, { tags: { errorType: 'webhook_failure', leadTier: 'campaign_saved' } });
      }
    }

    // Save to localStorage
    try {
      const existingLeads = JSON.parse(localStorage.getItem('eddm-leads') || '[]');
      existingLeads.push(leadData);
      localStorage.setItem('eddm-leads', JSON.stringify(existingLeads));
      localStorage.setItem(`eddm-campaign-${campaignId}`, JSON.stringify({ selectedRoutes, deliveryType, timestamp: new Date().toISOString() }));
    } catch (err) {
      console.error('localStorage error:', err);
    }

    setSubmitting(false);
    setShowSaveCampaign(false);
    alert(`✅ Campaign saved, ${saveCampaignData.firstName}!\n\nWe've emailed you a link to return to this campaign anytime.\n\nCampaign ID: ${campaignId}`);
    setSaveCampaignData({ email: '', firstName: '' });
  };

  // TIER 4: Exit Intent - Last chance capture
  const handleExitIntentCapture = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    const pricing = selectedRoutes.length > 0 ? calculateTotal() : { addresses: 0 };
    const selectedRouteData = routes.filter(r => selectedRoutes.includes(r.id));

    const leadData = {
      leadTier: 'exit_intent_captured',
      email: emailEstimateData.email,
      routeIds: selectedRoutes,
      routeNames: selectedRouteData.map(r => `${r.name} (ZIP ${r.zipCode})`).join(', '),
      totalAddresses: pricing.addresses,
      deliveryType,
      timestamp: new Date().toISOString(),
      id: `lead-exit-${Date.now()}`
    };

    // Track in Sentry
    Sentry.addBreadcrumb({
      category: 'user-action',
      message: 'Exit intent captured',
      level: 'info',
      data: { email: emailEstimateData.email }
    });

    // Send to webhook
    const webhookUrl = process.env.REACT_APP_ZAPIER_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadData),
          signal: AbortSignal.timeout(10000)
        });
        console.log('✅ Exit intent lead captured');
      } catch (err) {
        console.error('❌ Webhook error:', err);
      }
    }

    // Save to localStorage
    try {
      const existingLeads = JSON.parse(localStorage.getItem('eddm-leads') || '[]');
      existingLeads.push(leadData);
      localStorage.setItem('eddm-leads', JSON.stringify(existingLeads));
    } catch (err) {
      console.error('localStorage error:', err);
    }

    setSubmitting(false);
    setShowExitIntent(false);
    alert(`✅ We'll email your estimate shortly!\n\nReference: ${leadData.id}`);
    setEmailEstimateData({ email: '' });
  };

  // Exit Intent Detection
  useEffect(() => {
    const handleMouseLeave = (e) => {
      // Only trigger if mouse leaves from top of viewport (back/close button area)
      if (e.clientY <= 10 && !exitIntentShown && selectedRoutes.length > 0) {
        setShowExitIntent(true);
        setExitIntentShown(true); // Only show once per session
      }
    };

    document.addEventListener('mouseleave', handleMouseLeave);
    return () => document.removeEventListener('mouseleave', handleMouseLeave);
  }, [exitIntentShown, selectedRoutes.length]);

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
        {/* MPA Header - Fixed white header matching mailpro.org */}
        <header className="mpa-header">
          <a href="https://mailpro.org" className="mpa-header-logo" target="_blank" rel="noopener noreferrer">
            Mail Processing Associates
          </a>
          <div className="mpa-header-center">EDDM Campaign Planner</div>
          <div className="mpa-header-actions">
            {selectedRoutes.length > 0 && (
              <button className="mpa-header-save" onClick={() => setShowSaveCampaign(true)}>
                💾 Save Campaign
              </button>
            )}
            <button className="mpa-header-contact" onClick={() => window.location.href = 'https://www.mailpro.org/request-a-quote'}>
              Contact Us
            </button>
          </div>
        </header>

        {/* Content wrapper - pushes below fixed header */}
        <div className="eddm-content">
          {/* Hero Section - Modern Gradient */}
          <section className="eddm-hero">
            <div className="hero-content">
              <h1 className="hero-title">EDDM Campaign Planner</h1>
              <p className="hero-subtitle">Plan, target, and launch your Every Door Direct Mail campaign with precision. Get instant pricing and reach thousands of households in minutes.</p>

              {/* Social Proof Badges */}
              <div className="hero-badges">
                {/* Elfsight Google Reviews Widget */}
                <div className="elfsight-app-c7a2360d-7cea-4ebf-9ed4-753e9f5a0b88" data-elfsight-app-lazy></div>

                <div className="hero-badge">
                  <svg className="badge-icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 0l2.5 7.5h7.5l-6 4.5 2.5 7.5-6-4.5-6 4.5 2.5-7.5-6-4.5h7.5z"/>
                  </svg>
                  <div className="badge-content">
                    <div className="badge-stat">Best of Florida</div>
                    <div className="badge-label">2025 Printing</div>
                  </div>
                </div>

                <div className="hero-badge">
                  <svg className="badge-icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M18 6H2a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zM2 4h16v1H2V4zm0-2h16v1H2V2z"/>
                  </svg>
                  <div className="badge-content">
                    <div className="badge-stat">50M+ Mailers</div>
                    <div className="badge-label">Delivered</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Step Indicators */}
          <div className="step-indicators">
            <div className="step-indicator-container">
              {/* Step 1: Enter ZIP Code */}
              <div className={`step-indicator ${routes.length > 0 ? 'completed' : 'active'}`}>
                <div className="step-circle">
                  <span className="step-number">{routes.length > 0 ? '✓' : '1'}</span>
                </div>
                <div className="step-label">Enter ZIP Code</div>
              </div>

              <div className="step-connector"></div>

              {/* Step 2: Select Routes */}
              <div className={`step-indicator ${selectedRoutes.length > 0 ? 'completed' : routes.length > 0 ? 'active' : 'inactive'}`}>
                <div className="step-circle">
                  <span className="step-number">{selectedRoutes.length > 0 ? '✓' : '2'}</span>
                </div>
                <div className="step-label">Select Routes</div>
              </div>

              <div className="step-connector"></div>

              {/* Step 3: Get Pricing */}
              <div className={`step-indicator ${selectedRoutes.length > 0 ? 'active' : 'inactive'}`}>
                <div className="step-circle">
                  <span className="step-number">3</span>
                </div>
                <div className="step-label">Get Pricing</div>
              </div>
            </div>
          </div>

          {/* Route Finder - Search Options */}
          <div className="route-finder-container">
            <div className="route-finder-grid">
              {/* ZIP Search Section */}
              <div className="finder-card">
                <div className="finder-card-header">
                  <div className="finder-card-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M10 2C7.24 2 5 4.24 5 7C5 10.5 10 16 10 16C10 16 15 10.5 15 7C15 4.24 12.76 2 10 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="10" cy="7" r="2" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </div>
                  <h3 className="finder-card-title">Search by ZIP</h3>
                </div>
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
                  <button type="submit" className="finder-btn" disabled={loading}>
                    {loading ? 'Searching...' : 'Search'}
                  </button>
                </form>
                {error && (
                  <div className="error-message">{error}</div>
                )}
              </div>

              {/* Coverage Area Section */}
              <div className="finder-card">
                <div className="finder-card-header">
                  <div className="finder-card-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2"/>
                      <path d="M10 3V1M10 19V17M17 10H19M1 10H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <h3 className="finder-card-title">Coverage Area</h3>
                </div>
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
                    <button type="submit" className="finder-btn" disabled={geocoding || loading}>
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
          <div className="map-wrapper">
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '650px' }}
              center={mapCenter}
              zoom={13}
              options={{
                mapTypeControl: false,
                fullscreenControl: true,
              }}
            >
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

              {routes.map(route => {
                const isInRadius = circleCenter && routesInRadius.some(r => r.id === route.id);
                const isSelected = selectedRoutes.includes(route.id);

                let strokeColor, fillColor, opacity, clickable;

                if (circleCenter) {
                  if (isSelected) {
                    strokeColor = '#D32F2F';
                    fillColor = '#D32F2F';
                    opacity = 0.8;
                    clickable = true;
                  } else if (isInRadius) {
                    strokeColor = '#4A90E2';
                    fillColor = '#4A90E2';
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
                    strokeColor = '#4A90E2';
                    fillColor = '#4A90E2';
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
                  <div className="routes-grid">
                    {filteredRoutes.map(route => {
                      const isSelected = selectedRoutes.includes(route.id);
                      const targetedCount = deliveryType === 'residential'
                        ? route.residential
                        : deliveryType === 'business'
                          ? route.business
                          : route.households;

                      // Calculate per-route cost estimate (rough estimate based on current tier)
                      const POSTAGE_RATE = 0.25;
                      const BUNDLING_RATE = 0.035;
                      const currentPricing = pricing || calculateTotal();
                      const estimatedPrintRate = currentPricing?.printRate || 0.17; // Use current tier or default
                      const routeCost = targetedCount * (estimatedPrintRate + POSTAGE_RATE + BUNDLING_RATE);

                      return (
                        <div
                          key={route.id}
                          className={`route-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleRouteSelection(route.id)}
                          onMouseEnter={() => setHoveredRoute(route.id)}
                          onMouseLeave={() => setHoveredRoute(null)}
                        >
                          <div className="route-card-header">
                            <div className="route-card-title">Route {route.name}</div>
                            {isSelected && <div className="route-card-checkmark">✓</div>}
                          </div>

                          <div className="route-card-addresses">
                            <span className="route-card-count-number">{targetedCount.toLocaleString()}</span>
                            <span className="route-card-count-label"> {audienceLabel[deliveryType]}</span>
                          </div>

                          <div className="route-card-zip">ZIP {route.zipCode}</div>

                          {isSelected && (
                            <div className="route-card-cost">
                              ${routeCost.toFixed(2)} for this route
                            </div>
                          )}

                          <div className="route-card-checkbox-container">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRouteSelection(route.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="route-card-checkbox"
                            />
                            <label className="route-card-checkbox-label">
                              {isSelected ? 'Selected' : 'Select'}
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Column: Sticky Estimate Card */}
              <div className="estimate-column">
                <div className="estimate-card-sticky">
                  <h2>Campaign Estimate</h2>

                  {hasSelection ? (
                    <>
                      {/* YOUR CAMPAIGN Section */}
                      <div className="campaign-summary-section">
                        <h3 className="section-title">YOUR CAMPAIGN</h3>
                        <div className="campaign-stats">
                          <div className="campaign-stat-item">
                            <span className="stat-value">{selectedRoutes.length}</span>
                            <span className="stat-label">routes selected</span>
                          </div>
                          <div className="campaign-stat-item">
                            <span className="stat-value">{pricing.addresses.toLocaleString()}</span>
                            <span className="stat-label">total addresses</span>
                          </div>
                        </div>
                      </div>

                      {pricing.belowMinimum ? (
                        <>
                          {/* Below Minimum - Custom Quote Required */}
                          <div className="estimate-cost-section">
                            <h3 className="section-title">ESTIMATED COST</h3>
                            <div className="custom-quote-notice">
                              <div className="custom-quote-icon">⚠️</div>
                              <div className="custom-quote-text">
                                <strong>Custom Quote Required</strong>
                                <p>Your selection is below our {pricing.minimumQuantity.toLocaleString()}-piece minimum for instant pricing.</p>
                              </div>
                            </div>
                          </div>

                          <button className="estimate-cta-primary" onClick={() => setShowQuoteForm(true)}>
                            Get Full Quote & Pricing Breakdown
                          </button>

                          <button className="estimate-cta-secondary" onClick={() => setShowEmailEstimate(true)}>
                            📧 Email Me Estimate
                          </button>

                          <p className="estimate-fine-print">
                            We'll provide competitive pricing options for your campaign size and reach out within 24 hours.
                          </p>
                        </>
                      ) : (
                        <>
                          {/* Above Minimum - Show Full Breakdown */}
                          <div className="estimate-cost-section">
                            <h3 className="section-title">ESTIMATED COST</h3>
                            <div className="total-cost-display">
                              ${pricing.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </div>

                            <div className="cost-breakdown">
                              <div className="breakdown-item">
                                <span className="breakdown-label">• Printing</span>
                                <span className="breakdown-value">${(pricing.printCost || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                              </div>
                              <div className="breakdown-item">
                                <span className="breakdown-label">• Postage</span>
                                <span className="breakdown-value">${(pricing.postageCost || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                              </div>
                              <div className="breakdown-item breakdown-item-total">
                                <span className="breakdown-label">• Total per piece</span>
                                <span className="breakdown-value">${((pricing.total || 0) / (pricing.addresses || 1)).toFixed(2)}</span>
                              </div>
                            </div>
                          </div>

                          {pricing.nextTier && pricing.addressesUntilNextDiscount > 0 && (
                            <div className="estimate-incentive">
                              💡 Add {pricing.addressesUntilNextDiscount.toLocaleString()} more addresses to unlock next pricing tier and save ${pricing.potentialSavings.toFixed(2)}
                            </div>
                          )}

                          <button className="estimate-cta-primary" onClick={() => setShowQuoteForm(true)}>
                            Get Full Quote & Pricing Breakdown
                          </button>

                          <button className="estimate-cta-secondary" onClick={() => setShowEmailEstimate(true)}>
                            📧 Email Me Estimate
                          </button>

                          <button className="estimate-cta-secondary" onClick={() => setShowROICalculator(true)}>
                            💰 See Potential ROI
                          </button>

                          <p className="estimate-fine-print">
                            *Estimate based on 6.25x9 postcard, 100# gloss cover, full color both sides. Contact us for final pricing and custom options.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="estimate-empty">
                      <h3 className="estimate-empty-title">Get Started</h3>
                      <div className="progress-checklist">
                        <div className={`progress-item ${routes.length > 0 ? 'completed' : ''}`}>
                          <span className="progress-icon">{routes.length > 0 ? '✓' : '○'}</span>
                          <span className="progress-text">Enter ZIP code</span>
                        </div>
                        <div className="progress-item">
                          <span className="progress-icon">○</span>
                          <span className="progress-text">Select your target routes</span>
                        </div>
                        <div className="progress-item">
                          <span className="progress-icon">○</span>
                          <span className="progress-text">See instant pricing</span>
                        </div>
                        <div className="progress-item">
                          <span className="progress-icon">○</span>
                          <span className="progress-text">Get your campaign plan</span>
                        </div>
                      </div>
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

          {/* Trust Footer - Modern Design */}
          <div className="trust-footer">
            <div className="trust-footer-content">
              <h3 className="trust-footer-title">Why Choose MPA for Your EDDM Campaign</h3>
              <div className="trust-footer-grid">
                <div className="trust-footer-item">
                  <div className="trust-footer-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <path d="M16 4L19.09 13.26L28.94 13.26L20.87 19.22L23.96 28.48L16 22.52L8.04 28.48L11.13 19.22L3.06 13.26L12.91 13.26L16 4Z" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="trust-footer-text">
                    <h4>USPS Approved Partner</h4>
                    <p>Official USPS carrier route data for accurate targeting</p>
                  </div>
                </div>
                <div className="trust-footer-item">
                  <div className="trust-footer-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <path d="M12 6C12 6 8 10 8 14C8 16.21 9.79 18 12 18C14.21 18 16 16.21 16 14C16 10 12 6 12 6Z" fill="currentColor"/>
                      <path d="M20 12C20 12 17 15 17 18C17 19.66 18.34 21 20 21C21.66 21 23 19.66 23 18C23 15 20 12 20 12Z" fill="currentColor"/>
                      <rect x="4" y="22" width="24" height="6" rx="1" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="trust-footer-text">
                    <h4>Volume Discounts</h4>
                    <p>Best rates guaranteed with transparent pricing</p>
                  </div>
                </div>
                <div className="trust-footer-item">
                  <div className="trust-footer-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <rect x="6" y="8" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
                      <path d="M6 12H26" stroke="currentColor" strokeWidth="2"/>
                      <path d="M16 8V6C16 5.45 16.45 5 17 5H21C21.55 5 22 5.45 22 6V8" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </div>
                  <div className="trust-footer-text">
                    <h4>All-Inclusive Service</h4>
                    <p>Printing, postage, and delivery - all handled for you</p>
                  </div>
                </div>
                <div className="trust-footer-item">
                  <div className="trust-footer-icon">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <path d="M16 6L18 14L26 14L20 19L22 27L16 22L10 27L12 19L6 14L14 14L16 6Z" stroke="currentColor" strokeWidth="2" fill="none"/>
                      <circle cx="16" cy="16" r="3" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="trust-footer-text">
                    <h4>Fast Turnaround</h4>
                    <p>2-3 week delivery from approval to mailboxes</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showQuoteForm && (
        <div className="modal-overlay" onClick={() => setShowQuoteForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowQuoteForm(false)}>×</button>
            <h2>Get Your Final Quote</h2>
            <p>Complete the form below and we'll contact you within 2 business hours with final pricing and a detailed proposal customized for your campaign.</p>

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

      {/* ROI Calculator Modal */}
      {showROICalculator && (
        <ROICalculator
          campaignCost={pricing.total}
          totalAddresses={pricing.addresses}
          onClose={() => setShowROICalculator(false)}
        />
      )}

      {/* TIER 1: Email Me Estimate Modal */}
      {showEmailEstimate && (
        <div className="modal-overlay" onClick={() => setShowEmailEstimate(false)}>
          <div className="modal-content modal-simple" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEmailEstimate(false)}>×</button>
            <h2>📧 Email Your Estimate</h2>
            <p className="modal-subtitle">We'll send a detailed estimate to your inbox instantly, with no obligation.</p>

            <form onSubmit={handleEmailEstimate} className="simple-capture-form">
              <input
                type="email"
                placeholder="Your email address"
                value={emailEstimateData.email}
                onChange={(e) => setEmailEstimateData({ email: e.target.value })}
                required
                autoFocus
                className="simple-input"
              />

              {pricing && (
                <div className="estimate-summary-box">
                  <div className="summary-row">
                    <span>{selectedRoutes.length} routes selected</span>
                    <span>{pricing.addresses.toLocaleString()} addresses</span>
                  </div>
                  {!pricing.belowMinimum && (
                    <div className="summary-total">
                      Est. ${pricing.total.toLocaleString(undefined, {maximumFractionDigits: 0})}
                    </div>
                  )}
                </div>
              )}

              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? 'Sending...' : 'Email Me the Estimate'}
              </button>

              <p className="trust-note">✓ No spam, ever. We'll also follow up to answer questions.</p>
            </form>
          </div>
        </div>
      )}

      {/* TIER 2: Save Campaign Modal */}
      {showSaveCampaign && (
        <div className="modal-overlay" onClick={() => setShowSaveCampaign(false)}>
          <div className="modal-content modal-simple" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSaveCampaign(false)}>×</button>
            <h2>💾 Save Your Campaign</h2>
            <p className="modal-subtitle">We'll email you a link to return to this campaign anytime.</p>

            <form onSubmit={handleSaveCampaign} className="simple-capture-form">
              <input
                type="text"
                placeholder="First name"
                value={saveCampaignData.firstName}
                onChange={(e) => setSaveCampaignData({...saveCampaignData, firstName: e.target.value})}
                required
                autoFocus
                className="simple-input"
              />

              <input
                type="email"
                placeholder="Email address"
                value={saveCampaignData.email}
                onChange={(e) => setSaveCampaignData({...saveCampaignData, email: e.target.value})}
                required
                className="simple-input"
              />

              {selectedRoutes.length > 0 && (
                <div className="estimate-summary-box">
                  <div className="summary-row">
                    <span>{selectedRoutes.length} routes</span>
                    <span>{calculateTotal().addresses.toLocaleString()} addresses</span>
                  </div>
                </div>
              )}

              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save My Campaign'}
              </button>

              <p className="trust-note">✓ Your campaign will be saved for 30 days</p>
            </form>
          </div>
        </div>
      )}

      {/* TIER 4: Exit Intent Modal */}
      {showExitIntent && (
        <div className="modal-overlay exit-intent-overlay" onClick={() => setShowExitIntent(false)}>
          <div className="modal-content modal-simple exit-intent-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowExitIntent(false)}>×</button>
            <h2>🚀 Wait! Before You Go...</h2>
            <p className="modal-subtitle">Let us email your estimate so you don't lose your work!</p>

            <form onSubmit={handleExitIntentCapture} className="simple-capture-form">
              <input
                type="email"
                placeholder="Your email address"
                value={emailEstimateData.email}
                onChange={(e) => setEmailEstimateData({ email: e.target.value })}
                required
                autoFocus
                className="simple-input"
              />

              {selectedRoutes.length > 0 && (
                <div className="estimate-summary-box">
                  <div className="summary-row">
                    <span>{selectedRoutes.length} routes selected</span>
                    <span>{calculateTotal().addresses.toLocaleString()} addresses</span>
                  </div>
                </div>
              )}

              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? 'Sending...' : 'Email Me & Save Campaign'}
              </button>

              <button type="button" className="skip-btn" onClick={() => setShowExitIntent(false)}>
                No thanks, I'll start over next time
              </button>
            </form>
          </div>
        </div>
      )}
    </LoadScript>
  );
}

export default EDDMMapper;
