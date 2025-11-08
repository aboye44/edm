// Vercel Serverless Function to fetch Census demographic data by ZIP codes
// FREE approach: Uses ZIP Code Tabulation Areas (ZCTAs) with real coordinates

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
    console.log(`Fetching ZIP codes within ${radiusMiles} miles of ${latitude}, ${longitude}`);

    // Step 1: Find nearby ZIP codes using Census Geocoder
    const nearbyZips = await findNearbyZipCodes(latitude, longitude, radiusMiles);

    if (nearbyZips.length === 0) {
      return res.status(200).json({
        success: true,
        center: { lat: latitude, lng: longitude },
        radius: radiusMiles,
        blocks: [],
        totalBlocks: 0,
        estimatedAddresses: 0,
        message: 'No ZIP codes found in this area'
      });
    }

    console.log(`Found ${nearbyZips.length} ZIP codes:`, nearbyZips.map(z => z.zip).join(', '));

    // Step 2: Fetch demographic data for these ZIP codes from Census ACS
    const zipDemographics = await fetchZipDemographics(nearbyZips.map(z => z.zip));

    // Step 3: Combine coordinates with demographics
    const enrichedZips = nearbyZips.map(zipInfo => {
      const demographics = zipDemographics[zipInfo.zip] || {};

      return {
        geoId: zipInfo.zip,
        name: `ZIP ${zipInfo.zip}`,
        zip: zipInfo.zip,
        lat: zipInfo.lat,
        lng: zipInfo.lng,
        distance: zipInfo.distance,
        households: demographics.households || 0,
        medianIncome: demographics.medianIncome || 0,
        medianAge: demographics.medianAge || 0,
        medianHomeValue: demographics.medianHomeValue || 0,
        ownerOccupiedRate: demographics.ownershipRate || 0,
        renterOccupiedRate: demographics.renterRate || 0,
      };
    });

    // Filter out ZIPs with no household data
    const validZips = enrichedZips.filter(z => z.households > 0);

    const totalAddresses = validZips.reduce((sum, z) => sum + z.households, 0);

    console.log(`Returning ${validZips.length} ZIPs with ${totalAddresses} total households`);

    return res.status(200).json({
      success: true,
      center: { lat: latitude, lng: longitude },
      radius: radiusMiles,
      blocks: validZips,
      totalBlocks: validZips.length,
      estimatedAddresses: totalAddresses,
    });

  } catch (error) {
    console.error('Error fetching census data:', error);

    return res.status(500).json({
      error: 'Failed to fetch census data',
      message: error.message,
    });
  }
}

// Find ZIP codes within radius using free ZIPCodeAPI
async function findNearbyZipCodes(lat, lng, radiusMiles) {
  try {
    // Using free zip-codes.com API (no key required, rate limited)
    const url = `https://www.zipcodeapi.com/rest/js-Yz0dqQJMDQ8AGl7NKrWbMnrp8p8Mc0CRDJw5JvRCSDGcGOy9HShTFDFx9hshEHJ5/radius.json/${lng}/${lat}/${radiusMiles}/mile`;

    try {
      const response = await fetch(url, { timeout: 5000 });
      if (response.ok) {
        const data = await response.json();
        if (data.zip_codes && Array.isArray(data.zip_codes)) {
          return data.zip_codes.map(z => ({
            zip: z.zip_code,
            lat: parseFloat(z.latitude),
            lng: parseFloat(z.longitude),
            distance: parseFloat(z.distance)
          }));
        }
      }
    } catch (apiError) {
      console.log('ZIPCodeAPI failed, using fallback method');
    }

    // Fallback: Use Census Geocoder + manual radius calculation
    return await fallbackZipSearch(lat, lng, radiusMiles);

  } catch (error) {
    console.error('Error finding nearby ZIP codes:', error);
    return [];
  }
}

// Fallback method using Census Geocoder
async function fallbackZipSearch(lat, lng, radiusMiles) {
  try {
    // Step 1: Get the center ZIP code
    const centerUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const centerResponse = await fetch(centerUrl);
    const centerData = await centerResponse.json();

    let centerZip = null;
    if (centerData.result?.geographies?.['ZIP Code Tabulation Areas']) {
      const zctas = centerData.result.geographies['ZIP Code Tabulation Areas'];
      if (zctas.length > 0) {
        centerZip = zctas[0].ZCTA5;
      }
    }

    if (!centerZip) {
      console.log('Could not determine center ZIP code');
      return [];
    }

    console.log(`Center ZIP: ${centerZip}`);

    // Step 2: Get surrounding ZIP codes (simplified grid search)
    const zips = await getSurroundingZips(lat, lng, radiusMiles);

    return zips;

  } catch (error) {
    console.error('Fallback ZIP search failed:', error);
    return [];
  }
}

