// background.js - Advanced Background Sync & Management for KDP Analytics Pro
console.log('🚀 KDP Analytics Pro: Enhanced background service initialized');

// Configuration
const CONFIG = {
    DASHBOARD_URL: 'https://kdp-analytics-dashboard.vercel.app',
    SYNC_INTERVALS: {
        FAST: 5 * 60 * 1000,     // 5 minutes
        NORMAL: 15 * 60 * 1000,  // 15 minutes
        SLOW: 60 * 60 * 1000     // 1 hour
    },
    MAX_RETRY_ATTEMPTS: 3,
    STORAGE_KEYS: {
        USER_DATA: 'kdp_user_data',
        BOOKS_DATA: 'kdp_books_data',
        ADS_DATA: 'kdp_ads_data',
        SYNC_LOG: 'kdp_sync_log',
        SETTINGS: 'kdp_settings'
    },
    KDP_URLS: [
        '*://kdpreports.amazon.com/*',
        '*://kdp.amazon.com/*',
        '*://advertising.amazon.com/*'
    ]
};

// Global state
let backgroundState = {
    isAutoSyncEnabled: true,
    currentSyncInterval: CONFIG.SYNC_INTERVALS.NORMAL,
    lastSyncTime: null,
    syncInProgress: false,
    retryCount: 0,
    activeIntervals: new Map(),
    openKDPTabs: new Set(),
    userData: null,
    syncLog: []
};

// Initialize background service
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('📦 Extension installed/updated:', details.reason);
    
    await initializeBackgroundService();
    
    if (details.reason === 'install') {
        await setupDefaultSettings();
        await showWelcomeNotification();
    } else if (details.reason === 'update') {
        await migrateData();
    }
});

// Browser startup
chrome.runtime.onStartup.addListener(async () => {
    console.log('🌅 Browser started - Resuming KDP Analytics Pro...');
    await initializeBackgroundService();
});

// Initialize background service
async function initializeBackgroundService() {
    try {
        // Load persisted data
        await loadPersistedData();
        
        // Start monitoring KDP tabs
        startTabMonitoring();
        
        // Start auto-sync if enabled
        if (backgroundState.isAutoSyncEnabled) {
            startAutoSync();
        }
        
        // Setup alarm for periodic sync
        setupPeriodicAlarms();
        
        console.log('✅ Background service initialized successfully');
        
    } catch (error) {
        console.error('❌ Background service initialization failed:', error);
        logSyncActivity('ERROR', 'Background service initialization failed', error);
    }
}

// Load persisted data from storage
async function loadPersistedData() {
    try {
        const result = await chrome.storage.local.get([
            CONFIG.STORAGE_KEYS.USER_DATA,
            CONFIG.STORAGE_KEYS.BOOKS_DATA,
            CONFIG.STORAGE_KEYS.ADS_DATA,
            CONFIG.STORAGE_KEYS.SYNC_LOG,
            CONFIG.STORAGE_KEYS.SETTINGS
        ]);
        
        backgroundState.userData = result[CONFIG.STORAGE_KEYS.USER_DATA] || null;
        backgroundState.syncLog = result[CONFIG.STORAGE_KEYS.SYNC_LOG] || [];
        
        const settings = result[CONFIG.STORAGE_KEYS.SETTINGS] || {};
        backgroundState.isAutoSyncEnabled = settings.autoSyncEnabled !== false;
        backgroundState.currentSyncInterval = settings.syncInterval || CONFIG.SYNC_INTERVALS.NORMAL;
        
        console.log('📊 Loaded persisted data:', {
            hasUserData: !!backgroundState.userData,
            syncLogEntries: backgroundState.syncLog.length,
            autoSyncEnabled: backgroundState.isAutoSyncEnabled
        });
        
    } catch (error) {
        console.error('Error loading persisted data:', error);
    }
}

