// 載入環境變數（從 .env 檔案）
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const db = require('./database');
const payment = require('./payment');
const cron = require('node-cron');
const backup = require('./backup');
const csrf = require('csrf');

// 預先載入 Resend（如果可用）
let Resend = null;
try {
    const resendModule = require('resend');
    // Resend v6.x 的導出方式
    Resend = resendModule.Resend || (resendModule.default && resendModule.default.Resend) || resendModule.default;
    if (Resend) {
        console.log('✅ Resend 套件已載入');
    } else {
        console.warn('⚠️  Resend 類別未找到，請檢查套件版本');
    }
} catch (error) {
    console.warn('⚠️  Resend 套件未安裝或載入失敗:', error.message);
    console.warn('   系統將使用 Gmail 作為郵件服務');
    console.warn('   如需使用 Resend，請執行: npm install resend@6.7.0');
}
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

// 配置 Session Store
// 在生產環境使用 PostgreSQL，開發環境可以使用 MemoryStore
const usePostgreSQL = !!process.env.DATABASE_URL;
let sessionStore = null;

if (usePostgreSQL) {
    // 使用 PostgreSQL 作為 Session Store（適合生產環境）
    try {
        const { Pool } = require('pg');
        const pgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
        });
        
        sessionStore = new pgSession({
            pool: pgPool,
            tableName: 'session', // Session 表名稱
            createTableIfMissing: true // 自動創建表（如果不存在）
        });
        
        console.log('✅ 使用 PostgreSQL Session Store（適合生產環境）');
    } catch (error) {
        console.error('❌ 無法建立 PostgreSQL Session Store，回退到 MemoryStore:', error.message);
        console.warn('⚠️  警告：MemoryStore 不適合生產環境，可能導致記憶體洩漏');
        sessionStore = undefined; // 使用預設的 MemoryStore
    }
} else {
    // 開發環境可以使用 MemoryStore
    console.log('ℹ️  使用 MemoryStore（僅適合開發環境）');
    sessionStore = undefined; // 使用預設的 MemoryStore
}

app.use(session({
    store: sessionStore, // 使用 PostgreSQL Store 或 MemoryStore
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
            // 檢查 URL 路徑是否為 weekday_settings 的更新請求
            const isWeekdaySettingsRequest = req.path && 
                req.path.includes('/api/admin/settings/weekday_settings');
            
            // 對郵件模板的 content 欄位進行特殊處理（HTML 內容，跳過 SQL Injection 檢測）
            // 包括保存模板（PUT）和發送測試郵件（POST /test）
            const isEmailTemplateRequest = req.path && 
                (req.path.includes('/api/email-templates/') && 
                 (req.method === 'PUT' || (req.method === 'POST' && req.path.includes('/test'))));
            
            if (isEmailTemplateRequest && req.body.content) {
                // 郵件模板的 content 欄位是 HTML 內容，跳過 SQL Injection 檢測
                // 但仍需要清理其他欄位
                // 注意：content 欄位是 HTML，不應該進行 XSS 檢測（因為它本身就是 HTML）
                const { content, ...rest } = req.body;
                req.body = {
                    ...sanitizeObject(rest, {
                        checkSQLInjection: true,
                        checkXSS: true
                    }),
                    content: content // 保留原始 HTML 內容，不進行任何檢測或清理
                };
                // 繼續處理 query 和 params
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
                return;
            }
            
            if (req.body.value && isWeekdaySettingsRequest) {
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
                    console.warn('weekday_settings JSON 解析失敗:', e);
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
// 優先使用資料庫設定，其次使用環境變數

let transporter;
let getAccessToken = null; // 將函數聲明在外部作用域
let sendEmailViaGmailAPI = null; // Gmail API 備用方案
let oauth2Client = null; // OAuth2 客戶端
let gmail = null; // Gmail API 客戶端
let resendClient = null; // Resend 客戶端
let emailServiceProvider = 'gmail'; // 郵件服務提供商：'resend' 或 'gmail'

// 初始化郵件服務（優先使用資料庫設定）
async function initEmailService() {
    try {
        // 優先使用資料庫設定，其次使用環境變數
        const resendApiKey = await db.getSetting('resend_api_key') || process.env.RESEND_API_KEY;
        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
        const emailPass = process.env.EMAIL_PASS || 'vtik qvij ravh lirg';
        const gmailClientID = await db.getSetting('gmail_client_id') || process.env.GMAIL_CLIENT_ID;
        const gmailClientSecret = await db.getSetting('gmail_client_secret') || process.env.GMAIL_CLIENT_SECRET;
        const gmailRefreshToken = await db.getSetting('gmail_refresh_token') || process.env.GMAIL_REFRESH_TOKEN;
        
        // 優先使用 Resend（如果已設定）
        if (resendApiKey) {
            try {
                // 檢查 Resend 套件是否可用
                if (!Resend) {
                    throw new Error('Resend 套件未安裝，請執行: npm install resend');
                }
                
                resendClient = new Resend(resendApiKey);
                emailServiceProvider = 'resend';
                console.log('📧 郵件服務已設定（Resend）');
                console.log('   服務提供商: Resend');
                console.log('   設定來源:', await db.getSetting('resend_api_key') ? '資料庫' : '環境變數');
                return; // Resend 設定完成，不需要初始化 Gmail
            } catch (error) {
                console.error('❌ 初始化 Resend 失敗:', error.message);
                console.error('   錯誤詳情:', error);
                console.error('   將回退到 Gmail 服務');
                // 確保變數被重置，避免後續錯誤
                resendClient = null;
                emailServiceProvider = 'gmail';
            }
        }
        
        // 如果沒有 Resend，使用 Gmail
        emailServiceProvider = 'gmail';
        
        // 檢查是否使用 OAuth2
        const useOAuth2 = gmailClientID && gmailClientSecret && gmailRefreshToken;
        
        if (useOAuth2) {
            // 使用 OAuth2 認證（推薦，解決 Railway 連接超時問題）
            const { google } = require('googleapis');
            
            oauth2Client = new google.auth.OAuth2(
                gmailClientID,
                gmailClientSecret,
                'https://developers.google.com/oauthplayground' // 重新導向 URI（OAuth2 Playground）
            );
            
            oauth2Client.setCredentials({
                refresh_token: gmailRefreshToken
            });
            
            // 設定 Gmail API 所需的 scopes
            oauth2Client.scopes = ['https://www.googleapis.com/auth/gmail.send'];
            
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
                    console.error('   錯誤代碼:', error.code);
                    console.error('   錯誤詳情:', error);
                    
                    // 如果是 invalid_grant 錯誤，提供更詳細的說明
                    if (error.message && (error.message.includes('invalid_grant') || error.message.includes('Invalid grant'))) {
                        console.error('⚠️  OAuth2 Refresh Token 無效或已過期！');
                        console.error('   這通常是因為：');
                        console.error('   1. GMAIL_REFRESH_TOKEN 已過期（通常有效期為 6 個月）');
                        console.error('   2. Refresh Token 已被撤銷');
                        console.error('   3. 用戶在 Google 帳號中撤銷了應用程式存取權限');
                        console.error('   解決方法：');
                        console.error('   1. 在 Google Cloud Console 重新生成 Refresh Token');
                        console.error('   2. 更新資料庫或環境變數中的 GMAIL_REFRESH_TOKEN');
                        console.error('   3. 確認 GMAIL_CLIENT_ID 和 GMAIL_CLIENT_SECRET 是否正確');
                    } else if (error.message && (error.message.includes('unauthorized_client') || error.message.includes('Unauthorized client'))) {
                        console.error('⚠️  OAuth2 Client 認證失敗！');
                        console.error('   這通常是因為：');
                        console.error('   1. GMAIL_CLIENT_ID 或 GMAIL_CLIENT_SECRET 不正確');
                        console.error('   2. Refresh Token 是從不同的 Client ID/Secret 生成的');
                        console.error('   3. OAuth2 應用程式設定有問題');
                        console.error('   解決方法：');
                        console.error('   1. 檢查 Google Cloud Console → API 和服務 → 憑證');
                        console.error('   2. 確認 Client ID 和 Client Secret 是否正確');
                        console.error('   3. 確認 Refresh Token 是從相同的 Client ID/Secret 生成的');
                        console.error('   4. 確認 OAuth 同意畫面已正確設定');
                        console.error('   5. 確認 Gmail API 已啟用');
                    }
                    
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
                    clientId: gmailClientID,
                    clientSecret: gmailClientSecret,
                    refreshToken: gmailRefreshToken,
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
            console.log('   設定來源:', await db.getSetting('email_user') ? '資料庫' : '環境變數');
            
            // Gmail API 備用方案（當 SMTP 連接失敗時使用）
            gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
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
                    console.log('   發送給:', mailOptions.to);
                    console.log('   發件人:', mailOptions.from);
                    return { messageId: response.data.id, accepted: [mailOptions.to] };
                } catch (error) {
                    console.error('❌ Gmail API 發送失敗:');
                    console.error('   發送給:', mailOptions.to);
                    console.error('   發件人:', mailOptions.from);
                    console.error('   錯誤訊息:', error.message);
                    console.error('   錯誤代碼:', error.code);
                    console.error('   錯誤詳情:', error);
                    if (error.response) {
                        console.error('   API 回應:', error.response.data);
                        console.error('   狀態碼:', error.response.status);
                        if (error.response.data && error.response.data.error) {
                            console.error('   錯誤類型:', error.response.data.error.error);
                            console.error('   錯誤描述:', error.response.data.error.error_description);
                        }
                    }
                    
                    // 如果是 unauthorized_client 錯誤，提供更詳細的說明
                    if (error.message && (error.message.includes('unauthorized_client') || error.message.includes('Unauthorized client'))) {
                        console.error('⚠️  OAuth2 Client 認證失敗！');
                        console.error('   可能原因：');
                        console.error('   1. GMAIL_CLIENT_ID 或 GMAIL_CLIENT_SECRET 不正確');
                        console.error('   2. Refresh Token 是從不同的 Client ID/Secret 生成的');
                        console.error('   3. OAuth2 應用程式設定有問題');
                        console.error('   4. Gmail API 未啟用');
                        console.error('   解決方法：');
                        console.error('   1. 檢查 Google Cloud Console → API 和服務 → 憑證');
                        console.error('   2. 確認 Client ID 和 Client Secret 是否正確');
                        console.error('   3. 確認 Refresh Token 是從相同的 Client ID/Secret 生成的');
                        console.error('   4. 確認 OAuth 同意畫面已正確設定');
                        console.error('   5. 確認 Gmail API 已啟用');
                    }
                    
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
            console.log('   設定來源:', await db.getSetting('email_user') ? '資料庫' : '環境變數');
            console.log('   ⚠️  建議使用 OAuth2 認證以解決連接超時問題');
        }
    } catch (error) {
        console.error('❌ 初始化郵件服務失敗:', error);
        // 使用預設設定
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER || 'cheng701107@gmail.com',
                pass: process.env.EMAIL_PASS || 'vtik qvij ravh lirg'
            }
        });
        console.log('⚠️  使用預設郵件設定');
    }
}

// 統一的郵件發送函數（自動選擇 Resend 或 Gmail）
async function sendEmail(mailOptions) {
    try {
        // 優先使用 Resend（確保 resendClient 存在且有效）
        if (emailServiceProvider === 'resend' && resendClient && Resend) {
            try {
                console.log('📧 使用 Resend 發送郵件...');
                
                // 從 mailOptions.from 提取發件人信箱（Resend 需要驗證過的網域或信箱）
                const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
                const fromEmail = mailOptions.from || emailUser;
                
                const result = await resendClient.emails.send({
                    from: fromEmail,
                    to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
                    subject: mailOptions.subject,
                    html: mailOptions.html,
                    text: mailOptions.text || mailOptions.html.replace(/<[^>]*>/g, ''), // 自動從 HTML 提取純文字
                });
                
                console.log('✅ Resend 郵件已發送');
                console.log('   發送給:', mailOptions.to);
                console.log('   發件人:', fromEmail);
                console.log('   郵件 ID:', result.data?.id);
                
                return { 
                    messageId: result.data?.id || 'resend-' + Date.now(), 
                    accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to] 
                };
            } catch (resendError) {
                console.error('❌ Resend 發送失敗:', resendError.message);
                console.error('   錯誤詳情:', resendError);
                // Resend 失敗時，如果有 Gmail 備用方案，嘗試使用 Gmail
                if (transporter || sendEmailViaGmailAPI) {
                    console.log('⚠️  Resend 失敗，切換到 Gmail 備用方案...');
                    return await sendEmailViaGmail(mailOptions);
                }
                throw resendError;
            }
        }
        
        // 如果 Resend 不可用，使用 Gmail（原有邏輯）
        if (!resendClient && emailServiceProvider === 'resend') {
            console.warn('⚠️  Resend 客戶端未初始化，切換到 Gmail');
            emailServiceProvider = 'gmail';
        }
        
        return await sendEmailViaGmail(mailOptions);
    } catch (error) {
        console.error('❌ 郵件發送失敗:', error);
        throw error;
    }
}

