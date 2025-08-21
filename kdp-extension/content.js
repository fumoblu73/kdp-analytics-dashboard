// content.js - Enhanced KDP Data Extraction for Real Dashboard Integration
console.log('🚀 KDP Analytics: Enhanced extraction script loaded on', window.location.href);

let extractionInProgress = false;
let extractedBooks = [];
let observerActive = false;

// Initialize when page loads
window.addEventListener('load', function() {
    console.log('📄 Page loaded, starting enhanced extraction...');
    setTimeout(() => {
        initializeExtraction();
    }, 3000);
});

// Listen for messages from extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📩 Content script received message:', request);
    
    if (request.action === 'ping') {
        sendResponse({status: 'content_script_active'});
        return;
    }
    
    if (request.action === 'extractData' || request.action === 'forceSync') {
        console.log('🔄 Force extraction requested');
        performEnhancedExtraction().then(data => {
            sendResponse(data);
        });
        return true; // Keep message channel open for async response
    }
});

function initializeExtraction() {
    if (extractionInProgress) return;
    
    const url = window.location.href.toLowerCase();
    console.log('🎯 Initializing extraction for URL:', url);
    
    if (url.includes('kdpreports.amazon.com')) {
        console.log('📊 KDP Reports page detected');
        setupReportsExtraction();
    } else if (url.includes('kdp.amazon.com') && url.includes('bookshelf')) {
        console.log('📚 KDP Bookshelf detected');
        performBookshelfExtraction();
    } else {
        console.log('ℹ️ Not a KDP page, waiting...');
    }
}

function setupReportsExtraction() {
    // Try immediate extraction
    performEnhancedExtraction();
    
    // Set up observer for dynamic content
    if (!observerActive) {
        setupDynamicObserver();
    }
    
    // Periodic extraction for dynamic loading
    const extractionInterval = setInterval(() => {
        if (!extractionInProgress) {
            performEnhancedExtraction();
        }
    }, 15000); // Every 15 seconds
    
    // Stop after 3 minutes
    setTimeout(() => {
        clearInterval(extractionInterval);
    }, 180000);
}

