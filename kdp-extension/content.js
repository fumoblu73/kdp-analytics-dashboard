// content.js - Advanced KDP Data Extraction for Publisher Champ Clone
console.log('🚀 KDP Analytics Pro: Advanced extraction script loaded on', window.location.href);

// Configuration
const CONFIG = {
    DASHBOARD_URL: 'https://kdp-analytics-dashboard.vercel.app',
    EXTRACTION_INTERVAL: 15000, // 15 seconds
    MAX_RETRY_ATTEMPTS: 3,
    SUPPORTED_CURRENCIES: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
    KDP_DOMAINS: ['kdpreports.amazon.com', 'kdp.amazon.com'],
    ADS_DOMAINS: ['advertising.amazon.com']
};

// Global state
let extractionState = {
    isActive: false,
    lastExtraction: null,
    retryCount: 0,
    extractedBooks: new Map(),
    extractedAds: new Map(),
    currentUser: null,
    observers: [],
    intervalId: null
};

// Data structures for different extraction methods
const EXTRACTION_PATTERNS = {
    // KDP Reports patterns
    kdp: {
        tableSelectors: [
            'table[class*="report"]',
            'table[class*="data"]',
            '.data-table table',
            '[role="table"]',
            '.table-container table'
        ],
        rowSelectors: [
            'tr[class*="row"]',
            'tr[data-*]',
            'tbody tr',
            '[role="row"]'
        ],
        titleSelectors: [
            '[data-title]',
            '.title',
            '.book-title',
            '.product-title',
            'h1, h2, h3, h4',
            'strong',
            'b'
        ],
        moneySelectors: [
            '[data-currency]',
            '.currency',
            '.amount',
            '.royalty',
            '.revenue'
        ]
    },
    // Amazon Ads patterns
    ads: {
        campaignSelectors: [
            '[data-campaign-id]',
            '.campaign-row',
            '[class*="campaign"]'
        ],
        metricsSelectors: [
            '.metric',
            '.performance',
            '[data-metric]'
        ]
    }
};

// Currency conversion rates (updated periodically)
const CURRENCY_RATES = {
    'USD': 0.85, // USD to EUR
    'GBP': 1.15, // GBP to EUR
    'CAD': 0.62, // CAD to EUR
    'AUD': 0.55, // AUD to EUR
    'EUR': 1.00  // EUR base
};

// Initialize extraction system
function initializeExtraction() {
    if (extractionState.isActive) return;
    
    console.log('🎯 Initializing advanced extraction system...');
    
    const currentUrl = window.location.href.toLowerCase();
    
    // Determine extraction type based on URL
    if (isKDPPage(currentUrl)) {
        setupKDPExtraction();
    } else if (isAdsPage(currentUrl)) {
        setupAdsExtraction();
    }
    
    // Setup mutation observers for dynamic content
    setupDynamicObservers();
    
    // Setup periodic extraction
    startPeriodicExtraction();
    
    extractionState.isActive = true;
    extractionState.lastExtraction = new Date().toISOString();
    
    console.log('✅ Advanced extraction system initialized');
}

// Check if current page is KDP
function isKDPPage(url) {
    return CONFIG.KDP_DOMAINS.some(domain => url.includes(domain));
}

// Check if current page is Amazon Ads
function isAdsPage(url) {
    return CONFIG.ADS_DOMAINS.some(domain => url.includes(domain));
}

// Setup KDP-specific extraction
function setupKDPExtraction() {
    console.log('📚 Setting up KDP extraction...');
    
    // Try immediate extraction
    setTimeout(() => {
        performKDPExtraction();
    }, 3000);
    
    // Setup observers for KDP-specific elements
    observeKDPElements();
}

// Setup Amazon Ads extraction
function setupAdsExtraction() {
    console.log('📊 Setting up Amazon Ads extraction...');
    
    setTimeout(() => {
        performAdsExtraction();
    }, 3000);
    
    observeAdsElements();
}

