// 資料庫模組 - PostgreSQL 版本
const { Pool } = require('pg');
require('dotenv').config();

// 調試：顯示所有環境變數（不顯示敏感值）
console.log('🔍 環境變數檢查:');
console.log(`   - DATABASE_URL 存在: ${!!process.env.DATABASE_URL}`);
console.log(`   - DATABASE_URL 長度: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0}`);
console.log(`   - DATABASE_URL 前綴: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'N/A'}`);
console.log(`   - 所有環境變數鍵: ${Object.keys(process.env).filter(k => k.includes('DATABASE')).join(', ')}`);

// 檢查 DATABASE_URL 是否存在
if (!process.env.DATABASE_URL) {
    console.error('❌ 錯誤：未設定 DATABASE_URL 環境變數');
    console.error('請確認 Railway 已正確設定 PostgreSQL 資料庫');
    console.error('可用的環境變數:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES')));
    throw new Error('DATABASE_URL 環境變數未設定');
}

// 建立 PostgreSQL 連接池
// 判斷是否為本地連接（不需要 SSL）
const isLocalConnection = process.env.DATABASE_URL && (
    process.env.DATABASE_URL.includes('localhost') || 
    process.env.DATABASE_URL.includes('127.0.0.1')
);

console.log('📊 資料庫連接資訊:');
console.log(`   - DATABASE_URL: ${process.env.DATABASE_URL ? '已設定' : '未設定'}`);
console.log(`   - 連接類型: ${isLocalConnection ? '本地' : '遠端'}`);
console.log(`   - SSL: ${isLocalConnection ? '關閉' : '啟用'}`);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalConnection ? false : {
        rejectUnauthorized: false
    }
});

// 測試連接
pool.on('connect', () => {
    console.log('✅ 已連接到 PostgreSQL 資料庫');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL 連接錯誤:', err);
});

