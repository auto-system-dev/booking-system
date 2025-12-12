// 資料庫模組
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

// 檢測使用哪種資料庫
const usePostgreSQL = !!process.env.DATABASE_URL;

// PostgreSQL 連接池（如果使用 PostgreSQL）
let pgPool = null;
if (usePostgreSQL) {
    try {
        pgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
        });
        console.log('✅ PostgreSQL 連接池已建立');
    } catch (error) {
        console.error('❌ PostgreSQL 連接池建立失敗:', error.message);
        throw error;
    }
}

// SQLite 資料庫檔案路徑
const DB_PATH = path.join(__dirname, 'bookings.db');

// 建立資料庫連線（根據環境自動選擇）
function getDatabase() {
    if (usePostgreSQL) {
        // PostgreSQL 使用連接池，不需要返回連接物件
        // 但為了向後兼容，返回一個模擬物件
        return {
            isPostgreSQL: true,
            pool: pgPool
        };
    } else {
        // SQLite
        return new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌ 資料庫連線失敗:', err.message);
            } else {
                console.log('✅ 已連接到 SQLite 資料庫');
            }
        });
    }
}

// 執行 SQL 查詢（統一接口）
async function query(sql, params = []) {
    if (usePostgreSQL) {
        // PostgreSQL 查詢
        try {
            const result = await pgPool.query(sql, params);
            return {
                rows: result.rows,
                changes: result.rowCount || 0,
                lastID: result.rows[0]?.id || null
            };
        } catch (error) {
            console.error('❌ PostgreSQL 查詢錯誤:', error.message);
            console.error('SQL:', sql);
            console.error('參數:', params);
            throw error;
        }
    } else {
        // SQLite 查詢（使用 Promise 包裝）
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            // 判斷是 SELECT 還是其他操作
            const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
            
            if (isSelect) {
                db.all(sql, params, (err, rows) => {
                    db.close();
                    if (err) {
                        console.error('❌ SQLite 查詢錯誤:', err.message);
                        console.error('SQL:', sql);
                        console.error('參數:', params);
                        reject(err);
                    } else {
                        resolve({
                            rows: rows || [],
                            changes: 0,
                            lastID: null
                        });
                    }
                });
            } else {
                db.run(sql, params, function(err) {
                    db.close();
                    if (err) {
                        console.error('❌ SQLite 執行錯誤:', err.message);
                        console.error('SQL:', sql);
                        console.error('參數:', params);
                        reject(err);
                    } else {
                        resolve({
                            rows: [],
                            changes: this.changes,
                            lastID: this.lastID
                        });
                    }
                });
            }
        });
    }
}

// 執行單一查詢（返回單一結果）
async function queryOne(sql, params = []) {
    if (usePostgreSQL) {
        try {
            const result = await pgPool.query(sql, params);
            return result.rows[0] || null;
        } catch (error) {
            console.error('❌ PostgreSQL 查詢錯誤:', error.message);
            throw error;
        }
    } else {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.get(sql, params, (err, row) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }
}

// 轉換 SQL 語法（SQLite -> PostgreSQL）
function convertSQL(sql) {
    if (!usePostgreSQL) return sql;
    
    // 轉換語法差異
    return sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
        .replace(/AUTOINCREMENT/g, 'SERIAL')
        .replace(/TEXT/g, 'VARCHAR(255)')
        .replace(/DATETIME/g, 'TIMESTAMP')
        .replace(/INSERT OR REPLACE/g, 'INSERT')
        .replace(/datetime\('now', '([^']+)'\)/g, "CURRENT_TIMESTAMP - INTERVAL '$1'")
        .replace(/DATE\(([^)]+)\)/g, 'DATE($1)');
}

// 初始化資料庫（建立資料表）
async function initDatabase() {
    try {
        if (usePostgreSQL) {
            console.log('🗄️  使用 PostgreSQL 資料庫');
            await initPostgreSQL();
        } else {
            console.log('🗄️  使用 SQLite 資料庫');
            await initSQLite();
        }
    } catch (error) {
        console.error('❌ 資料庫初始化失敗:', error);
        throw error;
    }
}