// Perform comprehensive KDP data extraction
async function performKDPExtraction() {
    if (extractionState.isActive && extractionState.retryCount >= CONFIG.MAX_RETRY_ATTEMPTS) {
        console.log('⚠️ Max retry attempts reached for KDP extraction');
        return;
    }
    
    extractionState.retryCount++;
    console.log(`🔍 Performing KDP extraction (attempt ${extractionState.retryCount})...`);
    
    try {
        const extractedData = {
            books: [],
            summary: {},
            metadata: {
                extractedAt: new Date().toISOString(),
                url: window.location.href,
                method: 'advanced_kdp_extraction'
            }
        };
        
        // Method 1: Extract from tables
        const tableBooks = await extractFromKDPTables();
        extractedData.books.push(...tableBooks);
        
        // Method 2: Extract from dashboard widgets
        const widgetBooks = await extractFromKDPWidgets();
        extractedData.books.push(...widgetBooks);
        
        // Method 3: Extract from JSON data
        const jsonBooks = await extractFromPageData();
        extractedData.books.push(...jsonBooks);
        
        // Method 4: Extract from API calls (intercept)
        const apiBooks = await extractFromInterceptedAPIs();
        extractedData.books.push(...apiBooks);
        
        // Process and deduplicate
        const processedBooks = processAndDeduplicateBooks(extractedData.books);
        extractedData.books = processedBooks;
        
        // Generate summary
        extractedData.summary = generateSummary(processedBooks);
        
        console.log(`📚 KDP extraction completed: ${processedBooks.length} books found`);
        
        if (processedBooks.length > 0) {
            await sendDataToDashboard(extractedData);
            extractionState.retryCount = 0; // Reset on success
        }
        
        return extractedData;
        
    } catch (error) {
        console.error('❌ KDP extraction error:', error);
        
        if (extractionState.retryCount < CONFIG.MAX_RETRY_ATTEMPTS) {
            setTimeout(() => {
                performKDPExtraction();
            }, 5000 * extractionState.retryCount); // Exponential backoff
        }
        
        throw error;
    }
}

// Extract books from KDP tables
async function extractFromKDPTables() {
    const books = [];
    const tables = document.querySelectorAll(EXTRACTION_PATTERNS.kdp.tableSelectors.join(', '));
    
    console.log(`🔍 Analyzing ${tables.length} tables for book data...`);
    
    for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        const headers = extractTableHeaders(table);
        
        for (let i = 1; i < rows.length; i++) { // Skip header row
            const row = rows[i];
            const cells = row.querySelectorAll('td, th');
            
            if (cells.length < 3) continue; // Need minimum data
            
            const bookData = extractBookFromTableRow(cells, headers, `table_${i}`);
            if (bookData && isValidBookData(bookData)) {
                books.push(bookData);
            }
        }
    }
    
    console.log(`📊 Found ${books.length} books from tables`);
    return books;
}

// Extract table headers for mapping
function extractTableHeaders(table) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) return [];
    
    return Array.from(headerRow.querySelectorAll('th, td')).map(cell => ({
        text: cell.textContent.trim().toLowerCase(),
        index: Array.from(headerRow.children).indexOf(cell)
    }));
}

// Extract book data from table row using intelligent mapping
function extractBookFromTableRow(cells, headers, source) {
    const bookData = {
        title: '',
        asin: '',
        totalRoyalties: 0,
        totalSales: 0,
        kenpReads: 0,
        kenpRoyalties: 0,
        paperbackSales: 0,
        paperbackRoyalties: 0,
        ebookSales: 0,
        ebookRoyalties: 0,
        hardcoverSales: 0,
        hardcoverRoyalties: 0,
        country: '',
        currency: 'EUR',
        source: source,
        extractedAt: new Date().toISOString()
    };
    
    // Map headers to data extraction
    const headerMap = createHeaderMap(headers);
    
    cells.forEach((cell, index) => {
        const text = cell.textContent.trim();
        const cellType = identifyCellType(text, index, headerMap);
        
        switch (cellType) {
            case 'title':
                if (isLikelyBookTitle(text)) {
                    bookData.title = text;
                }
                break;
                
            case 'asin':
                const asinMatch = text.match(/[A-Z0-9]{10}/);
                if (asinMatch) {
                    bookData.asin = asinMatch[0];
                }
                break;
                
            case 'revenue':
                const revenue = extractMoneyAmount(text);
                if (revenue > 0) {
                    bookData.totalRoyalties = Math.max(bookData.totalRoyalties, revenue);
                }
                break;
                
            case 'sales':
                const sales = extractNumberValue(text);
                if (sales > 0 && sales < 10000) {
                    bookData.totalSales = Math.max(bookData.totalSales, sales);
                }
                break;
                
            case 'kenp':
                const kenp = extractNumberValue(text);
                if (kenp > 0) {
                    bookData.kenpReads = Math.max(bookData.kenpReads, kenp);
                    bookData.kenpRoyalties = kenp * 0.004; // Approximate KENP rate
                }
                break;
                
            case 'country':
                const country = extractCountryCode(text);
                if (country) {
                    bookData.country = country;
                }
                break;
        }
    });
    
    // Post-process and validate
    if (bookData.title && (bookData.totalRoyalties > 0 || bookData.totalSales > 0 || bookData.kenpReads > 0)) {
        return enhanceBookData(bookData);
    }
    
    return null;
}

