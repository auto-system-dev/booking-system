/**
 * 個資保護功能模組
 * 處理個資查詢、刪除請求
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');

// 驗證碼儲存（實際應用中應使用 Redis 或資料庫）
const verificationCodes = new Map();

// 驗證碼有效期（15 分鐘）
const VERIFICATION_CODE_EXPIRY = 15 * 60 * 1000;

/**
 * 生成驗證碼
 */
function generateVerificationCode() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * 儲存驗證碼
 */
function saveVerificationCode(email, code, purpose) {
    const key = `${email}:${purpose}`;
    verificationCodes.set(key, {
        code: code,
        expiresAt: Date.now() + VERIFICATION_CODE_EXPIRY,
        purpose: purpose
    });
    
    // 15 分鐘後自動清除
    setTimeout(() => {
        verificationCodes.delete(key);
    }, VERIFICATION_CODE_EXPIRY);
}

/**
 * 驗證驗證碼
 */
function verifyCode(email, code, purpose) {
    const key = `${email}:${purpose}`;
    const stored = verificationCodes.get(key);
    
    if (!stored) {
        return { valid: false, message: '驗證碼不存在或已過期' };
    }
    
    if (Date.now() > stored.expiresAt) {
        verificationCodes.delete(key);
        return { valid: false, message: '驗證碼已過期' };
    }
    
    if (stored.code !== code) {
        return { valid: false, message: '驗證碼錯誤' };
    }
    
    // 驗證成功，清除驗證碼（一次性使用）
    verificationCodes.delete(key);
    return { valid: true };
}

/**
 * 發送驗證碼 Email
 */
async function sendVerificationEmail(email, code, purpose) {
    try {
        // 取得 Email 設定
        const db = require('./database');
        const smtpHost = await db.getSetting('smtp_host');
        const smtpPort = await db.getSetting('smtp_port');
        const smtpUser = await db.getSetting('smtp_user');
        const smtpPass = await db.getSetting('smtp_pass');
        const smtpFrom = await db.getSetting('smtp_from');
        
        if (!smtpHost || !smtpUser || !smtpPass) {
            throw new Error('Email 設定不完整');
        }
        
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort || '587'),
            secure: parseInt(smtpPort || '587') === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });
        
        const purposeText = purpose === 'query' ? '查詢個人資料' : '刪除個人資料';
        
        const mailOptions = {
            from: smtpFrom || smtpUser,
            to: email,
            subject: `【個資保護】${purposeText}驗證碼`,
            html: `
                <div style="font-family: 'Noto Sans TC', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #262A33;">個資保護驗證碼</h2>
                    <p>親愛的用戶，</p>
                    <p>您正在進行 <strong>${purposeText}</strong> 操作，請使用以下驗證碼完成驗證：</p>
                    <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                        <h1 style="color: #2C8EC4; font-size: 32px; margin: 0; letter-spacing: 5px;">${code}</h1>
                    </div>
                    <p style="color: #666; font-size: 14px;">此驗證碼有效期限為 15 分鐘，請勿將驗證碼告知他人。</p>
                    <p style="color: #666; font-size: 14px;">如非本人操作，請忽略此郵件。</p>
                    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
                    <p style="color: #999; font-size: 12px;">此為系統自動發送，請勿回覆。</p>
                </div>
            `
        };
        
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('發送驗證碼 Email 失敗:', error);
        throw error;
    }
}

/**
 * 匿名化個人資料
 */
function anonymizePersonalData(data) {
    if (typeof data === 'string') {
        // 匿名化姓名（保留第一個字，其他用*替代）
        if (data.length > 1) {
            return data[0] + '*'.repeat(data.length - 1);
        }
        return '*';
    }
    return data;
}

module.exports = {
    generateVerificationCode,
    saveVerificationCode,
    verifyCode,
    sendVerificationEmail,
    anonymizePersonalData
};

