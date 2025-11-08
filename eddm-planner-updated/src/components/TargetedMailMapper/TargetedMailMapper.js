import React, { useState, useCallback, useMemo, useRef } from 'react';
import { GoogleMap, LoadScript, Marker, Circle, Autocomplete, HeatmapLayer } from '@react-google-maps/api';
import './TargetedMailMapper.css';

// Google Maps libraries to load
const GOOGLE_MAPS_LIBRARIES = ['places', 'visualization'];

// Census API endpoint (serverless function)
const CENSUS_API_ENDPOINT = '/api/census-data';

// Default map center (Lakeland, FL)
const defaultCenter = {
  lat: 28.0395,
  lng: -81.9498
};

function TargetedMailMapper() {
  const [locationAddress, setLocationAddress] = useState('');
  const [selectedRadius, setSelectedRadius] = useState(5);
  const [circleCenter, setCircleCenter] = useState(null);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const autocompleteRef = useRef(null);

  // Demographic filters
  const [filters, setFilters] = useState({
    minIncome: 0,
    maxIncome: 200000,
    minAge: 18,
    maxAge: 100,
    homeowners: true,
    renters: true,
    minHomeValue: 0,
    maxHomeValue: 1000000,
  });

  // Census data and addresses
  const [censusBlocks, setCensusBlocks] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);

  // Handle autocomplete place selection
  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();

      if (place.geometry && place.geometry.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        setLocationAddress(place.formatted_address || '');
        setCircleCenter({ lat, lng });
        setMapCenter({ lat, lng });
        setGeocodeError(null);

        console.log('Place selected:', { lat, lng, address: place.formatted_address });
      } else {
        setGeocodeError('Could not get location for this address');
      }
    }
  }, []);

  // Fetch census data for location and radius
  const fetchCensusData = useCallback(async (lat, lng, radiusMiles) => {
    setLoading(true);
    setError(null);

    try {
      console.log(`🔍 Fetching census data within ${radiusMiles} miles of`, { lat, lng });

      const url = `${CENSUS_API_ENDPOINT}?lat=${lat}&lng=${lng}&radius=${radiusMiles}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch census data');
      }

      const data = await response.json();
      console.log('Census data received:', data);

      setCensusBlocks(data.blocks || []);

      // Addresses calculated from census blocks

      // Create heatmap data for visualization
      const heatmap = (data.blocks || []).map(block => ({
        location: new window.google.maps.LatLng(block.lat, block.lng),
        weight: block.households || 1
      }));
      setHeatmapData(heatmap);

      setLoading(false);
    } catch (err) {
      console.error('Error fetching census data:', err);
      setError(err.message);
      setLoading(false);
    }
  }, []);

  // Geocode address and fetch census data
  const findTargetedAddresses = useCallback(async (e) => {
    e.preventDefault();
    if (!locationAddress.trim()) {
      setGeocodeError('Please enter an address');
      return;
    }

    setGeocoding(true);
    setGeocodeError(null);
    setError(null);

    try {
      // Use existing coordinates from autocomplete if available
      if (circleCenter) {
        console.log('Using existing coordinates:', circleCenter);
        await fetchCensusData(circleCenter.lat, circleCenter.lng, selectedRadius);
        setGeocoding(false);
        return;
      }

      // Geocode the address
      const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
      const encodedAddress = encodeURIComponent(locationAddress);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

      console.log('Geocoding address:', locationAddress);
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;
        setCircleCenter({ lat: location.lat, lng: location.lng });
        setMapCenter({ lat: location.lat, lng: location.lng });
        setGeocodeError(null);

        console.log('Geocoding success:', { lat: location.lat, lng: location.lng });

        // Fetch census data for this location
        await fetchCensusData(location.lat, location.lng, selectedRadius);
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
  }, [locationAddress, selectedRadius, circleCenter, fetchCensusData]);

  // Calculate filtered addresses based on demographic criteria
  const filteredAddresses = useMemo(() => {
    return censusBlocks.filter(block => {
      // Apply income filter
      if (block.medianIncome < filters.minIncome || block.medianIncome > filters.maxIncome) {
        return false;
      }

      // Apply age filter
      if (block.medianAge < filters.minAge || block.medianAge > filters.maxAge) {
        return false;
      }

      // Apply homeownership filter
      const ownershipRate = block.ownerOccupiedRate || 0;
      if (!filters.homeowners && ownershipRate > 50) {
        return false;
      }
      if (!filters.renters && ownershipRate <= 50) {
        return false;
      }

      return true;
    });
  }, [censusBlocks, filters]);

  // Calculate total addresses after filtering
  const totalFilteredAddresses = useMemo(() => {
    return filteredAddresses.reduce((sum, block) => sum + (block.households || 0), 0);
  }, [filteredAddresses]);

  // Calculate pricing
  const pricing = useMemo(() => {
    if (totalFilteredAddresses === 0) return null;

    const listCost = totalFilteredAddresses * 0.05;
    const printingCost = totalFilteredAddresses * 0.25;
    const postageCost = totalFilteredAddresses * 0.55; // First class
    const handlingCost = totalFilteredAddresses * 0.10;
    const total = listCost + printingCost + postageCost + handlingCost;

    return {
      addresses: totalFilteredAddresses,
      listCost: listCost.toFixed(2),
      printing: printingCost.toFixed(2),
      postage: postageCost.toFixed(2),
      handling: handlingCost.toFixed(2),
      total: total.toFixed(2),
      perPiece: (total / totalFilteredAddresses).toFixed(2)
    };
  }, [totalFilteredAddresses]);

  return (
    <div className="targeted-mail-mapper">
      <header className="mapper-header">
        <div className="header-content">
          <h1>Targeted Mail Campaign Planner</h1>
          <p>Target specific demographics with precision direct mail</p>
        </div>
      </header>

      <div className="mapper-container">
        {/* Search Controls */}
        <div className="search-section">
          <form onSubmit={findTargetedAddresses} className="search-form">
            <div className="search-input-group">
              <LoadScript
                googleMapsApiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'}
                libraries={GOOGLE_MAPS_LIBRARIES}
              >
                <Autocomplete
                  onLoad={(autocomplete) => {
                    autocompleteRef.current = autocomplete;
                  }}
                  onPlaceChanged={onPlaceChanged}
                >
                  <input
                    type="text"
                    placeholder="Enter address or location"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    className="location-input"
                  />
                </Autocomplete>
              </LoadScript>

              <select
                value={selectedRadius}
                onChange={(e) => setSelectedRadius(Number(e.target.value))}
                className="radius-select"
              >
                <option value={1}>1 mile</option>
                <option value={3}>3 miles</option>
                <option value={5}>5 miles</option>
                <option value={10}>10 miles</option>
                <option value={15}>15 miles</option>
                <option value={20}>20 miles</option>
              </select>

              <button type="submit" disabled={geocoding || loading} className="search-button">
                {geocoding || loading ? 'Searching...' : 'Find Addresses'}
              </button>
            </div>
          </form>

          {geocodeError && <div className="error-message">{geocodeError}</div>}
          {error && <div className="error-message">{error}</div>}
        </div>

        {/* Demographic Filters */}
        {censusBlocks.length > 0 && (
          <div className="filters-section">
            <h3>Demographic Filters</h3>
            <div className="filters-grid">
              <div className="filter-group">
                <label>Household Income</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.minIncome}
                    onChange={(e) => setFilters({ ...filters, minIncome: Number(e.target.value) })}
                    step="10000"
                  />
                  <span>to</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.maxIncome}
                    onChange={(e) => setFilters({ ...filters, maxIncome: Number(e.target.value) })}
                    step="10000"
                  />
                </div>
              </div>

              <div className="filter-group">
                <label>Age Range</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.minAge}
                    onChange={(e) => setFilters({ ...filters, minAge: Number(e.target.value) })}
                  />
                  <span>to</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.maxAge}
                    onChange={(e) => setFilters({ ...filters, maxAge: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="filter-group">
                <label>Housing</label>
                <div className="checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={filters.homeowners}
                      onChange={(e) => setFilters({ ...filters, homeowners: e.target.checked })}
                    />
                    Homeowners
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={filters.renters}
                      onChange={(e) => setFilters({ ...filters, renters: e.target.checked })}
                    />
                    Renters
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Map */}
        <div className="map-container">
          <LoadScript
            googleMapsApiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY'}
            libraries={GOOGLE_MAPS_LIBRARIES}
          >
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={mapCenter}
              zoom={circleCenter ? 13 : 11}
              options={{
                streetViewControl: false,
                mapTypeControl: true,
              }}
            >
              {circleCenter && (
                <>
                  <Marker position={circleCenter} />
                  <Circle
                    center={circleCenter}
                    radius={selectedRadius * 1609.34} // Convert miles to meters
                    options={{
                      fillColor: '#4A90E2',
                      fillOpacity: 0.1,
                      strokeColor: '#4A90E2',
                      strokeOpacity: 0.8,
                      strokeWeight: 2,
                    }}
                  />
                </>
              )}

              {heatmapData.length > 0 && (
                <HeatmapLayer
                  data={heatmapData}
                  options={{
                    radius: 20,
                    opacity: 0.6,
                  }}
                />
              )}
            </GoogleMap>
          </LoadScript>
        </div>

        {/* Results Summary */}
        {pricing && (
          <div className="results-section">
            <h3>Campaign Estimate</h3>
            <div className="results-grid">
              <div className="result-card">
                <div className="result-label">Targeted Addresses</div>
                <div className="result-value">{pricing.addresses.toLocaleString()}</div>
              </div>
              <div className="result-card">
                <div className="result-label">Cost Per Piece</div>
                <div className="result-value">${pricing.perPiece}</div>
              </div>
              <div className="result-card">
                <div className="result-label">Total Campaign Cost</div>
                <div className="result-value">${Number(pricing.total).toLocaleString()}</div>
              </div>
            </div>

            <div className="pricing-breakdown">
              <h4>Cost Breakdown</h4>
              <div className="breakdown-item">
                <span>Mailing List:</span>
                <span>${Number(pricing.listCost).toLocaleString()}</span>
              </div>
              <div className="breakdown-item">
                <span>Printing:</span>
                <span>${Number(pricing.printing).toLocaleString()}</span>
              </div>
              <div className="breakdown-item">
                <span>First Class Postage:</span>
                <span>${Number(pricing.postage).toLocaleString()}</span>
              </div>
              <div className="breakdown-item">
                <span>Handling:</span>
                <span>${Number(pricing.handling).toLocaleString()}</span>
              </div>
            </div>

            <button className="cta-button">Get Detailed Quote</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TargetedMailMapper;
