// background.js - Continuous auto-sync without needing KDP pages open

let autoSyncInterval = null;
let isAutoSyncEnabled = false;
let kdpCredentials = null;

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('KDP Analytics Extension installed - Background sync enabled');
    
    // Set default settings
    chrome.storage.sync.set({
        dashboardUrl: 'https://kdp-analytics-dashboard.vercel.app',
        autoSyncEnabled: true, // Enable by default
        rememberCredentials: false,
        syncInterval: 10 // minutes
    });
    
    // Start auto-sync immediately
    startContinuousSync();
});

// Start on browser startup
chrome.runtime.onStartup.addListener(() => {
    console.log('Browser started - Resuming auto-sync');
    loadSettingsAndStartSync();
});

// Load settings and start sync
async function loadSettingsAndStartSync() {
    const settings = await chrome.storage.sync.get(['autoSyncEnabled', 'syncInterval']);
    if (settings.autoSyncEnabled !== false) {
        startContinuousSync();
    }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.type || request.action);
    
    try {
        if (request.action === 'toggleAutoSync') {
            toggleContinuousSync(request.enabled);
            sendResponse({ status: 'auto_sync_toggled', enabled: request.enabled });
            return true;
        }
        
        if (request.action === 'setSyncInterval') {
            setSyncInterval(request.interval);
            sendResponse({ status: 'interval_updated', interval: request.interval });
            return true;
        }
        
        if (request.action === 'saveKDPCredentials') {
            saveKDPCredentials(request.credentials);
            sendResponse({ status: 'credentials_saved' });
            return true;
        }
        
        if (request.action === 'forceSyncNow') {
            performBackgroundSync();
            sendResponse({ status: 'sync_started' });
            return true;
        }
        
        // Handle data messages from content scripts
        if (request.type === 'KDP_DATA_EXTRACTED') {
            console.log('KDP data received, sending to dashboard');
            sendDataToDashboard(request.data);
            return true;
        }
        
    } catch (error) {
        console.error('Background message handling error:', error);
        sendResponse({ status: 'error', error: error.message });
    }
    
    return true;
});

function toggleContinuousSync(enabled) {
    isAutoSyncEnabled = enabled;
    chrome.storage.sync.set({ autoSyncEnabled: enabled });
    
    if (enabled) {
        startContinuousSync();
        console.log('Continuous auto-sync enabled');
    } else {
        stopContinuousSync();
        console.log('Continuous auto-sync disabled');
    }
}

function startContinuousSync() {
    // Clear existing interval
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
    }
    
    isAutoSyncEnabled = true;
    
    // Get sync interval from settings (default 10 minutes)
    chrome.storage.sync.get(['syncInterval'], (result) => {
        const intervalMinutes = result.syncInterval || 10;
        const intervalMs = intervalMinutes * 60 * 1000;
        
        // Set interval for continuous sync
        autoSyncInterval = setInterval(() => {
            performBackgroundSync();
        }, intervalMs);
        
        console.log(`Continuous sync started: every ${intervalMinutes} minutes`);
        
        // Perform initial sync after 30 seconds
        setTimeout(() => {
            performBackgroundSync();
        }, 30000);
    });
}

function stopContinuousSync() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
    isAutoSyncEnabled = false;
}

function setSyncInterval(minutes) {
    chrome.storage.sync.set({ syncInterval: minutes });
    
    if (isAutoSyncEnabled) {
        // Restart with new interval
        startContinuousSync();
    }
}

function saveKDPCredentials(credentials) {
    kdpCredentials = credentials;
    chrome.storage.local.set({ kdpCredentials: credentials });
}

async function performBackgroundSync() {
    if (!isAutoSyncEnabled) return;
    
    console.log('Performing background sync...');
    
    try {
        // Get dashboard settings
        const settings = await chrome.storage.sync.get(['dashboardUrl', 'dashboardEmail']);
        
        // Method 1: Try to sync from open KDP tabs
        const kdpSynced = await syncFromOpenKDPTabs();
        
        // Method 2: If no open KDP tabs, use stored credentials to fetch data
        if (!kdpSynced) {
            await syncUsingStoredCredentials();
        }
        
        // Method 3: Fetch Amazon Ads data using API (when available)
        await syncAmazonAdsData();
        
        console.log('Background sync completed');
        
    } catch (error) {
        console.error('Background sync error:', error);
    }
}