// Create intelligent header mapping
function createHeaderMap(headers) {
    const map = {
        title: [],
        asin: [],
        revenue: [],
        sales: [],
        kenp: [],
        country: []
    };
    
    headers.forEach(header => {
        const text = header.text.toLowerCase();
        
        if (text.includes('title') || text.includes('book') || text.includes('name')) {
            map.title.push(header.index);
        } else if (text.includes('asin') || text.includes('id')) {
            map.asin.push(header.index);
        } else if (text.includes('royalt') || text.includes('revenue') || text.includes('earning')) {
            map.revenue.push(header.index);
        } else if (text.includes('sales') || text.includes('units') || text.includes('sold')) {
            map.sales.push(header.index);
        } else if (text.includes('kenp') || text.includes('read')) {
            map.kenp.push(header.index);
        } else if (text.includes('country') || text.includes('market')) {
            map.country.push(header.index);
        }
    });
    
    return map;
}

// Identify cell type based on content and position
function identifyCellType(text, index, headerMap) {
    // Check header mapping first
    for (const [type, indices] of Object.entries(headerMap)) {
        if (indices.includes(index)) {
            return type;
        }
    }
    
    // Content-based identification
    if (isLikelyBookTitle(text)) return 'title';
    if (/[A-Z0-9]{10}/.test(text)) return 'asin';
    if (/[$€£¥₹]/.test(text)) return 'revenue';
    if (/^\d{1,4}$/.test(text) && parseInt(text) < 10000) return 'sales';
    if (/^\d{3,}$/.test(text) || text.includes('KENP')) return 'kenp';
    if (/\.(com|co\.uk|de|fr|it|es|ca|au)/.test(text)) return 'country';
    
    return 'unknown';
}

// Extract from dashboard widgets
async function extractFromKDPWidgets() {
    const books = [];
    const widgets = document.querySelectorAll('.widget, .card, .summary, .dashboard-item, .metric-card');
    
    console.log(`🔍 Analyzing ${widgets.length} widgets...`);
    
    widgets.forEach((widget, index) => {
        const bookData = extractBookFromWidget(widget, `widget_${index}`);
        if (bookData && isValidBookData(bookData)) {
            books.push(bookData);
        }
    });
    
    console.log(`📱 Found ${books.length} books from widgets`);
    return books;
}

// Extract book data from widget
function extractBookFromWidget(widget, source) {
    const text = widget.textContent;
    
    // Look for book titles in headings
    const headings = widget.querySelectorAll('h1, h2, h3, h4, h5, h6, .title, .book-title, strong');
    let title = '';
    
    headings.forEach(heading => {
        const headingText = heading.textContent.trim();
        if (isLikelyBookTitle(headingText) && headingText.length > title.length) {
            title = headingText;
        }
    });
    
    if (!title) return null;
    
    const revenue = extractMoneyAmount(text);
    const kenpMatch = text.match(/KENP.*?(\d+)/i);
    const kenpReads = kenpMatch ? parseInt(kenpMatch[1]) : 0;
    
    return {
        title: title,
        totalRoyalties: revenue,
        kenpReads: kenpReads,
        kenpRoyalties: kenpReads * 0.004,
        source: source,
        extractedAt: new Date().toISOString()
    };
}

