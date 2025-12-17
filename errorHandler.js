/**
 * 統一錯誤處理模組
 * 提供友善的錯誤訊息和錯誤日誌記錄
 */

/**
 * 自訂錯誤類別
 */
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational; // 是否為可預期的錯誤
        this.details = details;
        this.timestamp = new Date().toISOString();
        
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * 錯誤類型對應的友善訊息
 */
const ERROR_MESSAGES = {
    // 資料庫錯誤
    'database': '資料庫操作失敗，請稍後再試',
    'connection': '無法連接到資料庫，請稍後再試',
    'query': '資料查詢失敗，請稍後再試',
    'constraint': '資料驗證失敗，請檢查輸入資料',
    
    // 驗證錯誤
    'validation': '輸入資料驗證失敗',
    'required': '請填寫所有必填欄位',
    'format': '資料格式不正確',
    'range': '數值超出允許範圍',
    
    // 認證錯誤
    'authentication': '身份驗證失敗',
    'authorization': '沒有權限執行此操作',
    'session': '登入已過期，請重新登入',
    
    // 資源錯誤
    'not_found': '找不到指定的資源',
    'duplicate': '資料已存在',
    'conflict': '資料衝突，請檢查後再試',
    
    // 系統錯誤
    'internal': '伺服器內部錯誤，請稍後再試',
    'timeout': '請求超時，請稍後再試',
    'rate_limit': '請求過於頻繁，請稍後再試',
    
    // 郵件錯誤
    'email': '郵件發送失敗，請稍後再試',
    'email_config': '郵件設定錯誤，請聯繫管理員',
    
    // 支付錯誤
    'payment': '支付處理失敗，請稍後再試',
    'payment_config': '支付設定錯誤，請聯繫管理員'
};

/**
 * 判斷錯誤類型並返回友善訊息
 */
function getFriendlyMessage(error) {
    // 如果是自訂錯誤，直接返回訊息
    if (error instanceof AppError) {
        return error.message;
    }
    
    // 根據錯誤訊息判斷類型
    const errorMessage = error.message?.toLowerCase() || '';
    const errorStack = error.stack?.toLowerCase() || '';
    
    // 資料庫錯誤
    if (errorMessage.includes('database') || errorMessage.includes('sql') || 
        errorMessage.includes('connection') || errorMessage.includes('query')) {
        if (errorMessage.includes('unique') || errorMessage.includes('duplicate')) {
            return ERROR_MESSAGES.duplicate;
        }
        if (errorMessage.includes('constraint') || errorMessage.includes('foreign key')) {
            return ERROR_MESSAGES.constraint;
        }
        if (errorMessage.includes('connection') || errorMessage.includes('timeout')) {
            return ERROR_MESSAGES.connection;
        }
        return ERROR_MESSAGES.database;
    }
    
    // 驗證錯誤
    if (errorMessage.includes('validation') || errorMessage.includes('invalid') ||
        errorMessage.includes('required') || errorMessage.includes('format')) {
        if (errorMessage.includes('required')) {
            return ERROR_MESSAGES.required;
        }
        if (errorMessage.includes('format') || errorMessage.includes('invalid')) {
            return ERROR_MESSAGES.format;
        }
        return ERROR_MESSAGES.validation;
    }
    
    // 認證錯誤
    if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication') ||
        errorMessage.includes('login') || errorMessage.includes('session')) {
        if (errorMessage.includes('session') || errorMessage.includes('expired')) {
            return ERROR_MESSAGES.session;
        }
        if (errorMessage.includes('permission') || errorMessage.includes('authorization')) {
            return ERROR_MESSAGES.authorization;
        }
        return ERROR_MESSAGES.authentication;
    }
    
    // 資源錯誤
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        return ERROR_MESSAGES.not_found;
    }
    if (errorMessage.includes('conflict') || errorMessage.includes('409')) {
        return ERROR_MESSAGES.conflict;
    }
    
    // 郵件錯誤
    if (errorMessage.includes('email') || errorMessage.includes('smtp') ||
        errorMessage.includes('mail')) {
        if (errorMessage.includes('config') || errorMessage.includes('credential')) {
            return ERROR_MESSAGES.email_config;
        }
        return ERROR_MESSAGES.email;
    }
    
    // 支付錯誤
    if (errorMessage.includes('payment') || errorMessage.includes('pay')) {
        if (errorMessage.includes('config')) {
            return ERROR_MESSAGES.payment_config;
        }
        return ERROR_MESSAGES.payment;
    }
    
    // 預設錯誤訊息
    return ERROR_MESSAGES.internal;
}