// Setup default settings
async function setupDefaultSettings() {
    const defaultSettings = {
        autoSyncEnabled: true,
        syncInterval: CONFIG.SYNC_INTERVALS.NORMAL,
        notificationsEnabled: true,
        dataRetentionDays: 365,
        syncOnlyWhenActive: false,
        enableDetailedLogging: true
    };
    
    await chrome.storage.sync.set({
        [CONFIG.STORAGE_KEYS.SETTINGS]: defaultSettings
    });
    
    console.log('⚙️ Default settings configured');
}

// Show welcome notification
async function showWelcomeNotification() {
    chrome.notifications.create('welcome', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'KDP Analytics Pro',
        message: 'Extension installed! Visit KDP Reports to start syncing your data.'
    });
}

// Migrate data on update
async function migrateData() {
    // Handle data migration between versions
    console.log('🔄 Migrating data to new version...');
    // Implementation would depend on specific migration needs
}

// Tab monitoring for KDP pages
function startTabMonitoring() {
    // Listen for tab updates
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.url) {
            await handleTabUpdate(tabId, tab);
        }
    });
    
    // Listen for tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
        backgroundState.openKDPTabs.delete(tabId);
    });
    
    // Initial scan for existing KDP tabs
    scanExistingTabs();
}

// Handle tab updates
async function handleTabUpdate(tabId, tab) {
    const isKDPPage = CONFIG.KDP_URLS.some(pattern => 
        tab.url.match(pattern.replace('*://', 'https?://').replace('/*', '/.*'))
    );
    
    if (isKDPPage) {
        backgroundState.openKDPTabs.add(tabId);
        console.log(`📋 KDP tab detected: ${tabId} - ${tab.url}`);
        
        // Inject content script if needed
        await injectContentScriptIfNeeded(tabId);
        
        // Trigger sync if auto-sync is enabled
        if (backgroundState.isAutoSyncEnabled && !backgroundState.syncInProgress) {
            setTimeout(() => {
                triggerTabSync(tabId);
            }, 3000); // Wait for page to load
        }
        
        logSyncActivity('TAB_DETECTED', `KDP page opened: ${tab.url}`);
    } else {
        backgroundState.openKDPTabs.delete(tabId);
    }
}

// Scan existing tabs
async function scanExistingTabs() {
    try {
        const tabs = await chrome.tabs.query({});
        
        for (const tab of tabs) {
            const isKDPPage = CONFIG.KDP_URLS.some(pattern => 
                tab.url?.match(pattern.replace('*://', 'https?://').replace('/*', '/.*'))
            );
            
            if (isKDPPage) {
                backgroundState.openKDPTabs.add(tab.id);
                await injectContentScriptIfNeeded(tab.id);
            }
        }
        
        console.log(`🔍 Found ${backgroundState.openKDPTabs.size} existing KDP tabs`);
        
    } catch (error) {
        console.error('Error scanning existing tabs:', error);
    }
}

// Inject content script if needed
async function injectContentScriptIfNeeded(tabId) {
    try {
        // Check if content script is already injected
        const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        if (response?.status === 'active') {
            return; // Already injected
        }
    } catch (error) {
        // Content script not injected, inject it
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            console.log(`✅ Content script injected into tab ${tabId}`);
        } catch (injectionError) {
            console.error(`❌ Failed to inject content script into tab ${tabId}:`, injectionError);
        }
    }
}

// Auto-sync management
function startAutoSync() {
    // Clear existing intervals
    stopAutoSync();
    
    const intervalId = setInterval(async () => {
        if (!backgroundState.syncInProgress) {
            await performScheduledSync();
        }
    }, backgroundState.currentSyncInterval);
    
    backgroundState.activeIntervals.set('autoSync', intervalId);
    
    console.log(`🔄 Auto-sync started: every ${backgroundState.currentSyncInterval / 1000 / 60} minutes`);
}

function stopAutoSync() {
    for (const [name, intervalId] of backgroundState.activeIntervals) {
        clearInterval(intervalId);
    }
    backgroundState.activeIntervals.clear();
    console.log('⏹️ Auto-sync stopped');
}

