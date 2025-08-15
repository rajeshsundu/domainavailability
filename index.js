/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

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
const API_ORCHESTRATOR_URL = '/api/orchestrator';

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

// --- Main Event Handler (Handles Streaming Response) ---
analyzeButton.addEventListener('click', async () => {
    setLoading(true);
    clearResults();
    isProcessingCancelled = false;

    let requestBody = {};

    if (currentMode === 'checker') {
        const rawDomains = domainInput.value.split('\n').map(d => d.trim()).filter(Boolean);
        const domains = [...new Set(rawDomains.map(normalizeDomain))];
        if (domains.length === 0) {
            alert("Please paste a list of domains.");
            setLoading(false);
            return;
        }
        requestBody = { mode: 'checker', domains };
    } else { // Generator mode
        const keywords = keywordsInput.value;
        const tlds = tldsInput.value;
        if (!keywords || !tlds) {
            alert("Please provide keywords and TLDs to generate domains.");
            setLoading(false);
            return;
        }
        requestBody = { mode: 'generator', keywords, tlds };
    }
    
    try {
        const response = await fetch(API_ORCHESTRATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend Error Response:', errorText);
            let errorMessage = `The server returned an error (${response.status}). Please check the server logs on Vercel for more details.`;
            // Try to parse it as JSON, as our function might return a valid JSON error
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error) {
                    errorMessage = errorJson.error;
                }
            } catch (e) {
                // It wasn't a JSON error, stick with the generic message.
            }
            throw new Error(errorMessage);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            if (isProcessingCancelled) {
                reader.cancel('User cancelled');
                placeholderResults.innerHTML = '<p>Process cancelled.</p>';
                break;
            }

            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n\n');
            buffer = lines.pop(); // Keep the last, possibly incomplete, line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonString = line.substring(6);
                    const { event, data } = JSON.parse(jsonString);
                    handleStreamEvent(event, data);
                }
            }
        }

    } catch (error) {
        console.error("An unexpected error occurred:", error);
        placeholderResults.innerHTML = `<p style="color: var(--error-color);">${error.message}</p>`;
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

/**
 * Handles events from the backend stream to update the UI in real-time.
 * @param {string} event The name of the event.
 * @param {object} data The data payload for the event.
 */
function handleStreamEvent(event, data) {
    try {
        switch (event) {
            case 'status':
                buttonText.textContent = data;
                break;
            case 'generated_domains':
                updateSummary(0, data.domains.length, 0);
                break;
            case 'progress':
                updateProgress(data.checked, data.total);
                updateSummary(data.checked, data.total, data.available);
                break;
            case 'results':
                displayResults(data.categorized, data.allAvailable);
                displayActions();
                break;
            case 'no_results':
                 placeholderResults.innerHTML = '<p>No available domains found from the list.</p>';
                 placeholderResults.style.display = 'block';
                break;
            case 'error':
                throw new Error(`Backend error: ${data.message}`);
        }
    } catch (error) {
         console.error("Stream event handling error:", error);
         placeholderResults.innerHTML = `<p style="color: var(--error-color);">${error.message}</p>`;
         placeholderResults.style.display = 'block';
         setLoading(false);
    }
}


function updateProgress(checked, total) {
    const percentage = total > 0 ? (checked / total) * 100 : 0;
    progressBar.value = percentage;
}

function updateSummary(checked, total, availableCount) {
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