// Extract from page JavaScript data
async function extractFromPageData() {
    const books = [];
    
    // Look for data in global variables
    const dataSources = [
        'window.kdpData',
        'window.reportData',
        'window.booksData',
        'window.__INITIAL_STATE__',
        'window.__APP_DATA__'
    ];
    
    for (const source of dataSources) {
        try {
            const data = eval(source);
            if (data && typeof data === 'object') {
                const extractedBooks = extractBooksFromObject(data, source);
                books.push(...extractedBooks);
            }
        } catch (error) {
            // Source doesn't exist
        }
    }
    
    // Look for JSON in script tags
    const scriptTags = document.querySelectorAll('script[type="application/json"], script:not([src])');
    scriptTags.forEach((script, index) => {
        try {
            const content = script.textContent || script.innerHTML;
            if (content && content.includes('{')) {
                const data = JSON.parse(content);
                const extractedBooks = extractBooksFromObject(data, `script_${index}`);
                books.push(...extractedBooks);
            }
        } catch (error) {
            // Not valid JSON
        }
    });
    
    console.log(`🌐 Found ${books.length} books from page data`);
    return books;
}

// Extract from intercepted API calls
async function extractFromInterceptedAPIs() {
    // This would require setting up API interception
    // For now, return empty array
    return [];
}

// Amazon Ads extraction
async function performAdsExtraction() {
    console.log('📊 Performing Amazon Ads extraction...');
    
    try {
        const extractedData = {
            campaigns: [],
            keywords: [],
            summary: {},
            metadata: {
                extractedAt: new Date().toISOString(),
                url: window.location.href,
                method: 'amazon_ads_extraction'
            }
        };
        
        // Extract campaigns
        const campaigns = await extractAdsCampaigns();
        extractedData.campaigns = campaigns;
        
        // Extract keywords
        const keywords = await extractAdsKeywords();
        extractedData.keywords = keywords;
        
        // Generate summary
        extractedData.summary = generateAdsSummary(campaigns, keywords);
        
        console.log(`📊 Ads extraction completed: ${campaigns.length} campaigns, ${keywords.length} keywords`);
        
        if (campaigns.length > 0 || keywords.length > 0) {
            await sendAdsDataToDashboard(extractedData);
        }
        
        return extractedData;
        
    } catch (error) {
        console.error('❌ Ads extraction error:', error);
        throw error;
    }
}

// Extract ads campaigns
async function extractAdsCampaigns() {
    const campaigns = [];
    const campaignElements = document.querySelectorAll(EXTRACTION_PATTERNS.ads.campaignSelectors.join(', '));
    
    campaignElements.forEach((element, index) => {
        const campaign = extractCampaignData(element, `campaign_${index}`);
        if (campaign) {
            campaigns.push(campaign);
        }
    });
    
    return campaigns;
}

// Extract ads keywords
async function extractAdsKeywords() {
    // Implementation for keyword extraction
    return [];
}

// Helper functions