function setupDynamicObserver() {
    observerActive = true;
    
    const observer = new MutationObserver((mutations) => {
        let shouldExtract = false;
        
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        const text = node.textContent || '';
                        if (text.includes('$') || 
                            text.includes('KENP') || 
                            text.includes('royalt') ||
                            text.includes('sales') ||
                            node.classList?.contains('table') ||
                            node.tagName === 'TABLE') {
                            shouldExtract = true;
                        }
                    }
                });
            }
        });
        
        if (shouldExtract && !extractionInProgress) {
            setTimeout(() => {
                performEnhancedExtraction();
            }, 2000);
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

async function performEnhancedExtraction() {
    if (extractionInProgress) return { success: false, message: 'Extraction already in progress' };
    
    extractionInProgress = true;
    console.log('🔍 Starting enhanced KDP extraction...');
    
    try {
        const books = [];
        
        // Method 1: Extract from tables and structured data
        console.log('📊 Method 1: Extracting from tables...');
        const tableBooks = extractFromTables();
        books.push(...tableBooks);
        
        // Method 2: Extract from dashboard widgets and summary cards
        console.log('📱 Method 2: Extracting from widgets...');
        const widgetBooks = extractFromWidgets();
        books.push(...widgetBooks);
        
        // Method 3: Extract from reports sections
        console.log('📋 Method 3: Extracting from report sections...');
        const reportBooks = await extractFromReportsSections();
        books.push(...reportBooks);
        
        // Method 4: Extract from JavaScript variables
        console.log('🌐 Method 4: Extracting from JavaScript data...');
        const jsBooks = extractFromJavaScriptData();
        books.push(...jsBooks);
        
        // Method 5: Navigate and extract from different report views
        console.log('🏷️ Method 5: Extracting from report views...');
        const viewBooks = await extractFromReportViews();
        books.push(...viewBooks);
        
        // Process and deduplicate
        const processedBooks = processAndDeduplicateBooks(books);
        
        console.log(`📚 Enhanced extraction completed: ${processedBooks.length} books found`);
        
        if (processedBooks.length > 0) {
            extractedBooks = processedBooks;
            const extractionData = {
                books: processedBooks,
                totalRevenue: calculateTotalRevenue(processedBooks),
                timestamp: new Date().toISOString(),
                source: 'enhanced_kdp_reports',
                extractionMethod: 'multi_method_enhanced'
            };
            
            sendDataToExtension(extractionData);
            
            return {
                success: true,
                data: extractionData,
                message: `Successfully extracted ${processedBooks.length} books`
            };
        } else {
            return {
                success: false,
                message: 'No books found. Make sure you are on KDP Reports page with data visible.'
            };
        }
        
    } catch (error) {
        console.error('❌ Enhanced extraction error:', error);
        return {
            success: false,
            error: error.message,
            message: 'Extraction failed: ' + error.message
        };
    } finally {
        extractionInProgress = false;
    }
}

function extractFromTables() {
    const books = [];
    const tables = document.querySelectorAll('table, .table, [role="table"], .data-table, .report-table');
    
    console.log(`🔍 Analyzing ${tables.length} tables...`);
    
    tables.forEach((table, tableIndex) => {
        const rows = table.querySelectorAll('tr, .table-row, [role="row"]');
        
        rows.forEach((row, rowIndex) => {
            const cells = row.querySelectorAll('td, th, .table-cell, [role="cell"]');
            
            if (cells.length >= 2) {
                const bookData = extractBookDataFromRow(cells, `table_${tableIndex}_row_${rowIndex}`);
                if (bookData && bookData.title) {
                    books.push(bookData);
                }
            }
        });
    });
    
    console.log(`📊 Found ${books.length} books from tables`);
    return books;
}

function extractBookDataFromRow(cells, source) {
    let title = '';
    let revenue = 0;
    let sales = 0;
    let kenpReads = 0;
    let kenpRoyalties = 0;
    let asin = '';
    let marketplace = '';
    
    // Detailed data extraction from each cell
    cells.forEach((cell, index) => {
        const text = cell.textContent.trim();
        const cellHtml = cell.innerHTML;
        
        // Extract title (longest meaningful text without numbers/symbols)
        if (text.length > 10 && 
            !text.includes('$') && 
            !text.match(/^\d+$/) &&
            !text.includes('KENP') &&
            isLikelyBookTitle(text)) {
            title = text;
        }
        
        // Extract revenue (any dollar amount)
        const moneyMatch = text.match(/\$[\d,]+\.?\d*/g);
        if (moneyMatch) {
            moneyMatch.forEach(amount => {
                const value = parseFloat(amount.replace(/[$,]/g, ''));
                if (value > revenue) revenue = value;
            });
        }
        
        // Extract sales numbers
        const salesMatch = text.match(/^\d+$/);
        if (salesMatch && parseInt(text) > 0 && parseInt(text) < 10000) {
            const num = parseInt(text);
            if (num > sales) sales = num;
        }
        
        // Extract KENP reads
        if (text.includes('KENP') || (text.match(/^\d{3,}$/) && parseInt(text) > 100)) {
            const kenpMatch = text.match(/\d+/);
            if (kenpMatch) {
                const reads = parseInt(kempMatch[0]);
                if (reads > kenpReads) kenpReads = reads;
            }
        }
        
        // Extract ASIN
        const asinMatch = text.match(/[A-Z0-9]{10}/);
        if (asinMatch && !asin) {
            asin = asinMatch[0];
        }
        
        // Look for marketplace indicators
        if (text.includes('.com') || text.includes('.co.uk') || text.includes('.de')) {
            marketplace = text;
        }
    });
    
    // Calculate KENP royalties (approximate)
    if (kenpReads > 0 && kenpRoyalties === 0) {
        kenpRoyalties = kenpReads * 0.004; // Approximate KENP rate
    }
    
    if (title && (revenue > 0 || sales > 0 || kenpReads > 0)) {
        return {
            title: title,
            totalRoyalties: revenue,
            totalSales: sales,
            kenpReads: kenpReads,
            kenpRoyalties: kenpRoyalties,
            asin: asin,
            marketplace: marketplace || 'amazon.com',
            country: extractCountryFromMarketplace(marketplace),
            source: source,
            extractedAt: new Date().toISOString()
        };
    }
    
    return null;
}

function extractFromWidgets() {
    const books = [];
    const widgets = document.querySelectorAll(
        '.widget, .card, .summary, .dashboard-item, .metric-card, .report-widget, ' +
        '[class*="widget"], [class*="card"], [class*="summary"], [class*="metric"]'
    );
    
    console.log(`🔍 Analyzing ${widgets.length} widgets...`);
    
    widgets.forEach((widget, index) => {
        const text = widget.textContent;
        const widgetData = extractBookDataFromWidget(widget, `widget_${index}`);
        
        if (widgetData && widgetData.title) {
            books.push(widgetData);
        }
    });
    
    console.log(`📱 Found ${books.length} books from widgets`);
    return books;
}

function extractBookDataFromWidget(widget, source) {
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
    
    // Extract revenue
    const revenue = extractMoneyAmount(text);
    
    // Extract other metrics
    const kenpMatch = text.match(/KENP.*?(\d+)/i);
    const kenpReads = kenpMatch ? parseInt(kenpMatch[1]) : 0;
    
    if (title && (revenue > 0 || kenpReads > 0)) {
        return {
            title: title,
            totalRoyalties: revenue,
            kenpReads: kenpReads,
            kenpRoyalties: kenpReads * 0.004,
            source: source,
            extractedAt: new Date().toISOString()
        };
    }
    
    return null;
}

async function extractFromReportsSections() {
    const books = [];
    
    // Look for expandable sections
    const expandableElements = document.querySelectorAll(
        'button[aria-expanded], .expandable, .accordion, .collapsible, ' +
        '[class*="expand"], [class*="toggle"], [class*="accordion"]'
    );
    
    for (const element of expandableElements) {
        try {
            // Try to expand the section
            if (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button') {
                element.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Extract data from expanded content
                const parent = element.closest('div, section, article') || element.parentElement;
                const sectionBooks = extractBooksFromElement(parent);
                books.push(...sectionBooks);
            }
        } catch (error) {
            console.log('Could not expand section:', error);
        }
    }
    
    console.log(`📋 Found ${books.length} books from report sections`);
    return books;
}

function extractFromJavaScriptData() {
    const books = [];
    
    // Look for data in global JavaScript variables
    const dataSources = [
        'window.kdpData',
        'window.reportData',
        'window.booksData',
        'window.__INITIAL_STATE__',
        'window.__NEXT_DATA__',
        'window.appData'
    ];
    
    dataSources.forEach(source => {
        try {
            const data = eval(source);
            if (data && typeof data === 'object') {
                const jsBooks = extractBooksFromObject(data);
                books.push(...jsBooks);
            }
        } catch (error) {
            // Source doesn't exist or is not accessible
        }
    });
    
    // Look for JSON data in script tags
    const scriptTags = document.querySelectorAll('script[type="application/json"], script:not([src])');
    scriptTags.forEach(script => {
        try {
            const content = script.textContent || script.innerHTML;
            if (content && content.includes('{')) {
                const data = JSON.parse(content);
                const scriptBooks = extractBooksFromObject(data);
                books.push(...scriptBooks);
            }
        } catch (error) {
            // Not valid JSON or no book data
        }
    });
    
    console.log(`🌐 Found ${books.length} books from JavaScript data`);
    return books;
}

async function extractFromReportViews() {
    const books = [];
    
    // Look for navigation tabs or view switchers
    const navElements = document.querySelectorAll(
        '.nav-tab, .tab, .view-switcher, .report-nav, ' +
        'a[href*="report"], button[data-tab], [role="tab"]'
    );
    
    for (const nav of navElements) {
        const navText = nav.textContent.toLowerCase();
        if (navText.includes('book') || navText.includes('title') || navText.includes('product') || navText.includes('detail')) {
            try {
                nav.click();
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Extract from the new view
                const viewBooks = extractFromTables();
                books.push(...viewBooks);
            } catch (error) {
                console.log('Could not switch view:', error);
            }
        }
    }
    
    console.log(`🏷️ Found ${books.length} books from report views`);
    return books;
}

// Helper functions
function isLikelyBookTitle(text) {
    if (!text || text.length < 3 || text.length > 200) return false;
    
    const lowerText = text.toLowerCase();
    
    // Filter out UI elements
    const uiKeywords = [
        'dashboard', 'report', 'total', 'summary', 'date', 'filter', 'export', 'download',
        'view', 'details', 'more', 'less', 'expand', 'collapse', 'royalties', 'earnings',
        'sales', 'kindle', 'direct', 'publishing', 'amazon', 'select', 'unlimited', 'kenp',
        'asin', 'marketplace', 'currency', 'period', 'range', 'month', 'year', 'today',
        'yesterday', 'week', 'quarter', 'loading', 'please wait', 'no data', 'error'
    ];
    
    const hasUIKeyword = uiKeywords.some(keyword => lowerText.includes(keyword));
    if (hasUIKeyword) return false;
    
    // Should look like a book title
    const hasLetters = /[a-zA-Z]/.test(text);
    const notAllCaps = text !== text.toUpperCase() || text.length < 20;
    const notOnlyNumbers = !/^\d+$/.test(text);
    const notOnlySymbols = !/^[^a-zA-Z0-9\s]+$/.test(text);
    const hasValidChars = /^[a-zA-Z0-9\s\-:.,'"!?&()]+$/.test(text);
    
    return hasLetters && notAllCaps && notOnlyNumbers && notOnlySymbols && hasValidChars;
}

function extractMoneyAmount(text) {
    const matches = text.match(/\$[\d,]+\.?\d*/g);
    if (!matches) return 0;
    
    return matches.reduce((total, match) => {
        const amount = parseFloat(match.replace(/[$,]/g, ''));
        return total + (isNaN(amount) ? 0 : amount);
    }, 0);
}

function extractCountryFromMarketplace(marketplace) {
    const countryMap = {
        '.com': 'US', '.co.uk': 'UK', '.de': 'DE', '.fr': 'FR',
        '.it': 'IT', '.es': 'ES', '.co.jp': 'JP', '.ca': 'CA',
        '.com.au': 'AU', '.com.br': 'BR', '.in': 'IN', '.com.mx': 'MX'
    };
    
    for (const [domain, country] of Object.entries(countryMap)) {
        if (marketplace.includes(domain)) return country;
    }
    
    return 'US'; // Default
}

function extractBooksFromElement(element) {
    const books = [];
    
    // Look for structured data within the element
    const titleElements = element.querySelectorAll(
        'h1, h2, h3, h4, .title, .book-title, .product-title, strong, b'
    );
    
    titleElements.forEach(titleEl => {
        const title = titleEl.textContent.trim();
        if (isLikelyBookTitle(title)) {
            const revenue = extractMoneyAmount(element.textContent);
            
            if (revenue > 0) {
                books.push({
                    title: title,
                    totalRoyalties: revenue,
                    source: 'element_extraction',
                    extractedAt: new Date().toISOString()
                });
            }
        }
    });
    
    return books;
}

function extractBooksFromObject(obj) {
    const books = [];
    
    function traverse(o, path = '') {
        if (!o || typeof o !== 'object') return;
        
        for (const key in o) {
            if (!o.hasOwnProperty(key)) continue;
            
            const value = o[key];
            const currentPath = path ? `${path}.${key}` : key;
            
            if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (item && typeof item === 'object') {
                        traverse(item, `${currentPath}[${index}]`);
                    }
                });
            } else if (typeof value === 'object' && value !== null) {
                // Check if this object looks like book data
                if (value.title || value.name || value.productName) {
                    const title = value.title || value.name || value.productName;
                    if (isLikelyBookTitle(title)) {
                        books.push({
                            title: title,
                            totalRoyalties: value.revenue || value.royalties || value.earnings || 0,
                            totalSales: value.sales || value.units || value.orders || 0,
                            kenpReads: value.kenp || value.kenpReads || value.reads || 0,
                            asin: value.asin || value.id || '',
                            source: `js_object_${currentPath}`,
                            extractedAt: new Date().toISOString()
                        });
                    }
                }
                traverse(value, currentPath);
            }
        }
    }
    
    traverse(obj);
    return books;
}

