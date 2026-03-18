// Railway 啟動日誌：確保最早輸出，方便排查 Deploy Logs 空白問題
console.log('🔄 [Railway] Node.js 進程已啟動，載入模組中...');

// 全域錯誤處理（記錄錯誤但不立即退出，避免反覆崩潰）
process.on('uncaughtException', (err) => {
    console.error('❌ 未捕獲的異常:', err.message);
    console.error(err.stack);
    // 不立即退出，讓 Railway 保持運行
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未處理的 Promise 拒絕:', reason);
    // 不立即退出，讓 Railway 保持運行
});

// 載入環境變數（從 .env 檔案）
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const db = require('./database');
const payment = require('./src/payments/ecpay.client');
const cron = require('node-cron');
const backup = require('./backup');
const csrf = require('csrf');
const lineBot = require('./line-bot');
const multer = require('multer');
const storage = require('./storage');
const dataProtection = require('./data-protection');
const { createApp } = require('./src/app');
const requestIdMiddleware = require('./src/middlewares/requestId');
const { logPaymentEvent } = require('./src/lib/logger');
const { calculateDynamicPaymentDeadline, formatPaymentDeadline } = require('./src/lib/payment-deadline');
const { requireAuth, validateAdminSession } = require('./src/middlewares/auth');
const { createCheckPermission } = require('./src/middlewares/permission');
const { createPaymentService } = require('./src/services/payment.service');
const { createPaymentController } = require('./src/controllers/payment.controller');
const { createPaymentRoutes } = require('./src/routes/payment.routes');
const { createEmailDeliveryService } = require('./src/services/email-delivery.service');
const { createEmailConfigService } = require('./src/services/email-config.service');
const { createHotelConfigService } = require('./src/services/hotel-config.service');
const { createBookingService } = require('./src/services/booking.service');
const { createOrderQueryService } = require('./src/services/orderQuery.service');
const { createEmailService } = require('./src/services/email.service');
const { createTemplateService } = require('./src/services/template.service');
const { createNotificationService } = require('./src/services/notification.service');
const { createEmailFallbackTemplatesService } = require('./src/services/email-fallback-templates.service');
const { createBookingNotificationJobs } = require('./src/jobs/booking-notification.jobs');
const { createAdminLogCleanupJobs } = require('./src/jobs/admin-log-cleanup.jobs');
const { registerScheduledJobs } = require('./src/jobs/scheduler');
const { startServer } = require('./src/bootstrap/start-server');
const { initEmailService: initEmailServiceBootstrap } = require('./src/bootstrap/email-init');
const { loadResendProvider } = require('./src/bootstrap/email-provider-loader');
const { createEmailRuntime, resetEmailRuntime, getConfiguredSenderEmail } = require('./src/bootstrap/email-runtime');
const { createBookingRoutes } = require('./src/routes/booking.routes');
const { createOrderQueryRoutes } = require('./src/routes/order-query.routes');

// 本地 uploads 目錄（當未設定 R2 時作為回退儲存）
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!storage.isCloudStorage) {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log('✅ uploads 目錄已建立');
    }
}

const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 最大 5MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('僅支援 JPG、PNG、WebP、GIF、ICO 格式的圖片'));
        }
    }
});

const Resend = loadResendProvider();
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

const app = createApp();
const PORT = process.env.PORT || 3000;
const checkPermission = createCheckPermission(db);

// Railway 使用代理，需要信任代理以正確處理 HTTPS 和 Cookie
app.set('trust proxy', 1);

// 健康檢查端點（放在 session middleware 之前，避免被 session 錯誤影響）
app.get('/health', async (req, res) => {
    const health = { status: 'ok', timestamp: new Date().toISOString() };
    try {
        const roomTypes = await db.getAllRoomTypesAdmin();
        health.database = 'connected';
        health.roomTypeCount = roomTypes ? roomTypes.length : 0;
        if (roomTypes && roomTypes.length > 0) {
            health.columns = Object.keys(roomTypes[0]);
        }
    } catch (dbErr) {
        health.database = 'error';
        health.dbError = dbErr.message;
    }
    res.status(200).json(health);
});

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
const sessionSecret = (process.env.SESSION_SECRET || '').trim();
console.log('   SESSION_SECRET:', sessionSecret ? '已設定' : '❌ 未設定');
console.log('   useSecureCookie:', useSecureCookie);
console.log('   isRailway:', isRailway);

// 檢查 SESSION_SECRET 是否設定
if (!sessionSecret) {
    throw new Error('缺少必要環境變數 SESSION_SECRET。為了安全性，系統已禁止使用硬編碼預設值啟動。');
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
    secret: sessionSecret,
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
    },
    (req) => {
        if (req.body.extra_bed_price !== undefined) {
            return validateNumberRange(req.body.extra_bed_price, 0, 1000000, '加床費用');
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
    },
    (req) => {
        if (req.method === 'POST' || req.method === 'PUT') {
            const rawUnit = String(req.body.unit_label || '人').trim();
            if (!rawUnit) {
                return { valid: false, message: '單位不可為空' };
            }
            if (rawUnit.length > 10) {
                return { valid: false, message: '單位長度不可超過 10 個字' };
            }
            req.body.unit_label = rawUnit;
        }
        return { valid: true };
    },
    (req) => {
        if (req.method === 'POST' || req.method === 'PUT') {
            const summary = String(req.body.summary || '').trim();
            const details = String(req.body.details || '').trim();
            const terms = String(req.body.terms || '').trim();
            if (summary.length > 120) {
                return { valid: false, message: '摘要長度不可超過 120 個字' };
            }
            if (details.length > 3000) {
                return { valid: false, message: '詳細說明長度不可超過 3000 個字' };
            }
            if (terms.length > 3000) {
                return { valid: false, message: '注意事項長度不可超過 3000 個字' };
            }
            req.body.summary = summary;
            req.body.details = details;
            req.body.terms = terms;
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
            
            if (isEmailTemplateRequest) {
                // 郵件模板的 content 欄位是 HTML 內容，跳過 SQL Injection 檢測
                // blockSettings 和 block_settings 也包含 HTML 內容，需要跳過檢測
                // 但仍需要清理其他欄位
                const { content, blockSettings, block_settings, ...rest } = req.body;
                // 統一使用 blockSettings（如果 block_settings 存在，優先使用它）
                const finalBlockSettings = blockSettings || block_settings;
                
                req.body = {
                    ...sanitizeObject(rest, {
                        checkSQLInjection: true,
                        checkXSS: true,
                        excludeFields: ['content', 'blockSettings', 'block_settings'] // 排除這些欄位，避免遞迴檢查
                    }),
                    ...(content ? { content: content } : {}), // 保留原始 HTML 內容，不進行任何檢測或清理
                    ...(finalBlockSettings ? { blockSettings: finalBlockSettings } : {}) // 保留 blockSettings（包含 HTML），不進行檢測
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
            
            // 對入住提醒郵件內容設定的 value 欄位進行特殊處理（HTML 內容，跳過 SQL Injection 檢測）
            // 這些設定包含 HTML 格式的內容，需要允許 HTML 標籤
            const isCheckinReminderSettingsRequest = req.path && 
                req.path.includes('/api/admin/settings/checkin_reminder_');
            
            if (isCheckinReminderSettingsRequest && req.body.value) {
                // 入住提醒郵件內容設定的 value 欄位是 HTML 內容，跳過 SQL Injection 和 XSS 檢測
                // 但仍需要清理其他欄位
                const { value, ...rest } = req.body;
                req.body = {
                    ...sanitizeObject(rest, {
                        checkSQLInjection: true,
                        checkXSS: true
                    }),
                    value: value // 保留原始 HTML 內容，不進行任何檢測或清理
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
            
            // 銷售頁設定的 value 欄位可能包含 URL（如 Google Maps 嵌入網址），跳過 SQL Injection 檢測
            const isLandingSettingsRequest = req.path && 
                req.path.includes('/api/admin/settings/landing_');
            
            if (isLandingSettingsRequest && req.body.value) {
                const { value, ...rest } = req.body;
                req.body = {
                    ...sanitizeObject(rest, {
                        checkSQLInjection: true,
                        checkXSS: true
                    }),
                    value: value
                };
                if (req.query) {
                    req.query = sanitizeObject(req.query, { checkSQLInjection: true, checkXSS: true });
                }
                if (req.params) {
                    req.params = sanitizeObject(req.params, { checkSQLInjection: true, checkXSS: true });
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

app.use(requestIdMiddleware);

// 應用通用輸入清理中間件（在所有路由之前）
app.use(sanitizeInput);

// 注意：API 路由必須在靜態檔案服務之前定義
// app.use(express.static(__dirname)); // 移到最後

// 郵件設定（請根據您的需求修改）
// 這裡使用 Gmail 作為範例，您也可以使用其他郵件服務
// 優先使用資料庫設定，其次使用環境變數

const emailRuntime = createEmailRuntime();
const hotelConfigService = createHotelConfigService({ db });
const getHotelSettingsWithFallback = hotelConfigService.getHotelSettingsWithFallback;

const emailDeliveryService = createEmailDeliveryService({
    db,
    Resend,
    getHotelSettingsWithFallback,
    emailRuntime
});

const sendEmail = async (mailOptions) => emailDeliveryService.sendEmail(mailOptions);
const emailConfigService = createEmailConfigService({
    db,
    processEnv: process.env
});
const getRequiredEmailUser = emailConfigService.getRequiredEmailUser;

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
async function handleCreateBooking(req, res) {
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
            children,
            promoCode, // 優惠代碼（選填）
            bookingNoticeAgreed,
            bookingTermsAgreed,
            specialRequest
        } = req.body;

        // 驗證必填欄位
        if (!checkInDate || !checkOutDate || !roomType || !guestName || !guestPhone || !guestEmail) {
            return res.status(400).json({ message: '請填寫所有必填欄位' });
        }

        // 驗證訂房須知同意（由後台設定控制）
        try {
            const [noticeEnabledSetting, noticeRequireSetting] = await Promise.all([
                db.getSetting('booking_notice_enabled'),
                db.getSetting('booking_notice_require_agreement')
            ]);
            const noticeEnabled = noticeEnabledSetting === null || noticeEnabledSetting === undefined || noticeEnabledSetting === ''
                ? true
                : ['1', 'true', 'yes', 'on'].includes(String(noticeEnabledSetting).trim().toLowerCase());
            const noticeRequireAgreement = noticeRequireSetting === null || noticeRequireSetting === undefined || noticeRequireSetting === ''
                ? true
                : ['1', 'true', 'yes', 'on'].includes(String(noticeRequireSetting).trim().toLowerCase());
            const agreed = ['1', 'true', 'yes', 'on'].includes(String(bookingNoticeAgreed).trim().toLowerCase());
            if (noticeEnabled && noticeRequireAgreement && !agreed) {
                return res.status(400).json({ message: '送出訂房前，請先勾選同意訂房須知與取消政策' });
            }
        } catch (noticeError) {
            console.warn('訂房須知同意檢查失敗，沿用前端驗證:', noticeError.message);
        }

        // 驗證使用條款與隱私政策同意（顯示同意區塊時固定必填）
        try {
            const termsEnabledSetting = await db.getSetting('booking_terms_enabled');
            const termsEnabled = termsEnabledSetting === null || termsEnabledSetting === undefined || termsEnabledSetting === ''
                ? true
                : ['1', 'true', 'yes', 'on'].includes(String(termsEnabledSetting).trim().toLowerCase());
            const termsAgreed = ['1', 'true', 'yes', 'on'].includes(String(bookingTermsAgreed).trim().toLowerCase());
            if (termsEnabled && !termsAgreed) {
                return res.status(400).json({ message: '送出訂房前，請先勾選同意使用條款與隱私政策' });
            }
        } catch (termsError) {
            console.warn('使用條款同意檢查失敗，沿用前端驗證:', termsError.message);
        }

        // 驗證：如果入住日期是今天，不允許選擇匯款
        if (paymentMethod === 'transfer') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const checkIn = new Date(checkInDate);
            checkIn.setHours(0, 0, 0, 0);
            
            if (checkIn.getTime() === today.getTime()) {
                return res.status(400).json({ 
                    message: '入住日期為今天時，無法選擇匯款轉帳，請選擇線上刷卡' 
                });
            }
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
                    const displayName = addon.display_name || (addonInfo ? addonInfo.display_name : addon.name);
                    const quantity = addon.quantity || 1;
                    const itemTotal = addon.price * quantity;
                    const unitLabel = (addon.unit_label || addonInfo?.unit_label || '人').trim();
                    return `${displayName} x${quantity} (每${unitLabel}, NT$ ${itemTotal.toLocaleString()})`;
                }).join('、');
            } catch (err) {
                console.error('取得加購商品資訊失敗:', err);
                // 如果查詢失敗，使用原始名稱
                addonsList = addons.map(addon => {
                    const displayName = addon.display_name || addon.name;
                    const quantity = addon.quantity || 1;
                    const itemTotal = addon.price * quantity;
                    const unitLabel = String(addon.unit_label || '人').trim();
                    return `${displayName} x${quantity} (每${unitLabel}, NT$ ${itemTotal.toLocaleString()})`;
                }).join('、');
            }
        }
        
        const normalizedSpecialRequest = String(specialRequest || '').trim().slice(0, 300);

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
            addonsList: addonsList, // 加購商品顯示字串（用於郵件）
            specialRequest: normalizedSpecialRequest
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
            const { deadline: deadlineDate, actualDaysReserved } = calculateDynamicPaymentDeadline(bookingData.bookingDate, checkInDate, daysReserved);
            bookingData.daysReserved = actualDaysReserved; // 使用實際計算的保留天數（用於郵件顯示）
            bookingData.originalDaysReserved = daysReserved; // 保留原始設定值（用於其他邏輯）
            bookingData.paymentDeadline = deadlineDate.toISOString(); // 儲存 ISO 格式
            bookingData.checkInDate = checkInDate; // 儲存入住日期（用於匯款提醒判斷）
            console.log('📅 匯款保留天數:', actualDaysReserved, '(原始設定:', daysReserved, ')', '到期日期:', formatPaymentDeadline(deadlineDate));
            console.log('💰 匯款資訊:', JSON.stringify(bankInfo, null, 2));
        }
        
        // 確保 bankInfo 被加入到 bookingData（即使不是匯款轉帳）
        bookingData.bankInfo = bankInfo;
        
        // 計算折扣金額和折後總額（在發送郵件之前）
        let discountAmount = 0;
        let memberDiscountAmount = 0;
        let memberDiscountPercent = 0;
        let memberLevelName = null;
        let earlyBirdDiscountAmount = 0;
        let earlyBirdRule = null;
        let discountedTotal = totalAmount;

        // 0. 計算會員等級折扣（依歷史「已付款且有效」訂房）
        try {
            const paidActiveStats = await db.getPaidActiveCustomerStatsByEmail(guestEmail);
            const memberLevel = await db.calculateCustomerLevel(
                paidActiveStats.total_spent || 0,
                paidActiveStats.booking_count || 0
            );
            memberDiscountPercent = parseFloat(memberLevel?.discount_percent || 0);
            memberLevelName = memberLevel?.level_name || null;
            if (memberDiscountPercent > 0) {
                memberDiscountAmount = Math.round(totalAmount * (memberDiscountPercent / 100));
                console.log(`👑 會員折扣已套用: ${memberLevelName}, 折扣=${memberDiscountAmount} (${memberDiscountPercent}%)`);
            }
        } catch (memberError) {
            console.warn('⚠️  計算會員折扣失敗:', memberError.message);
        }
        
        // 1. 先計算早鳥優惠折扣（自動套用）
        try {
            const earlyBirdResult = await db.calculateEarlyBirdDiscount(checkInDate, roomType, totalAmount);
            if (earlyBirdResult.applicable) {
                earlyBirdDiscountAmount = earlyBirdResult.discount_amount;
                earlyBirdRule = earlyBirdResult.rule;
                console.log(`🐦 早鳥優惠已套用: ${earlyBirdRule.name}, 折扣=${earlyBirdDiscountAmount}`);
            }
        } catch (earlyBirdError) {
            console.warn('⚠️  計算早鳥優惠失敗:', earlyBirdError.message);
        }
        
        // 2. 計算優惠代碼折扣
        let promoDiscountAmount = 0;
        if (promoCode) {
            try {
                const promoCodeData = await db.getPromoCodeByCode(promoCode);
                if (promoCodeData) {
                    // 檢查是否可以與早鳥優惠疊加
                    const canCombine = promoCodeData.can_combine_with_early_bird === 1;
                    
                    if (earlyBirdDiscountAmount > 0 && !canCombine) {
                        // 不能疊加時，取較大的折扣
                        let promoCalc = 0;
                        if (promoCodeData.discount_type === 'fixed') {
                            promoCalc = promoCodeData.discount_value;
                        } else if (promoCodeData.discount_type === 'percent') {
                            promoCalc = totalAmount * (promoCodeData.discount_value / 100);
                            if (promoCodeData.max_discount && promoCalc > promoCodeData.max_discount) {
                                promoCalc = promoCodeData.max_discount;
                            }
                        }
                        
                        if (promoCalc > earlyBirdDiscountAmount) {
                            // 優惠代碼折扣更大，使用優惠代碼
                            promoDiscountAmount = promoCalc;
                            earlyBirdDiscountAmount = 0;
                            earlyBirdRule = null;
                            console.log('💰 優惠代碼折扣更大，使用優惠代碼');
                        } else {
                            console.log('🐦 早鳥優惠折扣更大，保留早鳥優惠');
                        }
                    } else {
                        // 可以疊加或沒有早鳥優惠
                        if (promoCodeData.discount_type === 'fixed') {
                            promoDiscountAmount = promoCodeData.discount_value;
                        } else if (promoCodeData.discount_type === 'percent') {
                            promoDiscountAmount = totalAmount * (promoCodeData.discount_value / 100);
                            if (promoCodeData.max_discount && promoDiscountAmount > promoCodeData.max_discount) {
                                promoDiscountAmount = promoCodeData.max_discount;
                            }
                        }
                    }
                }
            } catch (promoError) {
                console.warn('⚠️  計算優惠代碼折扣失敗:', promoError.message);
            }
        }
        
        // 3. 合計折扣
        discountAmount = Math.round(memberDiscountAmount + earlyBirdDiscountAmount + promoDiscountAmount);
        discountedTotal = Math.max(0, totalAmount - discountAmount);
        const paymentRate = paymentAmount === 'deposit' ? (depositPercentage / 100) : 1;
        bookingData.finalAmount = Math.round(discountedTotal * paymentRate);
        
        // 將折扣資訊加入到 bookingData（用於郵件模板）
        bookingData.discountAmount = discountAmount;
        bookingData.discountedTotal = discountedTotal;
        bookingData.originalAmount = totalAmount; // 原始總金額（用於計算折後總額）
        bookingData.memberDiscount = memberDiscountAmount;
        bookingData.memberDiscountPercent = memberDiscountPercent;
        bookingData.memberLevelName = memberLevelName;
        bookingData.earlyBirdDiscount = earlyBirdDiscountAmount;
        bookingData.earlyBirdRule = earlyBirdRule;
        bookingData.promoDiscount = promoDiscountAmount;
        bookingData.promoCode = promoCode || null; // 優惠代碼字串（用於折扣說明）

        // 發送郵件
        let emailSent = false;
        let emailErrorMsg = '';
        
        // 只有匯款轉帳才在建立訂房時發送確認郵件給客戶
        // 線上刷卡要等付款完成後才發送確認郵件
        if (paymentMethod === 'transfer') {
            try {
                console.log('📧 準備發送訂房通知（匯款轉帳）');
                const sendResult = await notificationService.sendTransferBookingCreatedNotifications({
                    bookingData,
                    guestEmail,
                    guestName,
                    bankInfo
                });
                emailSent = !!sendResult.customerEmailSent;
                emailErrorMsg = sendResult.customerEmailError || '';
        } catch (emailError) {
            emailErrorMsg = emailError.message || '未知錯誤';
                console.error('❌ 匯款轉帳通知發送失敗:', emailErrorMsg);
            }
        } else {
            console.log('📧 線上刷卡：確認郵件將於付款完成後發送');
            console.log('📧 線上刷卡：管理員通知郵件將於付款完成後發送');
        }

        // 發送 LINE 訊息（如果有提供 LINE User ID 且付款方式為匯款轉帳）
        // 線上刷卡會在付款成功後才發送 LINE 訊息
        const lineUserId = req.body.lineUserId || req.query.lineUserId;
        if (lineUserId && paymentMethod === 'transfer') {
            try {
                // 確保 LINE Bot 設定是最新的（從資料庫重新載入）
                await lineBot.loadSettings();
                
                console.log('📱 發送 LINE 訂房成功訊息（匯款轉帳）...');
                const lineResult = await lineBot.sendBookingSuccessMessage(lineUserId, {
                    bookingId: bookingData.bookingId,
                    guestName: bookingData.guestName,
                    checkInDate: bookingData.checkInDate,
                    checkOutDate: bookingData.checkOutDate,
                    roomType: bookingData.roomType,
                    totalAmount: totalAmount,
                    discountAmount: discountAmount,
                    discountedTotal: discountedTotal,
                    finalAmount: bookingData.finalAmount,
                    isPaid: false // 匯款轉帳尚未付款
                });
                
                if (lineResult.success) {
                    console.log('✅ LINE 訊息發送成功');
                } else {
                    console.warn('⚠️ LINE 訊息發送失敗:', lineResult.error);
                }
            } catch (lineError) {
                console.error('❌ LINE 訊息發送錯誤:', lineError.message);
                // LINE 訊息失敗不影響訂房流程
            }
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
                addonsTotal: bookingData.addonsTotal || 0,
                lineUserId: lineUserId || null
            });
            
            console.log('✅ 訂房資料已成功儲存到資料庫 (ID:', savedId, ')');
            
            // 如果郵件發送狀態改變，更新資料庫（匯款轉帳發送確認信）
            if (emailSent && paymentMethod === 'transfer') {
                await db.updateEmailStatus(bookingData.bookingId, 'booking_confirmation');
            }
            
            // 記錄優惠代碼使用（如果有使用）
            if (promoCode) {
                try {
                    const promoCodeData = await db.getPromoCodeByCode(promoCode);
                    if (promoCodeData) {
                        await db.recordPromoCodeUsage(
                            promoCodeData.id,
                            bookingData.bookingId,
                            guestEmail,
                            Math.round(promoDiscountAmount),
                            totalAmount,
                            bookingData.finalAmount
                        );
                        console.log('✅ 優惠代碼使用記錄已儲存:', promoCode);
                    }
                } catch (promoError) {
                    console.warn('⚠️  記錄優惠代碼使用失敗:', promoError.message);
                    // 不影響訂房流程，只記錄警告
                }
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
                const ecpayConfig = await paymentService.getEcpayConfigFromSettings(['MerchantID', 'HashKey', 'HashIV']);
                const isProduction = ecpayConfig.isProduction;
                const ecpayMerchantID = ecpayConfig.MerchantID;
                const ecpayHashKey = ecpayConfig.HashKey;
                const ecpayHashIV = ecpayConfig.HashIV;

                console.log('🌍 當前環境:', isProduction ? '正式環境 (Production)' : '測試環境 (Test)');
                console.log(isProduction ? '💰 使用正式環境設定' : '🧪 使用測試環境設定');
                if (isProduction && ecpayMerchantID === '2000132') {
                        console.warn('⚠️  警告：正式環境仍在使用測試環境的 MerchantID！');
                        console.warn('   請在系統設定中設定綠界支付參數，或設定 ECPAY_MERCHANT_ID_PROD 環境變數');
                }
                
                console.log('📋 綠界設定:', {
                    MerchantID: ecpayMerchantID ? ecpayMerchantID.substring(0, 4) + '****' : '未設定',
                    HashKey: ecpayHashKey ? '已設定' : '未設定',
                    HashIV: ecpayHashIV ? '已設定' : '未設定'
                });
                
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
}

// LINE Webhook 端點（接收 LINE 官方帳號的事件）
app.post('/api/line/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-line-signature'];
        if (!signature) {
            console.warn('⚠️ LINE Webhook 請求缺少簽章');
            return res.status(401).json({ error: 'Missing signature' });
        }

        // 驗證簽章（req.body 是 Buffer）
        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
        if (!lineBot.verifySignature(signature, bodyBuffer)) {
            console.warn('⚠️ LINE Webhook 簽章驗證失敗');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const events = JSON.parse(bodyBuffer.toString()).events || [];
        
        for (const event of events) {
            // 處理文字訊息事件
            if (event.type === 'message' && event.message.type === 'text') {
                const userId = event.source.userId;
                const messageText = event.message.text;
                
                console.log('📱 收到 LINE 訊息:', {
                    userId: userId?.substring(0, 10) + '...',
                    text: messageText
                });

                // 可以在此處加入自動回覆邏輯
                // 例如：當用戶輸入「訂房」時，回覆訂房連結
                if (messageText.includes('訂房') || messageText.includes('預訂')) {
                    const liffUrl = process.env.LINE_LIFF_URL || 'https://your-domain.com';
                    await lineBot.sendTextMessage(userId, `歡迎使用訂房系統！\n\n請點擊以下連結開始訂房：\n${liffUrl}`);
                }
            }

            // 處理加入好友事件
            if (event.type === 'follow') {
                const userId = event.source.userId;
                console.log('📱 新用戶加入:', userId?.substring(0, 10) + '...');
                
                // 確保 LINE Bot 設定是最新的（從資料庫重新載入）
                await lineBot.loadSettings();
                
                await lineBot.sendTextMessage(userId, '歡迎加入！輸入「訂房」即可開始預訂房間。');
            }
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ LINE Webhook 處理錯誤:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 後台：快速建立訂房（不發送任何郵件，用於電話 / 其他平台訂房）
app.post('/api/admin/bookings/quick', requireAuth, checkPermission('bookings.create'), adminLimiter, async (req, res) => {
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

        // 後端強制防呆：同房型在「有效/保留」重疊期間不可重複新增
        const bookingsInRange = await db.getBookingsInRange(checkInDate, checkOutDate);
        const hasRoomTypeConflict = bookingsInRange.some((booking) => {
            if (!booking) return false;
            const status = (booking.status || '').toLowerCase();
            if (status !== 'active' && status !== 'reserved') return false;

            const existingRoomType = (booking.room_type || '').trim();
            if (!existingRoomType || existingRoomType !== (roomType || '').trim()) return false;

            const existingCheckIn = new Date(`${String(booking.check_in_date).slice(0, 10)}T00:00:00`);
            const existingCheckOut = new Date(`${String(booking.check_out_date).slice(0, 10)}T00:00:00`);
            // 退房日視為不占房：只有真正重疊才視為衝突
            return checkIn < existingCheckOut && checkOut > existingCheckIn;
        });

        if (hasRoomTypeConflict) {
            return res.status(409).json({
                success: false,
                message: '該房型在此日期已有「有效/保留」訂房，請選擇其他房型或日期'
            });
        }
        
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

// 健康檢查端點已移至 session middleware 之前（第 108 行附近）

// 訂房頁（從銷售頁導流）
app.get('/booking', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 隱私權政策頁面
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy.html'));
});

// 使用條款頁面
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'terms.html'));
});

// 個資保護頁面
app.get('/data-protection', (req, res) => {
    res.sendFile(path.join(__dirname, 'data-protection.html'));
});

// 訂單查詢頁面
app.get('/order-query', (req, res) => {
    res.sendFile(path.join(__dirname, 'order-query.html'));
});

async function getLandingPagePayload() {
    const allSettings = await db.getAllSettings();
    const landingSettings = {};
    allSettings.forEach(setting => {
        if (setting.key.startsWith('landing_')) {
            landingSettings[setting.key] = setting.value;
        }
    });

    const allRoomTypes = await db.getAllRoomTypes();
    const landingRoomTypes = (allRoomTypes || []).filter(r => r.show_on_landing === 1);

    const allGalleryImages = await db.getAllRoomTypeGalleryImages();
    const galleryMap = {};
    (allGalleryImages || []).forEach(img => {
        if (!galleryMap[img.room_type_id]) galleryMap[img.room_type_id] = [];
        galleryMap[img.room_type_id].push(img.image_url);
    });
    landingRoomTypes.forEach(room => {
        room.gallery_images = galleryMap[room.id] || [];
    });

    return { landingSettings, landingRoomTypes };
}

function escapeHtmlText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value) {
    return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function replaceElementContentById(html, id, value, options = {}) {
    if (value === undefined || value === null || value === '') return html;
    const content = options.allowHtml ? String(value) : escapeHtmlText(value);
    const pattern = new RegExp(`(<[^>]*\\sid="${id}"[^>]*>)([\\s\\S]*?)(</[^>]+>)`);
    return html.replace(pattern, (_, openTag, __oldContent, closeTag) => `${openTag}${content}${closeTag}`);
}

function replaceAttrById(html, id, attrName, value) {
    if (!value) return html;
    const pattern = new RegExp(`(<[^>]*\\sid="${id}"[^>]*\\s${attrName}=")([^"]*)(")`);
    const attrValue = escapeHtmlAttr(value);
    return html.replace(pattern, (_, prefix, __oldValue, suffix) => `${prefix}${attrValue}${suffix}`);
}

function replaceLinkHrefById(html, id, value) {
    if (!value) return html;
    const raw = String(value).trim();
    if (!raw || raw === '#') return html;
    let normalized = raw;
    if (!/^(https?:\/\/|line:\/\/|mailto:|tel:)/i.test(normalized)) {
        normalized = `https://${normalized}`;
    }
    return replaceAttrById(html, id, 'href', normalized);
}

function isLandingSettingEnabled(value, defaultValue = true) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function setElementDisplayById(html, id, visible) {
    const pattern = new RegExp(`(<[^>]*\\sid="${id}"[^>]*)(>)`);
    return html.replace(pattern, (_, openTag, closeTag) => {
        if (/\sstyle="/i.test(openTag)) {
            const updatedOpenTag = openTag.replace(/\sstyle="([^"]*)"/i, (__m, styleValue) => {
                const cleaned = String(styleValue || '')
                    .replace(/display\s*:\s*none;?/gi, '')
                    .replace(/\s*;\s*$/g, '')
                    .trim();
                if (visible) {
                    return cleaned ? ` style="${cleaned}"` : '';
                }
                const merged = cleaned ? `${cleaned}; display: none;` : 'display: none;';
                return ` style="${merged}"`;
            });
            return `${updatedOpenTag}${closeTag}`;
        }
        return visible
            ? `${openTag}${closeTag}`
            : `${openTag} style="display: none;"${closeTag}`;
    });
}

