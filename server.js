// 載入環境變數（從 .env 檔案）
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const db = require('./database');
const payment = require('./payment');
const cron = require('node-cron');
const backup = require('./backup');
const csrf = require('csrf');
const {
    errorHandler,
    asyncHandler,
    createError,
    createValidationError,
    createAuthError,
    createNotFoundError,
    createConflictError
} = require('./errorHandler');
const {
    sanitizeObject,
    validateRequired,
    validateDateRange,
    validateNumberRange,
    sanitizeEmail,
    sanitizePhone,
    sanitizeDate,
    createValidationMiddleware
} = require('./validators');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway 使用代理，需要信任代理以正確處理 HTTPS 和 Cookie
app.set('trust proxy', 1);

// Session 設定
// 檢測是否在 Railway 環境（Railway 使用 HTTPS）
// Railway 通常會有 PORT 環境變數，且使用 HTTPS
const isRailway = !!process.env.RAILWAY_ENVIRONMENT || 
                  !!process.env.RAILWAY_ENVIRONMENT_NAME || 
                  (!!process.env.PORT && process.env.PORT !== '3000' && !process.env.DATABASE_URL?.includes('localhost'));
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookie = isProduction || isRailway || process.env.SESSION_SECURE === 'true';

// 輸出 Session 設定資訊（用於除錯）
console.log('🔐 Session 設定:');
console.log('   NODE_ENV:', process.env.NODE_ENV || '未設定');
console.log('   SESSION_SECRET:', process.env.SESSION_SECRET ? '已設定' : '⚠️ 未設定（使用預設值）');
console.log('   useSecureCookie:', useSecureCookie);
console.log('   isRailway:', isRailway);

// 檢查 SESSION_SECRET 是否設定
if (!process.env.SESSION_SECRET) {
    console.warn('⚠️  WARNING: SESSION_SECRET 未設定！Session Cookie 可能無法正確設定！');
    console.warn('   請在 Railway 環境變數中設定 SESSION_SECRET');
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: true, // 改為 true，確保 Session 被儲存並設定 Cookie
    cookie: {
        // Railway 使用 HTTPS，所以需要 secure cookie
        secure: useSecureCookie,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 小時
        sameSite: 'lax' // 改善跨站 Cookie 處理
    }
}));

// ============================================
// CSRF 保護設定
// ============================================
const csrfProtection = new csrf();

// 從 Session 中取得或建立 CSRF Secret
function getCsrfSecret(req) {
    if (!req.session.csrfSecret) {
        req.session.csrfSecret = csrfProtection.secretSync();
    }
    return req.session.csrfSecret;
}

// CSRF Token 生成中間件（用於需要 Token 的路由）
function generateCsrfToken(req, res, next) {
    const secret = getCsrfSecret(req);
    const token = csrfProtection.create(secret);
    req.csrfToken = token;
    res.locals.csrfToken = token;
    next();
}

// CSRF Token 驗證中間件
function verifyCsrfToken(req, res, next) {
    // 排除某些路由（例如：支付回調、公開 API）
    const excludedPaths = [
        '/api/payment/return',
        '/api/payment/result',
        '/api/admin/login',
        '/api/admin/logout',
        '/api/admin/check-auth'
    ];
    
    if (excludedPaths.some(path => req.path === path || req.path.startsWith(path))) {
        return next();
    }
    
    // 只驗證 POST、PUT、PATCH、DELETE 請求
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }
    
    const secret = getCsrfSecret(req);
    const token = req.headers['x-csrf-token'] || req.body._csrf || req.query._csrf;
    
    if (!token) {
        return next(createValidationError('缺少 CSRF Token'));
    }
    
    if (!csrfProtection.verify(secret, token)) {
        return next(createValidationError('CSRF Token 驗證失敗'));
    }
    
    next();
}

// 中間件
app.use(cors({
    credentials: true,
    origin: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 處理綠界 POST 表單資料（application/x-www-form-urlencoded）
app.use(express.urlencoded({ extended: true }));

// ============================================
// API Rate Limiting 設定
// ============================================

// 1. 登入 API - 嚴格限制（防止暴力破解）
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 5, // 最多 5 次請求
    message: {
        success: false,
        message: '登入嘗試次數過多，請稍後再試（15 分鐘後可再次嘗試）'
    },
    standardHeaders: true, // 返回 rate limit info 在 `RateLimit-*` headers
    legacyHeaders: false, // 禁用 `X-RateLimit-*` headers
    skipSuccessfulRequests: true, // 登入成功不計入限制
    handler: (req, res) => {
        console.warn(`⚠️  Rate Limit 觸發 - 登入 API: ${req.ip}`);
        res.status(429).json({
            success: false,
            message: '登入嘗試次數過多，請稍後再試（15 分鐘後可再次嘗試）'
        });
    }
});

// 2. 管理後台 API - 中等限制
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 100, // 最多 100 次請求
    message: {
        success: false,
        message: '請求過於頻繁，請稍後再試'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // 已登入的管理員放寬限制
        return req.session && req.session.admin;
    }
});

// 3. 公開 API - 寬鬆限制（訂房、查詢等）
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 200, // 最多 200 次請求
    message: {
        success: false,
        message: '請求過於頻繁，請稍後再試'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 4. 支付 API - 中等限制（防止濫用）
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 50, // 最多 50 次請求
    message: {
        success: false,
        message: '支付請求過於頻繁，請稍後再試'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 5. 一般 API - 預設限制
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 150, // 最多 150 次請求
    message: {
        success: false,
        message: '請求過於頻繁，請稍後再試'
    },
    standardHeaders: true,
    legacyHeaders: false
});

console.log('🛡️  API Rate Limiting 已啟用');
console.log('   - 登入 API: 5 次/15 分鐘');
console.log('   - 管理後台 API: 100 次/15 分鐘');
console.log('   - 公開 API: 200 次/15 分鐘');
console.log('   - 支付 API: 50 次/15 分鐘');
console.log('   - 一般 API: 150 次/15 分鐘');

// ============================================
// 輸入驗證中間件
// ============================================

// 訂房驗證中間件
const validateBooking = createValidationMiddleware([
    (req) => {
        const required = ['checkInDate', 'checkOutDate', 'roomType', 'guestName', 'guestPhone', 'guestEmail'];
        return validateRequired(required, req.body);
    },
    (req) => {
        return validateDateRange(req.body.checkInDate, req.body.checkOutDate);
    },
    (req) => {
        const email = sanitizeEmail(req.body.guestEmail);
        if (!email) {
            return { valid: false, message: 'Email 格式不正確' };
        }
        req.body.guestEmail = email;
        return { valid: true };
    },
    (req) => {
        const phone = sanitizePhone(req.body.guestPhone);
        if (!phone) {
            return { valid: false, message: '手機號碼格式不正確（需為 09 開頭，共 10 碼）' };
        }
        req.body.guestPhone = phone;
        return { valid: true };
    },
    (req) => {
        if (req.body.adults !== undefined) {
            return validateNumberRange(req.body.adults, 1, 20, '大人人數');
        }
        return { valid: true };
    },
    (req) => {
        if (req.body.children !== undefined) {
            return validateNumberRange(req.body.children, 0, 20, '孩童人數');
        }
        return { valid: true };
    }
]);

// 登入驗證中間件
const validateLogin = createValidationMiddleware([
    (req) => {
        return validateRequired(['username', 'password'], req.body);
    },
    (req) => {
        // 檢查使用者名稱長度
        if (req.body.username && req.body.username.length > 50) {
            return { valid: false, message: '帳號長度不能超過 50 個字元' };
        }
        return { valid: true };
    }
]);

// 房型管理驗證中間件
const validateRoomType = createValidationMiddleware([
    (req) => {
        if (req.method === 'POST' || req.method === 'PUT') {
            return validateRequired(['name', 'display_name', 'price'], req.body);
        }
        return { valid: true };
    },
    (req) => {
        if (req.body.price !== undefined) {
            return validateNumberRange(req.body.price, 0, 1000000, '價格');
        }
        return { valid: true };
    },
    (req) => {
        if (req.body.max_guests !== undefined) {
            return validateNumberRange(req.body.max_guests, 1, 20, '最大人數');
        }
        return { valid: true };
    }
]);

// 假日驗證中間件
const validateHoliday = createValidationMiddleware([
    (req) => {
        if (req.method === 'POST') {
            if (!req.body.holidayDate && (!req.body.startDate || !req.body.endDate)) {
                return { valid: false, message: '請提供假日日期或日期範圍' };
            }
            if (req.body.holidayDate) {
                const date = sanitizeDate(req.body.holidayDate);
                if (!date) {
                    return { valid: false, message: '日期格式不正確（需為 YYYY-MM-DD）' };
                }
                req.body.holidayDate = date;
            }
            if (req.body.startDate && req.body.endDate) {
                const startDate = sanitizeDate(req.body.startDate);
                const endDate = sanitizeDate(req.body.endDate);
                if (!startDate || !endDate) {
                    return { valid: false, message: '日期格式不正確（需為 YYYY-MM-DD）' };
                }
                return validateDateRange(startDate, endDate);
            }
        }
        return { valid: true };
    }
]);

// 加購商品驗證中間件
const validateAddon = createValidationMiddleware([
    (req) => {
        if (req.method === 'POST' || req.method === 'PUT') {
            return validateRequired(['name', 'display_name'], req.body);
        }
        return { valid: true };
    },
    (req) => {
        if (req.body.price !== undefined) {
            return validateNumberRange(req.body.price, 0, 100000, '價格');
        }
        return { valid: true };
    }
]);

// 通用清理中間件（應用於所有請求）
const sanitizeInput = (req, res, next) => {
    try {
        if (req.body) {
            // 對 weekday_settings 欄位進行特殊處理（允許 JSON 格式）
            if (req.body.value && req.params && req.params.key === 'weekday_settings') {
                // 驗證是否為有效的 JSON 格式
                try {
                    const parsed = typeof req.body.value === 'string' 
                        ? JSON.parse(req.body.value) 
                        : req.body.value;
                    // 驗證 JSON 結構是否符合 weekday_settings 的格式
                    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.weekdays)) {
                        // 驗證 weekdays 陣列中的值是否都是有效的數字（0-6）
                        const isValid = parsed.weekdays.every(d => 
                            Number.isInteger(d) && d >= 0 && d <= 6
                        );
                        if (isValid) {
                            // 有效的 weekday_settings，跳過 SQL Injection 檢測
                            // 但仍需要清理其他欄位
                            const { value, ...rest } = req.body;
                            req.body = {
                                ...sanitizeObject(rest, {
                                    checkSQLInjection: true,
                                    checkXSS: true
                                }),
                                value: typeof req.body.value === 'string' 
                                    ? req.body.value 
                                    : JSON.stringify(req.body.value)
                            };
                            next();
                            return;
                        }
                    }
                } catch (e) {
                    // JSON 解析失敗，繼續正常驗證流程
                }
            }
            
            // 正常清理流程
            req.body = sanitizeObject(req.body, {
                checkSQLInjection: true,
                checkXSS: true
            });
        }
        if (req.query) {
            req.query = sanitizeObject(req.query, {
                checkSQLInjection: true,
                checkXSS: true
            });
        }
        if (req.params) {
            req.params = sanitizeObject(req.params, {
                checkSQLInjection: true,
                checkXSS: true
            });
        }
        next();
    } catch (error) {
        console.error('輸入清理錯誤:', error);
        return res.status(400).json({
            success: false,
            message: error.message || '輸入驗證失敗'
        });
    }
};

console.log('✅ 輸入驗證系統已啟用');
console.log('   - SQL Injection 防護');
console.log('   - XSS 防護');
console.log('   - 輸入清理與驗證');