function isLikelyBookTitle(text) {
    if (!text || text.length < 3 || text.length > 300) return false;
    
    const lowerText = text.toLowerCase();
    
    // Filter out UI elements
    const uiKeywords = [
        'dashboard', 'report', 'total', 'summary', 'date', 'filter', 'export',
        'view', 'details', 'royalties', 'earnings', 'sales', 'kindle', 'asin'
    ];
    
    if (uiKeywords.some(keyword => lowerText === keyword)) return false;
    
    // Should look like a book title
    const hasLetters = /[a-zA-Z]/.test(text);
    const notOnlyNumbers = !/^\d+$/.test(text);
    const hasValidChars = /^[a-zA-Z0-9\s\-:.,'"!?&()]+$/.test(text);
    
    return hasLetters && notOnlyNumbers && hasValidChars;
}

function extractMoneyAmount(text) {
    const matches = text.match(/[€$£¥₹]\s*[\d,]+\.?\d*/g);
    if (!matches) return 0;
    
    let total = 0;
    matches.forEach(match => {
        const amount = parseFloat(match.replace(/[€$£¥₹,\s]/g, ''));
        if (!isNaN(amount)) {
            total += amount;
        }
    });
    
    return total;
}

function extractNumberValue(text) {
    const match = text.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
}

function extractCountryCode(text) {
    const countryMap = {
        'amazon.com': 'US',
        'amazon.co.uk': 'UK',
        'amazon.de': 'DE',
        'amazon.fr': 'FR',
        'amazon.it': 'IT',
        'amazon.es': 'ES',
        'amazon.ca': 'CA',
        'amazon.com.au': 'AU'
    };
    
    for (const [domain, country] of Object.entries(countryMap)) {
        if (text.includes(domain)) return country;
    }
    
    return 'US'; // Default
}

function isValidBookData(book) {
    return book && 
           book.title && 
           book.title.length > 2 && 
           (book.totalRoyalties > 0 || book.totalSales > 0 || book.kenpReads > 0);
}

function enhanceBookData(book) {
    // Add additional calculated fields
    if (book.kenpReads > 0 && book.kenpRoyalties === 0) {
        book.kenpRoyalties = book.kenpReads * 0.004;
    }
    
    // Ensure country is set
    if (!book.country) {
        book.country = 'US';
    }
    
    // Generate unique ID if missing
    if (!book.id && !book.asin) {
        book.id = crypto.getRandomValues ? 
            Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('') :
            'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    return book;
}

function processAndDeduplicateBooks(books) {
    const bookMap = new Map();
    
    books.forEach(book => {
        if (!isValidBookData(book)) return;
        
        const key = book.asin || book.title.toLowerCase().trim();
        
        if (bookMap.has(key)) {
            // Merge with existing book
            const existing = bookMap.get(key);
            bookMap.set(key, mergeBookData(existing, book));
        } else {
            bookMap.set(key, enhanceBookData(book));
        }
    });
    
    return Array.from(bookMap.values());
}

function mergeBookData(existing, newBook) {
    return {
        ...existing,
        totalRoyalties: Math.max(existing.totalRoyalties || 0, newBook.totalRoyalties || 0),
        totalSales: Math.max(existing.totalSales || 0, newBook.totalSales || 0),
        kenpReads: Math.max(existing.kenpReads || 0, newBook.kenpReads || 0),
        kenpRoyalties: Math.max(existing.kenpRoyalties || 0, newBook.kenpRoyalties || 0),
        asin: existing.asin || newBook.asin,
        country: existing.country || newBook.country,
        lastUpdated: new Date().toISOString()
    };
}

function generateSummary(books) {
    return {
        totalBooks: books.length,
        totalRevenue: books.reduce((sum, book) => sum + (book.totalRoyalties || 0), 0),
        totalSales: books.reduce((sum, book) => sum + (book.totalSales || 0), 0),
        totalReads: books.reduce((sum, book) => sum + (book.kenpReads || 0), 0),
        topBook: books.sort((a, b) => (b.totalRoyalties || 0) - (a.totalRoyalties || 0))[0]
    };
}

function generateAdsSummary(campaigns, keywords) {
    return {
        totalCampaigns: campaigns.length,
        totalKeywords: keywords.length,
        totalSpend: campaigns.reduce((sum, campaign) => sum + (campaign.spend || 0), 0),
        totalClicks: campaigns.reduce((sum, campaign) => sum + (campaign.clicks || 0), 0)
    };
}

// Dynamic observers
function setupDynamicObservers() {
    const observer = new MutationObserver((mutations) => {
        let shouldExtract = false;
        
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        const text = node.textContent || '';
                        if (text.includes(') || 
                            text.includes('€') || 
                            text.includes('KENP') || 
                            text.includes('royalt') ||
                            node.classList?.contains('table') ||
                            node.tagName === 'TABLE') {
                            shouldExtract = true;
                        }
                    }
                });
            }
        });
        
        if (shouldExtract && !extractionState.isActive) {
            setTimeout(() => {
                if (isKDPPage(window.location.href)) {
                    performKDPExtraction();
                } else if (isAdsPage(window.location.href)) {
                    performAdsExtraction();
                }
            }, 2000);
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    extractionState.observers.push(observer);
}