function normalizeMaterialIconName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[ -]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function resolveLandingFeatureItems(cfg = {}) {
    const defaults = [
        { icon: 'landscape', title: '絕美山景', desc: '每間房間都能欣賞到壯闊的山巒美景', enabled: true, order: 1 },
        { icon: 'spa', title: '私人湯屋', desc: '獨立溫泉湯屋，24 小時供應天然溫泉', enabled: true, order: 2 },
        { icon: 'restaurant', title: '精緻早餐', desc: '使用在地新鮮食材，每日現做的豐盛早餐', enabled: true, order: 3 },
        { icon: 'pets', title: '寵物友善', desc: '帶著毛小孩一起來度假', enabled: true, order: 4 }
    ];

    let items = [];
    const raw = cfg.landing_features_items;
    if (raw) {
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) {
                items = parsed.map((item, index) => ({
                    icon: normalizeMaterialIconName(item.icon) || 'check_circle',
                    title: String(item.title || '').trim(),
                    desc: String(item.desc || '').trim(),
                    enabled: item.enabled !== false,
                    order: Number(item.order) || (index + 1)
                }));
            }
        } catch (_) {
            // fallback to legacy fields
        }
    }

    if (!items.length) {
        for (let i = 1; i <= 4; i++) {
            const icon = normalizeMaterialIconName(cfg[`landing_feature_${i}_icon`]);
            const title = String(cfg[`landing_feature_${i}_title`] || '').trim();
            const desc = String(cfg[`landing_feature_${i}_desc`] || '').trim();
            if (!icon && !title && !desc) continue;
            items.push({
                icon: icon || 'check_circle',
                title,
                desc,
                enabled: true,
                order: i
            });
        }
    }

    if (!items.length) {
        items = defaults.map(item => ({ ...item }));
    }

    return items
        .filter(item => item.enabled !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function hexToRgb(hex) {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return { r: 26, g: 58, b: 74 };
    }
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function buildLandingThemeStyleTag(themeId) {
    const themes = {
        default: { primary: '#1a3a4a', primary_light: '#2d5a6e', accent: '#c9a962', accent_hover: '#b8954d', bg_cream: '#f8f6f3', text_dark: '#2d3436', text_light: '#636e72' },
        forest:  { primary: '#2d5016', primary_light: '#4a7a2e', accent: '#d4a853', accent_hover: '#c09640', bg_cream: '#f5f7f2', text_dark: '#2d3426', text_light: '#5a6b52' },
        mountain:{ primary: '#3d4f5f', primary_light: '#5a7186', accent: '#e8b960', accent_hover: '#d4a64d', bg_cream: '#f4f5f7', text_dark: '#2c3440', text_light: '#6b7a88' },
        sakura:  { primary: '#8b4557', primary_light: '#a8637a', accent: '#f0c987', accent_hover: '#e0b870', bg_cream: '#fdf6f0', text_dark: '#3d2832', text_light: '#8a6a72' },
        sunset:  { primary: '#5a3e2b', primary_light: '#7d5a3f', accent: '#e8a54b', accent_hover: '#d49438', bg_cream: '#faf5ef', text_dark: '#3a2a1e', text_light: '#8a7060' },
        ocean:   { primary: '#1e5799', primary_light: '#3a7bc8', accent: '#ffd700', accent_hover: '#e6c200', bg_cream: '#f0f5fa', text_dark: '#1a2a3a', text_light: '#5a6a7a' },
        autumn:  { primary: '#5c4033', primary_light: '#7d5e50', accent: '#c9a962', accent_hover: '#b8954d', bg_cream: '#f9f4ef', text_dark: '#3a2e26', text_light: '#7a6a5a' },
        minimal: { primary: '#1a1a2e', primary_light: '#33334d', accent: '#e2b259', accent_hover: '#d0a048', bg_cream: '#f5f5f5', text_dark: '#1a1a1a', text_light: '#666666' }
    };
    const theme = themes[themeId] || themes.default;
    const pRgb = hexToRgb(theme.primary);
    const aRgb = hexToRgb(theme.accent);
    return `<style id="landingSsrThemeVars">:root{--primary:${theme.primary};--primary-light:${theme.primary_light};--accent:${theme.accent};--accent-hover:${theme.accent_hover};--bg-cream:${theme.bg_cream};--bg-dark:${theme.primary};--text-dark:${theme.text_dark};--text-light:${theme.text_light};--primary-alpha-95:rgba(${pRgb.r},${pRgb.g},${pRgb.b},0.95);--primary-alpha-85:rgba(${pRgb.r},${pRgb.g},${pRgb.b},0.85);--primary-alpha-75:rgba(${pRgb.r},${pRgb.g},${pRgb.b},0.75);--primary-alpha-60:rgba(${pRgb.r},${pRgb.g},${pRgb.b},0.6);--primary-alpha-08:rgba(${pRgb.r},${pRgb.g},${pRgb.b},0.08);--accent-shadow:rgba(${aRgb.r},${aRgb.g},${aRgb.b},0.4);--accent-shadow-lg:rgba(${aRgb.r},${aRgb.g},${aRgb.b},0.5);--accent-alpha-10:rgba(${aRgb.r},${aRgb.g},${aRgb.b},0.1);}</style>`;
}

function renderLandingTemplate(templateHtml, landingSettings, landingRoomTypes) {
    let html = templateHtml;
    const cfg = landingSettings || {};
    const landingName = cfg.landing_name || '';
    const seoTitle = cfg.landing_seo_title || landingName || '旅宿銷售頁';

    html = replaceElementContentById(html, 'pageTitle', seoTitle);
    html = replaceElementContentById(html, 'navLogoText', landingName);
    if (cfg.landing_nav_logo) {
        html = replaceAttrById(html, 'navLogoImage', 'src', cfg.landing_nav_logo);
        html = html.replace(
            /<img id="navLogoImage" class="nav-logo-image" src="" alt="旅宿 Logo" style="display: none;">/,
            `<img id="navLogoImage" class="nav-logo-image" src="${escapeHtmlAttr(cfg.landing_nav_logo)}" alt="旅宿 Logo">`
        );
    }
    html = replaceElementContentById(html, 'footerBrandText', landingName);
    if (cfg.landing_nav_logo) {
        html = replaceAttrById(html, 'footerLogoImage', 'src', cfg.landing_nav_logo);
        html = html.replace(
            /<img id="footerLogoImage" class="footer-logo-image" src="" alt="旅宿 Logo" style="display: none;">/,
            `<img id="footerLogoImage" class="footer-logo-image" src="${escapeHtmlAttr(cfg.landing_nav_logo)}" alt="旅宿 Logo">`
        );
    }

    html = replaceElementContentById(html, 'heroTitle', cfg.landing_title, { allowHtml: true });
    html = replaceElementContentById(html, 'heroSubtitle', cfg.landing_subtitle);
    html = replaceElementContentById(html, 'heroBadge', cfg.landing_badge);
    html = replaceElementContentById(html, 'heroPricePrefix', cfg.landing_price_prefix);
    html = replaceElementContentById(html, 'heroPriceAmount', cfg.landing_price_amount);
    html = replaceElementContentById(html, 'heroPriceOriginal', cfg.landing_price_original);
    html = replaceElementContentById(html, 'aboutSectionTitle', cfg.landing_about_title);
    html = replaceElementContentById(html, 'aboutSectionSubtitle', cfg.landing_about_subtitle);
    html = replaceElementContentById(html, 'aboutCardDesc', cfg.landing_about_card_desc);
    html = replaceElementContentById(html, 'countdownText', cfg.landing_countdown_text, { allowHtml: true });

    html = replaceElementContentById(html, 'heroTrust1', cfg.landing_hero_trust_1);
    html = replaceElementContentById(html, 'heroTrust2', cfg.landing_hero_trust_2);
    html = replaceElementContentById(html, 'heroTrust3', cfg.landing_hero_trust_3);
    html = replaceElementContentById(html, 'heroTrustIcon1', cfg.landing_hero_trust_icon_1);
    html = replaceElementContentById(html, 'heroTrustIcon2', cfg.landing_hero_trust_icon_2);
    html = replaceElementContentById(html, 'heroTrustIcon3', cfg.landing_hero_trust_icon_3);
    const heroTrustVisible1 = isLandingSettingEnabled(cfg.landing_hero_trust_enabled_1, true);
    const heroTrustVisible2 = isLandingSettingEnabled(cfg.landing_hero_trust_enabled_2, true);
    const heroTrustVisible3 = isLandingSettingEnabled(cfg.landing_hero_trust_enabled_3, true);
    html = setElementDisplayById(html, 'heroTrustItem1', heroTrustVisible1);
    html = setElementDisplayById(html, 'heroTrustItem2', heroTrustVisible2);
    html = setElementDisplayById(html, 'heroTrustItem3', heroTrustVisible3);
    html = setElementDisplayById(html, 'heroTrustGroup', heroTrustVisible1 || heroTrustVisible2 || heroTrustVisible3);

    html = replaceElementContentById(html, 'featuresSectionTitle', cfg.landing_features_title);
    html = replaceElementContentById(html, 'featuresSectionSubtitle', cfg.landing_features_subtitle);
    // SSR 階段先安全回填前 4 張預設卡位，完整動態數量交由前端 JS 渲染
    const featureItems = resolveLandingFeatureItems(cfg);
    for (let i = 1; i <= 4; i++) {
        const item = featureItems[i - 1] || {};
        html = replaceElementContentById(html, `featureIcon${i}`, item.icon || '');
        html = replaceElementContentById(html, `featureTitle${i}`, item.title || '');
        html = replaceElementContentById(html, `featureDesc${i}`, item.desc || '');
    }

    html = replaceElementContentById(html, 'roomsSectionTitle', cfg.landing_rooms_title);
    html = replaceElementContentById(html, 'roomsSectionSubtitle', cfg.landing_rooms_subtitle);
    if (cfg.landing_review_count) {
        html = replaceElementContentById(html, 'reviewTitle', `超過 ${cfg.landing_review_count} 位旅客的選擇`);
    }
    html = replaceElementContentById(html, 'reviewScore', cfg.landing_review_score);

    html = replaceElementContentById(html, 'locationSectionTitle', cfg.landing_location_title);
    html = replaceElementContentById(html, 'locationAddress', cfg.landing_address);
    html = replaceElementContentById(html, 'locationDriving', cfg.landing_driving);
    html = replaceElementContentById(html, 'locationTransit', cfg.landing_transit);
    html = replaceElementContentById(html, 'locationPhone', cfg.landing_phone);
    html = replaceAttrById(html, 'locationMap', 'src', cfg.landing_map_url);

    html = replaceElementContentById(html, 'finalCtaTitle', cfg.landing_final_cta_title);
    html = replaceElementContentById(html, 'finalCtaDesc', cfg.landing_final_cta_desc);
    html = replaceElementContentById(html, 'finalGuaranteeText', cfg.landing_final_guarantee);
    html = replaceElementContentById(html, 'finalGuaranteeIcon', cfg.landing_final_guarantee_icon);

    const ctaText = cfg.landing_cta_text;
    html = replaceElementContentById(html, 'heroCtaText', ctaText);
    html = replaceElementContentById(html, 'navCtaBtn', ctaText);
    html = replaceElementContentById(html, 'finalCtaText', ctaText);
    html = replaceElementContentById(html, 'floatingCtaText', ctaText);

    html = replaceAttrById(html, 'metaDescription', 'content', cfg.landing_seo_desc);
    html = replaceAttrById(html, 'ogTitle', 'content', seoTitle);
    html = replaceAttrById(html, 'ogDescription', 'content', cfg.landing_seo_desc);
    html = replaceAttrById(html, 'ogImage', 'content', cfg.landing_og_image);
    html = replaceAttrById(html, 'customerFavicon', 'href', cfg.landing_favicon);
    html = replaceAttrById(html, 'customerAppleTouchIcon', 'href', cfg.landing_favicon);
    html = replaceLinkHrefById(html, 'socialFb', cfg.landing_social_fb);
    html = replaceLinkHrefById(html, 'socialIg', cfg.landing_social_ig);
    html = replaceLinkHrefById(html, 'socialLine', cfg.landing_social_line);

    if (cfg.landing_hero_image) {
        html = html.replace(
            /<section class="hero" id="hero">/,
            `<section class="hero" id="hero" style="background-image: url('${escapeHtmlAttr(cfg.landing_hero_image)}');">`
        );
    }

    if (cfg.landing_theme) {
        html = html.replace('</head>', `    ${buildLandingThemeStyleTag(cfg.landing_theme)}\n</head>`);
    }

    const ssrPayload = {
        data: cfg,
        roomTypes: landingRoomTypes || []
    };
    const serializedPayload = JSON.stringify(ssrPayload).replace(/</g, '\\u003c');
    html = html.replace(
        /<script src="landing\.js"><\/script>/,
        `<script>window.__LANDING_SSR__ = ${serializedPayload};</script>\n    <script src="landing.js"></script>`
    );

    return html;
}

async function handleLandingPageRequest(req, res) {
    try {
        const { landingSettings, landingRoomTypes } = await getLandingPagePayload();
        const templateHtml = await fs.promises.readFile(path.join(__dirname, 'landing.html'), 'utf8');
        const renderedHtml = renderLandingTemplate(templateHtml, landingSettings, landingRoomTypes);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderedHtml);
    } catch (error) {
        console.error('SSR 產生銷售頁失敗，改回靜態檔案:', error);
        res.sendFile(path.join(__dirname, 'landing.html'));
    }
}

// 首頁改為銷售頁
app.get('/', publicLimiter, handleLandingPageRequest);

// 銷售頁相容路徑
app.get(['/landing', '/landing.html'], publicLimiter, handleLandingPageRequest);

// 舊網址相容：/index.html 導向 /booking
app.get('/index.html', (req, res) => {
    res.redirect(302, '/booking');
});

// 管理後台登入頁面
app.get('/admin/login', (req, res) => {
    // 如果已經登入，重導向到管理後台
    const sessionStatus = validateAdminSession(req, { touch: false });
    if (sessionStatus.valid) {
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
            // 取得管理員權限列表
            const permissions = await db.getAdminPermissions(admin.id);
            
            // 取得管理員詳情（包含角色資訊）
            const adminDetail = await db.getAdminById(admin.id);
            const roleName = adminDetail?.role_display_name || admin.role || '管理員';
            
            // 建立 Session
            req.session.admin = {
                id: admin.id,
                username: admin.username,
                email: admin.email,
                role: admin.role,
                role_id: adminDetail?.role_id,
                role_display_name: roleName,
                permissions: permissions,
                session_started_at: Date.now(),
                last_activity_at: Date.now()
            };
            
            // 記錄 Session 資訊（用於除錯）
            console.log('✅ 登入成功，建立 Session:', {
                sessionId: req.sessionID,
                admin: admin.username,
                role: roleName,
                permissionCount: permissions.length,
                hasSecret: !!process.env.SESSION_SECRET,
                useSecureCookie: useSecureCookie
            });
            
            // 記錄登入日誌（異步執行，不阻塞回應）
            logAction(req, 'login', null, null, {
                username: admin.username,
                role: roleName,
                permissionCount: permissions.length
            }).catch(err => console.error('記錄登入日誌失敗:', err));
            
            // 穩定性優先：先確保 Session 已成功寫入，再回應登入成功
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            console.log('✅ Session 已保存');
            
            res.json({
                success: true,
                message: '登入成功',
                admin: {
                    username: admin.username,
                    role: admin.role,
                    role_display_name: roleName,
                    permissions: permissions
                }
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
app.get('/api/admin/check-auth', adminLimiter, async (req, res) => {
    const sessionStatus = validateAdminSession(req, { touch: true });
    if (sessionStatus.valid && req.session && req.session.admin) {
        // 如果 session 中沒有權限列表，重新載入
        if (!req.session.admin.permissions) {
            req.session.admin.permissions = await db.getAdminPermissions(req.session.admin.id);
        }
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

// ==================== 權限管理 API ====================

// 取得當前管理員的權限列表
app.get('/api/admin/my-permissions', requireAuth, async (req, res) => {
    try {
        const adminId = req.session.admin.id;
        let permissions = req.session.admin.permissions;
        
        // 如果 session 中沒有權限列表，從資料庫載入
        if (!permissions) {
            permissions = await db.getAdminPermissions(adminId);
            req.session.admin.permissions = permissions;
        }
        
        res.json({
            success: true,
            permissions: permissions
        });
    } catch (error) {
        console.error('取得權限列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得權限列表失敗：' + error.message
        });
    }
});

// 檢查是否有特定權限
app.get('/api/admin/check-permission/:code', requireAuth, async (req, res) => {
    try {
        const adminId = req.session.admin.id;
        const permissionCode = req.params.code;
        const permissions = req.session.admin.permissions || [];
        
        // 先從 session 中檢查
        let hasPermission = permissions.includes(permissionCode);
        
        // 如果 session 中沒有，從資料庫檢查
        if (!hasPermission && !permissions.length) {
            hasPermission = await db.hasPermission(adminId, permissionCode);
        }
        
        res.json({
            success: true,
            hasPermission: hasPermission
        });
    } catch (error) {
        console.error('檢查權限錯誤:', error);
        res.status(500).json({
            success: false,
            message: '檢查權限失敗：' + error.message
        });
    }
});

// 取得所有權限列表（僅供超級管理員或有 roles.view 權限的管理員）
app.get('/api/admin/permissions', requireAuth, checkPermission('roles.view'), async (req, res) => {
    try {
        const permissions = await db.getAllPermissionsGrouped();
        res.json({
            success: true,
            permissions: permissions
        });
    } catch (error) {
        console.error('取得權限列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得權限列表失敗：' + error.message
        });
    }
});

// ==================== 角色管理 API ====================

// 取得所有角色
app.get('/api/admin/roles', requireAuth, checkPermission('roles.view'), async (req, res) => {
    try {
        const roles = await db.getAllRoles();
        res.json({
            success: true,
            roles: roles
        });
    } catch (error) {
        console.error('取得角色列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得角色列表失敗：' + error.message
        });
    }
});

// 取得角色詳情
app.get('/api/admin/roles/:id', requireAuth, checkPermission('roles.view'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        const role = await db.getRoleById(roleId);
        
        if (!role) {
            return res.status(404).json({
                success: false,
                message: '找不到該角色'
            });
        }
        
        res.json({
            success: true,
            role: role
        });
    } catch (error) {
        console.error('取得角色詳情錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得角色詳情失敗：' + error.message
        });
    }
});

// 新增角色
app.post('/api/admin/roles', requireAuth, checkPermission('roles.create'), async (req, res) => {
    try {
        const { role_name, display_name, description } = req.body;
        
        if (!role_name || !display_name) {
            return res.status(400).json({
                success: false,
                message: '角色名稱和顯示名稱為必填'
            });
        }
        
        const roleId = await db.createRole({ role_name, display_name, description });
        
        await logAction(req, 'create_role', 'role', roleId, {
            role_name: role_name,
            display_name: display_name
        });
        
        res.json({
            success: true,
            message: '角色建立成功',
            roleId: roleId
        });
    } catch (error) {
        console.error('新增角色錯誤:', error);
        res.status(500).json({
            success: false,
            message: '新增角色失敗：' + error.message
        });
    }
});

// 更新角色
app.put('/api/admin/roles/:id', requireAuth, checkPermission('roles.edit'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        const { display_name, description } = req.body;
        
        const success = await db.updateRole(roleId, { display_name, description });
        
        if (success) {
            await logAction(req, 'update_role', 'role', roleId, {
                display_name: display_name
            });
            
            res.json({
                success: true,
                message: '角色更新成功'
            });
        } else {
            res.status(400).json({
                success: false,
                message: '無法更新系統內建角色或角色不存在'
            });
        }
    } catch (error) {
        console.error('更新角色錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新角色失敗：' + error.message
        });
    }
});

// 刪除角色
app.delete('/api/admin/roles/:id', requireAuth, checkPermission('roles.delete'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        
        const success = await db.deleteRole(roleId);
        
        if (success) {
            await logAction(req, 'delete_role', 'role', roleId, {});
            
            res.json({
                success: true,
                message: '角色刪除成功'
            });
        } else {
            res.status(400).json({
                success: false,
                message: '無法刪除角色'
            });
        }
    } catch (error) {
        console.error('刪除角色錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除角色失敗：' + error.message
        });
    }
});

// 更新角色權限
app.put('/api/admin/roles/:id/permissions', requireAuth, checkPermission('roles.assign_permissions'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        const { permissions } = req.body;
        
        if (!Array.isArray(permissions)) {
            return res.status(400).json({
                success: false,
                message: '權限列表格式錯誤'
            });
        }
        
        await db.updateRolePermissions(roleId, permissions);
        
        await logAction(req, 'update_role_permissions', 'role', roleId, {
            permissionCount: permissions.length
        });
        
        res.json({
            success: true,
            message: '角色權限更新成功'
        });
    } catch (error) {
        console.error('更新角色權限錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新角色權限失敗：' + error.message
        });
    }
});

// ==================== 管理員管理 API ====================

// 取得所有管理員
app.get('/api/admin/admins', requireAuth, checkPermission('admins.view'), async (req, res) => {
    try {
        const admins = await db.getAllAdmins();
        res.json({
            success: true,
            admins: admins
        });
    } catch (error) {
        console.error('取得管理員列表錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得管理員列表失敗：' + error.message
        });
    }
});

// 取得管理員詳情
app.get('/api/admin/admins/:id', requireAuth, checkPermission('admins.view'), async (req, res) => {
    try {
        const adminId = parseInt(req.params.id);
        const admin = await db.getAdminById(adminId);
        
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: '找不到該管理員'
            });
        }
        
        res.json({
            success: true,
            admin: admin
        });
    } catch (error) {
        console.error('取得管理員詳情錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得管理員詳情失敗：' + error.message
        });
    }
});

// 新增管理員
app.post('/api/admin/admins', requireAuth, checkPermission('admins.create'), async (req, res) => {
    try {
        const { username, password, email, role_id, department, phone, notes } = req.body;
        
        if (!username || !password || !role_id) {
            return res.status(400).json({
                success: false,
                message: '帳號、密碼和角色為必填'
            });
        }
        
        // 檢查帳號是否已存在
        const existing = await db.getAdminByUsername(username);
        if (existing) {
            return res.status(400).json({
                success: false,
                message: '此帳號已存在'
            });
        }
        
        const adminId = await db.createAdmin({ username, password, email, role_id, department, phone, notes });
        
        await logAction(req, 'create_admin', 'admin', adminId, {
            username: username,
            role_id: role_id
        });
        
        res.json({
            success: true,
            message: '管理員建立成功',
            adminId: adminId
        });
    } catch (error) {
        console.error('新增管理員錯誤:', error);
        res.status(500).json({
            success: false,
            message: '新增管理員失敗：' + error.message
        });
    }
});

// 更新管理員
app.put('/api/admin/admins/:id', requireAuth, checkPermission('admins.edit'), async (req, res) => {
    try {
        const adminId = parseInt(req.params.id);
        const { email, role_id, department, phone, notes, is_active } = req.body;
        
        const success = await db.updateAdmin(adminId, { email, role_id, department, phone, notes, is_active });
        
        if (success) {
            await logAction(req, 'update_admin', 'admin', adminId, {
                role_id: role_id
            });
            
            res.json({
                success: true,
                message: '管理員資料更新成功'
            });
        } else {
            res.status(400).json({
                success: false,
                message: '更新失敗，管理員不存在'
            });
        }
    } catch (error) {
        console.error('更新管理員錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新管理員失敗：' + error.message
        });
    }
});

// 刪除管理員
app.delete('/api/admin/admins/:id', requireAuth, checkPermission('admins.delete'), async (req, res) => {
    try {
        const adminId = parseInt(req.params.id);
        
        // 不允許刪除自己
        if (adminId === req.session.admin.id) {
            return res.status(400).json({
                success: false,
                message: '無法刪除自己的帳號'
            });
        }
        
        const success = await db.deleteAdmin(adminId);
        
        if (success) {
            await logAction(req, 'delete_admin', 'admin', adminId, {});
            
            res.json({
                success: true,
                message: '管理員刪除成功'
            });
        } else {
            res.status(400).json({
                success: false,
                message: '刪除失敗，管理員不存在'
            });
        }
    } catch (error) {
        console.error('刪除管理員錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除管理員失敗：' + error.message
        });
    }
});

// 更新管理員角色
app.put('/api/admin/admins/:id/role', requireAuth, checkPermission('admins.edit'), async (req, res) => {
    try {
        const adminId = parseInt(req.params.id);
        const { role_id } = req.body;
        
        if (!role_id) {
            return res.status(400).json({
                success: false,
                message: '角色 ID 為必填'
            });
        }
        
        const success = await db.updateAdminRole(adminId, role_id);
        
        if (success) {
            await logAction(req, 'update_admin_role', 'admin', adminId, {
                role_id: role_id
            });
            
            res.json({
                success: true,
                message: '管理員角色更新成功'
            });
        } else {
            res.status(400).json({
                success: false,
                message: '更新失敗'
            });
        }
    } catch (error) {
        console.error('更新管理員角色錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新管理員角色失敗：' + error.message
        });
    }
});

// 重設管理員密碼（需要 admins.change_password 權限）
app.put('/api/admin/admins/:id/reset-password', requireAuth, checkPermission('admins.change_password'), async (req, res) => {
    try {
        const adminId = parseInt(req.params.id);
        const { newPassword } = req.body;
        
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: '新密碼至少需要 6 個字元'
            });
        }
        
        const success = await db.updateAdminPassword(adminId, newPassword);
        
        if (success) {
            await logAction(req, 'reset_admin_password', 'admin', adminId, {});
            
            res.json({
                success: true,
                message: '密碼重設成功'
            });
        } else {
            res.status(400).json({
                success: false,
                message: '重設失敗，管理員不存在'
            });
        }
    } catch (error) {
        console.error('重設密碼錯誤:', error);
        res.status(500).json({
            success: false,
            message: '重設密碼失敗：' + error.message
        });
    }
});