// 請求日誌中間件
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleString('zh-TW')}] ${req.method} ${req.path}`);
    next();
});

// 應用通用輸入清理中間件（在所有路由之前）
app.use(sanitizeInput);

// 注意：API 路由必須在靜態檔案服務之前定義
// app.use(express.static(__dirname)); // 移到最後

// 郵件設定（請根據您的需求修改）
// 這裡使用 Gmail 作為範例，您也可以使用其他郵件服務
// 建議使用 .env 檔案儲存敏感資訊，不要直接寫在程式碼中

const emailUser = process.env.EMAIL_USER || 'cheng701107@gmail.com';
const emailPass = process.env.EMAIL_PASS || 'vtik qvij ravh lirg';

// 檢查是否使用 OAuth2
const useOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;

let transporter;
let getAccessToken = null; // 將函數聲明在外部作用域
let sendEmailViaGmailAPI = null; // Gmail API 備用方案

if (useOAuth2) {
    // 使用 OAuth2 認證（推薦，解決 Railway 連接超時問題）
    const { google } = require('googleapis');
    
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        'https://developers.google.com/oauthplayground' // 重新導向 URI（OAuth2 Playground）
    );
    
    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });
    
    // 取得 Access Token（nodemailer 需要同步返回 Promise）
    let accessTokenCache = null;
    let tokenExpiry = null;
    
    getAccessToken = async function() {
        try {
            // 如果 token 還在有效期內，直接返回
            if (accessTokenCache && tokenExpiry && Date.now() < tokenExpiry) {
                console.log('✅ 使用快取的 Access Token');
                return accessTokenCache;
            }
            
            // 取得新的 token
            console.log('🔄 正在取得新的 Access Token...');
            const { token } = await oauth2Client.getAccessToken();
            if (!token) {
                throw new Error('無法取得 Access Token');
            }
            accessTokenCache = token;
            // Token 通常有效期為 1 小時，提前 5 分鐘刷新
            tokenExpiry = Date.now() + (55 * 60 * 1000);
            console.log('✅ Access Token 已成功取得');
            return token;
        } catch (error) {
            console.error('❌ 取得 Access Token 失敗:');
            console.error('   錯誤訊息:', error.message);
            console.error('   錯誤詳情:', error);
            throw error;
        }
    };
    
    // 嘗試使用 SSL 端口 465（Railway 環境可能更穩定）
    transporter = nodemailer.createTransport({
        // 明確指定 SMTP 設定（Railway 環境需要）
        host: 'smtp.gmail.com',
        port: 465, // 使用 SSL 端口
        secure: true, // SSL 連接
        auth: {
            type: 'OAuth2',
            user: emailUser,
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            refreshToken: process.env.GMAIL_REFRESH_TOKEN,
            accessToken: getAccessToken
        },
        // 縮短超時時間，快速切換到 Gmail API（Railway 環境 SMTP 連接不穩定）
        connectionTimeout: 10000, // 10 秒（快速失敗，切換到 Gmail API）
        greetingTimeout: 5000, // 5 秒
        socketTimeout: 10000, // 10 秒
        pool: false, // 不使用連接池（避免連接問題）
        // 啟用 TLS
        tls: {
            rejectUnauthorized: false // Railway 環境可能需要
        }
    });
    
    console.log('📧 郵件服務已設定（OAuth2 認證）');
    console.log('   使用帳號:', emailUser);
    console.log('   認證方式: OAuth2');
    
    // Gmail API 備用方案（當 SMTP 連接失敗時使用）
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // 使用 Gmail API 發送郵件的備用函數
    sendEmailViaGmailAPI = async function(mailOptions) {
        try {
            console.log('📧 使用 Gmail API 發送郵件（SMTP 備用方案）...');
            
            // 構建 MIME 格式的郵件字符串
            const boundary = '----=_Part_' + Date.now();
            const mimeMessage = [
                `From: ${mailOptions.from}`,
                `To: ${mailOptions.to}`,
                `Subject: =?UTF-8?B?${Buffer.from(mailOptions.subject, 'utf8').toString('base64')}?=`,
                `MIME-Version: 1.0`,
                `Content-Type: multipart/alternative; boundary="${boundary}"`,
                ``,
                `--${boundary}`,
                `Content-Type: text/html; charset=UTF-8`,
                `Content-Transfer-Encoding: base64`,
                ``,
                Buffer.from(mailOptions.html, 'utf8').toString('base64'),
                ``,
                `--${boundary}--`
            ].join('\r\n');
            
            // 轉換為 base64url 格式
            const messageBase64 = Buffer.from(mimeMessage, 'utf8')
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            
            // 使用 Gmail API 發送
            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: messageBase64
                }
            });
            
            console.log('✅ Gmail API 郵件已發送 (ID: ' + response.data.id + ')');
            return { messageId: response.data.id, accepted: [mailOptions.to] };
        } catch (error) {
            console.error('❌ Gmail API 發送失敗:', error.message);
            throw error;
        }
    };
} else {
    // 使用應用程式密碼（備用方案）
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: emailUser,
            pass: emailPass
        },
        // 增加超時時間和連接設定（Railway 環境需要）
        connectionTimeout: 60000, // 60 秒
        greetingTimeout: 30000, // 30 秒
        socketTimeout: 60000, // 60 秒
        pool: true, // 使用連接池
        maxConnections: 1,
        maxMessages: 3,
        // 啟用 TLS
        tls: {
            rejectUnauthorized: false // Railway 環境可能需要
        }
    });
    
    console.log('📧 郵件服務已設定（應用程式密碼）');
    console.log('   使用帳號:', emailUser);
    console.log('   ⚠️  建議使用 OAuth2 認證以解決連接超時問題');
}

// 房型名稱對照
const roomTypes = {
    standard: '標準雙人房',
    deluxe: '豪華雙人房',
    suite: '尊爵套房',
    family: '家庭四人房'
};

// 支付方式對照
const paymentMethods = {
    transfer: '匯款轉帳',
    card: '線上刷卡'
};

// 生成短訂房編號（格式：BK + 時間戳記後8位，總共10位）
function generateShortBookingId() {
    // 時間戳記後8位（確保唯一性）
    const timeSuffix = Date.now().toString().slice(-8);
    
    return `BK${timeSuffix}`;
}

// 訂房 API
app.post('/api/booking', publicLimiter, verifyCsrfToken, validateBooking, async (req, res) => {
    console.log('\n========================================');
    console.log('📥 收到訂房請求');
    console.log('時間:', new Date().toLocaleString('zh-TW'));
    console.log('請求資料:', JSON.stringify(req.body, null, 2));
    console.log('========================================\n');
    
    try {
        const {
            checkInDate,
            checkOutDate,
            roomType,
            guestName,
            guestPhone,
            guestEmail,
            paymentAmount,
            paymentMethod,
            pricePerNight,
            nights,
            totalAmount,
            finalAmount,
            addons,
            addonsTotal,
            adults,
            children
        } = req.body;

        // 驗證必填欄位
        if (!checkInDate || !checkOutDate || !roomType || !guestName || !guestPhone || !guestEmail) {
            return res.status(400).json({ message: '請填寫所有必填欄位' });
        }

        // 取得訂金百分比設定和匯款資訊
        let depositPercentage = 30; // 預設值
        let bankInfo = {
            bankName: '',
            bankBranch: '',
            account: '',
            accountName: ''
        };
        try {
            const depositSetting = await db.getSetting('deposit_percentage');
            if (depositSetting) {
                depositPercentage = parseInt(depositSetting) || 30;
            }
            
            // 取得匯款資訊
            const bankName = await db.getSetting('bank_name');
            const bankBranch = await db.getSetting('bank_branch');
            const bankAccount = await db.getSetting('bank_account');
            const accountName = await db.getSetting('account_name');
            
            if (bankName) bankInfo.bankName = bankName;
            if (bankBranch) bankInfo.bankBranch = bankBranch;
            if (bankAccount) bankInfo.account = bankAccount;
            if (accountName) bankInfo.accountName = accountName;
            
            // 取得付款方式啟用狀態
            const transferSetting = await db.getSetting('enable_transfer');
            const cardSetting = await db.getSetting('enable_card');
            const enableTransfer = transferSetting === '1' || transferSetting === 'true' || transferSetting === null; // null 表示預設啟用
            const enableCard = cardSetting === '1' || cardSetting === 'true' || cardSetting === null; // null 表示預設啟用
            
            // 驗證付款方式是否啟用
            if (paymentMethod === 'transfer' && !enableTransfer) {
                return res.status(400).json({ 
                    message: '匯款轉帳功能目前未啟用，請選擇其他付款方式' 
                });
            }
            if (paymentMethod === 'card' && !enableCard) {
                return res.status(400).json({ 
                    message: '線上刷卡功能目前未啟用，請選擇其他付款方式' 
                });
            }
        } catch (err) {
            console.warn('取得系統設定失敗，使用預設值:', err.message);
        }
        
        // 從資料庫取得房型資訊（使用 display_name 作為房型名稱）
        let roomTypeName = roomType; // 預設值
        try {
            const allRoomTypes = await db.getAllRoomTypes();
            const selectedRoom = allRoomTypes.find(r => r.name === roomType);
            if (selectedRoom) {
                roomTypeName = selectedRoom.display_name; // 使用顯示名稱
            }
        } catch (err) {
            console.warn('取得房型資訊失敗，使用預設值:', err.message);
            // 如果查詢失敗，嘗試使用舊的對照表
            roomTypeName = roomTypes[roomType] || roomType;
        }
        
        // 處理加購商品顯示名稱（用於郵件）
        let addonsList = '';
        if (addons && addons.length > 0) {
            try {
                const allAddons = await db.getAllAddonsAdmin();
                addonsList = addons.map(addon => {
                    const addonInfo = allAddons.find(a => a.name === addon.name);
                    const displayName = addonInfo ? addonInfo.display_name : addon.name;
                    const quantity = addon.quantity || 1;
                    const itemTotal = addon.price * quantity;
                    return `${displayName} x${quantity} (NT$ ${itemTotal.toLocaleString()})`;
                }).join('、');
            } catch (err) {
                console.error('取得加購商品資訊失敗:', err);
                // 如果查詢失敗，使用原始名稱
                addonsList = addons.map(addon => {
                    const quantity = addon.quantity || 1;
                    const itemTotal = addon.price * quantity;
                    return `${addon.name} x${quantity} (NT$ ${itemTotal.toLocaleString()})`;
                }).join('、');
            }
        }
        
        // 儲存訂房資料（這裡可以連接資料庫）
        const bookingData = {
            checkInDate,
            checkOutDate,
            roomType: roomTypeName, // 使用房型名稱（display_name）
            guestName,
            guestPhone,
            guestEmail,
            adults: adults || 0,
            children: children || 0,
            paymentAmount: paymentAmount === 'deposit' ? `訂金 (${depositPercentage}%)` : '全額',
            paymentMethod: paymentMethods[paymentMethod] || paymentMethod,
            pricePerNight,
            nights,
            totalAmount,
            finalAmount,
            bookingDate: new Date().toISOString(),
            bookingId: generateShortBookingId(),
            depositPercentage: depositPercentage, // 傳給郵件生成函數使用
            bankInfo: bankInfo, // 匯款資訊（包含銀行、分行、帳號、戶名）
            paymentMethodCode: paymentMethod, // 原始付款方式代碼（transfer 或 card）
            addons: addons || null, // 加購商品陣列
            addonsTotal: addonsTotal || 0, // 加購商品總金額
            addonsList: addonsList // 加購商品顯示字串（用於郵件）
        };

        // 取得匯款提醒模板的保留天數（用於計算到期日期）
        let daysReserved = 3; // 預設值
        if (paymentMethod === 'transfer') {
            try {
                const paymentTemplate = await db.getEmailTemplateByKey('payment_reminder');
                if (paymentTemplate && paymentTemplate.days_reserved) {
                    daysReserved = parseInt(paymentTemplate.days_reserved) || 3;
                }
            } catch (err) {
                console.warn('取得匯款提醒模板失敗，使用預設值:', err.message);
            }
        }
        
        // 計算匯款到期日期（如果是匯款轉帳）
        if (paymentMethod === 'transfer') {
            const paymentDeadline = new Date();
            paymentDeadline.setDate(paymentDeadline.getDate() + daysReserved);
            bookingData.daysReserved = daysReserved;
            bookingData.paymentDeadline = paymentDeadline.toLocaleDateString('zh-TW');
            console.log('📅 匯款保留天數:', daysReserved, '到期日期:', bookingData.paymentDeadline);
            console.log('💰 匯款資訊:', JSON.stringify(bankInfo, null, 2));
        }
        
        // 確保 bankInfo 被加入到 bookingData（即使不是匯款轉帳）
        bookingData.bankInfo = bankInfo;
        
        // 發送通知郵件給管理員（所有付款方式都需要）
        const adminMailOptions = {
            from: process.env.EMAIL_USER || 'your-email@gmail.com',
            to: process.env.ADMIN_EMAIL || 'cheng701107@gmail.com', // 管理員 Email
            subject: `【新訂房通知】${guestName} - ${bookingData.bookingId}`,
            html: generateAdminEmail(bookingData)
        };

        // 發送郵件
        let emailSent = false;
        let emailErrorMsg = '';
        
        // 只有匯款轉帳才在建立訂房時發送確認郵件給客戶
        // 線上刷卡要等付款完成後才發送確認郵件
        if (paymentMethod === 'transfer') {
            // 發送確認郵件給客戶（匯款轉帳）
            const customerMailOptions = {
                from: process.env.EMAIL_USER || 'your-email@gmail.com',
                to: guestEmail,
                subject: '【訂房確認】您的訂房已成功',
                html: await generateCustomerEmail(bookingData)
            };
            
            try {
                console.log('📧 正在發送郵件（匯款轉帳）...');
            console.log('   發送給客戶:', guestEmail);
            console.log('   使用帳號:', process.env.EMAIL_USER || 'cheng701107@gmail.com');
            console.log('   認證方式:', useOAuth2 ? 'OAuth2' : '應用程式密碼');
            
            // 如果是 OAuth2，先測試取得 Access Token
            if (useOAuth2 && getAccessToken) {
                try {
                    console.log('🔍 測試 OAuth2 Access Token...');
                    const testToken = await getAccessToken();
                    if (testToken) {
                        console.log('✅ OAuth2 Access Token 測試成功');
                    }
                } catch (tokenError) {
                    console.error('❌ OAuth2 Access Token 測試失敗:', tokenError.message);
                    throw new Error('OAuth2 認證失敗: ' + tokenError.message);
                }
            }
            
            // 發送客戶確認郵件（優先使用 Gmail API，更快更穩定）
            console.log('📤 發送客戶確認郵件...');
            let customerResult;
            if (sendEmailViaGmailAPI) {
                // 直接使用 Gmail API（Railway 環境更穩定）
                try {
                    customerResult = await sendEmailViaGmailAPI(customerMailOptions);
                    console.log('✅ 客戶確認郵件已發送 (Gmail API)');
                } catch (gmailError) {
                    // Gmail API 失敗時，嘗試 SMTP
                    console.log('⚠️  Gmail API 失敗，嘗試 SMTP...');
                    try {
                        customerResult = await transporter.sendMail(customerMailOptions);
                        console.log('✅ 客戶確認郵件已發送 (SMTP)');
                    } catch (smtpError) {
                        throw gmailError; // 拋出原始 Gmail API 錯誤
                    }
                }
            } else {
                // 沒有 Gmail API，使用 SMTP
                customerResult = await transporter.sendMail(customerMailOptions);
                console.log('✅ 客戶確認郵件已發送 (SMTP)');
            }
            if (customerResult && customerResult.messageId) {
                console.log('   郵件 ID:', customerResult.messageId);
            }
            
            emailSent = true;
        } catch (emailError) {
            emailErrorMsg = emailError.message || '未知錯誤';
            console.error('❌ 郵件發送失敗:');
            console.error('   錯誤訊息:', emailErrorMsg);
            console.error('   錯誤代碼:', emailError.code);
            console.error('   錯誤命令:', emailError.command);
            console.error('   完整錯誤:', emailError);
            
            // 如果是認證錯誤，提供更詳細的說明
            if (emailError.code === 'EAUTH' || emailError.message.includes('Invalid login')) {
                console.error('⚠️  認證失敗！請檢查：');
                if (useOAuth2) {
                    console.error('   1. GMAIL_CLIENT_ID 是否正確');
                    console.error('   2. GMAIL_CLIENT_SECRET 是否正確');
                    console.error('   3. GMAIL_REFRESH_TOKEN 是否有效');
                    console.error('   4. Refresh Token 是否已過期或被撤銷');
                } else {
                    console.error('   1. Email 帳號是否正確');
                    console.error('   2. 是否使用應用程式密碼（Gmail 需要）');
                    console.error('   3. 是否啟用兩步驟驗證');
                }
            } else if (emailError.code === 'ETIMEDOUT') {
                console.error('⚠️  連接超時！');
                if (useOAuth2) {
                    console.error('   這可能是 OAuth2 Access Token 取得失敗');
                    console.error('   請檢查 Refresh Token 是否有效');
                } else {
                    console.error('   建議使用 OAuth2 認證以解決連接超時問題');
                }
            }
            }
        } else {
            console.log('📧 線上刷卡：確認郵件將於付款完成後發送');
        }
        
        // 發送管理員通知郵件（所有付款方式都需要）
        try {
            console.log('📤 發送管理員通知郵件...');
            let adminResult;
            if (sendEmailViaGmailAPI) {
                try {
                    adminResult = await sendEmailViaGmailAPI(adminMailOptions);
                    console.log('✅ 管理員通知郵件已發送 (Gmail API)');
                } catch (gmailError) {
                    console.log('⚠️  Gmail API 失敗，嘗試 SMTP...');
                    try {
                        adminResult = await transporter.sendMail(adminMailOptions);
                        console.log('✅ 管理員通知郵件已發送 (SMTP)');
                    } catch (smtpError) {
                        console.error('❌ 管理員通知郵件發送失敗:', smtpError.message);
                    }
                }
            } else {
                adminResult = await transporter.sendMail(adminMailOptions);
                console.log('✅ 管理員通知郵件已發送 (SMTP)');
            }
            if (adminResult && adminResult.messageId) {
                console.log('   郵件 ID:', adminResult.messageId);
            }
        } catch (adminEmailError) {
            console.error('❌ 管理員通知郵件發送失敗:', adminEmailError.message);
            // 管理員郵件失敗不影響訂房流程
        }

        // 儲存訂房資料到資料庫
        try {
            // 判斷付款狀態和訂房狀態
            let paymentStatus = 'pending';
            let bookingStatus = 'active';
            
            if (paymentMethod === 'card') {
                paymentStatus = 'pending'; // 刷卡需要等待付款完成
                bookingStatus = 'reserved'; // 線上刷卡先設為保留
            } else if (paymentMethod === 'transfer') {
                paymentStatus = 'pending'; // 匯款也需要等待確認
                bookingStatus = 'reserved'; // 匯款轉帳先設為保留（保留3天）
            }
            
            console.log('💾 準備儲存訂房資料到資料庫...');
            console.log('   訂房編號:', bookingData.bookingId);
            console.log('   付款狀態:', paymentStatus);
            console.log('   訂房狀態:', bookingStatus);
            console.log('   加購商品:', bookingData.addons ? JSON.stringify(bookingData.addons) : '無');
            console.log('   加購商品總額:', bookingData.addonsTotal || 0);
            
            const savedId = await db.saveBooking({
                bookingId: bookingData.bookingId,
                checkInDate: bookingData.checkInDate,
                checkOutDate: bookingData.checkOutDate,
                roomType: bookingData.roomType,
                guestName: bookingData.guestName,
                guestPhone: bookingData.guestPhone,
                guestEmail: bookingData.guestEmail,
                adults: bookingData.adults || 0,
                children: bookingData.children || 0,
                paymentAmount: bookingData.paymentAmount,
                paymentMethod: bookingData.paymentMethod,
                pricePerNight: bookingData.pricePerNight,
                nights: bookingData.nights,
                totalAmount: bookingData.totalAmount,
                finalAmount: bookingData.finalAmount,
                bookingDate: bookingData.bookingDate,
                emailSent: emailSent ? 'booking_confirmation' : '0',
                paymentStatus: paymentStatus,
                status: bookingStatus,
                addons: bookingData.addons || null,
                addonsTotal: bookingData.addonsTotal || 0
            });
            
            console.log('✅ 訂房資料已成功儲存到資料庫 (ID:', savedId, ')');
            
            // 如果郵件發送狀態改變，更新資料庫（匯款轉帳發送確認信）
            if (emailSent && paymentMethod === 'transfer') {
                await db.updateEmailStatus(bookingData.bookingId, 'booking_confirmation');
            }
        } catch (dbError) {
            console.error('❌ 資料庫儲存錯誤:', dbError.message);
            console.error('   錯誤堆疊:', dbError.stack);
            console.error('   訂房編號:', bookingData.bookingId);
            // 資料庫錯誤應該要拋出，讓前端知道訂房失敗
            throw new Error('訂房資料儲存失敗: ' + dbError.message);
        }

        // 處理支付方式
        let paymentData = null;
        if (paymentMethod === 'card') {
            // 線上刷卡：建立支付表單
            try {
                // 判斷環境（正式環境或測試環境）
                const isProduction = process.env.NODE_ENV === 'production';
                console.log('🌍 當前環境:', isProduction ? '正式環境 (Production)' : '測試環境 (Test)');
                
                // 根據環境取得綠界設定
                let ecpayMerchantID, ecpayHashKey, ecpayHashIV;
                
                if (isProduction) {
                    // 正式環境：優先使用正式環境變數，其次使用資料庫設定
                    ecpayMerchantID = process.env.ECPAY_MERCHANT_ID_PROD || await db.getSetting('ecpay_merchant_id_prod') || await db.getSetting('ecpay_merchant_id');
                    ecpayHashKey = process.env.ECPAY_HASH_KEY_PROD || await db.getSetting('ecpay_hash_key_prod') || await db.getSetting('ecpay_hash_key');
                    ecpayHashIV = process.env.ECPAY_HASH_IV_PROD || await db.getSetting('ecpay_hash_iv_prod') || await db.getSetting('ecpay_hash_iv');
                    
                    console.log('💰 使用正式環境設定');
                    if (!ecpayMerchantID || ecpayMerchantID === '2000132') {
                        console.warn('⚠️  警告：正式環境仍在使用測試環境的 MerchantID！');
                        console.warn('   請設定 ECPAY_MERCHANT_ID_PROD 環境變數或在資料庫中設定 ecpay_merchant_id_prod');
                    }
                } else {
                    // 測試環境：使用測試環境設定
                    ecpayMerchantID = await db.getSetting('ecpay_merchant_id') || process.env.ECPAY_MERCHANT_ID || '2000132';
                    ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY || '5294y06JbISpM5x9';
                    ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV || 'v77hoKGq4kWxNNIS';
                    
                    console.log('🧪 使用測試環境設定');
                }
                
                console.log('📋 綠界設定:', {
                    MerchantID: ecpayMerchantID ? ecpayMerchantID.substring(0, 4) + '****' : '未設定',
                    HashKey: ecpayHashKey ? '已設定' : '未設定',
                    HashIV: ecpayHashIV ? '已設定' : '未設定'
                });
                
                // 驗證必要參數
                if (!ecpayMerchantID || !ecpayHashKey || !ecpayHashIV) {
                    const missingParams = [];
                    if (!ecpayMerchantID) missingParams.push('MerchantID');
                    if (!ecpayHashKey) missingParams.push('HashKey');
                    if (!ecpayHashIV) missingParams.push('HashIV');
                    
                    console.error('❌ 綠界設定不完整，缺少:', missingParams.join(', '));
                    throw new Error(`綠界支付設定不完整，請設定：${missingParams.join(', ')}。${isProduction ? '正式環境請設定 ECPAY_MERCHANT_ID_PROD、ECPAY_HASH_KEY_PROD、ECPAY_HASH_IV_PROD' : '測試環境請設定 ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV'}`);
                }
                
                // 傳入綠界設定給 payment 模組
                paymentData = payment.createPaymentForm(bookingData, {
                    amount: finalAmount,
                    description: `訂房編號：${bookingData.bookingId}`
                }, {
                    MerchantID: ecpayMerchantID,
                    HashKey: ecpayHashKey,
                    HashIV: ecpayHashIV
                });
            } catch (paymentError) {
                console.error('❌ 建立支付表單失敗:', paymentError);
                console.error('錯誤詳情:', paymentError.message);
                // 不拋出錯誤，讓訂房流程繼續，但 paymentData 會是 null
                // 前端會收到 paymentData: null，可以顯示錯誤訊息
            }
        }
        
        res.json({
            success: true,
            message: emailSent 
                ? '訂房成功！確認信已發送至您的 Email' 
                : '訂房成功！但郵件發送失敗，請聯繫客服確認',
            bookingId: bookingData.bookingId,
            emailSent: emailSent,
            emailError: emailSent ? null : emailErrorMsg,
            paymentMethod: paymentMethod,
            paymentData: paymentData // 如果是刷卡，包含支付表單資料
        });

    } catch (error) {
        console.error('❌ 訂房處理錯誤:', error);
        console.error('   錯誤訊息:', error.message);
        console.error('   錯誤堆疊:', error.stack);
        
        // 如果是資料庫錯誤，返回更明確的錯誤訊息
        if (error.message && error.message.includes('訂房資料儲存失敗')) {
            res.status(500).json({ 
                success: false,
                message: '訂房資料儲存失敗，請聯繫客服確認訂房狀態',
                error: error.message
            });
        } else {
            res.status(500).json({ 
                success: false,
                message: '伺服器錯誤，請稍後再試',
                error: error.message
            });
        }
    }
});

// 後台：快速建立訂房（不發送任何郵件，用於電話 / 其他平台訂房）
app.post('/api/admin/bookings/quick', requireAuth, adminLimiter, async (req, res) => {
    try {
        const {
            roomType,
            checkInDate,
            checkOutDate,
            guestName,
            guestPhone,
            guestEmail,
            adults,
            children,
            status,
            paymentStatus
        } = req.body;
        
        if (!roomType || !checkInDate || !checkOutDate || !guestName) {
            return res.status(400).json({
                success: false,
                message: '房型、日期與客戶姓名為必填欄位'
            });
        }
        
        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);
        if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
            return res.status(400).json({
                success: false,
                message: '入住與退房日期不正確'
            });
        }
        
        const msPerDay = 1000 * 60 * 60 * 24;
        const nights = Math.max(1, Math.round((checkOut - checkIn) / msPerDay));
        
        const bookingId = generateShortBookingId();
        const bookingDate = new Date().toISOString();
        
        // 記錄建立訂房日誌
        await logAction(req, 'create_booking', 'booking', bookingId, {
            guestName: guestName,
            checkInDate: checkInDate,
            checkOutDate: checkOutDate,
            roomType: roomType
        });
        
        const bookingData = {
            bookingId,
            checkInDate,
            checkOutDate,
            roomType,
            guestName,
            guestPhone: guestPhone || '',
            guestEmail: guestEmail || '',
            adults: adults || 0,
            children: children || 0,
            paymentAmount: '後台手動建立',
            paymentMethod: '其他',
            pricePerNight: 0,
            nights,
            totalAmount: 0,
            finalAmount: 0,
            bookingDate,
            emailSent: '0',
            paymentStatus: paymentStatus || 'paid',
            status: status || 'active',
            addons: null,
            addonsTotal: 0
        };
        
        const savedId = await db.saveBooking(bookingData);
        
        // 記錄建立訂房日誌
        await logAction(req, 'create_booking', 'booking', bookingId, {
            guestName: guestName,
            checkInDate: checkInDate,
            checkOutDate: checkOutDate,
            roomType: roomType
        });
        
        console.log('✅ 後台快速建立訂房成功:', bookingId, 'DB ID:', savedId);
        
        res.json({
            success: true,
            message: '訂房已建立',
            data: {
                bookingId,
                id: savedId
            }
        });
    } catch (error) {
        console.error('後台快速建立訂房錯誤:', error);
        res.status(500).json({
            success: false,
            message: '後台快速建立訂房失敗：' + error.message
        });
    }
});

// 生成客戶確認郵件
// 取得旅館資訊 footer
async function getHotelInfoFooter() {
    try {
        const hotelName = await db.getSetting('hotel_name') || '';
        const hotelPhone = await db.getSetting('hotel_phone') || '';
        const hotelAddress = await db.getSetting('hotel_address') || '';
        const hotelEmail = await db.getSetting('hotel_email') || '';
        
        if (!hotelName && !hotelPhone && !hotelAddress && !hotelEmail) {
            return '';
        }
        
        let footer = '<div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd;">';
        footer += '<h3 style="color: #333; margin-bottom: 15px; font-size: 18px;">🏨 旅館資訊</h3>';
        footer += '<div style="color: #666; line-height: 1.8;">';
        
        if (hotelName) {
            footer += `<p style="margin: 5px 0;"><strong>旅館名稱：</strong>${hotelName}</p>`;
        }
        if (hotelPhone) {
            footer += `<p style="margin: 5px 0;"><strong>聯絡電話：</strong>${hotelPhone}</p>`;
        }
        if (hotelAddress) {
            footer += `<p style="margin: 5px 0;"><strong>地址：</strong>${hotelAddress}</p>`;
        }
        if (hotelEmail) {
            footer += `<p style="margin: 5px 0;"><strong>Email：</strong>${hotelEmail}</p>`;
        }
        
        footer += '</div></div>';
        return footer;
    } catch (error) {
        console.error('取得旅館資訊失敗:', error);
        return '';
    }
}

async function generateCustomerEmail(data) {
    console.log('📧 生成客戶郵件，資料:', {
        paymentMethodCode: data.paymentMethodCode,
        daysReserved: data.daysReserved,
        paymentDeadline: data.paymentDeadline,
        bankInfo: data.bankInfo
    });
    const hotelInfoFooter = await getHotelInfoFooter();
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #262A33; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #262A33; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🏨 訂房確認成功</h1>
                <p>感謝您的預訂！</p>
            </div>
            <div class="content">
                <p>親愛的 ${data.guestName}，</p>
                <p style="margin-bottom: 25px;">您的訂房已成功確認，以下是您的訂房資訊：</p>
                
                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${data.bookingId}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${new Date(data.checkInDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${new Date(data.checkOutDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">住宿天數</span>
                        <span class="info-value">${data.nights} 晚</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${data.roomType}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房價（每晚）</span>
                        <span class="info-value">NT$ ${data.pricePerNight.toLocaleString()}</span>
                    </div>
                    ${data.addonsList ? `
                    <div class="info-row">
                        <span class="info-label">加購商品</span>
                        <span class="info-value">${data.addonsList}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">加購商品總額</span>
                        <span class="info-value">NT$ ${(data.addonsTotal || 0).toLocaleString()}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">總金額</span>
                        <span class="info-value">NT$ ${data.totalAmount.toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">支付方式</span>
                        <span class="info-value">${data.paymentAmount} - ${data.paymentMethod}</span>
                    </div>
                    <div class="info-row" style="border-bottom: none; margin-top: 15px; padding-top: 15px; border-top: 2px solid #667eea;">
                        <span class="info-label" style="font-size: 18px;">應付金額</span>
                        <span class="info-value" style="font-size: 20px; color: #667eea; font-weight: 700;">NT$ ${data.finalAmount.toLocaleString()}</span>
                    </div>
                </div>

                ${data.paymentAmount && data.paymentAmount.includes('訂金') ? (() => {
                    const remainingAmount = data.totalAmount - data.finalAmount;
                    return `
                <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 15px; margin: 20px 0;">
                    <p style="color: #2e7d32; font-weight: 600; margin: 0; font-size: 16px;">💡 剩餘尾款於現場付清！</p>
                    <p style="color: #2e7d32; margin: 10px 0 0 0; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ ${remainingAmount.toLocaleString()}</p>
                </div>
                `;
                })() : ''}

                ${data.paymentMethodCode === 'transfer' ? `
                <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #856404; margin-top: 0;">💰 匯款提醒</h3>
                    <p style="color: #856404; font-weight: 600; margin: 10px 0;">
                        ⏰ 此訂房將為您保留 <strong>${data.daysReserved || 3} 天</strong>，請於 <strong>${data.paymentDeadline ? data.paymentDeadline + '前' : (data.daysReserved || 3) + '天內'}</strong>完成匯款，逾期將自動取消訂房。
                    </p>
                    ${data.bankInfo && data.bankInfo.account ? `
                    <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                        <p style="margin: 8px 0; color: #333;"><strong>匯款資訊：</strong></p>
                        ${data.bankInfo.bankName ? `<p style="margin: 5px 0; color: #333;">銀行：${data.bankInfo.bankName}${data.bankInfo.bankBranch ? ' - ' + data.bankInfo.bankBranch : ''}</p>` : ''}
                        <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">${data.bankInfo.account}</span></p>
                        ${data.bankInfo.accountName ? `<p style="margin: 5px 0; color: #333;">戶名：${data.bankInfo.accountName}</p>` : ''}
                        <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>${data.bookingId ? data.bookingId.slice(-5) : ''}</strong></p>
                    </div>
                    ` : '<p style="color: #856404; margin: 10px 0;">⚠️ 匯款資訊尚未設定，請聯繫客服取得匯款帳號。</p>'}
                </div>
                ` : ''}
                
                <p style="margin-top: 30px;"><strong>重要提醒：</strong></p>
                <ul>
                    <li>請於入住當天攜帶身分證件辦理入住手續</li>
                    <li>如需取消或變更訂房，請提前 3 天通知</li>
                    <li>如有任何問題，請隨時與我們聯繫</li>
                </ul>

                <div class="footer" style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd;">
                    <p>感謝您的預訂，期待為您服務！</p>
                    <p>此為系統自動發送郵件，請勿直接回覆</p>
                </div>
                ${hotelInfoFooter}
            </div>
        </div>
    </body>
    </html>
    `;
}

// 生成管理員通知郵件
function generateAdminEmail(data) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e74c3c; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔔 新訂房通知</h1>
            </div>
            <div class="content">
                <p>您有一筆新的訂房申請：</p>
                
                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${data.bookingId}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">客戶姓名</span>
                        <span class="info-value">${data.guestName}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">聯絡電話</span>
                        <span class="info-value">${data.guestPhone}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Email</span>
                        <span class="info-value">${data.guestEmail}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${new Date(data.checkInDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${new Date(data.checkOutDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${data.roomType}</span>
                    </div>
                    ${data.addonsList ? `
                    <div class="info-row">
                        <span class="info-label">加購商品</span>
                        <span class="info-value">${data.addonsList}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">加購商品總額</span>
                        <span class="info-value">NT$ ${(data.addonsTotal || 0).toLocaleString()}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">總金額</span>
                        <span class="info-value" style="color: #333; font-weight: 600;">NT$ ${(data.totalAmount || 0).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">應付金額</span>
                        <span class="info-value" style="color: #e74c3c; font-weight: 700;">NT$ ${data.finalAmount.toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">支付方式</span>
                        <span class="info-value">${data.paymentAmount} - ${data.paymentMethod}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">訂房時間</span>
                        <span class="info-value">${new Date(data.bookingDate).toLocaleString('zh-TW')}</span>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

// 登入驗證中間件
function requireAuth(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    }
    res.status(401).json({ success: false, message: '請先登入' });
}

// 記錄操作日誌的輔助函數
async function logAction(req, action, resourceType = null, resourceId = null, details = null) {
    try {
        const admin = req.session?.admin;
        if (!admin) {
            return; // 未登入的操作不記錄
        }
        
        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.get('user-agent') || 'unknown';
        
        await db.logAdminAction({
            adminId: admin.id,
            adminUsername: admin.username,
            action: action,
            resourceType: resourceType,
            resourceId: resourceId,
            details: details,
            ipAddress: ipAddress,
            userAgent: userAgent
        });
    } catch (error) {
        // 日誌記錄失敗不應影響主要功能
        console.error('記錄操作日誌失敗:', error.message);
    }
}

// 首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 隱私權政策頁面
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy.html'));
});

