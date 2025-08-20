// server.js - KDP Analytics Backend with Auto-Sync
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage (in production, use a database)
let kdpData = {
    books: [],
    totalRevenue: 0,
    lastSync: null,
    userCredentials: null
};

// Amazon KDP API Configuration
const KDP_API_CONFIG = {
    baseURL: 'https://kdp.amazon.com/api',
    endpoints: {
        reports: '/reports/earnings',
        books: '/catalog/books',
        sales: '/reports/sales'
    }
};

// Setup initial credentials
app.post('/api/setup', async (req, res) => {
    try {
        const { email, password, mfaCode } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }
        
        // Authenticate with Amazon KDP
        const authResult = await authenticateKDP(email, password, mfaCode);
        
        if (authResult.success) {
            kdpData.userCredentials = {
                ...authResult.credentials,
                setupDate: new Date().toISOString()
            };
            
            // Perform initial sync
            await performKDPSync();
            
            res.json({
                success: true,
                message: 'Setup completed successfully',
                data: {
                    booksFound: kdpData.books.length,
                    totalRevenue: kdpData.totalRevenue,
                    lastSync: kdpData.lastSync
                }
            });
        } else {
            res.status(401).json({
                success: false,
                error: authResult.error || 'Authentication failed'
            });
        }
        
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({
            success: false,
            error: 'Setup failed: ' + error.message
        });
    }
});

// Get current KDP data
app.get('/api/data', (req, res) => {
    res.json({
        success: true,
        data: {
            books: kdpData.books,
            totalRevenue: kdpData.totalRevenue,
            lastSync: kdpData.lastSync,
            isSetup: !!kdpData.userCredentials
        }
    });
});

// Force manual sync
app.post('/api/sync', async (req, res) => {
    try {
        if (!kdpData.userCredentials) {
            return res.status(400).json({
                success: false,
                error: 'Please complete setup first'
            });
        }
        
        const result = await performKDPSync();
        
        res.json({
            success: true,
            data: result,
            message: `Sync completed. Found ${result.books.length} books.`
        });
        
    } catch (error) {
        console.error('Manual sync error:', error);
        res.status(500).json({
            success: false,
            error: 'Sync failed: ' + error.message
        });
    }
});