// Perform scheduled sync
async function performScheduledSync() {
    if (backgroundState.syncInProgress) {
        console.log('⏳ Sync already in progress, skipping scheduled sync');
        return;
    }
    
    backgroundState.syncInProgress = true;
    logSyncActivity('SCHEDULED_SYNC', 'Starting scheduled sync');
    
    try {
        const results = {
            successfulTabs: 0,
            failedTabs: 0,
            totalData: { books: [], ads: [] }
        };
        
        // Sync from open KDP tabs
        if (backgroundState.openKDPTabs.size > 0) {
            for (const tabId of backgroundState.openKDPTabs) {
                try {
                    const syncResult = await triggerTabSync(tabId);
                    if (syncResult?.success) {
                        results.successfulTabs++;
                        if (syncResult.data?.books) {
                            results.totalData.books.push(...syncResult.data.books);
                        }
                        if (syncResult.data?.ads) {
                            results.totalData.ads.push(...syncResult.data.ads);
                        }
                    } else {
                        results.failedTabs++;
                    }
                } catch (error) {
                    console.error(`Tab sync failed for ${tabId}:`, error);
                    results.failedTabs++;
                }
            }
        } else {
            // No open tabs, try background sync via API
            await performBackgroundAPISync();
        }
        
        // Save synced data
        if (results.totalData.books.length > 0 || results.totalData.ads.length > 0) {
            await saveExtractedData(results.totalData);
        }
        
        // Update last sync time
        backgroundState.lastSyncTime = new Date().toISOString();
        backgroundState.retryCount = 0;
        
        logSyncActivity('SCHEDULED_SYNC_COMPLETE', 
            `Sync completed: ${results.successfulTabs} successful, ${results.failedTabs} failed`);
        
        // Notify popup if open
        chrome.runtime.sendMessage({
            action: 'syncComplete',
            results: results
        }).catch(() => {}); // Ignore if popup not open
        
    } catch (error) {
        console.error('❌ Scheduled sync failed:', error);
        backgroundState.retryCount++;
        
        logSyncActivity('SCHEDULED_SYNC_ERROR', 'Scheduled sync failed', error);
        
        // Exponential backoff for retries
        if (backgroundState.retryCount < CONFIG.MAX_RETRY_ATTEMPTS) {
            setTimeout(() => {
                performScheduledSync();
            }, Math.pow(2, backgroundState.retryCount) * 60000); // 2^n minutes
        }
        
    } finally {
        backgroundState.syncInProgress = false;
    }
}

// Trigger sync on specific tab
async function triggerTabSync(tabId) {
    try {
        console.log(`🔄 Triggering sync on tab ${tabId}`);
        
        const response = await chrome.tabs.sendMessage(tabId, {
            action: 'extractData'
        });
        
        if (response?.success) {
            console.log(`✅ Tab sync successful: ${tabId}`);
            return response;
        } else {
            console.log(`❌ Tab sync failed: ${tabId} - ${response?.error || 'Unknown error'}`);
            return { success: false, error: response?.error };
        }
        
    } catch (error) {
        console.error(`❌ Tab sync communication failed: ${tabId}`, error);
        return { success: false, error: error.message };
    }
}

// Background API sync (when no tabs are open)
async function performBackgroundAPISync() {
    console.log('🌐 Performing background API sync...');
    
    if (!backgroundState.userData?.credentials) {
        console.log('⚠️ No user credentials available for background sync');
        return;
    }
    
    try {
        // Create invisible tab for KDP
        const tab = await chrome.tabs.create({
            url: 'https://kdpreports.amazon.com/dashboard',
            active: false
        });
        
        // Wait for tab to load
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Inject credentials and extract data
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: performBackgroundExtraction,
            args: [backgroundState.userData.credentials]
        });
        
        // Wait for extraction
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Try to get data
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });
        
        // Close the background tab
        setTimeout(() => {
            chrome.tabs.remove(tab.id);
        }, 2000);
        
        if (response?.success) {
            logSyncActivity('BACKGROUND_API_SYNC', 'Background API sync successful');
            return response.data;
        }
        
    } catch (error) {
        console.error('Background API sync failed:', error);
        logSyncActivity('BACKGROUND_API_SYNC_ERROR', 'Background API sync failed', error);
    }
}