// ==================== 操作日誌 API ====================

// API: 取得操作日誌列表
app.get('/api/admin/logs', requireAuth, checkPermission('logs.view'), adminLimiter, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            admin_id,
            action,
            resource_type,
            start_date,
            end_date
        } = req.query;
        
        const pageNum = parseInt(page) || 1;
        const limitNum = Math.min(parseInt(limit) || 50, 200);
        const offset = (pageNum - 1) * limitNum;
        
        const filterOptions = {
            limit: limitNum,
            offset: offset,
            adminId: admin_id ? parseInt(admin_id) : null,
            action: action || null,
            resourceType: resource_type || null,
            startDate: start_date || null,
            endDate: end_date ? start_date === end_date ? end_date + 'T23:59:59' : end_date : null
        };
        
        const [logs, totalCount] = await Promise.all([
            db.getAdminLogs(filterOptions),
            db.getAdminLogsCount(filterOptions)
        ]);
        
        res.json({
            success: true,
            data: logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitNum)
            }
        });
    } catch (error) {
        console.error('查詢操作日誌錯誤:', error);
        res.status(500).json({
            success: false,
            message: '查詢操作日誌失敗：' + error.message
        });
    }
});

// API: 取得日誌篩選選項（操作類型和管理員列表）
app.get('/api/admin/logs/filters', requireAuth, checkPermission('logs.view'), adminLimiter, async (req, res) => {
    try {
        const filters = await db.getLogFilterOptions();
        res.json({
            success: true,
            ...filters
        });
    } catch (error) {
        console.error('查詢日誌篩選選項錯誤:', error);
        res.status(500).json({
            success: false,
            message: '查詢篩選選項失敗：' + error.message
        });
    }
});

// API: 取得備份列表
app.get('/api/admin/backups', requireAuth, checkPermission('backup.view'), adminLimiter, async (req, res) => {
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
app.post('/api/admin/backups/create', requireAuth, checkPermission('backup.create'), adminLimiter, async (req, res) => {
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
app.post('/api/admin/backups/cleanup', requireAuth, checkPermission('backup.delete'), adminLimiter, async (req, res) => {
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

// API: 刪除單一備份
app.delete('/api/admin/backups/:fileName', requireAuth, checkPermission('backup.delete'), adminLimiter, async (req, res) => {
    try {
        const { fileName } = req.params;
        const result = backup.deleteBackup(fileName);
        
        // 記錄刪除操作日誌
        await logAction(req, 'delete_backup', 'backup', fileName, {
            fileName: result.fileName,
            fileSizeMB: result.fileSizeMB
        });
        
        res.json({
            success: true,
            message: `已刪除備份：${result.fileName}`,
            data: result
        });
    } catch (error) {
        console.error('刪除備份錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除備份失敗：' + error.message
        });
    }
});

// API: 還原備份
app.post('/api/admin/backups/restore/:fileName', requireAuth, checkPermission('backup.restore'), adminLimiter, async (req, res) => {
    try {
        const { fileName } = req.params;
        
        // 還原前先自動建立一份備份（安全措施）
        console.log('⚠️ 還原前自動建立安全備份...');
        try {
            await backup.performBackup();
        } catch (preBackupError) {
            console.warn('⚠️ 還原前安全備份失敗（繼續還原）:', preBackupError.message);
        }
        
        const result = await backup.restoreBackup(fileName);
        
        // 記錄還原操作日誌
        await logAction(req, 'restore_backup', 'backup', fileName, {
            fileName: result.fileName,
            restoredTables: result.restoredTables,
            totalRowsRestored: result.totalRowsRestored
        });
        
        res.json({
            success: true,
            message: `備份已還原：${result.fileName}`,
            data: result
        });
    } catch (error) {
        console.error('還原備份錯誤:', error);
        res.status(500).json({
            success: false,
            message: '還原備份失敗：' + error.message
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
    // 強制禁用快取：避免瀏覽器/代理拿到截斷或舊版的 admin.html / admin.js 造成白畫面
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // 直接返回 admin.html，由前端 JavaScript 檢查登入狀態並顯示對應頁面
    res.sendFile(path.join(__dirname, 'admin.html'));
});

const bookingService = createBookingService({ db });
app.use('/api', createBookingRoutes({
    bookingService,
    handlers: {
        createBooking: handleCreateBooking,
        updateBooking: handleUpdateBooking,
        cancelBooking: handleCancelBooking,
        deleteBooking: handleDeleteBooking
    },
    publicLimiter,
    verifyCsrfToken,
    validateBooking,
    requireAuth,
    checkPermission,
    adminLimiter
}));

const emailService = createEmailService({
    getRequiredEmailUser,
    sendEmail
});

const fallbackTemplateService = createEmailFallbackTemplatesService({
    getHotelSettingsWithFallback,
    generateEmailFromTemplate
});

const templateService = createTemplateService({
    generateEmailFromTemplate,
    generateCustomerEmail: fallbackTemplateService.generateCustomerEmail,
    generateAdminEmail: fallbackTemplateService.generateAdminEmail
});

const notificationService = createNotificationService({
    db,
    lineBot,
    emailService,
    templateService,
    processEnv: process.env,
    replaceTemplateVariables,
    generatePaymentReceivedEmail: fallbackTemplateService.generatePaymentReceivedEmail,
    generateCancellationEmail: fallbackTemplateService.generateCancellationEmail
});

const bookingNotificationJobs = createBookingNotificationJobs({
    db,
    notificationService,
    getHotelSettingsWithFallback,
    calculateDynamicPaymentDeadline
});

const adminLogCleanupJobs = createAdminLogCleanupJobs({
    db,
    processEnv: process.env
});

const orderQueryService = createOrderQueryService({
    db,
    dataProtection,
    notificationService
});
app.use('/api/order-query', createOrderQueryRoutes({
    orderQueryService,
    publicLimiter
}));

// API: 取得所有客戶列表（聚合訂房資料）- 需要登入
app.get('/api/customers', requireAuth, checkPermission('customers.view'), adminLimiter, async (req, res) => {
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
app.put('/api/customers/:email', requireAuth, checkPermission('customers.edit'), adminLimiter, async (req, res) => {
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
app.delete('/api/customers/:email', requireAuth, checkPermission('customers.delete'), adminLimiter, async (req, res) => {
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

// ==================== 會員等級管理 API ====================

// API: 取得所有會員等級
app.get('/api/member-levels', requireAuth, checkPermission('customers.view'), adminLimiter, async (req, res) => {
    try {
        const levels = await db.getAllMemberLevels();
        
        res.json({
            success: true,
            count: levels.length,
            data: levels
        });
    } catch (error) {
        console.error('查詢會員等級列表錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢會員等級列表失敗：' + error.message 
        });
    }
});

// API: 取得單一會員等級
app.get('/api/member-levels/:id', requireAuth, checkPermission('customers.view'), adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const level = await db.getMemberLevelById(parseInt(id));
        
        if (level) {
            res.json({
                success: true,
                data: level
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該會員等級'
            });
        }
    } catch (error) {
        console.error('查詢會員等級錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢會員等級失敗：' + error.message 
        });
    }
});

// API: 新增會員等級
app.post('/api/member-levels', requireAuth, checkPermission('customers.edit'), adminLimiter, async (req, res) => {
    try {
        const { level_name, min_spent, min_bookings, discount_percent, display_order, is_active } = req.body;
        
        if (!level_name) {
            return res.status(400).json({
                success: false,
                message: '等級名稱為必填'
            });
        }
        
        const level = await db.createMemberLevel({
            level_name,
            min_spent: parseInt(min_spent || 0),
            min_bookings: parseInt(min_bookings || 0),
            discount_percent: parseFloat(discount_percent || 0),
            display_order: parseInt(display_order || 0),
            is_active: is_active !== undefined ? is_active : 1
        });
        
        res.json({
            success: true,
            message: '會員等級已新增',
            data: level
        });
    } catch (error) {
        console.error('新增會員等級錯誤:', error);
        res.status(500).json({
            success: false,
            message: '新增會員等級失敗：' + error.message
        });
    }
});

// API: 更新會員等級
app.put('/api/member-levels/:id', requireAuth, checkPermission('customers.edit'), adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { level_name, min_spent, min_bookings, discount_percent, display_order, is_active } = req.body;
        
        if (!level_name) {
            return res.status(400).json({
                success: false,
                message: '等級名稱為必填'
            });
        }
        
        const level = await db.updateMemberLevel(parseInt(id), {
            level_name,
            min_spent: parseInt(min_spent || 0),
            min_bookings: parseInt(min_bookings || 0),
            discount_percent: parseFloat(discount_percent || 0),
            display_order: parseInt(display_order || 0),
            is_active: is_active !== undefined ? is_active : 1
        });
        
        res.json({
            success: true,
            message: '會員等級已更新',
            data: level
        });
    } catch (error) {
        console.error('更新會員等級錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新會員等級失敗：' + error.message
        });
    }
});

// API: 刪除會員等級
app.delete('/api/member-levels/:id', requireAuth, checkPermission('customers.delete'), adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.deleteMemberLevel(parseInt(id));
        
        res.json({
            success: true,
            message: '會員等級已刪除'
        });
    } catch (error) {
        console.error('刪除會員等級錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除會員等級失敗：' + error.message
        });
    }
});

// API: 檢查會員折扣（公開 API，用於前台）
app.post('/api/member-discount/check', publicLimiter, async (req, res) => {
    try {
        const guestEmail = String(req.body.guestEmail || '').trim().toLowerCase();
        const totalAmount = parseInt(req.body.totalAmount || 0, 10) || 0;

        if (!guestEmail) {
            return res.json({
                success: true,
                data: {
                    applicable: false,
                    level_name: null,
                    discount_percent: 0,
                    discount_amount: 0
                }
            });
        }

        const stats = await db.getPaidActiveCustomerStatsByEmail(guestEmail);
        const level = await db.calculateCustomerLevel(stats.total_spent || 0, stats.booking_count || 0);
        const discountPercent = parseFloat(level?.discount_percent || 0);
        const discountAmount = discountPercent > 0
            ? Math.round(totalAmount * (discountPercent / 100))
            : 0;

        res.json({
            success: true,
            data: {
                applicable: discountAmount > 0,
                level_name: level?.level_name || null,
                discount_percent: discountPercent,
                discount_amount: discountAmount,
                eligible_booking_count: stats.booking_count || 0,
                eligible_total_spent: stats.total_spent || 0
            }
        });
    } catch (error) {
        console.error('檢查會員折扣錯誤:', error);
        res.status(500).json({
            success: false,
            message: '檢查會員折扣失敗：' + error.message
        });
    }
});

// ==================== 優惠代碼管理 API ====================

// API: 驗證優惠代碼（公開 API，用於前台）
app.post('/api/promo-codes/validate', publicLimiter, async (req, res) => {
    try {
        const { code, totalAmount, roomType, checkInDate, guestEmail } = req.body;
        
        if (!code) {
            return res.status(400).json({
                success: false,
                message: '請輸入優惠代碼'
            });
        }
        
        if (!totalAmount || totalAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: '請先選擇房型和日期'
            });
        }
        
        const validation = await db.validatePromoCode(code, totalAmount, roomType || '', guestEmail || null);
        
        if (validation.valid) {
            res.json({
                success: true,
                data: {
                    code: validation.promo_code.code,
                    name: validation.promo_code.name,
                    discount_type: validation.promo_code.discount_type,
                    discount_value: validation.promo_code.discount_value,
                    max_discount: validation.promo_code.max_discount || null,
                    discount_amount: validation.discount_amount,
                    original_amount: validation.original_amount,
                    final_amount: validation.final_amount,
                    can_combine_with_early_bird: validation.promo_code.can_combine_with_early_bird || 0,
                    message: validation.message
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: validation.message
            });
        }
    } catch (error) {
        console.error('驗證優惠代碼錯誤:', error);
        res.status(500).json({
            success: false,
            message: '驗證優惠代碼失敗：' + error.message
        });
    }
});

// API: 取得所有優惠代碼（管理後台）
app.get('/api/admin/promo-codes', requireAuth, checkPermission('promo_codes.view'), adminLimiter, async (req, res) => {
    try {
        const codes = await db.getAllPromoCodes();
        
        // 取得每個優惠代碼的使用統計
        const codesWithStats = await Promise.all(codes.map(async (code) => {
            const stats = await db.getPromoCodeUsageStats(code.id);
            return {
                ...code,
                usage_stats: stats
            };
        }));
        
        res.json({
            success: true,
            count: codesWithStats.length,
            data: codesWithStats
        });
    } catch (error) {
        console.error('查詢優惠代碼列表錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢優惠代碼列表失敗：' + error.message 
        });
    }
});

// API: 取得單一優惠代碼
app.get('/api/admin/promo-codes/:id', requireAuth, checkPermission('promo_codes.view'), adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const code = await db.getPromoCodeById(parseInt(id));
        
        if (code) {
            const stats = await db.getPromoCodeUsageStats(code.id);
            res.json({
                success: true,
                data: {
                    ...code,
                    usage_stats: stats
                }
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該優惠代碼'
            });
        }
    } catch (error) {
        console.error('查詢優惠代碼錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢優惠代碼失敗：' + error.message 
        });
    }
});

// API: 新增優惠代碼
app.post('/api/admin/promo-codes', requireAuth, checkPermission('promo_codes.create'), adminLimiter, async (req, res) => {
    try {
        const {
            code, name, description, discount_type, discount_value,
            min_spend, max_discount, applicable_room_types,
            total_usage_limit, per_user_limit, start_date, end_date,
            is_active, can_combine_with_early_bird, can_combine_with_late_bird
        } = req.body;
        
        if (!code || !name || !discount_type || discount_value === undefined) {
            return res.status(400).json({
                success: false,
                message: '請填寫完整的優惠代碼資料（代碼、名稱、折扣類型、折扣值）'
            });
        }
        
        if (discount_type !== 'fixed' && discount_type !== 'percent') {
            return res.status(400).json({
                success: false,
                message: '折扣類型必須是 fixed（固定金額）或 percent（百分比）'
            });
        }
        
        const promoCode = await db.createPromoCode({
            code,
            name,
            description,
            discount_type,
            discount_value: parseFloat(discount_value),
            min_spend: parseInt(min_spend || 0),
            max_discount: max_discount ? parseInt(max_discount) : null,
            applicable_room_types: applicable_room_types || null,
            total_usage_limit: total_usage_limit ? parseInt(total_usage_limit) : null,
            per_user_limit: parseInt(per_user_limit || 1),
            start_date: start_date || null,
            end_date: end_date || null,
            is_active: is_active !== undefined ? is_active : 1,
            can_combine_with_early_bird: can_combine_with_early_bird || 0,
            can_combine_with_late_bird: can_combine_with_late_bird || 0
        });
        
        res.json({
            success: true,
            message: '優惠代碼已新增',
            data: promoCode
        });
    } catch (error) {
        console.error('新增優惠代碼錯誤:', error);
        const statusCode = error.message.includes('UNIQUE') || error.message.includes('duplicate') ? 400 : 500;
        res.status(statusCode).json({
            success: false,
            message: '新增優惠代碼失敗：' + (error.message.includes('UNIQUE') || error.message.includes('duplicate') ? '優惠代碼已存在' : error.message)
        });
    }
});

// API: 更新優惠代碼
app.put('/api/admin/promo-codes/:id', requireAuth, checkPermission('promo_codes.edit'), adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            code, name, description, discount_type, discount_value,
            min_spend, max_discount, applicable_room_types,
            total_usage_limit, per_user_limit, start_date, end_date,
            is_active, can_combine_with_early_bird, can_combine_with_late_bird
        } = req.body;
        
        if (!code || !name || !discount_type || discount_value === undefined) {
            return res.status(400).json({
                success: false,
                message: '請填寫完整的優惠代碼資料'
            });
        }
        
        if (discount_type !== 'fixed' && discount_type !== 'percent') {
            return res.status(400).json({
                success: false,
                message: '折扣類型必須是 fixed 或 percent'
            });
        }
        
        const promoCode = await db.updatePromoCode(parseInt(id), {
            code,
            name,
            description,
            discount_type,
            discount_value: parseFloat(discount_value),
            min_spend: parseInt(min_spend || 0),
            max_discount: max_discount ? parseInt(max_discount) : null,
            applicable_room_types: applicable_room_types || null,
            total_usage_limit: total_usage_limit ? parseInt(total_usage_limit) : null,
            per_user_limit: parseInt(per_user_limit || 1),
            start_date: start_date || null,
            end_date: end_date || null,
            is_active: is_active !== undefined ? parseInt(is_active) : 1,
            can_combine_with_early_bird: can_combine_with_early_bird || 0,
            can_combine_with_late_bird: can_combine_with_late_bird || 0
        });
        
        console.log('更新優惠代碼 - is_active:', parseInt(is_active), '原始值:', is_active);
        
        res.json({
            success: true,
            message: '優惠代碼已更新',
            data: promoCode
        });
    } catch (error) {
        console.error('更新優惠代碼錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新優惠代碼失敗：' + error.message
        });
    }
});

// API: 刪除優惠代碼
app.delete('/api/admin/promo-codes/:id', requireAuth, checkPermission('promo_codes.delete'), adminLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.deletePromoCode(parseInt(id));
        
        res.json({
            success: true,
            message: '優惠代碼已刪除'
        });
    } catch (error) {
        console.error('刪除優惠代碼錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除優惠代碼失敗：' + error.message
        });
    }
});

// ==================== 早鳥/晚鳥優惠管理 API ====================

// API: 檢查早鳥優惠（公開 API，用於前台自動計算）
app.post('/api/early-bird/check', publicLimiter, async (req, res) => {
    try {
        const { checkInDate, roomTypeName, totalAmount } = req.body;
        
        if (!checkInDate || !totalAmount) {
            return res.status(400).json({
                success: false,
                message: '請提供入住日期和金額'
            });
        }
        
        const result = await db.calculateEarlyBirdDiscount(checkInDate, roomTypeName, totalAmount);
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('檢查早鳥優惠錯誤:', error);
        res.status(500).json({
            success: false,
            message: '檢查早鳥優惠失敗：' + error.message
        });
    }
});

// API: 取得所有早鳥優惠規則（管理後台）
app.get('/api/admin/early-bird-settings', requireAuth, checkPermission('promo_codes.view'), adminLimiter, async (req, res) => {
    try {
        const settings = await db.getAllEarlyBirdSettings();
        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('取得早鳥優惠設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得早鳥優惠設定失敗：' + error.message
        });
    }
});

// API: 取得單一早鳥優惠規則
app.get('/api/admin/early-bird-settings/:id', requireAuth, checkPermission('promo_codes.view'), adminLimiter, async (req, res) => {
    try {
        const setting = await db.getEarlyBirdSettingById(parseInt(req.params.id));
        if (!setting) {
            return res.status(404).json({ success: false, message: '找不到此優惠規則' });
        }
        res.json({ success: true, data: setting });
    } catch (error) {
        console.error('取得早鳥優惠設定錯誤:', error);
        res.status(500).json({ success: false, message: '取得早鳥優惠設定失敗：' + error.message });
    }
});

// API: 建立早鳥優惠規則
app.post('/api/admin/early-bird-settings', requireAuth, checkPermission('promo_codes.create'), adminLimiter, async (req, res) => {
    try {
        const setting = await db.createEarlyBirdSetting(req.body);
        
        // 記錄操作日誌
        try {
            await db.logAdminAction(
                req.session.admin.id,
                req.session.admin.username,
                '建立早鳥優惠',
                'early_bird_settings',
                setting.id ? String(setting.id) : null,
                `建立早鳥優惠規則：${req.body.name}`,
                req.ip,
                req.headers['user-agent']
            );
        } catch (logError) {
            console.warn('記錄操作日誌失敗:', logError.message);
        }
        
        res.json({
            success: true,
            message: '早鳥優惠規則已建立',
            data: setting
        });
    } catch (error) {
        console.error('建立早鳥優惠設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '建立早鳥優惠設定失敗：' + error.message
        });
    }
});

// API: 更新早鳥優惠規則
app.put('/api/admin/early-bird-settings/:id', requireAuth, checkPermission('promo_codes.edit'), adminLimiter, async (req, res) => {
    try {
        const setting = await db.updateEarlyBirdSetting(parseInt(req.params.id), req.body);
        
        // 記錄操作日誌
        try {
            await db.logAdminAction(
                req.session.admin.id,
                req.session.admin.username,
                '更新早鳥優惠',
                'early_bird_settings',
                req.params.id,
                `更新早鳥優惠規則：${req.body.name}`,
                req.ip,
                req.headers['user-agent']
            );
        } catch (logError) {
            console.warn('記錄操作日誌失敗:', logError.message);
        }
        
        res.json({
            success: true,
            message: '早鳥優惠規則已更新',
            data: setting
        });
    } catch (error) {
        console.error('更新早鳥優惠設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '更新早鳥優惠設定失敗：' + error.message
        });
    }
});

