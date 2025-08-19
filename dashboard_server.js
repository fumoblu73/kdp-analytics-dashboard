// server.js - Dashboard server optimized for Vercel deployment

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for Vercel (use external DB for production)
let dashboardData = {
    users: {},
    kdpData: {},
    adsData: {},
    syncLog: []
};

// For Vercel deployment, we'll use environment variables for persistence
// In production, connect to a database like MongoDB, PostgreSQL, etc.

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Sync endpoint for extension
app.post('/api/sync', async (req, res) => {
    try {
        const { type, data, email, password, isAutoSync, timestamp } = req.body;
        
        console.log(`Received ${type} sync from ${email} at ${timestamp}`);
        
        // Simple authentication (use proper auth in production)
        const userKey = hashEmail(email);
        
        if (!dashboardData.users[userKey]) {
            dashboardData.users[userKey] = {
                email: email,
                createdAt: new Date().toISOString(),
                lastSync: null
            };
        }
        
        // Store the data
        const syncEntry = {
            id: crypto.randomUUID(),
            type: type,
            data: data,
            timestamp: timestamp,
            isAutoSync: isAutoSync || false,
            userKey: userKey
        };
        
        if (type === 'kdp') {
            if (!dashboardData.kdpData[userKey]) {
                dashboardData.kdpData[userKey] = [];
            }
            dashboardData.kdpData[userKey].push(syncEntry);
            
            // Keep only last 100 entries per user (Vercel memory limits)
            if (dashboardData.kdpData[userKey].length > 100) {
                dashboardData.kdpData[userKey] = dashboardData.kdpData[userKey].slice(-100);
            }
        } else if (type === 'ads') {
            if (!dashboardData.adsData[userKey]) {
                dashboardData.adsData[userKey] = [];
            }
            dashboardData.adsData[userKey].push(syncEntry);
            
            if (dashboardData.adsData[userKey].length > 100) {
                dashboardData.adsData[userKey] = dashboardData.adsData[userKey].slice(-100);
            }
        }
        
        // Update user last sync
        dashboardData.users[userKey].lastSync = timestamp;
        
        // Add to sync log
        dashboardData.syncLog.push({
            timestamp: timestamp,
            type: type,
            userKey: userKey,
            recordCount: Array.isArray(data.salesData) ? data.salesData.length : 
                        Array.isArray(data.campaigns) ? data.campaigns.length : 1,
            isAutoSync: isAutoSync
        });
        
        // Keep only last 1000 log entries
        if (dashboardData.syncLog.length > 1000) {
            dashboardData.syncLog = dashboardData.syncLog.slice(-1000);
        }
        
        res.json({
            success: true,
            message: `${type} data synced successfully`,
            recordCount: syncEntry.data.salesData ? syncEntry.data.salesData.length : 
                        syncEntry.data.campaigns ? syncEntry.data.campaigns.length : 1,
            timestamp: timestamp
        });
        
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get dashboard data
app.post('/api/dashboard-data', async (req, res) => {
    try {
        const { email, password } = req.body;
        const userKey = hashEmail(email);
        
        // Get user's data
        const kdpData = dashboardData.kdpData[userKey] || [];
        const adsData = dashboardData.adsData[userKey] || [];
        const user = dashboardData.users[userKey];
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Process and combine data
        const processedData = processUserData(kdpData, adsData);
        
        res.json({
            success: true,
            data: processedData,
            user: {
                email: user.email,
                lastSync: user.lastSync,
                totalSyncs: kdpData.length + adsData.length
            }
        });
        
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Amazon Ads OAuth endpoints
app.get('/auth/amazon-ads', (req, res) => {
    // Get client ID from environment variable
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    
    if (!clientId) {
        return res.status(500).json({
            error: 'Amazon Ads Client ID not configured'
        });
    }
    
    const baseUrl = req.get('host').includes('localhost') 
        ? `http://${req.get('host')}`
        : `https://${req.get('host')}`;
    
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/callback`);
    const scope = encodeURIComponent('advertising::campaign_management');
    
    const authUrl = `https://www.amazon.com/ap/oa?` +
        `client_id=${clientId}&` +
        `scope=${scope}&` +
        `response_type=code&` +
        `redirect_uri=${redirectUri}`;
    
    res.redirect(authUrl);
});

app.get('/auth/callback', (req, res) => {
    const { code, error } = req.query;
    
    if (error) {
        res.send(`
            <html>
                <head>
                    <title>Authorization Failed</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; }
                        .error { color: #e74c3c; }
                    </style>
                </head>
                <body>
                    <h2 class="error">❌ Authorization Failed</h2>
                    <p>Error: ${error}</p>
                    <p>Please close this window and try again.</p>
                    <script>
                        setTimeout(() => window.close(), 5000);
                    </script>
                </body>
            </html>
        `);
        return;
    }
    
    if (code) {
        res.send(`
            <html>
                <head>
                    <title>Authorization Successful</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; }
                        .success { color: #27ae60; }
                    </style>
                </head>
                <body>
                    <h2 class="success">✅ Authorization Successful</h2>
                    <p>Amazon Ads account connected successfully!</p>
                    <p>You can close this window and return to the extension.</p>
                    <script>
                        // Send message to extension
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'oauth-success',
                                code: '${code}'
                            }, '*');
                        }
                        setTimeout(() => window.close(), 5000);
                    </script>
                </body>
            </html>
        `);
    }
});

// KDP proxy endpoint (for cookie-based requests)
app.post('/api/kdp-proxy', async (req, res) => {
    try {
        const { cookies, email } = req.body;
        
        // This would make authenticated requests to KDP on behalf of the user
        // using their session cookies (implement based on your needs)
        
        res.json({
            success: true,
            message: 'KDP proxy request completed',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('KDP proxy error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get sync status
app.get('/api/sync-status/:email', (req, res) => {
    try {
        const userKey = hashEmail(req.params.email);
        const user = dashboardData.users[userKey];
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const kdpSyncs = dashboardData.kdpData[userKey] || [];
        const adsSyncs = dashboardData.adsData[userKey] || [];
        
        const lastKdpSync = kdpSyncs.length > 0 ? kdpSyncs[kdpSyncs.length - 1].timestamp : null;
        const lastAdsSync = adsSyncs.length > 0 ? adsSyncs[adsSyncs.length - 1].timestamp : null;
        
        res.json({
            success: true,
            status: {
                lastKdpSync: lastKdpSync,
                lastAdsSync: lastAdsSync,
                totalKdpSyncs: kdpSyncs.length,
                totalAdsSyncs: adsSyncs.length,
                kdpConnected: lastKdpSync && (Date.now() - new Date(lastKdpSync).getTime()) < 24 * 60 * 60 * 1000,
                adsConnected: lastAdsSync && (Date.now() - new Date(lastAdsSync).getTime()) < 24 * 60 * 60 * 1000
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve the main dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Utility functions
function hashEmail(email) {
    return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

function processUserData(kdpData, adsData) {
    // Combine and process KDP and Ads data
    const combinedData = [];
    const processedKdp = [];
    const processedAds = [];
    
    // Process KDP data
    kdpData.forEach(sync => {
        if (sync.data && sync.data.salesData) {
            sync.data.salesData.forEach(sale => {
                processedKdp.push({
                    ...sale,
                    syncTimestamp: sync.timestamp,
                    syncId: sync.id
                });
            });
        }
    });
    
    // Process Ads data
    adsData.forEach(sync => {
        if (sync.data && sync.data.campaigns) {
            sync.data.campaigns.forEach(campaign => {
                processedAds.push({
                    ...campaign,
                    syncTimestamp: sync.timestamp,
                    syncId: sync.id
                });
            });
        }
    });
    
    // Combine data by matching dates and titles
    processedKdp.forEach(kdp => {
        const matchingAds = processedAds.filter(ad => 
            ad.campaignName && kdp.title && 
            (ad.campaignName.toLowerCase().includes(kdp.title.substring(0, 20).toLowerCase()) ||
             kdp.title.toLowerCase().includes(ad.campaignName.substring(0, 20).toLowerCase()))
        );
        
        const totalAdSpend = matchingAds.reduce((sum, ad) => sum + (ad.spend || 0), 0);
        const totalAdSales = matchingAds.reduce((sum, ad) => sum + (ad.sales || 0), 0);
        const avgAcos = matchingAds.length > 0 
            ? matchingAds.reduce((sum, ad) => sum + (ad.acos || 0), 0) / matchingAds.length 
            : 0;
        
        combinedData.push({
            date: kdp.date,
            title: kdp.title,
            asin: kdp.asin,
            marketplace: kdp.marketplace,
            unitsSold: kdp.unitsSold || 1,
            royalty: kdp.royalty || 0,
            kenpRead: kdp.kenpReads || 0,
            adSpend: totalAdSpend,
            adSales: totalAdSales,
            acos: avgAcos,
            netProfit: (kdp.royalty || 0) - totalAdSpend,
            currency: 'USD',
            syncTimestamp: kdp.syncTimestamp
        });
    });
    
    return {
        combinedData: combinedData,
        kdpData: processedKdp,
        adsData: processedAds,
        summary: {
            totalRevenue: combinedData.reduce((sum, item) => sum + item.royalty, 0),
            totalSpend: combinedData.reduce((sum, item) => sum + item.adSpend, 0),
            totalOrders: combinedData.reduce((sum, item) => sum + item.unitsSold, 0),
            totalKenp: combinedData.reduce((sum, item) => sum + item.kenpRead, 0)
        }
    };
}

// Export for Vercel
module.exports = app;

// Start server for local development
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 KDP Analytics Dashboard running on port ${PORT}`);
    });
}🔗 Amazon Ads OAuth: http://localhost:${PORT}/auth/amazon-ads`);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n📁 Saving data before shutdown...');
    await saveData();
    console.log('✅ Data saved. Goodbye!');
    process.exit(0);
});

startServer().catch(console.error);