// Authenticate with Amazon KDP
async function authenticateKDP(email, password, mfaCode = null) {
    try {
        console.log('🔐 Authenticating with Amazon KDP...');
        
        // Step 1: Initial login
        const loginResponse = await axios.post('https://www.amazon.com/ap/signin', {
            email: email,
            password: password,
            'create': '0',
            'metadata1': 'ECdITeCs:1692901234567-browser',
            'appActionToken': '',
            'appAction': 'SIGNIN_PWD_COLLECT'
        }, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://www.amazon.com/'
            },
            withCredentials: true,
            maxRedirects: 0,
            validateStatus: function (status) {
                return status < 500; // Resolve only if the status code is less than 500
            }
        });
        
        // Extract session cookies
        const cookies = loginResponse.headers['set-cookie'] || [];
        const sessionId = extractCookie(cookies, 'session-id');
        const sessionToken = extractCookie(cookies, 'session-token');
        
        if (!sessionId) {
            throw new Error('Failed to obtain session ID');
        }
        
        // Step 2: Handle MFA if required
        if (loginResponse.data.includes('auth-mfa') && mfaCode) {
            const mfaResponse = await axios.post('https://www.amazon.com/ap/mfa', {
                'otpCode': mfaCode,
                'mfaType': 'SMS',
                'rememberDevice': 'true'
            }, {
                headers: {
                    'Cookie': cookies.join('; '),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
        }
        
        // Step 3: Navigate to KDP and get access token
        const kdpResponse = await axios.get('https://kdp.amazon.com/en_US/reports', {
            headers: {
                'Cookie': cookies.join('; '),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        // Extract KDP access token from page
        const kdpAccessToken = extractKDPToken(kdpResponse.data);
        
        if (!kdpAccessToken) {
            throw new Error('Failed to obtain KDP access token');
        }
        
        return {
            success: true,
            credentials: {
                sessionId,
                sessionToken,
                kdpAccessToken,
                cookies: cookies.join('; '),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
            }
        };
        
    } catch (error) {
        console.error('Authentication error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Extract specific cookie value
function extractCookie(cookies, name) {
    for (const cookie of cookies) {
        const match = cookie.match(new RegExp(`${name}=([^;]+)`));
        if (match) return match[1];
    }
    return null;
}

// Extract KDP access token from HTML
function extractKDPToken(html) {
    const tokenMatch = html.match(/window\.kdpAccessToken\s*=\s*["']([^"']+)["']/);
    if (tokenMatch) return tokenMatch[1];
    
    const csrfMatch = html.match(/csrfToken["']\s*:\s*["']([^"']+)["']/);
    if (csrfMatch) return csrfMatch[1];
    
    return null;
}

// Perform KDP data sync
async function performKDPSync() {
    try {
        console.log('🔄 Starting KDP data sync...');
        
        if (!kdpData.userCredentials) {
            throw new Error('No credentials available');
        }
        
        const credentials = kdpData.userCredentials;
        
        // Check if credentials are expired
        if (new Date() > new Date(credentials.expiresAt)) {
            throw new Error('Credentials expired. Please re-authenticate.');
        }
        
        // Fetch books data
        const booksData = await fetchKDPBooks(credentials);
        
        // Fetch sales data
        const salesData = await fetchKDPSales(credentials);
        
        // Fetch earnings data
        const earningsData = await fetchKDPEarnings(credentials);
        
        // Combine and process data
        const processedBooks = combineKDPData(booksData, salesData, earningsData);
        
        // Update stored data
        kdpData.books = processedBooks;
        kdpData.totalRevenue = processedBooks.reduce((sum, book) => sum + (book.totalRoyalties || 0), 0);
        kdpData.lastSync = new Date().toISOString();
        
        console.log(`✅ Sync completed: ${processedBooks.length} books, $${kdpData.totalRevenue.toFixed(2)} total revenue`);
        
        return {
            books: processedBooks,
            totalRevenue: kdpData.totalRevenue,
            lastSync: kdpData.lastSync
        };
        
    } catch (error) {
        console.error('❌ Sync failed:', error);
        throw error;
    }
}

// Fetch books from KDP API
async function fetchKDPBooks(credentials) {
    try {
        const response = await axios.get('https://kdp.amazon.com/api/catalog/books', {
            headers: {
                'Cookie': credentials.cookies,
                'Authorization': `Bearer ${credentials.kdpAccessToken}`,
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        return response.data.books || [];
    } catch (error) {
        console.error('Error fetching books:', error);
        return [];
    }
}

// Fetch sales data from KDP API
async function fetchKDPSales(credentials) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 3); // Last 3 months
        
        const response = await axios.get('https://kdp.amazon.com/api/reports/sales', {
            params: {
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
                groupBy: 'title'
            },
            headers: {
                'Cookie': credentials.cookies,
                'Authorization': `Bearer ${credentials.kdpAccessToken}`,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        return response.data.salesData || [];
    } catch (error) {
        console.error('Error fetching sales:', error);
        return [];
    }
}

// Fetch earnings data from KDP API
async function fetchKDPEarnings(credentials) {
    try {
        const response = await axios.get('https://kdp.amazon.com/api/reports/earnings', {
            params: {
                period: 'last3months',
                currency: 'USD'
            },
            headers: {
                'Cookie': credentials.cookies,
                'Authorization': `Bearer ${credentials.kdpAccessToken}`,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        return response.data.earnings || [];
    } catch (error) {
        console.error('Error fetching earnings:', error);
        return [];
    }
}

// Combine KDP data from different sources
function combineKDPData(books, sales, earnings) {
    const combinedBooks = [];
    
    books.forEach(book => {
        const bookSales = sales.filter(s => s.asin === book.asin || s.title === book.title);
        const bookEarnings = earnings.filter(e => e.asin === book.asin || e.title === book.title);
        
        const totalSales = bookSales.reduce((sum, s) => sum + (s.units || 0), 0);
        const totalRoyalties = bookEarnings.reduce((sum, e) => sum + (e.royalties || 0), 0);
        const kenpReads = bookEarnings.reduce((sum, e) => sum + (e.kenpReads || 0), 0);
        
        combinedBooks.push({
            id: book.asin || `book_${combinedBooks.length}`,
            title: book.title,
            asin: book.asin,
            paperbackSales: bookSales.filter(s => s.format === 'paperback').reduce((sum, s) => sum + s.units, 0),
            paperbackRoyalties: bookEarnings.filter(e => e.format === 'paperback').reduce((sum, e) => sum + e.royalties, 0),
            ebookSales: bookSales.filter(s => s.format === 'ebook').reduce((sum, s) => sum + s.units, 0),
            ebookRoyalties: bookEarnings.filter(e => e.format === 'ebook').reduce((sum, e) => sum + e.royalties, 0),
            hardcoverSales: bookSales.filter(s => s.format === 'hardcover').reduce((sum, s) => sum + s.units, 0),
            hardcoverRoyalties: bookEarnings.filter(e => e.format === 'hardcover').reduce((sum, e) => sum + e.royalties, 0),
            kenpReads: kenpReads,
            kenpRoyalties: kenpReads * 0.004, // Approximate KENP rate
            totalSales: totalSales,
            totalRoyalties: totalRoyalties,
            country: book.marketplace || 'US',
            publishDate: book.publishDate,
            lastUpdated: new Date().toISOString()
        });
    });
    
    return combinedBooks.sort((a, b) => b.totalRoyalties - a.totalRoyalties);
}

// Auto-sync every 10 minutes
cron.schedule('*/10 * * * *', async () => {
    if (kdpData.userCredentials) {
        console.log('🔄 Running scheduled sync...');
        try {
            await performKDPSync();
            console.log('✅ Scheduled sync completed');
        } catch (error) {
            console.error('❌ Scheduled sync failed:', error);
        }
    }
});

// Serve dashboard
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 KDP Analytics Server running on port ${PORT}`);
    console.log('📊 Dashboard: http://localhost:' + PORT);
    console.log('⚙️ Auto-sync: Every 10 minutes');
});