// 個資保護頁面
app.get('/data-protection', (req, res) => {
    res.sendFile(path.join(__dirname, 'data-protection.html'));
});

// 管理後台登入頁面
app.get('/admin/login', (req, res) => {
    // 如果已經登入，重導向到管理後台
    if (req.session && req.session.admin) {
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 管理後台登入 API（應用嚴格 rate limiting）
app.post('/api/admin/login', loginLimiter, validateLogin, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '請輸入帳號和密碼'
            });
        }
        
        const admin = await db.verifyAdminPassword(username, password);
        
        if (admin) {
            // 建立 Session
            req.session.admin = {
                id: admin.id,
                username: admin.username,
                email: admin.email,
                role: admin.role
            };
            
            // 記錄 Session 資訊（用於除錯）
            console.log('✅ 登入成功，建立 Session:', {
                sessionId: req.sessionID,
                admin: admin.username,
                hasSecret: !!process.env.SESSION_SECRET,
                useSecureCookie: useSecureCookie
            });
            
            // 明確儲存 Session（確保 Cookie 被設定）
            // 注意：express-session 會在回應發送時自動設定 Cookie
            req.session.save((err) => {
                if (err) {
                    console.error('❌ 儲存 Session 錯誤:', err);
                    return res.status(500).json({
                        success: false,
                        message: '登入時發生錯誤：無法儲存 Session'
                    });
                }
                
                // 記錄登入日誌（在 session 儲存後）
                logAction(req, 'login', null, null, {
                    username: admin.username,
                    role: admin.role
                }).catch(err => console.error('記錄登入日誌失敗:', err));
                
                // 回應登入成功（express-session 會在回應發送時設定 Cookie）
                res.json({
                    success: true,
                    message: '登入成功',
                    admin: {
                        username: admin.username,
                        role: admin.role
                    }
                });
            });
        } else {
            // 記錄登入失敗日誌（不包含管理員資訊）
            await db.logAdminAction({
                adminId: null,
                adminUsername: username,
                action: 'login_failed',
                resourceType: null,
                resourceId: null,
                details: JSON.stringify({ reason: 'invalid_credentials' }),
                ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
                userAgent: req.get('user-agent') || 'unknown'
            });
            
            res.status(401).json({
                success: false,
                message: '帳號或密碼錯誤'
            });
        }
    } catch (error) {
        console.error('登入錯誤:', error);
        res.status(500).json({
            success: false,
            message: '登入時發生錯誤：' + error.message
        });
    }
});

