// /api/check-domains.js

// This function is the entry point for the Vercel serverless function.
export default async function handler(request, response) {
    // Set CORS headers to allow requests from any origin.
    // In a real production app, you might restrict this to your actual domain.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle the browser's pre-flight CORS request.
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    // We only want to handle POST requests.
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    // Get the domains array from the body of the frontend's request.
    const { domains } = request.body;
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
        return response.status(400).json({ error: 'Domains must be a non-empty array.' });
    }
    
    // Securely get your GoDaddy API credentials from Vercel Environment Variables.
    const API_KEY = process.env.GODADDY_API_KEY;
    const API_SECRET = process.env.GODADDY_API_SECRET;

    if (!API_KEY || !API_SECRET) {
        console.error("GoDaddy API credentials are not set in environment variables.");
        return response.status(500).json({ error: 'Server configuration error.' });
    }

    // Construct the URL and call the GoDaddy API.
    // Note: The GoDaddy API checks domains in bulk via a POST request, not a GET request.
    const godaddyApiUrl = 'https://api.godaddy.com/v1/domains/available?checkType=FAST';
    
    try {
        const apiResponse = await fetch(godaddyApiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `sso-key ${API_KEY}:${API_SECRET}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(domains), // Send the domain list in the request body
        });
        
        if (!apiResponse.ok) {
            // If GoDaddy returns an error, log it and inform the frontend.
             console.error('GoDaddy API Error:', apiResponse.status, await apiResponse.text());
             return response.status(500).json({ error: 'Failed to check domains due to an API error.' });
        }
        
        const data = await apiResponse.json();
        
        // Format the GoDaddy response to match what our frontend expects.
        const results = data.domains.map(item => ({
            domain: item.domain,
            // GoDaddy's `available` is a boolean, we convert it to our string type.
            availability: item.available ? 'Available' : 'Unavailable'
        }));
        
        // Send the formatted results back to our frontend.
        return response.status(200).json(results);

    } catch (error) {
        console.error('Error calling GoDaddy API:', error);
        return response.status(500).json({ error: 'Failed to connect to the domain checking service.' });
    }
}
