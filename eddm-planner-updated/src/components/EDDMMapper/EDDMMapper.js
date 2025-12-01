import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { GoogleMap, LoadScript, Polygon, Polyline, Marker, Circle, Autocomplete } from '@react-google-maps/api';
import * as Sentry from '@sentry/react';
import ROICalculator from '../ROICalculator/ROICalculator';
import { getTurnkeyEstimate, formatCurrency, RECOMMENDED_MINIMUM } from '../../utils/pricing';
import './EDDMMapper.css';

// Google Maps libraries to load
const GOOGLE_MAPS_LIBRARIES = ['places'];

// Vercel API endpoint for fetching EDDM routes (proxies USPS API to avoid CORS)
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
    name: '',
    businessName: '',
    email: '',
    phone: '',
    preferredSize: 'Not sure yet — please recommend',
    customSizeDetails: '',
    notes: '',
    needsDesign: false
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

    // Use the new turnkey pricing utility
    // All-inclusive: print + prep + postage + USPS drop-off
    const estimate = getTurnkeyEstimate(totalAddresses);

    return {
      addresses: totalAddresses,
      // We now always show pricing (even below recommended minimum)
      belowMinimum: false,
      belowRecommended: estimate.belowRecommended,
      recommendedMinimum: estimate.recommendedMinimum,
      // Turnkey pricing fields
      ratePerPiece: estimate.ratePerPiece,
      total: estimate.total,
      currentTier: estimate.currentTierLabel,
      nextTier: estimate.nextTierLabel,
      addressesUntilNextDiscount: estimate.piecesUntilNextDiscount,
      potentialSavings: estimate.potentialSavings
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
      // Contact info
      name: formData.name,
      businessName: formData.businessName || '',
      email: formData.email,
      phone: formData.phone,
      // Project preferences
      preferredSize: formData.preferredSize,
      customSizeDetails: formData.customSizeDetails || '',
      notes: formData.notes || '',
      needsDesign: formData.needsDesign || false,
      // Campaign context
      routeIds: selectedRoutes,
      routeNames: selectedRouteData.map(r => `${r.name} (ZIP ${r.zipCode})`).join(', '),
      totalAddresses: pricing.addresses,
      deliveryType,
      // Turnkey pricing (internal - not shown in UI)
      estimatedPieces: pricing.addresses,
      estimatedRatePerPiece: pricing.ratePerPiece,
      estimatedTotalCost: pricing.total.toFixed(2),
      pricingTier: pricing.currentTier,
      belowRecommended: pricing.belowRecommended || false,
      timestamp: new Date().toISOString(),
      id: `lead-${Date.now()}`
    };

    // Track quote submission attempt in Sentry
    Sentry.addBreadcrumb({
      category: 'user-action',
      message: 'Quote form submitted',
      level: 'info',
      data: {
        businessName: formData.businessName || '(none)',
        estimatedPieces: pricing.addresses,
        estimatedRatePerPiece: pricing.ratePerPiece,
        estimatedTotal: pricing.total,
        routesSelected: selectedRoutes.length,
        belowRecommended: pricing.belowRecommended,
        needsDesign: formData.needsDesign
      }
    });

    // Set user context for error tracking
    Sentry.setUser({
      email: formData.email,
      username: formData.name
    });

    // PRODUCTION WEBHOOK INTEGRATION
    let webhookSuccess = false;
    const webhookUrl = 'https://hooks.zapier.com/hooks/catch/18492625/us7x40y/';

    try {
      console.log('📤 Sending lead to webhook...', leadData.id);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: JSON.stringify(leadData)
      });

      if (response.ok) {
        console.log('✅ Webhook success');
        webhookSuccess = true;
      } else {
        console.error('❌ Webhook failed with status:', response.status);
      }
    } catch (webhookError) {
      console.error('❌ Webhook error:', webhookError);
    }

    // ALWAYS save to localStorage as backup/fallback
    let localStorageSuccess = false;
    try {
      const existingLeads = JSON.parse(localStorage.getItem('eddm-leads') || '[]');
      existingLeads.push(leadData);
      localStorage.setItem('eddm-leads', JSON.stringify(existingLeads));
      console.log('💾 Lead saved to localStorage:', leadData.id);
      localStorageSuccess = true;
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

    // Redirect to thank you page if either webhook OR localStorage succeeded
    if (webhookSuccess || localStorageSuccess) {
      window.location.href = '/eddm-thank-you';
      return;
    }
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
        {/* MPA Header - Fixed white header matching mailpro.org */}
        <header className="mpa-header">
          <div className="mpa-header-logo">MPA</div>
          <div className="mpa-header-center">EDDM Campaign Planner</div>
          <button className="mpa-header-contact" onClick={() => window.location.href = 'https://www.mailpro.org/request-a-quote'}>
            Contact Us
          </button>
        </header>

        {/* Content wrapper - pushes below fixed header */}
        <div className="eddm-content">
          {/* Hero Section - Navy background */}
          <section className="eddm-hero">
            <h1>EDDM Campaign Planner</h1>
            <p>Enter any U.S. ZIP code to see carrier routes, select your target areas, and get instant pricing</p>
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

                      return (
                        <div
                          key={route.id}
                          className={`route-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleRouteSelection(route.id)}
                          onMouseEnter={() => setHoveredRoute(route.id)}
                          onMouseLeave={() => setHoveredRoute(null)}
                        >
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
                      <div className="estimate-header">
                        <div className="estimate-header-text">
                          {selectedRoutes.length} routes | {pricing.addresses.toLocaleString()} addresses
                        </div>
                      </div>

                      {/* Campaign Summary - No pricing shown */}
                      <>
                        {pricing.belowRecommended && (
                          <div className="estimate-below-recommended">
                            <div className="below-recommended-icon">ℹ️</div>
                            <p>
                              EDDM campaigns under {pricing.recommendedMinimum.toLocaleString()} pieces are not typically
                              cost-effective. Consider adding more routes to maximize your ROI.
                            </p>
                          </div>
                        )}

                        <div className="estimate-total-display">
                          <div className="estimate-breakdown-row">
                            <span className="estimate-label">Selected pieces:</span>
                            <span className="estimate-value">{pricing.addresses.toLocaleString()}</span>
                          </div>
                          <div className="estimate-info-row">
                            <p>We'll calculate your all-in turnkey price and include it with your quote.</p>
                          </div>
                        </div>

                        <button className="estimate-cta" onClick={() => setShowQuoteForm(true)}>
                          GET MY FREE QUOTE
                        </button>

                        <button className="estimate-cta estimate-cta-secondary" onClick={() => setShowROICalculator(true)}>
                          💰 SEE POTENTIAL ROI
                        </button>

                        <p className="estimate-fine-print">
                          Turnkey pricing includes printing, prep, postage, and USPS drop-off. We'll send you a detailed quote, usually same business day.
                        </p>
                      </>
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
                <div className="mobile-estimate-value">{pricing.addresses.toLocaleString()} pieces</div>
                <div className="mobile-estimate-label">{selectedRoutes.length} routes selected</div>
              </div>
              <button className="mobile-estimate-btn" onClick={() => setShowQuoteForm(true)}>
                Get Quote
              </button>
            </div>
          )}

          {/* Bottom Section - Benefits + Footer */}
          <div className="bottom-section">
            {/* Benefits Row */}
            <div className="benefits-row">
              <div className="benefits-container">
                <div className="benefit-item">
                  <div className="benefit-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      <path d="M9 12l2 2 4-4"/>
                    </svg>
                  </div>
                  <div className="benefit-content">
                    <div className="benefit-title">USPS Approved</div>
                    <div className="benefit-subtitle">Official carrier route data</div>
                  </div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                      <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="benefit-content">
                    <div className="benefit-title">Volume Discounts</div>
                    <div className="benefit-subtitle">Better rates at scale</div>
                  </div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="3" width="22" height="18" rx="2"/>
                      <path d="M1 9h22"/>
                      <path d="M8 15h4"/>
                    </svg>
                  </div>
                  <div className="benefit-content">
                    <div className="benefit-title">All-Inclusive Pricing</div>
                    <div className="benefit-subtitle">Print, prep, postage &amp; delivery</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <footer className="site-footer">
              <div className="footer-inner">
                <div className="footer-contact-row">
                  <a href="tel:+18633561853" className="footer-phone">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="footer-icon">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                    </svg>
                    (863) 356-1853
                  </a>
                  <a href="mailto:orders@mailpro.org" className="footer-email">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="footer-icon">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="M22 6l-10 7L2 6"/>
                    </svg>
                    orders@mailpro.org
                  </a>
                </div>
                <div className="footer-meta">
                  <span className="footer-copyright">© {new Date().getFullYear()} Mail Processing Associates</span>
                  <span className="footer-sep">|</span>
                  <a href="https://www.mailpro.org" className="footer-link" target="_blank" rel="noopener noreferrer">mailpro.org</a>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </div>

      {showQuoteForm && (
        <div className="modal-overlay" onClick={() => setShowQuoteForm(false)}>
          <div className="modal-content modal-content-compact" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowQuoteForm(false)}>×</button>
            <h2>Get Your Free Quote</h2>

            {pricing && (
              <div className="quote-summary-header">
                <strong>{selectedRoutes.length}</strong> route(s) · <strong>{pricing.addresses.toLocaleString()}</strong> pieces
              </div>
            )}

            <form onSubmit={handleSubmitQuote}>
              <div className="form-row">
                <label className="form-label">Your name <span className="required">*</span></label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                />
              </div>

              <div className="form-row">
                <label className="form-label">Business name</label>
                <input
                  type="text"
                  placeholder="Sunrise Heating & Air"
                  value={formData.businessName}
                  onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                />
                <span className="form-helper">(Optional — leave blank if you don't have one)</span>
              </div>

              <div className="form-row">
                <label className="form-label">Email <span className="required">*</span></label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  required
                />
              </div>

              <div className="form-row">
                <label className="form-label">Mobile or best phone <span className="required">*</span></label>
                <input
                  type="tel"
                  placeholder="(555) 555-5555"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  maxLength="14"
                  required
                />
                <span className="form-helper">We'll only contact you about this campaign.</span>
              </div>

              <div className="form-row">
                <label className="form-label">Preferred postcard size (optional)</label>
                <select
                  value={formData.preferredSize}
                  onChange={(e) => setFormData({...formData, preferredSize: e.target.value, customSizeDetails: e.target.value !== 'Custom size / other' ? '' : formData.customSizeDetails})}
                  className="form-select"
                >
                  <option value="Not sure yet — please recommend">Not sure yet — please recommend</option>
                  <option value="6.25&quot; × 9&quot; (standard EDDM postcard)">6.25" × 9" (standard EDDM postcard)</option>
                  <option value="8.5&quot; × 11&quot; (large postcard)">8.5" × 11" (large postcard)</option>
                  <option value="Custom size / other">Custom size / other</option>
                </select>
              </div>

              {formData.preferredSize === 'Custom size / other' && (
                <div className="form-row">
                  <label className="form-label">Custom size details (optional)</label>
                  <input
                    type="text"
                    placeholder='e.g., 6" × 11" tri-fold brochure'
                    value={formData.customSizeDetails}
                    onChange={(e) => setFormData({...formData, customSizeDetails: e.target.value})}
                  />
                </div>
              )}

              <div className="form-row">
                <label className="form-label">Anything we should know?</label>
                <textarea
                  placeholder='e.g., "Spring tune-up promo for 3 routes in north Lakeland."'
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  rows="3"
                ></textarea>
              </div>

              <div className="form-row checkbox-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.needsDesign}
                    onChange={(e) => setFormData({...formData, needsDesign: e.target.checked})}
                  />
                  <span>I need help designing my postcard</span>
                </label>
              </div>

              {submissionError && (
                <div className="error-message" style={{marginBottom: '16px'}}>
                  {submissionError}
                </div>
              )}

              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send me my full quote'}
              </button>

              <p className="form-footer-text">
                We'll review your routes and email you a detailed turnkey quote (print + prep + postage + USPS drop-off), usually same business day.
              </p>
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
    </LoadScript>
  );
}

export default EDDMMapper;