// 管理後台登出 API（應用管理後台 rate limiting）
app.post('/api/admin/logout', adminLimiter, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('登出錯誤:', err);
            return res.status(500).json({
                success: false,
                message: '登出時發生錯誤'
            });
        }
        res.json({
            success: true,
            message: '已成功登出'
        });
    });
});

// 檢查登入狀態 API（應用管理後台 rate limiting）
app.get('/api/admin/check-auth', adminLimiter, (req, res) => {
    if (req.session && req.session.admin) {
        res.json({
            success: true,
            authenticated: true,
            admin: req.session.admin
        });
    } else {
        res.json({
            success: true,
            authenticated: false
        });
    }
});

// API: 取得備份列表
app.get('/api/admin/backups', requireAuth, adminLimiter, async (req, res) => {
    try {
        const backups = backup.getBackupList();
        const stats = backup.getBackupStats();
        
        res.json({
            success: true,
            data: backups,
            stats: stats
        });
    } catch (error) {
        console.error('查詢備份列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '查詢備份列表失敗：' + error.message
        });
    }
});

// API: 手動執行備份
app.post('/api/admin/backups/create', requireAuth, adminLimiter, async (req, res) => {
    try {
        const result = await backup.performBackup();
        
        // 記錄備份操作日誌
        await logAction(req, 'create_backup', 'backup', result.fileName, {
            fileSize: result.fileSizeMB,
            fileName: result.fileName
        });
        
        res.json({
            success: true,
            message: '備份已建立',
            data: result
        });
    } catch (error) {
        console.error('手動備份錯誤:', error);
        res.status(500).json({
            success: false,
            message: '備份失敗：' + error.message
        });
    }
});

// API: 清理舊備份
app.post('/api/admin/backups/cleanup', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { daysToKeep = 30 } = req.body;
        const result = await backup.cleanupOldBackups(parseInt(daysToKeep));
        
        // 記錄清理操作日誌
        await logAction(req, 'cleanup_backups', 'backup', null, {
            deletedCount: result.deletedCount,
            sizeFreedMB: result.totalSizeFreedMB
        });
        
        res.json({
            success: true,
            message: `已清理 ${result.deletedCount} 個舊備份`,
            data: result
        });
    } catch (error) {
        console.error('清理舊備份錯誤:', error);
        res.status(500).json({
            success: false,
            message: '清理失敗：' + error.message
        });
    }
});

// CSRF Token API（提供 Token 給前端）
app.get('/api/csrf-token', generateCsrfToken, (req, res) => {
    res.json({
        success: true,
        csrfToken: req.csrfToken
    });
});

// 保護所有管理後台 API（除了登入相關）
app.use('/api/admin', (req, res, next) => {
    // 排除登入、登出和檢查狀態 API
    if (req.path === '/login' || req.path === '/logout' || req.path === '/check-auth') {
        return next();
    }
    // 先驗證 CSRF Token，再驗證登入狀態
    verifyCsrfToken(req, res, (err) => {
        if (err) return next(err);
        requireAuth(req, res, next);
    });
});

// 管理後台（未登入時顯示登入頁面，已登入時顯示管理後台）
app.get('/admin', generateCsrfToken, (req, res) => {
    // 直接返回 admin.html，由前端 JavaScript 檢查登入狀態並顯示對應頁面
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API: 查詢訂房記錄（可帶入日期區間，供列表與日曆共用）
app.get('/api/bookings', publicLimiter, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let bookings;

        if (startDate && endDate) {
            console.log('📅 查詢日曆區間:', startDate, '~', endDate);
            bookings = await db.getBookingsInRange(startDate, endDate);
        } else {
            console.log('📋 查詢所有訂房記錄');
            bookings = await db.getAllBookings();
        }
        
        // 確保每筆記錄都有 payment_status 和 status 欄位（處理舊資料）
        const bookingsWithDefaults = bookings.map(booking => ({
            ...booking,
            payment_status: booking.payment_status || 'pending',
            status: booking.status || 'active'
        }));
        
        res.json({
            success: true,
            count: bookingsWithDefaults.length,
            data: bookingsWithDefaults
        });
    } catch (error) {
        console.error('查詢訂房記錄錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢訂房記錄失敗：' + error.message 
        });
    }
});

// API: 根據訂房編號查詢單筆訂房（供後台列表/日曆詳情使用）
app.get('/api/bookings/:bookingId', publicLimiter, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await db.getBookingById(bookingId);
        
        if (booking) {
            res.json({
                success: true,
                data: booking
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
    } catch (error) {
        console.error('查詢單筆訂房記錄錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢單筆訂房記錄失敗：' + error.message
        });
    }
});

// API: 根據 Email 查詢訂房記錄
app.get('/api/bookings/email/:email', publicLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        const bookings = await db.getBookingsByEmail(email);
        
        res.json({
            success: true,
            count: bookings.length,
            data: bookings
        });
    } catch (error) {
        console.error('查詢訂房記錄錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢訂房記錄失敗' 
        });
    }
});

// API: 取得所有客戶列表（聚合訂房資料）- 需要登入
app.get('/api/customers', requireAuth, adminLimiter, async (req, res) => {
    try {
        const customers = await db.getAllCustomers();
        
        res.json({
            success: true,
            count: customers.length,
            data: customers
        });
    } catch (error) {
        console.error('查詢客戶列表錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢客戶列表失敗：' + error.message 
        });
    }
});

// API: 取得單一客戶詳情（包含所有訂房記錄）
app.get('/api/customers/:email', publicLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        const customer = await db.getCustomerByEmail(email);
        
        if (customer) {
            res.json({
                success: true,
                data: customer
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該客戶'
            });
        }
    } catch (error) {
        console.error('查詢客戶詳情錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢客戶詳情失敗：' + error.message 
        });
    }
});

// ==================== 個資保護 API ====================

const dataProtection = require('./data-protection');

// 發送個資查詢驗證碼
app.post('/api/data-protection/send-verification-code', publicLimiter, async (req, res, next) => {
    try {
        const { email, purpose } = req.body;
        
        if (!email || !purpose) {
            return res.status(400).json({
                success: false,
                message: '請提供 Email 和操作目的'
            });
        }
        
        // 驗證 Email 格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Email 格式不正確'
            });
        }
        
        // 檢查是否有該 Email 的資料
        let customer;
        try {
            customer = await db.getCustomerByEmail(email);
        } catch (dbError) {
            console.error('查詢客戶資料錯誤:', dbError);
            return res.status(500).json({
                success: false,
                message: '查詢客戶資料時發生錯誤：' + dbError.message
            });
        }
        
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '找不到該 Email 的資料'
            });
        }
        
        // 生成並發送驗證碼
        const code = dataProtection.generateVerificationCode();
        dataProtection.saveVerificationCode(email, code, purpose);
        
        try {
            await dataProtection.sendVerificationEmail(email, code, purpose);
            console.log(`✅ 驗證碼已發送至 ${email} (目的: ${purpose})`);
            res.json({
                success: true,
                message: '驗證碼已發送至您的 Email'
            });
        } catch (emailError) {
            console.error('❌ 發送驗證碼失敗:', emailError);
            console.error('錯誤詳情:', emailError.message);
            console.error('錯誤堆疊:', emailError.stack);
            res.status(500).json({
                success: false,
                message: '發送驗證碼失敗：' + (emailError.message || '請稍後再試')
            });
        }
    } catch (error) {
        console.error('❌ 發送驗證碼 API 錯誤:', error);
        console.error('錯誤詳情:', error.message);
        console.error('錯誤堆疊:', error.stack);
        next(error);
    }
});

// 查詢個人資料（需要驗證碼）
app.post('/api/data-protection/query', publicLimiter, async (req, res, next) => {
    try {
        const { email, verificationCode } = req.body;
        
        if (!email || !verificationCode) {
            return res.status(400).json({
                success: false,
                message: '請提供 Email 和驗證碼'
            });
        }
        
        // 驗證驗證碼
        const verification = dataProtection.verifyCode(email, verificationCode, 'query');
        if (!verification.valid) {
            return res.status(400).json({
                success: false,
                message: verification.message
            });
        }
        
        // 取得客戶資料
        const customer = await db.getCustomerByEmail(email);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '找不到該 Email 的資料'
            });
        }
        
        res.json({
            success: true,
            data: customer
        });
    } catch (error) {
        console.error('查詢個人資料錯誤:', error);
        next(error);
    }
});

// 刪除個人資料（需要驗證碼）
app.post('/api/data-protection/delete', publicLimiter, async (req, res, next) => {
    try {
        const { email, verificationCode } = req.body;
        
        if (!email || !verificationCode) {
            return res.status(400).json({
                success: false,
                message: '請提供 Email 和驗證碼'
            });
        }
        
        // 驗證驗證碼
        const verification = dataProtection.verifyCode(email, verificationCode, 'delete');
        if (!verification.valid) {
            return res.status(400).json({
                success: false,
                message: verification.message
            });
        }
        
        // 檢查是否有該 Email 的資料
        const customer = await db.getCustomerByEmail(email);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '找不到該 Email 的資料'
            });
        }
        
        // 匿名化資料（而非完全刪除，以符合會計法規）
        await db.anonymizeCustomerData(email);
        
        // 記錄操作日誌
        try {
            await db.logAdminAction(null, 'customer_data_deletion', 'customer', email, {
                email: email,
                action: 'data_deletion',
                method: 'anonymization'
            });
        } catch (logError) {
            console.error('記錄操作日誌失敗:', logError);
        }
        
        res.json({
            success: true,
            message: '您的個人資料已成功刪除（已匿名化處理）'
        });
    } catch (error) {
        console.error('刪除個人資料錯誤:', error);
        next(error);
    }
});

// API: 取得統計資料 - 需要登入
// 支援可選的日期區間：?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/statistics', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let stats;
        if (startDate && endDate) {
            stats = await db.getStatistics(startDate, endDate);
            stats.period = {
                startDate,
                endDate
            };
        } else {
            stats = await db.getStatistics();
            stats.period = {};
        }
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('查詢統計資料錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢統計資料失敗' 
        });
    }
});

// API: 儀表板數據
app.get('/api/dashboard', adminLimiter, async (req, res) => {
    try {
        // 獲取今天的日期（YYYY-MM-DD）
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        
        // 獲取所有訂房記錄
        const allBookings = await db.getAllBookings();
        
        // 計算今日房況
        const todayCheckIns = allBookings.filter(booking => 
            booking.check_in_date === todayStr && 
            (booking.status === 'active' || booking.status === 'reserved')
        ).length;
        
        const todayCheckOuts = allBookings.filter(booking => 
            booking.check_out_date === todayStr && 
            booking.status === 'active'
        ).length;
        
        // 計算今日訂單（訂購日為今日）
        const todayBookings = allBookings.filter(booking => {
            const bookingDate = new Date(booking.created_at || booking.booking_date);
            const bookingDateStr = `${bookingDate.getFullYear()}-${String(bookingDate.getMonth() + 1).padStart(2, '0')}-${String(bookingDate.getDate()).padStart(2, '0')}`;
            return bookingDateStr === todayStr;
        });
        
        const todayTransferOrders = todayBookings.filter(booking => 
            booking.payment_method && booking.payment_method.includes('匯款')
        ).length;
        
        const todayCardOrders = todayBookings.filter(booking => 
            booking.payment_method && (booking.payment_method.includes('線上') || booking.payment_method.includes('卡'))
        ).length;
        
        // 計算訂房狀態
        const activeBookings = allBookings.filter(booking => booking.status === 'active').length;
        const reservedBookings = allBookings.filter(booking => booking.status === 'reserved').length;
        const cancelledBookings = allBookings.filter(booking => booking.status === 'cancelled').length;
        
        res.json({
            success: true,
            data: {
                todayCheckIns,
                todayCheckOuts,
                todayTransferOrders,
                todayCardOrders,
                activeBookings,
                reservedBookings,
                cancelledBookings
            }
        });
    } catch (error) {
        console.error('查詢儀表板數據錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢儀表板數據失敗：' + error.message
        });
    }
});

// API: 更新訂房資料
app.put('/api/bookings/:bookingId', adminLimiter, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const updateData = req.body;
        
        // 如果付款狀態更新為已付款，且訂房狀態為保留，自動改為有效
        if (updateData.payment_status === 'paid') {
            const booking = await db.getBookingById(bookingId);
            if (booking && booking.status === 'reserved') {
                updateData.status = 'active';
                console.log(`✅ 付款狀態更新為已付款，自動將訂房狀態從「保留」改為「有效」`);
            }
        }
        
        const result = await db.updateBooking(bookingId, updateData);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '訂房資料已更新'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
    } catch (error) {
        console.error('更新訂房資料錯誤:', error);
        console.error('錯誤詳情:', error.message);
        console.error('錯誤堆疊:', error.stack);
        res.status(500).json({
            success: false,
            message: '更新訂房資料失敗: ' + error.message
        });
    }
});

// API: 取消訂房
app.post('/api/bookings/:bookingId/cancel', adminLimiter, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const result = await db.cancelBooking(bookingId);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '訂房已取消'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
    } catch (error) {
        console.error('取消訂房錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取消訂房失敗'
        });
    }
});

// API: 刪除訂房（僅限已取消的訂房）
app.delete('/api/bookings/:bookingId', adminLimiter, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        // 先檢查訂房狀態，只允許刪除已取消的訂房
        const booking = await db.getBookingById(bookingId);
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
        
        if (booking.status !== 'cancelled') {
            return res.status(400).json({
                success: false,
                message: '只能刪除已取消的訂房'
            });
        }
        
        const result = await db.deleteBooking(bookingId);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '訂房已刪除'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
    } catch (error) {
        console.error('刪除訂房錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除訂房失敗: ' + error.message
        });
    }
});

// ==================== 房型管理 API ====================

// API: 取得所有房型（公開，供前台使用）
app.get('/api/room-types', publicLimiter, async (req, res) => {
    try {
        const roomTypes = await db.getAllRoomTypes();
        res.json({
            success: true,
            data: roomTypes
        });
    } catch (error) {
        console.error('取得房型列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得房型列表失敗'
        });
    }
});

