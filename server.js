// 載入環境變數（從 .env 檔案）
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const payment = require('./payment');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 處理綠界 POST 表單資料（application/x-www-form-urlencoded）
app.use(express.urlencoded({ extended: true }));

// 請求日誌中間件
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleString('zh-TW')}] ${req.method} ${req.path}`);
    next();
});

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
    
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            type: 'OAuth2',
            user: emailUser,
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            refreshToken: process.env.GMAIL_REFRESH_TOKEN,
            accessToken: getAccessToken
        }
    });
    
    console.log('📧 郵件服務已設定（OAuth2 認證）');
    console.log('   使用帳號:', emailUser);
    console.log('   認證方式: OAuth2');
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

// 訂房 API
app.post('/api/booking', async (req, res) => {
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
            finalAmount
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
        
        // 儲存訂房資料（這裡可以連接資料庫）
        const bookingData = {
            checkInDate,
            checkOutDate,
            roomType: roomTypeName, // 使用房型名稱（display_name）
            guestName,
            guestPhone,
            guestEmail,
            paymentAmount: paymentAmount === 'deposit' ? `訂金 (${depositPercentage}%)` : '全額',
            paymentMethod: paymentMethods[paymentMethod] || paymentMethod,
            pricePerNight,
            nights,
            totalAmount,
            finalAmount,
            bookingDate: new Date().toISOString(),
            bookingId: 'BK' + Date.now(),
            depositPercentage: depositPercentage, // 傳給郵件生成函數使用
            bankInfo: bankInfo, // 匯款資訊（包含銀行、分行、帳號、戶名）
            paymentMethodCode: paymentMethod // 原始付款方式代碼（transfer 或 card）
        };

        // 發送確認郵件給客戶
        const customerMailOptions = {
            from: process.env.EMAIL_USER || 'your-email@gmail.com',
            to: guestEmail,
            subject: '【訂房確認】您的訂房已成功',
            html: generateCustomerEmail(bookingData)
        };

        // 發送通知郵件給管理員
        const adminMailOptions = {
            from: process.env.EMAIL_USER || 'your-email@gmail.com',
            to: process.env.ADMIN_EMAIL || 'cheng701107@gmail.com', // 管理員 Email
            subject: `【新訂房通知】${guestName} - ${bookingData.bookingId}`,
            html: generateAdminEmail(bookingData)
        };

        // 發送郵件
        let emailSent = false;
        let emailErrorMsg = '';
        try {
            console.log('📧 正在發送郵件...');
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
            
            console.log('📤 發送客戶確認郵件...');
            const customerResult = await transporter.sendMail(customerMailOptions);
            console.log('✅ 客戶確認郵件已發送');
            if (customerResult && customerResult.messageId) {
                console.log('   郵件 ID:', customerResult.messageId);
            }
            
            console.log('📤 發送管理員通知郵件...');
            const adminResult = await transporter.sendMail(adminMailOptions);
            console.log('✅ 管理員通知郵件已發送');
            if (adminResult && adminResult.messageId) {
                console.log('   郵件 ID:', adminResult.messageId);
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

        // 儲存訂房資料到資料庫
        try {
            // 判斷付款狀態
            let paymentStatus = 'pending';
            if (paymentMethod === 'card') {
                paymentStatus = 'pending'; // 刷卡需要等待付款完成
            } else if (paymentMethod === 'transfer') {
                paymentStatus = 'pending'; // 匯款也需要等待確認
            }
            
            await db.saveBooking({
                ...bookingData,
                emailSent: emailSent,
                paymentStatus: paymentStatus,
                status: 'active'
            });
            
            // 如果郵件發送狀態改變，更新資料庫
            if (emailSent) {
                await db.updateEmailStatus(bookingData.bookingId, true);
            }
        } catch (dbError) {
            console.error('⚠️  資料庫儲存錯誤（不影響訂房）:', dbError.message);
            // 即使資料庫錯誤，也繼續處理（不影響訂房流程）
        }

        // 處理支付方式
        let paymentData = null;
        if (paymentMethod === 'card') {
            // 線上刷卡：建立支付表單
            try {
                // 從資料庫取得綠界設定
                const ecpayMerchantID = await db.getSetting('ecpay_merchant_id') || process.env.ECPAY_MERCHANT_ID || '2000132';
                const ecpayHashKey = await db.getSetting('ecpay_hash_key') || process.env.ECPAY_HASH_KEY || '5294y06JbISpM5x9';
                const ecpayHashIV = await db.getSetting('ecpay_hash_iv') || process.env.ECPAY_HASH_IV || 'v77hoKGq4kWxNNIS';
                
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
                console.error('建立支付表單失敗:', paymentError);
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
        console.error('訂房處理錯誤:', error);
        res.status(500).json({ message: '伺服器錯誤，請稍後再試' });
    }
});

// 生成客戶確認郵件
function generateCustomerEmail(data) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
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
                <p>您的訂房已成功確認，以下是您的訂房資訊：</p>
                
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

                ${data.paymentMethodCode === 'transfer' && data.bankInfo && data.bankInfo.account ? `
                <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #856404; margin-top: 0;">💰 匯款提醒</h3>
                    <p style="color: #856404; font-weight: 600; margin: 10px 0;">
                        ⏰ 此訂房將為您保留 <strong>3 天</strong>，請於 <strong>3 天內</strong>完成匯款，逾期將自動取消訂房。
                    </p>
                    <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                        <p style="margin: 8px 0; color: #333;"><strong>匯款資訊：</strong></p>
                        ${data.bankInfo.bankName ? `<p style="margin: 5px 0; color: #333;">銀行：${data.bankInfo.bankName}${data.bankInfo.bankBranch ? ' - ' + data.bankInfo.bankBranch : ''}</p>` : ''}
                        <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">${data.bankInfo.account}</span></p>
                        ${data.bankInfo.accountName ? `<p style="margin: 5px 0; color: #333;">戶名：${data.bankInfo.accountName}</p>` : ''}
                        <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>${data.bookingId}</strong></p>
                    </div>
                </div>
                ` : ''}
                
                <p><strong>重要提醒：</strong></p>
                <ul>
                    <li>請於入住當天攜帶身分證件辦理入住手續</li>
                    <li>如需取消或變更訂房，請提前 3 天通知</li>
                    <li>如有任何問題，請隨時與我們聯繫</li>
                </ul>

                <div class="footer">
                    <p>感謝您的預訂，期待為您服務！</p>
                    <p>此為系統自動發送郵件，請勿直接回覆</p>
                </div>
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

// 首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 管理後台
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API: 查詢所有訂房記錄
app.get('/api/bookings', async (req, res) => {
    try {
        console.log('收到查詢訂房記錄請求');
        const bookings = await db.getAllBookings();
        console.log(`查詢到 ${bookings.length} 筆訂房記錄`);
        
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

// API: 根據訂房編號查詢
app.get('/api/bookings/:bookingId', async (req, res) => {
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
        console.error('查詢訂房記錄錯誤:', error);
        res.status(500).json({ 
            success: false, 
            message: '查詢訂房記錄失敗' 
        });
    }
});

// API: 根據 Email 查詢訂房記錄
app.get('/api/bookings/email/:email', async (req, res) => {
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

// API: 取得統計資料
app.get('/api/statistics', async (req, res) => {
    try {
        const stats = await db.getStatistics();
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

// API: 更新訂房資料
app.put('/api/bookings/:bookingId', async (req, res) => {
    try {
        const { bookingId } = req.params;
        const updateData = req.body;
        
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
app.post('/api/bookings/:bookingId/cancel', async (req, res) => {
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

// ==================== 房型管理 API ====================

// API: 取得所有房型（公開，供前台使用）
app.get('/api/room-types', async (req, res) => {
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

// API: 取得所有房型（管理後台，包含已停用的）
app.get('/api/admin/room-types', async (req, res) => {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db_conn = new sqlite3.Database('./bookings.db');
        
        const roomTypes = await new Promise((resolve, reject) => {
            db_conn.all('SELECT * FROM room_types ORDER BY display_order ASC, id ASC', [], (err, rows) => {
                if (err) {
                    db_conn.close();
                    reject(err);
                } else {
                    db_conn.close();
                    resolve(rows || []);
                }
            });
        });
        
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
app.post('/api/admin/room-types', async (req, res) => {
    try {
        const roomData = req.body;
        
        if (!roomData.name || !roomData.display_name || !roomData.price) {
            return res.status(400).json({
                success: false,
                message: '請提供完整的房型資料（名稱、顯示名稱、價格）'
            });
        }
        
        const id = await db.createRoomType(roomData);
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
app.put('/api/admin/room-types/:id', async (req, res) => {
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

// API: 刪除房型
app.delete('/api/admin/room-types/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.deleteRoomType(id);
        
        if (result > 0) {
            res.json({
                success: true,
                message: '房型已刪除'
            });
        } else {
            res.status(404).json({
                success: false,
                message: '找不到該房型'
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

// ==================== 系統設定 API ====================

// API: 取得系統設定
app.get('/api/settings', async (req, res) => {
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
app.put('/api/admin/settings/:key', async (req, res) => {
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
app.post('/api/payment/create', async (req, res) => {
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
app.post('/api/payment/return', async (req, res) => {
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
                        await db.updateBooking(bookingId, {
                            payment_status: 'paid'
                        });
                        console.log('✅ 付款狀態已更新為「已付款」');
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
                
                // 更新付款狀態為已付款
                await db.updateBooking(bookingId, {
                    payment_status: 'paid'
                });
                
                console.log('✅ 付款狀態已更新為「已付款」');
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
                            .success-icon {
                                font-size: 80px;
                                color: #4CAF50;
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
                            <div class="success-icon">✓</div>
                            <h1>付款成功！</h1>
                            <p>訂單編號：${paymentResult.merchantTradeNo}</p>
                            <p>交易編號：${paymentResult.tradeNo}</p>
                            <p>付款金額：NT$ ${paymentResult.tradeAmt.toLocaleString()}</p>
                            <p>付款時間：${paymentResult.paymentDate}</p>
                            <a href="/" class="btn">返回首頁</a>
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
app.get('/api/payment/result', handlePaymentResult);
app.post('/api/payment/result', handlePaymentResult);

// ==================== 郵件模板 API ====================

// API: 取得所有郵件模板
app.get('/api/email-templates', async (req, res) => {
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
app.get('/api/email-templates/:key', async (req, res) => {
    try {
        const { key } = req.params;
        console.log(`📧 取得郵件模板: ${key}`);
        const template = await db.getEmailTemplateByKey(key);
        if (template) {
            console.log(`✅ 找到模板: ${template.template_name}, 內容長度: ${template.content ? template.content.length : 0}`);
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
app.put('/api/email-templates/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { template_name, subject, content, is_enabled } = req.body;
        
        console.log(`📝 更新郵件模板: ${key}`);
        console.log(`   模板名稱: ${template_name}`);
        console.log(`   主旨: ${subject}`);
        console.log(`   內容長度: ${content ? content.length : 0}`);
        console.log(`   啟用狀態: ${is_enabled}`);
        
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
            is_enabled: is_enabled !== false
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

// ==================== 自動郵件發送功能 ====================

// 替換郵件模板中的變數
function replaceTemplateVariables(template, booking, bankInfo = null) {
    let content = template.content;
    const checkInDate = new Date(booking.check_in_date).toLocaleDateString('zh-TW');
    const checkOutDate = new Date(booking.check_out_date).toLocaleDateString('zh-TW');
    
    const variables = {
        '{{guestName}}': booking.guest_name,
        '{{bookingId}}': booking.booking_id,
        '{{checkInDate}}': checkInDate,
        '{{checkOutDate}}': checkOutDate,
        '{{roomType}}': booking.room_type,
        '{{totalAmount}}': booking.total_amount ? booking.total_amount.toLocaleString() : '0',
        '{{finalAmount}}': booking.final_amount ? booking.final_amount.toLocaleString() : '0',
        '{{bankName}}': bankInfo ? bankInfo.bankName : 'XXX銀行',
        '{{bankBranch}}': bankInfo ? bankInfo.bankBranch : 'XXX分行',
        '{{bankAccount}}': bankInfo ? bankInfo.account : '1234567890123',
        '{{accountName}}': bankInfo ? bankInfo.accountName : 'XXX'
    };
    
    Object.keys(variables).forEach(key => {
        content = content.replace(new RegExp(key, 'g'), variables[key]);
    });
    
    let subject = template.subject;
    Object.keys(variables).forEach(key => {
        subject = subject.replace(new RegExp(key, 'g'), variables[key]);
    });
    
    return { subject, content };
}

// 發送匯款期限提醒郵件
async function sendPaymentReminderEmails() {
    try {
        console.log('\n[定時任務] 開始檢查匯款期限提醒...');
        const bookings = await db.getBookingsForPaymentReminder();
        console.log(`找到 ${bookings.length} 筆需要發送匯款提醒的訂房`);
        
        const template = await db.getEmailTemplateByKey('payment_reminder');
        if (!template || !template.is_enabled) {
            console.log('匯款提醒模板未啟用，跳過發送');
            return;
        }
        
        // 取得匯款資訊
        const bankInfo = {
            bankName: await db.getSetting('bank_name') || '',
            bankBranch: await db.getSetting('bank_branch') || '',
            account: await db.getSetting('bank_account') || '',
            accountName: await db.getSetting('account_name') || ''
        };
        
        for (const booking of bookings) {
            try {
                const { subject, content } = replaceTemplateVariables(template, booking, bankInfo);
                
                await transporter.sendMail({
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                });
                
                console.log(`✅ 已發送匯款提醒給 ${booking.guest_name} (${booking.booking_id})`);
            } catch (error) {
                console.error(`❌ 發送匯款提醒失敗 (${booking.booking_id}):`, error.message);
            }
        }
    } catch (error) {
        console.error('❌ 匯款提醒任務錯誤:', error);
    }
}

// 發送入住提醒郵件
async function sendCheckinReminderEmails() {
    try {
        console.log('\n[定時任務] 開始檢查入住提醒...');
        const bookings = await db.getBookingsForCheckinReminder();
        console.log(`找到 ${bookings.length} 筆需要發送入住提醒的訂房`);
        
        const template = await db.getEmailTemplateByKey('checkin_reminder');
        if (!template || !template.is_enabled) {
            console.log('入住提醒模板未啟用，跳過發送');
            return;
        }
        
        for (const booking of bookings) {
            try {
                const { subject, content } = replaceTemplateVariables(template, booking);
                
                await transporter.sendMail({
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                });
                
                console.log(`✅ 已發送入住提醒給 ${booking.guest_name} (${booking.booking_id})`);
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
        console.log('\n[定時任務] 開始檢查回訪信...');
        const bookings = await db.getBookingsForFeedbackRequest();
        console.log(`找到 ${bookings.length} 筆需要發送回訪信的訂房`);
        
        const template = await db.getEmailTemplateByKey('feedback_request');
        if (!template || !template.is_enabled) {
            console.log('回訪信模板未啟用，跳過發送');
            return;
        }
        
        for (const booking of bookings) {
            try {
                const { subject, content } = replaceTemplateVariables(template, booking);
                
                await transporter.sendMail({
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: booking.guest_email,
                    subject: subject,
                    html: content
                });
                
                console.log(`✅ 已發送回訪信給 ${booking.guest_name} (${booking.booking_id})`);
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
            
            // 啟動定時任務
            // 每天上午 9:00 執行匯款提醒檢查
            cron.schedule('0 9 * * *', sendPaymentReminderEmails);
            console.log('✅ 匯款提醒定時任務已啟動（每天 09:00）');
            
            // 每天上午 10:00 執行入住提醒檢查
            cron.schedule('0 10 * * *', sendCheckinReminderEmails);
            console.log('✅ 入住提醒定時任務已啟動（每天 10:00）');
            
            // 每天上午 11:00 執行回訪信檢查
            cron.schedule('0 11 * * *', sendFeedbackRequestEmails);
            console.log('✅ 回訪信定時任務已啟動（每天 11:00）');
        });
    } catch (error) {
        console.error('❌ 伺服器啟動失敗:', error);
        process.exit(1);
    }
}

// 靜態檔案服務（放在最後，避免覆蓋 API 路由）
app.use(express.static(__dirname));

// 啟動應用程式
startServer();

