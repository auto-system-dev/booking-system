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
 * 使用與 server.js 相同的郵件發送邏輯，包含 Gmail API 備用方案
 */
async function sendVerificationEmail(email, code, purpose) {
    try {
        // 使用環境變數或預設值
        const emailUser = process.env.EMAIL_USER || 'cheng701107@gmail.com';
        const emailPass = process.env.EMAIL_PASS || 'vtik qvij ravh lirg';
        const useOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
        
        const purposeText = purpose === 'query' ? '查詢個人資料' : '刪除個人資料';
        
        const mailOptions = {
            from: emailUser,
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
        
        let transporter;
        let sendEmailViaGmailAPI = null;
        
        if (useOAuth2) {
            // 使用 OAuth2 認證
            const { google } = require('googleapis');
            
            const oauth2Client = new google.auth.OAuth2(
                process.env.GMAIL_CLIENT_ID,
                process.env.GMAIL_CLIENT_SECRET,
                'https://developers.google.com/oauthplayground'
            );
            
            oauth2Client.setCredentials({
                refresh_token: process.env.GMAIL_REFRESH_TOKEN
            });
            
            // 取得 Access Token
            let accessTokenCache = null;
            let tokenExpiry = null;
            
            const getAccessToken = async function() {
                if (accessTokenCache && tokenExpiry && Date.now() < tokenExpiry) {
                    return accessTokenCache;
                }
                
                try {
                    const { token } = await oauth2Client.getAccessToken();
                    accessTokenCache = token;
                    tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 分鐘後過期
                    return token;
                } catch (error) {
                    console.error('取得 Access Token 失敗:', error);
                    throw error;
                }
            };
            
            transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                auth: {
                    type: 'OAuth2',
                    user: emailUser,
                    clientId: process.env.GMAIL_CLIENT_ID,
                    clientSecret: process.env.GMAIL_CLIENT_SECRET,
                    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
                    accessToken: getAccessToken
                },
                connectionTimeout: 10000, // 10 秒（快速失敗，切換到 Gmail API）
                greetingTimeout: 5000,
                socketTimeout: 10000,
                pool: false,
                tls: {
                    rejectUnauthorized: false
                }
            });
            
            // Gmail API 備用方案（當 SMTP 連接失敗時使用）
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            sendEmailViaGmailAPI = async function(mailOptions) {
                try {
                    console.log('📧 使用 Gmail API 發送驗證碼（SMTP 備用方案）...');
                    
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
                    
                    console.log('✅ Gmail API 驗證碼已發送 (ID: ' + response.data.id + ')');
                    return { messageId: response.data.id, accepted: [mailOptions.to] };
                } catch (error) {
                    console.error('❌ Gmail API 發送失敗:', error.message);
                    throw error;
                }
            };
        } else {
            // 使用應用程式密碼
            transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: emailUser,
                    pass: emailPass
                },
                connectionTimeout: 60000,
                greetingTimeout: 30000,
                socketTimeout: 60000,
                pool: true,
                maxConnections: 1,
                maxMessages: 3,
                tls: {
                    rejectUnauthorized: false
                }
            });
        }
        
        // 嘗試使用 SMTP 發送
        try {
            await transporter.sendMail(mailOptions);
            console.log(`✅ 驗證碼已發送至 ${email} (SMTP)`);
            return true;
        } catch (smtpError) {
            // 如果 SMTP 失敗且有 Gmail API 備用方案，使用 Gmail API
            if (sendEmailViaGmailAPI && (smtpError.code === 'ETIMEDOUT' || smtpError.code === 'ECONNREFUSED' || smtpError.code === 'ESOCKET')) {
                console.warn('⚠️  SMTP 連接失敗，切換到 Gmail API 備用方案...');
                try {
                    await sendEmailViaGmailAPI(mailOptions);
                    console.log(`✅ 驗證碼已發送至 ${email} (Gmail API)`);
                    return true;
                } catch (gmailError) {
                    console.error('❌ Gmail API 也失敗:', gmailError);
                    throw smtpError; // 拋出原始 SMTP 錯誤
                }
            } else {
                // 沒有 Gmail API 備用方案或其他錯誤，直接拋出
                throw smtpError;
            }
        }
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