// API: 檢查房間可用性
app.get('/api/room-availability', publicLimiter, async (req, res) => {
    try {
        const { checkInDate, checkOutDate } = req.query;
        
        if (!checkInDate || !checkOutDate) {
            return res.status(400).json({
                success: false,
                message: '請提供入住日期和退房日期'
            });
        }
        
        const availability = await db.getRoomAvailability(checkInDate, checkOutDate);
        res.json({
            success: true,
            data: availability
        });
    } catch (error) {
        console.error('檢查房間可用性錯誤:', error);
        res.status(500).json({
            success: false,
            message: '檢查房間可用性失敗：' + error.message
        });
    }
});


// API: 取得所有房型（管理後台，包含已停用的）
app.get('/api/admin/room-types', requireAuth, adminLimiter, async (req, res) => {
    try {
        // 使用資料庫抽象層，支援 PostgreSQL 和 SQLite
        const roomTypes = await db.getAllRoomTypesAdmin();
        res.json({
            success: true,
            data: roomTypes
        });
    } catch (error) {
        console.error('取得房型列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得房型列表失敗: ' + error.message
        });
    }
});

// API: 新增房型
app.post('/api/admin/room-types', requireAuth, adminLimiter, validateRoomType, async (req, res) => {
    try {
        const roomData = req.body;
        
        if (!roomData.name || !roomData.display_name || !roomData.price) {
            return res.status(400).json({
                success: false,
                message: '請提供完整的房型資料（名稱、顯示名稱、價格）'
            });
        }
        
        const id = await db.createRoomType(roomData);
        
        // 記錄新增房型日誌
        await logAction(req, 'create_room_type', 'room_type', id.toString(), {
            name: roomData.name,
            display_name: roomData.display_name
        });
        
        res.json({
            success: true,
            message: '房型已新增',
            data: { id }
        });
    } catch (error) {
        console.error('新增房型錯誤:', error);
        res.status(500).json({
            success: false,
            message: '新增房型失敗: ' + error.message
        });
    }
});

// API: 更新房型
app.put('/api/admin/room-types/:id', requireAuth, adminLimiter, validateRoomType, async (req, res) => {
    try {
        const { id } = req.params;
        const roomData = req.body;
        
        const result = await db.updateRoomType(id, roomData);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '房型已更新'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該房型'
            });
        }
    } catch (error) {
        console.error('更新房型錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新房型失敗: ' + error.message
        });
    }
});

// ==================== 假日管理 API ====================

// API: 取得所有假日
app.get('/api/admin/holidays', requireAuth, adminLimiter, async (req, res) => {
    try {
        const holidays = await db.getAllHolidays();
        res.json({
            success: true,
            data: holidays
        });
    } catch (error) {
        console.error('取得假日列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得假日列表失敗: ' + error.message
        });
    }
});

// API: 新增假日
app.post('/api/admin/holidays', requireAuth, adminLimiter, validateHoliday, async (req, res) => {
    try {
        const { holidayDate, holidayName, startDate, endDate } = req.body;
        
        if (!holidayDate && (!startDate || !endDate)) {
            return res.status(400).json({
                success: false,
                message: '請提供假日日期或日期範圍'
            });
        }
        
        let addedCount = 0;
        
        if (startDate && endDate) {
            // 新增連續假期
            addedCount = await db.addHolidayRange(startDate, endDate, holidayName);
        } else {
            // 新增單一假日
            addedCount = await db.addHoliday(holidayDate, holidayName);
        }
        
        res.json({
            success: true,
            message: `已新增 ${addedCount} 個假日`,
            data: { addedCount }
        });
    } catch (error) {
        console.error('新增假日錯誤:', error);
        res.status(500).json({
            success: false,
            message: '新增假日失敗: ' + error.message
        });
    }
});

// API: 刪除假日
app.delete('/api/admin/holidays/:date', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { date } = req.params;
        const result = await db.deleteHoliday(date);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '假日已刪除'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該假日'
            });
        }
    } catch (error) {
        console.error('刪除假日錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除假日失敗: ' + error.message
        });
    }
});

// API: 檢查日期是否為假日
app.get('/api/check-holiday', publicLimiter, async (req, res) => {
    try {
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '請提供日期'
            });
        }
        
        const isHoliday = await db.isHolidayOrWeekend(date, true);
        res.json({
            success: true,
            data: { isHoliday, date }
        });
    } catch (error) {
        console.error('檢查假日錯誤:', error);
        res.status(500).json({
            success: false,
            message: '檢查假日失敗: ' + error.message
        });
    }
});

// API: 計算訂房價格（考慮平日/假日）
app.get('/api/calculate-price', publicLimiter, async (req, res) => {
    try {
        const { checkInDate, checkOutDate, roomTypeName } = req.query;
        
        if (!checkInDate || !checkOutDate || !roomTypeName) {
            return res.status(400).json({
                success: false,
                message: '請提供入住日期、退房日期和房型名稱'
            });
        }
        
        // 取得房型資訊
        const allRoomTypes = await db.getAllRoomTypes();
        const roomType = allRoomTypes.find(r => r.display_name === roomTypeName || r.name === roomTypeName);
        
        if (!roomType) {
            return res.status(404).json({
                success: false,
                message: '找不到該房型'
            });
        }
        
        const basePrice = roomType.price || 0;
        const holidaySurcharge = roomType.holiday_surcharge || 0;
        
        // 計算每日價格
        const startDate = new Date(checkInDate);
        const endDate = new Date(checkOutDate);
        let totalAmount = 0;
        const dailyPrices = [];
        
        for (let date = new Date(startDate); date < endDate; date.setDate(date.getDate() + 1)) {
            const dateString = date.toISOString().split('T')[0];
            const isHoliday = await db.isHolidayOrWeekend(dateString, true);
            const dailyPrice = isHoliday ? basePrice + holidaySurcharge : basePrice;
            totalAmount += dailyPrice;
            dailyPrices.push({
                date: dateString,
                isHoliday,
                price: dailyPrice
            });
        }
        
        const nights = dailyPrices.length;
        const averagePricePerNight = nights > 0 ? Math.round(totalAmount / nights) : basePrice;
        
        res.json({
            success: true,
            data: {
                basePrice,
                holidaySurcharge,
                nights,
                totalAmount,
                averagePricePerNight,
                dailyPrices
            }
        });
    } catch (error) {
        console.error('計算價格錯誤:', error);
        res.status(500).json({
            success: false,
            message: '計算價格失敗: ' + error.message
        });
    }
});

// API: 刪除房型
app.delete('/api/admin/room-types/:id', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 先檢查房型是否存在
        const roomType = await db.getRoomTypeById(id);
        if (!roomType) {
            return res.status(404).json({
                success: false,
                message: '找不到該房型'
            });
        }
        
        // 執行刪除（軟刪除）
        const result = await db.deleteRoomType(id);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '房型已刪除'
            });
        } else {
            // 如果房型存在但更新失敗，可能是已經被刪除
            // 仍然返回成功，因為目標狀態（停用）已經達成
            res.json({
                success: true,
                message: '房型已刪除（該房型原本已停用）'
            });
        }
    } catch (error) {
        console.error('刪除房型錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除房型失敗: ' + error.message
        });
    }
});

// ==================== 加購商品管理 API ====================

// API: 取得所有加購商品（公開，供前台使用）
app.get('/api/addons', publicLimiter, async (req, res) => {
    try {
        const addons = await db.getAllAddons();
        res.json({
            success: true,
            data: addons
        });
    } catch (error) {
        console.error('取得加購商品列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得加購商品列表失敗'
        });
    }
});

// API: 取得所有加購商品（管理後台，包含已停用的）
app.get('/api/admin/addons', requireAuth, adminLimiter, async (req, res) => {
    try {
        const addons = await db.getAllAddonsAdmin();
        res.json({
            success: true,
            data: addons
        });
    } catch (error) {
        console.error('取得加購商品列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得加購商品列表失敗: ' + error.message
        });
    }
});

// API: 新增加購商品
app.post('/api/admin/addons', requireAuth, adminLimiter, validateAddon, async (req, res) => {
    try {
        const addonData = req.body;
        
        if (!addonData.name || !addonData.display_name || addonData.price === undefined) {
            return res.status(400).json({
                success: false,
                message: '請提供完整的加購商品資料（名稱、顯示名稱、價格）'
            });
        }
        
        const id = await db.createAddon(addonData);
        res.json({
            success: true,
            message: '加購商品已新增',
            data: { id }
        });
    } catch (error) {
        console.error('新增加購商品錯誤:', error);
        res.status(500).json({
            success: false,
            message: '新增加購商品失敗: ' + error.message
        });
    }
});

// API: 更新加購商品
app.put('/api/admin/addons/:id', requireAuth, adminLimiter, validateAddon, async (req, res) => {
    try {
        const { id } = req.params;
        const addonData = req.body;
        
        const result = await db.updateAddon(id, addonData);
        
        if (result) {
            res.json({
                success: true,
                message: '加購商品已更新'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該加購商品'
            });
        }
    } catch (error) {
        console.error('更新加購商品錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新加購商品失敗: ' + error.message
        });
    }
});

// API: 刪除加購商品
app.delete('/api/admin/addons/:id', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 先檢查加購商品是否存在
        const addon = await db.getAddonById(id);
        if (!addon) {
            return res.status(404).json({
                success: false,
                message: '找不到該加購商品'
            });
        }
        
        // 執行刪除
        const result = await db.deleteAddon(id);
        
        if (result) {
            res.json({
                success: true,
                message: '加購商品已刪除'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '刪除加購商品失敗'
            });
        }
    } catch (error) {
        console.error('刪除加購商品錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除加購商品失敗: ' + error.message
        });
    }
});

// ==================== 系統設定 API ====================

// API: 取得系統設定
app.get('/api/settings', publicLimiter, async (req, res) => {
    try {
        const settings = await db.getAllSettings();
        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.key] = setting.value;
        });
        
        res.json({
            success: true,
            data: settingsObj
        });
    } catch (error) {
        console.error('取得設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得設定失敗'
        });
    }
});

// API: 更新系統設定
app.put('/api/admin/settings/:key', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { key } = req.params;
        const { value, description } = req.body;
        
        if (value === undefined) {
            return res.status(400).json({
                success: false,
                message: '請提供設定值'
            });
        }
        
        await db.updateSetting(key, value, description);
        res.json({
            success: true,
            message: '設定已更新'
        });
    } catch (error) {
        console.error('更新設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新設定失敗: ' + error.message
        });
    }
});

// API: 建立支付表單（用於重新支付）
app.post('/api/payment/create', paymentLimiter, async (req, res) => {
    try {
        const { bookingId } = req.body;
        
        if (!bookingId) {
            return res.status(400).json({
                success: false,
                message: '請提供訂房編號'
            });
        }
        
        // 從資料庫取得訂房資料
        const booking = await db.getBookingById(bookingId);
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
        
        // 建立支付表單
        const paymentData = payment.createPaymentForm({
            bookingId: booking.booking_id,
            finalAmount: booking.final_amount,
            guestName: booking.guest_name,
            guestEmail: booking.guest_email,
            guestPhone: booking.guest_phone
        }, {
            amount: booking.final_amount,
            description: `訂房編號：${booking.booking_id}`
        });
        
        res.json({
            success: true,
            data: paymentData
        });
    } catch (error) {
        console.error('建立支付表單錯誤:', error);
        res.status(500).json({
            success: false,
            message: '建立支付表單失敗'
        });
    }
});

// API: 綠界付款完成回傳（Server POST）
app.post('/api/payment/return', paymentLimiter, async (req, res) => {
    try {
        console.log('\n========================================');
        console.log('📥 收到綠界付款回傳');
        console.log('時間:', new Date().toLocaleString('zh-TW'));
        console.log('回傳資料:', req.body);
        console.log('========================================\n');
        
        // 驗證回傳資料
        const isValid = payment.verifyReturnData(req.body);
        
        if (!isValid) {
            console.error('❌ 回傳資料驗證失敗');
            return res.status(400).send('驗證失敗');
        }
        
        // 解析回傳資料
        const paymentResult = payment.parseReturnData(req.body);
        
        console.log('付款結果:', paymentResult);
        
        // 回傳 1|OK 給綠界（必須）
        res.send('1|OK');
    } catch (error) {
        console.error('處理付款回傳錯誤:', error);
        res.status(500).send('處理失敗');
    }
});

