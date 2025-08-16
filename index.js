/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";

// --- DOM Element Selectors ---
const domainInput = document.getElementById('domain-input');
const analyzeButton = document.getElementById('analyze-button');
const cancelButton = document.getElementById('cancel-button');
const buttonText = analyzeButton.querySelector('.button-text');
const spinner = analyzeButton.querySelector('.spinner');
const summaryContainer = document.getElementById('summary');
const placeholderResults = document.getElementById('placeholder-results');
const resultsView = document.getElementById('results-view');
const actionsContainer = document.getElementById('actions-container');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

// Mode switching elements
const modeCheckerButton = document.getElementById('mode-checker');
const modeGeneratorButton = document.getElementById('mode-generator');
const checkerPanel = document.getElementById('checker-panel');
const generatorPanel = document.getElementById('generator-panel');
const keywordsInput = document.getElementById('keywords-input');
const tldsInput = document.getElementById('tlds-input');
const csvUploadInput = document.getElementById('csv-upload');

// --- State ---
let currentMode = 'checker';
let currentAbortController = null;

// --- API Configuration ---
const BACKEND_API_URL = '/api/check-domains';

// --- Gemini API Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- Mode Switching Logic ---
function setMode(mode) {
    currentMode = mode;
    if (mode === 'checker') {
        modeCheckerButton.classList.add('active');
        modeCheckerButton.setAttribute('aria-pressed', 'true');
        modeGeneratorButton.classList.remove('active');
        modeGeneratorButton.setAttribute('aria-pressed', 'false');
        checkerPanel.style.display = 'block';
        generatorPanel.style.display = 'none';
        buttonText.textContent = 'Find Available Domains';
    } else {
        modeGeneratorButton.classList.add('active');
        modeGeneratorButton.setAttribute('aria-pressed', 'true');
        modeCheckerButton.classList.remove('active');
        modeCheckerButton.setAttribute('aria-pressed', 'false');
        generatorPanel.style.display = 'block';
        checkerPanel.style.display = 'none';
        buttonText.textContent = 'Generate & Check Domains';
    }
}

modeCheckerButton.addEventListener('click', () => setMode('checker'));
modeGeneratorButton.addEventListener('click', () => setMode('generator'));

// --- Core Functions ---

/**
 * Normalizes a domain string by removing protocol, www, paths, and converting to lowercase.
 */
function normalizeDomain(domainStr) {
    let cleanedDomain = domainStr.trim().toLowerCase();
    cleanedDomain = cleanedDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    cleanedDomain = cleanedDomain.split('/')[0];
    return cleanedDomain;
}

/**
 * Checks a batch of domains by calling the backend service.
 */
async function checkDomainsWithBackend(domains, signal) {
    const response = await fetch(BACKEND_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
        signal: signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend API error:', response.status, errorText);
        throw new Error(`The server returned an error. Please try again later.`);
    }
    
    return response.json();
}

/**
 * Uses Gemini API to generate domain ideas.
 */
