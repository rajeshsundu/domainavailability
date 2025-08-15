import { GoogleGenAI } from '@google/genai';

// Helper to write Server-Sent Events to the stream
function writeToStream(encoder, writer, event, data) {
    const jsonString = JSON.stringify({ event, data });
    writer.write(encoder.encode(`data: ${jsonString}\n\n`));
}

// Helper to check domain availability via Cloudflare DNS over HTTPS
async function checkDomainAvailability(domain) {
    try {
        const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, {
            headers: { 'accept': 'application/dns-json' },
        });
        const data = await response.json();
        // NXDOMAIN (status 3) means the domain does not exist, so it's likely available.
        if (data.Status === 3) {
            return { domain, availability: 'Available' };
        }
        return { domain, availability: 'Unavailable' };
    } catch (error) {
        console.error(`Error checking domain ${domain}:`, error);
        return { domain, availability: 'Error' };
    }
}

// Main handler function for the API endpoint
export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Server configuration error: API_KEY is missing.' }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
    const ai = new GoogleGenAI({ apiKey });

    try {
        const { mode, domains: initialDomains, keywords, tlds } = await req.json();

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const writer = controller.getWriter();
                
                try {
                    let domainsToCheck = initialDomains || [];

                    // --- Step 1: Generate Domains (if in generator mode) ---
                    if (mode === 'generator') {
                        if (!keywords || !tlds) throw new Error('Keywords and TLDs are required for generator mode.');
                        
                        const prompt = `Generate a creative list of 20 domain names based on the keywords: "${keywords}". Only include domains with TLDs: ${tlds}. Output a plain text list of domain names, one per line.`;
                        
                        writeToStream(encoder, writer, 'status', 'Generating ideas...');
                        const genResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
                        
                        const generatedDomains = genResponse.text.trim().split('\n').filter(Boolean);
                        domainsToCheck = [...new Set(generatedDomains)];
                    }

                    if (domainsToCheck.length === 0) throw new Error('No domains to check.');

                    // --- Step 2: Send the full list to the client to render the initial UI ---
                    writeToStream(encoder, writer, 'domain_list', { domains: domainsToCheck });
                    writeToStream(encoder, writer, 'status', `Checking ${domainsToCheck.length} domains...`);

                    // --- Step 3: Check domains in parallel and stream results as they complete ---
                    const checkPromises = domainsToCheck.map(domain =>
                        checkDomainAvailability(domain)
                            .then(result => {
                                writeToStream(encoder, writer, 'domain_result', result);
                            })
                            .catch(err => {
                                // This handles unexpected errors in checkDomainAvailability itself
                                writeToStream(encoder, writer, 'domain_result', { domain, availability: 'Error' });
                            })
                    );

                    await Promise.all(checkPromises);

                    writeToStream(encoder, writer, 'finished', { message: 'All domains checked.' });
                    
                } catch (error) {
                    console.error('Stream error:', error);
                    writeToStream(encoder, writer, 'error', { message: error.message || 'An unknown error occurred.' });
                } finally {
                    writer.close();
                }
            }
        });
        
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (e) {
        console.error('Handler error:', e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
