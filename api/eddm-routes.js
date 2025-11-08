// Vercel Serverless Function to proxy USPS EDDM API requests
// This avoids CORS issues by making the request from the server
// Uses native fetch API (Node 18+)

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get ZIP code from query parameters
  const { zip } = req.query;

  if (!zip) {
    return res.status(400).json({ error: 'ZIP code is required' });
  }

  // Validate ZIP code (5 digits)
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'Invalid ZIP code format' });
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error fetching EDDM routes:', error);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    return res.status(500).json({
      error: 'Failed to fetch EDDM routes',
      message: error.message
    });
  }
}