// Get surrounding ZIPs by checking a grid of points
async function getSurroundingZips(centerLat, centerLng, radiusMiles) {
  const zipsFound = new Map();

  // Convert miles to approximate degrees (rough estimate: 1 degree ≈ 69 miles)
  const degreeRange = radiusMiles / 69;
  const step = degreeRange / 4; // Create a 5x5 grid

  const points = [];
  for (let latOffset = -degreeRange; latOffset <= degreeRange; latOffset += step) {
    for (let lngOffset = -degreeRange; lngOffset <= degreeRange; lngOffset += step) {
      const testLat = centerLat + latOffset;
      const testLng = centerLng + lngOffset;

      // Check if point is within radius
      const distance = calculateDistance(centerLat, centerLng, testLat, testLng);
      if (distance <= radiusMiles) {
        points.push({ lat: testLat, lng: testLng, distance });
      }
    }
  }

  console.log(`Checking ${points.length} grid points for ZIP codes...`);

  // Batch geocode points (limit to avoid rate limits)
  const maxPoints = Math.min(points.length, 25);
  for (let i = 0; i < maxPoints; i++) {
    const point = points[i];

    try {
      const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${point.lng}&y=${point.lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.result?.geographies?.['ZIP Code Tabulation Areas']) {
        const zctas = data.result.geographies['ZIP Code Tabulation Areas'];
        zctas.forEach(zcta => {
          const zip = zcta.ZCTA5;
          if (!zipsFound.has(zip)) {
            // Store with approximate centroid (the point we found it at)
            zipsFound.set(zip, {
              zip,
              lat: point.lat,
              lng: point.lng,
              distance: point.distance.toFixed(2)
            });
          }
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`Error geocoding point ${i}:`, error.message);
    }
  }

  return Array.from(zipsFound.values());
}

// Fetch demographic data for multiple ZIP codes from Census ACS
async function fetchZipDemographics(zipCodes) {
  const demographics = {};

  if (zipCodes.length === 0) {
    return demographics;
  }

  try {
    // Use ACS 5-Year estimates for ZCTA (ZIP Code Tabulation Areas)
    const year = 2021;
    const variables = [
      'B19013_001E', // Median household income
      'B01002_001E', // Median age
      'B25077_001E', // Median home value
      'B25003_001E', // Total occupied units
      'B25003_002E', // Owner occupied
      'B25003_003E', // Renter occupied
    ].join(',');

    const censusApiKey = process.env.CENSUS_API_KEY || '';

    // Fetch data for each ZIP (can batch up to ~50 at a time)
    const batchSize = 10;
    for (let i = 0; i < zipCodes.length; i += batchSize) {
      const batch = zipCodes.slice(i, i + batchSize);

      for (const zip of batch) {
        try {
          const url = `https://api.census.gov/data/${year}/acs/acs5?get=NAME,${variables}&for=zip%20code%20tabulation%20area:${zip}${censusApiKey ? `&key=${censusApiKey}` : ''}`;

          const response = await fetch(url);

          if (response.ok) {
            const data = await response.json();

            if (data.length > 1) {
              const headers = data[0];
              const values = data[1];

              const getVal = (varName) => {
                const idx = headers.indexOf(varName);
                return idx >= 0 ? parseInt(values[idx]) : 0;
              };

              const totalHouseholds = getVal('B25003_001E');
              const ownerOccupied = getVal('B25003_002E');
              const ownershipRate = totalHouseholds > 0 ? (ownerOccupied / totalHouseholds) * 100 : 0;

              demographics[zip] = {
                households: totalHouseholds,
                medianIncome: getVal('B19013_001E'),
                medianAge: getVal('B01002_001E'),
                medianHomeValue: getVal('B25077_001E'),
                ownershipRate: ownershipRate.toFixed(1),
                renterRate: (100 - ownershipRate).toFixed(1),
              };
            }
          }
        } catch (zipError) {
          console.error(`Error fetching data for ZIP ${zip}:`, zipError.message);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

  } catch (error) {
    console.error('Error fetching ZIP demographics:', error);
  }

  return demographics;
}

// Calculate distance between two points (Haversine formula)
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