// API: 刪除早鳥優惠規則
app.delete('/api/admin/early-bird-settings/:id', requireAuth, checkPermission('promo_codes.delete'), adminLimiter, async (req, res) => {
    try {
        await db.deleteEarlyBirdSetting(parseInt(req.params.id));
        
        // 記錄操作日誌
        try {
            await db.logAdminAction(
                req.session.admin.id,
                req.session.admin.username,
                '刪除早鳥優惠',
                'early_bird_settings',
                req.params.id,
                `刪除早鳥優惠規則`,
                req.ip,
                req.headers['user-agent']
            );
        } catch (logError) {
            console.warn('記錄操作日誌失敗:', logError.message);
        }
        
        res.json({
            success: true,
            message: '早鳥優惠規則已刪除'
        });
    } catch (error) {
        console.error('刪除早鳥優惠設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '刪除早鳥優惠設定失敗：' + error.message
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

// ==================== 匯出 CSV API ====================

// CSV 輔助函數：將值轉為 CSV 安全格式
function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// CSV 輔助函數：產生 CSV 字串
function generateCSV(headers, rows) {
    const bom = '\uFEFF'; // UTF-8 BOM，確保 Excel 正確識別中文
    const headerLine = headers.map(h => csvEscape(h)).join(',');
    const dataLines = rows.map(row => row.map(v => csvEscape(v)).join(','));
    return bom + [headerLine, ...dataLines].join('\r\n');
}

// API: 匯出訂房資料 CSV
app.get('/api/admin/bookings/export', requireAuth, checkPermission('bookings.export'), adminLimiter, async (req, res) => {
    try {
        const bookings = await db.getAllBookings();
        
        const headers = [
            '訂房編號', '入住日期', '退房日期', '房型', 
            '客人姓名', '客人電話', '客人 Email',
            '大人人數', '小孩人數',
            '付款方式', '付款狀態', '訂房狀態',
            '每晚價格', '住宿天數', '總金額', '實付金額',
            '加購商品金額', '訂房日期', '建立時間'
        ];
        
        const paymentStatusMap = { 'paid': '已付款', 'pending': '未付款', 'refunded': '已退款' };
        const statusMap = { 'active': '有效', 'cancelled': '已取消', 'reserved': '保留中' };
        
        const rows = bookings.map(b => [
            b.booking_id,
            b.check_in_date,
            b.check_out_date,
            b.room_type,
            b.guest_name,
            b.guest_phone,
            b.guest_email,
            b.adults || 0,
            b.children || 0,
            b.payment_method,
            paymentStatusMap[b.payment_status] || b.payment_status,
            statusMap[b.status] || b.status,
            b.price_per_night,
            b.nights,
            b.total_amount,
            b.final_amount,
            b.addons_total || 0,
            b.booking_date,
            b.created_at
        ]);
        
        const csv = generateCSV(headers, rows);
        
        // 記錄匯出操作日誌
        await logAction(req, 'export_bookings', 'booking', null, { count: bookings.length });
        
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bookings_${dateStr}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('匯出訂房資料錯誤:', error);
        res.status(500).json({ success: false, message: '匯出訂房資料失敗：' + error.message });
    }
});

// API: 匯出客戶資料 CSV
app.get('/api/admin/customers/export', requireAuth, checkPermission('customers.export'), adminLimiter, async (req, res) => {
    try {
        const customers = await db.getAllCustomers();
        
        const headers = [
            'Email', '姓名', '電話',
            '訂房次數', '累計消費金額',
            '會員等級', '折扣比例 (%)',
            '最近訂房日期'
        ];
        
        const rows = customers.map(c => [
            c.guest_email,
            c.guest_name,
            c.guest_phone,
            c.booking_count,
            c.total_spent,
            c.member_level || '新會員',
            c.discount_percent || 0,
            c.last_booking_date || ''
        ]);
        
        const csv = generateCSV(headers, rows);
        
        // 記錄匯出操作日誌
        await logAction(req, 'export_customers', 'customer', null, { count: customers.length });
        
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${dateStr}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('匯出客戶資料錯誤:', error);
        res.status(500).json({ success: false, message: '匯出客戶資料失敗：' + error.message });
    }
});

// API: 匯出統計報表 CSV
app.get('/api/admin/statistics/export', requireAuth, checkPermission('statistics.export'), adminLimiter, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let stats;
        if (startDate && endDate) {
            stats = await db.getStatistics(startDate, endDate);
        } else {
            stats = await db.getStatistics();
        }
        
        const periodLabel = (startDate && endDate) ? `${startDate} ~ ${endDate}` : '全部期間';
        
        const headers = ['項目', '數值'];
        const rows = [
            ['統計期間', periodLabel],
            [''],
            ['--- 訂房統計 ---', ''],
            ['總訂房數', stats.totalBookings],
            ['已入住', stats.totalBookingsDetail?.checkedIn || 0],
            ['未入住', stats.totalBookingsDetail?.notCheckedIn || 0],
            [''],
            ['--- 營收統計 ---', ''],
            ['總營收', stats.totalRevenue],
            ['已付款營收', stats.totalRevenueDetail?.paid || 0],
            ['未付款營收', stats.totalRevenueDetail?.unpaid || 0],
            [''],
            ['--- 匯款轉帳 ---', ''],
            ['匯款筆數', stats.transferBookings?.count || 0],
            ['匯款金額', stats.transferBookings?.total || 0],
            ['匯款已付款筆數', stats.transferBookings?.paid?.count || 0],
            ['匯款已付款金額', stats.transferBookings?.paid?.total || 0],
            ['匯款未付款筆數', stats.transferBookings?.unpaid?.count || 0],
            ['匯款未付款金額', stats.transferBookings?.unpaid?.total || 0],
            [''],
            ['--- 線上刷卡 ---', ''],
            ['刷卡筆數', stats.cardBookings?.count || 0],
            ['刷卡金額', stats.cardBookings?.total || 0],
            ['刷卡已付款筆數', stats.cardBookings?.paid?.count || 0],
            ['刷卡已付款金額', stats.cardBookings?.paid?.total || 0],
            ['刷卡未付款筆數', stats.cardBookings?.unpaid?.count || 0],
            ['刷卡未付款金額', stats.cardBookings?.unpaid?.total || 0],
        ];
        
        // 加入各房型統計
        if (stats.byRoomType && stats.byRoomType.length > 0) {
            rows.push(['']);
            rows.push(['--- 房型統計 ---', '']);
            for (const rt of stats.byRoomType) {
                rows.push([rt.room_type, rt.count]);
            }
        }
        
        const csv = generateCSV(headers, rows);
        
        // 記錄匯出操作日誌
        await logAction(req, 'export_statistics', 'statistics', null, { period: periodLabel });
        
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="statistics_${dateStr}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('匯出統計報表錯誤:', error);
        res.status(500).json({ success: false, message: '匯出統計報表失敗：' + error.message });
    }
});

// API: 取得統計資料 - 需要登入
// 支援可選的日期區間：?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/statistics', requireAuth, checkPermission('statistics.view'), adminLimiter, async (req, res) => {
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

// API: 取得上月和本月的統計資料（不含比較）
app.get('/api/statistics/monthly-stats', requireAuth, checkPermission('statistics.view'), adminLimiter, async (req, res) => {
    try {
        const stats = await db.getMonthlyComparison();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('查詢月度統計錯誤:', error);
        console.error('錯誤詳情:', error.message);
        console.error('錯誤堆疊:', error.stack);
        res.status(500).json({ 
            success: false, 
            message: '查詢月度統計失敗',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// API: 儀表板數據
app.get('/api/dashboard', adminLimiter, async (req, res) => {
    try {
        const normalizeStatus = (status) => String(status || '').trim().toLowerCase();
        const isActiveStatus = (status) => {
            const s = normalizeStatus(status);
            return s === 'active' || s === '有效' || s === '已確認' || s === 'confirmed';
        };
        const isReservedStatus = (status) => {
            const s = normalizeStatus(status);
            return s === 'reserved' || s === '保留' || s === '保留中';
        };
        const isCancelledStatus = (status) => {
            const s = normalizeStatus(status);
            return s === 'cancelled' || s === '已取消' || s === '取消';
        };

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
            (isActiveStatus(booking.status) || isReservedStatus(booking.status))
        ).length;
        
        const todayCheckOuts = allBookings.filter(booking => 
            booking.check_out_date === todayStr && 
            isActiveStatus(booking.status)
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
        const activeBookings = allBookings.filter(booking => isActiveStatus(booking.status)).length;
        const reservedBookings = allBookings.filter(booking => isReservedStatus(booking.status)).length;
        const cancelledBookings = allBookings.filter(booking => isCancelledStatus(booking.status)).length;
        
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

// API: 營運儀表板 Phase 1 指標（同頁整合）
app.get('/api/dashboard/ops', adminLimiter, async (req, res) => {
    try {
        const normalizeStatus = (status) => String(status || '').trim().toLowerCase();
        const isActiveStatus = (status) => {
            const s = normalizeStatus(status);
            return s === 'active' || s === '有效' || s === '已確認' || s === 'confirmed';
        };
        const isReservedStatus = (status) => {
            const s = normalizeStatus(status);
            return s === 'reserved' || s === '保留' || s === '保留中';
        };
        const isCancelledStatus = (status) => {
            const s = normalizeStatus(status);
            return s === 'cancelled' || s === '已取消' || s === '取消';
        };
        const normalizePaymentStatus = (status) => String(status || '').trim().toLowerCase();
        const isPaid = (status) => {
            const s = normalizePaymentStatus(status);
            return s === 'paid' || s === '已付款' || s === '付款完成';
        };
        const isPending = (status) => {
            const s = normalizePaymentStatus(status);
            return s === 'pending' || s === '未付款' || s === '待付款';
        };
        const isFailed = (status) => {
            const s = normalizePaymentStatus(status);
            return s === 'failed' || s === '付款失敗' || s === '失敗';
        };

        const end = req.query.endDate ? new Date(`${req.query.endDate}T00:00:00`) : new Date();
        end.setHours(0, 0, 0, 0);

        const start = req.query.startDate
            ? new Date(`${req.query.startDate}T00:00:00`)
            : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000); // 預設近 30 天
        start.setHours(0, 0, 0, 0);

        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
            return res.status(400).json({
                success: false,
                message: '日期區間格式不正確'
            });
        }

        const allBookings = await db.getAllBookings();
        const roomTypes = await db.getAllRoomTypes();

        const dayCount = Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
        const totalRoomTypes = Math.max(1, (roomTypes || []).length);

        const normalizeDay = (value) => {
            if (!value) return null;

            // PostgreSQL 有機會回傳 Date 物件，先標準化成當地日期 00:00
            if (value instanceof Date) {
                if (isNaN(value.getTime())) return null;
                return new Date(value.getFullYear(), value.getMonth(), value.getDate());
            }

            const raw = String(value).trim();
            if (!raw) return null;

            // 優先解析常見格式：YYYY-MM-DD / YYYY/MM/DD（可帶時間）
            const ymdMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
            if (ymdMatch) {
                const year = Number(ymdMatch[1]);
                const month = Number(ymdMatch[2]) - 1;
                const day = Number(ymdMatch[3]);
                const d = new Date(year, month, day);
                return isNaN(d.getTime()) ? null : d;
            }

            // 後備：讓 JS 嘗試解析，成功後再截成日期
            const fallback = new Date(raw);
            if (isNaN(fallback.getTime())) return null;
            return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
        };

        // 口徑統一：以入住日落在區間內作為 KPI 計算母體
        const inRangeByCheckInDate = allBookings.filter((booking) => {
            const checkIn = normalizeDay(booking.check_in_date);
            if (!checkIn) return false;
            return checkIn >= start && checkIn <= end;
        });

        let occupiedRoomNights = 0;
        let activeReservedRevenue = 0;
        let activeReservedNights = 0;

        allBookings.forEach((booking) => {
            if (!isActiveStatus(booking.status) && !isReservedStatus(booking.status)) return;

            const checkIn = normalizeDay(booking.check_in_date);
            const checkOut = normalizeDay(booking.check_out_date);
            if (!checkIn || !checkOut || checkOut <= checkIn) return;

            // 住房夜計算：入住日含、退房日不含
            const overlapStart = checkIn > start ? checkIn : start;
            const overlapEndExclusive = checkOut <= new Date(end.getTime() + 24 * 60 * 60 * 1000)
                ? checkOut
                : new Date(end.getTime() + 24 * 60 * 60 * 1000);

            if (overlapEndExclusive <= overlapStart) return;

            const overlapNights = Math.floor((overlapEndExclusive - overlapStart) / (24 * 60 * 60 * 1000));
            if (overlapNights <= 0) return;

            occupiedRoomNights += overlapNights;

            const totalNights = Math.max(1, Math.floor((checkOut - checkIn) / (24 * 60 * 60 * 1000)));
            const finalAmount = parseFloat(booking.final_amount || 0) || 0;
            const perNightRevenue = finalAmount / totalNights;
            activeReservedRevenue += perNightRevenue * overlapNights;
            activeReservedNights += overlapNights;
        });

        const conversionNumerator = inRangeByCheckInDate.filter((b) => isActiveStatus(b.status) || isReservedStatus(b.status)).length;
        const conversionDenominator = inRangeByCheckInDate.length;

        const paymentNumerator = inRangeByCheckInDate.filter((b) => isPaid(b.payment_status)).length;
        const paymentDenominator = inRangeByCheckInDate.filter((b) => isPaid(b.payment_status) || isPending(b.payment_status) || isFailed(b.payment_status)).length;

        const cancellationNumerator = inRangeByCheckInDate.filter((b) => isCancelledStatus(b.status)).length;
        const cancellationDenominator = inRangeByCheckInDate.length;

        const occupancyRate = (occupiedRoomNights / (totalRoomTypes * dayCount)) * 100;
        const averageRoomRate = activeReservedNights > 0 ? (activeReservedRevenue / activeReservedNights) : 0;
        const conversionRate = conversionDenominator > 0 ? (conversionNumerator / conversionDenominator) * 100 : 0;
        const paymentSuccessRate = paymentDenominator > 0 ? (paymentNumerator / paymentDenominator) * 100 : 0;
        const cancellationRate = cancellationDenominator > 0 ? (cancellationNumerator / cancellationDenominator) * 100 : 0;

        res.json({
            success: true,
            data: {
                range: {
                    startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
                    endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
                    dayCount
                },
                kpis: {
                    occupancyRate,
                    averageRoomRate,
                    conversionRate,
                    paymentSuccessRate,
                    cancellationRate
                }
            }
        });
    } catch (error) {
        console.error('查詢營運儀表板指標錯誤:', error);
        res.status(500).json({
            success: false,
            message: '查詢營運儀表板指標失敗：' + error.message
        });
    }
});

// API: 更新訂房資料
async function handleUpdateBooking(req, res) {
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
                        const emailSent = await notificationService.sendPaymentCompletedEmail(updatedBooking);
                        if (emailSent) {
                            console.log(`✅ 收款信已發送給 ${updatedBooking.guest_name} (${updatedBooking.booking_id})`);
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
}

// API: 取消訂房
async function handleCancelBooking(req, res) {
    try {
        const { bookingId } = req.params;
        
        // 取得訂房資料
        const booking = await db.getBookingById(bookingId);
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: '找不到該訂房記錄'
            });
        }
        
        // 檢查是否為超級管理員
        const isSuperAdmin = req.session.admin && req.session.admin.role === 'super_admin';
        
        // 一般管理員不可取消：已付款 + 有效 + 已過入住日期
        if (!isSuperAdmin) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const checkInDate = new Date(booking.check_in_date);
            checkInDate.setHours(0, 0, 0, 0);
            const isPastCheckIn = checkInDate < today;
            
            if (booking.payment_status === 'paid' && booking.status === 'active' && isPastCheckIn) {
                return res.status(403).json({
                    success: false,
                    message: '無法取消已付款且已過入住日期的訂房，請聯繫超級管理員'
                });
            }
        }
        
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
}

// API: 刪除訂房（僅限已取消的訂房）
async function handleDeleteBooking(req, res) {
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
}

// ==================== 房型管理 API ====================

// API: 取得所有房型（公開，供前台使用）
app.get('/api/room-types', publicLimiter, async (req, res) => {
    try {
        const [roomTypes, allGalleryImages, allSettings] = await Promise.all([
            db.getAllRoomTypes(),
            db.getAllRoomTypeGalleryImages(),
            db.getAllSettings()
        ]);

        const galleryMap = {};
        (allGalleryImages || []).forEach((image) => {
            const roomTypeId = Number(image.room_type_id);
            if (!galleryMap[roomTypeId]) {
                galleryMap[roomTypeId] = [];
            }
            if (image.image_url) {
                galleryMap[roomTypeId].push(image.image_url);
            }
        });

        const settingsMap = {};
        (allSettings || []).forEach((setting) => {
            settingsMap[setting.key] = setting.value;
        });
        const bedTypeKeywords = new Set(['單人床', '雙人床', '加大雙人床', '特大雙人床', '上下鋪', '和式床墊', '沙發床']);

        const normalizedRoomTypes = (roomTypes || []).map((roomType) => {
            const roomTypeId = Number(roomType.id);
            const featureKey = `landing_roomtype_${roomTypeId}_features`;
            const featureText = String(settingsMap[featureKey] || '').trim();
            const featureItems = featureText
                ? featureText.split(',').map((item) => item.trim()).filter(Boolean)
                : [];
            const bedTypes = featureItems.filter((item) => bedTypeKeywords.has(item));
            const roomFacilities = featureItems.filter((item) => !bedTypeKeywords.has(item));
            const includedItems = String(roomType.included_items || '')
                .split(/[,，、\n]/)
                .map((item) => item.trim())
                .filter(Boolean);
            const galleryImages = galleryMap[roomTypeId] || [];

            return {
                ...roomType,
                bed_types: bedTypes,
                room_facilities: roomFacilities,
                included_items_list: includedItems,
                gallery_images: galleryImages
            };
        });

        res.json({
            success: true,
            data: normalizedRoomTypes
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
app.get('/api/admin/room-types', requireAuth, checkPermission('room_types.view'), adminLimiter, async (req, res) => {
    try {
        // 使用資料庫抽象層，支援 PostgreSQL 和 SQLite
        const roomTypes = await db.getAllRoomTypesAdmin();
        res.json({
            success: true,
            data: roomTypes
        });
    } catch (error) {
        console.error('取得房型列表錯誤:', error.message);
        console.error('錯誤堆疊:', error.stack);
        res.status(500).json({
            success: false,
            message: '取得房型列表失敗: ' + (error.message || '伺服器內部錯誤，請稍後再試')
        });
    }
});

// API: 新增房型
app.post('/api/admin/room-types', requireAuth, checkPermission('room_types.create'), adminLimiter, validateRoomType, async (req, res) => {
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
app.put('/api/admin/room-types/:id', requireAuth, checkPermission('room_types.edit'), adminLimiter, validateRoomType, async (req, res) => {
    try {
        const { id } = req.params;
        const roomData = req.body;
        
        console.log(`📝 更新房型 ID=${id}, 資料:`, JSON.stringify({
            display_name: roomData.display_name,
            price: roomData.price,
            original_price: roomData.original_price,
            holiday_surcharge: roomData.holiday_surcharge
        }));
        
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
        console.error('❌ 更新房型錯誤:', error.message);
        console.error('❌ 錯誤堆疊:', error.stack);
        res.status(500).json({
            success: false,
            message: '更新房型失敗: ' + error.message
        });
    }
});

// API: 上傳房型圖片
app.post('/api/admin/room-types/upload-image', requireAuth, checkPermission('room_types.edit'), (req, res) => {
    uploadImage.single('image')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: '圖片大小不可超過 5MB' });
            }
            return res.status(400).json({ success: false, message: '上傳失敗: ' + err.message });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: '請選擇要上傳的圖片' });
        }

        try {
            const fileName = storage.generateFileName(req.file.originalname, 'room');
            const imageUrl = await storage.uploadFile(req.file.buffer, fileName, req.file.mimetype);
            console.log(`✅ 房型圖片已上傳: ${imageUrl}`);

            res.json({
                success: true,
                message: '圖片上傳成功',
                data: { image_url: imageUrl }
            });
        } catch (error) {
            console.error('上傳圖片錯誤:', error);
            res.status(500).json({ success: false, message: '上傳圖片失敗: ' + error.message });
        }
    });
});

// API: 刪除房型圖片
app.delete('/api/admin/room-types/delete-image', requireAuth, checkPermission('room_types.edit'), adminLimiter, async (req, res) => {
    try {
        const { image_url } = req.body;
        if (!image_url) {
            return res.status(400).json({ success: false, message: '請提供圖片路徑' });
        }

        await storage.deleteFile(image_url);
        console.log(`🗑️ 房型圖片已刪除: ${image_url}`);

        res.json({ success: true, message: '圖片已刪除' });
    } catch (error) {
        console.error('刪除圖片錯誤:', error);
        res.status(500).json({ success: false, message: '刪除圖片失敗: ' + error.message });
    }
});

// ==================== 房型圖庫 API ====================

// API: 取得房型圖庫
app.get('/api/admin/room-types/:id/gallery', requireAuth, checkPermission('room_types.view'), adminLimiter, async (req, res) => {
    try {
        const images = await db.getRoomTypeGalleryImages(parseInt(req.params.id));
        res.json({ success: true, data: images });
    } catch (error) {
        console.error('取得房型圖庫錯誤:', error);
        res.status(500).json({ success: false, message: '取得圖庫失敗: ' + error.message });
    }
});

// API: 上傳房型圖庫圖片
app.post('/api/admin/room-types/:id/gallery', requireAuth, checkPermission('room_types.edit'), (req, res) => {
    uploadImage.single('image')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: '圖片大小不可超過 5MB' });
            }
            return res.status(400).json({ success: false, message: '上傳失敗: ' + err.message });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: '請選擇要上傳的圖片' });
        }

        try {
            const roomTypeId = parseInt(req.params.id);
            const fileName = storage.generateFileName(req.file.originalname, 'gallery');
            const imageUrl = await storage.uploadFile(req.file.buffer, fileName, req.file.mimetype);
            const existing = await db.getRoomTypeGalleryImages(roomTypeId);
            const displayOrder = existing.length;
            const newId = await db.addRoomTypeGalleryImage(roomTypeId, imageUrl, displayOrder);
            console.log(`✅ 圖庫圖片已上傳: ${imageUrl} (房型ID: ${roomTypeId})`);
            res.json({
                success: true,
                message: '圖庫圖片上傳成功',
                data: { id: newId, image_url: imageUrl, display_order: displayOrder }
            });
        } catch (error) {
            console.error('上傳圖庫圖片錯誤:', error);
            res.status(500).json({ success: false, message: '上傳失敗: ' + error.message });
        }
    });
});

// API: 刪除房型圖庫圖片
app.delete('/api/admin/room-types/gallery/:imageId', requireAuth, checkPermission('room_types.edit'), adminLimiter, async (req, res) => {
    try {
        const imageId = parseInt(req.params.imageId);
        const allImages = await db.getAllRoomTypeGalleryImages();
        const target = allImages.find(img => img.id === imageId);

        if (target && target.image_url) {
            await storage.deleteFile(target.image_url);
        }

        await db.deleteRoomTypeGalleryImage(imageId);
        res.json({ success: true, message: '圖庫圖片已刪除' });
    } catch (error) {
        console.error('刪除圖庫圖片錯誤:', error);
        res.status(500).json({ success: false, message: '刪除圖庫圖片失敗: ' + error.message });
    }
});

// ==================== 假日管理 API ====================

