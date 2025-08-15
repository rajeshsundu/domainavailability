// /api/check-domains.js

// This function is the entry point for the Vercel serverless function.
export default async function handler(request, response) {
    // 1. Set CORS headers to allow requests from your frontend
    // In production, you should restrict this to your actual domain for security.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle pre-flight requests for CORS
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Get the domains from the request body
    const { domains } = request.body;

    if (!domains || !Array.isArray(domains) || domains.length === 0) {
        return response.status(400).json({ error: 'Domains must be a non-empty array.' });
    }
    
    // 3. Securely get your API credentials from Vercel Environment Variables
    // DO NOT HARDCODE THESE VALUES HERE.
    const API_USER = process.env.NAMECHEAP_API_USER;
    const API_KEY = process.env.NAMECHEAP_API_KEY;
    const CLIENT_IP = request.headers['x-forwarded-for'] || '127.0.0.1'; // Namecheap requires your server's IP

    if (!API_USER || !API_KEY) {
        console.error("API credentials are not set in environment variables.");
        return response.status(500).json({ error: 'Server configuration error.' });
    }

    // 4. Construct the URL and call the registrar's API
    // This is a simplified example for Namecheap's API.
    const domainList = domains.join(',');
    const namecheapApiUrl = `https://api.namecheap.com/xml.response?ApiUser=${API_USER}&ApiKey=${API_KEY}&UserName=${API_USER}&Command=namecheap.domains.check&ClientIp=${CLIENT_IP}&DomainList=${domainList}`;

    try {
        const apiResponse = await fetch(namecheapApiUrl);
        const xmlText = await apiResponse.text();

        // 5. Parse the XML response from Namecheap and format it for our frontend.
        // A real implementation would use an XML parsing library.
        // For this example, we'll do a simple text check.
        const results = domains.map(domain => {
            const isAvailable = xmlText.includes(`<DomainCheckResult Domain="${domain}" Available="true"`);
            return {
                domain: domain,
                availability: isAvailable ? 'Available' : 'Unavailable'
            };
        });

        // 6. Send the final results back to the frontend
        return response.status(200).json(results);

    } catch (error) {
        console.error('Error calling Namecheap API:', error);
        return response.status(500).json({ error: 'Failed to check domains.' });
    }
}