// Gmail 郵件發送函數（保留原有邏輯）
async function sendEmailViaGmail(mailOptions) {
    // 優先使用 Gmail API（Railway 環境更穩定）
    if (sendEmailViaGmailAPI) {
        try {
            return await sendEmailViaGmailAPI(mailOptions);
        } catch (gmailError) {
            // Gmail API 失敗時，嘗試 SMTP
            console.log('⚠️  Gmail API 失敗，嘗試 SMTP...');
            try {
                return await transporter.sendMail(mailOptions);
            } catch (smtpError) {
                throw gmailError; // 拋出原始 Gmail API 錯誤
            }
        }
    } else {
        // 沒有 Gmail API，使用 SMTP
        return await transporter.sendMail(mailOptions);
    }
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
        // 優先使用資料庫設定，其次使用環境變數，最後使用預設值
        const adminEmail = await db.getSetting('admin_email') || process.env.ADMIN_EMAIL || 'cheng701107@gmail.com';
        // 確保 emailUser 與 OAuth2 認證帳號一致（Gmail API 要求）
        let emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
        
        // 驗證 emailUser 是否與 OAuth2 認證帳號一致
        if (sendEmailViaGmailAPI && transporter && transporter.options && transporter.options.auth) {
            const oauthUser = transporter.options.auth.user;
            if (oauthUser && emailUser !== oauthUser) {
                console.warn('⚠️  警告：email_user 與 OAuth2 認證帳號不一致！');
                console.warn(`   email_user: ${emailUser}`);
                console.warn(`   OAuth2 認證帳號: ${oauthUser}`);
                console.warn('   使用 OAuth2 認證帳號作為發件人（Gmail API 要求）');
                // 使用 OAuth2 認證的帳號作為發件人（Gmail API 要求）
                emailUser = oauthUser;
            }
        }
        
        const adminMailOptions = {
            from: emailUser,
            to: adminEmail, // 管理員 Email
            subject: `【新訂房通知】${guestName} - ${bookingData.bookingId}`,
            html: generateAdminEmail(bookingData)
        };

        // 發送郵件
        let emailSent = false;
        let emailErrorMsg = '';
        
        // 只有匯款轉帳才在建立訂房時發送確認郵件給客戶
        // 線上刷卡要等付款完成後才發送確認郵件
        if (paymentMethod === 'transfer') {
            // 發送確認郵件給客戶（匯款轉帳）- 使用數據庫模板
            let customerMailOptions = null;
            try {
                const { subject, content } = await generateEmailFromTemplate('booking_confirmation', bookingData, bankInfo);
                customerMailOptions = {
                    from: emailUser,
                    to: guestEmail,
                    subject: subject,
                    html: content
                };
            } catch (customerTemplateError) {
                console.error('⚠️ 無法從數據庫讀取訂房確認模板，使用備用方案:', customerTemplateError.message);
                // 備用方案：使用原來的函數
                customerMailOptions = {
                    from: emailUser,
                    to: guestEmail,
                    subject: '【訂房確認】您的訂房已成功',
                    html: await generateCustomerEmail(bookingData)
                };
            }
            
            try {
                console.log('📧 正在發送郵件（匯款轉帳）...');
                console.log('   發送給客戶:', guestEmail);
                console.log('   使用帳號:', emailUser);
                console.log('   認證方式:', sendEmailViaGmailAPI ? 'OAuth2 (Gmail API)' : 'SMTP');
            
            // 如果是 OAuth2，先測試取得 Access Token
            if (sendEmailViaGmailAPI && getAccessToken) {
                try {
                    console.log('🔍 測試 OAuth2 Access Token...');
                    console.log('   使用 Client ID:', gmailClientID ? gmailClientID.substring(0, 20) + '...' : '未設定');
                    console.log('   使用 Client Secret:', gmailClientSecret ? gmailClientSecret.substring(0, 10) + '...' : '未設定');
                    console.log('   使用 Refresh Token:', gmailRefreshToken ? gmailRefreshToken.substring(0, 20) + '...' : '未設定');
                    const testToken = await getAccessToken();
                    if (testToken) {
                        console.log('✅ OAuth2 Access Token 測試成功');
                    }
                } catch (tokenError) {
                    console.error('❌ OAuth2 Access Token 測試失敗:', tokenError.message);
                    console.error('   錯誤代碼:', tokenError.code);
                    console.error('   詳細錯誤:', tokenError);
                    
                    // 如果是 unauthorized_client 錯誤，提供詳細的解決建議
                    if (tokenError.message && (tokenError.message.includes('unauthorized_client') || tokenError.message.includes('Unauthorized client'))) {
                        console.error('⚠️  OAuth2 Client 認證失敗！');
                        console.error('   可能原因：');
                        console.error('   1. GMAIL_CLIENT_ID 或 GMAIL_CLIENT_SECRET 不正確');
                        console.error('   2. Refresh Token 是從不同的 Client ID/Secret 生成的');
                        console.error('   3. OAuth2 應用程式設定有問題');
                        console.error('   4. Gmail API 未啟用');
                        console.error('   5. 已授權的重新導向 URI 未包含：https://developers.google.com/oauthplayground');
                        console.error('   解決方法：');
                        console.error('   1. 檢查 Google Cloud Console → API 和服務 → 憑證');
                        console.error('   2. 確認 Client ID 和 Client Secret 是否正確');
                        console.error('   3. 確認 Refresh Token 是從相同的 Client ID/Secret 生成的');
                        console.error('   4. 確認 OAuth 同意畫面已正確設定');
                        console.error('   5. 確認 Gmail API 已啟用');
                        console.error('   6. 確認已授權的重新導向 URI 包含：https://developers.google.com/oauthplayground');
                        console.error('   7. 如果問題持續，請重新生成 Refresh Token');
                    } else if (tokenError.message && (tokenError.message.includes('invalid_grant') || tokenError.message.includes('Invalid grant'))) {
                        console.error('⚠️  OAuth2 Refresh Token 無效或已過期！');
                        console.error('   解決方法：');
                        console.error('   1. 在 OAuth2 Playground 重新生成 Refresh Token');
                        console.error('   2. 更新資料庫或環境變數中的 GMAIL_REFRESH_TOKEN');
                    }
                    
                    console.error('⚠️  服務將繼續啟動，但 Gmail API 可能無法使用');
                    console.error('   如果使用 SMTP，請確保 EMAIL_PASS（應用程式密碼）已正確設定');
                    // 不拋出錯誤，讓服務繼續啟動（可能使用 SMTP 備用方案）
                }
            }
            
            // 發送客戶確認郵件（使用統一函數，自動選擇 Resend 或 Gmail）
            console.log('📤 發送客戶確認郵件...');
            const customerResult = await sendEmail(customerMailOptions);
            console.log('✅ 客戶確認郵件已發送');
            if (customerResult && customerResult.messageId) {
                console.log('   郵件 ID:', customerResult.messageId);
            }
            
            emailSent = true;
        } catch (emailError) {
            emailErrorMsg = emailError.message || '未知錯誤';
            console.error('❌ 客戶郵件發送失敗:');
            console.error('   發送給:', guestEmail);
            console.error('   使用帳號:', emailUser);
            console.error('   錯誤訊息:', emailErrorMsg);
            console.error('   錯誤代碼:', emailError.code);
            console.error('   錯誤命令:', emailError.command);
            console.error('   完整錯誤:', emailError);
            console.error('   錯誤堆疊:', emailError.stack);
            
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
            const adminResult = await sendEmail(adminMailOptions);
            console.log('✅ 管理員通知郵件已發送');
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
                    // 正式環境：優先使用資料庫設定，其次使用環境變數
                    ecpayMerchantID = await db.getSetting('ecpay_merchant_id') || process.env.ECPAY_MERCHANT_ID_PROD || '2000132';
                    ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY_PROD || '';
                    ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV_PROD || '';
                    
                    console.log('💰 使用正式環境設定');
                    if (!ecpayMerchantID || ecpayMerchantID === '2000132') {
                        console.warn('⚠️  警告：正式環境仍在使用測試環境的 MerchantID！');
                        console.warn('   請在系統設定中設定綠界支付參數，或設定 ECPAY_MERCHANT_ID_PROD 環境變數');
                    }
                } else {
                    // 測試環境：優先使用資料庫設定，其次使用環境變數
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
                    throw new Error(`綠界支付設定不完整，請設定：${missingParams.join(', ')}。請在系統設定的「綠界支付設定」中設定，或使用環境變數 ${isProduction ? 'ECPAY_MERCHANT_ID_PROD、ECPAY_HASH_KEY_PROD、ECPAY_HASH_IV_PROD' : 'ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV'}`);
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

// 生成收款確認郵件（匯款轉帳收到款項時）
async function generatePaymentReceivedEmail(booking) {
    const hotelInfoFooter = await getHotelInfoFooter();
    const checkInDate = new Date(booking.check_in_date);
    const checkOutDate = new Date(booking.check_out_date);
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #198754; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #e8f5e9; border: 2px solid #198754; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✅ 已收到您的匯款</h1>
                <p>感謝您的付款！</p>
            </div>
            <div class="content">
                <p>親愛的 ${booking.guest_name}，</p>
                <p style="margin-bottom: 20px;">我們已確認收到您本次訂房的匯款，以下是您的訂房與付款資訊：</p>
                
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
                        <span class="info-label">房型</span>
                        <span class="info-value">${booking.room_type}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">總金額</span>
                        <span class="info-value">NT$ ${Number(booking.total_amount || 0).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">本次已收金額</span>
                        <span class="info-value" style="color: #198754; font-weight: 700;">NT$ ${Number(booking.final_amount || 0).toLocaleString()}</span>
                    </div>
                    <div class="info-row" style="border-bottom: none;">
                        <span class="info-label">付款方式</span>
                        <span class="info-value">${booking.payment_method}</span>
                    </div>
                </div>
                
                <p>若您後續仍需變更或取消訂房，請儘早與我們聯繫，我們將盡力協助您。</p>
                
                <div class="footer">
                    <p>再次感謝您的預訂，期待您的光臨！</p>
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

// 修改管理員密碼 API（需要登入）
app.post('/api/admin/change-password', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: '請輸入目前密碼和新密碼'
            });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: '新密碼長度至少需要 8 個字元'
            });
        }
        
        // 驗證目前密碼
        const admin = await db.verifyAdminPassword(req.session.admin.username, currentPassword);
        if (!admin) {
            return res.status(401).json({
                success: false,
                message: '目前密碼錯誤'
            });
        }
        
        // 更新密碼
        const success = await db.updateAdminPassword(req.session.admin.id, newPassword);
        
        if (success) {
            // 記錄操作日誌
            await logAction(req, 'change_password', 'admin', req.session.admin.id, {
                username: req.session.admin.username
            });
            
            res.json({
                success: true,
                message: '密碼已成功修改'
            });
        } else {
            res.status(500).json({
                success: false,
                message: '修改密碼失敗'
            });
        }
    } catch (error) {
        console.error('修改密碼錯誤:', error);
        res.status(500).json({
            success: false,
            message: '修改密碼時發生錯誤：' + error.message
        });
    }
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