// Function to run in background tab context
function performBackgroundExtraction(credentials) {
    // This function runs in the page context
    console.log('🔐 Performing background authentication...');
    
    // Check if already logged in
    if (document.querySelector('[data-testid*="royalty"], .royalty, .dashboard-content')) {
        console.log('✅ Already authenticated');
        return;
    }
    
    // Try to authenticate if needed
    const emailField = document.querySelector('input[type="email"], input[name="email"]');
    const passwordField = document.querySelector('input[type="password"], input[name="password"]');
    
    if (emailField && passwordField && credentials.email && credentials.password) {
        emailField.value = credentials.email;
        passwordField.value = credentials.password;
        
        const loginButton = document.querySelector('input[type="submit"], button[type="submit"]');
        if (loginButton) {
            loginButton.click();
        }
    }
}

// Setup periodic alarms
function setupPeriodicAlarms() {
    // Create alarm for daily cleanup
    chrome.alarms.create('dailyCleanup', {
        when: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
        periodInMinutes: 24 * 60 // Every 24 hours
    });
    
    // Create alarm for weekly backup
    chrome.alarms.create('weeklyBackup', {
        when: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days from now
        periodInMinutes: 7 * 24 * 60 // Every 7 days
    });
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    console.log('⏰ Alarm triggered:', alarm.name);
    
    switch (alarm.name) {
        case 'dailyCleanup':
            await performDailyCleanup();
            break;
        case 'weeklyBackup':
            await performWeeklyBackup();
            break;
    }
});

// Daily cleanup tasks
async function performDailyCleanup() {
    console.log('🧹 Performing daily cleanup...');
    
    try {
        // Clean old sync logs (keep last 1000 entries)
        if (backgroundState.syncLog.length > 1000) {
            backgroundState.syncLog = backgroundState.syncLog.slice(-1000);
            await chrome.storage.local.set({
                [CONFIG.STORAGE_KEYS.SYNC_LOG]: backgroundState.syncLog
            });
        }
        
        // Clean old stored data based on retention settings
        const settings = await chrome.storage.sync.get(CONFIG.STORAGE_KEYS.SETTINGS);
        const retentionDays = settings[CONFIG.STORAGE_KEYS.SETTINGS]?.dataRetentionDays || 365;
        const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
        
        // Clean old books data
        const booksData = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.BOOKS_DATA);
        if (booksData[CONFIG.STORAGE_KEYS.BOOKS_DATA]) {
            const cleanedBooks = booksData[CONFIG.STORAGE_KEYS.BOOKS_DATA].filter(book => 
                new Date(book.lastUpdated || book.extractedAt) > cutoffDate
            );
            
            await chrome.storage.local.set({
                [CONFIG.STORAGE_KEYS.BOOKS_DATA]: cleanedBooks
            });
        }
        
        logSyncActivity('DAILY_CLEANUP', 'Daily cleanup completed');
        
    } catch (error) {
        console.error('Daily cleanup failed:', error);
        logSyncActivity('DAILY_CLEANUP_ERROR', 'Daily cleanup failed', error);
    }
}

