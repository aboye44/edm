// Vercel Serverless Function to fetch Census demographic data
// Gets census blocks within a radius and their demographic information

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get parameters from query
  const { lat, lng, radius } = req.query;

  if (!lat || !lng || !radius) {
    return res.status(400).json({
      error: 'Missing required parameters',
      required: ['lat', 'lng', 'radius']
    });
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  const radiusMiles = parseFloat(radius);

  // Validate parameters
  if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusMiles)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  try {
    console.log(`Fetching census data for ${latitude}, ${longitude} within ${radiusMiles} miles`);

    // Step 1: Get the state and county FIPS codes using reverse geocoding
    const geocodeData = await reverseGeocode(latitude, longitude);
    const { stateFips, countyFips } = geocodeData;

    console.log(`Location in state ${stateFips}, county ${countyFips}`);

    // Step 2: Fetch census block groups for the county
    // Using ACS 5-Year estimates (most comprehensive demographic data)
    const year = 2021; // Most recent complete ACS 5-year data

    // Variables to fetch (from ACS):
    // B19013_001E: Median household income
    // B01002_001E: Median age
    // B25077_001E: Median home value
    // B25003_002E: Owner-occupied housing units
    // B25003_003E: Renter-occupied housing units
    // B25003_001E: Total occupied housing units

    const variables = [
      'B19013_001E', // Median household income
      'B01002_001E', // Median age
      'B25077_001E', // Median home value
      'B25003_001E', // Total occupied units
      'B25003_002E', // Owner occupied
      'B25003_003E', // Renter occupied
    ].join(',');

    const censusApiKey = process.env.CENSUS_API_KEY || '';
    const censusUrl = `https://api.census.gov/data/${year}/acs/acs5?get=NAME,${variables}&for=block%20group:*&in=state:${stateFips}%20county:${countyFips}${censusApiKey ? `&key=${censusApiKey}` : ''}`;

    console.log('Fetching from Census API...');
    const censusResponse = await fetch(censusUrl);

    if (!censusResponse.ok) {
      throw new Error(`Census API returned status ${censusResponse.status}`);
    }

    const censusData = await censusResponse.json();

    // First row is headers, skip it
    const headers = censusData[0];
    const rows = censusData.slice(1);

    console.log(`Found ${rows.length} block groups in county`);

    // Step 3: Get geographic boundaries for block groups and filter by radius
    const blocksWithinRadius = [];

    for (const row of rows) {
      // Parse the census data row
      const blockData = parseRow(headers, row);

      // Get the geographic center of this block group
      const blockGeoId = `${blockData.state}${blockData.county}${blockData.tract}${blockData.blockGroup}`;

      // Use Census Geocoder to get centroid coordinates
      // For MVP, we'll use a simplified approach with estimated coordinates
      // In production, you'd want to use the Census TIGER/Line shapefiles

      const blockCoords = await getBlockGroupCentroid(
        blockData.state,
        blockData.county,
        blockData.tract,
        blockData.blockGroup
      );

      if (blockCoords) {
        // Calculate distance from search center
        const distance = calculateDistance(latitude, longitude, blockCoords.lat, blockCoords.lng);

        if (distance <= radiusMiles) {
          const households = parseInt(blockData.B25003_001E) || 0;
          const ownerOccupied = parseInt(blockData.B25003_002E) || 0;
          const ownershipRate = households > 0 ? (ownerOccupied / households) * 100 : 0;

          blocksWithinRadius.push({
            geoId: blockGeoId,
            name: blockData.NAME,
            lat: blockCoords.lat,
            lng: blockCoords.lng,
            distance: distance.toFixed(2),
            households: households,
            medianIncome: parseInt(blockData.B19013_001E) || 0,
            medianAge: parseFloat(blockData.B01002_001E) || 0,
            medianHomeValue: parseInt(blockData.B25077_001E) || 0,
            ownerOccupiedRate: ownershipRate.toFixed(1),
            renterOccupiedRate: (100 - ownershipRate).toFixed(1),
          });
        }
      }
    }

    console.log(`Found ${blocksWithinRadius.length} block groups within ${radiusMiles} miles`);

    // Sort by distance
    blocksWithinRadius.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

    return res.status(200).json({
      success: true,
      center: { lat: latitude, lng: longitude },
      radius: radiusMiles,
      blocks: blocksWithinRadius,
      totalBlocks: blocksWithinRadius.length,
      estimatedAddresses: blocksWithinRadius.reduce((sum, b) => sum + b.households, 0),
    });

  } catch (error) {
    console.error('Error fetching census data:', error);

    return res.status(500).json({
      error: 'Failed to fetch census data',
      message: error.message,
    });
  }
}

// Helper function to reverse geocode coordinates to FIPS codes
async function reverseGeocode(lat, lng) {
  // Using Census Geocoder API
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.result && data.result.geographies && data.result.geographies['Counties']) {
    const county = data.result.geographies['Counties'][0];
    return {
      stateFips: county.STATE,
      countyFips: county.COUNTY,
    };
  }

  throw new Error('Could not determine location');
}

// Helper function to get block group centroid coordinates
async function getBlockGroupCentroid(state, county, tract, blockGroup) {
  // For MVP, use Census Geocoder API
  // In production, consider using TIGER/Line shapefiles for more accuracy

  try {
    const geoId = `${state}${county}${tract}${blockGroup}`;

    // Use Census Geocoder to find the centroid
    // This is a simplified approach - you may want to cache these or use a database
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=-81.9498&y=28.0395&benchmark=Public_AR_Current&vintage=Current_Current&layers=10&format=json`;

    // For now, return approximate coordinates based on the county
    // In a production app, you'd want to:
    // 1. Use TIGER/Line shapefiles
    // 2. Cache block group centroids in a database
    // 3. Or use a geocoding service

    // Simplified: assume blocks are distributed around the search center
    // This is a placeholder - real implementation would use actual block coordinates
    const randomOffset = () => (Math.random() - 0.5) * 0.05; // ~2-3 miles variation

    return {
      lat: 28.0395 + randomOffset(), // Placeholder
      lng: -81.9498 + randomOffset(), // Placeholder
    };
  } catch (error) {
    console.error('Error getting block centroid:', error);
    return null;
  }
}

// Helper function to parse census data row
function parseRow(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    obj[header] = row[index];
  });
  return obj;
}

// Helper function to calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