/**
 * 記錄錯誤日誌
 */
function logError(error, req = null) {
    const timestamp = new Date().toISOString();
    const errorInfo = {
        timestamp,
        message: error.message,
        stack: error.stack,
        statusCode: error.statusCode || 500,
        isOperational: error.isOperational !== false,
        details: error.details || null
    };
    
    if (req) {
        errorInfo.request = {
            method: req.method,
            path: req.path,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.get('user-agent'),
            body: req.body,
            query: req.query,
            params: req.params
        };
        
        // 如果有管理員資訊，記錄
        if (req.session?.admin) {
            errorInfo.admin = {
                id: req.session.admin.id,
                username: req.session.admin.username
            };
        }
    }
    
    // 記錄到 console（生產環境可以改為記錄到檔案或日誌服務）
    if (error.statusCode >= 500) {
        console.error('❌ [錯誤]', JSON.stringify(errorInfo, null, 2));
    } else {
        console.warn('⚠️  [警告]', JSON.stringify(errorInfo, null, 2));
    }
    
    return errorInfo;
}

/**
 * 統一錯誤處理中間件
 */
function errorHandler(err, req, res, next) {
    // 如果是自訂錯誤，使用其狀態碼和訊息
    let statusCode = err.statusCode || 500;
    let message = getFriendlyMessage(err);
    let details = null;
    
    // 記錄錯誤
    const errorLog = logError(err, req);
    
    // 在開發環境顯示詳細錯誤資訊
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    // 如果是操作錯誤（可預期的），顯示原始訊息
    if (err instanceof AppError && err.isOperational) {
        message = err.message;
        details = err.details;
    }
    
    // 準備回應
    const response = {
        success: false,
        message: message,
        timestamp: new Date().toISOString()
    };
    
    // 在開發環境或特定錯誤時，包含詳細資訊
    if (isDevelopment || statusCode < 500) {
        if (details) {
            response.details = details;
        }
        // 開發環境顯示技術錯誤
        if (isDevelopment) {
            response.error = {
                message: err.message,
                stack: err.stack
            };
        }
    }
    
    // 如果是 500 錯誤，記錄完整錯誤資訊
    if (statusCode >= 500) {
        console.error('❌ 伺服器錯誤:', {
            message: err.message,
            stack: err.stack,
            request: {
                method: req.method,
                path: req.path,
                body: req.body
            }
        });
    }
    
    res.status(statusCode).json(response);
}

/**
 * 非同步錯誤處理包裝器
 * 自動捕獲 async 函數中的錯誤
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * 建立自訂錯誤的輔助函數
 */
function createError(message, statusCode = 500, details = null) {
    return new AppError(message, statusCode, true, details);
}

/**
 * 建立驗證錯誤
 */
function createValidationError(message, details = null) {
    return new AppError(message, 400, true, details);
}

/**
 * 建立認證錯誤
 */
function createAuthError(message = '身份驗證失敗') {
    return new AppError(message, 401, true);
}

/**
 * 建立授權錯誤
 */
function createAuthorizationError(message = '沒有權限執行此操作') {
    return new AppError(message, 403, true);
}

/**
 * 建立資源不存在錯誤
 */
function createNotFoundError(resource = '資源') {
    return new AppError(`找不到指定的${resource}`, 404, true);
}

/**
 * 建立衝突錯誤
 */
function createConflictError(message = '資料衝突') {
    return new AppError(message, 409, true);
}

module.exports = {
    AppError,
    errorHandler,
    asyncHandler,
    createError,
    createValidationError,
    createAuthError,
    createAuthorizationError,
    createNotFoundError,
    createConflictError,
    logError,
    getFriendlyMessage
};