function observeKDPElements() {
    // Additional KDP-specific observers
    const kdpObserver = new MutationObserver(() => {
        const tables = document.querySelectorAll('table');
        if (tables.length > 0) {
            setTimeout(() => performKDPExtraction(), 1000);
        }
    });
    
    kdpObserver.observe(document.body, { childList: true, subtree: true });
    extractionState.observers.push(kdpObserver);
}

function observeAdsElements() {
    // Additional Ads-specific observers
    const adsObserver = new MutationObserver(() => {
        const campaigns = document.querySelectorAll('[data-campaign-id], .campaign-row');
        if (campaigns.length > 0) {
            setTimeout(() => performAdsExtraction(), 1000);
        }
    });
    
    adsObserver.observe(document.body, { childList: true, subtree: true });
    extractionState.observers.push(adsObserver);
}

function startPeriodicExtraction() {
    if (extractionState.intervalId) {
        clearInterval(extractionState.intervalId);
    }
    
    extractionState.intervalId = setInterval(() => {
        if (isKDPPage(window.location.href)) {
            performKDPExtraction();
        } else if (isAdsPage(window.location.href)) {
            performAdsExtraction();
        }
    }, CONFIG.EXTRACTION_INTERVAL);
}

// Communication with dashboard
async function sendDataToDashboard(data) {
    try {
        const response = await fetch(CONFIG.DASHBOARD_URL + '/api/extension/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: data,
                userId: extractionState.currentUser,
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            console.log('📤 Data sent to dashboard successfully');
            chrome.runtime.sendMessage({
                action: 'dataSync',
                success: true,
                data: data
            });
        } else {
            throw new Error('Dashboard sync failed: ' + response.status);
        }
        
    } catch (error) {
        console.error('❌ Error sending data to dashboard:', error);
        
        // Fallback: send to extension storage
        chrome.runtime.sendMessage({
            action: 'saveData',
            data: data
        });
    }
}

async function sendAdsDataToDashboard(data) {
    // Similar to sendDataToDashboard but for ads data
    await sendDataToDashboard({ ads: data });
}

// Extension communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📩 Content script received message:', request);
    
    if (request.action === 'ping') {
        sendResponse({ status: 'active', extractionState });
        return;
    }
    
    if (request.action === 'extractData' || request.action === 'forceSync') {
        console.log('🔄 Force extraction requested');
        
        if (isKDPPage(window.location.href)) {
            performKDPExtraction().then(data => {
                sendResponse({ success: true, data });
            }).catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        } else if (isAdsPage(window.location.href)) {
            performAdsExtraction().then(data => {
                sendResponse({ success: true, data });
            }).catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        } else {
            sendResponse({ success: false, error: 'Not on a supported page' });
        }
        
        return true; // Keep message channel open
    }
    
    if (request.action === 'setUser') {
        extractionState.currentUser = request.userId;
        sendResponse({ success: true });
        return;
    }
    
    if (request.action === 'getState') {
        sendResponse({ success: true, state: extractionState });
        return;
    }
});

// Page lifecycle management
window.addEventListener('beforeunload', () => {
    // Cleanup observers
    extractionState.observers.forEach(observer => observer.disconnect());
    
    if (extractionState.intervalId) {
        clearInterval(extractionState.intervalId);
    }
});

// URL change detection (for SPAs)
let currentUrl = window.location.href;
setInterval(() => {
    if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        console.log('🔄 URL changed, reinitializing extraction...');
        
        // Cleanup and restart
        extractionState.isActive = false;
        setTimeout(() => {
            initializeExtraction();
        }, 2000);
    }
}, 1000);

// Auto-initialize
console.log('🎯 Advanced KDP Extractor ready');
if (document.readyState === 'complete') {
    setTimeout(initializeExtraction, 1000);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializeExtraction, 1000);
    });
}

// Export for testing/debugging
window.kdpExtractor = {
    performKDPExtraction,
    performAdsExtraction,
    extractionState,
    CONFIG
};
