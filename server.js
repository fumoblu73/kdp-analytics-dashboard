// server.js - Enhanced KDP Analytics Backend with Amazon Ads Integration
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced data storage with file-based database
const DATA_DIR = './data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const ADS_FILE = path.join(DATA_DIR, 'ads.json');
const SYNC_LOG_FILE = path.join(DATA_DIR, 'sync_log.json');

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

// Enhanced data structure
let appData = {
    users: new Map(),
    books: new Map(),
    ads: new Map(),
    syncLog: [],
    settings: {
        autoSync: true,
        syncInterval: 10, // minutes
        retentionDays: 365
    }
};

// Amazon Ads API Configuration
const AMAZON_ADS_CONFIG = {
    baseURL: 'https://advertising-api.amazon.com',
    tokenURL: 'https://api.amazon.com/auth/o2/token',
    endpoints: {
        profiles: '/v2/profiles',
        campaigns: '/v2/sp/campaigns',
        adGroups: '/v2/sp/adGroups',
        keywords: '/v2/sp/keywords',
        reports: '/v2/reports'
    }
};

// KDP API Configuration (Enhanced)
const KDP_API_CONFIG = {
    baseURL: 'https://kdpreports.amazon.com',
    endpoints: {
        dashboard: '/dashboard',
        reports: '/api/reports',
        books: '/api/books',
        earnings: '/api/earnings',
        sales: '/api/sales'
    }
};

// Initialize application
async function initializeApp() {
    await ensureDataDir();
    await loadPersistedData();
    console.log('🚀 KDP Analytics Pro - Enhanced Backend initialized');
}

// Load persisted data
async function loadPersistedData() {
    try {
        const [usersData, booksData, adsData, syncLogData] = await Promise.allSettled([
            fs.readFile(USERS_FILE, 'utf8').then(JSON.parse).catch(() => ({})),
            fs.readFile(BOOKS_FILE, 'utf8').then(JSON.parse).catch(() => ({})),
            fs.readFile(ADS_FILE, 'utf8').then(JSON.parse).catch(() => ({})),
            fs.readFile(SYNC_LOG_FILE, 'utf8').then(JSON.parse).catch(() => ([]))
        ]);

        if (usersData.status === 'fulfilled') {
            appData.users = new Map(Object.entries(usersData.value));
        }
        if (booksData.status === 'fulfilled') {
            appData.books = new Map(Object.entries(booksData.value));
        }
        if (adsData.status === 'fulfilled') {
            appData.ads = new Map(Object.entries(adsData.value));
        }
        if (syncLogData.status === 'fulfilled') {
            appData.syncLog = syncLogData.value;
        }

        console.log(`📊 Loaded: ${appData.users.size} users, ${appData.books.size} books, ${appData.ads.size} ad campaigns`);
    } catch (error) {
        console.error('Error loading persisted data:', error);
    }
}

// Save data to disk
async function saveDataToDisk() {
    try {
        await Promise.all([
            fs.writeFile(USERS_FILE, JSON.stringify(Object.fromEntries(appData.users), null, 2)),
            fs.writeFile(BOOKS_FILE, JSON.stringify(Object.fromEntries(appData.books), null, 2)),
            fs.writeFile(ADS_FILE, JSON.stringify(Object.fromEntries(appData.ads), null, 2)),
            fs.writeFile(SYNC_LOG_FILE, JSON.stringify(appData.syncLog.slice(-1000), null, 2)) // Keep last 1000 entries
        ]);
    } catch (error) {
        console.error('Error saving data to disk:', error);
    }
}

// Generate user session token
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Log sync activity
function logSyncActivity(type, message, userId = null, error = null) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        type,
        message,
        userId,
        error: error ? error.message : null
    };
    
    appData.syncLog.unshift(logEntry);
    
    // Keep only last 1000 entries
    if (appData.syncLog.length > 1000) {
        appData.syncLog = appData.syncLog.slice(0, 1000);
    }
    
    console.log(`📝 [${type}] ${message}${userId ? ` (User: ${userId})` : ''}`);
}

// AUTHENTICATION ENDPOINTS