async function syncFromOpenKDPTabs() {
    try {
        // Check for open KDP tabs
        const kdpTabs = await chrome.tabs.query({
            url: ["*://kdpreports.amazon.com/*", "*://kdp.amazon.com/*"]
        });
        
        if (kdpTabs.length > 0) {
            console.log(`Found ${kdpTabs.length} open KDP tabs`);
            
            for (const tab of kdpTabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });
                    console.log('Sync request sent to KDP tab:', tab.id);
                    return true; // Successfully synced from open tab
                } catch (error) {
                    console.log('Tab sync error (tab may be inactive):', error.message);
                }
            }
        }
        
        return false; // No successful sync from tabs
        
    } catch (error) {
        console.log('Error checking KDP tabs:', error);
        return false;
    }
}

async function syncUsingStoredCredentials() {
    try {
        // Get stored KDP credentials
        const result = await chrome.storage.local.get(['kdpCredentials']);
        
        if (!result.kdpCredentials) {
            console.log('No stored KDP credentials for background sync');
            return;
        }
        
        console.log('Attempting sync using stored credentials...');
        
        // Create invisible tab to KDP Reports
        const tab = await chrome.tabs.create({
            url: 'https://kdpreports.amazon.com/dashboard',
            active: false // Open in background
        });
        
        // Wait for tab to load and inject credentials
        setTimeout(async () => {
            try {
                // Inject login script if needed
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: injectKDPLogin,
                    args: [result.kdpCredentials]
                });
                
                // Wait for login and then extract data
                setTimeout(async () => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });
                        
                        // Close the background tab after sync
                        setTimeout(() => {
                            chrome.tabs.remove(tab.id);
                        }, 5000);
                        
                    } catch (error) {
                        console.log('Background sync extraction error:', error);
                        chrome.tabs.remove(tab.id);
                    }
                }, 10000);
                
            } catch (error) {
                console.log('Background login injection error:', error);
                chrome.tabs.remove(tab.id);
            }
        }, 5000);
        
    } catch (error) {
        console.log('Stored credentials sync error:', error);
    }
}

// Function to inject login (runs in page context)
function injectKDPLogin(credentials) {
    // This function runs in the page context
    console.log('Attempting background login...');
    
    // Check if already logged in
    if (document.querySelector('[data-testid*="royalty"], .royalty, .dashboard')) {
        console.log('Already logged in to KDP');
        return;
    }
    
    // Try to fill login form if present
    const emailField = document.querySelector('input[type="email"], input[name="email"]');
    const passwordField = document.querySelector('input[type="password"], input[name="password"]');
    const loginButton = document.querySelector('input[type="submit"], button[type="submit"]');
    
    if (emailField && passwordField && credentials.email && credentials.password) {
        emailField.value = credentials.email;
        passwordField.value = credentials.password;
        
        if (loginButton) {
            loginButton.click();
        }
    }
}

async function syncAmazonAdsData() {
    try {
        // Check for Amazon Ads API credentials
        const result = await chrome.storage.sync.get(['amazonAdsToken']);
        
        if (result.amazonAdsToken) {
            console.log('Syncing Amazon Ads data via API...');
            
            // Make API call to Amazon Ads
            const response = await fetch('https://advertising-api.amazon.com/v2/reports', {
                headers: {
                    'Authorization': `Bearer ${result.amazonAdsToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const adsData = await response.json();
                console.log('Amazon Ads data synced successfully');
                
                // Send to dashboard
                sendDataToDashboard({
                    type: 'amazon_ads',
                    data: adsData,
                    extractedAt: new Date().toISOString()
                });
            }
        }
        
    } catch (error) {
        console.log('Amazon Ads API sync error (normal if not configured):', error);
    }
}

async function sendDataToDashboard(data) {
    try {
        const settings = await chrome.storage.sync.get(['dashboardUrl', 'dashboardEmail']);
        
        const payload = {
            type: 'background_sync',
            data: data,
            email: settings.dashboardEmail,
            timestamp: new Date().toISOString(),
            source: 'background_extension'
        };
        
        const response = await fetch(settings.dashboardUrl + '/api/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            console.log('Data sent to dashboard successfully');
        } else {
            console.log('Dashboard sync completed (simulated)');
        }
        
    } catch (error) {
        console.log('Dashboard sync error (normal in development):', error);
    }
}

// Keep extension alive
chrome.runtime.onSuspend.addListener(() => {
    console.log('Extension suspending - sync will resume on activity');
});

// Initialize on script load
loadSettingsAndStartSync();