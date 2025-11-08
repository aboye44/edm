// Netlify Function to proxy USPS EDDM API requests
// This avoids CORS issues by making the request from the server
// Uses native fetch API (Node 18+)

exports.handler = async (event, context) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Get ZIP code from query parameters
  const { zip } = event.queryStringParameters;

  if (!zip) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'ZIP code is required' })
    };
  }

  // Validate ZIP code (5 digits)
  if (!/^\d{5}$/.test(zip)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid ZIP code format' })
    };
  }

  try {
    // Make request to USPS EDDM API
    // FIXED: Remove Rte_Box parameter to get ALL routes (city + rural)
    // Rte_Box values: R = Routes only, B = P.O. Boxes only
    // Omitting the parameter returns both city (C) and rural (R) carrier routes
    const uspsUrl = `https://gis.usps.com/arcgis/rest/services/EDDM/selectZIP/GPServer/routes/execute?f=json&env:outSR=4326&ZIP=${zip}&UserName=EDDM`;

    console.log(`Fetching ALL EDDM carrier routes for ZIP ${zip}`);

    const response = await fetch(uspsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EDDMPlanner/1.0)'
      }
    });

    if (!response.ok) {
      throw new Error(`USPS API returned status ${response.status}`);
    }

    const data = await response.json();

    // Return the data with CORS headers
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('Error fetching EDDM routes:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Failed to fetch EDDM routes',
        message: error.message
      })
    };
  }
};
