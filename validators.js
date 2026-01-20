/**
 * 輸入驗證與清理工具模組
 * 提供統一的輸入驗證、清理和安全性檢查功能
 */

/**
 * HTML 轉義（防止 XSS）
 */
function escapeHtml(text) {
    if (text == null || text === undefined) {
        return '';
    }
    const str = String(text);
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return str.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 清理字串輸入（移除危險字元）
 */
function sanitizeString(input) {
    if (input == null || input === undefined) {
        return '';
    }
    const str = String(input);
    // 移除控制字元（保留換行和 Tab）
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * 清理數字輸入
 */
function sanitizeNumber(input, defaultValue = 0) {
    if (input == null || input === undefined || input === '') {
        return defaultValue;
    }
    const num = Number(input);
    return isNaN(num) ? defaultValue : num;
}

/**
 * 清理日期字串
 */
function sanitizeDate(input) {
    if (!input) return null;
    const str = String(input).trim();
    // 只允許 YYYY-MM-DD 格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(str)) {
        return null;
    }
    const date = new Date(str);
    if (isNaN(date.getTime())) {
        return null;
    }
    return str;
}

/**
 * 清理 Email
 */
function sanitizeEmail(input) {
    if (!input) return null;
    const str = String(input).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(str)) {
        return null;
    }
    // 限制長度
    if (str.length > 255) {
        return null;
    }
    return str;
}

/**
 * 清理台灣手機號碼
 */
function sanitizePhone(input) {
    if (!input) return null;
    const str = String(input).trim().replace(/[-\s]/g, '');
    // 台灣手機號碼：09 開頭，共 10 碼
    const phoneRegex = /^09\d{8}$/;
    if (!phoneRegex.test(str)) {
        return null;
    }
    return str;
}

/**
 * 檢查 SQL Injection 危險字元
 */
function containsSQLInjection(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    
    // 先檢查是否為有效的 JSON 格式
    // 如果是有效的 JSON，跳過 SQL Injection 檢測（因為 JSON 格式本身是安全的）
    try {
        const parsed = JSON.parse(input);
        // 如果是有效的 JSON 物件或陣列，不視為 SQL Injection
        if (parsed && typeof parsed === 'object') {
            return false;
        }
    } catch (e) {
        // 不是有效的 JSON，繼續檢查 SQL Injection
    }
    
    const dangerousPatterns = [
        // SQL 關鍵字
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/i,
        // SQL 註解和特殊字元（但排除單獨的雙引號）
        /(--|\/\*|\*\/|xp_|sp_)/i,
        // SQL 邏輯運算符
        /(\bOR\b.*=.*=|\bAND\b.*=.*=)/i,
        // 危險字元組合（但不包括單獨的引號，因為 JSON 格式會使用引號）
        /(;.*--|;.*\/\*|\*\/.*;|'.*OR.*'|".*OR.*"|'.*AND.*'|".*AND.*")/i
    ];
    return dangerousPatterns.some(pattern => pattern.test(input));
}

/**
 * 檢查 XSS 危險字元
 */
function containsXSS(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const dangerousPatterns = [
        /<script[^>]*>.*?<\/script>/gi,
        /<iframe[^>]*>.*?<\/iframe>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi, // onclick=, onerror=, etc.
        /<img[^>]*src[^>]*=.*javascript:/gi
    ];
    return dangerousPatterns.some(pattern => pattern.test(input));
}

/**
 * 驗證必填欄位
 */
function validateRequired(fields, data) {
    const missing = [];
    for (const field of fields) {
        if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
            missing.push(field);
        }
    }
    if (missing.length > 0) {
        return {
            valid: false,
            message: `缺少必填欄位: ${missing.join(', ')}`
        };
    }
    return { valid: true };
}

/**
 * 驗證日期範圍
 */
function validateDateRange(checkInDate, checkOutDate) {
    if (!checkInDate || !checkOutDate) {
        return {
            valid: false,
            message: '請提供入住和退房日期'
        };
    }
    
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
        return {
            valid: false,
            message: '日期格式不正確'
        };
    }
    
    if (checkIn < today) {
        return {
            valid: false,
            message: '入住日期不能早於今天'
        };
    }
    
    if (checkOut <= checkIn) {
        return {
            valid: false,
            message: '退房日期必須晚於入住日期'
        };
    }
    
    // 限制最多預訂天數（例如 365 天）
    const maxDays = 365;
    const daysDiff = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (daysDiff > maxDays) {
        return {
            valid: false,
            message: `最多只能預訂 ${maxDays} 天`
        };
    }
    
    return { valid: true };
}

/**
 * 驗證數字範圍
 */
function validateNumberRange(value, min, max, fieldName = '數值') {
    const num = Number(value);
    if (isNaN(num)) {
        return {
            valid: false,
            message: `${fieldName} 必須是數字`
        };
    }
    if (min !== undefined && num < min) {
        return {
            valid: false,
            message: `${fieldName} 不能小於 ${min}`
        };
    }
    if (max !== undefined && num > max) {
        return {
            valid: false,
            message: `${fieldName} 不能大於 ${max}`
        };
    }
    return { valid: true };
}

/**
 * 清理整個物件（遞迴）
 */
function sanitizeObject(obj, options = {}) {
    if (obj == null || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, options));
    }
    
    // 獲取要排除的欄位名稱列表
    const excludeFields = options.excludeFields || [];
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        // 如果欄位在排除列表中，直接跳過檢查
        if (excludeFields.includes(key)) {
            sanitized[key] = value;
            continue;
        }
        
        if (value == null) {
            sanitized[key] = value;
        } else if (typeof value === 'string') {
            // 檢查 SQL Injection 和 XSS
            if (options.checkSQLInjection && containsSQLInjection(value)) {
                throw new Error(`檢測到 SQL Injection 攻擊嘗試（欄位: ${key}）`);
            }
            if (options.checkXSS && containsXSS(value)) {
                throw new Error(`檢測到 XSS 攻擊嘗試（欄位: ${key}）`);
            }
            sanitized[key] = sanitizeString(value);
        } else if (typeof value === 'number') {
            sanitized[key] = sanitizeNumber(value);
        } else if (typeof value === 'object') {
            sanitized[key] = sanitizeObject(value, options);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

/**
 * 驗證中間件工廠
 */
function createValidationMiddleware(rules) {
    return (req, res, next) => {
        try {
            // 清理請求資料
            if (req.body) {
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
            
            // 執行驗證規則
            if (rules) {
                for (const rule of rules) {
                    const result = rule(req);
                    if (!result.valid) {
                        return res.status(400).json({
                            success: false,
                            message: result.message || '驗證失敗'
                        });
                    }
                }
            }
            
            next();
        } catch (error) {
            console.error('驗證錯誤:', error);
            return res.status(400).json({
                success: false,
                message: error.message || '輸入驗證失敗'
            });
        }
    };
}

module.exports = {
    escapeHtml,
    sanitizeString,
    sanitizeNumber,
    sanitizeDate,
    sanitizeEmail,
    sanitizePhone,
    containsSQLInjection,
    containsXSS,
    validateRequired,
    validateDateRange,
    validateNumberRange,
    sanitizeObject,
    createValidationMiddleware
};

