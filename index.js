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
let isProcessingCancelled = false;

// --- API Configuration ---
// Use a relative URL. Vercel automatically routes requests starting with /api
// to the serverless function in the /api directory.
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
 * Normalizes a domain string by cleaning it up.
 */
function normalizeDomain(domainStr) {
    let cleanedDomain = domainStr.trim().toLowerCase();
    cleanedDomain = cleanedDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    cleanedDomain = cleanedDomain.split('/')[0];
    return cleanedDomain;
}

/**
 * Checks a batch of domains by calling the backend service.
 * This version throws an error on failure, which is caught by the caller.
 */
async function checkDomainsWithBackend(domains) {
    const response = await fetch(BACKEND_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend API error:', response.status, errorText);
        // Throw an error to be caught by the calling function's try/catch block
        throw new Error(`Backend API failed with status ${response.status}: ${errorText}`);
    }
    
    const results = await response.json();
    return results;
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
        const domains = response.text.trim().split('\n').filter(Boolean);
        return domains;
    } catch (error) {
        console.error("Error generating domain ideas:", error);
        alert("Could not generate domain ideas. Please check the console for details.");
        return [];
    }
}

/**
 * Uses Gemini API to categorize a list of available domains.
 */
async function categorizeDomains(domains) {
    if (domains.length === 0) return [];
    const prompt = `Categorize the following list of domain names into logical groups like "Business", "Technology", "Creative", "Short & Brandable", etc. The domains are: ${domains.join(', ')}`;
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
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

        return JSON.parse(response.text);
    } catch(error) {
        console.error("Error categorizing domains:", error);
        // Fallback: return a single "Uncategorized" bucket
        return [{ category: "Available Domains", domains }];
    }
}


// --- Main Event Handlers ---
analyzeButton.addEventListener('click', async () => {
    setLoading(true);
    clearResults();
    isProcessingCancelled = false;

    let domains = [];

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
    
    try {
        const BATCH_SIZE = 50;
        let checkedCount = 0;
        const totalDomains = domains.length;
        const allAvailableDomains = [];
        
        // Initial summary display
        updateSummary(checkedCount, totalDomains, allAvailableDomains);

        for (let i = 0; i < totalDomains; i += BATCH_SIZE) {
            if (isProcessingCancelled) {
                console.log("Processing cancelled by user.");
                break;
            }

            const batch = domains.slice(i, i + BATCH_SIZE);
            const results = await checkDomainsWithBackend(batch);
            
            const availableInBatch = results
                .filter(r => r.availability === 'Available')
                .map(r => r.domain);
            allAvailableDomains.push(...availableInBatch);

            checkedCount += batch.length;
            updateProgress(checkedCount, totalDomains);
            updateSummary(checkedCount, totalDomains, allAvailableDomains);
        }
        
        if (allAvailableDomains.length > 0) {
            buttonText.textContent = "Categorizing...";
            const categorized = await categorizeDomains(allAvailableDomains);
            displayResults(categorized, allAvailableDomains); // Pass all for copy all button
            displayActions();
        } else {
             placeholderResults.innerHTML = isProcessingCancelled ? '<p>Process cancelled.</p>' : '<p>No available domains found.</p>';
             placeholderResults.style.display = 'block';
        }

    } catch (error) {
        console.error("An unexpected error occurred:", error);
        placeholderResults.innerHTML = `<p style="color: var(--error-color);">An unexpected error occurred. Please check the console.</p>`;
        placeholderResults.style.display = 'block';
    } finally {
        setLoading(false);
    }
});


cancelButton.addEventListener('click', () => {
    isProcessingCancelled = true;
});


csvUploadInput.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.files || input.files.length === 0) {
        return;
    }

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
            // Switch to checker mode if not already
            setMode('checker');
        } else {
            alert('No domains found in the file.');
        }
    };

    reader.onerror = () => {
        alert('Error reading the file.');
    };
    
    reader.readAsText(file);
    input.value = ''; // Allow re-uploading the same file
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
    if (categorizedDomains.length === 0) {
        return;
    }

    // Add a final 'Copy All' button to the summary
     const summaryHeader = summaryContainer.querySelector('.summary-item:last-child .summary-header');
    if (summaryHeader && allAvailableDomains.length > 0) {
        summaryHeader.innerHTML += `<button id="copy-all-button" title="Copy all available domains">Copy All</button>`;
        setupCopyListener('copy-all-button', allAvailableDomains.join('\n'));
    }

    placeholderResults.style.display = 'none';
    resultsView.style.display = 'block';
    resultsView.innerHTML = categorizedDomains.map((cat, index) => `
        <details class="category-accordion" ${index === 0 ? 'open' : ''}>
            <summary>
                <div class="category-header">
                    <h2>${cat.category} (${cat.domains.length})</h2>
                    <button class="copy-cat-button" data-category-index="${index}" title="Copy domains in this category">Copy</button>
                </div>
            </summary>
            <div class="domain-list">
                ${cat.domains.map(d => `<p>${d}</p>`).join('')}
            </div>
        </details>
    `).join('');
    
    // Add event listeners for the new copy buttons
    document.querySelectorAll('.copy-cat-button').forEach(button => {
        const catIndex = parseInt(button.dataset.categoryIndex, 10);
        const domainsToCopy = categorizedDomains[catIndex].domains.join('\n');
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

function setupCopyListener(buttonOrId, textToCopy) {
    const button = typeof buttonOrId === 'string' ? document.getElementById(buttonOrId) : buttonOrId;
    if (!button) return;

    // Remove old listeners to prevent multiple fires by replacing the node.
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    const handler = () => {
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = newButton.textContent;
            newButton.textContent = 'Copied!';
            newButton.disabled = true;
            setTimeout(() => {
                newButton.textContent = originalText;
                newButton.disabled = false;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert('Failed to copy.');
        });
    };

    newButton.addEventListener('click', handler);
}

function setLoading(isLoading) {
    // Disable mode switch during processing
    modeCheckerButton.disabled = isLoading;
    modeGeneratorButton.disabled = isLoading;

    if (isLoading) {
        analyzeButton.disabled = true;
        buttonText.style.display = 'none';
        spinner.style.display = 'block';
        analyzeButton.style.width = '50px'; // Shrink to circle
        cancelButton.style.display = 'inline-flex';
        progressContainer.style.display = 'block';
        progressBar.value = 0;
    } else {
        analyzeButton.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        analyzeButton.style.width = ''; // Reset width
        cancelButton.style.display = 'none';
        progressContainer.style.display = 'none';
        // Reset button text based on mode after processing
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