// Weekly backup
async function performWeeklyBackup() {
    console.log('💾 Performing weekly backup...');
    
    try {
        const allData = await chrome.storage.local.get();
        
        // Create backup object
        const backup = {
            timestamp: new Date().toISOString(),
            version: chrome.runtime.getManifest().version,
            data: allData
        };
        
        // Save backup (you could extend this to save to external storage)
        await chrome.storage.local.set({
            [`backup_${Date.now()}`]: backup
        });
        
        logSyncActivity('WEEKLY_BACKUP', 'Weekly backup completed');
        
    } catch (error) {
        console.error('Weekly backup failed:', error);
        logSyncActivity('WEEKLY_BACKUP_ERROR', 'Weekly backup failed', error);
    }
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📩 Background received message:', request.action);
    
    switch (request.action) {
        case 'getStatus':
            sendResponse({
                success: true,
                status: {
                    autoSyncEnabled: backgroundState.isAutoSyncEnabled,
                    syncInProgress: backgroundState.syncInProgress,
                    lastSyncTime: backgroundState.lastSyncTime,
                    openKDPTabs: backgroundState.openKDPTabs.size,
                    retryCount: backgroundState.retryCount
                }
            });
            break;
            
        case 'toggleAutoSync':
            toggleAutoSync(request.enabled);
            sendResponse({ success: true, enabled: backgroundState.isAutoSyncEnabled });
            break;
            
        case 'setSyncInterval':
            setSyncInterval(request.interval);
            sendResponse({ success: true, interval: backgroundState.currentSyncInterval });
            break;
            
        case 'forceSyncNow':
            performScheduledSync().then(() => {
                sendResponse({ success: true });
            }).catch(error => {
                sendResponse({ success: false, error: error.message });
            });
            return true; // Keep message channel open
            
        case 'saveData':
            saveExtractedData(request.data).then(() => {
                sendResponse({ success: true });
            }).catch(error => {
                sendResponse({ success: false, error: error.message });
            });
            return true;
            
        case 'dataSync':
            // Handle data sync from content script
            if (request.success && request.data) {
                saveExtractedData(request.data);
                logSyncActivity('CONTENT_SYNC', 'Data received from content script');
            }
            sendResponse({ success: true });
            break;
            
        case 'getSyncLog':
            sendResponse({
                success: true,
                logs: backgroundState.syncLog.slice(0, request.limit || 50)
            });
            break;
            
        default:
            sendResponse({ success: false, error: 'Unknown action' });
    }
});

// Auto-sync controls
function toggleAutoSync(enabled) {
    backgroundState.isAutoSyncEnabled = enabled;
    
    if (enabled) {
        startAutoSync();
    } else {
        stopAutoSync();
    }
    
    // Save setting
    chrome.storage.sync.set({
        [`${CONFIG.STORAGE_KEYS.SETTINGS}.autoSyncEnabled`]: enabled
    });
    
    logSyncActivity('AUTO_SYNC_TOGGLE', `Auto-sync ${enabled ? 'enabled' : 'disabled'}`);
}

function setSyncInterval(interval) {
    backgroundState.currentSyncInterval = interval;
    
    // Save setting
    chrome.storage.sync.set({
        [`${CONFIG.STORAGE_KEYS.SETTINGS}.syncInterval`]: interval
    });
    
    // Restart auto-sync with new interval
    if (backgroundState.isAutoSyncEnabled) {
        startAutoSync();
    }
    
    logSyncActivity('SYNC_INTERVAL_CHANGE', `Sync interval changed to ${interval / 1000 / 60} minutes`);
}

// Data management
async function saveExtractedData(data) {
    try {
        const timestamp = new Date().toISOString();
        
        if (data.books && data.books.length > 0) {
            // Get existing books data
            const existingBooks = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.BOOKS_DATA);
            const booksArray = existingBooks[CONFIG.STORAGE_KEYS.BOOKS_DATA] || [];
            
            // Merge with new data
            const mergedBooks = mergeBookData(booksArray, data.books);
            
            await chrome.storage.local.set({
                [CONFIG.STORAGE_KEYS.BOOKS_DATA]: mergedBooks
            });
            
            console.log(`💾 Saved ${data.books.length} books to storage`);
        }
        
        if (data.ads && data.ads.length > 0) {
            // Similar process for ads data
            const existingAds = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.ADS_DATA);
            const adsArray = existingAds[CONFIG.STORAGE_KEYS.ADS_DATA] || [];
            
            const mergedAds = mergeAdsData(adsArray, data.ads);
            
            await chrome.storage.local.set({
                [CONFIG.STORAGE_KEYS.ADS_DATA]: mergedAds
            });
            
            console.log(`💾 Saved ${data.ads.length} ads to storage`);
        }
        
        // Send to dashboard
        await sendDataToDashboard(data);
        
    } catch (error) {
        console.error('Error saving extracted data:', error);
        throw error;
    }
}

