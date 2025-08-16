import { GoogleGenAI, Type } from '@google/genai';

// Helper to check domain availability via Cloudflare DNS over HTTPS
async function checkDomainAvailability(domain) {
    try {
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
        const availability = error.name === 'AbortError' ? 'Timeout' : 'Error';
        console.error(`Error checking domain ${domain}:`, availability, error.message);
        return { domain, availability };
    }
}

// Main handler for all API actions
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Server configuration error: API_KEY is missing.' }), { status: 500 });
    }
    const ai = new GoogleGenAI({ apiKey });

    try {
        const { mode, domains, keywords, tlds } = await req.json();

        switch (mode) {
            case 'generate':
                if (!keywords || !tlds) {
                    return new Response(JSON.stringify({ error: 'Keywords and TLDs are required.' }), { status: 400 });
                }
                const genPrompt = `Generate a creative list of 30 domain names based on the following keywords: "${keywords}". Only include domains with the following extensions (TLDs): ${tlds}. The output should be a single plain text list of domain names, one per line. Do not include any other text or formatting.`;
                const genResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: genPrompt });
                const generatedDomains = genResponse.text.trim().split('\n').filter(Boolean);
                return new Response(JSON.stringify({ domains: generatedDomains }), { status: 200, headers: { 'Content-Type': 'application/json' } });

            case 'check':
                if (!domains || !Array.isArray(domains)) {
                    return new Response(JSON.stringify({ error: 'Domains array is required.' }), { status: 400 });
                }
                const checkPromises = domains.map(checkDomainAvailability);
                const results = await Promise.all(checkPromises);
                return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });

            case 'categorize':
                if (!domains || !Array.isArray(domains)) {
                    return new Response(JSON.stringify({ error: 'Domains array is required.' }), { status: 400 });
                }
                const catPrompt = `Categorize the following list of domain names into logical groups like "Business", "Technology", "Creative", "Short & Brandable", etc. The domains are: ${domains.join(', ')}`;
                const catResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: catPrompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    category: { type: Type.STRING, description: 'The name of the category.' },
                                    domains: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'The domains in this category.' }
                                }
                            }
                        }
                    }
                });
                return new Response(catResponse.text, { status: 200, headers: { 'Content-Type': 'application/json' } });

            default:
                return new Response(JSON.stringify({ error: 'Invalid mode specified.' }), { status: 400 });
        }
    } catch (e) {
        console.error('API Orchestrator Error:', e);
        return new Response(JSON.stringify({ error: e.message || 'An internal server error occurred.' }), { status: 500 });
    }
}
