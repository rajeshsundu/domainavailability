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
const placeholderResults = document.getElementById('placeholder-results');
const resultsView = document.getElementById('results-view');
const actionsContainer = document.getElementById('actions-container');

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
let availableDomains = [];

// --- API Configuration ---
const API_ORCHESTRator_URL = '/api/orchestrator';

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
        if (rawDomains.length === 0) {
            alert("Please paste or upload a list of domains.");
            setLoading(false);
            return;
        }
        const domains = [...new Set(rawDomains.map(normalizeDomain))];
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
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error) { errorMessage = errorJson.error; }
            } catch (e) { /* Not a JSON error */ }
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
    if (!input.files || input.files.length === 0) { return; }

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

// Add event listener to normalize domains on blur for better UX
domainInput.addEventListener('blur', () => {
    const rawDomains = domainInput.value.split('\n').map(d => d.trim()).filter(Boolean);
    if (rawDomains.length > 0) {
        const normalizedDomains = [...new Set(rawDomains.map(normalizeDomain))];
        domainInput.value = normalizedDomains.join('\n');
    }
});


// --- UI Update Functions ---

/**
 * Handles events from the backend stream to update the UI in real-time.
 */
function handleStreamEvent(event, data) {
    try {
        switch (event) {
            case 'status':
                buttonText.textContent = data;
                break;

            case 'domain_list':
                placeholderResults.style.display = 'none';
                resultsView.style.display = 'block';
                resultsView.innerHTML = data.domains.map(domain => `
                    <div class="domain-result-row" id="domain-row-${domain.replace(/\./g, '-')}">
                        <span class="domain-name">${domain}</span>
                        <span class="domain-status checking...">Checking...</span>
                    </div>
                `).join('');
                break;

            case 'domain_result':
                const row = document.getElementById(`domain-row-${data.domain.replace(/\./g, '-')}`);
                if (row) {
                    const statusEl = row.querySelector('.domain-status');
                    statusEl.textContent = data.availability;
                    // Use class names that are valid, e.g., 'checking' instead of 'checking...'
                    statusEl.className = 'domain-status ' + data.availability.toLowerCase().replace(/[^a-z]/g, '');
                    if (data.availability === 'Available') {
                        availableDomains.push(data.domain);
                    }
                }
                break;
            
            case 'finished':
                if (availableDomains.length > 0) {
                    displayActions();
                }
                buttonText.textContent = "Finished!";
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

function displayActions() {
    actionsContainer.innerHTML = `
        <a href="https://www.namecheap.com/domains/registration/results/?type=beast" target="_blank" rel="noopener noreferrer" class="action-button">
            Bulk Register on Namecheap
        </a>
    `;
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
    } else {
        analyzeButton.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        analyzeButton.style.width = '';
        cancelButton.style.display = 'none';
        setMode(currentMode);
    }
}

function clearResults() {
    resultsView.innerHTML = '';
    resultsView.style.display = 'none';
    actionsContainer.innerHTML = '';
    placeholderResults.innerHTML = '<p>Your availability results will appear here, updated in real-time.</p>';
    placeholderResults.style.display = 'block';
    availableDomains = []; // Reset available domains list
}

// Initialize default mode
setMode('checker');