function processAndDeduplicateBooks(books) {
    const bookMap = new Map();
    
    books.forEach(book => {
        if (!book || !book.title) return;
        
        const key = book.title.toLowerCase().trim();
        
        if (bookMap.has(key)) {
            // Merge with existing book
            const existing = bookMap.get(key);
            bookMap.set(key, {
                ...existing,
                totalRoyalties: Math.max(existing.totalRoyalties || 0, book.totalRoyalties || 0),
                totalSales: Math.max(existing.totalSales || 0, book.totalSales || 0),
                kenpReads: Math.max(existing.kenpReads || 0, book.kenpReads || 0),
                kenpRoyalties: Math.max(existing.kenpRoyalties || 0, book.kenpRoyalties || 0),
                asin: existing.asin || book.asin || '',
                marketplace: existing.marketplace || book.marketplace || 'amazon.com',
                country: existing.country || book.country || 'US'
            });
        } else {
            // Add new book
            bookMap.set(key, {
                title: book.title,
                totalRoyalties: book.totalRoyalties || 0,
                totalSales: book.totalSales || 0,
                kenpReads: book.kenpReads || 0,
                kenpRoyalties: book.kenpRoyalties || (book.kenpReads * 0.004) || 0,
                asin: book.asin || '',
                marketplace: book.marketplace || 'amazon.com',
                country: book.country || 'US',
                source: book.source || 'unknown',
                extractedAt: book.extractedAt || new Date().toISOString()
            });
        }
    });
    
    return Array.from(bookMap.values()).filter(book => 
        book.title.length > 2 && 
        (book.totalRoyalties > 0 || book.totalSales > 0 || book.kenpReads > 0)
    );
}