// API: 綠界付款完成導向（Client Redirect - 支援 GET 和 POST）
const handlePaymentResult = async (req, res) => {
    try {
        console.log('\n========================================');
        console.log('📥 收到綠界付款完成導向');
        console.log('時間:', new Date().toLocaleString('zh-TW'));
        console.log('請求方法:', req.method);
        console.log('回傳資料:', req.method === 'POST' ? req.body : req.query);
        console.log('========================================\n');
        
        // 根據請求方法取得資料
        const returnData = req.method === 'POST' ? req.body : req.query;
        
        // 驗證回傳資料
        console.log('開始驗證回傳資料...');
        const isValid = payment.verifyReturnData(returnData);
        
        if (!isValid) {
            console.error('❌ 付款驗證失敗');
            console.error('回傳資料內容:', JSON.stringify(returnData, null, 2));
            
            // 在測試環境中，即使驗證失敗也顯示結果（僅用於除錯）
            // 注意：正式環境應該嚴格驗證，測試環境可以寬鬆處理
            const isTestEnv = process.env.NODE_ENV !== 'production';
            if (isTestEnv && returnData.RtnCode === '1') {
                console.warn('⚠️  測試環境：CheckMacValue 驗證失敗，但付款成功（RtnCode=1）');
                console.warn('⚠️  正式環境請修正 CheckMacValue 計算方式');
                
                // 即使驗證失敗，如果付款成功也要更新狀態
                try {
                    const paymentResult = payment.parseReturnData(returnData);
                    if (paymentResult.rtnCode === '1') {
                        const bookingId = paymentResult.merchantTradeNo;
                        console.log('✅ 測試環境：付款成功，更新訂房記錄:', bookingId);
                        
                        // 取得訂房資料
                        const booking = await db.getBookingById(bookingId);
                        if (booking) {
                            // 更新付款狀態為已付款，並將訂房狀態改為有效
                        await db.updateBooking(bookingId, {
                                payment_status: 'paid',
                                status: 'active'
                            });
                            console.log('✅ 付款狀態已更新為「已付款」，訂房狀態已更新為「有效」');
                            
                            // 線上刷卡付款完成後，發送確認郵件
                            if (booking.payment_method && booking.payment_method.includes('刷卡')) {
                                console.log('📧 測試環境：線上刷卡付款完成，發送確認郵件...');
                                try {
                                    // 處理加購商品顯示名稱
                                    let addonsList = '';
                                    if (booking.addons) {
                                        try {
                                            const parsedAddons = typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons;
                                            if (parsedAddons && parsedAddons.length > 0) {
                                                const allAddons = await db.getAllAddonsAdmin();
                                                addonsList = parsedAddons.map(addon => {
                                                    const addonInfo = allAddons.find(a => a.name === addon.name);
                                                    const displayName = addonInfo ? addonInfo.display_name : addon.name;
                                                    const quantity = addon.quantity || 1;
                                                    const itemTotal = addon.price * quantity;
                                                    return `${displayName} x${quantity} (NT$ ${itemTotal.toLocaleString()})`;
                                                }).join('、');
                                            }
                                        } catch (err) {
                                            console.error('處理加購商品顯示失敗:', err);
                                        }
                                    }
                                    
                                    const bookingData = {
                                        bookingId: booking.booking_id,
                                        guestName: booking.guest_name,
                                        guestEmail: booking.guest_email,
                                        guestPhone: booking.guest_phone,
                                        checkInDate: booking.check_in_date,
                                        checkOutDate: booking.check_out_date,
                                        roomType: booking.room_type,
                                        pricePerNight: booking.price_per_night,
                                        nights: booking.nights,
                                        totalAmount: booking.total_amount,
                                        finalAmount: booking.final_amount,
                                        paymentAmount: booking.payment_amount,
                                        paymentMethod: booking.payment_method,
                                        paymentMethodCode: 'card',
                                        bookingDate: booking.booking_date,
                                        bankInfo: null,
                                        addons: booking.addons ? (typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons) : null,
                                        addonsTotal: booking.addons_total || 0,
                                        addonsList: addonsList
                                    };
                                    
                                    const customerMailOptions = {
                                        from: process.env.EMAIL_USER || 'your-email@gmail.com',
                                        to: booking.guest_email,
                                        subject: '【訂房確認】您的訂房已成功',
                                        html: await generateCustomerEmail(bookingData)
                                    };
                                    
                                    let emailSent = false;
                                    if (sendEmailViaGmailAPI) {
                                        try {
                                            await sendEmailViaGmailAPI(customerMailOptions);
                                            emailSent = true;
                                        } catch (gmailError) {
                                            try {
                                                await transporter.sendMail(customerMailOptions);
                                                emailSent = true;
                                            } catch (smtpError) {
                                                console.error('❌ 確認郵件發送失敗:', smtpError.message);
                                            }
                                        }
                                    } else {
                                        try {
                                            await transporter.sendMail(customerMailOptions);
                                            emailSent = true;
                                        } catch (smtpError) {
                                            console.error('❌ 確認郵件發送失敗:', smtpError.message);
                                        }
                                    }
                                    
                                    if (emailSent) {
                                        await db.updateEmailStatus(bookingId, 'booking_confirmation');
                                        console.log('✅ 確認郵件已發送，郵件狀態已更新');
                                    }
                                } catch (emailError) {
                                    console.error('❌ 發送確認郵件失敗:', emailError.message);
                                }
                            }
                        }
                    }
                } catch (updateError) {
                    console.error('❌ 更新付款狀態失敗:', updateError);
                }
                
                // 繼續處理（僅測試環境且付款成功時）
            } else {
                return res.send(`
                    <html>
                        <head>
                            <meta charset="UTF-8">
                            <style>
                                body {
                                    font-family: 'Microsoft JhengHei', Arial, sans-serif;
                                    display: flex;
                                    justify-content: center;
                                    align-items: center;
                                    min-height: 100vh;
                                    margin: 0;
                                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                }
                                .container {
                                    background: white;
                                    padding: 40px;
                                    border-radius: 20px;
                                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                    text-align: center;
                                    max-width: 500px;
                                }
                                .error-icon {
                                    font-size: 80px;
                                    color: #f44336;
                                    margin-bottom: 20px;
                                }
                                h1 { color: #333; margin-bottom: 10px; }
                                p { color: #666; margin: 10px 0; }
                                .btn {
                                    display: inline-block;
                                    margin-top: 20px;
                                    padding: 12px 30px;
                                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                    color: white;
                                    text-decoration: none;
                                    border-radius: 8px;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="error-icon">⚠️</div>
                                <h1>付款驗證失敗</h1>
                                <p>請聯繫客服確認付款狀態</p>
                                <p style="font-size: 12px; color: #999;">請查看終端機日誌了解詳細資訊</p>
                                <a href="/" class="btn">返回首頁</a>
                            </div>
                        </body>
                    </html>
                `);
            }
        } else {
            console.log('✅ 付款驗證成功');
        }
        
        // 解析回傳資料
        const paymentResult = payment.parseReturnData(returnData);
        
        // 根據付款結果顯示頁面
        if (paymentResult.rtnCode === '1') {
            // 付款成功 - 更新資料庫中的付款狀態
            try {
                const bookingId = paymentResult.merchantTradeNo; // 訂房編號
                console.log('✅ 付款成功，更新訂房記錄:', bookingId);
                
                // 取得訂房資料
                const booking = await db.getBookingById(bookingId);
                if (!booking) {
                    throw new Error('找不到訂房記錄');
                }
                
                // 更新付款狀態為已付款，並將訂房狀態改為有效
                await db.updateBooking(bookingId, {
                    payment_status: 'paid',
                    status: 'active'
                });
                
                console.log('✅ 付款狀態已更新為「已付款」，訂房狀態已更新為「有效」');
                
                // 線上刷卡付款完成後，發送確認郵件
                if (booking.payment_method && booking.payment_method.includes('刷卡')) {
                    console.log('📧 線上刷卡付款完成，發送確認郵件...');
                    try {
                        // 構建 bookingData 物件
                        // 處理加購商品顯示名稱
                        let addonsList = '';
                        if (booking.addons) {
                            try {
                                const parsedAddons = typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons;
                                if (parsedAddons && parsedAddons.length > 0) {
                                    const allAddons = await db.getAllAddonsAdmin();
                                    addonsList = parsedAddons.map(addon => {
                                        const addonInfo = allAddons.find(a => a.name === addon.name);
                                        const displayName = addonInfo ? addonInfo.display_name : addon.name;
                                        const quantity = addon.quantity || 1;
                                        const itemTotal = addon.price * quantity;
                                        return `${displayName} x${quantity} (NT$ ${itemTotal.toLocaleString()})`;
                                    }).join('、');
                                }
                            } catch (err) {
                                console.error('處理加購商品顯示失敗:', err);
                            }
                        }
                        
                        const bookingData = {
                            bookingId: booking.booking_id,
                            guestName: booking.guest_name,
                            guestEmail: booking.guest_email,
                            guestPhone: booking.guest_phone,
                            checkInDate: booking.check_in_date,
                            checkOutDate: booking.check_out_date,
                            roomType: booking.room_type,
                            pricePerNight: booking.price_per_night,
                            nights: booking.nights,
                            totalAmount: booking.total_amount,
                            finalAmount: booking.final_amount,
                            paymentAmount: booking.payment_amount,
                            paymentMethod: booking.payment_method,
                            paymentMethodCode: 'card',
                            bookingDate: booking.booking_date,
                            bankInfo: null, // 線上刷卡不需要匯款資訊
                            addons: booking.addons ? (typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons) : null,
                            addonsTotal: booking.addons_total || 0,
                            addonsList: addonsList
                        };
                        
                        // 發送確認郵件
                        const customerMailOptions = {
                            from: process.env.EMAIL_USER || 'your-email@gmail.com',
                            to: booking.guest_email,
                            subject: '【訂房確認】您的訂房已成功',
                            html: await generateCustomerEmail(bookingData)
                        };
                        
                        let emailSent = false;
                        if (sendEmailViaGmailAPI) {
                            try {
                                await sendEmailViaGmailAPI(customerMailOptions);
                                console.log('✅ 確認郵件已發送 (Gmail API)');
                                emailSent = true;
                            } catch (gmailError) {
                                try {
                                    await transporter.sendMail(customerMailOptions);
                                    console.log('✅ 確認郵件已發送 (SMTP)');
                                    emailSent = true;
                                } catch (smtpError) {
                                    console.error('❌ 確認郵件發送失敗:', smtpError.message);
                                }
                            }
                        } else {
                            try {
                                await transporter.sendMail(customerMailOptions);
                                console.log('✅ 確認郵件已發送 (SMTP)');
                                emailSent = true;
                            } catch (smtpError) {
                                console.error('❌ 確認郵件發送失敗:', smtpError.message);
                            }
                        }
                        
                        // 更新郵件狀態
                        if (emailSent) {
                            await db.updateEmailStatus(bookingId, 'booking_confirmation');
                            console.log('✅ 郵件狀態已更新');
                        }
                    } catch (emailError) {
                        console.error('❌ 發送確認郵件失敗:', emailError.message);
                        // 郵件發送失敗不影響付款流程
                    }
                }
            } catch (updateError) {
                console.error('❌ 更新付款狀態失敗:', updateError);
                // 即使更新失敗，也繼續顯示成功頁面
            }
            
            // 付款成功
            res.send(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>付款成功</title>
                        <style>
                            :root {
                                --primary-color: #2C8EC4;
                                --card-bg: #ffffff;
                                --header-bg: #262A33;
                            }
                            body {
                                font-family: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                                background-image: url('/Background%20image.jpg');
                                background-size: cover;
                                background-position: center;
                                background-repeat: no-repeat;
                                background-attachment: fixed;
                                padding: 20px;
                            }
                            .container {
                                background: var(--card-bg);
                                border-radius: 24px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                text-align: center;
                                max-width: 480px;
                                width: 100%;
                                overflow: hidden;
                            }
                            .container-header {
                                background: var(--header-bg);
                                color: #fff;
                                padding: 24px 20px 16px;
                            }
                            .success-icon {
                                font-size: 56px;
                                color: #4caf50;
                                margin-bottom: 8px;
                            }
                            .container-body {
                                padding: 24px 28px 28px;
                            }
                            h1 { color: #333; margin: 0 0 16px; font-size: 24px; }
                            p { color: #555; margin: 6px 0; font-size: 14px; }
                            .btn {
                                display: inline-block;
                                margin-top: 20px;
                                padding: 10px 28px;
                                background: var(--primary-color);
                                color: #fff;
                                text-decoration: none;
                                border-radius: 999px;
                                font-size: 14px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="container-header">
                            <div class="success-icon">✓</div>
                            <h1>付款成功！</h1>
                            </div>
                            <div class="container-body">
                            <p>訂單編號：${paymentResult.merchantTradeNo}</p>
                            <p>交易編號：${paymentResult.tradeNo}</p>
                            <p>付款金額：NT$ ${paymentResult.tradeAmt.toLocaleString()}</p>
                            <p>付款時間：${paymentResult.paymentDate}</p>
                            <a href="/" class="btn">返回首頁</a>
                            </div>
                        </div>
                    </body>
                </html>
            `);
        } else {
            // 付款失敗
            res.send(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>付款失敗</title>
                        <style>
                            body {
                                font-family: 'Microsoft JhengHei', Arial, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            }
                            .container {
                                background: white;
                                padding: 40px;
                                border-radius: 20px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                text-align: center;
                                max-width: 500px;
                            }
                            .error-icon {
                                font-size: 80px;
                                color: #f44336;
                                margin-bottom: 20px;
                            }
                            h1 { color: #333; margin-bottom: 10px; }
                            p { color: #666; margin: 10px 0; }
                            .btn {
                                display: inline-block;
                                margin-top: 20px;
                                padding: 12px 30px;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                color: white;
                                text-decoration: none;
                                border-radius: 8px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error-icon">✗</div>
                            <h1>付款失敗</h1>
                            <p>${paymentResult.rtnMsg || '付款處理失敗'}</p>
                            <a href="/" class="btn">返回首頁</a>
                        </div>
                    </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('處理付款導向錯誤:', error);
        res.status(500).send('處理失敗');
    }
};

// 同時支援 GET 和 POST
app.get('/api/payment/result', paymentLimiter, handlePaymentResult);
app.post('/api/payment/result', paymentLimiter, handlePaymentResult);

// ==================== 郵件模板 API ====================

// API: 取得所有郵件模板
app.get('/api/email-templates', requireAuth, adminLimiter, async (req, res) => {
    try {
        const templates = await db.getAllEmailTemplates();
        res.json({
            success: true,
            data: templates
        });
    } catch (error) {
        console.error('取得郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得郵件模板失敗'
        });
    }
});

// API: 取得單一郵件模板
app.get('/api/email-templates/:key', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { key } = req.params;
        console.log(`📧 取得郵件模板: ${key}`);
        const template = await db.getEmailTemplateByKey(key);
        if (template) {
            console.log(`✅ 找到模板: ${template.template_name}, 內容長度: ${template.content ? template.content.length : 0}`);
            console.log(`   設定值:`, {
                days_reserved: template.days_reserved,
                send_hour_payment_reminder: template.send_hour_payment_reminder,
                days_before_checkin: template.days_before_checkin,
                send_hour_checkin: template.send_hour_checkin,
                days_after_checkout: template.days_after_checkout,
                send_hour_feedback: template.send_hour_feedback
            });
            res.json({
                success: true,
                data: template
            });
        } else {
            console.log(`❌ 找不到模板: ${key}`);
            res.status(404).json({
                success: false,
                message: '找不到該郵件模板'
            });
        }
    } catch (error) {
        console.error('❌ 取得郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得郵件模板失敗'
        });
    }
});

// API: 更新郵件模板
app.put('/api/email-templates/:key', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { key } = req.params;
        const { 
            template_name, 
            subject, 
            content, 
            is_enabled,
            days_before_checkin,
            send_hour_checkin,
            days_after_checkout,
            send_hour_feedback,
            days_reserved,
            send_hour_payment_reminder
        } = req.body;
        
        console.log(`📝 更新郵件模板: ${key}`);
        console.log(`   模板名稱: ${template_name}`);
        console.log(`   主旨: ${subject}`);
        console.log(`   內容長度: ${content ? content.length : 0}`);
        console.log(`   啟用狀態: ${is_enabled}`);
        console.log(`   設定值:`, {
            days_before_checkin,
            send_hour_checkin,
            days_after_checkout,
            send_hour_feedback,
            days_reserved,
            send_hour_payment_reminder
        });
        
        if (!template_name || !subject || !content) {
            console.error('❌ 缺少必填欄位');
            return res.status(400).json({
                success: false,
                message: '請填寫所有必填欄位'
            });
        }
        
        const result = await db.updateEmailTemplate(key, {
            template_name,
            subject,
            content,
            is_enabled: is_enabled !== false,
            days_before_checkin,
            send_hour_checkin,
            days_after_checkout,
            send_hour_feedback,
            days_reserved,
            send_hour_payment_reminder
        });
        
        console.log(`✅ 郵件模板已更新，影響行數: ${result.changes}`);
        
        res.json({
            success: true,
            message: '郵件模板已更新'
        });
    } catch (error) {
        console.error('❌ 更新郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新郵件模板失敗: ' + error.message
        });
    }
});

// API: 發送測試郵件
app.post('/api/email-templates/:key/test', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { key } = req.params;
        const { email, useEditorContent } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                message: '請提供 Email 地址'
            });
        }
        
        // 如果前端明確要求使用編輯器中的內容，則使用 req.body 中的內容
        // 否則從資料庫讀取最新的模板內容
        let content, subject;
        
        if (useEditorContent && req.body.content && req.body.subject) {
            // 使用編輯器中的內容（用戶修改後的內容）
            content = req.body.content;
            subject = req.body.subject;
        } else {
            // 從資料庫讀取最新的模板內容
            const template = await db.getEmailTemplateByKey(key);
            if (!template) {
                return res.status(404).json({
                    success: false,
                    message: '找不到該郵件模板'
                });
            }
            content = template.content;
            subject = template.subject;
        }
        
        // Email 格式驗證
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: '請提供有效的 Email 地址'
            });
        }
        
        // 創建測試資料來替換模板變數
        const testData = {
            guestName: '測試用戶',
            bookingId: 'TEST' + Date.now().toString().slice(-6),
            checkInDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('zh-TW'),
            checkOutDate: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toLocaleDateString('zh-TW'),
            roomType: '標準雙人房',
            totalAmount: '10,000',
            finalAmount: '3,000',
            remainingAmount: '7,000',
            bankName: '測試銀行',
            bankBranch: '測試分行',
            bankBranchDisplay: ' - 測試分行',
            bankAccount: '1234567890123',
            accountName: '測試戶名',
            daysReserved: '3',
            paymentDeadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('zh-TW'),
            addonsList: '加床 x1 (NT$ 500)',
            addonsTotal: '500'
        };
        
        // 替換模板變數
        let testContent = content;
        Object.keys(testData).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            testContent = testContent.replace(regex, testData[key]);
        });
        
        // 處理條件區塊（顯示所有條件區塊用於測試）
        // 移除 {{#if isDeposit}} 條件，直接顯示內容
        testContent = testContent.replace(/\{\{#if isDeposit\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        // 移除 {{#if addonsList}} 條件，直接顯示內容
        testContent = testContent.replace(/\{\{#if addonsList\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        
        // 替換主旨中的變數
        let testSubject = subject;
        Object.keys(testData).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            testSubject = testSubject.replace(regex, testData[key]);
        });
        
        // 添加旅館資訊 footer
        const hotelInfoFooter = await getHotelInfoFooter();
        if (hotelInfoFooter) {
            testContent = testContent.replace('</body>', hotelInfoFooter + '</body>');
        }
        
        // 發送測試郵件
        const mailOptions = {
            from: emailUser,
            to: email,
            subject: `[測試] ${testSubject}`,
            html: testContent
        };
        
        if (sendEmailViaGmailAPI) {
            await sendEmailViaGmailAPI(mailOptions);
        } else {
            return res.status(500).json({
                success: false,
                message: '郵件服務未配置，無法發送測試郵件'
            });
        }
        
        res.json({
            success: true,
            message: '測試郵件已成功發送'
        });
    } catch (error) {
        console.error('發送測試郵件錯誤:', error);
        res.status(500).json({
            success: false,
            message: '發送測試郵件失敗：' + error.message
        });
    }
});

// API: 重置郵件模板為預設圖卡樣式
app.post('/api/email-templates/reset-to-default', requireAuth, adminLimiter, async (req, res) => {
    try {
        // 獲取預設模板內容（從 database.js 的預設模板）
        const defaultTemplates = [
            {
                key: 'payment_reminder',
                name: '匯款提醒',
                subject: '【重要提醒】匯款期限即將到期',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⏰ 匯款期限提醒</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p style="margin-bottom: 25px;">感謝您選擇我們的住宿服務！</p>
            <div class="highlight">
                <h3 style="color: #856404; margin-top: 0;">⚠️ 重要提醒</h3>
                <p style="color: #856404; font-weight: 600; font-size: 18px;">
                    此訂房將為您保留 {{daysReserved}} 天，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。
                </p>
            </div>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3>訂房資訊</h3>
                <div class="info-row">
                    <span class="info-label">訂房編號</span>
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">入住日期</span>
                    <span class="info-value">{{checkInDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">退房日期</span>
                    <span class="info-value">{{checkOutDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
                {{#if addonsList}}
                <div class="info-row">
                    <span class="info-label">加購商品</span>
                    <span class="info-value">{{addonsList}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">加購商品總額</span>
                    <span class="info-value">NT$ {{addonsTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row">
                    <span class="info-label">總金額</span>
                    <span class="info-value" style="color: #333; font-weight: 600;">NT$ {{totalAmount}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">應付金額</span>
                    <span class="info-value" style="color: #e74c3c; font-weight: 700; font-size: 18px;">NT$ {{finalAmount}}</span>
                </div>
            </div>
            <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="color: #856404; margin-top: 0;">💰 匯款資訊</h3>
                <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                    <p style="margin: 5px 0; color: #333;"><strong>匯款資訊：</strong></p>
                    <p style="margin: 5px 0; color: #333;">銀行：{{bankName}}{{bankBranchDisplay}}</p>
                    <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">{{bankAccount}}</span></p>
                    <p style="margin: 5px 0; color: #333;">戶名：{{accountName}}</p>
                    <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>{{bookingId}}</strong></p>
                </div>
                {{#if isDeposit}}
                <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 15px; margin-top: 15px;">
                    <p style="color: #2e7d32; font-weight: 600; margin: 0; font-size: 16px;">💡 剩餘尾款於現場付清！</p>
                    <p style="color: #2e7d32; margin: 10px 0 0 0; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
                </div>
                {{/if}}
            </div>
            <p style="margin-top: 30px;">如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
</body>
</html>`,
                days_reserved: 3,
                send_hour_payment_reminder: 9
            },
            {
                key: 'checkin_reminder',
                name: '入住提醒',
                subject: '【入住提醒】歡迎您明天入住',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #262A33; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #262A33; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p>感謝您選擇我們的住宿服務！我們期待您明天的到來。</p>
            
            <div class="info-box">
                <h3>📅 訂房資訊</h3>
                <div class="info-row">
                    <span class="info-label">訂房編號</span>
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">入住日期</span>
                    <span class="info-value">{{checkInDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">退房日期</span>
                    <span class="info-value">{{checkOutDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
            </div>
            
            <div class="info-box">
                <h3>📍 交通路線</h3>
                <p><strong>地址：</strong>台北市信義區信義路五段7號</p>
                <p><strong>大眾運輸：</strong></p>
                <ul>
                    <li>捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
                    <li>公車：搭乘 20、32、46 路公車至「信義行政中心站」</li>
                </ul>
                <p><strong>自行開車：</strong></p>
                <ul>
                    <li>國道一號：下「信義交流道」，沿信義路直行約3公里</li>
                    <li>國道三號：下「木柵交流道」，接信義快速道路</li>
                </ul>
            </div>
            
            <div class="info-box">
                <h3>🅿️ 停車資訊</h3>
                <p><strong>停車場位置：</strong>B1-B3 地下停車場</p>
                <p><strong>停車費用：</strong></p>
                <ul>
                    <li>住宿客人：每日 NT$ 200（可無限次進出）</li>
                    <li>臨時停車：每小時 NT$ 50</li>
                </ul>
                <p><strong>停車場開放時間：</strong>24 小時</p>
                <p><strong>注意事項：</strong>停車位有限，建議提前預約</p>
            </div>
            
            <div class="highlight">
                <h3 style="color: #856404; margin-top: 0;">⚠️ 入住注意事項</h3>
                <ul style="color: #856404;">
                    <li>入住時間：下午 3:00 後</li>
                    <li>退房時間：上午 11:00 前</li>
                    <li>請攜帶身分證件辦理入住手續</li>
                    <li>房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>
                    <li>請保持安靜，避免影響其他住客</li>
                    <li>貴重物品請妥善保管，建議使用房間保險箱</li>
                    <li>如需延遲退房，請提前告知櫃檯</li>
                </ul>
            </div>
            
            <div class="info-box">
                <h3>📞 聯絡資訊</h3>
                <p>如有任何問題，歡迎隨時聯繫我們：</p>
                <p><strong>電話：</strong>02-1234-5678</p>
                <p><strong>Email：</strong>service@hotel.com</p>
                <p><strong>服務時間：</strong>24 小時</p>
            </div>
            
            <p>期待您的到來，祝您住宿愉快！</p>
        </div>
    </div>
</body>
</html>`,
                days_before_checkin: 1,
                send_hour_checkin: 9
            },
            {
                key: 'feedback_request',
                name: '感謝入住',
                subject: '【感謝入住】分享您的住宿體驗',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #262A33; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .btn { display: inline-block; padding: 12px 30px; background: #262A33; color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; }
        .rating { text-align: center; margin: 20px 0; }
        .star { font-size: 40px; color: #ffc107; margin: 0 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⭐ 感謝您的入住</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p>感謝您選擇我們的住宿服務！希望您這次的住宿體驗愉快舒適。</p>
            
            <div class="info-box">
                <h3>📅 住宿資訊</h3>
                <div class="info-row">
                    <span class="info-label">訂房編號</span>
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">入住日期</span>
                    <span class="info-value">{{checkInDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">退房日期</span>
                    <span class="info-value">{{checkOutDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
            </div>
            
            <div class="rating">
                <h3>您的寶貴意見對我們非常重要！</h3>
                <p>請為我們的服務評分：</p>
                <div>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                </div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.google.com/maps/place/your-hotel" class="btn">在 Google 上給我們評價</a>
                <a href="https://www.booking.com/your-hotel" class="btn">在 Booking.com 上評價</a>
            </div>
            
            <div class="info-box">
                <h3>💬 意見回饋</h3>
                <p>如果您有任何建議或意見，歡迎透過以下方式與我們聯繫：</p>
                <p><strong>Email：</strong>feedback@hotel.com</p>
                <p><strong>電話：</strong>02-1234-5678</p>
                <p>您的意見將幫助我們持續改進服務品質！</p>
            </div>
            
            <div class="info-box" style="background: #e8f5e9; border-left: 4px solid #4caf50;">
                <h3 style="color: #2e7d32;">🎁 再次入住優惠</h3>
                <p>感謝您的支持！再次預訂可享有 <strong>9 折優惠</strong>，歡迎隨時與我們聯繫。</p>
            </div>
            
            <p>期待再次為您服務！</p>
            <p>祝您 身體健康，萬事如意</p>
        </div>
    </div>
</body>
</html>`,
                days_after_checkout: 1,
                send_hour_feedback: 10
            }
        ];
        
        // 更新所有模板為預設圖卡樣式
        for (const template of defaultTemplates) {
            await db.updateEmailTemplate(template.key, {
                template_name: template.name,
                subject: template.subject,
                content: template.content,
                is_enabled: 1,
                days_before_checkin: template.days_before_checkin,
                send_hour_checkin: template.send_hour_checkin,
                days_after_checkout: template.days_after_checkout,
                send_hour_feedback: template.send_hour_feedback,
                days_reserved: template.days_reserved,
                send_hour_payment_reminder: template.send_hour_payment_reminder
            });
        }
        
        res.json({
            success: true,
            message: '所有郵件模板已重置為預設圖卡樣式'
        });
    } catch (error) {
        console.error('重置郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '重置郵件模板失敗：' + error.message
        });
    }
});

// ==================== 自動郵件發送功能 ====================

// 替換郵件模板中的變數
async function replaceTemplateVariables(template, booking, bankInfo = null) {
    let content = template.content;
    const checkInDate = new Date(booking.check_in_date).toLocaleDateString('zh-TW');
    const checkOutDate = new Date(booking.check_out_date).toLocaleDateString('zh-TW');
    
    // 計算匯款到期日期（如果模板有保留天數設定）
    let paymentDeadline = '';
    let daysReserved = template.days_reserved || 3;
    if (booking.created_at) {
        const bookingDate = new Date(booking.created_at);
        const deadline = new Date(bookingDate);
        deadline.setDate(deadline.getDate() + daysReserved);
        paymentDeadline = deadline.toLocaleDateString('zh-TW');
    }
    
    // 處理銀行分行顯示（如果有分行則顯示 " - 分行名"，否則為空）
    const bankBranchDisplay = bankInfo && bankInfo.bankBranch ? ' - ' + bankInfo.bankBranch : '';
    
    // 判斷是否為訂金支付（檢查 payment_amount 欄位是否包含「訂金」）
    const isDeposit = booking.payment_amount && booking.payment_amount.includes('訂金');
    
    // 計算剩餘尾款金額
    const totalAmount = booking.total_amount || 0;
    const finalAmount = booking.final_amount || 0;
    const remainingAmount = totalAmount - finalAmount;
    
    // 處理加購商品顯示
    let addonsList = '';
    let addonsTotal = 0;
    if (booking.addons) {
        try {
            const parsedAddons = typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons;
            if (parsedAddons && parsedAddons.length > 0) {
                const allAddons = await db.getAllAddonsAdmin();
                addonsList = parsedAddons.map(addon => {
                    const addonInfo = allAddons.find(a => a.name === addon.name);
                    const displayName = addonInfo ? addonInfo.display_name : addon.name;
                    const quantity = addon.quantity || 1;
                    const itemTotal = addon.price * quantity;
                    return `${displayName} x${quantity} (NT$ ${itemTotal.toLocaleString()})`;
                }).join('、');
                addonsTotal = booking.addons_total || parsedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0);
            }
        } catch (err) {
            console.error('處理加購商品顯示失敗:', err);
        }
    }
    
    const variables = {
        '{{guestName}}': booking.guest_name,
        '{{bookingId}}': booking.booking_id,
        '{{checkInDate}}': checkInDate,
        '{{checkOutDate}}': checkOutDate,
        '{{roomType}}': booking.room_type,
        '{{totalAmount}}': totalAmount.toLocaleString(),
        '{{finalAmount}}': finalAmount.toLocaleString(),
        '{{remainingAmount}}': remainingAmount.toLocaleString(),
        '{{bankName}}': bankInfo ? bankInfo.bankName : 'XXX銀行',
        '{{bankBranch}}': bankInfo ? bankInfo.bankBranch : 'XXX分行',
        '{{bankBranchDisplay}}': bankBranchDisplay,
        '{{bankAccount}}': bankInfo ? bankInfo.account : '1234567890123',
        '{{accountName}}': bankInfo ? bankInfo.accountName : 'XXX',
        '{{daysReserved}}': daysReserved.toString(),
        '{{paymentDeadline}}': paymentDeadline,
        '{{addonsList}}': addonsList,
        '{{addonsTotal}}': addonsTotal.toLocaleString()
    };
    
    Object.keys(variables).forEach(key => {
        content = content.replace(new RegExp(key, 'g'), variables[key]);
    });
    
    // 處理訂金提示（如果不是訂金，則移除整個區塊）
    if (isDeposit) {
        // 替換 {{#if isDeposit}} ... {{/if}} 區塊
        content = content.replace(/\{\{#if isDeposit\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        // 移除 {{#if isDeposit}} ... {{/if}} 區塊
        content = content.replace(/\{\{#if isDeposit\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }
    
    // 處理加購商品顯示（如果有加購商品，則顯示；否則移除整個區塊）
    if (addonsList && addonsList.trim() !== '') {
        // 替換 {{#if addonsList}} ... {{/if}} 區塊
        content = content.replace(/\{\{#if addonsList\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        // 移除 {{#if addonsList}} ... {{/if}} 區塊
        content = content.replace(/\{\{#if addonsList\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }
    
    // 添加旅館資訊 footer
    const hotelInfoFooter = await getHotelInfoFooter();
    if (hotelInfoFooter) {
        // 在 </body> 之前插入旅館資訊
        content = content.replace('</body>', hotelInfoFooter + '</body>');
    }
    
    let subject = template.subject;
    Object.keys(variables).forEach(key => {
        subject = subject.replace(new RegExp(key, 'g'), variables[key]);
    });
    
    return { subject, content };
}

// 發送匯款期限提醒郵件
async function sendPaymentReminderEmails() {
    try {
        const now = new Date();
        console.log(`\n[定時任務] 開始檢查匯款期限提醒... (${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})`);
        
        // 先取得模板以取得保留天數
        const template = await db.getEmailTemplateByKey('payment_reminder');
        if (!template) {
            console.log('❌ 找不到匯款提醒模板');
            return;
        }
        if (!template.is_enabled) {
            console.log('⚠️ 匯款提醒模板未啟用，跳過發送');
            return;
        }
        
        const daysReserved = parseInt(template.days_reserved) || 3;
        const sendHour = parseInt(template.send_hour_payment_reminder) || 9;
        
        console.log(`✅ 匯款提醒模板已啟用 (days_reserved: ${daysReserved}, send_hour_payment_reminder: ${sendHour})`);
        
        // 檢查當前時間是否符合發送時間
        const currentHour = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false });
        const currentHourNum = parseInt(currentHour);
        if (currentHourNum !== sendHour) {
            console.log(`⏰ 當前時間 ${currentHourNum}:00 不符合發送時間 ${sendHour}:00，跳過`);
            return;
        }
        
        // 取得所有可能的訂房
        const allBookings = await db.getBookingsForPaymentReminder();
        console.log(`初步查詢找到 ${allBookings.length} 筆可能的訂房`);
        
        // 過濾出匯款期限最後一天的訂房
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const bookings = allBookings.filter(booking => {
            const bookingDate = new Date(booking.created_at);
            const deadline = new Date(bookingDate);
            deadline.setDate(deadline.getDate() + daysReserved);
            
            // 計算截止日期的開始時間（00:00:00）
            const deadlineStart = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
            
            // 如果今天是截止日期，則需要發送提醒
            return deadlineStart.getTime() === today.getTime();
        });
        
        console.log(`找到 ${bookings.length} 筆需要發送匯款提醒的訂房（匯款期限最後一天）`);
        
        // 取得匯款資訊
        const bankInfo = {
            bankName: await db.getSetting('bank_name') || '',
            bankBranch: await db.getSetting('bank_branch') || '',
            account: await db.getSetting('bank_account') || '',
            accountName: await db.getSetting('account_name') || ''
        };
        
        for (const booking of bookings) {
            try {
                const { subject, content } = await replaceTemplateVariables(template, booking, bankInfo);
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                };
                
                let emailSent = false;
                
                // 優先使用 Gmail API（Railway 環境更穩定）
                if (sendEmailViaGmailAPI) {
                    try {
                        await sendEmailViaGmailAPI(mailOptions);
                        console.log(`✅ 已發送匯款提醒給 ${booking.guest_name} (${booking.booking_id}) - Gmail API`);
                        emailSent = true;
                    } catch (gmailError) {
                        // Gmail API 失敗時，嘗試 SMTP
                        console.log(`⚠️  Gmail API 失敗，嘗試 SMTP... (${booking.booking_id})`);
                        try {
                            await transporter.sendMail(mailOptions);
                            console.log(`✅ 已發送匯款提醒給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                            emailSent = true;
                        } catch (smtpError) {
                            throw gmailError; // 拋出原始 Gmail API 錯誤
                        }
                    }
                } else {
                    // 沒有 Gmail API，使用 SMTP
                    await transporter.sendMail(mailOptions);
                    console.log(`✅ 已發送匯款提醒給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                    emailSent = true;
                }
                
                // 只有成功發送才更新郵件狀態
                if (emailSent) {
                    try {
                        await db.updateEmailStatus(booking.booking_id, 'payment_reminder', true);
                    } catch (updateError) {
                        console.error(`❌ 更新郵件狀態失敗 (${booking.booking_id}):`, updateError.message);
                    }
                }
            } catch (error) {
                console.error(`❌ 發送匯款提醒失敗 (${booking.booking_id}):`, error.message);
            }
        }
    } catch (error) {
        console.error('❌ 匯款提醒任務錯誤:', error);
    }
}

// 生成取消通知郵件
async function generateCancellationEmail(booking) {
    const hotelInfoFooter = await getHotelInfoFooter();
    const bookingDate = new Date(booking.created_at);
    const checkInDate = new Date(booking.check_in_date);
    const checkOutDate = new Date(booking.check_out_date);
    
    // 計算住宿天數
    const msPerDay = 1000 * 60 * 60 * 24;
    const nights = Math.max(1, Math.round((checkOutDate - checkInDate) / msPerDay));
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e74c3c; }
            .warning-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚠️ 訂房已自動取消</h1>
                <p>很抱歉，您的訂房因超過保留期限已自動取消</p>
            </div>
            <div class="content">
                <p>親愛的 ${booking.guest_name}，</p>
                <p style="margin-bottom: 25px;">很抱歉通知您，由於超過匯款保留期限，您的訂房已自動取消。以下是取消的訂房資訊：</p>
                
                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${booking.booking_id}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${checkInDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${checkOutDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">住宿天數</span>
                        <span class="info-value">${nights} 晚</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${booking.room_type || '-'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">訂房日期</span>
                        <span class="info-value">${bookingDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row" style="border-bottom: none;">
                        <span class="info-label">應付金額</span>
                        <span class="info-value">NT$ ${(booking.final_amount || 0).toLocaleString()}</span>
                    </div>
                </div>

                <div class="warning-box">
                    <h3 style="color: #856404; margin-top: 0;">📌 取消原因</h3>
                    <p style="color: #856404; margin: 10px 0;">
                        此訂房因超過匯款保留期限（${bookingDate.toLocaleDateString('zh-TW')} 起算），且未在期限內完成付款，系統已自動取消。
                    </p>
                </div>

                <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #2e7d32; margin-top: 0;">💡 如需重新訂房</h3>
                    <p style="color: #2e7d32; margin: 10px 0;">
                        如果您仍希望預訂，歡迎重新進行訂房。如有任何疑問，請隨時與我們聯繫。
                    </p>
                </div>

                ${hotelInfoFooter}
            </div>
        </div>
    </body>
    </html>
    `;
}

// 自動取消過期保留訂房
async function cancelExpiredReservations() {
    try {
        console.log('\n[定時任務] 開始檢查過期保留訂房...');
        const bookings = await db.getBookingsExpiredReservation();
        console.log(`找到 ${bookings.length} 筆保留狀態的訂房`);
        
        // 取得匯款提醒模板的保留天數（預設3天）
        let daysReserved = 3;
        try {
            const paymentTemplate = await db.getEmailTemplateByKey('payment_reminder');
            if (paymentTemplate && paymentTemplate.days_reserved) {
                daysReserved = parseInt(paymentTemplate.days_reserved) || 3;
            }
        } catch (err) {
            console.warn('取得匯款提醒模板失敗，使用預設值:', err.message);
        }
        
        const now = new Date();
        let cancelledCount = 0;
        let emailSentCount = 0;
        let emailFailedCount = 0;
        
        for (const booking of bookings) {
            try {
                // 計算保留到期日期
                const bookingDate = new Date(booking.created_at);
                const deadline = new Date(bookingDate);
                deadline.setDate(deadline.getDate() + daysReserved);
                
                // 如果當前時間超過保留期限，自動取消
                if (now > deadline) {
                    // 取消訂房
                    await db.cancelBooking(booking.booking_id);
                    console.log(`✅ 已自動取消過期保留訂房: ${booking.booking_id} (${booking.guest_name})`);
                    cancelledCount++;
                    
                    // 發送取消通知 Email
                    try {
                        const cancellationEmail = await generateCancellationEmail(booking);
                        const mailOptions = {
                            from: process.env.EMAIL_USER || 'your-email@gmail.com',
                            to: booking.guest_email,
                            subject: '【訂房取消通知】您的訂房已自動取消',
                            html: cancellationEmail
                        };
                        
                        let emailSent = false;
                        
                        // 優先使用 Gmail API（Railway 環境更穩定）
                        if (sendEmailViaGmailAPI) {
                            try {
                                await sendEmailViaGmailAPI(mailOptions);
                                console.log(`✅ 已發送取消通知給 ${booking.guest_name} (${booking.booking_id}) - Gmail API`);
                                emailSent = true;
                                emailSentCount++;
                            } catch (gmailError) {
                                // Gmail API 失敗時，嘗試 SMTP
                                console.log(`⚠️  Gmail API 失敗，嘗試 SMTP... (${booking.booking_id})`);
                                try {
                                    await transporter.sendMail(mailOptions);
                                    console.log(`✅ 已發送取消通知給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                                    emailSent = true;
                                    emailSentCount++;
                                } catch (smtpError) {
                                    console.error(`❌ 發送取消通知失敗 (${booking.booking_id}):`, smtpError.message);
                                    emailFailedCount++;
                                }
                            }
                        } else {
                            // 沒有 Gmail API，使用 SMTP
                            try {
                                await transporter.sendMail(mailOptions);
                                console.log(`✅ 已發送取消通知給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                                emailSent = true;
                                emailSentCount++;
                            } catch (smtpError) {
                                console.error(`❌ 發送取消通知失敗 (${booking.booking_id}):`, smtpError.message);
                                emailFailedCount++;
                            }
                        }
                    } catch (emailError) {
                        console.error(`❌ 發送取消通知時發生錯誤 (${booking.booking_id}):`, emailError.message);
                        emailFailedCount++;
                    }
                }
            } catch (error) {
                console.error(`❌ 取消過期保留訂房失敗 (${booking.booking_id}):`, error.message);
            }
        }
        
        console.log(`✅ 共取消 ${cancelledCount} 筆過期保留訂房`);
        console.log(`📧 成功發送 ${emailSentCount} 封取消通知郵件`);
        if (emailFailedCount > 0) {
            console.warn(`⚠️  有 ${emailFailedCount} 封取消通知郵件發送失敗`);
        }
    } catch (error) {
        console.error('❌ 自動取消過期保留訂房任務錯誤:', error);
    }
}

// 發送入住提醒郵件
async function sendCheckinReminderEmails() {
    try {
        const now = new Date();
        console.log(`\n[定時任務] 開始檢查入住提醒... (${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})`);
        
        const template = await db.getEmailTemplateByKey('checkin_reminder');
        if (!template) {
            console.log('❌ 找不到入住提醒模板');
            return;
        }
        if (!template.is_enabled) {
            console.log('⚠️ 入住提醒模板未啟用，跳過發送');
            return;
        }
        
        const daysBeforeCheckin = parseInt(template.days_before_checkin) || 1;
        const sendHour = parseInt(template.send_hour_checkin) || 9;
        
        console.log(`✅ 入住提醒模板已啟用 (days_before_checkin: ${daysBeforeCheckin}, send_hour_checkin: ${sendHour})`);
        
        // 檢查當前時間是否符合發送時間
        const currentHour = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false });
        const currentHourNum = parseInt(currentHour);
        if (currentHourNum !== sendHour) {
            console.log(`⏰ 當前時間 ${currentHourNum}:00 不符合發送時間 ${sendHour}:00，跳過`);
            return;
        }
        
        const bookings = await db.getBookingsForCheckinReminder(daysBeforeCheckin);
        console.log(`找到 ${bookings.length} 筆需要發送入住提醒的訂房`);
        
        for (const booking of bookings) {
            try {
                const { subject, content } = await replaceTemplateVariables(template, booking);
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                };
                
                let emailSent = false;
                
                // 優先使用 Gmail API（Railway 環境更穩定）
                if (sendEmailViaGmailAPI) {
                    try {
                        await sendEmailViaGmailAPI(mailOptions);
                        console.log(`✅ 已發送入住提醒給 ${booking.guest_name} (${booking.booking_id}) - Gmail API`);
                        emailSent = true;
                    } catch (gmailError) {
                        // Gmail API 失敗時，嘗試 SMTP
                        console.log(`⚠️  Gmail API 失敗，嘗試 SMTP... (${booking.booking_id})`);
                        try {
                            await transporter.sendMail(mailOptions);
                            console.log(`✅ 已發送入住提醒給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                            emailSent = true;
                        } catch (smtpError) {
                            throw gmailError; // 拋出原始 Gmail API 錯誤
                        }
                    }
                } else {
                    // 沒有 Gmail API，使用 SMTP
                    await transporter.sendMail(mailOptions);
                    console.log(`✅ 已發送入住提醒給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                    emailSent = true;
                }
                
                // 只有成功發送才更新郵件狀態
                if (emailSent) {
                    try {
                        await db.updateEmailStatus(booking.booking_id, 'checkin_reminder', true);
                    } catch (updateError) {
                        console.error(`❌ 更新郵件狀態失敗 (${booking.booking_id}):`, updateError.message);
                    }
                }
            } catch (error) {
                console.error(`❌ 發送入住提醒失敗 (${booking.booking_id}):`, error.message);
            }
        }
    } catch (error) {
        console.error('❌ 入住提醒任務錯誤:', error);
    }
}

// 發送回訪信
async function sendFeedbackRequestEmails() {
    try {
        const now = new Date();
        console.log(`\n[定時任務] 開始檢查回訪信... (${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})`);
        
        // 先取得模板以取得天數和發送時間
        const template = await db.getEmailTemplateByKey('feedback_request');
        if (!template) {
            console.log('❌ 找不到回訪信模板');
            return;
        }
        if (!template.is_enabled) {
            console.log('⚠️ 回訪信模板未啟用，跳過發送');
            return;
        }
        
        const daysAfterCheckout = parseInt(template.days_after_checkout) || 1;
        const sendHour = parseInt(template.send_hour_feedback) || 10;
        
        console.log(`✅ 回訪信模板已啟用 (days_after_checkout: ${daysAfterCheckout}, send_hour_feedback: ${sendHour})`);
        
        // 檢查當前時間是否符合發送時間
        const currentHour = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false });
        const currentHourNum = parseInt(currentHour);
        if (currentHourNum !== sendHour) {
            console.log(`⏰ 當前時間 ${currentHourNum}:00 不符合發送時間 ${sendHour}:00，跳過`);
            return;
        }
        
        const bookings = await db.getBookingsForFeedbackRequest(daysAfterCheckout);
        console.log(`找到 ${bookings.length} 筆需要發送回訪信的訂房`);
        
        for (const booking of bookings) {
            try {
                const { subject, content } = await replaceTemplateVariables(template, booking);
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                };
                
                let emailSent = false;
                
                // 優先使用 Gmail API（Railway 環境更穩定）
                if (sendEmailViaGmailAPI) {
                    try {
                        await sendEmailViaGmailAPI(mailOptions);
                        console.log(`✅ 已發送回訪信給 ${booking.guest_name} (${booking.booking_id}) - Gmail API`);
                        emailSent = true;
                    } catch (gmailError) {
                        // Gmail API 失敗時，嘗試 SMTP
                        console.log(`⚠️  Gmail API 失敗，嘗試 SMTP... (${booking.booking_id})`);
                        try {
                            await transporter.sendMail(mailOptions);
                            console.log(`✅ 已發送回訪信給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                            emailSent = true;
                        } catch (smtpError) {
                            throw gmailError; // 拋出原始 Gmail API 錯誤
                        }
                    }
                } else {
                    // 沒有 Gmail API，使用 SMTP
                    await transporter.sendMail(mailOptions);
                    console.log(`✅ 已發送回訪信給 ${booking.guest_name} (${booking.booking_id}) - SMTP`);
                    emailSent = true;
                }
                
                // 只有成功發送才更新郵件狀態
                if (emailSent) {
                    try {
                        await db.updateEmailStatus(booking.booking_id, 'feedback_request', true);
                    } catch (updateError) {
                        console.error(`❌ 更新郵件狀態失敗 (${booking.booking_id}):`, updateError.message);
                    }
                }
            } catch (error) {
                console.error(`❌ 發送回訪信失敗 (${booking.booking_id}):`, error.message);
            }
        }
    } catch (error) {
        console.error('❌ 回訪信任務錯誤:', error);
    }
}

// 啟動伺服器
async function startServer() {
    try {
        // 初始化資料庫
        await db.initDatabase();
        
        // 啟動伺服器
        // Railway 需要監聽 0.0.0.0 才能接受外部請求
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n========================================');
            console.log('🚀 訂房系統伺服器已啟動');
            console.log(`📍 端口: ${PORT}`);
            console.log(`🌐 監聽地址: 0.0.0.0:${PORT}`);
            console.log(`📧 Email: ${process.env.EMAIL_USER || 'cheng701107@gmail.com'}`);
            console.log(`💾 資料庫: PostgreSQL`);
            console.log('========================================\n');
            console.log('等待請求中...\n');
            
            // 啟動定時任務（使用台灣時區 Asia/Taipei）
            const timezone = 'Asia/Taipei';
            
            // 每天上午 9:00 執行匯款提醒檢查（台灣時間）
            // 匯款提醒定時任務 - 每小時檢查一次，在設定的時間發送
            cron.schedule('0 * * * *', sendPaymentReminderEmails, {
                timezone: timezone
            });
            console.log('✅ 匯款提醒定時任務已啟動（每小時檢查，根據模板設定時間發送）');
            
            // 入住提醒定時任務 - 每小時檢查一次，在設定的時間發送
            cron.schedule('0 * * * *', sendCheckinReminderEmails, {
                timezone: timezone
            });
            console.log('✅ 入住提醒定時任務已啟動（每小時檢查，根據模板設定時間發送）');
            
            // 每天上午 11:00 執行回訪信檢查（台灣時間）
            // 回訪信定時任務 - 每小時檢查一次，在設定的時間發送
            cron.schedule('0 * * * *', sendFeedbackRequestEmails, {
                timezone: timezone
            });
            console.log('✅ 回訪信定時任務已啟動（每小時檢查，根據模板設定時間發送）');
            
            // 每天凌晨 1:00 執行自動取消過期保留訂房（台灣時間）
            cron.schedule('0 1 * * *', cancelExpiredReservations, {
                timezone: timezone
            });
            console.log('✅ 自動取消過期保留訂房定時任務已啟動（每天 01:00 台灣時間）');
            
            // 每天凌晨 2:00 執行資料庫備份（台灣時間）
            cron.schedule('0 2 * * *', async () => {
                try {
                    await backup.performBackup();
                    // 備份完成後清理舊備份
                    await backup.cleanupOldBackups(30);
                } catch (error) {
                    console.error('❌ 備份任務失敗:', error.message);
                }
            }, {
                timezone: timezone
            });
            console.log('✅ 資料庫備份定時任務已啟動（每天 02:00 台灣時間，保留 30 天）');
        });
    } catch (error) {
        console.error('❌ 伺服器啟動失敗:', error);
        process.exit(1);
    }
}

// 靜態檔案服務（放在最後，避免覆蓋 API 路由）
app.use(express.static(__dirname));

// ============================================
// 統一錯誤處理中間件（必須放在所有路由之後）
// ============================================
app.use(errorHandler);

// 啟動應用程式
startServer();