// 初始化 PostgreSQL
async function initPostgreSQL() {
    return new Promise(async (resolve, reject) => {
        try {
            // 建立訂房資料表
            await query(`
                CREATE TABLE IF NOT EXISTS bookings (
                    id SERIAL PRIMARY KEY,
                    booking_id VARCHAR(255) UNIQUE NOT NULL,
                    check_in_date VARCHAR(255) NOT NULL,
                    check_out_date VARCHAR(255) NOT NULL,
                    room_type VARCHAR(255) NOT NULL,
                    guest_name VARCHAR(255) NOT NULL,
                    guest_phone VARCHAR(255) NOT NULL,
                    guest_email VARCHAR(255) NOT NULL,
                    payment_amount VARCHAR(255) NOT NULL,
                    payment_method VARCHAR(255) NOT NULL,
                    price_per_night INTEGER NOT NULL,
                    nights INTEGER NOT NULL,
                    total_amount INTEGER NOT NULL,
                    final_amount INTEGER NOT NULL,
                    booking_date VARCHAR(255) NOT NULL,
                    email_sent VARCHAR(255) DEFAULT '0',
                    payment_status VARCHAR(255) DEFAULT 'pending',
                    status VARCHAR(255) DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 訂房資料表已準備就緒');
            
            // 檢查並新增欄位（如果不存在）
            try {
                await query(`ALTER TABLE bookings ADD COLUMN payment_status VARCHAR(255) DEFAULT 'pending'`);
            } catch (err) {
                if (!err.message.includes('duplicate column')) {
                    console.warn('⚠️  新增 payment_status 欄位時發生錯誤:', err.message);
                }
            }
            
            try {
                await query(`ALTER TABLE bookings ADD COLUMN status VARCHAR(255) DEFAULT 'active'`);
                console.log('✅ 資料表欄位已更新');
            } catch (err) {
                if (!err.message.includes('duplicate column')) {
                    console.warn('⚠️  新增 status 欄位時發生錯誤:', err.message);
                }
            }
            
            // 修改 email_sent 欄位類型（如果已經是 INTEGER，改為 VARCHAR）
            try {
                // 檢查欄位類型
                const columnInfo = await query(`
                    SELECT data_type 
                    FROM information_schema.columns 
                    WHERE table_name = 'bookings' 
                    AND column_name = 'email_sent'
                `);
                
                if (columnInfo.rows && columnInfo.rows.length > 0) {
                    const dataType = columnInfo.rows[0].data_type;
                    if (dataType === 'integer') {
                        // 直接修改欄位類型，使用 USING 子句轉換現有資料
                        await query(`
                            ALTER TABLE bookings 
                            ALTER COLUMN email_sent TYPE VARCHAR(255) 
                            USING CASE 
                                WHEN email_sent = 0 THEN '0'
                                WHEN email_sent = 1 THEN '1'
                                ELSE email_sent::VARCHAR
                            END
                        `);
                        console.log('✅ email_sent 欄位類型已從 INTEGER 改為 VARCHAR');
                    }
                }
            } catch (err) {
                // 如果欄位不存在或已經是 VARCHAR，忽略錯誤
                if (!err.message.includes('does not exist') && !err.message.includes('already') && !err.message.includes('duplicate')) {
                    console.warn('⚠️  修改 email_sent 欄位類型時發生錯誤:', err.message);
                }
            }
            
            // 建立房型設定表
            await query(`
                CREATE TABLE IF NOT EXISTS room_types (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    display_name VARCHAR(255) NOT NULL,
                    price INTEGER NOT NULL,
                    holiday_surcharge INTEGER DEFAULT 0,
                    icon VARCHAR(255) DEFAULT '🏠',
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 房型設定表已準備就緒');
            
            // 檢查並添加 holiday_surcharge 欄位（如果不存在）
            try {
                await query('ALTER TABLE room_types ADD COLUMN holiday_surcharge INTEGER DEFAULT 0');
                console.log('✅ 已添加 holiday_surcharge 欄位');
            } catch (err) {
                if (err.message && err.message.includes('already exists')) {
                    console.log('✅ holiday_surcharge 欄位已存在');
                } else {
                    console.warn('⚠️  添加 holiday_surcharge 欄位時發生錯誤:', err.message);
                }
            }
            
            // 建立假日日期表
            await query(`
                CREATE TABLE IF NOT EXISTS holidays (
                    id SERIAL PRIMARY KEY,
                    holiday_date DATE NOT NULL UNIQUE,
                    holiday_name VARCHAR(255),
                    is_weekend INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 假日日期表已準備就緒');
            
            // 初始化預設房型
            const roomCount = await queryOne('SELECT COUNT(*) as count FROM room_types');
            if (roomCount && parseInt(roomCount.count) === 0) {
                const defaultRooms = [
                    ['standard', '標準雙人房', 2000, '🏠', 1],
                    ['deluxe', '豪華雙人房', 3500, '✨', 2],
                    ['suite', '尊爵套房', 5000, '👑', 3],
                    ['family', '家庭四人房', 4500, '👨‍👩‍👧‍👦', 4]
                ];
                
                for (const room of defaultRooms) {
                    await query(
                        'INSERT INTO room_types (name, display_name, price, icon, display_order) VALUES ($1, $2, $3, $4, $5)',
                        room
                    );
                }
                console.log('✅ 預設房型已初始化');
            }
            
            // 建立系統設定表
            await query(`
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
                const existing = await queryOne(
                    usePostgreSQL 
                        ? 'SELECT COUNT(*) as count FROM settings WHERE key = $1'
                        : 'SELECT COUNT(*) as count FROM settings WHERE key = ?',
                    [key]
                );
                if (!existing || parseInt(existing.count) === 0) {
                    await query(
                        usePostgreSQL
                            ? 'INSERT INTO settings (key, value, description) VALUES ($1, $2, $3)'
                            : 'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
                        [key, value, description]
                    );
                }
            }
            console.log('✅ 預設設定已初始化');
            
            // 建立郵件模板表
            await query(`
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
            
            // 初始化預設郵件模板
            await initEmailTemplates();
            
            resolve();
        } catch (error) {
            console.error('❌ PostgreSQL 初始化錯誤:', error);
            reject(error);
        }
    });
}

// 初始化郵件模板（PostgreSQL 和 SQLite 共用）
async function initEmailTemplates() {
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
                    此訂房將為您保留 {{daysReserved}} 天，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。
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
                <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                    <p style="margin: 5px 0; color: #333;"><strong>匯款資訊：</strong></p>
                    <p style="margin: 5px 0; color: #333;">銀行：{{bankName}}{{bankBranch ? ' - ' + bankBranch : ''}}</p>
                    <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">{{bankAccount}}</span></p>
                    <p style="margin: 5px 0; color: #333;">戶名：{{accountName}}</p>
                    <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>{{bookingId}}</strong></p>
                </div>
            </div>
            <p>如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
</body>
</html>`,
            enabled: 1,
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
            enabled: 1,
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
            enabled: 1,
            days_after_checkout: 1,
            send_hour_feedback: 10
        }
    ];
    
    for (const template of defaultTemplates) {
        try {
            const existing = await queryOne(
                usePostgreSQL 
                    ? 'SELECT content, template_name FROM email_templates WHERE template_key = $1'
                    : 'SELECT content, template_name FROM email_templates WHERE template_key = ?',
                [template.key]
            );
            
            // 如果模板不存在、內容為空、內容過短（可能是被誤刪）、或名稱需要更新，則插入或更新
            // 檢查內容長度：如果現有內容長度小於預設內容的 50%，視為內容過短，需要還原
            const isContentTooShort = existing && existing.content && existing.content.trim() !== '' 
                && existing.content.length < template.content.length * 0.5;
            
            if (!existing || !existing.content || existing.content.trim() === '' || existing.template_name !== template.name || isContentTooShort) {
                if (usePostgreSQL) {
                    await query(
                        `INSERT INTO email_templates (template_key, template_name, subject, content, is_enabled, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                         ON CONFLICT (template_key) DO UPDATE SET
                         template_name = EXCLUDED.template_name,
                         subject = EXCLUDED.subject,
                         content = EXCLUDED.content,
                         is_enabled = EXCLUDED.is_enabled,
                         days_before_checkin = EXCLUDED.days_before_checkin,
                         send_hour_checkin = EXCLUDED.send_hour_checkin,
                         days_after_checkout = EXCLUDED.days_after_checkout,
                         send_hour_feedback = EXCLUDED.send_hour_feedback,
                         days_reserved = EXCLUDED.days_reserved,
                         send_hour_payment_reminder = EXCLUDED.send_hour_payment_reminder,
                         updated_at = CURRENT_TIMESTAMP`,
                        [
                            template.key, template.name, template.subject, template.content, template.enabled,
                            template.days_before_checkin || null,
                            template.send_hour_checkin || null,
                            template.days_after_checkout || null,
                            template.send_hour_feedback || null,
                            template.days_reserved || null,
                            template.send_hour_payment_reminder || null
                        ]
                    );
                } else {
                    await query(
                        'INSERT OR REPLACE INTO email_templates (template_key, template_name, subject, content, is_enabled, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            template.key, template.name, template.subject, template.content, template.enabled,
                            template.days_before_checkin || null,
                            template.send_hour_checkin || null,
                            template.days_after_checkout || null,
                            template.send_hour_feedback || null,
                            template.days_reserved || null,
                            template.send_hour_payment_reminder || null
                        ]
                    );
                }
                
                if (existing && (!existing.content || existing.content.trim() === '')) {
                    console.log(`✅ 已更新空的郵件模板 ${template.key}`);
                } else if (existing && existing.template_name !== template.name) {
                    console.log(`✅ 已更新郵件模板名稱 ${template.key}: ${existing.template_name} -> ${template.name}`);
                } else if (isContentTooShort) {
                    console.log(`✅ 已還原郵件模板 ${template.key} 的完整內容（原內容長度: ${existing.content.length}, 新內容長度: ${template.content.length}）`);
                } else if (!existing) {
                    console.log(`✅ 已建立新的郵件模板 ${template.key}`);
                }
            }
        } catch (error) {
            console.warn(`⚠️  處理郵件模板 ${template.key} 失敗:`, error.message);
        }
    }
    
    console.log('✅ 預設郵件模板已初始化');
}

// 初始化 SQLite（保持原有邏輯）
function initSQLite() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        db.serialize(() => {
            // 建立訂房資料表
            db.run(`
                CREATE TABLE IF NOT EXISTS bookings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    booking_id TEXT UNIQUE NOT NULL,
                    check_in_date TEXT NOT NULL,
                    check_out_date TEXT NOT NULL,
                    room_type TEXT NOT NULL,
                    guest_name TEXT NOT NULL,
                    guest_phone TEXT NOT NULL,
                    guest_email TEXT NOT NULL,
                    payment_amount TEXT NOT NULL,
                    payment_method TEXT NOT NULL,
                    price_per_night INTEGER NOT NULL,
                    nights INTEGER NOT NULL,
                    total_amount INTEGER NOT NULL,
                    final_amount INTEGER NOT NULL,
                    booking_date TEXT NOT NULL,
                    email_sent VARCHAR(255) DEFAULT '0',
                    payment_status TEXT DEFAULT 'pending',
                    status TEXT DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ 建立資料表失敗:', err.message);
                    db.close();
                    reject(err);
                    return;
                }
                
                console.log('✅ 資料表已準備就緒');
                
                // 檢查並新增欄位（如果不存在）
                // 使用 serialize 確保順序執行
                db.run(`ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'pending'`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.warn('⚠️  新增 payment_status 欄位時發生錯誤:', err.message);
                    }
                    
                    // 第二個 ALTER TABLE
                    db.run(`ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'active'`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.warn('⚠️  新增 status 欄位時發生錯誤:', err.message);
                        } else {
                            console.log('✅ 資料表欄位已更新');
                        }
                        
                        // 建立房型設定表
                        db.run(`
                            CREATE TABLE IF NOT EXISTS room_types (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT UNIQUE NOT NULL,
                                display_name TEXT NOT NULL,
                                price INTEGER NOT NULL,
                                holiday_surcharge INTEGER DEFAULT 0,
                                icon TEXT DEFAULT '🏠',
                                display_order INTEGER DEFAULT 0,
                                is_active INTEGER DEFAULT 1,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, (err) => {
                            if (err) {
                                console.warn('⚠️  建立 room_types 表時發生錯誤:', err.message);
                            } else {
                                console.log('✅ 房型設定表已準備就緒');
                                
                                // 檢查並添加 holiday_surcharge 欄位（如果不存在）
                                db.run(`ALTER TABLE room_types ADD COLUMN holiday_surcharge INTEGER DEFAULT 0`, (err) => {
                                    if (err && !err.message.includes('duplicate column')) {
                                        console.warn('⚠️  添加 holiday_surcharge 欄位時發生錯誤:', err.message);
                                    } else {
                                        console.log('✅ 已添加 holiday_surcharge 欄位');
                                    }
                                    
                                    // 建立假日日期表
                                    db.run(`
                                        CREATE TABLE IF NOT EXISTS holidays (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            holiday_date TEXT NOT NULL UNIQUE,
                                            holiday_name TEXT,
                                            is_weekend INTEGER DEFAULT 0,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `, (err) => {
                                        if (err) {
                                            console.warn('⚠️  建立 holidays 表時發生錯誤:', err.message);
                                        } else {
                                            console.log('✅ 假日日期表已準備就緒');
                                        }
                                    });
                                });
                                
                                // 初始化預設房型（如果表是空的）
                                db.get('SELECT COUNT(*) as count FROM room_types', [], (err, row) => {
                                    if (!err && row && row.count === 0) {
                                        const defaultRooms = [
                                            ['standard', '標準雙人房', 2000, '🏠', 1],
                                            ['deluxe', '豪華雙人房', 3500, '✨', 2],
                                            ['suite', '尊爵套房', 5000, '👑', 3],
                                            ['family', '家庭四人房', 4500, '👨‍👩‍👧‍👦', 4]
                                        ];
                                        
                                        const stmt = db.prepare('INSERT INTO room_types (name, display_name, price, icon, display_order) VALUES (?, ?, ?, ?, ?)');
                                        defaultRooms.forEach(room => {
                                            stmt.run(room);
                                        });
                                        stmt.finalize();
                                        console.log('✅ 預設房型已初始化');
                                    }
                                });
                            }
                            
                            // 建立系統設定表
                            db.run(`
                                CREATE TABLE IF NOT EXISTS settings (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    key TEXT UNIQUE NOT NULL,
                                    value TEXT NOT NULL,
                                    description TEXT,
                                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                            `, (err) => {
                                if (err) {
                                    console.warn('⚠️  建立 settings 表時發生錯誤:', err.message);
                                } else {
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
                                    
                                    // 初始化預設設定
                                    let settingsCount = 0;
                                    defaultSettings.forEach(([key, value, description]) => {
                                        db.get('SELECT COUNT(*) as count FROM settings WHERE key = ?', [key], (err, row) => {
                                            if (!err && row && row.count === 0) {
                                                db.run('INSERT INTO settings (key, value, description) VALUES (?, ?, ?)', 
                                                    [key, value, description], (err) => {
                                                    if (!err) {
                                                        settingsCount++;
                                                        if (settingsCount === defaultSettings.length) {
                                                            console.log('✅ 預設設定已初始化');
                                                            // 所有設定初始化完成後，建立郵件模板表
                                                            createEmailTemplatesTable();
                                                        }
                                                    } else {
                                                        settingsCount++;
                                                        checkSettingsComplete();
                                                    }
                                                });
                                            } else {
                                                settingsCount++;
                                                checkSettingsComplete();
                                            }
                                        });
                                    });
                                    
                                    function checkSettingsComplete() {
                                        if (settingsCount === defaultSettings.length) {
                                            console.log('✅ 預設設定已初始化');
                                            createEmailTemplatesTable();
                                        }
                                    }
                                    
                                    function createEmailTemplatesTable() {
                                        // 建立郵件模板表
                                        db.run(`
                                        CREATE TABLE IF NOT EXISTS email_templates (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            template_key TEXT UNIQUE NOT NULL,
                                            template_name TEXT NOT NULL,
                                            subject TEXT NOT NULL,
                                            content TEXT NOT NULL,
                                            is_enabled INTEGER DEFAULT 1,
                                            days_before_checkin INTEGER,
                                            send_hour_checkin INTEGER,
                                            days_after_checkout INTEGER,
                                            send_hour_feedback INTEGER,
                                            days_reserved INTEGER,
                                            send_hour_payment_reminder INTEGER,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `, (err) => {
                                        if (err) {
                                            console.warn('⚠️  建立 email_templates 表時發生錯誤:', err.message);
                                            db.close();
                                            resolve();
                                            return;
                                        }
                                        
                                        console.log('✅ 郵件模板表已準備就緒');
                                            
                                            // 初始化預設郵件模板
                                            const defaultTemplates = [
                                                {
                                                    key: 'payment_reminder',
                                                    name: '匯款提醒',
                                                    subject: '【重要提醒】匯款期限即將到期',
                                                    days_reserved: 3,
                                                    send_hour_payment_reminder: 9,
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
                                                    days_before_checkin: 1,
                                                    send_hour_checkin: 9,
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
                                                    days_after_checkout: 1,
                                                    send_hour_feedback: 10,
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
                                            
                                            let templateCount = 0;
                                            defaultTemplates.forEach(template => {
                                                // 先檢查模板是否存在且內容為空
                                                db.get(`SELECT content, template_name FROM email_templates WHERE template_key = ?`, [template.key], (err, row) => {
                                                    if (err) {
                                                        console.warn(`⚠️  查詢郵件模板 ${template.key} 失敗:`, err.message);
                                                    }
                                                    
                                                    // 如果模板不存在、內容為空、或名稱需要更新，則插入或更新
                                                    if (!row || !row.content || row.content.trim() === '' || row.template_name !== template.name) {
                                                        db.run(`INSERT OR REPLACE INTO email_templates (template_key, template_name, subject, content, is_enabled, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                                            [template.key, template.name, template.subject, template.content, template.enabled, template.days_before_checkin || null, template.send_hour_checkin || null, template.days_after_checkout || null, template.send_hour_feedback || null, template.days_reserved || null, template.send_hour_payment_reminder || null], (err) => {
                                                            if (err) {
                                                                console.warn(`⚠️  插入/更新郵件模板 ${template.key} 失敗:`, err.message);
                                                            } else {
                                                                if (row && (!row.content || row.content.trim() === '')) {
                                                                    console.log(`✅ 已更新空的郵件模板 ${template.key}`);
                                                                } else if (row && row.template_name !== template.name) {
                                                                    console.log(`✅ 已更新郵件模板名稱 ${template.key}: ${row.template_name} -> ${template.name}`);
                                                                }
                                                            }
                                                            templateCount++;
                                                            if (templateCount === defaultTemplates.length) {
                                                                console.log('✅ 預設郵件模板已初始化');
                                                                // 所有操作完成後才關閉連接
                                                                db.close();
                                                                resolve();
                                                            }
                                                        });
                                                    } else {
                                                        // 模板已存在且內容不為空，跳過
                                                        templateCount++;
                                                        if (templateCount === defaultTemplates.length) {
                                                            console.log('✅ 預設郵件模板已初始化');
                                                            // 所有操作完成後才關閉連接
                                                            db.close();
                                                            resolve();
                                                        }
                                                    }
                                                });
                                            });
                                            
                                            // 如果沒有模板需要插入，直接關閉連接
                                            if (defaultTemplates.length === 0) {
                                                db.close();
                                                resolve();
                                            }
                                        });
                                    }
                                    
                                    // 如果沒有設定需要初始化，直接建立郵件模板表
                                    if (defaultSettings.length === 0) {
                                        createEmailTemplatesTable();
                                    }
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

// 儲存訂房資料
async function saveBooking(bookingData) {
    try {
        const sql = usePostgreSQL ? `
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                guest_name, guest_phone, guest_email,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id
        ` : `
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                guest_name, guest_phone, guest_email,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
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
            bookingData.emailSent || '0',  // 支援字串格式（郵件類型）或 '0'（未發送）
            bookingData.paymentStatus || 'pending',
            bookingData.status || 'active'
        ];
        
        const result = await query(sql, values);
        console.log(`✅ 訂房資料已儲存 (ID: ${result.lastID || result.rows[0]?.id})`);
        return result.lastID || result.rows[0]?.id;
    } catch (error) {
        console.error('❌ 儲存訂房資料失敗:', error.message);
        throw error;
    }
}

// 更新郵件發送狀態
// emailSent 可以是：
// - 布林值：true/false（轉換為 1/0，向後兼容）
// - 字串：郵件類型，例如 'booking_confirmation' 或 'booking_confirmation,checkin_reminder'
// - 如果 append 為 true，則追加郵件類型而不是覆蓋
async function updateEmailStatus(bookingId, emailSent, append = false) {
    try {
        let value;
        
        // 如果需要追加郵件類型
        if (append && typeof emailSent === 'string') {
            // 先取得現有的郵件狀態
            const booking = await queryOne(
                usePostgreSQL 
                    ? `SELECT email_sent FROM bookings WHERE booking_id = $1`
                    : `SELECT email_sent FROM bookings WHERE booking_id = ?`,
                [bookingId]
            );
            if (booking && booking.email_sent) {
                const existingTypes = typeof booking.email_sent === 'string' 
                    ? booking.email_sent.split(',').filter(t => t.trim())
                    : (booking.email_sent === 1 || booking.email_sent === '1' ? ['booking_confirmation'] : []);
                
                // 如果新類型不存在，則追加
                if (!existingTypes.includes(emailSent)) {
                    existingTypes.push(emailSent);
                    value = existingTypes.join(',');
                } else {
                    // 如果已存在，不重複追加
                    value = existingTypes.join(',');
                }
            } else {
                // 如果沒有現有狀態，直接使用新類型
                value = emailSent;
            }
        }
        // 如果是布林值，轉換為整數（向後兼容）
        else if (typeof emailSent === 'boolean') {
            value = emailSent ? 1 : 0;
        }
        // 如果是字串，直接使用（新格式：郵件類型）
        else if (typeof emailSent === 'string') {
            value = emailSent;
        }
        // 如果是數字，直接使用
        else {
            value = emailSent ? 1 : 0;
        }
        
        const sql = usePostgreSQL 
            ? `UPDATE bookings SET email_sent = $1 WHERE booking_id = $2`
            : `UPDATE bookings SET email_sent = ? WHERE booking_id = ?`;
        
        const result = await query(sql, [value, bookingId]);
        console.log(`✅ 郵件狀態已更新 (影響行數: ${result.changes}, 值: ${value})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 更新郵件狀態失敗:', error.message);
        throw error;
    }
}

// 查詢所有訂房記錄
async function getAllBookings() {
    try {
        const sql = `SELECT * FROM bookings ORDER BY created_at DESC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢訂房記錄失敗:', error.message);
        throw error;
    }
}

// 根據訂房編號查詢
async function getBookingById(bookingId) {
    try {
        const sql = usePostgreSQL 
            ? `SELECT * FROM bookings WHERE booking_id = $1`
            : `SELECT * FROM bookings WHERE booking_id = ?`;
        return await queryOne(sql, [bookingId]);
    } catch (error) {
        console.error('❌ 查詢訂房記錄失敗:', error.message);
        throw error;
    }
}

// 根據 Email 查詢訂房記錄
async function getBookingsByEmail(email) {
    try {
        const sql = usePostgreSQL 
            ? `SELECT * FROM bookings WHERE guest_email = $1 ORDER BY created_at DESC`
            : `SELECT * FROM bookings WHERE guest_email = ? ORDER BY created_at DESC`;
        const result = await query(sql, [email]);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢訂房記錄失敗:', error.message);
        throw error;
    }
}

// 更新訂房資料
async function updateBooking(bookingId, updateData) {
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
                    if (usePostgreSQL) {
                        updates.push(`${field} = $${paramIndex++}`);
                    } else {
                        updates.push(`${field} = ?`);
                    }
                    if (isNumericField) {
                        const numValue = parseInt(updateData[field]);
                        values.push(isNaN(numValue) ? 0 : numValue);
                    } else {
                        values.push(updateData[field]);
                    }
                }
            }
        });
        
        if (updates.length === 0) {
            throw new Error('沒有要更新的欄位');
        }
        
        values.push(bookingId);
        const sql = usePostgreSQL
            ? `UPDATE bookings SET ${updates.join(', ')} WHERE booking_id = $${paramIndex}`
            : `UPDATE bookings SET ${updates.join(', ')} WHERE booking_id = ?`;
        
        console.log('執行 SQL:', sql);
        console.log('參數值:', values);
        
        const result = await query(sql, values);
        console.log(`✅ 訂房記錄已更新 (影響行數: ${result.changes})`);
        
        if (result.changes === 0) {
            throw new Error('找不到該訂房記錄或沒有資料被更新');
        }
        
        return result.changes;
    } catch (error) {
        console.error('❌ 更新訂房記錄失敗:', error.message);
        throw error;
    }
}

// 取消訂房
async function cancelBooking(bookingId) {
    try {
        // PostgreSQL 不需要檢查欄位，因為在 initDatabase 中已經建立
        // SQLite 需要檢查，但我們在 initDatabase 中也已經處理了
        
        const sql = usePostgreSQL
            ? `UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1`
            : `UPDATE bookings SET status = 'cancelled' WHERE booking_id = ?`;
        
        const result = await query(sql, [bookingId]);
        console.log(`✅ 訂房已取消 (影響行數: ${result.changes})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 取消訂房失敗:', error.message);
        throw error;
    }
}

// 刪除訂房記錄（可選功能）
async function deleteBooking(bookingId) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM bookings WHERE booking_id = $1`
            : `DELETE FROM bookings WHERE booking_id = ?`;
        
        const result = await query(sql, [bookingId]);
        console.log(`✅ 訂房記錄已刪除 (影響行數: ${result.changes})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 刪除訂房記錄失敗:', error.message);
        throw error;
    }
}

// 統計資料
async function getStatistics() {
    try {
        const recentBookingsSQL = usePostgreSQL
            ? `SELECT COUNT(*) as count FROM bookings WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`
            : `SELECT COUNT(*) as count FROM bookings WHERE created_at >= datetime('now', '-7 days')`;
        
        const [totalResult, revenueResult, byRoomTypeResult, recentResult] = await Promise.all([
            queryOne('SELECT COUNT(*) as count FROM bookings'),
            queryOne('SELECT SUM(final_amount) as total FROM bookings'),
            query('SELECT room_type, COUNT(*) as count FROM bookings GROUP BY room_type'),
            queryOne(recentBookingsSQL)
        ]);
        
        return {
            totalBookings: parseInt(totalResult?.count || 0),
            totalRevenue: parseInt(revenueResult?.total || 0),
            byRoomType: byRoomTypeResult.rows || [],
            recentBookings: parseInt(recentResult?.count || 0)
        };
    } catch (error) {
        console.error('❌ 查詢統計資料失敗:', error.message);
        throw error;
    }
}

// ==================== 假日管理 ====================

// 取得所有假日
async function getAllHolidays() {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM holidays ORDER BY holiday_date ASC`
            : `SELECT * FROM holidays ORDER BY holiday_date ASC`;
        
        const result = await query(sql);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢假日列表失敗:', error.message);
        throw error;
    }
}

// 檢查日期是否為假日
async function isHoliday(dateString) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM holidays WHERE holiday_date = $1`
            : `SELECT * FROM holidays WHERE holiday_date = ?`;
        
        const result = await queryOne(sql, [dateString]);
        return result !== null;
    } catch (error) {
        console.error('❌ 檢查假日失敗:', error.message);
        return false;
    }
}

// 檢查日期是否為週末（週六或週日）
function isWeekend(dateString) {
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 週日, 6 = 週六
}

// 檢查日期是否為假日（包括週末和手動設定的假日）
async function isHolidayOrWeekend(dateString, includeWeekend = true) {
    // 先檢查是否為手動設定的假日
    const isManualHoliday = await isHoliday(dateString);
    if (isManualHoliday) {
        return true;
    }
    
    // 如果包含週末，檢查是否為週末
    if (includeWeekend) {
        return isWeekend(dateString);
    }
    
    return false;
}

// 新增假日
async function addHoliday(holidayDate, holidayName = null) {
    try {
        const sql = usePostgreSQL
            ? `INSERT INTO holidays (holiday_date, holiday_name, is_weekend) VALUES ($1, $2, 0) ON CONFLICT (holiday_date) DO NOTHING`
            : `INSERT OR IGNORE INTO holidays (holiday_date, holiday_name, is_weekend) VALUES (?, ?, 0)`;
        
        const result = await query(sql, [holidayDate, holidayName]);
        return result.changes || 0;
    } catch (error) {
        console.error('❌ 新增假日失敗:', error.message);
        throw error;
    }
}

// 新增連續假期
async function addHolidayRange(startDate, endDate, holidayName = null) {
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        let addedCount = 0;
        
        // 遍歷日期範圍內的每一天
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateString = date.toISOString().split('T')[0];
            try {
                await addHoliday(dateString, holidayName);
                addedCount++;
            } catch (err) {
                // 忽略重複的日期
                console.warn(`⚠️  日期 ${dateString} 已存在，跳過`);
            }
        }
        
        return addedCount;
    } catch (error) {
        console.error('❌ 新增連續假期失敗:', error.message);
        throw error;
    }
}

// 刪除假日
async function deleteHoliday(holidayDate) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM holidays WHERE holiday_date = $1 AND is_weekend = 0`
            : `DELETE FROM holidays WHERE holiday_date = ? AND is_weekend = 0`;
        
        const result = await query(sql, [holidayDate]);
        return result.changes || 0;
    } catch (error) {
        console.error('❌ 刪除假日失敗:', error.message);
        throw error;
    }
}

// ==================== 房型管理 ====================

// 取得所有房型（只包含啟用的，供前台使用）
async function getAllRoomTypes() {
    try {
        const sql = `SELECT * FROM room_types WHERE is_active = 1 ORDER BY display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢房型失敗:', error.message);
        throw error;
    }
}

// 取得所有房型（包含已停用的，供管理後台使用）
async function getAllRoomTypesAdmin() {
    try {
        const sql = `SELECT * FROM room_types ORDER BY display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢房型失敗:', error.message);
        throw error;
    }
}

// 取得單一房型
async function getRoomTypeById(id) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM room_types WHERE id = $1`
            : `SELECT * FROM room_types WHERE id = ?`;
        return await queryOne(sql, [id]);
    } catch (error) {
        console.error('❌ 查詢房型失敗:', error.message);
        throw error;
    }
}

// 新增房型
async function createRoomType(roomData) {
    try {
        const sql = usePostgreSQL ? `
            INSERT INTO room_types (name, display_name, price, icon, display_order, is_active) 
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        ` : `
            INSERT INTO room_types (name, display_name, price, icon, display_order, is_active) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            roomData.name,
            roomData.display_name,
            roomData.price,
            roomData.icon || '🏠',
            roomData.display_order || 0,
            roomData.is_active !== undefined ? roomData.is_active : 1
        ];
        
        const result = await query(sql, values);
        const newId = result.lastID || result.rows[0]?.id;
        console.log(`✅ 房型已新增 (ID: ${newId})`);
        return newId;
    } catch (error) {
        console.error('❌ 新增房型失敗:', error.message);
        throw error;
    }
}

// 更新房型
async function updateRoomType(id, roomData) {
    try {
        const sql = usePostgreSQL ? `
            UPDATE room_types 
            SET display_name = $1, price = $2, icon = $3, display_order = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
        ` : `
            UPDATE room_types 
            SET display_name = ?, price = ?, icon = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        const values = [
            roomData.display_name,
            roomData.price,
            roomData.icon || '🏠',
            roomData.display_order || 0,
            roomData.is_active !== undefined ? roomData.is_active : 1,
            id
        ];
        
        const result = await query(sql, values);
        console.log(`✅ 房型已更新 (影響行數: ${result.changes})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 更新房型失敗:', error.message);
        throw error;
    }
}

// ==================== 假日管理 ====================

// 取得所有假日
async function getAllHolidays() {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM holidays ORDER BY holiday_date ASC`
            : `SELECT * FROM holidays ORDER BY holiday_date ASC`;
        
        const result = await query(sql);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢假日列表失敗:', error.message);
        throw error;
    }
}

// 檢查日期是否為假日
async function isHoliday(dateString) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM holidays WHERE holiday_date = $1`
            : `SELECT * FROM holidays WHERE holiday_date = ?`;
        
        const result = await queryOne(sql, [dateString]);
        return result !== null;
    } catch (error) {
        console.error('❌ 檢查假日失敗:', error.message);
        return false;
    }
}

// 檢查日期是否為週末（週六或週日）
function isWeekend(dateString) {
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 週日, 6 = 週六
}

// 檢查日期是否為假日（包括週末和手動設定的假日）
async function isHolidayOrWeekend(dateString, includeWeekend = true) {
    // 先檢查是否為手動設定的假日
    const isManualHoliday = await isHoliday(dateString);
    if (isManualHoliday) {
        return true;
    }
    
    // 如果包含週末，檢查是否為週末
    if (includeWeekend) {
        return isWeekend(dateString);
    }
    
    return false;
}

// 新增假日
async function addHoliday(holidayDate, holidayName = null) {
    try {
        const sql = usePostgreSQL
            ? `INSERT INTO holidays (holiday_date, holiday_name, is_weekend) VALUES ($1, $2, 0) ON CONFLICT (holiday_date) DO NOTHING`
            : `INSERT OR IGNORE INTO holidays (holiday_date, holiday_name, is_weekend) VALUES (?, ?, 0)`;
        
        const result = await query(sql, [holidayDate, holidayName]);
        return result.changes || 0;
    } catch (error) {
        console.error('❌ 新增假日失敗:', error.message);
        throw error;
    }
}

// 新增連續假期
async function addHolidayRange(startDate, endDate, holidayName = null) {
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        let addedCount = 0;
        
        // 遍歷日期範圍內的每一天
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateString = date.toISOString().split('T')[0];
            try {
                await addHoliday(dateString, holidayName);
                addedCount++;
            } catch (err) {
                // 忽略重複的日期
                console.warn(`⚠️  日期 ${dateString} 已存在，跳過`);
            }
        }
        
        return addedCount;
    } catch (error) {
        console.error('❌ 新增連續假期失敗:', error.message);
        throw error;
    }
}

// 刪除假日
async function deleteHoliday(holidayDate) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM holidays WHERE holiday_date = $1 AND is_weekend = 0`
            : `DELETE FROM holidays WHERE holiday_date = ? AND is_weekend = 0`;
        
        const result = await query(sql, [holidayDate]);
        return result.changes || 0;
    } catch (error) {
        console.error('❌ 刪除假日失敗:', error.message);
        throw error;
    }
}

// 刪除房型（硬刪除 - 真正從資料庫刪除）
async function deleteRoomType(id) {
    try {
        // 先檢查房型是否存在
        const roomType = await queryOne(
            usePostgreSQL
                ? `SELECT id, name FROM room_types WHERE id = $1`
                : `SELECT id, name FROM room_types WHERE id = ?`,
            [id]
        );
        
        if (!roomType) {
            console.log(`⚠️ 找不到房型 ID: ${id}`);
            return 0;
        }
        
        // 檢查是否有訂房記錄使用該房型
        const bookingCheck = await queryOne(
            usePostgreSQL
                ? `SELECT COUNT(*) as count FROM bookings WHERE room_type = $1`
                : `SELECT COUNT(*) as count FROM bookings WHERE room_type = ?`,
            [roomType.name]
        );
        
        const bookingCount = bookingCheck ? (bookingCheck.count || 0) : 0;
        
        if (bookingCount > 0) {
            console.log(`⚠️ 房型 "${roomType.name}" 仍有 ${bookingCount} 筆訂房記錄，無法刪除`);
            throw new Error(`無法刪除：該房型仍有 ${bookingCount} 筆訂房記錄，請先處理相關訂房記錄`);
        }
        
        // 執行硬刪除（真正從資料庫刪除）
        const sql = usePostgreSQL
            ? `DELETE FROM room_types WHERE id = $1`
            : `DELETE FROM room_types WHERE id = ?`;
        
        const result = await query(sql, [id]);
        console.log(`✅ 房型已永久刪除 (影響行數: ${result.changes})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 刪除房型失敗:', error.message);
        throw error;
    }
}

// ==================== 系統設定管理 ====================

// 取得設定值
async function getSetting(key) {
    try {
        const sql = usePostgreSQL
            ? `SELECT value FROM settings WHERE key = $1`
            : `SELECT value FROM settings WHERE key = ?`;
        const row = await queryOne(sql, [key]);
        return row ? row.value : null;
    } catch (error) {
        console.error('❌ 查詢設定失敗:', error.message);
        throw error;
    }
}

// 取得所有設定
async function getAllSettings() {
    try {
        const sql = `SELECT * FROM settings ORDER BY key ASC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢設定失敗:', error.message);
        throw error;
    }
}

// 更新設定
async function updateSetting(key, value, description = null) {
    try {
        const sql = usePostgreSQL ? `
            INSERT INTO settings (key, value, description, updated_at) 
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = CURRENT_TIMESTAMP
        ` : `
            INSERT OR REPLACE INTO settings (key, value, description, updated_at) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        const result = await query(sql, [key, value, description]);
        console.log(`✅ 設定已更新 (key: ${key})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 更新設定失敗:', error.message);
        throw error;
    }
}

// ==================== 郵件模板相關函數 ====================

async function getAllEmailTemplates() {
    try {
        const sql = `SELECT * FROM email_templates ORDER BY template_key`;
        const result = await query(sql);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢郵件模板失敗:', error.message);
        throw error;
    }
}

async function getEmailTemplateByKey(templateKey) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM email_templates WHERE template_key = $1`
            : `SELECT * FROM email_templates WHERE template_key = ?`;
        return await queryOne(sql, [templateKey]);
    } catch (error) {
        console.error('❌ 查詢郵件模板失敗:', error.message);
        throw error;
    }
}

async function updateEmailTemplate(templateKey, data) {
    try {
        const { template_name, subject, content, is_enabled, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder } = data;
        
        console.log(`📝 資料庫更新郵件模板: ${templateKey}`);
        console.log(`   接收到的設定值:`, {
            days_before_checkin,
            send_hour_checkin,
            days_after_checkout,
            send_hour_feedback,
            days_reserved,
            send_hour_payment_reminder
        });
        
        const sql = usePostgreSQL ? `
            UPDATE email_templates 
            SET template_name = $1, subject = $2, content = $3, is_enabled = $4,
                days_before_checkin = $5, send_hour_checkin = $6,
                days_after_checkout = $7, send_hour_feedback = $8,
                days_reserved = $9, send_hour_payment_reminder = $10,
                updated_at = CURRENT_TIMESTAMP 
            WHERE template_key = $11
        ` : `
            UPDATE email_templates 
            SET template_name = ?, subject = ?, content = ?, is_enabled = ?,
                days_before_checkin = ?, send_hour_checkin = ?,
                days_after_checkout = ?, send_hour_feedback = ?,
                days_reserved = ?, send_hour_payment_reminder = ?,
                updated_at = CURRENT_TIMESTAMP 
            WHERE template_key = ?
        `;
        
        // 處理數值：如果是 undefined 或 null，設為 null；否則保持原值（包括 0）
        const values = [
            template_name, subject, content, is_enabled ? 1 : 0,
            days_before_checkin !== undefined ? days_before_checkin : null,
            send_hour_checkin !== undefined ? send_hour_checkin : null,
            days_after_checkout !== undefined ? days_after_checkout : null,
            send_hour_feedback !== undefined ? send_hour_feedback : null,
            days_reserved !== undefined ? days_reserved : null,
            send_hour_payment_reminder !== undefined ? send_hour_payment_reminder : null,
            templateKey
        ];
        
        console.log(`   準備更新的值:`, values);
        
        const result = await query(sql, values);
        console.log(`✅ 資料庫更新成功，影響行數: ${result.changes || result.rowCount}`);
        return { changes: result.changes || result.rowCount };
    } catch (error) {
        console.error('❌ 更新郵件模板失敗:', error.message);
        throw error;
    }
}

// 取得需要發送匯款提醒的訂房（匯款期限最後一天）
async function getBookingsForPaymentReminder() {
    try {
        // 使用本地時區計算今天的日期
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // 格式化為 YYYY-MM-DD（使用本地時區）
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        
        console.log(`📅 查詢匯款提醒訂房 - 目標日期: ${todayStr} (今天)`);
        console.log(`   當前時間: ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
        console.log(`   查詢條件: 匯款轉帳 + 待付款 + 保留狀態 + 匯款期限最後一天`);
        
        // 查詢匯款期限最後一天的訂房
        // 條件：訂房建立日期 + days_reserved = 今天
        // 注意：這裡需要從模板取得 days_reserved，但為了簡化，我們查詢所有符合條件的訂房
        // 實際的 days_reserved 檢查會在 server.js 中進行
        const sql = usePostgreSQL ? `
            SELECT * FROM bookings 
            WHERE payment_method LIKE '%匯款%' 
            AND payment_status = 'pending' 
            AND status = 'reserved'
            AND DATE(created_at) <= DATE($1)
        ` : `
            SELECT * FROM bookings 
            WHERE payment_method LIKE '%匯款%' 
            AND payment_status = 'pending' 
            AND status = 'reserved'
            AND DATE(created_at) <= DATE(?)
        `;
        
        const result = await query(sql, [todayStr]);
        console.log(`   找到 ${result.rows ? result.rows.length : 0} 筆符合條件的訂房`);
        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(booking => {
                const bookingDate = new Date(booking.created_at);
                console.log(`   - ${booking.booking_id}: ${booking.guest_name}, 建立日期: ${booking.created_at}, 狀態: ${booking.status}, 付款狀態: ${booking.payment_status}`);
            });
        }
        
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢匯款提醒訂房失敗:', error.message);
        throw error;
    }
}

// 取得需要發送入住提醒的訂房（入住前一天）
async function getBookingsForCheckinReminder() {
    try {
        // 使用本地時區計算明天的日期
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        
        // 格式化為 YYYY-MM-DD（使用本地時區）
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const tomorrowStr = `${year}-${month}-${day}`;
        
        console.log(`📅 查詢入住提醒訂房 - 目標日期: ${tomorrowStr} (明天)`);
        console.log(`   當前時間: ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
        
        const sql = usePostgreSQL
            ? `SELECT * FROM bookings WHERE check_in_date = $1 AND status = 'active' AND payment_status = 'paid'`
            : `SELECT * FROM bookings WHERE check_in_date = ? AND status = 'active' AND payment_status = 'paid'`;
        
        const result = await query(sql, [tomorrowStr]);
        console.log(`   找到 ${result.rows ? result.rows.length : 0} 筆符合條件的訂房`);
        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(booking => {
                console.log(`   - ${booking.booking_id}: ${booking.guest_name}, 入住日期: ${booking.check_in_date}, 狀態: ${booking.status}, 付款狀態: ${booking.payment_status}`);
            });
        }
        
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢入住提醒訂房失敗:', error.message);
        throw error;
    }
}

// 取得需要發送回訪信的訂房（退房後隔天）
async function getBookingsForFeedbackRequest() {
    try {
        // 使用本地時區計算昨天的日期
        const now = new Date();
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        
        // 格式化為 YYYY-MM-DD（使用本地時區）
        const year = yesterday.getFullYear();
        const month = String(yesterday.getMonth() + 1).padStart(2, '0');
        const day = String(yesterday.getDate()).padStart(2, '0');
        const yesterdayStr = `${year}-${month}-${day}`;
        
        console.log(`📅 查詢回訪信訂房 - 目標日期: ${yesterdayStr} (昨天退房)`);
        console.log(`   當前時間: ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
        
        const sql = usePostgreSQL
            ? `SELECT * FROM bookings WHERE check_out_date = $1 AND status = 'active'`
            : `SELECT * FROM bookings WHERE check_out_date = ? AND status = 'active'`;
        
        const result = await query(sql, [yesterdayStr]);
        console.log(`   找到 ${result.rows ? result.rows.length : 0} 筆符合條件的訂房`);
        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(booking => {
                console.log(`   - ${booking.booking_id}: ${booking.guest_name}, 退房日期: ${booking.check_out_date}, 狀態: ${booking.status}`);
            });
        }
        
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢回訪信訂房失敗:', error.message);
        throw error;
    }
}

// 檢查房間可用性（檢查指定日期範圍內是否有有效或保留的訂房）
async function getRoomAvailability(checkInDate, checkOutDate) {
    try {
        const sql = usePostgreSQL ? `
            SELECT DISTINCT rt.name
            FROM bookings b
            INNER JOIN room_types rt ON b.room_type = rt.display_name
            WHERE (
                b.check_in_date < $1 
                AND b.check_out_date > $2
                AND b.status IN ('active', 'reserved')
            )
        ` : `
            SELECT DISTINCT rt.name
            FROM bookings b
            INNER JOIN room_types rt ON b.room_type = rt.display_name
            WHERE (
                b.check_in_date < ? 
                AND b.check_out_date > ?
                AND b.status IN ('active', 'reserved')
            )
        `;
        
        const result = await query(sql, [checkOutDate, checkInDate]);
        const unavailableRooms = result.rows.map(row => row.name);
        return unavailableRooms || [];
    } catch (error) {
        console.error('❌ 查詢房間可用性失敗:', error.message);
        throw error;
    }
}

// 取得已過期保留期限的訂房（需要自動取消）
async function getBookingsExpiredReservation() {
    try {
        const sql = usePostgreSQL ? `
            SELECT * FROM bookings 
            WHERE payment_method LIKE '%匯款%' 
            AND status = 'reserved' 
            AND payment_status = 'pending'
        ` : `
            SELECT * FROM bookings 
            WHERE payment_method LIKE '%匯款%' 
            AND status = 'reserved' 
            AND payment_status = 'pending'
        `;
        
        const result = await query(sql);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢過期保留訂房失敗:', error.message);
        throw error;
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
    // 假日管理
    getAllHolidays,
    isHoliday,
    isWeekend,
    isHolidayOrWeekend,
    addHoliday,
    addHolidayRange,
    deleteHoliday,
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
    // 過期保留訂房
    getBookingsExpiredReservation
};