// 初始化資料庫（建立資料表）
async function initDatabase() {
    let client;
    try {
        console.log('🔄 正在連接資料庫...');
        client = await pool.connect();
        console.log('✅ 資料庫連接成功');
        
        await client.query('BEGIN');
        
        // 建立訂房資料表
        await client.query(`
            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                booking_id VARCHAR(255) UNIQUE NOT NULL,
                check_in_date VARCHAR(50) NOT NULL,
                check_out_date VARCHAR(50) NOT NULL,
                room_type VARCHAR(255) NOT NULL,
                guest_name VARCHAR(255) NOT NULL,
                guest_phone VARCHAR(50) NOT NULL,
                guest_email VARCHAR(255) NOT NULL,
                payment_amount VARCHAR(50) NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                price_per_night INTEGER NOT NULL,
                nights INTEGER NOT NULL,
                total_amount INTEGER NOT NULL,
                final_amount INTEGER NOT NULL,
                booking_date VARCHAR(50) NOT NULL,
                email_sent TEXT DEFAULT '0',
                payment_status VARCHAR(50) DEFAULT 'pending',
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ 資料表已準備就緒');
        
        // 檢查並新增欄位（如果不存在）
        // 使用 DO 區塊來避免交易中止問題
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'bookings' AND column_name = 'payment_status'
                ) THEN
                    ALTER TABLE bookings ADD COLUMN payment_status VARCHAR(50) DEFAULT 'pending';
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'bookings' AND column_name = 'status'
                ) THEN
                    ALTER TABLE bookings ADD COLUMN status VARCHAR(50) DEFAULT 'active';
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'bookings' AND column_name = 'email_sent'
                ) THEN
                    ALTER TABLE bookings ADD COLUMN email_sent TEXT DEFAULT '0';
                END IF;
            END $$;
        `);
        
        console.log('✅ 資料表欄位已更新');
        
        // 建立房型設定表
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_types (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                display_name VARCHAR(255) NOT NULL,
                price INTEGER NOT NULL,
                icon VARCHAR(10) DEFAULT '🏠',
                display_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ 房型設定表已準備就緒');
        
        // 初始化預設房型（如果表是空的）
        const roomCountResult = await client.query('SELECT COUNT(*) as count FROM room_types');
        if (parseInt(roomCountResult.rows[0].count) === 0) {
            const defaultRooms = [
                ['standard', '標準雙人房', 2000, '🏠', 1],
                ['deluxe', '豪華雙人房', 3500, '✨', 2],
                ['suite', '尊爵套房', 5000, '👑', 3],
                ['family', '家庭四人房', 4500, '👨‍👩‍👧‍👦', 4]
            ];
            
            for (const room of defaultRooms) {
                await client.query(
                    'INSERT INTO room_types (name, display_name, price, icon, display_order) VALUES ($1, $2, $3, $4, $5)',
                    room
                );
            }
            console.log('✅ 預設房型已初始化');
        }
        
        // 建立系統設定表
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id SERIAL PRIMARY KEY,
                key VARCHAR(255) UNIQUE NOT NULL,
                value TEXT NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ 系統設定表已準備就緒');
        
        // 初始化預設設定
        const defaultSettings = [
            ['deposit_percentage', '30', '訂金百分比（例如：30 表示 30%）'],
            ['bank_name', '', '銀行名稱'],
            ['bank_branch', '', '分行名稱'],
            ['bank_account', '', '匯款帳號'],
            ['account_name', '', '帳戶戶名'],
            ['enable_transfer', '1', '啟用匯款轉帳（1=啟用，0=停用）'],
            ['enable_card', '1', '啟用線上刷卡（1=啟用，0=停用）'],
            ['ecpay_merchant_id', '', '綠界商店代號（MerchantID）'],
            ['ecpay_hash_key', '', '綠界金鑰（HashKey）'],
            ['ecpay_hash_iv', '', '綠界向量（HashIV）']
        ];
        
        for (const [key, value, description] of defaultSettings) {
            const existing = await client.query('SELECT COUNT(*) as count FROM settings WHERE key = $1', [key]);
            if (parseInt(existing.rows[0].count) === 0) {
                await client.query(
                    'INSERT INTO settings (key, value, description) VALUES ($1, $2, $3)',
                    [key, value, description]
                );
            }
        }
        console.log('✅ 預設設定已初始化');
        
        // 建立郵件模板表
        await client.query(`
            CREATE TABLE IF NOT EXISTS email_templates (
                id SERIAL PRIMARY KEY,
                template_key VARCHAR(255) UNIQUE NOT NULL,
                template_name VARCHAR(255) NOT NULL,
                subject TEXT NOT NULL,
                content TEXT NOT NULL,
                is_enabled INTEGER DEFAULT 1,
                days_before_checkin INTEGER,
                send_hour_checkin INTEGER,
                days_after_checkout INTEGER,
                send_hour_feedback INTEGER,
                days_reserved INTEGER,
                send_hour_payment_reminder INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ 郵件模板表已準備就緒');
        
        // 檢查並新增欄位（如果不存在）- 使用 DO 區塊避免交易中止
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'email_templates' AND column_name = 'days_before_checkin'
                ) THEN
                    ALTER TABLE email_templates ADD COLUMN days_before_checkin INTEGER;
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'email_templates' AND column_name = 'send_hour_checkin'
                ) THEN
                    ALTER TABLE email_templates ADD COLUMN send_hour_checkin INTEGER;
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'email_templates' AND column_name = 'days_after_checkout'
                ) THEN
                    ALTER TABLE email_templates ADD COLUMN days_after_checkout INTEGER;
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'email_templates' AND column_name = 'send_hour_feedback'
                ) THEN
                    ALTER TABLE email_templates ADD COLUMN send_hour_feedback INTEGER;
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'email_templates' AND column_name = 'days_reserved'
                ) THEN
                    ALTER TABLE email_templates ADD COLUMN days_reserved INTEGER;
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'email_templates' AND column_name = 'send_hour_payment_reminder'
                ) THEN
                    ALTER TABLE email_templates ADD COLUMN send_hour_payment_reminder INTEGER;
                END IF;
            END $$;
        `);
        
        // 初始化預設郵件模板
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
            
            <div class="highlight">
                <h3 style="color: #856404; margin-top: 0;">⚠️ 重要提醒</h3>
                <p style="color: #856404; font-weight: 600; font-size: 18px;">
                    您的訂房匯款期限將於 <strong>今天</strong> 到期！
                </p>
                <p style="color: #856404;">
                    請盡快完成匯款，逾期未匯款將自動取消訂房。
                </p>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
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
                <div class="info-row">
                    <span class="info-label">應付金額</span>
                    <span class="info-value" style="color: #e74c3c; font-weight: 700; font-size: 18px;">NT$ {{finalAmount}}</span>
                </div>
            </div>
            
            <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #856404; margin-top: 0;">💰 匯款資訊</h3>
                <p style="color: #856404; font-weight: 600; margin: 10px 0;">
                    請於 <strong>今天</strong> 完成匯款
                </p>
                <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                    <p style="margin: 5px 0; color: #333;"><strong>匯款資訊：</strong></p>
                    <p style="margin: 5px 0; color: #333;">銀行：XXX銀行 - XXX分行</p>
                    <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">1234567890123</span></p>
                    <p style="margin: 5px 0; color: #333;">戶名：XXX</p>
                    <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>{{bookingId}}</strong></p>
                </div>
            </div>
            
            <p>如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
</body>
</html>`,
                enabled: 1
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
        .header { background: #667eea; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
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
                enabled: 1
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
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .btn { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; }
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
                enabled: 1
            }
        ];
        
        // 更新現有模板名稱（如果需要）
        await client.query(`
            UPDATE email_templates 
            SET template_name = '感謝入住' 
            WHERE template_key = 'feedback_request' AND template_name = '回訪信'
        `);
        
        await client.query(`
            UPDATE email_templates 
            SET template_name = '匯款提醒' 
            WHERE template_key = 'payment_reminder' AND template_name = '匯款期限提醒'
        `);
        
        for (const template of defaultTemplates) {
            await client.query(`
                INSERT INTO email_templates (template_key, template_name, subject, content, is_enabled)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (template_key) DO NOTHING
            `, [template.key, template.name, template.subject, template.content, template.enabled]);
        }
        console.log('✅ 預設郵件模板已初始化');
        
        await client.query('COMMIT');
    } catch (err) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                console.error('❌ 回滾失敗:', rollbackErr);
            }
        }
        console.error('❌ 初始化資料庫失敗:', err.message);
        console.error('錯誤詳情:', err);
        throw err;
    } finally {
        if (client) {
            client.release();
        }
    }
}

// 儲存訂房資料
async function saveBooking(bookingData) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                guest_name, guest_phone, guest_email,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id
        `, [
            bookingData.bookingId,
            bookingData.checkInDate,
            bookingData.checkOutDate,
            bookingData.roomType,
            bookingData.guestName,
            bookingData.guestPhone,
            bookingData.guestEmail,
            bookingData.paymentAmount,
            bookingData.paymentMethod,
            bookingData.pricePerNight,
            bookingData.nights,
            bookingData.totalAmount,
            bookingData.finalAmount,
            bookingData.bookingDate,
            bookingData.emailSent ? '1' : '0',
            bookingData.paymentStatus || 'pending',
            bookingData.status || 'active'
        ]);
        console.log(`✅ 訂房資料已儲存 (ID: ${result.rows[0].id})`);
        return result.rows[0].id;
    } catch (err) {
        console.error('❌ 儲存訂房資料失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 更新郵件發送狀態
async function updateEmailStatus(bookingId, emailSent, emailType = null) {
    const client = await pool.connect();
    try {
        if (emailType) {
            // 如果有 emailType，追加到 email_sent 欄位
            const currentResult = await client.query(
                'SELECT email_sent FROM bookings WHERE booking_id = $1',
                [bookingId]
            );
            
            if (currentResult.rows.length === 0) {
                throw new Error('找不到該訂房記錄');
            }
            
            const currentEmailSent = currentResult.rows[0].email_sent || '';
            let emailTypes = currentEmailSent ? currentEmailSent.split(',') : [];
            
            if (!emailTypes.includes(emailType)) {
                emailTypes.push(emailType);
            }
            
            const newEmailSent = emailTypes.join(',');
            const result = await client.query(
                'UPDATE bookings SET email_sent = $1 WHERE booking_id = $2',
                [newEmailSent, bookingId]
            );
            console.log(`✅ 郵件狀態已更新 (影響行數: ${result.rowCount})`);
            return result.rowCount;
        } else {
            // 舊的邏輯：直接設定為 1 或 0
            const result = await client.query(
                'UPDATE bookings SET email_sent = $1 WHERE booking_id = $2',
                [emailSent ? '1' : '0', bookingId]
            );
            console.log(`✅ 郵件狀態已更新 (影響行數: ${result.rowCount})`);
            return result.rowCount;
        }
    } catch (err) {
        console.error('❌ 更新郵件狀態失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 查詢所有訂房記錄
async function getAllBookings() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM bookings ORDER BY created_at DESC');
        // 處理 email_sent 欄位（舊資料可能是整數）
        const rows = result.rows.map(row => {
            if (typeof row.email_sent === 'number') {
                row.email_sent = row.email_sent.toString();
            }
            return row;
        });
        return rows;
    } catch (err) {
        console.error('❌ 查詢訂房記錄失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 根據訂房編號查詢
async function getBookingById(bookingId) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
        if (result.rows.length === 0) {
            return null;
        }
        const row = result.rows[0];
        // 處理 email_sent 欄位（舊資料可能是整數）
        if (typeof row.email_sent === 'number') {
            row.email_sent = row.email_sent.toString();
        }
        return row;
    } catch (err) {
        console.error('❌ 查詢訂房記錄失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 根據 Email 查詢訂房記錄
async function getBookingsByEmail(email) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM bookings WHERE guest_email = $1 ORDER BY created_at DESC',
            [email]
        );
        // 處理 email_sent 欄位（舊資料可能是整數）
        const rows = result.rows.map(row => {
            if (typeof row.email_sent === 'number') {
                row.email_sent = row.email_sent.toString();
            }
            return row;
        });
        return rows;
    } catch (err) {
        console.error('❌ 查詢訂房記錄失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 更新訂房資料
async function updateBooking(bookingId, updateData) {
    const client = await pool.connect();
    try {
        const allowedFields = [
            'guest_name', 'guest_phone', 'guest_email', 'room_type',
            'check_in_date', 'check_out_date', 'payment_status',
            'payment_method', 'payment_amount', 'price_per_night',
            'nights', 'total_amount', 'final_amount', 'status'
        ];
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        allowedFields.forEach(field => {
            if (updateData[field] !== undefined && updateData[field] !== null) {
                const isNumericField = ['price_per_night', 'nights', 'total_amount', 'final_amount'].includes(field);
                if (isNumericField || (updateData[field] !== '' && String(updateData[field]).trim() !== '')) {
                    updates.push(`${field} = $${paramIndex}`);
                    if (isNumericField) {
                        const numValue = parseInt(updateData[field]);
                        values.push(isNaN(numValue) ? 0 : numValue);
                    } else {
                        values.push(updateData[field]);
                    }
                    paramIndex++;
                }
            }
        });
        
        if (updates.length === 0) {
            throw new Error('沒有要更新的欄位');
        }
        
        values.push(bookingId);
        const sql = `UPDATE bookings SET ${updates.join(', ')} WHERE booking_id = $${paramIndex}`;
        
        console.log('執行 SQL:', sql);
        console.log('參數值:', values);
        
        const result = await client.query(sql, values);
        
        if (result.rowCount === 0) {
            throw new Error('找不到該訂房記錄或沒有資料被更新');
        }
        
        console.log(`✅ 訂房記錄已更新 (影響行數: ${result.rowCount})`);
        return result.rowCount;
    } catch (err) {
        console.error('❌ 更新訂房記錄失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 取消訂房
async function cancelBooking(bookingId) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1",
            [bookingId]
        );
        console.log(`✅ 訂房已取消 (影響行數: ${result.rowCount})`);
        return result.rowCount;
    } catch (err) {
        console.error('❌ 取消訂房失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 刪除訂房記錄
async function deleteBooking(bookingId) {
    const client = await pool.connect();
    try {
        const result = await client.query('DELETE FROM bookings WHERE booking_id = $1', [bookingId]);
        console.log(`✅ 訂房記錄已刪除 (影響行數: ${result.rowCount})`);
        return result.rowCount;
    } catch (err) {
        console.error('❌ 刪除訂房記錄失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 統計資料
async function getStatistics(startDate = null, endDate = null) {
    const client = await pool.connect();
    try {
        let dateFilter = '';
        if (startDate && endDate) {
            dateFilter = `WHERE created_at >= '${startDate}' AND created_at <= '${endDate} 23:59:59'`;
        } else if (startDate) {
            dateFilter = `WHERE created_at >= '${startDate}'`;
        } else if (endDate) {
            dateFilter = `WHERE created_at <= '${endDate} 23:59:59'`;
        }
        
        const [totalResult, revenueResult, byRoomTypeResult, recentResult, rangeRevenueResult] = await Promise.all([
            client.query(`SELECT COUNT(*) as count FROM bookings`),
            client.query(`SELECT COALESCE(SUM(total_amount), 0) as total FROM bookings`),
            client.query(`SELECT room_type, COUNT(*) as count FROM bookings GROUP BY room_type`),
            client.query(`SELECT COUNT(*) as count FROM bookings WHERE created_at >= NOW() - INTERVAL '7 days'`),
            dateFilter ? client.query(`SELECT COALESCE(SUM(total_amount), 0) as total FROM bookings ${dateFilter}`) : Promise.resolve({ rows: [{ total: 0 }] })
        ]);
        
        return {
            totalBookings: parseInt(totalResult.rows[0].count),
            totalRevenue: parseInt(revenueResult.rows[0].total || 0),
            byRoomType: byRoomTypeResult.rows,
            recentBookings: parseInt(recentResult.rows[0].count),
            rangeRevenue: dateFilter ? parseInt(rangeRevenueResult.rows[0].total || 0) : 0
        };
    } catch (err) {
        console.error('❌ 查詢統計資料失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// ==================== 房型管理 ====================

// 取得所有房型（只包含啟用的）
async function getAllRoomTypes() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM room_types WHERE is_active = 1 ORDER BY display_order ASC, id ASC'
        );
        return result.rows;
    } catch (err) {
        console.error('❌ 查詢房型失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 取得所有房型（包含已停用的，供管理後台使用）
async function getAllRoomTypesAdmin() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM room_types ORDER BY display_order ASC, id ASC'
        );
        return result.rows;
    } catch (err) {
        console.error('❌ 查詢房型失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 取得單一房型
async function getRoomTypeById(id) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM room_types WHERE id = $1', [id]);
        return result.rows[0] || null;
    } catch (err) {
        console.error('❌ 查詢房型失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 新增房型
async function createRoomType(roomData) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'INSERT INTO room_types (name, display_name, price, icon, display_order, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [
                roomData.name,
                roomData.display_name,
                roomData.price,
                roomData.icon || '🏠',
                roomData.display_order || 0,
                roomData.is_active !== undefined ? roomData.is_active : 1
            ]
        );
        console.log(`✅ 房型已新增 (ID: ${result.rows[0].id})`);
        return result.rows[0].id;
    } catch (err) {
        console.error('❌ 新增房型失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 更新房型
async function updateRoomType(id, roomData) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'UPDATE room_types SET display_name = $1, price = $2, icon = $3, display_order = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6',
            [
                roomData.display_name,
                roomData.price,
                roomData.icon || '🏠',
                roomData.display_order || 0,
                roomData.is_active !== undefined ? roomData.is_active : 1,
                id
            ]
        );
        console.log(`✅ 房型已更新 (影響行數: ${result.rowCount})`);
        return result.rowCount;
    } catch (err) {
        console.error('❌ 更新房型失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 刪除房型（軟刪除）
async function deleteRoomType(id) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'UPDATE room_types SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [id]
        );
        console.log(`✅ 房型已刪除 (影響行數: ${result.rowCount})`);
        return result.rowCount;
    } catch (err) {
        console.error('❌ 刪除房型失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// ==================== 系統設定管理 ====================

// 取得設定值
async function getSetting(key) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT value FROM settings WHERE key = $1', [key]);
        return result.rows[0] ? result.rows[0].value : null;
    } catch (err) {
        console.error('❌ 查詢設定失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 取得所有設定
async function getAllSettings() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM settings ORDER BY key ASC');
        return result.rows;
    } catch (err) {
        console.error('❌ 查詢設定失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// 更新設定
async function updateSetting(key, value, description = null) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO settings (key, value, description, updated_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO UPDATE SET value = $2, description = $3, updated_at = CURRENT_TIMESTAMP`,
            [key, value, description]
        );
        console.log(`✅ 設定已更新 (key: ${key})`);
        return result.rowCount;
    } catch (err) {
        console.error('❌ 更新設定失敗:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// ==================== 郵件模板相關函數 ====================

async function getAllEmailTemplates() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM email_templates ORDER BY template_key');
        return result.rows || [];
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

async function getEmailTemplateByKey(templateKey) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM email_templates WHERE template_key = $1', [templateKey]);
        return result.rows[0] || null;
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

async function updateEmailTemplate(templateKey, data) {
    const client = await pool.connect();
    try {
        const { template_name, subject, content, is_enabled, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder } = data;
        const result = await client.query(
            `UPDATE email_templates 
             SET template_name = $1, subject = $2, content = $3, is_enabled = $4, 
                 days_before_checkin = $5, send_hour_checkin = $6, 
                 days_after_checkout = $7, send_hour_feedback = $8,
                 days_reserved = $9, send_hour_payment_reminder = $10,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE template_key = $11`,
            [template_name, subject, content, is_enabled ? 1 : 0, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder, templateKey]
        );
        return { changes: result.rowCount };
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

// 取得需要發送匯款提醒的訂房
async function getBookingsForPaymentReminder(daysAfterBooking = 0) {
    const client = await pool.connect();
    try {
        // daysAfterBooking: 訂房後第幾天發送（例如：3=訂房後第3天，也就是3天前建立的訂房）
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - daysAfterBooking);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        console.log(`🔍 [資料庫查詢] 匯款提醒查詢條件:`);
        console.log(`   目標日期: ${targetDateStr} (${daysAfterBooking} 天前)`);
        console.log(`   付款方式: 包含「匯款」或「轉帳」`);
        console.log(`   付款狀態: pending`);
        console.log(`   訂房狀態: active 或 reserved`);
        console.log(`   建立日期: ${targetDateStr}`);
        console.log(`   郵件狀態: 未發送過 payment_reminder`);
        
        const result = await client.query(`
            SELECT * FROM bookings 
            WHERE (payment_method LIKE '%匯款%' OR payment_method LIKE '%轉帳%')
            AND payment_status = 'pending' 
            AND (status = 'active' OR status = 'reserved')
            AND DATE(created_at) = $1
            AND (email_sent IS NULL OR email_sent = '' OR email_sent = '0' OR email_sent NOT LIKE '%payment_reminder%')
        `, [targetDateStr]);
        
        console.log(`📊 [資料庫查詢] 查詢結果: 找到 ${result.rows.length} 筆訂房`);
        if (result.rows.length > 0) {
            result.rows.forEach((booking, index) => {
                console.log(`   訂房 ${index + 1}: ${booking.booking_id} - ${booking.guest_name} (建立日期: ${booking.created_at})`);
            });
        }
        
        return result.rows || [];
    } catch (err) {
        console.error('❌ [資料庫查詢] 匯款提醒查詢錯誤:', err);
        throw err;
    } finally {
        client.release();
    }
}

// 取得需要發送入住提醒的訂房
async function getBookingsForCheckinReminder(daysBeforeCheckin = 1) {
    const client = await pool.connect();
    try {
        // daysBeforeCheckin: 入住前幾天發送（例如：1=入住前1天）
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + daysBeforeCheckin);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        const result = await client.query(`
            SELECT * FROM bookings 
            WHERE check_in_date = $1
            AND status = 'active'
            AND payment_status = 'paid'
            AND (email_sent IS NULL OR email_sent = '' OR email_sent = '0' OR email_sent NOT LIKE '%checkin_reminder%')
        `, [targetDateStr]);
        
        return result.rows || [];
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

// 取得需要發送回訪信的訂房
async function getBookingsForFeedbackRequest(daysAfterCheckout = 1) {
    const client = await pool.connect();
    try {
        // daysAfterCheckout: 退房後幾天發送（例如：1=退房後1天）
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - daysAfterCheckout);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        const result = await client.query(`
            SELECT * FROM bookings 
            WHERE check_out_date = $1
            AND status = 'active'
            AND (email_sent IS NULL OR email_sent = '' OR email_sent = '0' OR email_sent NOT LIKE '%feedback_request%')
        `, [targetDateStr]);
        
        return result.rows || [];
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

// 取得房間可用性
async function getRoomAvailability(startDate, endDate) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT room_type, COUNT(*) as count
            FROM bookings
            WHERE status IN ('active', 'reserved')
            AND (
                (check_in_date <= $1 AND check_out_date > $1) OR
                (check_in_date < $2 AND check_out_date >= $2) OR
                (check_in_date >= $1 AND check_out_date <= $2)
            )
            GROUP BY room_type
        `, [startDate, endDate]);
        
        const availability = {};
        result.rows.forEach(row => {
            availability[row.room_type] = parseInt(row.count);
        });
        
        return availability;
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

// 取得過期保留的訂房
async function getBookingsExpiredReservation() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT b.*, et.days_reserved
            FROM bookings b
            LEFT JOIN email_templates et ON et.template_key = 'payment_reminder'
            WHERE b.status = 'reserved'
            AND b.payment_method LIKE '%匯款%'
            AND b.payment_status = 'pending'
            AND b.created_at < NOW() - INTERVAL '1 day' * COALESCE(et.days_reserved, 3)
        `);
        
        return result.rows || [];
    } catch (err) {
        console.error('❌ 查詢過期保留訂房失敗:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    initDatabase,
    saveBooking,
    updateEmailStatus,
    getAllBookings,
    getBookingById,
    getBookingsByEmail,
    updateBooking,
    cancelBooking,
    deleteBooking,
    getStatistics,
    // 房型管理
    getAllRoomTypes,
    getAllRoomTypesAdmin,
    getRoomTypeById,
    createRoomType,
    updateRoomType,
    deleteRoomType,
    // 系統設定
    getSetting,
    getAllSettings,
    updateSetting,
    // 郵件模板
    getAllEmailTemplates,
    getEmailTemplateByKey,
    updateEmailTemplate,
    // 自動郵件查詢
    getBookingsForPaymentReminder,
    getBookingsForCheckinReminder,
    getBookingsForFeedbackRequest,
    // 房間可用性
    getRoomAvailability,
    // 過期保留
    getBookingsExpiredReservation
};