async function generateDomainIdeas(keywords, tlds) {
    const prompt = `Generate a creative list of 30 domain names based on the following keywords: "${keywords}".
Only include domains with the following extensions (TLDs): ${tlds}.
The output should be a single plain text list of domain names, one per line. Do not include any other text or formatting.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text.trim().split('\n').filter(Boolean);
    } catch (error) {
        console.error("Error generating domain ideas:", error);
        alert("Could not generate domain ideas. Please check the console for details.");
        return [];
    }
}

/**
 * Safely parses a JSON string that might be wrapped in markdown code fences.
 */
function safeJsonParse(jsonString) {
    const cleanedString = jsonString.trim().replace(/^```json\s*|```\s*$/g, '');
    try {
        return JSON.parse(cleanedString);
    } catch (error) {
        console.error("Failed to parse cleaned JSON string:", cleanedString, error);
        throw new Error("Invalid JSON response from AI model.");
    }
}

/**
 * Uses Gemini API to categorize a list of available domains.
 */
async function categorizeDomains(domains) {
    if (domains.length === 0) return [];
    const prompt = `Categorize the following list of available domain names into logical groups like "Business", "Technology", "Creative", "Short & Brandable", etc. The domains are: ${domains.join(', ')}`;
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    description: "A list of domain categories.",
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
        return safeJsonParse(response.text);
    } catch(error) {
        console.error("Error categorizing domains:", error);
        return [{ category: "Available Domains", domains }];
    }
}

// --- Main Event Handlers ---
analyzeButton.addEventListener('click', async () => {
    setLoading(true);
    clearResults();
    currentAbortController = new AbortController();

    let domains = [];
    let isCancelled = false;

    try {
        if (currentMode === 'checker') {
            const rawDomains = domainInput.value.split('\n').map(d => d.trim()).filter(Boolean);
            domains = [...new Set(rawDomains.map(normalizeDomain))];
            if (domains.length === 0) {
                alert("Please paste a list of domains.");
                setLoading(false);
                return;
            }
        } else { // Generator mode
            const keywords = keywordsInput.value;
            const tlds = tldsInput.value;
            if (!keywords || !tlds) {
                alert("Please provide keywords and TLDs to generate domains.");
                setLoading(false);
                return;
            }
            buttonText.textContent = "Generating...";
            domains = await generateDomainIdeas(keywords, tlds);
            if (domains.length === 0) {
                setLoading(false);
                return;
            }
        }
        
        const BATCH_SIZE = 50;
        let checkedCount = 0;
        const totalDomains = domains.length;
        const allAvailableDomains = [];
        
        updateSummary(checkedCount, totalDomains, allAvailableDomains);

        for (let i = 0; i < totalDomains; i += BATCH_SIZE) {
            if (currentAbortController.signal.aborted) {
                isCancelled = true;
                break;
            }

            const batch = domains.slice(i, i + BATCH_SIZE);
            const results = await checkDomainsWithBackend(batch, currentAbortController.signal);
            
            const availableInBatch = results
                .filter(r => r.availability === 'Available')
                .map(r => r.domain);
            allAvailableDomains.push(...availableInBatch);

            checkedCount = Math.min(checkedCount + batch.length, totalDomains);
            updateProgress(checkedCount, totalDomains);
            updateSummary(checkedCount, totalDomains, allAvailableDomains);
        }
        
        if (isCancelled) {
            placeholderResults.innerHTML = '<p>Process cancelled.</p>';
        } else if (allAvailableDomains.length > 0) {
            buttonText.textContent = "Categorizing...";
            const categorized = await categorizeDomains(allAvailableDomains);
            displayResults(categorized, allAvailableDomains);
            displayActions();
        } else {
             placeholderResults.innerHTML = '<p>No available domains found.</p>';
        }
        placeholderResults.style.display = allAvailableDomains.length === 0 || isCancelled ? 'block' : 'none';

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log("Fetch aborted by user cancellation.");
            placeholderResults.innerHTML = '<p>Process cancelled.</p>';
        } else {
            console.error("An unexpected error occurred:", error);
            placeholderResults.innerHTML = `<p style="color: var(--error-color);">${error.message}</p>`;
        }
        placeholderResults.style.display = 'block';

    } finally {
        setLoading(false);
        currentAbortController = null;
    }
});

cancelButton.addEventListener('click', () => {
    if (currentAbortController) {
        currentAbortController.abort();
    }
});

csvUploadInput.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
        const text = e.target?.result;
        if (!text || typeof text !== 'string') {
             alert('File is empty or could not be read.');
             return;
        }
        const domainRegex = /([a-z0-9]+(?:-[a-z0-9]+)*\.)+[a-z]{2,}/gi;
        const matches = text.match(domainRegex);
        
        if (matches && matches.length > 0) {
            const uniqueDomains = [...new Set(matches.map(normalizeDomain))];
            domainInput.value = uniqueDomains.join('\n');
            setMode('checker');
        } else {
            alert('No domains found in the file.');
        }
    };

    reader.onerror = () => { alert('Error reading the file.'); };
    reader.readAsText(file);
    input.value = ''; // Allow re-uploading the same file
});

// Auto-normalize and de-duplicate domains on paste/blur
domainInput.addEventListener('blur', () => {
    const rawDomains = domainInput.value.split('\n').map(d => d.trim()).filter(Boolean);
    if (rawDomains.length > 0) {
        const normalizedDomains = [...new Set(rawDomains.map(normalizeDomain))];
        domainInput.value = normalizedDomains.join('\n');
    }
});

// --- UI Update Functions ---

function updateProgress(checked, total) {
    const percentage = total > 0 ? (checked / total) * 100 : 0;
    progressBar.value = percentage;
}

function updateSummary(checked, total, availableDomains) {
    const availableCount = availableDomains.length;
    summaryContainer.innerHTML = `
        <div class="summary-item">
            <h3>Checked / Total</h3>
            <p>${checked} / ${total}</p>
        </div>
        <div class="summary-item">
            <div class="summary-header">
                <h3>Available</h3>
            </div>
            <p style="color: var(--success-color);">${availableCount}</p>
        </div>
    `;
}

function displayResults(categorizedDomains, allAvailableDomains) {
    if (categorizedDomains.length === 0) return;

    const summaryHeader = summaryContainer.querySelector('.summary-item:last-child .summary-header');
    if (summaryHeader && allAvailableDomains.length > 0) {
        summaryHeader.innerHTML += `<button id="copy-all-button" title="Copy all available domains">Copy All</button>`;
        setupCopyListener(document.getElementById('copy-all-button'), allAvailableDomains.join('\n'));
    }

    placeholderResults.style.display = 'none';
    resultsView.style.display = 'block';
    resultsView.innerHTML = categorizedDomains.map((cat, index) => `
        <details class="category-accordion" ${index === 0 ? 'open' : ''}>
            <summary>
                <div class="category-header">
                    <h2>${cat.category} (${cat.domains.length})</h2>
                    <button class="copy-cat-button" title="Copy domains in this category">Copy</button>
                </div>
            </summary>
            <div class="domain-list">
                ${cat.domains.map(d => `<p>${d}</p>`).join('')}
            </div>
        </details>
    `).join('');
    
    document.querySelectorAll('.copy-cat-button').forEach((button, index) => {
        const domainsToCopy = categorizedDomains[index].domains.join('\n');
        setupCopyListener(button, domainsToCopy);
    });
}

function displayActions() {
    actionsContainer.innerHTML = `
        <a href="https://www.namecheap.com/domains/registration/results/?type=beast" target="_blank" rel="noopener noreferrer" class="action-button">
            Bulk Register on Namecheap
        </a>
    `;
}

/**
 * Attaches a safe click listener to a button for copying text.
 * It replaces the button with a clone to prevent multiple listeners.
 */
function setupCopyListener(button, textToCopy) {
    if (!button) return;
    
    // Replace the button with its clone to remove any old listeners
    const newButton = button.cloneNode(true);
    button.replaceWith(newButton);

    newButton.addEventListener('click', (event) => {
        event.preventDefault(); // Stop accordion from closing
        event.stopPropagation(); // Stop accordion from closing
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = newButton.textContent;
            newButton.textContent = 'Copied!';
            newButton.disabled = true;
            setTimeout(() => {
                newButton.textContent = originalText;
                newButton.disabled = false;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert('Failed to copy text.');
        });
    });
}


function setLoading(isLoading) {
    modeCheckerButton.disabled = isLoading;
    modeGeneratorButton.disabled = isLoading;

    if (isLoading) {
        analyzeButton.disabled = true;
        buttonText.style.display = 'none';
        spinner.style.display = 'block';
        analyzeButton.style.width = '50px';
        cancelButton.style.display = 'inline-flex';
        progressContainer.style.display = 'block';
        progressBar.value = 0;
    } else {
        analyzeButton.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        analyzeButton.style.width = '';
        cancelButton.style.display = 'none';
        progressContainer.style.display = 'none';
        setMode(currentMode);
    }
}

function clearResults() {
    resultsView.innerHTML = '';
    resultsView.style.display = 'none';
    summaryContainer.innerHTML = '';
    actionsContainer.innerHTML = '';
    placeholderResults.innerHTML = '<p>Your availability results will appear here.</p>';
    placeholderResults.style.display = 'block';
    progressContainer.style.display = 'none';
    progressBar.value = 0;
}

// Initialize default mode
setMode('checker');
