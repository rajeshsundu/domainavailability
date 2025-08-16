// Helper to check domain availability via Cloudflare DNS over HTTPS
async function checkDomainAvailability(domain) {
    try {
        // Use a timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

        const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, {
            headers: { 'accept': 'application/dns-json' },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await response.json();
        // NXDOMAIN (status 3) means the domain does not exist, so it's likely available.
        if (data.Status === 3) {
            return { domain, availability: 'Available' };
        }
        return { domain, availability: 'Unavailable' };
    } catch (error) {
        // Distinguish between timeout and other errors
        const availability = error.name === 'AbortError' ? 'Timeout' : 'Error';
        console.error(`Error checking domain ${domain}:`, availability, error.message);
        return { domain, availability };
    }
}

// Main handler function for the API endpoint
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const { domains } = await req.json();

        if (!domains || !Array.isArray(domains) || domains.length === 0) {
            return new Response(JSON.stringify({ error: 'Invalid input: "domains" array is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Check all domains in parallel
        const checkPromises = domains.map(checkDomainAvailability);
        const results = await Promise.all(checkPromises);

        return new Response(JSON.stringify(results), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (e) {
        console.error('Handler error:', e);
        return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