function calculateTotalRevenue(books) {
    return books.reduce((total, book) => total + (book.totalRoyalties || 0), 0);
}

function sendDataToExtension(data) {
    try {
        chrome.runtime.sendMessage({
            action: 'saveData',
            data: data
        });
        console.log('📤 Enhanced extraction data sent to extension:', data);
    } catch (error) {
        console.error('❌ Error sending data to extension:', error);
    }
}

// Bookshelf extraction (backup method)
function performBookshelfExtraction() {
    console.log('📚 Performing bookshelf extraction...');
    
    const books = [];
    const bookElements = document.querySelectorAll(
        '.bookshelf-book, .book-item, .title, h1, h2, h3, ' +
        '[class*="book"], [class*="title"], .product-title'
    );
    
    bookElements.forEach((element, index) => {
        const title = element.textContent.trim();
        if (isLikelyBookTitle(title)) {
            books.push({
                title: title,
                totalRoyalties: 0,
                totalSales: 0,
                kenpReads: 0,
                kenpRoyalties: 0,
                asin: '',
                source: 'bookshelf',
                extractedAt: new Date().toISOString()
            });
        }
    });
    
    if (books.length > 0) {
        console.log(`📚 Found ${books.length} books on bookshelf`);
        const data = {
            books: books,
            totalRevenue: 0,
            timestamp: new Date().toISOString(),
            source: 'kdp_bookshelf'
        };
        sendDataToExtension(data);
    }
}

// Auto-initialize
console.log('🎯 KDP Enhanced Extractor ready');
if (document.readyState === 'complete') {
    setTimeout(initializeExtraction, 1000);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializeExtraction, 1000);
    });
}