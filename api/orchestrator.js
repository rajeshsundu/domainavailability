import { GoogleGenAI, Type } from '@google/genai';

// Vercel Edge Functions environment config
export const config = {
  runtime: 'edge',
};

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

    try {
        const { mode, domains: initialDomains, keywords, tlds } = await req.json();

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const writer = controller.getWriter();
                
                try {
                    let domainsToCheck = initialDomains || [];

                    // --- Step 1: Generate Domains ---
                    if (mode === 'generator') {
                        if (!keywords || !tlds) throw new Error('Keywords and TLDs are required for generator mode.');
                        
                        const prompt = `Generate a creative list of 30 domain names based on the following keywords: "${keywords}". Only include domains with the following extensions (TLDs): ${tlds}. The output should be a single plain text list of domain names, one per line. Do not include any other text or formatting.`;
                        
                        writeToStream(encoder, writer, 'status', 'Generating domain ideas...');
                        const genResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
                        
                        const generatedDomains = genResponse.text.trim().split('\n').filter(Boolean);
                        domainsToCheck = [...new Set(generatedDomains)];
                        
                        writeToStream(encoder, writer, 'generated_domains', { domains: domainsToCheck });
                    }

                    if (domainsToCheck.length === 0) throw new Error('No domains to check.');

                    // --- Step 2: Check Availability ---
                    writeToStream(encoder, writer, 'status', 'Checking domain availability...');
                    const allAvailableDomains = [];
                    const totalDomains = domainsToCheck.length;
                    
                    const BATCH_SIZE = 10;
                    for (let i = 0; i < totalDomains; i += BATCH_SIZE) {
                        const batch = domainsToCheck.slice(i, i + BATCH_SIZE);
                        const promises = batch.map(checkDomainAvailability);
                        const results = await Promise.all(promises);

                        const availableInBatch = results.filter(r => r.availability === 'Available').map(r => r.domain);
                        allAvailableDomains.push(...availableInBatch);
                        
                        const checkedCount = Math.min(i + BATCH_SIZE, totalDomains);
                        writeToStream(encoder, writer, 'progress', { checked: checkedCount, total: totalDomains, available: allAvailableDomains.length });
                    }
                    
                    // --- Step 3: Categorize Available Domains ---
                    if (allAvailableDomains.length > 0) {
                        writeToStream(encoder, writer, 'status', 'Categorizing available domains...');
                        const prompt = `Categorize the following list of available domain names into logical groups like "Business", "Technology", "Creative", "Short & Brandable", etc. The domains are: ${allAvailableDomains.join(', ')}`;

                        const catResponse = await ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: prompt,
                            config: {
                                responseMimeType: "application/json",
                                responseSchema: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            category: { type: Type.STRING },
                                            domains: { type: Type.ARRAY, items: { type: Type.STRING } }
                                        }
                                    }
                                }
                            }
                        });
                        
                        const categorizedDomains = JSON.parse(catResponse.text);
                        writeToStream(encoder, writer, 'results', { categorized: categorizedDomains, allAvailable: allAvailableDomains });
                    } else {
                        writeToStream(encoder, writer, 'no_results', {});
                    }
                    
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