// Merge book data to avoid duplicates
function mergeBookData(existing, newBooks) {
    const bookMap = new Map();
    
    // Add existing books
    existing.forEach(book => {
        const key = book.asin || book.id || book.title?.toLowerCase();
        if (key) {
            bookMap.set(key, book);
        }
    });
    
    // Add/update with new books
    newBooks.forEach(book => {
        const key = book.asin || book.id || book.title?.toLowerCase();
        if (key) {
            const existing = bookMap.get(key);
            if (existing) {
                // Merge data
                bookMap.set(key, {
                    ...existing,
                    ...book,
                    totalRoyalties: Math.max(existing.totalRoyalties || 0, book.totalRoyalties || 0),
                    totalSales: Math.max(existing.totalSales || 0, book.totalSales || 0),
                    kenpReads: Math.max(existing.kenpReads || 0, book.kenpReads || 0),
                    lastUpdated: new Date().toISOString()
                });
            } else {
                bookMap.set(key, {
                    ...book,
                    lastUpdated: new Date().toISOString()
                });
            }
        }
    });
    
    return Array.from(bookMap.values());
}

// Merge ads data
function mergeAdsData(existing, newAds) {
    const adsMap = new Map();
    
    existing.forEach(ad => {
        const key = ad.campaignId || ad.id;
        if (key) {
            adsMap.set(key, ad);
        }
    });
    
    newAds.forEach(ad => {
        const key = ad.campaignId || ad.id;
        if (key) {
            adsMap.set(key, {
                ...adsMap.get(key),
                ...ad,
                lastUpdated: new Date().toISOString()
            });
        }
    });
    
    return Array.from(adsMap.values());
}

// Send data to dashboard
async function sendDataToDashboard(data) {
    try {
        const response = await fetch(CONFIG.DASHBOARD_URL + '/api/extension/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: data,
                userId: backgroundState.userData?.userId,
                timestamp: new Date().toISOString(),
                source: 'background_sync'
            })
        });
        
        if (response.ok) {
            console.log('📤 Data sent to dashboard successfully');
            logSyncActivity('DASHBOARD_SYNC', 'Data sent to dashboard successfully');
        } else {
            throw new Error(`Dashboard sync failed: ${response.status}`);
        }
        
    } catch (error) {
        console.error('❌ Error sending data to dashboard:', error);
        logSyncActivity('DASHBOARD_SYNC_ERROR', 'Failed to send data to dashboard', error);
        // Don't throw - data is still saved locally
    }
}

// Logging
function logSyncActivity(type, message, error = null) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        type,
        message,
        error: error ? error.message : null
    };
    
    backgroundState.syncLog.unshift(logEntry);
    
    // Keep only last 1000 entries
    if (backgroundState.syncLog.length > 1000) {
        backgroundState.syncLog = backgroundState.syncLog.slice(0, 1000);
    }
    
    // Save to storage periodically
    if (backgroundState.syncLog.length % 10 === 0) {
        chrome.storage.local.set({
            [CONFIG.STORAGE_KEYS.SYNC_LOG]: backgroundState.syncLog
        });
    }
    
    console.log(`📝 [${type}] ${message}`);
}

// Cleanup on suspend
chrome.runtime.onSuspend.addListener(() => {
    console.log('🔄 Extension suspending - saving state...');
    
    // Save current state
    chrome.storage.local.set({
        [CONFIG.STORAGE_KEYS.SYNC_LOG]: backgroundState.syncLog,
        lastSyncTime: backgroundState.lastSyncTime
    });
    
    // Stop intervals
    stopAutoSync();
});

// Keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
    // Handle long-lived connections to keep service worker active
    port.onDisconnect.addListener(() => {
        console.log('Port disconnected');
    });
});

// Initialize on script load
console.log('🎯 KDP Analytics Pro Background Service Ready');
initializeBackgroundService();