// Enhanced setup with Amazon Ads integration
app.post('/api/setup', async (req, res) => {
    try {
        const { email, password, mfaCode, amazonAdsCredentials } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        const userId = crypto.createHash('sha256').update(email).digest('hex').substring(0, 16);
        const sessionToken = generateSessionToken();
        
        // Authenticate with Amazon KDP
        const kdpAuthResult = await authenticateKDP(email, password, mfaCode);
        
        if (!kdpAuthResult.success) {
            return res.status(401).json({
                success: false,
                error: kdpAuthResult.error || 'KDP Authentication failed'
            });
        }
        
        // Setup Amazon Ads if credentials provided
        let adsAuthResult = { success: true, credentials: null };
        if (amazonAdsCredentials) {
            adsAuthResult = await authenticateAmazonAds(amazonAdsCredentials);
        }
        
        // Create user profile
        const userProfile = {
            userId,
            email,
            sessionToken,
            kdpCredentials: kdpAuthResult.credentials,
            adsCredentials: adsAuthResult.credentials,
            setupDate: new Date().toISOString(),
            lastSync: null,
            settings: {
                autoSync: true,
                syncInterval: 10,
                currency: 'EUR',
                timezone: 'Europe/Rome'
            }
        };
        
        appData.users.set(userId, userProfile);
        
        // Perform initial sync
        const syncResult = await performFullSync(userId);
        
        // Save to disk
        await saveDataToDisk();
        
        logSyncActivity('SETUP', `New user setup completed: ${email}`, userId);
        
        res.json({
            success: true,
            message: 'Setup completed successfully',
            data: {
                userId,
                sessionToken,
                booksFound: syncResult.books?.length || 0,
                adsFound: syncResult.ads?.length || 0,
                totalRevenue: syncResult.totalRevenue || 0,
                lastSync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Setup error:', error);
        logSyncActivity('ERROR', 'Setup failed', null, error);
        res.status(500).json({
            success: false,
            error: 'Setup failed: ' + error.message
        });
    }
});

// Get user data
app.get('/api/data', async (req, res) => {
    try {
        const { userId, sessionToken } = req.query;
        
        if (!userId || !sessionToken) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        const user = appData.users.get(userId);
        if (!user || user.sessionToken !== sessionToken) {
            return res.status(401).json({
                success: false,
                error: 'Invalid session'
            });
        }
        
        // Get user's books and ads
        const userBooks = Array.from(appData.books.values()).filter(book => book.userId === userId);
        const userAds = Array.from(appData.ads.values()).filter(ad => ad.userId === userId);
        
        // Calculate totals
        const totalRevenue = userBooks.reduce((sum, book) => sum + (book.totalRoyalties || 0), 0);
        const totalSpending = userAds.reduce((sum, ad) => sum + (ad.spend || 0), 0);
        const netRevenue = totalRevenue - totalSpending;
        
        res.json({
            success: true,
            data: {
                books: userBooks,
                ads: userAds,
                summary: {
                    totalRevenue,
                    totalSpending,
                    netRevenue,
                    totalBooks: userBooks.length,
                    totalCampaigns: userAds.length,
                    lastSync: user.lastSync
                },
                isSetup: true
            }
        });
        
    } catch (error) {
        console.error('Data retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve data: ' + error.message
        });
    }
});

// Force manual sync
app.post('/api/sync', async (req, res) => {
    try {
        const { userId, sessionToken } = req.body;
        
        if (!userId || !sessionToken) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        const user = appData.users.get(userId);
        if (!user || user.sessionToken !== sessionToken) {
            return res.status(401).json({
                success: false,
                error: 'Invalid session'
            });
        }
        
        const result = await performFullSync(userId);
        
        // Update user last sync
        user.lastSync = new Date().toISOString();
        appData.users.set(userId, user);
        
        await saveDataToDisk();
        
        logSyncActivity('MANUAL_SYNC', 'Manual sync completed', userId);
        
        res.json({
            success: true,
            data: result,
            message: `Sync completed. Found ${result.books?.length || 0} books, ${result.ads?.length || 0} ad campaigns.`
        });
        
    } catch (error) {
        console.error('Manual sync error:', error);
        logSyncActivity('ERROR', 'Manual sync failed', req.body.userId, error);
        res.status(500).json({
            success: false,
            error: 'Sync failed: ' + error.message
        });
    }
});

// EXTENSION DATA ENDPOINT
app.post('/api/extension/data', async (req, res) => {
    try {
        const { data, userId } = req.body;
        
        if (!data) {
            return res.status(400).json({
                success: false,
                error: 'No data provided'
            });
        }
        
        // Process extension data
        if (data.books && Array.isArray(data.books)) {
            data.books.forEach(book => {
                const bookId = book.asin || book.id || crypto.randomUUID();
                appData.books.set(bookId, {
                    ...book,
                    userId: userId || 'extension',
                    lastUpdated: new Date().toISOString(),
                    source: 'extension'
                });
            });
        }
        
        await saveDataToDisk();
        
        logSyncActivity('EXTENSION_SYNC', `Extension data received: ${data.books?.length || 0} books`, userId);
        
        res.json({
            success: true,
            message: 'Data received and processed',
            processed: {
                books: data.books?.length || 0,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Extension data error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process extension data: ' + error.message
        });
    }
});

// AMAZON ADS INTEGRATION

// Authenticate with Amazon Ads API
async function authenticateAmazonAds(credentials) {
    try {
        const { clientId, clientSecret, refreshToken } = credentials;
        
        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error('Missing Amazon Ads credentials');
        }
        
        // Get access token
        const tokenResponse = await axios.post(AMAZON_ADS_CONFIG.tokenURL, {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        if (!tokenResponse.data.access_token) {
            throw new Error('Failed to obtain access token');
        }
        
        return {
            success: true,
            credentials: {
                ...credentials,
                accessToken: tokenResponse.data.access_token,
                tokenExpiry: Date.now() + (tokenResponse.data.expires_in * 1000),
                authenticatedAt: new Date().toISOString()
            }
        };
        
    } catch (error) {
        console.error('Amazon Ads authentication error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Fetch Amazon Ads data
async function fetchAmazonAdsData(credentials) {
    try {
        const { accessToken, clientId } = credentials;
        
        // Get profiles
        const profilesResponse = await axios.get(
            AMAZON_ADS_CONFIG.baseURL + AMAZON_ADS_CONFIG.endpoints.profiles,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Amazon-Advertising-API-ClientId': clientId,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const profiles = profilesResponse.data;
        const adsData = [];
        
        // Fetch campaigns for each profile
        for (const profile of profiles) {
            try {
                const campaignsResponse = await axios.get(
                    AMAZON_ADS_CONFIG.baseURL + AMAZON_ADS_CONFIG.endpoints.campaigns,
                    {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Amazon-Advertising-API-ClientId': clientId,
                            'Amazon-Advertising-API-Scope': profile.profileId,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                const campaigns = campaignsResponse.data;
                adsData.push(...campaigns.map(campaign => ({
                    ...campaign,
                    profileId: profile.profileId,
                    marketplace: profile.countryCode
                })));
                
            } catch (profileError) {
                console.log(`Error fetching campaigns for profile ${profile.profileId}:`, profileError.message);
            }
        }
        
        return adsData;
        
    } catch (error) {
        console.error('Error fetching Amazon Ads data:', error);
        return [];
    }
}

// ENHANCED KDP INTEGRATION

// Authenticate with Amazon KDP (Enhanced)
async function authenticateKDP(email, password, mfaCode = null) {
    try {
        console.log('🔐 Authenticating with Amazon KDP...');
        
        // Simulate authentication process (in real implementation, use actual KDP API)
        // This is a placeholder for the actual authentication logic
        const mockCredentials = {
            sessionId: crypto.randomBytes(16).toString('hex'),
            sessionToken: crypto.randomBytes(32).toString('hex'),
            cookies: `session-id=${crypto.randomBytes(16).toString('hex')}; session-token=${crypto.randomBytes(32).toString('hex')}`,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        
        return {
            success: true,
            credentials: mockCredentials
        };
        
    } catch (error) {
        console.error('KDP authentication error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Perform full sync (KDP + Amazon Ads)
async function performFullSync(userId) {
    try {
        const user = appData.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }
        
        const results = {
            books: [],
            ads: [],
            totalRevenue: 0,
            totalSpending: 0
        };
        
        // Sync KDP data
        if (user.kdpCredentials) {
            console.log(`📚 Syncing KDP data for user ${userId}...`);
            
            // In a real implementation, this would fetch from actual KDP API
            // For now, we'll use mock data based on the examples from the images
            const mockBooks = [
                {
                    id: 'B0BWFC3554',
                    title: 'Empath and Psychic Abilities: A Survival Guide for Highly Sensitive People to Tap into Your Hidden Inner Power and Enhance It with Practical Exercises',
                    asin: 'B0BWFC3554',
                    author: 'Chandra Chakshi',
                    publicationDate: '21/02/2023',
                    format: 'Ebook',
                    paperbackSales: 0,
                    paperbackRoyalties: 0.00,
                    ebookSales: 1,
                    ebookRoyalties: 0.98,
                    hardcoverSales: 0,
                    hardcoverRoyalties: 0.00,
                    kenpReads: 238,
                    kenpRoyalties: 0.98,
                    totalSales: 1,
                    totalRoyalties: 0.98,
                    country: 'US',
                    userId: userId,
                    lastUpdated: new Date().toISOString()
                }
            ];
            
            // Store books
            mockBooks.forEach(book => {
                appData.books.set(book.id, book);
                results.books.push(book);
                results.totalRevenue += book.totalRoyalties || 0;
            });
        }
        
        // Sync Amazon Ads data
        if (user.adsCredentials) {
            console.log(`📊 Syncing Amazon Ads data for user ${userId}...`);
            
            try {
                const adsData = await fetchAmazonAdsData(user.adsCredentials);
                
                adsData.forEach(ad => {
                    const adId = ad.campaignId || crypto.randomUUID();
                    const processedAd = {
                        ...ad,
                        userId: userId,
                        lastUpdated: new Date().toISOString()
                    };
                    
                    appData.ads.set(adId, processedAd);
                    results.ads.push(processedAd);
                    results.totalSpending += ad.spend || 0;
                });
                
            } catch (adsError) {
                console.log('Amazon Ads sync failed (non-critical):', adsError.message);
            }
        }
        
        return results;
        
    } catch (error) {
        console.error('Full sync error:', error);
        throw error;
    }
}

// AUTO-SYNC SCHEDULER
cron.schedule('*/10 * * * *', async () => {
    if (!appData.settings.autoSync) return;
    
    console.log('🔄 Running scheduled auto-sync...');
    
    for (const [userId, user] of appData.users) {
        if (user.settings?.autoSync !== false) {
            try {
                await performFullSync(userId);
                user.lastSync = new Date().toISOString();
                logSyncActivity('AUTO_SYNC', 'Scheduled sync completed', userId);
            } catch (error) {
                logSyncActivity('ERROR', 'Scheduled sync failed', userId, error);
            }
        }
    }
    
    await saveDataToDisk();
});

// ANALYTICS ENDPOINTS

// Get analytics summary
app.get('/api/analytics/summary', async (req, res) => {
    try {
        const { userId } = req.query;
        
        const userBooks = Array.from(appData.books.values()).filter(book => book.userId === userId);
        const userAds = Array.from(appData.ads.values()).filter(ad => ad.userId === userId);
        
        const summary = {
            totalBooks: userBooks.length,
            totalRevenue: userBooks.reduce((sum, book) => sum + (book.totalRoyalties || 0), 0),
            totalSpending: userAds.reduce((sum, ad) => sum + (ad.spend || 0), 0),
            totalSales: userBooks.reduce((sum, book) => sum + (book.totalSales || 0), 0),
            totalReads: userBooks.reduce((sum, book) => sum + (book.kenpReads || 0), 0),
            topBooks: userBooks
                .sort((a, b) => (b.totalRoyalties || 0) - (a.totalRoyalties || 0))
                .slice(0, 5),
            monthlyTrends: generateMonthlyTrends(userBooks),
            countryBreakdown: generateCountryBreakdown(userBooks)
        };
        
        res.json({
            success: true,
            data: summary
        });
        
    } catch (error) {
        console.error('Analytics summary error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate analytics summary'
        });
    }
});

// Helper function to generate monthly trends
function generateMonthlyTrends(books) {
    const trends = {};
    
    books.forEach(book => {
        if (book.lastUpdated) {
            const month = new Date(book.lastUpdated).toISOString().substring(0, 7);
            if (!trends[month]) {
                trends[month] = { revenue: 0, sales: 0, reads: 0 };
            }
            trends[month].revenue += book.totalRoyalties || 0;
            trends[month].sales += book.totalSales || 0;
            trends[month].reads += book.kenpReads || 0;
        }
    });
    
    return Object.entries(trends)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12); // Last 12 months
}

// Helper function to generate country breakdown
function generateCountryBreakdown(books) {
    const countries = {};
    
    books.forEach(book => {
        const country = book.country || 'Unknown';
        if (!countries[country]) {
            countries[country] = { revenue: 0, sales: 0 };
        }
        countries[country].revenue += book.totalRoyalties || 0;
        countries[country].sales += book.totalSales || 0;
    });
    
    return Object.entries(countries)
        .map(([country, data]) => ({ country, ...data }))
        .sort((a, b) => b.revenue - a.revenue);
}

// SYSTEM ENDPOINTS

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        stats: {
            users: appData.users.size,
            books: appData.books.size,
            ads: appData.ads.size,
            syncLogEntries: appData.syncLog.length
        }
    });
});

// Get sync logs
app.get('/api/logs', (req, res) => {
    const { limit = 50 } = req.query;
    res.json({
        success: true,
        logs: appData.syncLog.slice(0, parseInt(limit))
    });
});

// Serve main dashboard
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, async () => {
    await initializeApp();
    console.log(`🚀 KDP Analytics Pro Server running on port ${PORT}`);
    console.log('📊 Dashboard: http://localhost:' + PORT);
    console.log('🔄 Auto-sync: Every 10 minutes');
    console.log('💾 Data persistence: File-based storage');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('📝 Saving data before shutdown...');
    await saveDataToDisk();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('📝 Saving data before shutdown...');
    await saveDataToDisk();
    process.exit(0);
});
