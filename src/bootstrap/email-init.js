async function initEmailService(deps) {
    const {
        db,
        processEnv,
        getRequiredEmailUser,
        Resend,
        nodemailer,
        emailRuntime,
        resetEmailRuntime
    } = deps;

    try {
        if (typeof resetEmailRuntime === 'function') {
            resetEmailRuntime(emailRuntime);
        }

        const resendApiKey = await db.getSetting('resend_api_key') || processEnv.RESEND_API_KEY;
        const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
        const resolveResendSenderEmail = async () => {
            const fromDb = (await db.getSetting('resend_from_email') || '').trim();
            const fromDbEmailUser = (await db.getSetting('email_user') || '').trim();
            const fromEnv = (processEnv.RESEND_FROM_EMAIL || '').trim();
            const fromEnvEmailUser = (processEnv.EMAIL_USER || '').trim();

            if (isValidEmail(fromDb)) return fromDb;
            if (isValidEmail(fromDbEmailUser)) return fromDbEmailUser;
            if (isValidEmail(fromEnv)) return fromEnv;
            if (isValidEmail(fromEnvEmailUser)) return fromEnvEmailUser;
            return 'resend@resend.dev';
        };
        let emailUser = ((await db.getSetting('email_user')) || processEnv.EMAIL_USER || '').trim();
        emailRuntime.configuredSenderEmail = emailUser;
        const emailPass = (processEnv.EMAIL_PASS || '').trim();
        const gmailClientID = await db.getSetting('gmail_client_id') || processEnv.GMAIL_CLIENT_ID;
        const gmailClientSecret = await db.getSetting('gmail_client_secret') || processEnv.GMAIL_CLIENT_SECRET;
        const gmailRefreshToken = await db.getSetting('gmail_refresh_token') || processEnv.GMAIL_REFRESH_TOKEN;

        if (resendApiKey) {
            try {
                if (!Resend) {
                    throw new Error('Resend 套件未安裝，請執行: npm install resend');
                }

                emailRuntime.resendClient = new Resend(resendApiKey);
                emailRuntime.emailServiceProvider = 'resend';
                emailRuntime.configuredSenderEmail = await resolveResendSenderEmail();
                console.log('📧 郵件服務已設定（Resend）');
                console.log('   服務提供商: Resend');
                console.log('   設定來源:', await db.getSetting('resend_api_key') ? '資料庫' : '環境變數');
                console.log('   寄件信箱:', emailRuntime.configuredSenderEmail);
                return;
            } catch (error) {
                console.error('❌ 初始化 Resend 失敗:', error.message);
                console.error('   錯誤詳情:', error);
                console.error('   將回退到 Gmail 服務');
                emailRuntime.resendClient = null;
                emailRuntime.emailServiceProvider = 'gmail';
            }
        }

        emailRuntime.emailServiceProvider = 'gmail';
        if (!emailUser) {
            emailUser = await getRequiredEmailUser('初始化郵件服務');
        }
        emailRuntime.configuredSenderEmail = emailUser;

        const useOAuth2 = gmailClientID && gmailClientSecret && gmailRefreshToken;
        if (!useOAuth2 && !emailPass) {
            throw new Error('未設定 EMAIL_PASS，且未啟用 Gmail OAuth2。為了安全性，系統已禁止使用硬編碼預設值。');
        }

        if (useOAuth2) {
            const { google } = require('googleapis');

            emailRuntime.oauth2Client = new google.auth.OAuth2(
                gmailClientID,
                gmailClientSecret,
                'https://developers.google.com/oauthplayground'
            );

            emailRuntime.oauth2Client.setCredentials({
                refresh_token: gmailRefreshToken
            });
            emailRuntime.oauth2Client.scopes = ['https://www.googleapis.com/auth/gmail.send'];

            let accessTokenCache = null;
            let tokenExpiry = null;

            emailRuntime.getAccessToken = async function() {
                try {
                    if (accessTokenCache && tokenExpiry && Date.now() < tokenExpiry) {
                        console.log('✅ 使用快取的 Access Token');
                        return accessTokenCache;
                    }

                    console.log('🔄 正在取得新的 Access Token...');
                    const { token } = await emailRuntime.oauth2Client.getAccessToken();
                    if (!token) {
                        throw new Error('無法取得 Access Token');
                    }

                    accessTokenCache = token;
                    tokenExpiry = Date.now() + (55 * 60 * 1000);
                    console.log('✅ Access Token 已成功取得');
                    return token;
                } catch (error) {
                    console.error('❌ 取得 Access Token 失敗:');
                    console.error('   錯誤訊息:', error.message);
                    console.error('   錯誤代碼:', error.code);
                    console.error('   錯誤詳情:', error);

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

            emailRuntime.transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                auth: {
                    type: 'OAuth2',
                    user: emailUser,
                    clientId: gmailClientID,
                    clientSecret: gmailClientSecret,
                    refreshToken: gmailRefreshToken,
                    accessToken: emailRuntime.getAccessToken
                },
                connectionTimeout: 10000,
                greetingTimeout: 5000,
                socketTimeout: 10000,
                pool: false,
                tls: {
                    rejectUnauthorized: false
                }
            });

            console.log('📧 郵件服務已設定（OAuth2 認證）');
            console.log('   使用帳號:', emailUser);
            console.log('   認證方式: OAuth2');
            console.log('   設定來源: 後台設定 (email_user)');

            emailRuntime.gmail = google.gmail({ version: 'v1', auth: emailRuntime.oauth2Client });

            emailRuntime.sendEmailViaGmailAPI = async function(mailOptions) {
                try {
                    console.log('📧 使用 Gmail API 發送郵件（SMTP 備用方案）...');

                    const boundary = '----=_Part_' + Date.now();
                    const mimeMessage = [
                        `From: ${mailOptions.from}`,
                        `To: ${mailOptions.to}`,
                        `Subject: =?UTF-8?B?${Buffer.from(mailOptions.subject, 'utf8').toString('base64')}?=`,
                        'MIME-Version: 1.0',
                        `Content-Type: multipart/alternative; boundary="${boundary}"`,
                        '',
                        `--${boundary}`,
                        'Content-Type: text/html; charset=UTF-8',
                        'Content-Transfer-Encoding: base64',
                        '',
                        Buffer.from(mailOptions.html, 'utf8').toString('base64'),
                        '',
                        `--${boundary}--`
                    ].join('\r\n');

                    const messageBase64 = Buffer.from(mimeMessage, 'utf8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');

                    const response = await emailRuntime.gmail.users.messages.send({
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
            emailRuntime.transporter = nodemailer.createTransport({
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

            emailRuntime.sendEmailViaGmailAPI = null;
            emailRuntime.getAccessToken = null;
            emailRuntime.oauth2Client = null;
            emailRuntime.gmail = null;

            console.log('📧 郵件服務已設定（應用程式密碼）');
            console.log('   使用帳號:', emailUser);
            console.log('   設定來源: 後台設定 (email_user)');
            console.log('   ⚠️  建議使用 OAuth2 認證以解決連接超時問題');
        }
    } catch (error) {
        console.error('❌ 初始化郵件服務失敗:', error);
        throw error;
    }
}

module.exports = {
    initEmailService
};