// API: 取得所有假日
app.get('/api/admin/holidays', requireAuth, checkPermission('room_types.view'), adminLimiter, async (req, res) => {
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
app.post('/api/admin/holidays', requireAuth, checkPermission('room_types.edit'), adminLimiter, validateHoliday, async (req, res) => {
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
app.delete('/api/admin/holidays/:date', requireAuth, checkPermission('room_types.edit'), adminLimiter, async (req, res) => {
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
app.delete('/api/admin/room-types/:id', requireAuth, checkPermission('room_types.delete'), adminLimiter, async (req, res) => {
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
app.get('/api/admin/addons', requireAuth, checkPermission('addons.view'), adminLimiter, async (req, res) => {
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
app.post('/api/admin/addons', requireAuth, checkPermission('addons.create'), adminLimiter, validateAddon, async (req, res) => {
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
app.put('/api/admin/addons/:id', requireAuth, checkPermission('addons.edit'), adminLimiter, validateAddon, async (req, res) => {
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
app.delete('/api/admin/addons/:id', requireAuth, checkPermission('addons.delete'), adminLimiter, async (req, res) => {
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
        
        // 加入 LINE 設定（優先使用資料庫設定，其次使用環境變數）
        if (!settingsObj.line_channel_access_token && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
            settingsObj.line_channel_access_token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        }
        if (!settingsObj.line_channel_secret && process.env.LINE_CHANNEL_SECRET) {
            settingsObj.line_channel_secret = process.env.LINE_CHANNEL_SECRET;
        }
        if (!settingsObj.line_liff_id && process.env.LINE_LIFF_ID) {
            settingsObj.line_liff_id = process.env.LINE_LIFF_ID;
        }
        if (!settingsObj.line_liff_url && process.env.LINE_LIFF_URL) {
            settingsObj.line_liff_url = process.env.LINE_LIFF_URL;
        }
        
        // 確保所有 LINE 設定欄位都存在（即使為空）
        settingsObj.line_channel_access_token = settingsObj.line_channel_access_token || '';
        settingsObj.line_channel_secret = settingsObj.line_channel_secret || '';
        settingsObj.line_liff_id = settingsObj.line_liff_id || '';
        settingsObj.line_liff_url = settingsObj.line_liff_url || '';
        
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
app.put('/api/admin/settings/:key', requireAuth, checkPermission('settings.edit'), adminLimiter, async (req, res) => {
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

// API: 上傳銷售頁圖片（共用房型上傳的 multer 設定）
app.post('/api/admin/landing/upload-image', requireAuth, (req, res) => {
    uploadImage.single('image')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: '圖片大小不可超過 5MB' });
            }
            return res.status(400).json({ success: false, message: '上傳失敗: ' + err.message });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: '請選擇要上傳的圖片' });
        }

        try {
            const fileName = storage.generateFileName(req.file.originalname, 'landing');
            const imageUrl = await storage.uploadFile(req.file.buffer, fileName, req.file.mimetype);
            console.log(`✅ 銷售頁圖片已上傳: ${imageUrl}`);

            res.json({
                success: true,
                message: '圖片上傳成功',
                data: { image_url: imageUrl }
            });
        } catch (error) {
            console.error('上傳銷售頁圖片錯誤:', error);
            res.status(500).json({ success: false, message: '上傳圖片失敗: ' + error.message });
        }
    });
});

// API: 取得銷售頁設定（公開）
app.get('/api/landing-settings', publicLimiter, async (req, res) => {
    try {
        const { landingSettings, landingRoomTypes } = await getLandingPagePayload();

        res.json({
            success: true,
            data: landingSettings,
            roomTypes: landingRoomTypes
        });
    } catch (error) {
        console.error('取得銷售頁設定錯誤:', error);
        res.status(500).json({
            success: false,
            message: '取得銷售頁設定失敗'
        });
    }
});

const paymentService = createPaymentService({
    db,
    notificationService,
    logPaymentEvent,
    processEnv: process.env
});

const paymentController = createPaymentController({
    db,
    paymentClient: payment,
    paymentService,
    logPaymentEvent
});

app.use('/api/payment', createPaymentRoutes({
    controller: paymentController,
    paymentLimiter
}));

// API: 檢查郵件服務狀態（Resend/Gmail）
app.get('/api/admin/email-service-status', requireAuth, checkPermission('email_templates.view'), adminLimiter, async (req, res) => {
    try {
        // 檢查 Resend 套件
        const resendPackageInstalled = Resend !== null;
        
        // 檢查 Resend API Key（資料庫和環境變數）
        const resendApiKeyFromDB = await db.getSetting('resend_api_key');
        const resendApiKeyFromEnv = process.env.RESEND_API_KEY;
        const resendApiKey = resendApiKeyFromDB || resendApiKeyFromEnv;
        const resendApiKeySource = resendApiKeyFromDB ? '資料庫' : (resendApiKeyFromEnv ? '環境變數' : '未設定');
        
        // 檢查 Resend 客戶端狀態
        const resendClientInitialized = emailRuntime.resendClient !== null;
        const currentProvider = emailRuntime.emailServiceProvider;
        
        // 檢查發件人資訊
        const resendSenderName = (await db.getSetting('resend_sender_name') || '').trim();
        const emailUser = (await db.getSetting('email_user') || '').trim();
        const effectiveSenderEmail = getConfiguredSenderEmail(emailRuntime) || emailUser;
        
        // 檢查 Gmail 設定（作為備用）
        const gmailClientID = await db.getSetting('gmail_client_id') || process.env.GMAIL_CLIENT_ID;
        const gmailClientSecret = await db.getSetting('gmail_client_secret') || process.env.GMAIL_CLIENT_SECRET;
        const gmailRefreshToken = await db.getSetting('gmail_refresh_token') || process.env.GMAIL_REFRESH_TOKEN;
        const gmailOAuth2Configured = !!(gmailClientID && gmailClientSecret && gmailRefreshToken);
        
        // 構建狀態報告
        const status = {
            resend: {
                packageInstalled: resendPackageInstalled,
                apiKeyConfigured: !!resendApiKey,
                apiKeySource: resendApiKeySource,
                apiKeyPrefix: resendApiKey ? resendApiKey.substring(0, 5) + '...' : null,
                clientInitialized: resendClientInitialized,
                status: resendPackageInstalled && resendApiKey && resendClientInitialized ? '已啟用' : '未啟用'
            },
            gmail: {
                oauth2Configured: gmailOAuth2Configured,
                status: gmailOAuth2Configured ? '已設定（備用）' : '未設定'
            },
            currentProvider: currentProvider,
            senderEmail: effectiveSenderEmail || '未設定',
            senderName: resendSenderName || '未設定',
            recommendations: []
        };
        
        // 添加建議
        if (!resendPackageInstalled) {
            status.recommendations.push('❌ Resend 套件未安裝，請執行: npm install resend@6.7.0');
        }
        if (!resendApiKey) {
            status.recommendations.push('⚠️ Resend API Key 未設定，請在管理後台或環境變數中設定');
        }
        if (resendApiKey && !resendClientInitialized) {
            status.recommendations.push('⚠️ Resend API Key 已設定但客戶端未初始化，請重新啟動伺服器');
        }
        if (currentProvider === 'resend' && effectiveSenderEmail === 'resend@resend.dev') {
            status.recommendations.push('⚠️ 目前使用 Resend 測試寄件人，建議在「Gmail 帳號(email_user)」或環境變數 RESEND_FROM_EMAIL 設定自有網域寄件信箱');
        }
        if (currentProvider !== 'resend' && !effectiveSenderEmail) {
            status.recommendations.push('⚠️ 發件人信箱未設定，請在「Gmail 發信設定」設定「Gmail 帳號」');
        }
        if (resendPackageInstalled && resendApiKey && resendClientInitialized && effectiveSenderEmail) {
            status.recommendations.push('✅ Resend 設定完整，可以正常發送郵件');
        }
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('檢查郵件服務狀態錯誤:', error);
        res.status(500).json({
            success: false,
            message: '檢查郵件服務狀態失敗: ' + error.message
        });
    }
});

// ==================== 郵件模板 API ====================

// API: 取得所有郵件模板
app.get('/api/email-templates', requireAuth, checkPermission('email_templates.view'), adminLimiter, async (req, res) => {
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
app.get('/api/email-templates/:key', requireAuth, checkPermission('email_templates.view'), adminLimiter, async (req, res) => {
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
app.put('/api/email-templates/:key', requireAuth, checkPermission('email_templates.edit'), adminLimiter, async (req, res) => {
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
            send_hour_payment_reminder,
            blockSettings  // 入住提醒郵件的區塊設定
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
        
        // 直接使用前端傳來的內容，不進行自動修復
        // 前端已經處理好 HTML 結構，後端不應該修改用戶編輯的內容
        let finalContent = content;
        
        console.log(`📝 保存郵件模板內容 (${key}):`, {
            contentLength: finalContent.length,
            hasFullHtmlStructure: finalContent.includes('<!DOCTYPE html>') || (finalContent.includes('<html') && finalContent.includes('</html>')),
            hasStyleTag: finalContent.includes('<style>') || finalContent.includes('<style '),
            contentPreview: finalContent.substring(0, 200)
        });
        
        // 只在內容完全為空時才進行修復（不應該發生，因為前端已經驗證）
        if (!finalContent || finalContent.trim() === '') {
            console.error('❌ 保存的模板內容為空，這不應該發生');
            return res.status(400).json({
                success: false,
                message: '郵件模板內容不能為空'
            });
        }
        
        // 移除自動修復邏輯，直接使用前端傳來的內容
        // 前端已經處理好 HTML 結構，後端不應該修改用戶編輯的內容
        
        // 準備更新資料
        // 將啟用狀態標準化為布林值：1/true => true，其餘（0/undefined/null/false）皆為 false
        const normalizedEnabled = (is_enabled === 1 || is_enabled === true);

        const updateData = {
            template_name,
            subject,
            content: finalContent,  // 使用修復後的內容
            is_enabled: normalizedEnabled,
            days_before_checkin,
            send_hour_checkin,
            days_after_checkout,
            send_hour_feedback,
            days_reserved,
            send_hour_payment_reminder
        };
        
        // 如果有 blockSettings，添加到更新資料中
        if (blockSettings !== undefined) {
            // blockSettings 可能是物件或字串（JSON），統一轉換為字串
            updateData.block_settings = typeof blockSettings === 'string' 
                ? blockSettings 
                : JSON.stringify(blockSettings);
            console.log('✅ 包含區塊設定，將一併更新');
        }
        
        const result = await db.updateEmailTemplate(key, updateData);
        
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
app.post('/api/email-templates/:key/test', requireAuth, checkPermission('email_templates.send_test'), adminLimiter, async (req, res) => {
    try {
        const { key } = req.params;
        const { email, useEditorContent } = req.body;
        
        // 獲取 emailUser 設定
        const emailUser = await getRequiredEmailUser('發送測試郵件');
        
        if (!email) {
            return res.status(400).json({
                success: false,
                message: '請提供 Email 地址'
            });
        }
        
        // 優先從資料庫讀取最新的模板內容（確保使用最新的優化版本）
        // 如果前端明確要求使用編輯器中的內容，則使用 req.body 中的內容覆蓋
        let content, subject;
        let template = null; // 確保 template 變數在整個函數中可用
        
        // 先從資料庫讀取最新的模板內容（確保使用最新的優化版本）
        template = await db.getEmailTemplateByKey(key);
        if (!template) {
            return res.status(404).json({
                success: false,
                message: '找不到該郵件模板'
            });
        }
        
        // 預設使用資料庫中的最新內容
        content = template.content;
        subject = template.subject;
        
        // 添加日誌以確認從資料庫讀取的內容
        console.log(`📧 測試郵件：從資料庫讀取模板 (${key})`);
        console.log(`   內容長度: ${content.length} 字元`);
        console.log(`   主旨: ${subject}`);
        
        // 如果前端明確要求使用編輯器中的內容，則覆蓋資料庫中的值
        if (useEditorContent && req.body.content && req.body.subject) {
            // 使用編輯器中的內容（用戶修改後的內容）
            content = req.body.content;
            subject = req.body.subject;
            console.log(`📧 測試郵件：使用編輯器中的內容 (${key})`);
            console.log(`   內容長度: ${content.length} 字元`);
            console.log(`   主旨: ${subject}`);
            
            // 使用編輯器中的內容和主題覆蓋資料庫中的值（用於測試郵件）
            template.content = content;
            template.subject = subject;
            console.log(`✅ 已將編輯器內容設置到模板物件`);
        } else {
            // 使用資料庫中的最新內容（預設行為）
            // 重要：即使前端發送了 content，也不使用它，確保使用資料庫中的完整內容
            console.log(`📧 測試郵件：使用資料庫中的最新內容 (${key})`);
            console.log(`   內容長度: ${content.length} 字元`);
            console.log(`   主旨: ${subject}`);
            console.log(`   前端是否發送了 content: ${!!req.body.content}`);
            if (req.body.content) {
                console.log(`   前端發送的 content 長度: ${req.body.content.length} 字元（將被忽略）`);
            }
            
            // 確保使用資料庫中的完整內容，不使用前端發送的任何 content
            // template.content 和 template.subject 已經從資料庫讀取，不需要修改
            // 入住提醒郵件直接使用完整的模板內容，不使用 block_settings
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
        
        // 檢查是否為入住提醒郵件（需要在整個函數中使用）
        const isCheckinReminder = key === 'checkin_reminder';
        
        // 計算日期
        const today = new Date();
        const checkInDate = new Date(today.getTime() + randomInt(1, 30) * 24 * 60 * 60 * 1000);
        const checkOutDate = new Date(checkInDate.getTime() + randomInt(1, 7) * 24 * 60 * 60 * 1000);
        const nights = Math.max(1, Math.round((checkOutDate - checkInDate) / (24 * 60 * 60 * 1000)));
        const paymentDeadlineDate = new Date(today.getTime() + randomInt(1, 7) * 24 * 60 * 60 * 1000);
        
        const hotelDefaults = await getHotelSettingsWithFallback();

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
            paymentAmount: ['全額 NT$ ' + randomAmount(2000, 8000), '訂金 NT$ ' + randomAmount(2000, 8000), '訂金 NT$ ' + randomAmount(2000, 8000)][randomInt(0, 2)],
            guestPhone: '09' + Array.from({length: 8}, () => randomInt(0, 9)).join(''),
            guestEmail: 'test' + randomInt(1000, 9999) + '@example.com',
            bookingDate: today.toLocaleDateString('zh-TW'),
            bookingDateTime: today.toLocaleString('zh-TW'),
            bookingIdLast5: (Date.now().toString().slice(-6) + randomInt(100, 999)).slice(-5),
            hotelEmail: hotelDefaults.hotelEmail,
            hotelPhone: hotelDefaults.hotelPhone
        };
        
        // 確保使用正確的模板內容
        // 如果使用編輯器內容，template.content 和 template.subject 已經在第 4284-4285 行設置
        // 如果沒有使用編輯器內容，則使用資料庫中的內容（template.content 和 template.subject 已經從資料庫讀取）
        // 這裡不需要再次設置，因為已經在 useEditorContent 分支中處理過了
        
        // 創建模擬的 booking 對象，用於 replaceTemplateVariables 函數
        const totalAmount = parseInt(testData.totalAmount.replace(/,/g, ''));
        
        // 計算測試資料的折扣金額和折後總額（用於測試折扣顯示）
        const testDiscountAmount = randomInt(100, 1000); // 隨機折扣金額
        const testDiscountedTotal = Math.max(0, totalAmount - testDiscountAmount);
        
        // 計算測試資料的剩餘尾款（如果是訂金，則計算剩餘尾款）
        const testFinalAmount = parseInt(testData.finalAmount.replace(/,/g, ''));
        const testRemainingAmount = testData.paymentAmount.includes('訂金') ? (totalAmount - testFinalAmount) : 0;
        
        const mockBooking = {
            guest_name: testData.guestName,
            booking_id: testData.bookingId,
            check_in_date: checkInDate.toISOString().split('T')[0],
            check_out_date: checkOutDate.toISOString().split('T')[0],
            room_type: testData.roomType,
            price_per_night: parseInt(testData.pricePerNight.replace(/,/g, '')),
            total_amount: totalAmount,
            final_amount: testFinalAmount,
            remaining_amount: testRemainingAmount,
            payment_method: testData.paymentMethod,
            payment_amount: testData.paymentAmount,
            payment_status: 'pending',
            guest_phone: testData.guestPhone,
            guest_email: testData.guestEmail,
            booking_date: today.toISOString().split('T')[0],
            payment_deadline: paymentDeadlineDate.toISOString().split('T')[0],
            days_reserved: parseInt(testData.daysReserved),
            addons: testData.addonsList,
            addons_total: parseInt(testData.addonsTotal.replace(/,/g, '')),
            // 添加折扣資訊（用於測試折扣顯示）
            discount_amount: testDiscountAmount,
            discountAmount: testDiscountAmount,
            original_amount: totalAmount,
            originalAmount: totalAmount,
            discountedTotal: testDiscountedTotal
        };
        
        // 準備 additionalData（與實際發送時一致）
        const additionalData = {
            ...(testData.hotelEmail ? { '{{hotelEmail}}': testData.hotelEmail } : {}),
            ...(testData.hotelPhone ? { '{{hotelPhone}}': testData.hotelPhone } : {})
        };
        
        // 準備測試用的 bankInfo（與實際發送時一致）
        const testBankInfo = {
            bankName: await db.getSetting('bank_name') || testData.bankName,
            bankBranch: await db.getSetting('bank_branch') || testData.bankBranch,
            account: await db.getSetting('bank_account') || testData.bankAccount,
            accountName: await db.getSetting('account_name') || testData.accountName
        };
        
        // 使用與實際發送相同的 generateEmailFromTemplate 函數（與訂房確認邏輯一致）
        // 這確保測試郵件與實際發送的郵件完全一致
        let testContent, testSubject;
        try {
            // 優先使用 generateEmailFromTemplate（與實際發送邏輯一致）
            const testResult = await generateEmailFromTemplate(key, mockBooking, testBankInfo, additionalData);
            testContent = testResult.content;
            testSubject = testResult.subject;
            console.log('✅ 使用 generateEmailFromTemplate 函數生成測試郵件（與實際發送邏輯一致）');
            console.log(`   模板內容長度: ${template.content.length} 字元`);
            console.log(`   處理後內容長度: ${testContent.length} 字元`);
        } catch (templateError) {
            console.error('⚠️ 使用 generateEmailFromTemplate 失敗，使用備用方案:', templateError.message);
            // 備用方案：使用 replaceTemplateVariables（與實際發送邏輯一致）
            try {
                const testResult = await replaceTemplateVariables(template, mockBooking, testBankInfo, additionalData);
                testContent = testResult.content;
                testSubject = testResult.subject;
                console.log('✅ 使用 replaceTemplateVariables 函數生成測試郵件（備用方案）');
            } catch (error) {
                console.error('❌ 使用 replaceTemplateVariables 也失敗:', error);
                throw error;
            }
        }
        
        // 確保測試郵件使用資料庫中的完整 HTML 模板內容
        // replaceTemplateVariables 已經處理了所有變數替換和條件區塊處理
        // 直接使用處理後的內容，不進行額外的檢查或修復，確保與實際郵件完全一致
        
        // 注意：不再進行強制修復，因為：
        // 1. 實際郵件發送時直接使用 replaceTemplateVariables 的結果
        // 2. 如果模板已經有完整結構，replaceTemplateVariables 不會修改它
        // 3. 這樣可以確保測試郵件和實際郵件完全一致
        
        // 僅記錄日誌，不進行修復
        const finalCheckHasFullHtml = testContent.includes('<!DOCTYPE html>') || 
                                      (testContent.includes('<html') && testContent.includes('</html>'));
        const finalCheckHasStyleTag = testContent.includes('<style>') || testContent.includes('<style ');
        const finalCheckHasContainer = testContent.includes('class="container') || testContent.includes("class='container");
        const finalCheckHasHeader = testContent.includes('class="header') || testContent.includes("class='header");
        const finalCheckHasContent = testContent.includes('class="content') || testContent.includes("class='content");
        
        console.log('📧 測試郵件結構檢查:', {
            key,
            hasFullHtml: finalCheckHasFullHtml,
            hasStyleTag: finalCheckHasStyleTag,
            hasContainer: finalCheckHasContainer,
            hasHeader: finalCheckHasHeader,
            hasContent: finalCheckHasContent,
            contentLength: testContent.length
        });
        
        // 不再進行強制修復，直接使用 replaceTemplateVariables 的結果
        // 如果模板結構不完整，replaceTemplateVariables 會處理（與實際郵件一致）
        if (false) { // 永遠不執行修復邏輯
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
            <h1>🏨 ${template ? (template.template_name || template.name || '郵件') : '郵件'}</h1>
        </div>
        <div class="content">
            ${bodyContent}
        </div>
    </div>
</body>
</html>`;
            
            console.log('✅ 最終修復完成，測試郵件現在包含完整的圖卡樣式');
        }
        
        // 不再進行額外的檢查和修復，直接使用 replaceTemplateVariables 的結果
        // 這樣可以確保測試郵件和實際郵件完全一致
        
        // 不再自動添加旅館資訊 footer
        
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
        
        // 確保 testContent 和 testSubject 已定義
        if (!testContent || !testSubject) {
            console.error('❌ 測試郵件內容或主旨未定義:', {
                hasTestContent: !!testContent,
                hasTestSubject: !!testSubject,
                testContentLength: testContent ? testContent.length : 0,
                testSubject: testSubject
            });
            return res.status(500).json({
                success: false,
                message: '發送測試郵件失敗：郵件內容或主旨未正確生成'
            });
        }
        
        // 確保測試郵件主旨前加上 [測試]（如果還沒有的話）
        const finalTestSubject = testSubject.startsWith('[測試]') ? testSubject : `[測試] ${testSubject}`;
        
        console.log('📧 準備發送測試郵件:', {
            to: email,
            subject: finalTestSubject,
            contentLength: testContent.length,
            hasHtml: testContent.includes('<html'),
            hasStyle: testContent.includes('<style')
        });
        
        // 發送測試郵件（使用統一函數，自動選擇 Resend 或 Gmail）
        const mailOptions = {
            from: emailUser,
            to: email,
            subject: finalTestSubject,
            html: testContent
        };
        
        try {
            const emailResult = await sendEmail(mailOptions);
            console.log('✅ 測試郵件發送成功:', {
                to: email,
                messageId: emailResult?.messageId,
                accepted: emailResult?.accepted
            });
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

// API: 重置郵件模板為預設圖卡樣式
app.post('/api/email-templates/reset-to-default', requireAuth, checkPermission('email_templates.edit'), adminLimiter, async (req, res) => {
    try {
        // 使用圖卡樣式的模板
        const fallbackTemplates = [
            {
                key: 'payment_reminder',
                name: '匯款提醒',
                subject: '【重要提醒】匯款期限即將到期',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #e74c3c; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0; text-align: center; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-box { background: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; font-weight: 500; flex: 1 1 auto; text-align: right; word-break: break-word; }
        .info-value strong { color: #e74c3c; font-weight: 700; }
        .remaining-box { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        h2 { color: #333; font-size: 20px; font-weight: bold; margin: 0 0 15px 0; }
        p { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        strong { color: #333; font-weight: 700; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .content { padding: 20px 15px; }
            .highlight-box { padding: 15px; margin: 20px 0; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            h2 { font-size: 18px; margin: 0 0 12px 0; }
            p { font-size: 15px; }
            .remaining-box { padding: 15px; margin: 20px 0; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⏰ 匯款期限提醒</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p>感謝您選擇我們的住宿服務！</p>
            
            <div class="highlight-box">
                <h2 style="margin-top: 0; color: #856404;">⚠️ 重要提醒</h2>
                <p style="margin: 0; color: #856404;">此訂房將為您保留 {{daysReserved}} 天，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。</p>
            </div>
            
            <div class="info-box">
                <h2 style="margin-top: 0;">訂房資訊</h2>
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
                <div class="info-row" style="margin-top: 10px; padding-top: 15px; border-top: 2px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px;">總金額</span>
                    <span class="info-value" style="font-size: 18px; font-weight: 700;">NT$ {{totalAmount}}</span>
                </div>
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 18px; font-weight: 700; color: #e74c3c;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row" style="border-top: 2px solid #e0e0e0; padding-top: 15px; margin-top: 10px;">
                    <span class="info-label" style="font-size: 18px;">應付金額</span>
                    <span class="info-value" style="font-size: 18px; font-weight: 700; color: #e74c3c;">NT$ {{finalAmount}}</span>
                </div>
            </div>
            
            <div class="highlight-box">
                <h2 style="margin-top: 0; color: #856404;">💰 匯款資訊</h2>
                <p style="margin: 8px 0;"><strong>銀行：</strong>{{bankName}}{{bankBranchDisplay}}</p>
                <p style="margin: 8px 0;"><strong>帳號：</strong><strong style="color: #e74c3c;">{{bankAccount}}</strong></p>
                <p style="margin: 8px 0;"><strong>戶名：</strong>{{accountName}}</p>
                <p style="margin: 15px 0 0 0; padding-top: 15px; border-top: 1px solid #ffc107;">請在匯款時備註訂房編號後5碼：<strong>{{bookingIdLast5}}</strong></p>
                <p style="margin: 8px 0 0 0;">匯款後請加入官方LINE告知，謝謝！</p>
            </div>
            
            {{#if isDeposit}}
            <div class="remaining-box">
                <h2 style="margin-top: 0; color: #2e7d32;">💡 剩餘尾款於現場付清！</h2>
                <p style="margin: 10px 0 0 0; color: #2e7d32; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}
            
            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            <p style="margin-top: 20px;">如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
    {{hotelInfoFooter}}
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #2196f3; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
        .section-content { font-size: 16px; line-height: 1.8; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            ul { padding-left: 25px; }
            li { font-size: 15px; }
            .highlight-box { padding: 15px; margin: 20px 0; }
            .info-section { padding: 15px; margin: 20px 0; }
            .info-section-title { font-size: 18px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
            <p>歡迎您明天的到來</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}} 您好，</p>
            <p class="intro-text">感謝您選擇我們的住宿服務，我們期待您明天的到來。</p>
            
            {{#if showBookingInfo}}
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 訂房資訊</div>
                {{bookingInfoContent}}
            </div>
            {{/if}}
            
            {{#if showTransport}}
            <div class="info-section">
                <div class="info-section-title">📍 交通路線</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>地址：</strong>{{hotelAddress}}</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>大眾運輸：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
                    <li style="margin: 4px 0; font-size: 16px;">公車：搭乘20、32、46路公車至「信義行政中心站」</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>自行開車：</strong></p>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">國道一號：下「信義交流道」，沿信義路直行約3公里</li>
                    <li style="margin: 4px 0; font-size: 16px;">國道三號：下「木柵交流道」，接信義快速道路</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showParking}}
            <div class="info-section">
                <div class="info-section-title">🅿️ 停車資訊</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">住宿客人：每日 NT$ 200 (可無限次進出)</li>
                    <li style="margin: 4px 0; font-size: 16px;">臨時停車：每小時 NT$ 50</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24小時</p>
                <p style="margin: 0; font-size: 16px; color: #856404;">⚠️ 停車位有限，建議提前預約</p>
            </div>
            {{/if}}
            
            {{#if showNotes}}
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #856404; justify-content: center;">⚠️ 入住注意事項</div>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 8px 0; font-size: 16px;">入住時間：下午3:00後</li>
                    <li style="margin: 8px 0; font-size: 16px;">退房時間：上午11:30前</li>
                    <li style="margin: 8px 0; font-size: 16px;">請攜帶身分證件辦理入住手續</li>
                    <li style="margin: 8px 0; font-size: 16px;">房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>
                    <li style="margin: 8px 0; font-size: 16px;">請保持安靜，避免影響其他住客</li>
                    <li style="margin: 8px 0; font-size: 16px;">貴重物品請妥善保管，建議使用房間保險箱</li>
                    <li style="margin: 8px 0; font-size: 16px;">如需延遲退房，請提前告知櫃檯</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showContact}}
            <div class="info-section">
                <div class="info-section-title">📞 聯絡資訊</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如有任何問題，歡迎隨時聯繫我們：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            {{/if}}
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待您的到來，祝您住宿愉快！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
        </div>
    </div>
</body>
</html>`,
                days_before_checkin: 1,
                send_hour_checkin: 9,
                block_settings: JSON.stringify({
                    booking_info: {
                        enabled: true,
                        content: `<div class="info-row">
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
<div class="info-row" style="border-bottom: none;">
    <span class="info-label">房型</span>
    <span class="info-value">{{roomType}}</span>
</div>`
                    },
                    transport: {
                        enabled: true,
                        content: '' // 空字串表示使用代碼中的預設值（已更新為新格式）
                    },
                    parking: {
                        enabled: true,
                        content: '' // 空字串表示使用代碼中的預設值（已更新為新格式）
                    },
                    notes: {
                        enabled: true,
                        content: '' // 空字串表示使用代碼中的預設值（已更新為新格式）
                    },
                    contact: {
                        enabled: true,
                        content: `<p style="margin: 0 0 12px 0; font-size: 16px;">如有任何問題，歡迎隨時聯繫我們：</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>電話：</strong>{{hotelPhone}}</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>Email：</strong>{{hotelEmail}}</p>
{{#if officialLineUrl}}<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>官方 LINE：</strong>{{officialLineUrl}}</p>{{/if}}
<p style="margin: 0; font-size: 16px;"><strong>服務時間：</strong>24 小時</p>`
                    }
                })
            },
            {
                key: 'feedback_request',
                name: '感謝入住',
                subject: '【感謝入住】分享您的住宿體驗',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4caf50; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 20px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #2e7d32; margin: 0 0 15px 0; }
        .rating-section { background: #fff9c4; border: 2px solid #fbc02d; border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center; }
        .rating-stars { font-size: 32px; margin: 15px 0; }
        .google-review-btn,
        .google-review-btn:link,
        .google-review-btn:visited { display: inline-block; background: #1a73e8; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; padding: 14px 28px; border-radius: 6px; text-decoration: none !important; font-size: 17px; font-weight: 700; margin-top: 15px; transition: background 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); letter-spacing: 0.5px; }
        .google-review-btn:hover,
        .google-review-btn:active { background: #1557b0; box-shadow: 0 4px 8px rgba(0,0,0,0.3); color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-decoration: none !important; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            ul { padding-left: 25px; }
            li { font-size: 15px; }
            .highlight-box { padding: 15px; margin: 20px 0; }
            .info-section { padding: 15px; margin: 20px 0; }
            .info-section-title { font-size: 18px; }
            .rating-section { padding: 20px 15px; margin: 20px 0; }
            .rating-stars { font-size: 28px; }
            .google-review-btn { display: block; width: 100%; box-sizing: border-box; padding: 12px 16px; font-size: 16px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⭐ 感謝您的入住</h1>
            <p>希望您這次的住宿體驗愉快舒適</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}} 您好，</p>
            <p class="intro-text">感謝您選擇我們的住宿服務！希望您這次的住宿體驗愉快舒適，我們非常重視您的意見與回饋。</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 住宿資訊</div>
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
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
            </div>
            
            <div class="rating-section">
                <div class="section-title" style="margin-top: 0; margin-bottom: 15px; color: #f57f17; justify-content: center;">您的寶貴意見對我們非常重要！</div>
                <p style="margin: 0 0 10px 0; font-size: 17px; font-weight: 600; color: #333;">請為我們的服務評分：</p>
                <div class="rating-stars">⭐⭐⭐⭐⭐</div>
                {{#if googleReviewUrl}}
                <a href="{{googleReviewUrl}}" target="_blank" class="google-review-btn" style="color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; text-decoration:none !important;">在 Google 上給我們評價</a>
                {{/if}}
                <p style="margin: 15px 0 0 0; font-size: 15px; color: #666; line-height: 1.6;">您的評價將幫助其他旅客做出更好的選擇，也讓我們能持續改進服務品質</p>
            </div>
            
            <div class="info-section">
                <div class="info-section-title">💬 意見回饋</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如果您有任何建議、意見或需要協助，歡迎隨時透過以下方式與我們聯繫：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
                <p style="margin: 8px 0 0 0; font-size: 15px; color: #2e7d32; font-weight: 600;">我們會認真聆聽您的意見，並持續改進服務品質！</p>
            </div>
            
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #856404; justify-content: center;">🎁 再次入住優惠</div>
                <p style="margin: 0; font-size: 18px; text-align: center; font-weight: 700; color: #333;">感謝您的支持！</p>
                <p style="margin: 8px 0 0 0; font-size: 17px; text-align: center; font-weight: 600; color: #333;">再次預訂可享有 <strong style="color: #e65100; font-size: 22px;">9 折優惠</strong></p>
                <p style="margin: 12px 0 0 0; font-size: 16px; text-align: center; color: #666; line-height: 1.6;">歡迎隨時與我們聯繫，我們期待再次為您服務</p>
            </div>
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待再次為您服務！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #262A33; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #262A33; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .amount-highlight { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .amount-label { font-size: 18px; font-weight: 600; color: #1976d2; margin-bottom: 8px; }
        .amount-value { font-size: 24px; font-weight: 700; color: #1976d2; }
        .bank-info-box { background: white; padding: 20px; border-radius: 8px; margin-top: 15px; border: 1px solid #ddd; }
        .bank-account { font-size: 20px; color: #e74c3c; font-weight: 700; letter-spacing: 2px; word-break: break-all; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            ul { padding-left: 25px; }
            li { font-size: 15px; }
            .amount-highlight { padding: 15px; margin: 20px 0; }
            .amount-label { font-size: 16px; }
            .amount-value { font-size: 22px; }
            .highlight { padding: 15px; margin: 20px 0; }
            .bank-info-box { padding: 15px; }
            .bank-account { font-size: 18px; letter-spacing: 1px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 訂房確認成功</h1>
            <p>感謝您的預訂！</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}}，</p>
            <p class="intro-text">您的訂房已成功確認，以下是您的訂房資訊：</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">訂房資訊</div>
                <div class="info-row">
                    <span class="info-label">訂房時間</span>
                    <span class="info-value">{{bookingDate}}</span>
                </div>
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
                <div class="info-row" style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ddd;">
                    <span class="info-label" style="font-size: 18px; color: #333;">總金額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700;">NT$ {{totalAmount}}</span>
                </div>
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; color: #333; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700; color: #c62828;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
            </div>

            <div class="amount-highlight">
                <div class="amount-label">{{amountLabel}}</div>
                <div class="amount-value">NT$ {{finalAmount}}</div>
            </div>

            {{#if isDeposit}}
            <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #2e7d32;">💡 剩餘尾款</div>
                <p style="color: #2e7d32; font-weight: 600; margin: 0 0 12px 0; font-size: 17px;">剩餘尾款請於現場付清！</p>
                <p style="color: #2e7d32; margin: 0; font-size: 22px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}

            {{#if isTransfer}}
            <div class="highlight">
                <div class="section-title" style="margin-top: 0; margin-bottom: 15px; color: #856404;">💰 匯款提醒</div>
                <p style="color: #856404; font-weight: 600; margin: 0; font-size: 17px; line-height: 1.8;">
                    ⏰ 此訂房將為您保留 <strong>{{daysReserved}} 天</strong>，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。
                </p>
                {{#if bankInfo}}
                <div class="bank-info-box">
                    <p style="margin: 0 0 15px 0; font-size: 18px; font-weight: 700; color: #333;">匯款資訊：</p>
                    {{#if bankName}}
                    <div class="info-row" style="border-bottom: 1px solid #e0e0e0; padding: 10px 0;">
                        <span class="info-label" style="min-width: auto; font-size: 16px;">銀行</span>
                        <span class="info-value" style="text-align: right; font-size: 16px;">{{bankName}}{{bankBranchDisplay}}</span>
                    </div>
                    {{/if}}
                    <div class="info-row" style="border-bottom: 1px solid #e0e0e0; padding: 10px 0;">
                        <span class="info-label" style="min-width: auto; font-size: 16px;">帳號</span>
                        <span class="info-value" style="text-align: right;"><span class="bank-account">{{bankAccount}}</span></span>
                    </div>
                    {{#if accountName}}
                    <div class="info-row" style="border-bottom: none; padding: 10px 0;">
                        <span class="info-label" style="min-width: auto; font-size: 16px;">戶名</span>
                        <span class="info-value" style="text-align: right; font-size: 16px;">{{accountName}}</span>
                    </div>
                    {{/if}}
                    <p style="margin: 18px 0 0 0; padding-top: 15px; border-top: 1px solid #ddd; color: #666; font-size: 15px; line-height: 1.6;">
                        請在匯款時備註訂房編號後5碼：<strong style="font-size: 16px; color: #333;">{{bookingIdLast5}}</strong>
                    </p>
                    <p style="margin: 8px 0 0 0; color: #666; font-size: 15px; line-height: 1.6;">
                        匯款後請加入官方LINE告知，謝謝！
                    </p>
                </div>
                {{else}}
                <p style="color: #856404; margin: 15px 0 0 0; font-size: 16px;">⚠️ 匯款資訊尚未設定，請聯繫客服取得匯款帳號。</p>
                {{/if}}
            </div>
            {{/if}}
            
            <div style="margin-top: 35px;">
                <div class="section-title">重要提醒</div>
                <ul>
                    <li>請於入住當天攜帶身分證件辦理入住手續</li>
                    <li>如需取消或變更訂房，請提前 3 天通知</li>
                    <li>如有任何問題，請隨時與我們聯繫</li>
                </ul>
            </div>

            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>

            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">感謝您的預訂，期待為您服務！</p>
            <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px; padding-top: 20px; border-top: 1px solid #e0e0e0;">此為系統自動發送郵件，請勿直接回覆</p>
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #e74c3c; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #e74c3c; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        .amount-highlight { background: #ffebee; border: 2px solid #e74c3c; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .amount-label { font-size: 18px; font-weight: 600; color: #c62828; margin-bottom: 8px; }
        .amount-value { font-size: 24px; font-weight: 700; color: #c62828; }
        .contact-section { background: #fff3e0; border: 2px solid #ff9800; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .contact-title { font-size: 20px; font-weight: bold; color: #e65100; margin: 0 0 15px 0; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            .amount-highlight { padding: 15px; margin: 20px 0; }
            .amount-label { font-size: 16px; }
            .amount-value { font-size: 22px; }
            .contact-section { padding: 15px; margin: 20px 0; }
            .contact-title { font-size: 18px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔔 新訂房通知</h1>
            <p>您有一筆新的訂房申請</p>
        </div>
        <div class="content">
            <p class="intro-text">以下是訂房詳細資訊：</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">訂房資訊</div>
                <div class="info-row">
                    <span class="info-label">訂房時間</span>
                    <span class="info-value">{{bookingDate}}</span>
                </div>
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
                <div class="info-row" style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ddd;">
                    <span class="info-label" style="font-size: 18px; color: #333;">總金額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700;">NT$ {{totalAmount}}</span>
                </div>
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; color: #333; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700; color: #c62828;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
            </div>

            <div class="amount-highlight">
                <div class="amount-label">應付金額</div>
                <div class="amount-value">NT$ {{finalAmount}}</div>
            </div>

            <div class="contact-section">
                <div class="contact-title">📞 客戶聯絡資訊</div>
                <div class="info-row" style="border-bottom: 1px solid #ffcc80; padding: 10px 0;">
                    <span class="info-label" style="min-width: auto; font-size: 16px;">客戶姓名</span>
                    <span class="info-value" style="text-align: right; font-size: 16px; font-weight: 600;">{{guestName}}</span>
                </div>
                <div class="info-row" style="border-bottom: 1px solid #ffcc80; padding: 10px 0;">
                    <span class="info-label" style="min-width: auto; font-size: 16px;">聯絡電話</span>
                    <span class="info-value" style="text-align: right; font-size: 16px;">{{guestPhone}}</span>
                </div>
                <div class="info-row" style="border-bottom: none; padding: 10px 0;">
                    <span class="info-label" style="min-width: auto; font-size: 16px;">Email</span>
                    <span class="info-value" style="text-align: right; font-size: 16px;">{{guestEmail}}</span>
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #198754; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #198754; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        .amount-highlight { background: #e8f5e9; border: 2px solid #198754; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .amount-label { font-size: 18px; font-weight: 600; color: #2e7d32; margin-bottom: 8px; }
        .amount-value { font-size: 24px; font-weight: 700; color: #2e7d32; }
        .success-box { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .success-box p { margin: 0; color: #2e7d32; font-weight: 600; font-size: 17px; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            .amount-highlight { padding: 15px; margin: 20px 0; }
            .amount-label { font-size: 16px; }
            .amount-value { font-size: 22px; }
            .success-box { padding: 15px; margin: 20px 0; }
            .success-box p { font-size: 16px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ 付款完成確認</h1>
            <p>感謝您的付款！</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}}，</p>
            <p class="intro-text">我們已確認收到您的付款，以下是您的訂房與付款資訊：</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">訂房與付款資訊</div>
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
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; color: #333; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700; color: #198754;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">付款方式</span>
                    <span class="info-value">{{paymentMethod}}</span>
                </div>
            </div>
            
            <div class="amount-highlight">
                <div class="amount-label">本次已收金額</div>
                <div class="amount-value">NT$ {{finalAmount}}</div>
            </div>
            
            <div class="success-box">
                <p>✅ 付款已完成！</p>
                <p style="margin-top: 10px; font-size: 14px; font-weight: 400;">感謝您的付款，訂房已確認完成。</p>
            </div>
            
            <p>若您後續仍需變更或取消訂房，請儘早與我們聯繫，我們將盡力協助您。</p>
            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            
            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">再次感謝您的預訂，期待您的光臨！</p>
            <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px; padding-top: 20px; border-top: 1px solid #e0e0e0;">此為系統自動發送郵件，請勿直接回覆</p>
            
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #e74c3c; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #e74c3c; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #e74c3c; font-weight: 700; }
        h2 { color: #333; font-size: 20px; font-weight: bold; margin: 0 0 15px 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        strong { color: #333; font-weight: 700; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .rebook-box { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        a { color: #1976d2; text-decoration: underline; word-break: break-word; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            h2 { font-size: 18px; margin: 0 0 12px 0; }
            p { font-size: 15px; }
            .highlight { padding: 15px; margin: 20px 0; }
            .rebook-box { padding: 15px; margin: 20px 0; }
        }
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
            <p>很抱歉通知您，由於超過匯款保留期限，您的訂房已自動取消。以下是取消的訂房資訊：</p>
            
            <div class="info-box">
                <h2 style="margin-top: 0;">取消的訂房資訊</h2>
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
                    <span class="info-value"><strong>NT$ {{finalAmount}}</strong></span>
                </div>
            </div>

            <div class="highlight">
                <h2 style="margin-top: 0; color: #856404;">📌 取消原因</h2>
                <p style="margin: 0; color: #856404;">此訂房因超過匯款保留期限（{{bookingDate}} 起算），且未在期限內完成付款，系統已自動取消。</p>
            </div>

            <div class="rebook-box">
                <h2 style="color: #2e7d32; margin-top: 0;">💡 如需重新訂房</h2>
                <p style="color: #2e7d32; margin: 10px 0;">如果您仍希望預訂，歡迎重新進行訂房。如有任何疑問，請隨時與我們聯繫。</p>
                <p style="color: #2e7d32; margin: 10px 0;"><strong>線上訂房：</strong><a href="{{bookingUrl}}" style="color: #1976d2; text-decoration: underline;">重新訂房</a></p>
                <p style="color: #2e7d32; margin: 10px 0;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: underline;">{{hotelEmail}}</a></p>
                <p style="color: #2e7d32; margin: 10px 0;"><strong>電話：</strong>{{hotelPhone}}</p>
                {{#if officialLineUrl}}
                <p style="color: #2e7d32; margin: 10px 0;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
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
        
        // 使用原始簡單排版樣式的模板（無圖卡樣式）
        const defaultTemplates = fallbackTemplates;
        
        if (templateKey) {
            // 只重置指定的模板
            const template = defaultTemplates.find(t => t.key === templateKey);
            if (!template) {
                return res.status(400).json({
                    success: false,
                    message: '找不到指定的模板'
                });
            }
            
            const updateData = {
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
            };
            
            // 如果是入住提醒模板，也重置 block_settings
            if (template.key === 'checkin_reminder' && template.block_settings) {
                updateData.block_settings = template.block_settings;
            }
            
            // 添加日誌以確認重置的內容
            console.log(`🔄 重置郵件模板: ${template.key}`);
            console.log(`   內容長度: ${template.content.length} 字元`);
            console.log(`   是否有 block_settings: ${!!template.block_settings}`);
            if (template.key === 'checkin_reminder') {
                const hasNewCSS = template.content.includes('linear-gradient(135deg, #262A33') || 
                                  template.content.includes('section-title') ||
                                  template.content.includes('section-content');
                console.log(`   是否包含新的優化 CSS: ${hasNewCSS}`);
            }
            
            await db.updateEmailTemplate(template.key, updateData);
            
            console.log(`✅ 郵件模板「${template.name}」已重置為預設的圖卡樣式`);
            
            res.json({
                success: true,
                message: `郵件模板「${template.name}」已重置為預設的圖卡樣式`
            });
        } else {
            // 更新所有模板為預設原始排版樣式（無圖卡樣式）
            for (const template of defaultTemplates) {
                const updateData = {
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
                };
                
                // 如果是入住提醒模板，也重置 block_settings
                if (template.key === 'checkin_reminder' && template.block_settings) {
                    updateData.block_settings = template.block_settings;
                }
                
                await db.updateEmailTemplate(template.key, updateData);
            }
            
            res.json({
                success: true,
                message: '所有郵件模板已重置為預設的圖卡樣式'
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

// API: 強制更新所有郵件模板為最新版本（用於更新折扣欄位等功能）
app.post('/api/email-templates/force-update', requireAuth, checkPermission('email_templates.edit'), adminLimiter, async (req, res) => {
    try {
        console.log('🔄 強制更新所有郵件模板為最新版本...');
        
        // 重新初始化郵件模板（這會檢查並更新缺少新功能的模板）
        await db.initEmailTemplates();
        
        res.json({
            success: true,
            message: '所有郵件模板已更新為最新版本'
        });
    } catch (error) {
        console.error('❌ 強制更新郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '強制更新郵件模板失敗：' + error.message
        });
    }
});

// API: 獲取預設郵件模板內容（用於還原功能）
app.get('/api/email-templates/:key/default', requireAuth, checkPermission('email_templates.view'), adminLimiter, async (req, res) => {
    try {
        const { key } = req.params;
        
        // 從 database.js 的預設模板中取得對應的模板
        const defaultTemplates = [
            {
                key: 'payment_reminder',
                name: '匯款提醒',
                subject: '【重要提醒】匯款期限即將到期',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #e74c3c; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0; text-align: center; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-box { background: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; font-weight: 500; flex: 1 1 auto; text-align: right; word-break: break-word; }
        .info-value strong { color: #e74c3c; font-weight: 700; }
        .remaining-box { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        h2 { color: #333; font-size: 20px; font-weight: bold; margin: 0 0 15px 0; }
        p { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        strong { color: #333; font-weight: 700; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .content { padding: 20px 15px; }
            .highlight-box { padding: 15px; margin: 20px 0; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            h2 { font-size: 18px; margin: 0 0 12px 0; }
            p { font-size: 15px; }
            .remaining-box { padding: 15px; margin: 20px 0; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⏰ 匯款期限提醒</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p>感謝您選擇我們的住宿服務！</p>
            
            <div class="highlight-box">
                <h2 style="margin-top: 0; color: #856404;">⚠️ 重要提醒</h2>
                <p style="margin: 0; color: #856404;">此訂房將為您保留 {{daysReserved}} 天，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。</p>
            </div>
            
            <div class="info-box">
                <h2 style="margin-top: 0;">訂房資訊</h2>
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
                <div class="info-row" style="margin-top: 10px; padding-top: 15px; border-top: 2px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px;">總金額</span>
                    <span class="info-value" style="font-size: 18px; font-weight: 700;">NT$ {{totalAmount}}</span>
                </div>
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 18px; font-weight: 700; color: #e74c3c;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row" style="border-top: 2px solid #e0e0e0; padding-top: 15px; margin-top: 10px;">
                    <span class="info-label" style="font-size: 18px;">應付金額</span>
                    <span class="info-value" style="font-size: 18px; font-weight: 700; color: #e74c3c;">NT$ {{finalAmount}}</span>
                </div>
            </div>
            
            <div class="highlight-box">
                <h2 style="margin-top: 0; color: #856404;">💰 匯款資訊</h2>
                <p style="margin: 8px 0;"><strong>銀行：</strong>{{bankName}}{{bankBranchDisplay}}</p>
                <p style="margin: 8px 0;"><strong>帳號：</strong><strong style="color: #e74c3c;">{{bankAccount}}</strong></p>
                <p style="margin: 8px 0;"><strong>戶名：</strong>{{accountName}}</p>
                <p style="margin: 15px 0 0 0; padding-top: 15px; border-top: 1px solid #ffc107;">請在匯款時備註訂房編號後5碼：<strong>{{bookingIdLast5}}</strong></p>
                <p style="margin: 8px 0 0 0;">匯款後請加入官方LINE告知，謝謝！</p>
            </div>
            
            {{#if isDeposit}}
            <div class="remaining-box">
                <h2 style="margin-top: 0; color: #2e7d32;">💡 剩餘尾款於現場付清！</h2>
                <p style="margin: 10px 0 0 0; color: #2e7d32; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}
            
            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            <p style="margin-top: 20px;">如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
    {{hotelInfoFooter}}
</body>
</html>`
            },
            {
                key: 'checkin_reminder',
                name: '入住提醒',
                subject: '【入住提醒】歡迎您明天入住',
                content: '' // 將在下面單獨處理
            },
            {
                key: 'feedback_request',
                name: '感謝入住',
                subject: '【感謝入住】分享您的住宿體驗',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4caf50; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #2e7d32; margin: 0 0 15px 0; }
        .rating-section { background: #fff9c4; border: 2px solid #fbc02d; border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center; }
        .rating-stars { font-size: 32px; margin: 15px 0; }
        .google-review-btn,
        .google-review-btn:link,
        .google-review-btn:visited { display: inline-block; background: #1a73e8; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; padding: 14px 28px; border-radius: 6px; text-decoration: none !important; font-size: 17px; font-weight: 700; margin-top: 15px; transition: background 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); letter-spacing: 0.5px; }
        .google-review-btn:hover,
        .google-review-btn:active { background: #1557b0; box-shadow: 0 4px 8px rgba(0,0,0,0.3); color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-decoration: none !important; }

        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            ul { padding-left: 25px; }
            li { font-size: 15px; }
            .highlight-box { padding: 15px; margin: 20px 0; }
            .info-section { padding: 15px; margin: 20px 0; }
            .info-section-title { font-size: 18px; }
            .rating-section { padding: 20px 15px; margin: 20px 0; }
            .rating-stars { font-size: 28px; }
            .google-review-btn { display: block; width: 100%; box-sizing: border-box; padding: 12px 16px; font-size: 16px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⭐ 感謝您的入住</h1>
            <p>希望您這次的住宿體驗愉快舒適</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}} 您好，</p>
            <p class="intro-text">感謝您選擇我們的住宿服務！希望您這次的住宿體驗愉快舒適，我們非常重視您的意見與回饋。</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 住宿資訊</div>
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
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
            </div>
            
            <div class="rating-section">
                <div class="section-title" style="margin-top: 0; margin-bottom: 15px; color: #f57f17; justify-content: center;">您的寶貴意見對我們非常重要！</div>
                <p style="margin: 0 0 10px 0; font-size: 17px; font-weight: 600; color: #333;">請為我們的服務評分：</p>
                <div class="rating-stars">⭐⭐⭐⭐⭐</div>
                <a href="https://www.google.com/maps/place/?q=place_id:YOUR_PLACE_ID" target="_blank" class="google-review-btn" style="color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; text-decoration:none !important;">在 Google 上給我們評價</a>
                <p style="margin: 15px 0 0 0; font-size: 15px; color: #666; line-height: 1.6;">您的評價將幫助其他旅客做出更好的選擇，也讓我們能持續改進服務品質</p>
            </div>
            
            <div class="info-section">
                <div class="info-section-title">💬 意見回饋</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如果您有任何建議、意見或需要協助，歡迎隨時透過以下方式與我們聯繫：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
                <p style="margin: 8px 0 0 0; font-size: 15px; color: #2e7d32; font-weight: 600;">我們會認真聆聽您的意見，並持續改進服務品質！</p>
            </div>
            
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #856404; justify-content: center;">🎁 再次入住優惠</div>
                <p style="margin: 0; font-size: 18px; text-align: center; font-weight: 700; color: #333;">感謝您的支持！</p>
                <p style="margin: 8px 0 0 0; font-size: 17px; text-align: center; font-weight: 600; color: #333;">再次預訂可享有 <strong style="color: #e65100; font-size: 22px;">9 折優惠</strong></p>
                <p style="margin: 12px 0 0 0; font-size: 16px; text-align: center; color: #666; line-height: 1.6;">歡迎隨時與我們聯繫，我們期待再次為您服務</p>
            </div>
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待再次為您服務！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
        </div>
    </div>
</body>
</html>`
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
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #262A33; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #262A33; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .amount-highlight { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .amount-label { font-size: 18px; font-weight: 600; color: #1976d2; margin-bottom: 8px; }
        .amount-value { font-size: 24px; font-weight: 700; color: #1976d2; }
        .bank-info-box { background: white; padding: 20px; border-radius: 8px; margin-top: 15px; border: 1px solid #ddd; }
        .bank-account { font-size: 20px; color: #e74c3c; font-weight: 700; letter-spacing: 2px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 訂房確認成功</h1>
            <p>感謝您的預訂！</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}}，</p>
            <p class="intro-text">您的訂房已成功確認，以下是您的訂房資訊：</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">訂房資訊</div>
                <div class="info-row">
                    <span class="info-label">訂房時間</span>
                    <span class="info-value">{{bookingDate}}</span>
                </div>
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
                <div class="info-row" style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ddd;">
                    <span class="info-label" style="font-size: 18px; color: #333;">總金額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700;">NT$ {{totalAmount}}</span>
                </div>
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; color: #333; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700; color: #c62828;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
            </div>

            <div class="amount-highlight">
                <div class="amount-label">{{amountLabel}}</div>
                <div class="amount-value">NT$ {{finalAmount}}</div>
            </div>

            {{#if isDeposit}}
            <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #2e7d32;">💡 剩餘尾款</div>
                <p style="color: #2e7d32; font-weight: 600; margin: 0 0 12px 0; font-size: 17px;">剩餘尾款請於現場付清！</p>
                <p style="color: #2e7d32; margin: 0; font-size: 22px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}

            {{#if isTransfer}}
            <div class="highlight">
                <div class="section-title" style="margin-top: 0; margin-bottom: 15px; color: #856404;">💰 匯款提醒</div>
                <p style="color: #856404; font-weight: 600; margin: 0; font-size: 17px; line-height: 1.8;">
                    ⏰ 此訂房將為您保留 <strong>{{daysReserved}} 天</strong>，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。
                </p>
                {{#if bankInfo}}
                <div class="bank-info-box">
                    <p style="margin: 0 0 15px 0; font-size: 18px; font-weight: 700; color: #333;">匯款資訊：</p>
                    {{#if bankName}}
                    <div class="info-row" style="border-bottom: 1px solid #e0e0e0; padding: 10px 0;">
                        <span class="info-label" style="min-width: auto; font-size: 16px;">銀行</span>
                        <span class="info-value" style="text-align: right; font-size: 16px;">{{bankName}}{{bankBranchDisplay}}</span>
                    </div>
                    {{/if}}
                    <div class="info-row" style="border-bottom: 1px solid #e0e0e0; padding: 10px 0;">
                        <span class="info-label" style="min-width: auto; font-size: 16px;">帳號</span>
                        <span class="info-value" style="text-align: right;"><span class="bank-account">{{bankAccount}}</span></span>
                    </div>
                    {{#if accountName}}
                    <div class="info-row" style="border-bottom: none; padding: 10px 0;">
                        <span class="info-label" style="min-width: auto; font-size: 16px;">戶名</span>
                        <span class="info-value" style="text-align: right; font-size: 16px;">{{accountName}}</span>
                    </div>
                    {{/if}}
                    <p style="margin: 18px 0 0 0; padding-top: 15px; border-top: 1px solid #ddd; color: #666; font-size: 15px; line-height: 1.6;">
                        請在匯款時備註訂房編號後5碼：<strong style="font-size: 16px; color: #333;">{{bookingIdLast5}}</strong>
                    </p>
                    <p style="margin: 8px 0 0 0; color: #666; font-size: 15px; line-height: 1.6;">
                        匯款後請加入官方LINE告知，謝謝！
                    </p>
                </div>
                {{else}}
                <p style="color: #856404; margin: 15px 0 0 0; font-size: 16px;">⚠️ 匯款資訊尚未設定，請聯繫客服取得匯款帳號。</p>
                {{/if}}
            </div>
            {{/if}}
            
            <div style="margin-top: 35px;">
                <div class="section-title">重要提醒</div>
                <ul>
                    <li>請於入住當天攜帶身分證件辦理入住手續</li>
                    <li>如需取消或變更訂房，請提前 3 天通知</li>
                    <li>如有任何問題，請隨時與我們聯繫</li>
                </ul>
            </div>

            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>

            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">感謝您的預訂，期待為您服務！</p>
            <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px; padding-top: 20px; border-top: 1px solid #e0e0e0;">此為系統自動發送郵件，請勿直接回覆</p>
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
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #e74c3c; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        .amount-highlight { background: #ffebee; border: 2px solid #e74c3c; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .amount-label { font-size: 18px; font-weight: 600; color: #c62828; margin-bottom: 8px; }
        .amount-value { font-size: 24px; font-weight: 700; color: #c62828; }
        .contact-section { background: #fff3e0; border: 2px solid #ff9800; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .contact-title { font-size: 20px; font-weight: bold; color: #e65100; margin: 0 0 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔔 新訂房通知</h1>
            <p>您有一筆新的訂房申請</p>
        </div>
        <div class="content">
            <p class="intro-text">以下是訂房詳細資訊：</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">訂房資訊</div>
                <div class="info-row">
                    <span class="info-label">訂房時間</span>
                    <span class="info-value">{{bookingDate}}</span>
                </div>
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
                <div class="info-row" style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ddd;">
                    <span class="info-label" style="font-size: 18px; color: #333;">總金額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700;">NT$ {{totalAmount}}</span>
                </div>
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; color: #333; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700; color: #c62828;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
            </div>

            <div class="amount-highlight">
                <div class="amount-label">應付金額</div>
                <div class="amount-value">NT$ {{finalAmount}}</div>
            </div>

            <div class="contact-section">
                <div class="contact-title">📞 客戶聯絡資訊</div>
                <div class="info-row" style="border-bottom: 1px solid #ffcc80; padding: 10px 0;">
                    <span class="info-label" style="min-width: auto; font-size: 16px;">客戶姓名</span>
                    <span class="info-value" style="text-align: right; font-size: 16px; font-weight: 600;">{{guestName}}</span>
                </div>
                <div class="info-row" style="border-bottom: 1px solid #ffcc80; padding: 10px 0;">
                    <span class="info-label" style="min-width: auto; font-size: 16px;">聯絡電話</span>
                    <span class="info-value" style="text-align: right; font-size: 16px;">{{guestPhone}}</span>
                </div>
                <div class="info-row" style="border-bottom: none; padding: 10px 0;">
                    <span class="info-label" style="min-width: auto; font-size: 16px;">Email</span>
                    <span class="info-value" style="text-align: right; font-size: 16px;">{{guestEmail}}</span>
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #198754; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #198754; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        .amount-highlight { background: #e8f5e9; border: 2px solid #198754; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .amount-label { font-size: 18px; font-weight: 600; color: #2e7d32; margin-bottom: 8px; }
        .amount-value { font-size: 24px; font-weight: 700; color: #2e7d32; }
        .success-box { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .success-box p { margin: 0; color: #2e7d32; font-weight: 600; font-size: 17px; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            .amount-highlight { padding: 15px; margin: 20px 0; }
            .amount-label { font-size: 16px; }
            .amount-value { font-size: 22px; }
            .success-box { padding: 15px; margin: 20px 0; }
            .success-box p { font-size: 16px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ 付款完成確認</h1>
            <p>感謝您的付款！</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}}，</p>
            <p class="intro-text">我們已確認收到您的付款，以下是您的訂房與付款資訊：</p>
            
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">訂房與付款資訊</div>
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
                {{#if hasDiscount}}
                <div class="info-row">
                    <span class="info-label" style="color: #10b981;">優惠折扣</span>
                    <span class="info-value" style="color: #10b981; font-weight: 600;">-NT$ {{discountAmount}}</span>
                </div>
                <div class="info-row" style="padding-top: 10px; border-top: 1px solid #e0e0e0;">
                    <span class="info-label" style="font-size: 18px; color: #333; font-weight: 700;">折後總額</span>
                    <span class="info-value" style="font-size: 20px; font-weight: 700; color: #198754;">NT$ {{discountedTotal}}</span>
                </div>
                {{/if}}
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">付款方式</span>
                    <span class="info-value">{{paymentMethod}}</span>
                </div>
            </div>
            
            <div class="amount-highlight">
                <div class="amount-label">本次已收金額</div>
                <div class="amount-value">NT$ {{finalAmount}}</div>
            </div>
            
            <div class="success-box">
                <p>✅ 付款已完成！</p>
                <p style="margin-top: 10px; font-size: 14px; font-weight: 400;">感謝您的付款，訂房已確認完成。</p>
            </div>
            
            <p>若您後續仍需變更或取消訂房，請儘早與我們聯繫，我們將盡力協助您。</p>
            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            
            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">再次感謝您的預訂，期待您的光臨！</p>
            <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px; padding-top: 20px; border-top: 1px solid #e0e0e0;">此為系統自動發送郵件，請勿直接回覆</p>
            
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #e74c3c; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #e74c3c; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #e74c3c; font-weight: 700; }
        h2 { color: #333; font-size: 20px; font-weight: bold; margin: 0 0 15px 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        strong { color: #333; font-weight: 700; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .rebook-box { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        a { color: #1976d2; text-decoration: underline; word-break: break-word; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            h2 { font-size: 18px; margin: 0 0 12px 0; }
            p { font-size: 15px; }
            .highlight { padding: 15px; margin: 20px 0; }
            .rebook-box { padding: 15px; margin: 20px 0; }
        }
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
            <p>很抱歉通知您，由於超過匯款保留期限，您的訂房已自動取消。以下是取消的訂房資訊：</p>
            
            <div class="info-box">
                <h2 style="margin-top: 0;">取消的訂房資訊</h2>
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
                    <span class="info-value"><strong>NT$ {{finalAmount}}</strong></span>
                </div>
            </div>

            <div class="highlight">
                <h2 style="margin-top: 0; color: #856404;">📌 取消原因</h2>
                <p style="margin: 0; color: #856404;">此訂房因超過匯款保留期限（{{bookingDate}} 起算），且未在期限內完成付款，系統已自動取消。</p>
            </div>

            <div class="rebook-box">
                <h2 style="color: #2e7d32; margin-top: 0;">💡 如需重新訂房</h2>
                <p style="color: #2e7d32; margin: 10px 0;">如果您仍希望預訂，歡迎重新進行訂房。如有任何疑問，請隨時與我們聯繫。</p>
                <p style="color: #2e7d32; margin: 10px 0;"><strong>線上訂房：</strong><a href="{{bookingUrl}}" style="color: #1976d2; text-decoration: underline;">重新訂房</a></p>
                <p style="color: #2e7d32; margin: 10px 0;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: underline;">{{hotelEmail}}</a></p>
                <p style="color: #2e7d32; margin: 10px 0;"><strong>電話：</strong>{{hotelPhone}}</p>
                {{#if officialLineUrl}}
                <p style="color: #2e7d32; margin: 10px 0;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>

            {{hotelInfoFooter}}
        </div>
    </div>
</body>
</html>`
            }
        ];
        
        let template = defaultTemplates.find(t => t.key === key);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: '找不到該郵件模板'
            });
        }
        
        // 如果是入住提醒，從 checkin_reminder_template.html 文件讀取
        if (key === 'checkin_reminder') {
            try {
                const templatePath = path.join(__dirname, 'checkin_reminder_template.html');
                if (fs.existsSync(templatePath)) {
                    template.content = fs.readFileSync(templatePath, 'utf8');
                } else {
                    // 如果文件不存在，從資料庫讀取
                    const dbTemplate = await db.getEmailTemplateByKey('checkin_reminder');
                    if (dbTemplate && dbTemplate.content) {
                        template.content = dbTemplate.content;
                    }
                }
            } catch (error) {
                console.error('讀取入住提醒預設模板失敗:', error);
                // 如果讀取失敗，嘗試從資料庫讀取
                try {
                    const dbTemplate = await db.getEmailTemplateByKey('checkin_reminder');
                    if (dbTemplate && dbTemplate.content) {
                        template.content = dbTemplate.content;
                    }
                } catch (dbError) {
                    console.error('從資料庫讀取入住提醒模板也失敗:', dbError);
                }
            }
        }
        
        res.json({
            success: true,
            data: {
                key: template.key,
                name: template.name,
                subject: template.subject,
                content: template.content
            }
        });
    } catch (error) {
        console.error('獲取預設郵件模板錯誤:', error);
        res.status(500).json({
            success: false,
            message: '獲取預設郵件模板失敗：' + error.message
        });
    }
});

// API: 強制重新生成入住提醒郵件模板（使用最新格式）
app.post('/api/email-templates/checkin_reminder/regenerate', requireAuth, checkPermission('email_templates.edit'), adminLimiter, async (req, res) => {
    try {
        // 從 database.js 中獲取最新的模板定義
        const defaultTemplates = [
            {
                key: 'checkin_reminder',
                name: '入住提醒',
                subject: '【入住提醒】歡迎您明天入住',
                content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
        .header { background: #2196f3; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px 20px; border-radius: 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
        .section-content { font-size: 16px; line-height: 1.8; }
        
        /* 手機響應式設計 */
        @media only screen and (max-width: 600px) {
            .container { padding: 0; }
            .header { padding: 25px 15px; }
            .header h1 { font-size: 24px; }
            .header p { font-size: 16px; }
            .content { padding: 20px 15px; }
            .info-box { padding: 15px; margin: 20px 0; }
            .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
            .info-label { min-width: auto; width: 100%; margin-bottom: 5px; font-size: 14px; }
            .info-value { text-align: left; width: 100%; font-size: 15px; }
            .section-title { font-size: 20px; margin: 25px 0 15px 0; }
            p { font-size: 15px; }
            .greeting { font-size: 17px; }
            .intro-text { font-size: 15px; margin-bottom: 20px; }
            ul { padding-left: 25px; }
            li { font-size: 15px; }
            .highlight-box { padding: 15px; margin: 20px 0; }
            .info-section { padding: 15px; margin: 20px 0; }
            .info-section-title { font-size: 18px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
            <p>歡迎您明天的到來</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}} 您好，</p>
            <p class="intro-text">感謝您選擇我們的住宿服務，我們期待您明天的到來。</p>
            
            {{#if showBookingInfo}}
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 訂房資訊</div>
                {{bookingInfoContent}}
            </div>
            {{/if}}
            
            {{#if showTransport}}
            <div class="info-section">
                <div class="info-section-title">📍 交通路線</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>地址：</strong>{{hotelAddress}}</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>大眾運輸：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
                    <li style="margin: 4px 0; font-size: 16px;">公車：搭乘20、32、46路公車至「信義行政中心站」</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>自行開車：</strong></p>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">國道一號：下「信義交流道」，沿信義路直行約3公里</li>
                    <li style="margin: 4px 0; font-size: 16px;">國道三號：下「木柵交流道」，接信義快速道路</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showParking}}
            <div class="info-section">
                <div class="info-section-title">🅿️ 停車資訊</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">住宿客人：每日 NT$ 200 (可無限次進出)</li>
                    <li style="margin: 4px 0; font-size: 16px;">臨時停車：每小時 NT$ 50</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24小時</p>
                <p style="margin: 0; font-size: 16px; color: #856404;">⚠️ 停車位有限，建議提前預約</p>
            </div>
            {{/if}}
            
            {{#if showNotes}}
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #856404; justify-content: center;">⚠️ 入住注意事項</div>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 8px 0; font-size: 16px;">入住時間：下午3:00後</li>
                    <li style="margin: 8px 0; font-size: 16px;">退房時間：上午11:30前</li>
                    <li style="margin: 8px 0; font-size: 16px;">請攜帶身分證件辦理入住手續</li>
                    <li style="margin: 8px 0; font-size: 16px;">房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>
                    <li style="margin: 8px 0; font-size: 16px;">請保持安靜，避免影響其他住客</li>
                    <li style="margin: 8px 0; font-size: 16px;">貴重物品請妥善保管，建議使用房間保險箱</li>
                    <li style="margin: 8px 0; font-size: 16px;">如需延遲退房，請提前告知櫃檯</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showContact}}
            <div class="info-section">
                <div class="info-section-title">📞 聯絡資訊</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如有任何問題，歡迎隨時聯繫我們：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            {{/if}}
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待您的到來，祝您住宿愉快！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
        </div>
    </div>
</body>
</html>`,
                days_before_checkin: 1,
                send_hour_checkin: 9,
                block_settings: JSON.stringify({
                    booking_info: {
                        enabled: true,
                        content: `<div class="info-row">
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
<div class="info-row" style="border-bottom: none;">
    <span class="info-label">房型</span>
    <span class="info-value">{{roomType}}</span>
</div>`
                    },
                    transport: {
                        enabled: true,
                        content: `<p style="margin: 0 0 12px 0; font-size: 16px;">交通方式說明：</p>
<ul style="margin: 0; padding-left: 25px;">
    <li style="margin: 8px 0;">大眾運輸：可搭乘捷運至XX站，步行5分鐘</li>
    <li style="margin: 8px 0;">自行開車：請參考以下地圖導航</li>
</ul>`
                    },
                    parking: {
                        enabled: true,
                        content: `<p style="margin: 0 0 12px 0; font-size: 16px;">停車資訊：</p>
<ul style="margin: 0; padding-left: 25px;">
    <li style="margin: 8px 0;">提供免費停車位</li>
    <li style="margin: 8px 0;">停車場位置：XX路XX號</li>
</ul>`
                    },
                    notes: {
                        enabled: true,
                        content: `<p style="margin: 0 0 12px 0; font-size: 16px;">入住注意事項：</p>
<ul style="margin: 0; padding-left: 25px;">
    <li style="margin: 8px 0;">入住時間：下午3點後</li>
    <li style="margin: 8px 0;">退房時間：上午11點前</li>
    <li style="margin: 8px 0;">請攜帶身分證件辦理入住手續</li>
</ul>`
                    },
                    contact: {
                        enabled: true,
                        content: `<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>電話：</strong>{{hotelPhone}}</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: underline;">{{hotelEmail}}</a></p>
{{#if officialLineUrl}}<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>{{/if}}
<p style="margin: 0; font-size: 16px;"><strong>服務時間：</strong>24 小時</p>`
                    }
                })
            }
        ];
        
        const template = defaultTemplates[0];
        
        // 取得現有模板以保留設定
        const existingTemplate = await db.getEmailTemplateByKey('checkin_reminder');
        
        // 強制更新模板，使用最新的格式和預設 block_settings
        await db.updateEmailTemplate('checkin_reminder', {
            template_name: template.name,
            subject: template.subject,
            content: template.content,
            is_enabled: existingTemplate?.is_enabled !== undefined ? existingTemplate.is_enabled : 1,
            days_before_checkin: existingTemplate?.days_before_checkin !== undefined ? existingTemplate.days_before_checkin : template.days_before_checkin,
            send_hour_checkin: existingTemplate?.send_hour_checkin !== undefined ? existingTemplate.send_hour_checkin : template.send_hour_checkin,
            days_after_checkout: existingTemplate?.days_after_checkout || null,
            send_hour_feedback: existingTemplate?.send_hour_feedback || null,
            days_reserved: existingTemplate?.days_reserved || null,
            send_hour_payment_reminder: existingTemplate?.send_hour_payment_reminder || null,
            block_settings: template.block_settings
        });
        
        console.log('✅ 已重新生成入住提醒郵件模板（使用最新格式）');
        
        res.json({
            success: true,
            message: '入住提醒郵件模板已重新生成為最新格式'
        });
    } catch (error) {
        console.error('❌ 重新生成入住提醒郵件模板失敗:', error);
        res.status(500).json({
            success: false,
            message: '重新生成失敗：' + error.message
        });
    }
});

// API: 強制更新入住提醒郵件模板為完整的圖卡格式（並重新初始化所有模板）
app.post('/api/email-templates/checkin_reminder/force-update-card-format', requireAuth, checkPermission('email_templates.edit'), adminLimiter, async (req, res) => {
    try {
        // 完整的圖卡格式模板（與感謝入住格式一致，但使用藍色系）
        const cardFormatTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2196f3; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
            <p>歡迎您明天的到來</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}} 您好，</p>
            <p class="intro-text">感謝您選擇我們的住宿服務，我們期待您明天的到來。</p>
            
            {{#if showBookingInfo}}
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 訂房資訊</div>
                {{bookingInfoContent}}
            </div>
            {{/if}}
            
            {{#if showTransport}}
            <div class="info-section">
                <div class="info-section-title">📍 交通路線</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>地址：</strong>{{hotelAddress}}</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>大眾運輸：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
                    <li style="margin: 4px 0; font-size: 16px;">公車：搭乘20、32、46路公車至「信義行政中心站」</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>自行開車：</strong></p>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">國道一號：下「信義交流道」，沿信義路直行約3公里</li>
                    <li style="margin: 4px 0; font-size: 16px;">國道三號：下「木柵交流道」，接信義快速道路</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showParking}}
            <div class="info-section">
                <div class="info-section-title">🅿️ 停車資訊</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">住宿客人：每日 NT$ 200 (可無限次進出)</li>
                    <li style="margin: 4px 0; font-size: 16px;">臨時停車：每小時 NT$ 50</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24小時</p>
                <p style="margin: 0; font-size: 16px; color: #856404;">⚠️ 停車位有限，建議提前預約</p>
            </div>
            {{/if}}
            
            {{#if showNotes}}
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #856404; justify-content: center;">⚠️ 入住注意事項</div>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 8px 0; font-size: 16px;">入住時間：下午3:00後</li>
                    <li style="margin: 8px 0; font-size: 16px;">退房時間：上午11:30前</li>
                    <li style="margin: 8px 0; font-size: 16px;">請攜帶身分證件辦理入住手續</li>
                    <li style="margin: 8px 0; font-size: 16px;">房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>
                    <li style="margin: 8px 0; font-size: 16px;">請保持安靜，避免影響其他住客</li>
                    <li style="margin: 8px 0; font-size: 16px;">貴重物品請妥善保管，建議使用房間保險箱</li>
                    <li style="margin: 8px 0; font-size: 16px;">如需延遲退房，請提前告知櫃檯</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showContact}}
            <div class="info-section">
                <div class="info-section-title">📞 聯絡資訊</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如有任何問題，歡迎隨時聯繫我們：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            {{/if}}
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待您的到來，祝您住宿愉快！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
        </div>
    </div>
</body>
</html>`;
        
        // 更新資料庫中的模板
        await db.updateEmailTemplate('checkin_reminder', {
            content: cardFormatTemplate
        });
        
        // 重新初始化所有郵件模板，確保所有模板都是完整的
        await db.initEmailTemplates();
        
        console.log('✅ 已強制更新入住提醒郵件模板為完整的圖卡格式，並重新初始化所有模板');
        
        res.json({
            success: true,
            message: '入住提醒郵件模板已更新為完整的圖卡格式，所有模板已重新初始化'
        });
    } catch (error) {
        console.error('❌ 強制更新入住提醒郵件模板失敗:', error);
        res.status(500).json({
            success: false,
            message: '更新失敗：' + error.message
        });
    }
});

// API: 清除入住提醒郵件的區塊內容（使用新的預設格式）
app.post('/api/email-templates/checkin_reminder/clear-blocks', requireAuth, checkPermission('email_templates.edit'), adminLimiter, async (req, res) => {
    try {
        // 取得入住提醒模板
        const template = await db.getEmailTemplateByKey('checkin_reminder');
        if (!template) {
            return res.status(404).json({
                success: false,
                message: '找不到入住提醒模板'
            });
        }
        
        // 解析現有的 block_settings
        let blockSettings = {};
        if (template.block_settings) {
            try {
                blockSettings = typeof template.block_settings === 'string' 
                    ? JSON.parse(template.block_settings) 
                    : template.block_settings;
            } catch (e) {
                console.warn('⚠️ 解析 block_settings 失敗:', e);
            }
        }
        
        // 使用最新的預設內容（直接寫入，確保編輯器可以看到）
        const hotelAddress = (await getHotelSettingsWithFallback()).hotelAddress;
        
        blockSettings.transport = {
            enabled: blockSettings.transport?.enabled !== false,
            content: `<p style="margin: 0 0 12px 0; font-size: 16px;"><strong>地址：</strong>${hotelAddress}</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>大眾運輸：</strong></p>
<ul style="margin: 0 0 12px 0; padding-left: 24px;">
    <li style="margin: 4px 0; font-size: 16px;">捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
    <li style="margin: 4px 0; font-size: 16px;">公車：搭乘20、32、46路公車至「信義行政中心站」</li>
</ul>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>自行開車：</strong></p>
<ul style="margin: 0; padding-left: 24px;">
    <li style="margin: 4px 0; font-size: 16px;">國道一號：下「信義交流道」，沿信義路直行約3公里</li>
    <li style="margin: 4px 0; font-size: 16px;">國道三號：下「木柵交流道」，接信義快速道路</li>
</ul>`
        };
        
        blockSettings.parking = {
            enabled: blockSettings.parking?.enabled !== false,
            content: `<p style="margin: 0 0 12px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>
<ul style="margin: 0 0 12px 0; padding-left: 24px;">
    <li style="margin: 4px 0; font-size: 16px;">住宿客人：毎日NT$200（可無限次進出）</li>
    <li style="margin: 4px 0; font-size: 16px;">臨時停車：每小時 NT$50</li>
</ul>
<p style="margin: 0 0 12px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24小時</p>
<p style="margin: 0; font-size: 16px;">▲停車位有限，建議提前預約</p>`
        };
        
        blockSettings.notes = {
            enabled: blockSettings.notes?.enabled !== false,
            content: `<ul style="margin: 0; padding-left: 24px; list-style-type: disc;">
    <li style="margin: 6px 0; font-size: 16px;">入住時間：下午3:00後</li>
    <li style="margin: 6px 0; font-size: 16px;">退房時間：上午11:30前</li>
    <li style="margin: 6px 0; font-size: 16px;">請攜帶身分證件辦理入住手續</li>
    <li style="margin: 6px 0; font-size: 16px;">房間內禁止吸菸，違者將收取清潔費NT$3,000</li>
    <li style="margin: 6px 0; font-size: 16px;">請保持安靜，避免影響其他住客</li>
    <li style="margin: 6px 0; font-size: 16px;">貴重物品請妥善保管，建議使用房間保險箱</li>
    <li style="margin: 6px 0; font-size: 16px;">如需延遲退房，請提前告知櫃檯</li>
</ul>`
        };
        
        // 保留其他區塊設定不變
        if (!blockSettings.booking_info) {
            blockSettings.booking_info = {
                enabled: true,
                content: `<div class="info-row">
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
<div class="info-row" style="border-bottom: none;">
    <span class="info-label">房型</span>
    <span class="info-value">{{roomType}}</span>
</div>`
            };
        }
        if (!blockSettings.contact) {
            blockSettings.contact = {
                enabled: true,
                content: `<p style="margin: 0 0 12px 0; font-size: 16px;">如有任何問題，歡迎隨時聯繫我們：</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>電話：</strong>{{hotelPhone}}</p>
<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>Email：</strong>{{hotelEmail}}</p>
{{#if officialLineUrl}}<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>官方 LINE：</strong>{{officialLineUrl}}</p>{{/if}}
<p style="margin: 0; font-size: 16px;"><strong>服務時間：</strong>24 小時</p>`
            };
        }
        
        // 使用最新的預設模板內容（與感謝入住格式一致，但使用藍色系）
        const defaultTemplateContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2196f3; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
            <p>歡迎您明天的到來</p>
        </div>
        <div class="content">
            <p class="greeting">親愛的 {{guestName}} 您好，</p>
            <p class="intro-text">感謝您選擇我們的住宿服務，我們期待您明天的到來。</p>
            
            {{#if showBookingInfo}}
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 訂房資訊</div>
                {{bookingInfoContent}}
            </div>
            {{/if}}
            
            {{#if showTransport}}
            <div class="info-section">
                <div class="info-section-title">📍 交通路線</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>地址：</strong>{{hotelAddress}}</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>大眾運輸：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
                    <li style="margin: 4px 0; font-size: 16px;">公車：搭乘20、32、46路公車至「信義行政中心站」</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>自行開車：</strong></p>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">國道一號：下「信義交流道」，沿信義路直行約3公里</li>
                    <li style="margin: 4px 0; font-size: 16px;">國道三號：下「木柵交流道」，接信義快速道路</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showParking}}
            <div class="info-section">
                <div class="info-section-title">🅿️ 停車資訊</div>
                <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>
                <ul style="margin: 0 0 12px 0; padding-left: 24px;">
                    <li style="margin: 4px 0; font-size: 16px;">住宿客人：每日 NT$ 200 (可無限次進出)</li>
                    <li style="margin: 4px 0; font-size: 16px;">臨時停車：每小時 NT$ 50</li>
                </ul>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24小時</p>
                <p style="margin: 0; font-size: 16px; color: #856404;">⚠️ 停車位有限，建議提前預約</p>
            </div>
            {{/if}}
            
            {{#if showNotes}}
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 12px; color: #856404; justify-content: center;">⚠️ 入住注意事項</div>
                <ul style="margin: 0; padding-left: 24px;">
                    <li style="margin: 8px 0; font-size: 16px;">入住時間：下午3:00後</li>
                    <li style="margin: 8px 0; font-size: 16px;">退房時間：上午11:30前</li>
                    <li style="margin: 8px 0; font-size: 16px;">請攜帶身分證件辦理入住手續</li>
                    <li style="margin: 8px 0; font-size: 16px;">房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>
                    <li style="margin: 8px 0; font-size: 16px;">請保持安靜，避免影響其他住客</li>
                    <li style="margin: 8px 0; font-size: 16px;">貴重物品請妥善保管，建議使用房間保險箱</li>
                    <li style="margin: 8px 0; font-size: 16px;">如需延遲退房，請提前告知櫃檯</li>
                </ul>
            </div>
            {{/if}}
            
            {{#if showContact}}
            <div class="info-section">
                <div class="info-section-title">📞 聯絡資訊</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如有任何問題，歡迎隨時聯繫我們：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            {{/if}}
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待您的到來，祝您住宿愉快！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
        </div>
    </div>
</body>
</html>`;
        
        // 更新模板（需要提供所有必要欄位，避免 null 值錯誤）
        // 同時更新主模板的 content（包含新的 CSS 樣式）和 block_settings
        await db.updateEmailTemplate('checkin_reminder', {
            template_name: template.template_name || template.name || '入住提醒',
            subject: template.subject || '【入住提醒】歡迎您明天入住',
            content: defaultTemplateContent, // 使用最新的預設模板內容
            is_enabled: template.is_enabled !== undefined ? template.is_enabled : 1,
            days_before_checkin: template.days_before_checkin !== undefined ? template.days_before_checkin : 1,
            send_hour_checkin: template.send_hour_checkin !== undefined ? template.send_hour_checkin : 9,
            days_after_checkout: template.days_after_checkout !== undefined ? template.days_after_checkout : null,
            send_hour_feedback: template.send_hour_feedback !== undefined ? template.send_hour_feedback : null,
            days_reserved: template.days_reserved !== undefined ? template.days_reserved : null,
            send_hour_payment_reminder: template.send_hour_payment_reminder !== undefined ? template.send_hour_payment_reminder : null,
            block_settings: JSON.stringify(blockSettings)
        });
        
        // 同時清除系統設定中的舊內容，確保使用代碼中的新預設值
        console.log('🔄 開始清除系統設定中的舊內容...');
        const oldTransport = await db.getSetting('checkin_reminder_transport');
        const oldParking = await db.getSetting('checkin_reminder_parking');
        const oldNotes = await db.getSetting('checkin_reminder_notes');
        console.log('   清除前的系統設定:', {
            transport: oldTransport ? `有內容 (${oldTransport.length} 字元)` : '空',
            parking: oldParking ? `有內容 (${oldParking.length} 字元)` : '空',
            notes: oldNotes ? `有內容 (${oldNotes.length} 字元)` : '空'
        });
        
        await db.updateSetting('checkin_reminder_transport', '');
        await db.updateSetting('checkin_reminder_parking', '');
        await db.updateSetting('checkin_reminder_notes', '');
        
        // 驗證清除是否成功
        const newTransport = await db.getSetting('checkin_reminder_transport');
        const newParking = await db.getSetting('checkin_reminder_parking');
        const newNotes = await db.getSetting('checkin_reminder_notes');
        console.log('   清除後的系統設定:', {
            transport: newTransport || '空',
            parking: newParking || '空',
            notes: newNotes || '空'
        });
        
        console.log('✅ 已還原入住提醒郵件的區塊內容為最初的圖卡樣式');
        
        res.json({
            success: true,
            message: '已還原入住提醒郵件的區塊內容為最初的圖卡樣式，系統將使用預設格式'
        });
    } catch (error) {
        console.error('清除入住提醒區塊內容錯誤:', error);
        res.status(500).json({
            success: false,
            message: '清除區塊內容失敗：' + error.message
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

function ensureAutoMailNotice(content) {
    const noticeText = '此為系統自動發送郵件，請勿直接回覆';
    if (!content || content.includes(noticeText)) {
        return content;
    }

    const noticeHtml = `
    <div style="margin-top: 30px; padding-top: 18px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px; line-height: 1.6;">
        ${noticeText}
    </div>`;

    if (/<\/body>/i.test(content)) {
        return content.replace(/<\/body>/i, `${noticeHtml}\n</body>`);
    }
    if (/<\/html>/i.test(content)) {
        return content.replace(/<\/html>/i, `${noticeHtml}\n</html>`);
    }
    return `${content}\n${noticeHtml}`;
}

function enforceGoogleReviewButtonStyle(content) {
    if (!content || !/google-review-btn/i.test(content)) {
        return content;
    }

    const requiredStyle = 'color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; text-decoration:none !important;';

    return content.replace(
        /<a([^>]*class=["'][^"']*google-review-btn[^"']*["'][^>]*)>/gi,
        (match, attrs) => {
            if (/style\s*=\s*["']/i.test(attrs)) {
                const merged = attrs.replace(
                    /style\s*=\s*(['"])([\s\S]*?)\1/i,
                    (_, quote, styleValue) => {
                        const base = String(styleValue || '').trim().replace(/;?\s*$/, '; ');
                        return `style=${quote}${base}${requiredStyle}${quote}`;
                    }
                );
                return `<a${merged}>`;
            }
            return `<a${attrs} style="${requiredStyle}">`;
        }
    );
}

function injectSpecialRequestRowForLegacyTemplate(content, specialRequest) {
    const requestText = String(specialRequest || '').trim();
    if (!requestText || !content) return content;
    if (content.includes('特殊需求')) return content;
    const escapedRequestText = requestText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const infoRowHtml = `
<div class="info-row">
    <span class="info-label">特殊需求</span>
    <span class="info-value">${escapedRequestText}</span>
</div>`;

    const tableRowHtml = `
<tr>
    <td style="padding: 8px 0; color: #666;">特殊需求</td>
    <td style="padding: 8px 0; text-align: right; color: #333;">${escapedRequestText}</td>
</tr>`;

    // 優先插在 Email 資訊列後方（常見模板結構）
    const injectedInfoRow = content.replace(
        /(<span[^>]*class=["'][^"']*info-label[^"']*["'][^>]*>\s*Email\s*<\/span>[\s\S]*?<span[^>]*class=["'][^"']*info-value[^"']*["'][^>]*>[\s\S]*?<\/span>\s*<\/div>)/i,
        `$1${infoRowHtml}`
    );
    if (injectedInfoRow !== content) return injectedInfoRow;

    const injectedTableRow = content.replace(
        /(<td[^>]*>\s*Email\s*<\/td>[\s\S]*?<\/tr>)/i,
        `$1${tableRowHtml}`
    );
    if (injectedTableRow !== content) return injectedTableRow;

    const fallbackBlock = `
<div style="margin-top: 12px; padding: 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
    <strong style="display: inline-block; margin-right: 6px;">特殊需求：</strong>
    <span>${escapedRequestText}</span>
</div>`;
    if (/<\/body>/i.test(content)) {
        return content.replace(/<\/body>/i, `${fallbackBlock}\n</body>`);
    }
    return `${content}\n${fallbackBlock}`;
}

// 替換郵件模板中的變數
async function replaceTemplateVariables(template, booking, bankInfo = null, additionalData = {}) {
    // 確保模板內容存在（支援多種欄位名稱）
    // 直接使用資料庫中的完整 HTML 模板內容，不做任何簡化或修改
    let content = template.content || template.template_content || '';
    
    const templateKey = template.key || template.template_key;
    
    // 確保使用資料庫中的完整 HTML 內容
    if (!content || content.trim() === '') {
        // 如果模板內容為空，嘗試從資料庫重新讀取
        const dbTemplate = await db.getEmailTemplateByKey(templateKey);
        if (dbTemplate && dbTemplate.content) {
            content = dbTemplate.content;
            console.log(`⚠️ 模板內容為空，已從資料庫重新讀取完整 HTML 模板 (${templateKey})`);
        }
    }
    
    // 添加日誌以確認接收到的模板內容
    console.log(`🔍 replaceTemplateVariables - 接收到的模板內容 (${templateKey}):`, {
        contentLength: content.length,
        hasContent: !!content,
        hasFullHtmlStructure: content.includes('<!DOCTYPE html>') || content.includes('<html'),
        hasStyleTag: content.includes('<style>') || content.includes('<style '),
        hasBodyTag: content.includes('<body>') || content.includes('<body '),
        hasBlockSettings: !!template.block_settings
    });
    
    if (!content || content.trim() === '') {
        console.error('❌ 郵件模板內容為空:', {
            templateKey: templateKey,
            hasContent: !!template.content,
            hasTemplateContent: !!template.template_content
        });
        throw new Error('郵件模板內容為空');
    }
    
    // 日誌：確認 bankInfo 是否正確傳遞
    console.log('🔍 replaceTemplateVariables - bankInfo 檢查:', {
        hasBankInfo: !!bankInfo,
        bankInfo: bankInfo ? {
            bankName: bankInfo.bankName || '(空)',
            bankBranch: bankInfo.bankBranch || '(空)',
            account: bankInfo.account ? bankInfo.account.substring(0, 4) + '...' : '(空)',
            accountName: bankInfo.accountName || '(空)'
        } : null
    });
    
    // 確保模板包含完整的 HTML 結構和 CSS 樣式
    // 檢查是否包含完整的 HTML 結構
    const hasFullHtmlStructure = content.includes('<!DOCTYPE html>') || 
                                 (content.includes('<html') && content.includes('</html>'));
    
    // 檢查是否包含 <style> 標籤
    const hasStyleTag = content.includes('<style>') || content.includes('<style ');
    
    // 檢查是否有基本的 HTML 結構（body 標籤）
    const hasBodyTag = content.includes('<body>') || content.includes('<body ');
    
    // templateKey 已在上面聲明，這裡不需要重複聲明
    const isCheckinReminder = templateKey === 'checkin_reminder';

    // 入住提醒：解析區塊設定，供條件與內容替換使用
    let checkinBlockSettings = {};
    if (isCheckinReminder) {
        try {
            if (template.block_settings) {
                checkinBlockSettings = typeof template.block_settings === 'string'
                    ? JSON.parse(template.block_settings)
                    : template.block_settings;
            }
        } catch (error) {
            console.warn('⚠️ 解析入住提醒 block_settings 失敗，改用預設值:', error.message);
            checkinBlockSettings = {};
        }
    }
    
    // 對於入住提醒郵件，如果缺少完整結構，嘗試從資料庫讀取原始模板結構
    if ((!hasFullHtmlStructure || !hasStyleTag || !hasBodyTag) && isCheckinReminder) {
        console.log('⚠️ 入住提醒郵件模板缺少完整 HTML 結構，嘗試從資料庫讀取原始模板...', {
            templateKey,
            hasFullHtmlStructure,
            hasStyleTag,
            hasBodyTag,
            contentLength: content.length
        });
        
        try {
            // 從資料庫讀取原始模板（包含完整的 HTML 結構和樣式）
            const originalTemplate = await db.getEmailTemplateByKey(templateKey);
            if (originalTemplate && originalTemplate.content && 
                (originalTemplate.content.includes('<!DOCTYPE html>') || originalTemplate.content.includes('<html'))) {
                // 提取原始模板的 HTML 結構和樣式
                const originalContent = originalTemplate.content;
                
                // 提取當前內容的 body 部分（用戶修改的內容）
                let bodyContent = content;
                if (content.includes('<body>')) {
                    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch && bodyMatch[1]) {
                        bodyContent = bodyMatch[1];
                    }
                }
                
                // 從原始模板提取 head 部分（包含樣式）
                if (originalContent.includes('<head>')) {
                    const headMatch = originalContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
                    if (headMatch && headMatch[1]) {
                        // 提取 body 標籤的開始部分
                        const bodyStartMatch = originalContent.match(/<body[^>]*>/i);
                        const bodyStart = bodyStartMatch ? bodyStartMatch[0] : '<body>';
                        
                        // 提取 body 標籤的結束部分
                        const bodyEnd = originalContent.includes('</body>') ? '</body>' : '';
                        
                        // 提取 html 和 head 標籤
                        const htmlStartMatch = originalContent.match(/<html[^>]*>/i);
                        const htmlStart = htmlStartMatch ? htmlStartMatch[0] : '<html>';
                        const htmlEnd = originalContent.includes('</html>') ? '</html>' : '';
                        
                        // 重組完整的 HTML 結構
                        content = `<!DOCTYPE html>
${htmlStart}
<head>${headMatch[1]}</head>
${bodyStart}
    ${bodyContent}
${bodyEnd}
${htmlEnd}`;
                        
                        console.log('✅ 已使用資料庫原始模板的 HTML 結構和樣式');
                    }
                } else {
                    // 如果原始模板也沒有完整的 head，使用圖卡格式的完整模板
                    console.log('⚠️ 資料庫原始模板也缺少 head 部分，使用圖卡格式的完整模板');
                    const cardStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; background-color: #ffffff; }
        .header { background: #262A33; color: white; padding: 35px 30px; text-align: center; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 8px 0; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .header p { font-size: 16px; margin: 0; opacity: 0.9; }
        .content { background: #ffffff; padding: 30px; }
        .greeting { font-size: 15px; margin: 0 0 6px 0; }
        .intro-text { font-size: 14px; margin: 0 0 18px 0; color: #555; }
        .card { background: #ffffff; border: 1px solid #e8e8e8; border-radius: 8px; margin: 0 0 20px 0; overflow: hidden; }
        .card-header-dark { background: #262A33; color: white; padding: 15px 20px; display: flex; align-items: center; gap: 10px; }
        .card-header-dark .icon { font-size: 20px; }
        .card-header-dark span:last-child { font-size: 18px; font-weight: 600; }
        .card-body { padding: 20px; }
        .booking-table { width: 100%; border-collapse: collapse; }
        .booking-table td { padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .booking-table tr:last-child td { border-bottom: none; }
        .booking-label { font-weight: 600; color: #666; font-size: 15px; width: 120px; }
        .booking-value { color: #333; font-size: 15px; text-align: right; }
        .booking-value-strong { font-weight: 700; color: #262A33; }
        .section-card { border-radius: 8px; margin: 0 0 20px 0; overflow: hidden; border: 1px solid; }
        .section-transport { background: #e3f2fd; border-color: #90caf9; }
        .section-parking { background: #e3f2fd; border-color: #90caf9; }
        .section-notes { background: #fff9c4; border-color: #ffd54f; }
        .section-contact { background: #e3f2fd; border-color: #90caf9; }
        .section-header { padding: 15px 20px; display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 600; }
        .section-transport .section-header { color: #1976d2; background: rgba(33, 150, 243, 0.1); }
        .section-parking .section-header { color: #1976d2; background: rgba(33, 150, 243, 0.1); }
        .section-notes .section-header { color: #856404; background: rgba(255, 193, 7, 0.2); }
        .section-contact .section-header { color: #1976d2; background: rgba(33, 150, 243, 0.1); }
        .section-header .icon { font-size: 20px; }
        .section-body { padding: 20px; }
        .section-body p { margin: 0 0 12px 0; font-size: 16px; }
        .section-body p:last-child { margin-bottom: 0; }
        .section-body ul { margin: 12px 0; padding-left: 24px; }
        .section-body li { margin: 8px 0; font-size: 16px; }
        .mb-4 { margin-bottom: 16px !important; }
        .mt-16 { margin-top: 16px !important; }
        .footer-text { text-align: center; font-size: 16px; color: #333; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e8e8e8; }
        strong { color: #333; font-weight: 700; }
    `;
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
    <style>${cardStyle}</style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
                }
            } else {
                // 如果原始模板也沒有完整結構，使用圖卡格式的完整模板（與感謝入住格式一致，但使用藍色系）
                console.log('⚠️ 資料庫原始模板也缺少完整結構，使用圖卡格式的完整模板');
                const cardStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2196f3; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
    `;
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
    <style>${cardStyle}</style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
            }
        } catch (error) {
            console.warn('⚠️ 無法從資料庫讀取原始模板，使用圖卡格式的完整模板:', error.message);
            // 使用圖卡格式的完整模板作為備用方案（與感謝入住格式一致，但使用藍色系）
            const cardStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2196f3; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
    `;
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
    <style>${cardStyle}</style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
        }
    }
    
    // 重新檢查內容（可能在上面已經修復了）
    // 檢查是否已經有完整的圖卡樣式結構（container、header、content）
    const hasCardStructure = content.includes('class="container') || content.includes("class='container") ||
                             content.includes('class="header') || content.includes("class='header") ||
                             content.includes('class="content') || content.includes("class='content");
    
    const stillMissingStructure = !content.includes('<!DOCTYPE html>') && 
                                  !(content.includes('<html') && content.includes('</html>'));
    const stillMissingStyle = !content.includes('<style>') && !content.includes('<style ');
    const stillMissingBody = !content.includes('<body>') && !content.includes('<body ');
    
    // 如果模板已經有完整的圖卡樣式結構，不要進行任何修復，直接使用
    // 只有在缺少基本結構且沒有圖卡樣式時才進行修復
    if (!hasCardStructure && (stillMissingStructure || stillMissingStyle || stillMissingBody)) {
        console.log('⚠️ 郵件模板缺少基本 HTML 結構或樣式，自動修復中...', {
            templateKey,
            stillMissingStructure,
            stillMissingStyle,
            stillMissingBody,
            contentLength: content.length,
            isCheckinReminder
        });
        
        // 對於入住提醒郵件，使用圖卡格式的完整模板
        if (isCheckinReminder) {
            // 提取實際內容（body 部分）
            let bodyContent = content;
            if (content.includes('<body>')) {
                const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch && bodyMatch[1]) {
                    bodyContent = bodyMatch[1];
                }
            }
            
            // 使用圖卡格式的完整模板（與感謝入住格式一致，但使用藍色系）
            const cardStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2196f3; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196f3; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; }
        .info-value strong { color: #333; font-weight: 700; }
        .section-title { color: #333; font-size: 22px; font-weight: bold; margin: 30px 0 18px 0; display: flex; align-items: center; gap: 8px; }
        .section-title:first-of-type { margin-top: 0; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; font-weight: 500; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 25px; }
        strong { color: #333; font-weight: 700; }
        ul { margin: 15px 0; padding-left: 30px; }
        li { margin: 10px 0; font-size: 16px; line-height: 1.8; }
        .highlight-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section { background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #1976d2; margin: 0 0 15px 0; }
    `;
            
            content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${cardStyle}</style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
            
            console.log('✅ 入住提醒郵件模板已自動修復，使用圖卡格式的完整 HTML 結構和樣式');
        } else {
            // 其他郵件類型使用基本樣式
            const basicStyle = `
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; }
        h1 { color: #333; font-size: 28px; font-weight: bold; margin-bottom: 10px; margin-top: 0; }
        h2 { color: #333; font-size: 20px; font-weight: bold; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
        h3 { color: #333; font-size: 18px; font-weight: bold; margin-top: 25px; margin-bottom: 12px; }
        p { margin: 12px 0; font-size: 16px; line-height: 1.8; }
        .greeting { font-size: 18px; margin-bottom: 8px; }
        .intro-text { font-size: 16px; color: #555; margin-bottom: 20px; }
        .info-section { margin: 20px 0; }
        .info-item { margin: 10px 0; font-size: 16px; }
        .info-label { font-weight: bold; color: #333; display: inline-block; min-width: 120px; }
        .info-value { color: #333; }
        .highlight-box { background-color: #f8f9fa; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .warning-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .info-box { background-color: #e7f3ff; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 4px; }
        strong { color: #333; font-weight: bold; }
        ul, ol { margin: 15px 0; padding-left: 30px; }
        li { margin: 8px 0; font-size: 16px; line-height: 1.8; }
        .section-title { font-size: 20px; font-weight: bold; margin-top: 30px; margin-bottom: 15px; }
        .footer-text { font-size: 14px; color: #666; margin-top: 30px; text-align: center; }
    `;
            
            // 如果沒有完整的 HTML 結構，包裝現有內容
            if (stillMissingStructure) {
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
            } else if (stillMissingStyle) {
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
    }
    
    // 支援多種日期欄位格式（駝峰和底線）
    const checkInDateValue = booking.check_in_date || booking.checkInDate;
    const checkOutDateValue = booking.check_out_date || booking.checkOutDate;
    
    // 格式化日期，加入錯誤處理
    let checkInDate = '';
    let checkOutDate = '';
    try {
        if (checkInDateValue) {
            const date = new Date(checkInDateValue);
            if (!isNaN(date.getTime())) {
                checkInDate = date.toLocaleDateString('zh-TW');
            } else {
                console.warn('⚠️ 入住日期格式無效:', checkInDateValue);
                checkInDate = checkInDateValue; // 使用原始值
            }
        }
    } catch (e) {
        console.error('❌ 格式化入住日期失敗:', e);
        checkInDate = checkInDateValue || '';
    }
    
    try {
        if (checkOutDateValue) {
            const date = new Date(checkOutDateValue);
            if (!isNaN(date.getTime())) {
                checkOutDate = date.toLocaleDateString('zh-TW');
            } else {
                console.warn('⚠️ 退房日期格式無效:', checkOutDateValue);
                checkOutDate = checkOutDateValue; // 使用原始值
            }
        }
    } catch (e) {
        console.error('❌ 格式化退房日期失敗:', e);
        checkOutDate = checkOutDateValue || '';
    }
    
    // 計算匯款到期日期（優先使用 booking 中的資料）
    let paymentDeadline = '';
    let daysReserved = booking.daysReserved || booking.days_reserved || template.days_reserved || 3;
    
    // 優先使用 booking 中已計算好的 paymentDeadline
    if (booking.paymentDeadline || booking.payment_deadline) {
        const rawDeadline = booking.paymentDeadline || booking.payment_deadline;
        // 如果是原始日期物件或 ISO 字串，重新格式化
        const deadlineDate = new Date(rawDeadline);
        if (!isNaN(deadlineDate.getTime())) {
            paymentDeadline = formatPaymentDeadline(deadlineDate);
        } else {
            paymentDeadline = rawDeadline; // 保持原樣（可能已經是格式化好的字串）
        }
        console.log('✅ 使用 booking 中的 paymentDeadline:', paymentDeadline);
    } else if (booking.created_at && booking.check_in_date) {
        // 如果沒有，則根據 created_at, check_in_date 和 daysReserved 計算
        try {
            const { deadline: deadlineDate, actualDaysReserved } = calculateDynamicPaymentDeadline(booking.created_at, booking.check_in_date, daysReserved);
            paymentDeadline = formatPaymentDeadline(deadlineDate);
            daysReserved = actualDaysReserved; // 使用實際計算的保留天數
            console.log('✅ 計算 paymentDeadline:', paymentDeadline, '(訂房日期:', new Date(booking.created_at).toLocaleDateString('zh-TW'), ', 實際保留天數:', actualDaysReserved, ')');
        } catch (e) {
            console.error('❌ 計算 paymentDeadline 失敗:', e);
        }
    } else if (booking.created_at) {
        // 如果沒有入住日期，使用舊的邏輯（向後兼容）
        try {
            const { deadline: deadlineDate } = calculateDynamicPaymentDeadline(booking.created_at, null, daysReserved);
            paymentDeadline = formatPaymentDeadline(deadlineDate);
            console.log('✅ 計算 paymentDeadline:', paymentDeadline, '(訂房日期:', new Date(booking.created_at).toLocaleDateString('zh-TW'), ')');
        } catch (e) {
            console.error('❌ 計算 paymentDeadline 失敗:', e);
        }
    }
    
    // 如果還是沒有，顯示警告
    if (!paymentDeadline) {
        console.warn('⚠️ 無法計算 paymentDeadline，將顯示為空');
    }
    
    // 處理銀行分行顯示（如果有分行則顯示 " - 分行名"，否則為空）
    const bankBranchDisplay = bankInfo && bankInfo.bankBranch ? ' - ' + bankInfo.bankBranch : '';
    
    // 判斷是否為訂金支付（檢查 payment_amount 欄位是否包含「訂金」）
    // 先取得 paymentAmount，稍後在 variables 中使用
    const paymentAmount = booking.payment_amount || booking.paymentAmount || '';
    const isDeposit = paymentAmount && paymentAmount.includes('訂金');
    
    // 計算總金額、折扣金額和折後總額（支援多種格式）
    const originalAmount = booking.original_amount || booking.originalAmount || booking.total_amount || booking.totalAmount || 0;
    const totalAmount = booking.total_amount || booking.totalAmount || 0;
    const discountAmount = booking.discount_amount || booking.discountAmount || 0;
    // 如果 booking 中有 discountedTotal，優先使用；否則計算
    const discountedTotal = booking.discountedTotal || (discountAmount > 0 ? Math.max(0, originalAmount - discountAmount) : originalAmount);
    const finalAmount = booking.final_amount || booking.finalAmount || 0;
    
    // 計算剩餘尾款金額
    // 剩餘尾款 = 折後總額 - 已付金額（finalAmount）
    // 如果有折扣，使用折後總額；如果沒有折扣，discountedTotal 等於 totalAmount
    const remainingAmount = Math.max(0, discountedTotal - finalAmount);
    
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
                    const unitLabel = (addon.unit_label || addonInfo?.unit_label || '人').trim();
                    return `${displayName} x${quantity} (每${unitLabel}, NT$ ${itemTotal.toLocaleString()})`;
                }).join('、');
                addonsTotal = booking.addons_total || parsedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0);
            }
        } catch (err) {
            console.error('處理加購商品顯示失敗:', err);
        }
    }
    
    // 計算住宿天數（使用已解析的日期值）
    const msPerDay = 1000 * 60 * 60 * 24;
    let nights = 1;
    try {
        if (checkInDateValue && checkOutDateValue) {
            const checkIn = new Date(checkInDateValue);
            const checkOut = new Date(checkOutDateValue);
            if (!isNaN(checkIn.getTime()) && !isNaN(checkOut.getTime())) {
                nights = Math.max(1, Math.round((checkOut - checkIn) / msPerDay));
            }
        }
    } catch (e) {
        console.error('❌ 計算住宿天數失敗:', e);
        nights = booking.nights || 1; // 使用傳入的 nights 值作為備用
    }
    
    // 計算訂房編號後5碼（支援多種格式）
    const bookingId = booking.booking_id || booking.bookingId || '';
    const bookingIdLast5 = bookingId ? bookingId.slice(-5) : '';
    
    // 判斷是否為匯款轉帳（支援多種格式）
    const paymentMethodValue = booking.payment_method || booking.paymentMethod || '';
    const isTransfer = paymentMethodValue === '匯款轉帳' || paymentMethodValue === 'transfer';
    
    // 判斷是否為線上刷卡且已付款（用於顯示「已付金額」而非「應付金額」）
    const paymentStatus = booking.payment_status || booking.paymentStatus || 'pending';
    const isOnlineCardPaid = (paymentMethodValue === '線上刷卡' || paymentMethodValue === 'card') && 
                             (paymentStatus === 'paid' || paymentStatus === '已付款');
    
    // 根據支付狀態決定金額標籤
    const amountLabel = (paymentStatus === 'paid' || paymentStatus === '已付款') ? '已付金額' : '應付金額';
    
    // 格式化日期時間（支援多種格式）
    const createdAt = booking.created_at || booking.createdAt || booking.bookingDate;
    let bookingDate = '';
    let bookingDateTime = '';
    if (createdAt) {
        try {
            const date = new Date(createdAt);
            if (!isNaN(date.getTime())) {
                bookingDate = date.toLocaleDateString('zh-TW');
                bookingDateTime = date.toLocaleString('zh-TW');
            }
        } catch (e) {
            console.error('❌ 格式化訂房日期失敗:', e);
        }
    }
    
    // 格式化價格（支援多種格式）
    const pricePerNight = booking.price_per_night || booking.pricePerNight || 0;
    
    // 支援多種欄位格式（駝峰和底線）
    const guestName = booking.guest_name || booking.guestName || '';
    const roomType = booking.room_type || booking.roomType || '';
    const guestPhone = booking.guest_phone || booking.guestPhone || '';
    const guestEmail = booking.guest_email || booking.guestEmail || '';
    const specialRequest = booking.special_request || booking.specialRequest || '';

    // 入住提醒區塊內容與顯示開關
    const defaultBookingInfoContent = `<div class="info-row">
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
<div class="info-row" style="border-bottom: none;">
    <span class="info-label">房型</span>
    <span class="info-value">{{roomType}}</span>
</div>`;
    const bookingInfoContent = (isCheckinReminder &&
        checkinBlockSettings.booking_info &&
        typeof checkinBlockSettings.booking_info.content === 'string' &&
        checkinBlockSettings.booking_info.content.trim() !== '')
        ? checkinBlockSettings.booking_info.content
        : defaultBookingInfoContent;
    const showBookingInfo = !isCheckinReminder || checkinBlockSettings.booking_info?.enabled !== false;
    const showTransport = !isCheckinReminder || checkinBlockSettings.transport?.enabled !== false;
    const showParking = !isCheckinReminder || checkinBlockSettings.parking?.enabled !== false;
    const showNotes = !isCheckinReminder || checkinBlockSettings.notes?.enabled !== false;
    const showContact = !isCheckinReminder || checkinBlockSettings.contact?.enabled !== false;
    
    const variables = {
        '{{guestName}}': guestName,
        '{{bookingId}}': bookingId,
        '{{bookingIdLast5}}': bookingIdLast5,
        '{{checkInDate}}': checkInDate,
        '{{checkOutDate}}': checkOutDate,
        '{{roomType}}': roomType,
        '{{nights}}': nights.toString(),
        '{{pricePerNight}}': pricePerNight.toLocaleString(),
        '{{totalAmount}}': totalAmount.toLocaleString(),
        '{{originalAmount}}': originalAmount.toLocaleString(),
        '{{discountAmount}}': discountAmount.toLocaleString(),
        '{{discountedTotal}}': discountedTotal.toLocaleString(),
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
        '{{paymentMethod}}': paymentMethodValue,
        '{{paymentAmount}}': paymentAmount,
        '{{guestPhone}}': guestPhone,
        '{{guestEmail}}': guestEmail,
        '{{specialRequest}}': specialRequest || '-',
        '{{bookingDate}}': bookingDate,
        '{{bookingDateTime}}': bookingDateTime,
        '{{bookingInfoContent}}': bookingInfoContent,
        '{{paymentStatus}}': paymentStatus,
        '{{isOnlineCardPaid}}': isOnlineCardPaid ? 'true' : 'false',
        '{{amountLabel}}': amountLabel, // 已付金額 或 應付金額
        ...additionalData // 合併額外的變數
    };
    
    // 如果 additionalData 中沒有 hotelEmail、hotelPhone、hotelAddress，則從資料庫取得（未設定時使用預設值）
    const hotelSettings = await getHotelSettingsWithFallback();
    if (!variables['{{hotelEmail}}']) {
        variables['{{hotelEmail}}'] = hotelSettings.hotelEmail;
    }
    if (!variables['{{hotelPhone}}']) {
        variables['{{hotelPhone}}'] = hotelSettings.hotelPhone;
    }
    // 地址變數：供模板中直接使用 {{hotelAddress}}
    if (!variables['{{hotelAddress}}']) {
        variables['{{hotelAddress}}'] = hotelSettings.hotelAddress;
    }
    // 訂房網址變數：供模板中直接使用 {{bookingUrl}}
    if (!variables['{{bookingUrl}}']) {
        // 優先使用環境變數，其次使用系統設定，最後使用預設值
        const bookingUrl = process.env.FRONTEND_URL || 
                          await db.getSetting('frontend_url') || 
                          (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://your-booking-site.com');
        variables['{{bookingUrl}}'] = bookingUrl;
    }
    // 官方 LINE 連結：供模板中直接使用 {{officialLineUrl}}
    if (!variables['{{officialLineUrl}}']) {
        const officialLineUrl = await db.getSetting('landing_social_line') || '';
        variables['{{officialLineUrl}}'] = officialLineUrl;
    }
    // Google 評價連結：供模板中直接使用 {{googleReviewUrl}}
    if (!variables['{{googleReviewUrl}}']) {
        const googleReviewUrl = await db.getSetting('landing_google_review_url') || '';
        variables['{{googleReviewUrl}}'] = googleReviewUrl;
    }
    
    // 處理嵌套條件區塊的輔助函數（改進版，能正確處理嵌套結構）
    // 需要在處理入住提醒區塊之前定義
    function processConditionalBlock(content, condition, conditionName) {
        const startTag = `{{#if ${conditionName}}}`;
        const elseTag = '{{else}}';
        const endTag = '{{/if}}';
        
        // 從後往前處理，避免索引問題
        let lastIndex = content.length;
        while (true) {
            const startIndex = content.lastIndexOf(startTag, lastIndex - 1);
            if (startIndex === -1) break;
            
            // 找到對應的 {{else}} 和 {{/if}}，使用計數確保匹配正確
            let elseIndex = -1;
            let endIndex = -1;
            let depth = 1;
            let searchIndex = startIndex + startTag.length;
            
            // 先找 {{else}}
            while (searchIndex < content.length) {
                const nextIf = content.indexOf('{{#if', searchIndex);
                const nextElse = content.indexOf(elseTag, searchIndex);
                const nextEndIf = content.indexOf(endTag, searchIndex);
                
                if (nextEndIf === -1) break;
                
                // 找到最近的標籤
                let nextIndex = content.length;
                let nextType = '';
                if (nextIf !== -1 && nextIf < nextIndex) {
                    nextIndex = nextIf;
                    nextType = 'if';
                }
                if (nextElse !== -1 && nextElse < nextIndex && depth === 1) {
                    nextIndex = nextElse;
                    nextType = 'else';
                }
                if (nextEndIf < nextIndex) {
                    nextIndex = nextEndIf;
                    nextType = 'endif';
                }
                
                if (nextType === 'if') {
                    depth++;
                    // 找到完整的 {{#if ...}} 標籤結束位置
                    const ifEnd = content.indexOf('}}', nextIf);
                    searchIndex = ifEnd !== -1 ? ifEnd + 2 : nextIf + 5;
                } else if (nextType === 'else' && depth === 1) {
                    elseIndex = nextElse;
                    searchIndex = nextElse + elseTag.length;
                } else if (nextType === 'endif') {
                    depth--;
                    if (depth === 0) {
                        endIndex = nextEndIf;
                        break;
                    }
                    searchIndex = nextEndIf + endTag.length;
                } else {
                    break;
                }
            }
            
            if (endIndex === -1) {
                lastIndex = startIndex - 1;
                continue; // 找不到對應的結束標籤，跳過
            }
            
            if (elseIndex !== -1) {
                // 有 {{else}}
                const beforeElse = content.substring(startIndex + startTag.length, elseIndex);
                const afterElse = content.substring(elseIndex + elseTag.length, endIndex);
                const replacement = condition ? beforeElse : afterElse;
                content = content.substring(0, startIndex) + replacement + content.substring(endIndex + endTag.length);
            } else {
                // 沒有 {{else}}
                const blockContent = content.substring(startIndex + startTag.length, endIndex);
                const replacement = condition ? blockContent : '';
                content = content.substring(0, startIndex) + replacement + content.substring(endIndex + endTag.length);
            }
            
            lastIndex = startIndex - 1;
        }
        
        return content;
    }
    
    // 所有郵件類型統一使用一般變數替換
    Object.keys(variables).forEach(key => {
        content = content.replace(new RegExp(key, 'g'), variables[key]);
    });
    
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
    
    // 2. 處理中間層條件（addonsList, hasDiscount）
    const hasAddons = addonsList && addonsList.trim() !== '';
    content = processConditionalBlock(content, hasAddons, 'addonsList');
    
    // 處理折扣條件（discountAmount > 0）
    const hasDiscount = discountAmount > 0;
    content = processConditionalBlock(content, hasDiscount, 'hasDiscount');
    
    // 處理官方 LINE 條件（有設定銷售頁 LINE 才顯示）
    const hasOfficialLineUrl = !!(variables['{{officialLineUrl}}'] && String(variables['{{officialLineUrl}}']).trim() !== '');
    content = processConditionalBlock(content, hasOfficialLineUrl, 'officialLineUrl');
    // 處理 Google 評價連結條件（有設定連結才顯示按鈕）
    const hasGoogleReviewUrl = !!(variables['{{googleReviewUrl}}'] && String(variables['{{googleReviewUrl}}']).trim() !== '');
    content = processConditionalBlock(content, hasGoogleReviewUrl, 'googleReviewUrl');

    // 入住提醒區塊條件
    if (isCheckinReminder) {
        content = processConditionalBlock(content, showBookingInfo, 'showBookingInfo');
        content = processConditionalBlock(content, showTransport, 'showTransport');
        content = processConditionalBlock(content, showParking, 'showParking');
        content = processConditionalBlock(content, showNotes, 'showNotes');
        content = processConditionalBlock(content, showContact, 'showContact');
    }
    
    
    // 判斷是否有匯款資訊（檢查至少有一個非空欄位）
    // 需要檢查欄位是否存在且不是空字串
    const hasBankInfo = bankInfo && (
        (bankInfo.bankName && bankInfo.bankName.trim() !== '') ||
        (bankInfo.account && bankInfo.account.trim() !== '') ||
        (bankInfo.bankBranch && bankInfo.bankBranch.trim() !== '') ||
        (bankInfo.accountName && bankInfo.accountName.trim() !== '')
    );
    console.log('🔍 檢查匯款資訊:', {
        hasBankInfo,
        bankInfo: bankInfo ? {
            bankName: bankInfo.bankName || '(空)',
            bankBranch: bankInfo.bankBranch || '(空)',
            account: bankInfo.account ? (bankInfo.account.length > 4 ? bankInfo.account.substring(0, 4) + '...' : bankInfo.account) : '(空)',
            accountName: bankInfo.accountName || '(空)',
            allFieldsEmpty: !bankInfo.bankName && !bankInfo.account && !bankInfo.bankBranch && !bankInfo.accountName
        } : null
    });
    
    // 3. 處理外層條件（isDeposit, isTransfer）- 先處理外層
    content = processConditionalBlock(content, isDeposit, 'isDeposit');
    content = processConditionalBlock(content, isTransfer, 'isTransfer');
    
    // 4. 處理 bankInfo（在 isTransfer 處理後，因為 bankInfo 在 isTransfer 內部）
    // 記錄處理前的內容片段（用於調試）
    const beforeBankInfo = content.substring(0, Math.min(500, content.length));
    console.log('🔍 處理 bankInfo 前的內容片段:', beforeBankInfo);
    content = processConditionalBlock(content, hasBankInfo, 'bankInfo');
    const afterBankInfo = content.substring(0, Math.min(500, content.length));
    console.log('🔍 處理 bankInfo 後的內容片段:', afterBankInfo);
    
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
    
    // 如果已付款，自動將模板中的「應付金額」替換為「已付金額」
    if (paymentStatus === 'paid' || paymentStatus === '已付款') {
        // 替換各種可能的「應付金額」文字（包括 HTML 標籤內）
        content = content.replace(/應付金額/g, '已付金額');
        // 同時替換可能的顏色樣式，將紅色改為綠色（已付款）
        content = content.replace(/color:\s*#e74c3c|color:\s*#667eea|color:\s*#f44336/g, 'color: #4caf50');
    }
    
    // 移除 {{hotelInfoFooter}} 變數（如果存在）
    content = content.replace(/\{\{hotelInfoFooter\}\}/g, '');

    // 相容舊模板：僅管理員訂房確認郵件自動插入特殊需求
    if (templateKey === 'booking_confirmation_admin') {
        content = injectSpecialRequestRowForLegacyTemplate(content, specialRequest);
    }

    // 確保模板主題存在（支援多種欄位名稱）
    let subject = template.subject || template.template_subject || '';
    if (!subject || subject.trim() === '') {
        console.error('❌ 郵件模板主題為空:', {
            templateKey: template.key || template.template_key,
            hasSubject: !!template.subject,
            hasTemplateSubject: !!template.template_subject
        });
        throw new Error('郵件模板主題為空');
    }
    
    Object.keys(variables).forEach(key => {
        subject = subject.replace(new RegExp(key, 'g'), variables[key]);
    });
    
    // 保險機制：即使 DB 內是舊模板，也強制 Google 評價按鈕白字
    content = enforceGoogleReviewButtonStyle(content);
    content = ensureAutoMailNotice(content);
    return { subject, content };
}

// 靜態檔案服務 - uploads 目錄（保留以支援尚未遷移到 R2 的舊圖片）
app.use('/uploads', express.static(uploadsDir, {
    maxAge: '7d',
    etag: true
}));

// 靜態檔案服務（放在最後，避免覆蓋 API 路由）
// 後台快取策略：
// - admin.html：no-store（永遠拿最新入口檔）
// - admin.js / admin.css：短快取（提升重整速度，降低反覆下載）
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        try {
            const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
            const isAdminHtml = normalized.endsWith('/admin.html');
            const isAdminJsOrCss = normalized.endsWith('/admin.js') || normalized.endsWith('/admin.css');

            if (isAdminHtml) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            } else if (isAdminJsOrCss) {
                // 5 分鐘短快取，兼顧載入速度與更新時效
                res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
            }
        } catch (_) {
            // ignore
        }
    }
}));

// ============================================
// 統一錯誤處理中間件（必須放在所有路由之後）
// ============================================
app.use(errorHandler);

// 啟動應用程式
startServer({
    app,
    port: PORT,
    processEnv: process.env,
    db,
    initEmailService: async () => {
        await initEmailServiceBootstrap({
            db,
            processEnv: process.env,
            getRequiredEmailUser,
            Resend,
            nodemailer,
            emailRuntime,
            resetEmailRuntime
        });
    },
    getConfiguredSenderEmail: () => getConfiguredSenderEmail(emailRuntime),
    storage,
    registerScheduledJobs,
    cron,
    backup,
    bookingJobs: bookingNotificationJobs,
    adminLogCleanupJobs
}).catch((error) => {
    console.error('❌ 應用程式啟動失敗:', error.message);
    console.error('錯誤詳情:', error.stack);
    // 延遲退出，確保 Railway 有時間捕捉 stderr 日誌
    setTimeout(() => process.exit(1), 2000);
});