// API: 更新客戶資料
app.put('/api/customers/:email', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        const { guest_name, guest_phone } = req.body;
        
        if (!guest_name && !guest_phone) {
            return res.status(400).json({
                success: false,
                message: '至少需要提供姓名或電話'
            });
        }
        
        const updatedCount = await db.updateCustomer(email, { guest_name, guest_phone });
        
        res.json({
            success: true,
            message: '客戶資料已更新',
            updated_count: updatedCount
        });
    } catch (error) {
        console.error('更新客戶資料錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新客戶資料失敗：' + error.message
        });
    }
});

// API: 刪除客戶
app.delete('/api/customers/:email', requireAuth, adminLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        
        await db.deleteCustomer(email);
        
        res.json({
            success: true,
            message: '客戶已刪除'
        });
    } catch (error) {
        console.error('刪除客戶錯誤:', error);
        const statusCode = error.message.includes('訂房記錄') ? 400 : 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || '刪除客戶失敗'
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
        const updateData = { ...req.body };
        
        // 先取得原始訂房資料（用於狀態判斷與寄信）
        const originalBooking = await db.getBookingById(bookingId);
        
        // 如果付款狀態更新為已付款，且訂房狀態為保留，自動改為有效
        if (updateData.payment_status === 'paid' && originalBooking && originalBooking.status === 'reserved') {
            updateData.status = 'active';
            console.log(`✅ 付款狀態更新為已付款，自動將訂房狀態從「保留」改為「有效」`);
        }
        
        const result = await db.updateBooking(bookingId, updateData);
        
        if (result > 0) {
            // 自動寄送收款信：當付款狀態從非「已付款」改為「已付款」，且付款方式為「匯款轉帳」時
            if (updateData.payment_status === 'paid' && 
                originalBooking && 
                originalBooking.payment_method === '匯款轉帳' &&
                originalBooking.payment_status !== 'paid') {
                try {
                    const updatedBooking = await db.getBookingById(bookingId);
                    if (updatedBooking && updatedBooking.payment_method === '匯款轉帳') {
                        console.log(`📧 準備寄送收款信給 ${updatedBooking.guest_email} (${updatedBooking.booking_id})`);
                        
                        const emailUser =
                            (await db.getSetting('email_user')) ||
                            process.env.EMAIL_USER ||
                            'cheng701107@gmail.com';
                        
                        const mailOptions = {
                            from: emailUser,
                            to: updatedBooking.guest_email,
                            subject: '【收款確認】我們已收到您的款項',
                            html: await generatePaymentReceivedEmail(updatedBooking)
                        };
                        
                        let emailSent = false;
                        
                        try {
                            await sendEmail(mailOptions);
                            console.log(`✅ 收款信已發送給 ${updatedBooking.guest_name} (${updatedBooking.booking_id})`);
                            emailSent = true;
                        } catch (emailError) {
                            console.error(`❌ 收款信發送失敗 (${updatedBooking.booking_id}):`, emailError.message);
                        }
                        
                        if (emailSent) {
                            try {
                                await db.updateEmailStatus(updatedBooking.booking_id, 'payment_received', true);
                            } catch (updateError) {
                                console.error(`❌ 更新收款信郵件狀態失敗 (${updatedBooking.booking_id}):`, updateError.message);
                            }
                        }
                    }
                } catch (emailError) {
                    console.error(`❌ 寄送收款信流程發生錯誤 (${bookingId}):`, emailError.message);
                }
            }
            
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
        
        // 取得綠界設定用於驗證（優先使用資料庫設定）
        const isProduction = process.env.NODE_ENV === 'production';
        let ecpayHashKey, ecpayHashIV;
        
        if (isProduction) {
            ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY_PROD || '';
            ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV_PROD || '';
        } else {
            ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY || '5294y06JbISpM5x9';
            ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV || 'v77hoKGq4kWxNNIS';
        }
        
        // 驗證回傳資料（使用正確的設定）
        const isValid = payment.verifyReturnData(req.body, {
            HashKey: ecpayHashKey,
            HashIV: ecpayHashIV
        });
        
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
        
        // 取得綠界設定用於驗證
        // 取得綠界設定用於驗證（優先使用資料庫設定）
        const isProduction = process.env.NODE_ENV === 'production';
        let ecpayHashKey, ecpayHashIV;
        
        if (isProduction) {
            ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY_PROD || '';
            ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV_PROD || '';
        } else {
            ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY || '5294y06JbISpM5x9';
            ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV || 'v77hoKGq4kWxNNIS';
        }
        
        // 驗證回傳資料（使用正確的設定）
        console.log('開始驗證回傳資料...');
        const isValid = payment.verifyReturnData(returnData, {
            HashKey: ecpayHashKey,
            HashIV: ecpayHashIV
        });
        
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
                                    
                                    const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
                                    const customerMailOptions = {
                                        from: emailUser,
                                        to: booking.guest_email,
                                        subject: (await generateEmailFromTemplate('booking_confirmation', bookingData)).subject,
                                        html: (await generateEmailFromTemplate('booking_confirmation', bookingData)).content
                                    };
                                    
                                    let emailSent = false;
                                    try {
                                        await sendEmail(customerMailOptions);
                                        emailSent = true;
                                    } catch (emailError) {
                                        console.error('❌ 確認郵件發送失敗:', emailError.message);
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
                                    font-family: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                    display: flex;
                                    justify-content: center;
                                    align-items: center;
                                    min-height: 100vh;
                                    margin: 0;
                                    padding: 20px;
                                    background-image: url('Background%20image.jpg');
                                    background-size: cover;
                                    background-position: center;
                                    background-repeat: no-repeat;
                                    background-attachment: fixed;
                                }
                                .container {
                                    background: white;
                                    padding: 40px;
                                    border-radius: 24px;
                                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                                    text-align: center;
                                    max-width: 500px;
                                    animation: slideUp 0.5s ease-out;
                                }
                                @keyframes slideUp {
                                    from {
                                        opacity: 0;
                                        transform: translateY(30px);
                                    }
                                    to {
                                        opacity: 1;
                                        transform: translateY(0);
                                    }
                                }
                                .error-icon {
                                    font-size: 80px;
                                    color: #f44336;
                                    margin-bottom: 20px;
                                }
                                h1 { 
                                    color: #333; 
                                    margin-bottom: 10px; 
                                    font-size: 24px;
                                    font-weight: 600;
                                }
                                p { 
                                    color: #666; 
                                    margin: 10px 0; 
                                    font-size: 16px;
                                }
                                .btn {
                                    display: inline-block;
                                    margin-top: 20px;
                                    padding: 12px 30px;
                                    background: #262A33;
                                    color: white;
                                    text-decoration: none;
                                    border-radius: 8px;
                                    font-weight: 500;
                                    transition: background 0.3s;
                                }
                                .btn:hover {
                                    background: #1a1d24;
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
                        
                        // 發送確認郵件 - 使用數據庫模板
                        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
                        let customerMailOptions = null;
                        try {
                            const { subject, content } = await generateEmailFromTemplate('booking_confirmation', bookingData);
                            customerMailOptions = {
                                from: emailUser,
                                to: booking.guest_email,
                                subject: subject,
                                html: content
                            };
                        } catch (templateError) {
                            console.error('⚠️ 無法從數據庫讀取訂房確認模板，使用備用方案:', templateError.message);
                            // 備用方案：使用原來的函數
                            customerMailOptions = {
                                from: emailUser,
                                to: booking.guest_email,
                                subject: '【訂房確認】您的訂房已成功',
                                html: await generateCustomerEmail(bookingData)
                            };
                        }
                        
                        let emailSent = false;
                        try {
                            await sendEmail(customerMailOptions);
                            console.log('✅ 確認郵件已發送');
                            emailSent = true;
                        } catch (emailError) {
                            console.error('❌ 確認郵件發送失敗:', emailError.message);
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
                            .container-header h1 {
                                color: #fff !important;
                                margin: 0 0 16px;
                                font-size: 24px;
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
                                font-family: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                                padding: 20px;
                                background-image: url('Background%20image.jpg');
                                background-size: cover;
                                background-position: center;
                                background-repeat: no-repeat;
                                background-attachment: fixed;
                            }
                            .container {
                                background: white;
                                padding: 40px;
                                border-radius: 24px;
                                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                                text-align: center;
                                max-width: 500px;
                                animation: slideUp 0.5s ease-out;
                            }
                            @keyframes slideUp {
                                from {
                                    opacity: 0;
                                    transform: translateY(30px);
                                }
                                to {
                                    opacity: 1;
                                    transform: translateY(0);
                                }
                            }
                            .error-icon {
                                font-size: 80px;
                                color: #f44336;
                                margin-bottom: 20px;
                            }
                            h1 { 
                                color: #333; 
                                margin-bottom: 10px; 
                                font-size: 24px;
                                font-weight: 600;
                            }
                            p { 
                                color: #666; 
                                margin: 10px 0; 
                                font-size: 16px;
                            }
                            .btn {
                                display: inline-block;
                                margin-top: 20px;
                                padding: 12px 30px;
                                background: #262A33;
                                color: white;
                                text-decoration: none;
                                border-radius: 8px;
                                font-weight: 500;
                                transition: background 0.3s;
                            }
                            .btn:hover {
                                background: #1a1d24;
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
        
        // 驗證模板名稱和主旨不是 email 地址格式（防止錯誤設置）
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(template_name.trim())) {
            console.error('❌ 模板名稱不能是 email 地址格式');
            return res.status(400).json({
                success: false,
                message: '模板名稱不能是 email 地址格式，請使用正確的模板名稱'
            });
        }
        if (emailRegex.test(subject.trim())) {
            console.error('❌ 郵件主旨不能是 email 地址格式');
            return res.status(400).json({
                success: false,
                message: '郵件主旨不能是 email 地址格式，請使用正確的主旨'
            });
        }
        
        // 確保保存的模板包含基本的 HTML 結構
        let finalContent = content;
        
        // 檢查是否包含基本的 HTML 結構
        const hasFullHtmlStructure = finalContent.includes('<!DOCTYPE html>') || 
                                     (finalContent.includes('<html') && finalContent.includes('</html>'));
        
        // 檢查是否包含 <style> 標籤
        const hasStyleTag = finalContent.includes('<style>') || finalContent.includes('<style ');
        
        // 如果缺少基本結構或樣式，自動修復
        if (!hasFullHtmlStructure || !hasStyleTag) {
            console.log('⚠️ 保存的模板缺少基本 HTML 結構或樣式，自動修復中...', {
                key,
                hasFullHtmlStructure,
                hasStyleTag,
                contentLength: finalContent.length
            });
            
            // 基本文字樣式
            const basicStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        h2 { color: #333; font-size: 20px; margin-top: 25px; margin-bottom: 15px; }
        h3 { color: #333; font-size: 18px; margin-top: 20px; margin-bottom: 10px; }
        p { margin: 10px 0; }
        strong { color: #333; }
        ul, ol { margin: 10px 0; padding-left: 30px; }
        li { margin: 5px 0; }
    `;
            
            // 如果沒有完整的 HTML 結構，包裝現有內容
            if (!hasFullHtmlStructure) {
                // 提取實際內容
                let bodyContent = finalContent;
                if (finalContent.includes('<body>')) {
                    const bodyMatch = finalContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch && bodyMatch[1]) {
                        bodyContent = bodyMatch[1];
                    }
                }
                
                finalContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${basicStyle}</style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
            } else if (!hasStyleTag) {
                // 如果有 HTML 結構但缺少樣式標籤，添加基本樣式
                if (finalContent.includes('<head>')) {
                    finalContent = finalContent.replace(
                        /<head[^>]*>/i,
                        `<head>
    <meta charset="UTF-8">
    <style>${basicStyle}</style>`
                    );
                } else {
                    finalContent = finalContent.replace(
                        /<html[^>]*>/i,
                        `<html>
<head>
    <meta charset="UTF-8">
    <style>${basicStyle}</style>
</head>`
                    );
                }
            }
            
            console.log('✅ 模板已自動修復，添加基本的 HTML 結構和樣式');
        }
        
        const result = await db.updateEmailTemplate(key, {
            template_name,
            subject,
            content: finalContent,  // 使用修復後的內容
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
        
        // 獲取 emailUser 設定
        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
        
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
        
        // 生成隨機數的輔助函數
        const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
        const randomAmount = (min, max) => randomInt(min, max).toLocaleString();
        
        // 計算日期
        const today = new Date();
        const checkInDate = new Date(today.getTime() + randomInt(1, 30) * 24 * 60 * 60 * 1000);
        const checkOutDate = new Date(checkInDate.getTime() + randomInt(1, 7) * 24 * 60 * 60 * 1000);
        const nights = Math.max(1, Math.round((checkOutDate - checkInDate) / (24 * 60 * 60 * 1000)));
        const paymentDeadlineDate = new Date(today.getTime() + randomInt(1, 7) * 24 * 60 * 60 * 1000);
        
        // 創建測試資料來替換模板變數（使用隨機數生成缺失的參數）
        const testData = {
            guestName: '測試用戶' + randomInt(1, 999),
            bookingId: 'TEST' + Date.now().toString().slice(-6) + randomInt(100, 999),
            checkInDate: checkInDate.toLocaleDateString('zh-TW'),
            checkOutDate: checkOutDate.toLocaleDateString('zh-TW'),
            nights: nights.toString(),
            roomType: ['標準雙人房', '豪華雙人房', '標準單人房', '豪華單人房', '家庭房'][randomInt(0, 4)],
            pricePerNight: randomAmount(2000, 5000),
            totalAmount: randomAmount(5000, 20000),
            finalAmount: randomAmount(2000, 8000),
            remainingAmount: randomAmount(1000, 10000),
            bankName: ['台灣銀行', '中國信託', '第一銀行', '華南銀行', '玉山銀行'][randomInt(0, 4)],
            bankBranch: ['台北分行', '台中分行', '高雄分行', '新竹分行'][randomInt(0, 3)],
            bankBranchDisplay: ' - ' + ['台北分行', '台中分行', '高雄分行', '新竹分行'][randomInt(0, 3)],
            bankAccount: Array.from({length: 14}, () => randomInt(0, 9)).join(''),
            accountName: '測試戶名' + randomInt(1, 99),
            daysReserved: randomInt(1, 7).toString(),
            paymentDeadline: paymentDeadlineDate.toLocaleDateString('zh-TW'),
            addonsList: ['加床 x1 (NT$ 500)', '早餐券 x2 (NT$ 300)', '停車券 x1 (NT$ 200)', '加床 x2 (NT$ 1,000)'][randomInt(0, 3)],
            addonsTotal: randomAmount(200, 1500),
            paymentMethod: ['匯款轉帳', '線上刷卡', '現金'][randomInt(0, 2)],
            paymentAmount: ['全額', '訂金 30%', '訂金 50%'][randomInt(0, 2)],
            guestPhone: '09' + Array.from({length: 8}, () => randomInt(0, 9)).join(''),
            guestEmail: 'test' + randomInt(1000, 9999) + '@example.com',
            bookingDate: today.toLocaleDateString('zh-TW'),
            bookingDateTime: today.toLocaleString('zh-TW'),
            bookingIdLast5: (Date.now().toString().slice(-6) + randomInt(100, 999)).slice(-5)
        };
        
        // 確保測試郵件包含完整的 HTML 結構和 CSS 樣式
        // 對於測試郵件，如果使用編輯器內容，強制檢查並使用資料庫中的完整模板以確保樣式正確
        let testContent = content;
        
        // 如果使用編輯器內容，強制使用資料庫中的完整模板以確保樣式正確
        // 因為編輯器可能只提取了部分內容，缺少完整的 CSS 樣式
        if (useEditorContent) {
            console.log('⚠️ 測試郵件使用編輯器內容，強制使用資料庫中的完整模板以確保樣式正確');
            const originalTemplate = await db.getEmailTemplateByKey(key);
            if (originalTemplate && originalTemplate.content) {
                // 使用資料庫中的完整模板
                testContent = originalTemplate.content;
                console.log('✅ 已使用資料庫中的完整模板（包含完整的 CSS 樣式）');
            } else {
                console.warn('⚠️ 無法取得資料庫模板，使用編輯器內容');
            }
        }
        
        // 檢查是否包含完整的 HTML 結構
        const hasFullHtmlStructure = testContent.includes('<!DOCTYPE html>') || 
                                     (testContent.includes('<html') && testContent.includes('</html>'));
        
        // 檢查是否包含必要的 CSS 樣式（特別是 .header 樣式）
        // 更嚴格地檢查：必須包含 .header 樣式定義，且包含背景色設定
        const hasHeaderStyle = testContent.includes('.header') && 
                               (testContent.includes('background') || testContent.includes('background-color'));
        
        // 檢查是否包含 <style> 標籤
        const hasStyleTag = testContent.includes('<style>') || testContent.includes('<style ');
        
        // 對於入住提醒郵件，特別檢查是否包含深灰色背景色 #262A33
        const isCheckinReminder = key === 'checkin_reminder';
        const hasCorrectHeaderColor = !isCheckinReminder || testContent.includes('#262A33');
        
        // 如果缺少完整結構或樣式，使用資料庫中的完整模板
        const shouldUseDatabaseTemplate = !hasFullHtmlStructure || !hasHeaderStyle || !hasStyleTag || !hasCorrectHeaderColor;
        
        if (shouldUseDatabaseTemplate && !useEditorContent) {
            // 只有在不使用編輯器內容時才進行修復（因為已經在上面處理過了）
            console.log('⚠️ 測試郵件內容缺少完整結構或樣式，檢查項目:', {
                hasFullHtmlStructure,
                hasHeaderStyle,
                hasStyleTag,
                hasCorrectHeaderColor,
                isCheckinReminder,
                useEditorContent,
                contentLength: testContent.length,
                hasHtmlTag: testContent.includes('<html'),
                hasStyleTag: testContent.includes('<style'),
                hasHeaderColor: testContent.includes('#262A33')
            });
            
            // 嘗試從資料庫讀取原始模板
            const originalTemplate = await db.getEmailTemplateByKey(key);
            if (originalTemplate && originalTemplate.content) {
                // 使用原始模板的完整結構，但保留編輯器中的內容（如果有）
                // 如果編輯器內容包含在 body 中，嘗試提取並替換到原始模板
                if (hasFullHtmlStructure && testContent.includes('<body>')) {
                    // 提取 body 內容
                    const bodyMatch = testContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch && bodyMatch[1]) {
                        // 使用原始模板的結構，但替換 body 內容
                        testContent = originalTemplate.content.replace(
                            /<body[^>]*>[\s\S]*?<\/body>/i,
                            `<body>${bodyMatch[1]}</body>`
                        );
                        console.log('✅ 使用原始模板結構，保留編輯器中的 body 內容');
                    } else {
                        // 如果無法提取 body 內容，使用完整原始模板
                        testContent = originalTemplate.content;
                        console.log('✅ 使用資料庫中的完整模板');
                    }
                } else {
                    // 如果沒有完整的 HTML 結構，直接使用原始模板
                    testContent = originalTemplate.content;
                    console.log('✅ 使用資料庫中的完整模板（缺少 HTML 結構）');
                }
            } else {
                // 如果無法取得原始模板，包裝現有內容為完整 HTML
                const defaultStyle = `
                    body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #262A33; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                    .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #262A33; }
                    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
                    .info-label { font-weight: 600; color: #666; }
                    .info-value { color: #333; }
                `;
                
                // 提取實際內容（移除可能的 HTML 標籤）
                let bodyContent = testContent;
                if (testContent.includes('<body>')) {
                    const bodyMatch = testContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch && bodyMatch[1]) {
                        bodyContent = bodyMatch[1];
                    }
                }
                
                testContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${defaultStyle}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
        </div>
        <div class="content">
            ${bodyContent}
        </div>
    </div>
</body>
</html>`;
                console.log('⚠️ 測試郵件內容缺少完整 HTML 結構，已包裝為完整 HTML');
            }
        } else {
            console.log('✅ 測試郵件內容包含完整的 HTML 結構和樣式', {
                hasFullHtmlStructure,
                hasHeaderStyle,
                hasStyleTag,
                hasCorrectHeaderColor: isCheckinReminder ? testContent.includes('#262A33') : 'N/A',
                contentLength: testContent.length
            });
        }
        
        // 替換模板變數（先替換所有變數）
        Object.keys(testData).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            testContent = testContent.replace(regex, testData[key]);
        });
        
        // 處理條件區塊（顯示所有條件區塊用於測試）
        // 先處理嵌套條件（從內到外）
        // 1. 處理 {{#if bankName}} 和 {{#if accountName}}
        testContent = testContent.replace(/\{\{#if bankName\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        testContent = testContent.replace(/\{\{#if accountName\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        
        // 2. 處理 {{#if addonsList}}
        testContent = testContent.replace(/\{\{#if addonsList\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        
        // 3. 處理 {{#if isDeposit}}
        testContent = testContent.replace(/\{\{#if isDeposit\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        
        // 4. 處理 {{#if bankInfo}} ... {{else}} ... {{/if}}
        testContent = testContent.replace(/\{\{#if bankInfo\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        
        // 5. 處理 {{#if isTransfer}}
        testContent = testContent.replace(/\{\{#if isTransfer\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
        
        // 6. 最後清理：移除所有殘留的條件標籤（防止遺漏）
        let maxCleanupIterations = 50;
        let cleanupIteration = 0;
        let lastCleanupContent = '';
        
        while (cleanupIteration < maxCleanupIterations) {
            lastCleanupContent = testContent;
            
            // 移除所有 {{#if ...}} 標籤（匹配任何條件名稱）
            testContent = testContent.replace(/\{\{#if\s+[^}]+\}\}/gi, '');
            // 移除所有 {{/if}} 標籤
            testContent = testContent.replace(/\{\{\/if\}\}/gi, '');
            // 移除所有 {{else}} 標籤
            testContent = testContent.replace(/\{\{else\}\}/gi, '');
            
            // 如果沒有變化，跳出循環
            if (testContent === lastCleanupContent) {
                break;
            }
            cleanupIteration++;
        }
        
        // 再次替換所有變數（確保條件區塊處理後剩餘的變數也被替換）
        Object.keys(testData).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            testContent = testContent.replace(regex, testData[key]);
        });
        
        // 處理 {{hotelInfoFooter}} 變數
        const hotelInfoFooter = await getHotelInfoFooter();
        let hasHotelInfoFooterVariable = false;
        if (hotelInfoFooter) {
            // 檢查模板中是否已經有 {{hotelInfoFooter}} 變數
            if (testContent.includes('{{hotelInfoFooter}}')) {
                testContent = testContent.replace(/\{\{hotelInfoFooter\}\}/g, hotelInfoFooter);
                hasHotelInfoFooterVariable = true;
            }
        } else {
            testContent = testContent.replace(/\{\{hotelInfoFooter\}\}/g, '');
        }
        
        // 替換主旨中的變數
        let testSubject = subject;
        Object.keys(testData).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            testSubject = testSubject.replace(regex, testData[key]);
        });
        
        // 最後檢查：確保測試郵件包含完整的 CSS 樣式和 HTML 結構（即使之前已經檢查過）
        // 這是最後一道防線，確保發送的郵件一定有圖卡樣式
        // 必須檢查所有必要的元素：HTML 結構、CSS 樣式、HTML 元素
        const finalCheckHasFullHtml = testContent.includes('<!DOCTYPE html>') || 
                                      (testContent.includes('<html') && testContent.includes('</html>'));
        const finalCheckHasStyleTag = testContent.includes('<style>') || testContent.includes('<style ');
        const finalCheckHasHeaderStyle = testContent.includes('.header') && 
                                       (testContent.includes('background') || testContent.includes('background-color')) &&
                                       testContent.includes('.content') &&
                                       testContent.includes('.container');
        const finalCheckHasHeaderColor = isCheckinReminder ? testContent.includes('#262A33') : true;
        const finalCheckHasContainer = testContent.includes('class="container') || testContent.includes("class='container");
        const finalCheckHasHeader = testContent.includes('class="header') || testContent.includes("class='header");
        const finalCheckHasContent = testContent.includes('class="content') || testContent.includes("class='content");
        
        // 如果缺少任何必要的結構或樣式，強制修復
        if (!finalCheckHasFullHtml || !finalCheckHasStyleTag || !finalCheckHasHeaderStyle || 
            !finalCheckHasHeaderColor || !finalCheckHasContainer || !finalCheckHasHeader || !finalCheckHasContent) {
            console.log('⚠️ 最終檢查：測試郵件仍缺少完整樣式或結構，強制修復...', {
                finalCheckHasFullHtml,
                finalCheckHasStyleTag,
                finalCheckHasHeaderStyle,
                finalCheckHasHeaderColor,
                finalCheckHasContainer,
                finalCheckHasHeader,
                finalCheckHasContent,
                contentLength: testContent.length,
                hasHtmlTag: testContent.includes('<html'),
                hasStyleTag: testContent.includes('<style'),
                hasContainerClass: testContent.includes('class="container') || testContent.includes("class='container"),
                hasHeaderClass: testContent.includes('class="header') || testContent.includes("class='header"),
                hasContentClass: testContent.includes('class="content') || testContent.includes("class='content")
            });
            
            // 根據模板類型選擇對應的樣式
            let headerColor = '#262A33'; // 預設深灰色
            if (key === 'payment_reminder') {
                headerColor = '#e74c3c'; // 紅色
            } else if (key === 'booking_confirmation') {
                headerColor = '#198754'; // 綠色
            }
            
            const completeStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${headerColor}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${headerColor}; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 15px 0; }
    `;
            
            // 提取 body 內容
            // 優先提取 .content div 內的實際內容，如果沒有則提取整個 body 內容
            let bodyContent = testContent;
            if (testContent.includes('<body>')) {
                const bodyMatch = testContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch && bodyMatch[1]) {
                    const bodyHtml = bodyMatch[1];
                    
                    // 嘗試提取 .content div 內的內容
                    const contentDivStartRegex = /<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>/i;
                    const contentStartMatch = bodyHtml.match(contentDivStartRegex);
                    
                    if (contentStartMatch) {
                        const startIndex = contentStartMatch.index;
                        const startTag = contentStartMatch[0];
                        const afterStartTag = bodyHtml.substring(startIndex + startTag.length);
                        
                        // 計算嵌套的 div 層級，找到對應的結束標籤
                        let divCount = 1;
                        let currentIndex = 0;
                        let endIndex = -1;
                        
                        while (currentIndex < afterStartTag.length && divCount > 0) {
                            const openDiv = afterStartTag.indexOf('<div', currentIndex);
                            const closeDiv = afterStartTag.indexOf('</div>', currentIndex);
                            
                            if (closeDiv === -1) break;
                            
                            if (openDiv !== -1 && openDiv < closeDiv) {
                                divCount++;
                                currentIndex = openDiv + 4;
                            } else {
                                divCount--;
                                if (divCount === 0) {
                                    endIndex = closeDiv;
                                    break;
                                }
                                currentIndex = closeDiv + 6;
                            }
                        }
                        
                        if (endIndex !== -1) {
                            // 成功提取 .content div 內的內容
                            bodyContent = afterStartTag.substring(0, endIndex);
                            console.log('✅ 已提取 .content div 內的實際內容');
                        } else {
                            // 如果無法找到結束標籤，移除結構標籤，保留所有內容
                            bodyContent = bodyHtml
                                .replace(/<div[^>]*class\s*=\s*["']container["'][^>]*>/gi, '')
                                .replace(/<div[^>]*class\s*=\s*["']header["'][^>]*>[\s\S]*?<\/div>/gi, '')
                                .replace(/<div[^>]*class\s*=\s*["']content["'][^>]*>/gi, '')
                                .replace(/<\/div>\s*<\/div>\s*$/i, '')
                                .trim();
                            console.log('⚠️ 無法找到 .content div 結束標籤，使用移除結構標籤的方式');
                        }
                    } else {
                        // 如果沒有 .content div，移除結構標籤，保留所有內容
                        bodyContent = bodyHtml
                            .replace(/<div[^>]*class\s*=\s*["']container["'][^>]*>/gi, '')
                            .replace(/<div[^>]*class\s*=\s*["']header["'][^>]*>[\s\S]*?<\/div>/gi, '')
                            .replace(/<div[^>]*class\s*=\s*["']content["'][^>]*>/gi, '')
                            .replace(/<\/div>\s*<\/div>\s*$/i, '')
                            .trim();
                        console.log('⚠️ 未找到 .content div，使用移除結構標籤的方式');
                    }
                }
            } else if (testContent.includes('<html')) {
                // 如果只有 HTML 標籤但沒有 body，提取 HTML 內容
                const htmlMatch = testContent.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
                if (htmlMatch && htmlMatch[1]) {
                    bodyContent = htmlMatch[1]
                        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
                        .replace(/<div[^>]*class\s*=\s*["']container["'][^>]*>/gi, '')
                        .replace(/<div[^>]*class\s*=\s*["']header["'][^>]*>[\s\S]*?<\/div>/gi, '')
                        .replace(/<div[^>]*class\s*=\s*["']content["'][^>]*>/gi, '')
                        .replace(/<\/div>\s*<\/div>\s*$/i, '')
                        .trim();
                }
            }
            
            // 重建完整的圖卡樣式 HTML
            testContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${completeStyle}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 ${template.name || '郵件'}</h1>
        </div>
        <div class="content">
            ${bodyContent}
        </div>
    </div>
</body>
</html>`;
            
            console.log('✅ 最終修復完成，測試郵件現在包含完整的圖卡樣式');
        }
        
        // 在添加 footer 之前，再次驗證樣式完整性（確保 footer 不會破壞結構）
        const preFooterCheckHasFullHtml = testContent.includes('<!DOCTYPE html>') || 
                                         (testContent.includes('<html') && testContent.includes('</html>'));
        const preFooterCheckHasStyleTag = testContent.includes('<style>') || testContent.includes('<style ');
        const preFooterCheckHasContainer = testContent.includes('class="container') || testContent.includes("class='container");
        const preFooterCheckHasHeader = testContent.includes('class="header') || testContent.includes("class='header");
        const preFooterCheckHasContent = testContent.includes('class="content') || testContent.includes("class='content");
        
        if (!preFooterCheckHasFullHtml || !preFooterCheckHasStyleTag || 
            !preFooterCheckHasContainer || !preFooterCheckHasHeader || !preFooterCheckHasContent) {
            console.error('❌ 添加 footer 前檢查：測試郵件仍缺少完整結構，這不應該發生！', {
                preFooterCheckHasFullHtml,
                preFooterCheckHasStyleTag,
                preFooterCheckHasContainer,
                preFooterCheckHasHeader,
                preFooterCheckHasContent
            });
            // 即使不應該發生，也要強制修復
            const headerColor = key === 'payment_reminder' ? '#e74c3c' : 
                               key === 'booking_confirmation' ? '#198754' : '#262A33';
            const emergencyStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${headerColor}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${headerColor}; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 15px 0; }
    `;
            
            let emergencyBodyContent = testContent;
            if (testContent.includes('<body>')) {
                const bodyMatch = testContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch && bodyMatch[1]) {
                    emergencyBodyContent = bodyMatch[1]
                        .replace(/<div[^>]*class\s*=\s*["']container["'][^>]*>/gi, '')
                        .replace(/<div[^>]*class\s*=\s*["']header["'][^>]*>[\s\S]*?<\/div>/gi, '')
                        .replace(/<div[^>]*class\s*=\s*["']content["'][^>]*>/gi, '')
                        .replace(/<\/div>\s*<\/div>\s*$/i, '')
                        .trim();
                }
            }
            
            testContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${emergencyStyle}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 ${template.name || '郵件'}</h1>
        </div>
        <div class="content">
            ${emergencyBodyContent}
        </div>
    </div>
</body>
</html>`;
            console.log('✅ 緊急修復完成，確保測試郵件包含完整的圖卡樣式');
        }
        
        // 只有在模板中沒有 {{hotelInfoFooter}} 變數時，才添加旅館資訊 footer（避免重複）
        if (hotelInfoFooter && !hasHotelInfoFooterVariable) {
            // 檢查是否已經有 hotelInfoFooter 內容（避免重複添加）
            const hotelInfoFooterPattern = /<div[^>]*class\s*=\s*["'][^"']*hotel-info[^"']*["'][^>]*>/i;
            if (!hotelInfoFooterPattern.test(testContent)) {
                testContent = testContent.replace('</body>', hotelInfoFooter + '</body>');
            }
        }
        
        // 最終驗證：發送前最後一次檢查
        const finalSendCheck = testContent.includes('<!DOCTYPE html>') && 
                              testContent.includes('<style>') &&
                              testContent.includes('class="container') &&
                              testContent.includes('class="header') &&
                              testContent.includes('class="content');
        
        if (!finalSendCheck) {
            console.error('❌ 發送前最終檢查失敗！測試郵件可能缺少完整結構！');
        } else {
            console.log('✅ 發送前最終檢查通過，測試郵件包含完整的圖卡樣式');
        }
        
        // 發送測試郵件（使用統一函數，自動選擇 Resend 或 Gmail）
        const mailOptions = {
            from: emailUser,
            to: email,
            subject: `[測試] ${testSubject}`,
            html: testContent
        };
        
        try {
            await sendEmail(mailOptions);
            res.json({
                success: true,
                message: '測試郵件已成功發送'
            });
        } catch (emailError) {
            console.error('❌ 測試郵件發送失敗:');
            console.error('   發送給:', email);
            console.error('   錯誤訊息:', emailError.message);
            console.error('   錯誤代碼:', emailError.code);
            console.error('   完整錯誤:', emailError);
            
            // 如果是認證錯誤，提供更詳細的說明
            if (emailError.message && (emailError.message.includes('invalid_client') || emailError.message.includes('Invalid client'))) {
                console.error('⚠️  OAuth2 Client ID/Secret 認證失敗！');
                console.error('   這通常是因為 Client ID 或 Client Secret 不正確');
                console.error('   請檢查：');
                console.error('   1. GMAIL_CLIENT_ID 是否正確（格式：xxx.apps.googleusercontent.com）');
                console.error('   2. GMAIL_CLIENT_SECRET 是否正確（格式：GOCSPX-xxx）');
                console.error('   3. Client ID 和 Client Secret 是否來自同一個 OAuth2 應用程式');
                console.error('   4. 是否在 Google Cloud Console 中正確建立了 OAuth 用戶端 ID');
                console.error('   5. OAuth 用戶端類型是否為「網頁應用程式」');
                
                return res.status(500).json({
                    success: false,
                    message: '發送測試郵件失敗：OAuth2 客戶端認證錯誤（invalid_client）。請檢查 Gmail Client ID 和 Client Secret 是否正確配置，或聯繫管理員重新配置郵件服務。'
                });
            } else if (emailError.message && (emailError.message.includes('invalid_grant') || emailError.message.includes('Invalid grant'))) {
                console.error('⚠️  OAuth2 認證失敗！');
                console.error('   這通常是因為 Gmail Refresh Token 已過期或被撤銷');
                console.error('   請檢查：');
                console.error('   1. GMAIL_REFRESH_TOKEN 是否正確');
                console.error('   2. Refresh Token 是否已過期');
                console.error('   3. 是否需要在 OAuth2 Playground 重新生成 Refresh Token');
                
                return res.status(500).json({
                    success: false,
                    message: '發送測試郵件失敗：OAuth2 認證錯誤（invalid_grant）。請檢查 Gmail Refresh Token 是否有效，或聯繫管理員重新配置郵件服務。'
                });
            } else if (emailError.message && (emailError.message.includes('unauthorized_client') || emailError.message.includes('Unauthorized client'))) {
                console.error('⚠️  OAuth2 Client 認證失敗！');
                console.error('   可能原因：');
                console.error('   1. GMAIL_CLIENT_ID 或 GMAIL_CLIENT_SECRET 不正確');
                console.error('   2. Refresh Token 是從不同的 Client ID/Secret 生成的');
                console.error('   3. OAuth2 應用程式設定有問題');
                console.error('   4. Gmail API 未啟用');
                console.error('   5. 已授權的重新導向 URI 未包含：https://developers.google.com/oauthplayground');
                console.error('   解決方法：');
                console.error('   1. 檢查 Google Cloud Console → API 和服務 → 憑證');
                console.error('   2. 確認 Client ID 和 Client Secret 是否正確');
                console.error('   3. 確認 Refresh Token 是從相同的 Client ID/Secret 生成的');
                console.error('   4. 確認 OAuth 同意畫面已正確設定');
                console.error('   5. 確認 Gmail API 已啟用');
                console.error('   6. 確認已授權的重新導向 URI 包含：https://developers.google.com/oauthplayground');
                
                return res.status(500).json({
                    success: false,
                    message: '發送測試郵件失敗：OAuth2 客戶端認證錯誤（unauthorized_client）。請檢查 Gmail Client ID、Client Secret 和 Refresh Token 是否正確配置，或聯繫管理員重新配置郵件服務。'
                });
            } else if (emailError.response && emailError.response.data) {
                console.error('   API 回應:', emailError.response.data);
                return res.status(500).json({
                    success: false,
                    message: '發送測試郵件失敗：' + (emailError.response.data.error?.message || emailError.message || '未知錯誤')
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: '發送測試郵件失敗：' + (emailError.message || '未知錯誤')
                });
            }
        }
    } catch (error) {
        console.error('❌ 發送測試郵件錯誤:', error);
        console.error('   錯誤詳情:', error.message);
        console.error('   錯誤代碼:', error.code);
        console.error('   錯誤堆疊:', error.stack);
        
        // 如果是 OAuth2 相關錯誤，提供更詳細的說明
        if (error.message && (error.message.includes('invalid_client') || error.message.includes('Invalid client'))) {
            console.error('⚠️  OAuth2 Client ID/Secret 認證失敗！');
            console.error('   這通常是因為 Client ID 或 Client Secret 不正確');
            console.error('   請檢查：');
            console.error('   1. GMAIL_CLIENT_ID 是否正確（格式：xxx.apps.googleusercontent.com）');
            console.error('   2. GMAIL_CLIENT_SECRET 是否正確（格式：GOCSPX-xxx）');
            console.error('   3. Client ID 和 Client Secret 是否來自同一個 OAuth2 應用程式');
            console.error('   4. 是否在 Google Cloud Console 中正確建立了 OAuth 用戶端 ID');
            console.error('   5. OAuth 用戶端類型是否為「網頁應用程式」');
            
            return res.status(500).json({
                success: false,
                message: '發送測試郵件失敗：OAuth2 客戶端認證錯誤（invalid_client）。請檢查 Gmail Client ID 和 Client Secret 是否正確配置，或聯繫管理員重新配置郵件服務。'
            });
        } else if (error.message && (error.message.includes('unauthorized_client') || error.message.includes('Unauthorized client'))) {
            console.error('⚠️  OAuth2 Client 認證失敗！');
            console.error('   可能原因：');
            console.error('   1. GMAIL_CLIENT_ID 或 GMAIL_CLIENT_SECRET 不正確');
            console.error('   2. Refresh Token 是從不同的 Client ID/Secret 生成的');
            console.error('   3. OAuth2 應用程式設定有問題');
            console.error('   4. Gmail API 未啟用');
            console.error('   5. 已授權的重新導向 URI 未包含：https://developers.google.com/oauthplayground');
            
            return res.status(500).json({
                success: false,
                message: '發送測試郵件失敗：OAuth2 客戶端認證錯誤（unauthorized_client）。請檢查 Gmail Client ID、Client Secret 和 Refresh Token 是否正確配置，或聯繫管理員重新配置郵件服務。'
            });
        } else if (error.message && (error.message.includes('invalid_grant') || error.message.includes('Invalid grant'))) {
            console.error('⚠️  OAuth2 Refresh Token 無效或已過期！');
            console.error('   解決方法：');
            console.error('   1. 在 OAuth2 Playground 重新生成 Refresh Token');
            console.error('   2. 更新資料庫或環境變數中的 GMAIL_REFRESH_TOKEN');
            
            return res.status(500).json({
                success: false,
                message: '發送測試郵件失敗：OAuth2 認證錯誤（invalid_grant）。請檢查 Gmail Refresh Token 是否有效，或聯繫管理員重新配置郵件服務。'
            });
        }
        
        res.status(500).json({
            success: false,
            message: '發送測試郵件失敗：' + (error.message || '未知錯誤')
        });
    }
});

// API: 重置郵件模板為預設文字樣式
app.post('/api/email-templates/reset-to-default', requireAuth, adminLimiter, async (req, res) => {
    try {
        // 先確保數據庫中有最新的預設模板
        const { initEmailTemplates } = require('./database');
        await initEmailTemplates();
        
        // 從數據庫讀取預設模板
        const templateKeys = ['payment_reminder', 'checkin_reminder', 'feedback_request', 
                              'booking_confirmation', 'booking_confirmation_admin', 
                              'payment_completed', 'cancel_notification'];
        const defaultTemplates = [];
        
        for (const key of templateKeys) {
            const template = await db.getEmailTemplateByKey(key);
            if (template) {
                defaultTemplates.push({
                    key: template.template_key,
                    name: template.template_name,
                    subject: template.subject,
                    content: template.content,
                    days_before_checkin: template.days_before_checkin,
                    send_hour_checkin: template.send_hour_checkin,
                    days_after_checkout: template.days_after_checkout,
                    send_hour_feedback: template.send_hour_feedback,
                    days_reserved: template.days_reserved,
                    send_hour_payment_reminder: template.send_hour_payment_reminder
                });
            }
        }
        
        // 如果從數據庫讀取失敗，使用備用模板（已更新為文字樣式）
        const fallbackTemplates = [
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
        .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
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
            },
            {
                key: 'booking_confirmation',
                name: '訂房確認（客戶）',
                subject: '【訂房確認】您的訂房已成功',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #198754; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #198754; }
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
            <p>親愛的 {{guestName}}，</p>
            <p style="margin-bottom: 25px;">您的訂房已成功確認，以下是您的訂房資訊：</p>
            
            <div class="highlight">
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
                    <span class="info-label">住宿天數</span>
                    <span class="info-value">{{nights}} 晚</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房價（每晚）</span>
                    <span class="info-value">NT$ {{pricePerNight}}</span>
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
                    <span class="info-value">NT$ {{totalAmount}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
                <div class="info-row" style="border-bottom: none; margin-top: 15px; padding-top: 15px; border-top: 2px solid #667eea;">
                    <span class="info-label" style="font-size: 18px;">應付金額</span>
                    <span class="info-value" style="font-size: 20px; color: #667eea; font-weight: 700;">NT$ {{finalAmount}}</span>
                </div>
            </div>

            {{#if isDeposit}}
            <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="color: #2e7d32; font-weight: 600; margin: 0; font-size: 16px;">💡 剩餘尾款於現場付清！</p>
                <p style="color: #2e7d32; margin: 10px 0 0 0; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}

            {{#if isTransfer}}
            <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #856404; margin-top: 0;">💰 匯款提醒</h3>
                <p style="color: #856404; font-weight: 600; margin: 10px 0;">
                    ⏰ 此訂房將為您保留 <strong>{{daysReserved}} 天</strong>，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。
                </p>
                {{#if bankInfo}}
                <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                    <p style="margin: 8px 0; color: #333;"><strong>匯款資訊：</strong></p>
                    {{#if bankName}}<p style="margin: 5px 0; color: #333;">銀行：{{bankName}}{{bankBranchDisplay}}</p>{{/if}}
                    <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">{{bankAccount}}</span></p>
                    {{#if accountName}}<p style="margin: 5px 0; color: #333;">戶名：{{accountName}}</p>{{/if}}
                    <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>{{bookingIdLast5}}</strong></p>
                </div>
                {{else}}
                <p style="color: #856404; margin: 10px 0;">⚠️ 匯款資訊尚未設定，請聯繫客服取得匯款帳號。</p>
                {{/if}}
            </div>
            {{/if}}
            
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
            {{hotelInfoFooter}}
        </div>
    </div>
</body>
</html>`
            },
            {
                key: 'booking_confirmation_admin',
                name: '訂房確認（管理員）',
                subject: '【新訂房通知】{{guestName}} - {{bookingId}}',
                content: `<!DOCTYPE html>
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
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">客戶姓名</span>
                    <span class="info-value">{{guestName}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">聯絡電話</span>
                    <span class="info-value">{{guestPhone}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Email</span>
                    <span class="info-value">{{guestEmail}}</span>
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
                    <span class="info-value" style="color: #e74c3c; font-weight: 700;">NT$ {{finalAmount}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">訂房時間</span>
                    <span class="info-value">{{bookingDate}}</span>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`
            },
            {
                key: 'payment_completed',
                name: '付款完成確認',
                subject: '【訂房確認】您的訂房已成功',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #198754; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .highlight { background: #e8f5e9; border: 2px solid #198754; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ 付款完成確認</h1>
            <p>感謝您的付款！</p>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}}，</p>
            <p style="margin-bottom: 20px;">我們已確認收到您的付款，以下是您的訂房與付款資訊：</p>
            
            <div class="highlight">
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
                <div class="info-row">
                    <span class="info-label">總金額</span>
                    <span class="info-value">NT$ {{totalAmount}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">本次已收金額</span>
                    <span class="info-value" style="color: #198754; font-weight: 700;">NT$ {{finalAmount}}</span>
                </div>
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">付款方式</span>
                    <span class="info-value">{{paymentMethod}}</span>
                </div>
            </div>
            
            <p>若您後續仍需變更或取消訂房，請儘早與我們聯繫，我們將盡力協助您。</p>
            
            <div class="footer">
                <p>再次感謝您的預訂，期待您的光臨！</p>
                <p>此為系統自動發送郵件，請勿直接回覆</p>
            </div>
            {{hotelInfoFooter}}
        </div>
    </div>
</body>
</html>`
            },
            {
                key: 'cancel_notification',
                name: '取消通知',
                subject: '【訂房取消通知】您的訂房已自動取消',
                content: `<!DOCTYPE html>
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
            <p>親愛的 {{guestName}}，</p>
            <p style="margin-bottom: 25px;">很抱歉通知您，由於超過匯款保留期限，您的訂房已自動取消。以下是取消的訂房資訊：</p>
            
            <div class="highlight">
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
                    <span class="info-label">住宿天數</span>
                    <span class="info-value">{{nights}} 晚</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">訂房日期</span>
                    <span class="info-value">{{bookingDate}}</span>
                </div>
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">應付金額</span>
                    <span class="info-value">NT$ {{finalAmount}}</span>
                </div>
            </div>

            <div class="warning-box">
                <h3 style="color: #856404; margin-top: 0;">📌 取消原因</h3>
                <p style="color: #856404; margin: 10px 0;">
                    此訂房因超過匯款保留期限（{{bookingDate}} 起算），且未在期限內完成付款，系統已自動取消。
                </p>
            </div>

            <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #2e7d32; margin-top: 0;">💡 如需重新訂房</h3>
                <p style="color: #2e7d32; margin: 10px 0;">
                    如果您仍希望預訂，歡迎重新進行訂房。如有任何疑問，請隨時與我們聯繫。
                </p>
            </div>

            {{hotelInfoFooter}}
        </div>
    </div>
</body>
</html>`
            }
            ];
        
        // 檢查是否指定了單個模板重置
        const { templateKey } = req.body;
        
        if (templateKey) {
            // 只重置指定的模板
            const template = defaultTemplates.find(t => t.key === templateKey);
            if (!template) {
                return res.status(400).json({
                    success: false,
                    message: '找不到指定的模板'
                });
            }
            
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
            
            res.json({
                success: true,
                message: `郵件模板「${template.name}」已重置為預設文字樣式`
            });
        } else {
            // 更新所有模板為預設文字樣式
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
                message: '所有郵件模板已重置為預設文字樣式'
            });
        }
    } catch (error) {
        console.error('重置郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '重置郵件模板失敗：' + error.message
        });
    }
});

// ==================== 自動郵件發送功能 ====================

// 從數據庫讀取模板並替換變數（通用函數）
async function generateEmailFromTemplate(templateKey, booking, bankInfo = null, additionalData = {}) {
    try {
        // 從數據庫讀取模板
        const template = await db.getEmailTemplateByKey(templateKey);
        if (!template) {
            throw new Error(`找不到郵件模板: ${templateKey}`);
        }
        if (!template.is_enabled) {
            throw new Error(`郵件模板 ${templateKey} 未啟用`);
        }
        
        // 使用現有的 replaceTemplateVariables 函數處理
        return await replaceTemplateVariables(template, booking, bankInfo, additionalData);
    } catch (error) {
        console.error(`生成郵件失敗 (${templateKey}):`, error);
        throw error;
    }
}

// 替換郵件模板中的變數
async function replaceTemplateVariables(template, booking, bankInfo = null, additionalData = {}) {
    let content = template.content;
    
    // 確保模板包含完整的 HTML 結構和 CSS 樣式
    // 檢查是否包含完整的 HTML 結構
    const hasFullHtmlStructure = content.includes('<!DOCTYPE html>') || 
                                 (content.includes('<html') && content.includes('</html>'));
    
    // 檢查是否包含必要的 CSS 樣式（特別是 .header 樣式）
    // 更嚴格的檢查：必須有 .header 樣式定義，且包含 background 或 background-color
    const hasHeaderStyle = content.includes('.header') && 
                           (content.includes('background') || content.includes('background-color')) &&
                           content.includes('.content') &&
                           content.includes('.container');
    
    // 檢查是否包含 <style> 標籤
    const hasStyleTag = content.includes('<style>') || content.includes('<style ');
    
    // 檢查樣式是否完整（必須包含所有必要的 CSS 類別）
    const hasCompleteStyles = hasStyleTag && 
                             content.includes('.header') &&
                             content.includes('.content') &&
                             content.includes('.container') &&
                             (content.match(/\.header\s*\{[\s\S]*?\}/i) || content.includes('.header {'));
    
    // 檢查是否有完整的 HTML 結構元素
    const hasContainer = content.includes('class="container') || content.includes("class='container");
    const hasHeader = content.includes('class="header') || content.includes("class='header");
    const hasContent = content.includes('class="content') || content.includes("class='content");
    
    // 如果缺少完整結構或樣式，自動修復
    if (!hasFullHtmlStructure || !hasHeaderStyle || !hasStyleTag || !hasCompleteStyles || 
        !hasContainer || !hasHeader || !hasContent) {
        console.log('⚠️ 郵件模板缺少基本 HTML 結構或樣式，自動修復中...', {
            templateKey: template.key || template.template_key,
            hasFullHtmlStructure,
            hasStyleTag,
            contentLength: content.length
        });
        
        // 基本文字樣式
        const basicStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        h2 { color: #333; font-size: 20px; margin-top: 25px; margin-bottom: 15px; }
        h3 { color: #333; font-size: 18px; margin-top: 20px; margin-bottom: 10px; }
        p { margin: 10px 0; }
        strong { color: #333; }
        ul, ol { margin: 10px 0; padding-left: 30px; }
        li { margin: 5px 0; }
    `;
        
        // 如果沒有完整的 HTML 結構，包裝現有內容
        if (!hasFullHtmlStructure) {
            // 提取實際內容
            let bodyContent = content;
            if (content.includes('<body>')) {
                const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch && bodyMatch[1]) {
                    bodyContent = bodyMatch[1];
                }
            }
            
            content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${basicStyle}</style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
        } else if (!hasStyleTag) {
            // 如果有 HTML 結構但缺少樣式標籤，添加基本樣式
            if (content.includes('<head>')) {
                content = content.replace(
                    /<head[^>]*>/i,
                    `<head>
    <meta charset="UTF-8">
    <style>${basicStyle}</style>`
                );
            } else {
                content = content.replace(
                    /<html[^>]*>/i,
                    `<html>
<head>
    <meta charset="UTF-8">
    <style>${basicStyle}</style>
</head>`
                );
            }
        }
        
        console.log('✅ 郵件模板已自動修復，添加基本的 HTML 結構和樣式');
    }
    
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
    
    // 計算住宿天數
    const msPerDay = 1000 * 60 * 60 * 24;
    const nights = Math.max(1, Math.round((new Date(booking.check_out_date) - new Date(booking.check_in_date)) / msPerDay));
    
    // 計算訂房編號後5碼
    const bookingIdLast5 = booking.booking_id ? booking.booking_id.slice(-5) : '';
    
    // 判斷是否為匯款轉帳
    const isTransfer = booking.payment_method === '匯款轉帳' || booking.payment_method === 'transfer';
    
    // 格式化日期時間
    const bookingDate = booking.created_at ? new Date(booking.created_at).toLocaleDateString('zh-TW') : '';
    const bookingDateTime = booking.created_at ? new Date(booking.created_at).toLocaleString('zh-TW') : '';
    
    // 格式化價格
    const pricePerNight = booking.price_per_night || 0;
    
    const variables = {
        '{{guestName}}': booking.guest_name || '',
        '{{bookingId}}': booking.booking_id || '',
        '{{bookingIdLast5}}': bookingIdLast5,
        '{{checkInDate}}': checkInDate,
        '{{checkOutDate}}': checkOutDate,
        '{{roomType}}': booking.room_type || '',
        '{{nights}}': nights.toString(),
        '{{pricePerNight}}': pricePerNight.toLocaleString(),
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
        '{{addonsTotal}}': addonsTotal.toLocaleString(),
        '{{paymentMethod}}': booking.payment_method || '',
        '{{paymentAmount}}': booking.payment_amount || '',
        '{{guestPhone}}': booking.guest_phone || '',
        '{{guestEmail}}': booking.guest_email || '',
        '{{bookingDate}}': bookingDate,
        '{{bookingDateTime}}': bookingDateTime,
        ...additionalData // 合併額外的變數
    };
    
    Object.keys(variables).forEach(key => {
        content = content.replace(new RegExp(key, 'g'), variables[key]);
    });
    
    // 處理嵌套條件區塊的輔助函數
    function processConditionalBlock(content, condition, conditionName) {
        // 處理帶有 {{else}} 的條件區塊：{{#if condition}}...{{else}}...{{/if}}
        const elsePattern = new RegExp(`\\{\\{#if ${conditionName}\\}\\}([\\s\\S]*?)\\{\\{else\\}\\}([\\s\\S]*?)\\{\\{/if\\}\\}`, 'g');
        if (condition) {
            // 條件為真：保留 {{#if}} 到 {{else}} 之間的內容，移除 {{else}} 到 {{/if}} 之間的內容
            content = content.replace(elsePattern, '$1');
        } else {
            // 條件為假：移除 {{#if}} 到 {{else}} 之間的內容，保留 {{else}} 到 {{/if}} 之間的內容
            content = content.replace(elsePattern, '$2');
        }
        
        // 處理沒有 {{else}} 的條件區塊：{{#if condition}}...{{/if}}
        const simplePattern = new RegExp(`\\{\\{#if ${conditionName}\\}\\}([\\s\\S]*?)\\{\\{/if\\}\\}`, 'g');
        if (condition) {
            // 條件為真：保留內容
            content = content.replace(simplePattern, '$1');
        } else {
            // 條件為假：移除整個區塊
            content = content.replace(simplePattern, '');
        }
        
        return content;
    }
    
    // 按順序處理條件區塊（從內到外，確保嵌套條件先被處理）
    // 1. 先處理最內層的嵌套條件（bankName, accountName）
    if (bankInfo && bankInfo.bankName) {
        content = content.replace(/\{\{#if bankName\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        content = content.replace(/\{\{#if bankName\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }
    
    if (bankInfo && bankInfo.accountName) {
        content = content.replace(/\{\{#if accountName\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        content = content.replace(/\{\{#if accountName\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }
    
    // 2. 處理中間層條件（addonsList, bankInfo）
    const hasAddons = addonsList && addonsList.trim() !== '';
    content = processConditionalBlock(content, hasAddons, 'addonsList');
    
    const hasBankInfo = bankInfo && bankInfo.account;
    content = processConditionalBlock(content, hasBankInfo, 'bankInfo');
    
    // 3. 處理外層條件（isDeposit, isTransfer）
    content = processConditionalBlock(content, isDeposit, 'isDeposit');
    content = processConditionalBlock(content, isTransfer, 'isTransfer');
    
    // 4. 最後清理：移除所有殘留的條件標籤（防止遺漏）
    // 這是最後一道防線，確保所有條件標籤都被移除
    // 使用更全面的正則表達式來匹配所有可能的條件標籤格式
    let maxCleanupIterations = 50; // 增加迭代次數以處理複雜的嵌套
    let cleanupIteration = 0;
    let lastCleanupContent = '';
    
    while (cleanupIteration < maxCleanupIterations) {
        lastCleanupContent = content;
        
        // 移除所有 {{#if ...}} 標籤（匹配任何條件名稱，包括有或沒有空白字符）
        // 使用更全面的正則表達式，匹配 {{#if condition}} 或 {{#if condition }} 等格式
        content = content.replace(/\{\{#if\s+[^}]+\}\}/gi, '');
        // 移除所有 {{/if}} 標籤（不區分大小寫）
        content = content.replace(/\{\{\/if\}\}/gi, '');
        // 移除所有 {{else}} 標籤（不區分大小寫）
        content = content.replace(/\{\{else\}\}/gi, '');
        // 額外清理：移除任何殘留的 {{#if}} 格式（即使沒有條件名稱）
        content = content.replace(/\{\{#if\}\}/gi, '');
        
        // 如果沒有變化，跳出循環
        if (content === lastCleanupContent) {
            break;
        }
        cleanupIteration++;
    }
    
    // 再次替換所有變數（確保條件區塊處理後剩餘的變數也被替換）
    // 這很重要，因為條件區塊處理可能會移除一些變數，需要再次替換
    Object.keys(variables).forEach(key => {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedKey, 'g');
        content = content.replace(regex, variables[key]);
    });
    
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
        
        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
        
        for (const booking of bookings) {
            try {
                const { subject, content } = await replaceTemplateVariables(template, booking, bankInfo);
                
                const mailOptions = {
                    from: emailUser,
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                };
                
                let emailSent = false;
                
                // 使用統一函數發送郵件（自動選擇 Resend 或 Gmail）
                try {
                    await sendEmail(mailOptions);
                    console.log(`✅ 已發送匯款提醒給 ${booking.guest_name} (${booking.booking_id})`);
                    emailSent = true;
                } catch (emailError) {
                    console.error(`❌ 發送匯款提醒失敗 (${booking.booking_id}):`, emailError.message);
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
        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
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
                        // 使用數據庫模板發送取消通知郵件
                        let mailOptions = null;
                        try {
                            const { subject, content } = await generateEmailFromTemplate('cancel_notification', booking);
                            mailOptions = {
                                from: emailUser,
                                to: booking.guest_email,
                                subject: subject,
                                html: content
                            };
                        } catch (templateError) {
                            console.error('⚠️ 無法從數據庫讀取取消通知模板，使用備用方案:', templateError.message);
                            // 備用方案：使用原來的函數
                            const cancellationEmail = await generateCancellationEmail(booking);
                            mailOptions = {
                                from: emailUser,
                                to: booking.guest_email,
                                subject: '【訂房取消通知】您的訂房已自動取消',
                                html: cancellationEmail
                            };
                        }
                        
                        let emailSent = false;
                        
                        // 使用統一函數發送郵件（自動選擇 Resend 或 Gmail）
                        try {
                            await sendEmail(mailOptions);
                            console.log(`✅ 已發送取消通知給 ${booking.guest_name} (${booking.booking_id})`);
                            emailSent = true;
                            emailSentCount++;
                        } catch (emailError) {
                            console.error(`❌ 發送取消通知失敗 (${booking.booking_id}):`, emailError.message);
                            emailFailedCount++;
                        }

                        // 只有成功發送才更新郵件狀態（追加「取消信」）
                        if (emailSent) {
                            try {
                                await db.updateEmailStatus(booking.booking_id, 'cancel_notification', true);
                            } catch (updateError) {
                                console.error(`❌ 更新取消信郵件狀態失敗 (${booking.booking_id}):`, updateError.message);
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
        
        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
        
        for (const booking of bookings) {
            try {
                const { subject, content } = await replaceTemplateVariables(template, booking);
                
                const mailOptions = {
                    from: emailUser,
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                };
                
                let emailSent = false;
                
                // 使用統一函數發送郵件（自動選擇 Resend 或 Gmail）
                try {
                    await sendEmail(mailOptions);
                    console.log(`✅ 已發送入住提醒給 ${booking.guest_name} (${booking.booking_id})`);
                    emailSent = true;
                } catch (emailError) {
                    console.error(`❌ 發送入住提醒失敗 (${booking.booking_id}):`, emailError.message);
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
        
        const emailUser = await db.getSetting('email_user') || process.env.EMAIL_USER || 'cheng701107@gmail.com';
        
        for (const booking of bookings) {
            try {
                const { subject, content } = await replaceTemplateVariables(template, booking);
                
                const mailOptions = {
                    from: emailUser,
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                };
                
                let emailSent = false;
                
                // 使用統一函數發送郵件（自動選擇 Resend 或 Gmail）
                try {
                    await sendEmail(mailOptions);
                    console.log(`✅ 已發送回訪信給 ${booking.guest_name} (${booking.booking_id})`);
                    emailSent = true;
                } catch (emailError) {
                    console.error(`❌ 發送回訪信失敗 (${booking.booking_id}):`, emailError.message);
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
        console.log('📋 開始啟動伺服器...');
        console.log('📋 環境變數檢查:', {
            PORT: process.env.PORT || '未設定（將使用 3000）',
            NODE_ENV: process.env.NODE_ENV || '未設定',
            DATABASE_URL: process.env.DATABASE_URL ? '已設定' : '未設定',
            RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || '未設定'
        });
        
        // 初始化資料庫
        console.log('💾 初始化資料庫...');
        await db.initDatabase();
        console.log('✅ 資料庫初始化完成');
        
        // 初始化郵件服務（優先使用資料庫設定）
        console.log('📧 初始化郵件服務...');
        await initEmailService();
        console.log('✅ 郵件服務初始化完成');
        
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
startServer().catch((error) => {
    console.error('❌ 應用程式啟動失敗:', error);
    console.error('錯誤堆疊:', error.stack);
    process.exit(1);
});

// 處理未捕獲的錯誤
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未處理的 Promise 拒絕:', reason);
    console.error('Promise:', promise);
    console.error('錯誤堆疊:', reason?.stack);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未捕獲的異常:', error);
    console.error('錯誤堆疊:', error.stack);
    process.exit(1);
});

