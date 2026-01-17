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
                    adults INTEGER DEFAULT 0,
                    children INTEGER DEFAULT 0,
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
            // payment_status 和 status 已在 CREATE TABLE 中定義，不需要再次添加
            
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
            
            // 檢查並添加欄位（如果不存在）- 使用檢查方式避免錯誤訊息
            const columnsToAdd = [
                { name: 'addons', type: 'TEXT', default: null },
                { name: 'addons_total', type: 'INTEGER', default: '0' },
                { name: 'adults', type: 'INTEGER', default: '0' },
                { name: 'children', type: 'INTEGER', default: '0' },
                { name: 'payment_deadline', type: 'TEXT', default: null },
                { name: 'days_reserved', type: 'INTEGER', default: null }
            ];
            
            for (const col of columnsToAdd) {
                try {
                    // 先檢查欄位是否存在
                    const checkResult = await query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'bookings' 
                        AND column_name = $1
                    `, [col.name]);
                    
                    if (!checkResult.rows || checkResult.rows.length === 0) {
                        // 欄位不存在，添加它
                        const defaultClause = col.default !== null ? `DEFAULT ${col.default}` : '';
                        await query(`ALTER TABLE bookings ADD COLUMN ${col.name} ${col.type} ${defaultClause}`);
                        console.log(`✅ 已添加 ${col.name} 欄位`);
                    }
                    // 如果欄位已存在，靜默跳過（不顯示訊息）
                } catch (err) {
                    // 如果檢查失敗，嘗試直接添加（兼容舊邏輯）
                    try {
                        const defaultClause = col.default !== null ? `DEFAULT ${col.default}` : '';
                        await query(`ALTER TABLE bookings ADD COLUMN ${col.name} ${col.type} ${defaultClause}`);
                        console.log(`✅ 已添加 ${col.name} 欄位`);
                    } catch (addErr) {
                        // 如果錯誤訊息包含 "already exists"，靜默處理
                        if (!addErr.message || (!addErr.message.includes('already exists') && !addErr.message.includes('duplicate column'))) {
                            console.warn(`⚠️  添加 ${col.name} 欄位時發生錯誤:`, addErr.message);
                        }
                    }
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
                    max_occupancy INTEGER DEFAULT 0,
                    extra_beds INTEGER DEFAULT 0,
                    icon VARCHAR(255) DEFAULT '🏠',
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 房型設定表已準備就緒');
            
            // 檢查並添加欄位（如果不存在）- holiday_surcharge, max_occupancy, extra_beds 已在 CREATE TABLE 中定義
            // 但為了兼容舊資料表，仍需要檢查並添加（如果不存在）
            const roomTypeColumnsToAdd = [
                { name: 'holiday_surcharge', type: 'INTEGER', default: '0' },
                { name: 'max_occupancy', type: 'INTEGER', default: '0' },
                { name: 'extra_beds', type: 'INTEGER', default: '0' }
            ];
            
            for (const col of roomTypeColumnsToAdd) {
                try {
                    // 先檢查欄位是否存在
                    const checkResult = await query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'room_types' 
                        AND column_name = $1
                    `, [col.name]);
                    
                    if (!checkResult.rows || checkResult.rows.length === 0) {
                        // 欄位不存在，添加它
                        await query(`ALTER TABLE room_types ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`);
                        console.log(`✅ 已添加 ${col.name} 欄位`);
                    }
                    // 如果欄位已存在，靜默跳過（不顯示訊息）
                } catch (err) {
                    // 如果檢查失敗，嘗試直接添加（兼容舊邏輯）
                    try {
                        await query(`ALTER TABLE room_types ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`);
                        console.log(`✅ 已添加 ${col.name} 欄位`);
                    } catch (addErr) {
                        // 如果錯誤訊息包含 "already exists"，靜默處理
                        if (!addErr.message || (!addErr.message.includes('already exists') && !addErr.message.includes('duplicate column'))) {
                            console.warn(`⚠️  添加 ${col.name} 欄位時發生錯誤:`, addErr.message);
                        }
                    }
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
            
            // 建立加購商品表
            await query(`
                CREATE TABLE IF NOT EXISTS addons (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    display_name VARCHAR(255) NOT NULL,
                    price INTEGER NOT NULL,
                    icon VARCHAR(255) DEFAULT '➕',
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 加購商品表已準備就緒');
            
            // 初始化預設加購商品
            const defaultAddons = [
                ['extra_bed', '加床', 500, '🛏️', 1],
                ['breakfast', '早餐', 200, '🍳', 2],
                ['afternoon_tea', '下午茶', 300, '☕', 3],
                ['dinner', '晚餐', 600, '🍽️', 4],
                ['bbq', '烤肉', 800, '🔥', 5],
                ['spa', 'SPA', 1000, '💆', 6]
            ];
            
            for (const [name, displayName, price, icon, displayOrder] of defaultAddons) {
                try {
                    const existing = await queryOne('SELECT id FROM addons WHERE name = $1', [name]);
                    if (!existing) {
                        await query(
                            'INSERT INTO addons (name, display_name, price, icon, display_order) VALUES ($1, $2, $3, $4, $5)',
                            [name, displayName, price, icon, displayOrder]
                        );
                    }
                } catch (err) {
                    console.warn(`⚠️  初始化加購商品 ${name} 失敗:`, err.message);
                }
            }
            console.log('✅ 預設加購商品已初始化');
            
            // 初始化預設房型
            const roomCount = await queryOne('SELECT COUNT(*) as count FROM room_types');
            if (roomCount && parseInt(roomCount.count) === 0) {
                const defaultRooms = [
                    ['standard', '標準雙人房', 2000, 2, 0, '🏠', 1],
                    ['deluxe', '豪華雙人房', 3500, 2, 0, '✨', 2],
                    ['suite', '尊爵套房', 5000, 2, 0, '👑', 3],
                    ['family', '家庭四人房', 4500, 4, 0, '👨‍👩‍👧‍👦', 4]
                ];
                
                for (const room of defaultRooms) {
                    await query(
                        'INSERT INTO room_types (name, display_name, price, max_occupancy, extra_beds, icon, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
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
                ['enable_addons', '1', '啟用前台加購商品功能（1=啟用，0=停用）'],
                ['account_name', '', '帳戶戶名'],
                ['enable_transfer', '1', '啟用匯款轉帳（1=啟用，0=停用）'],
                ['enable_card', '1', '啟用線上刷卡（1=啟用，0=停用）'],
                ['ecpay_merchant_id', '', '綠界商店代號（MerchantID）'],
                ['ecpay_hash_key', '', '綠界金鑰（HashKey）'],
                ['ecpay_hash_iv', '', '綠界向量（HashIV）'],
                ['hotel_name', '', '旅館名稱（顯示在郵件最下面）'],
                ['hotel_phone', '', '旅館電話（顯示在郵件最下面）'],
                ['hotel_address', '', '旅館地址（顯示在郵件最下面）'],
                ['hotel_email', '', '旅館信箱（顯示在郵件最下面）'],
                ['admin_email', process.env.ADMIN_EMAIL || 'cheng701107@gmail.com', '管理員通知信箱（新訂房通知郵件會寄到此信箱）'],
                ['weekday_settings', JSON.stringify({ weekdays: [1, 2, 3, 4, 5] }), '平日/假日設定（JSON 格式：{"weekdays": [1,2,3,4,5]}，預設週一到週五為平日）'],
                ['checkin_reminder_transport', '<p style="margin: 0 0 15px 0; font-size: 17px; font-weight: 600;">地址：{{hotelAddress}}</p>\n<div style="margin-bottom: 15px;">\n    <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">大眾運輸：</p>\n    <ul style="margin: 0; padding-left: 25px;">\n        <li>捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>\n        <li>公車：搭乘 20、32、46 路公車至「信義行政中心站」</li>\n    </ul>\n</div>\n<div>\n    <p style="margin: 8px 0; font-size: 16px; font-weight: 600;">自行開車：</p>\n    <ul style="margin: 0; padding-left: 25px;">\n        <li>國道一號：下「信義交流道」，沿信義路直行約3公里</li>\n        <li>國道三號：下「木柵交流道」，接信義快速道路</li>\n    </ul>\n</div>', '入住提醒郵件 - 交通路線內容（HTML格式）'],
                ['checkin_reminder_parking', '<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>\n<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>\n<ul style="margin: 0 0 12px 0; padding-left: 25px;">\n    <li>住宿客人：每日 NT$ 200（可無限次進出）</li>\n    <li>臨時停車：每小時 NT$ 50</li>\n</ul>\n<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24 小時</p>\n<p style="margin: 0; font-size: 15px; color: #666;">⚠️ 停車位有限，建議提前預約</p>', '入住提醒郵件 - 停車資訊內容（HTML格式）'],
                ['checkin_reminder_notes', '<ul style="margin: 0; padding-left: 25px;">\n    <li>入住時間：<strong>下午 3:00 後</strong></li>\n    <li>退房時間：<strong>上午 11:00 前</strong></li>\n    <li>請攜帶身分證件辦理入住手續</li>\n    <li>房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>\n    <li>請保持安靜，避免影響其他住客</li>\n    <li>貴重物品請妥善保管，建議使用房間保險箱</li>\n    <li>如需延遲退房，請提前告知櫃檯</li>\n</ul>', '入住提醒郵件 - 入住注意事項內容（HTML格式）']
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
                    block_settings TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // 添加 block_settings 欄位（如果不存在）
            try {
                await query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS block_settings TEXT`);
            } catch (e) {
                // 欄位可能已存在，忽略錯誤
            }
            console.log('✅ 郵件模板表已準備就緒');
            
            // 建立管理員資料表
            await query(`
                CREATE TABLE IF NOT EXISTS admins (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    email VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'admin',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP,
                    is_active INTEGER DEFAULT 1
                )
            `);
            console.log('✅ 管理員資料表已準備就緒');
            
            // 建立操作日誌資料表
            await query(`
                CREATE TABLE IF NOT EXISTS admin_logs (
                    id SERIAL PRIMARY KEY,
                    admin_id INTEGER,
                    admin_username VARCHAR(255),
                    action VARCHAR(100) NOT NULL,
                    resource_type VARCHAR(100),
                    resource_id VARCHAR(255),
                    details TEXT,
                    ip_address VARCHAR(255),
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 操作日誌資料表已準備就緒');
            
            // 初始化預設管理員（如果不存在）
            const defaultAdmin = await queryOne('SELECT id FROM admins WHERE username = $1', ['admin']);
            if (!defaultAdmin) {
                const bcrypt = require('bcrypt');
                const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
                const passwordHash = await bcrypt.hash(defaultPassword, 10);
                await query(
                    'INSERT INTO admins (username, password_hash, email, role) VALUES ($1, $2, $3, $4)',
                    ['admin', passwordHash, process.env.ADMIN_EMAIL || '', 'super_admin']
                );
                console.log('✅ 預設管理員已建立（帳號：admin，密碼：' + defaultPassword + '）');
                console.log('⚠️  請立即登入並修改預設密碼！');
            }
            
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
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        h2 { color: #333; font-size: 20px; margin-top: 25px; margin-bottom: 15px; }
        h3 { color: #333; font-size: 18px; margin-top: 20px; margin-bottom: 10px; }
        p { margin: 10px 0; }
        strong { color: #333; }
        ul, ol { margin: 10px 0; padding-left: 30px; }
        li { margin: 5px 0; }
    </style>
</head>
<body>
    <h1>⏰ 匯款期限提醒</h1>
    
    <p>親愛的 {{guestName}} 您好，</p>
    <p>感謝您選擇我們的住宿服務！</p>
    
    <h2>⚠️ 重要提醒</h2>
    <p>此訂房將為您保留 {{daysReserved}} 天，請於 <strong>{{paymentDeadline}}前</strong>完成匯款，逾期將自動取消訂房。</p>
    
    <h2>訂房資訊</h2>
    <p><strong>訂房編號：</strong>{{bookingId}}</p>
    <p><strong>入住日期：</strong>{{checkInDate}}</p>
    <p><strong>退房日期：</strong>{{checkOutDate}}</p>
    <p><strong>房型：</strong>{{roomType}}</p>
    {{#if addonsList}}
    <p><strong>加購商品：</strong>{{addonsList}}</p>
    <p><strong>加購商品總額：</strong>NT$ {{addonsTotal}}</p>
    {{/if}}
    <p><strong>總金額：</strong>NT$ {{totalAmount}}</p>
    <p><strong>應付金額：</strong>NT$ {{finalAmount}}</p>
    
    <h2>💰 匯款資訊</h2>
    <p><strong>銀行：</strong>{{bankName}}{{bankBranchDisplay}}</p>
    <p><strong>帳號：</strong>{{bankAccount}}</p>
    <p><strong>戶名：</strong>{{accountName}}</p>
    <p>請在匯款時備註訂房編號後5碼：<strong>{{bookingId}}</strong></p>
    
    {{#if isDeposit}}
    <h2>💡 剩餘尾款</h2>
    <p>剩餘尾款於現場付清！</p>
    <p><strong>剩餘尾款：</strong>NT$ {{remainingAmount}}</p>
    {{/if}}
    
    <p>如有任何問題，請隨時與我們聯繫。</p>
    <p>感謝您的配合！</p>
    
    {{hotelInfoFooter}}
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
            <p class="intro-text">感謝您選擇我們的住宿服務！我們期待您明天的到來。</p>
            
            {{#if showBookingInfo}}
            <div class="info-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 20px;">📅 訂房資訊</div>
                {{bookingInfoContent}}
            </div>
            {{/if}}
            
            {{#if showTransport}}
            <div class="info-section">
                <div class="info-section-title">📍 交通路線</div>
                {{checkinTransport}}
            </div>
            {{/if}}
            
            {{#if showParking}}
            <div class="info-section">
                <div class="info-section-title">🅿️ 停車資訊</div>
                {{checkinParking}}
            </div>
            {{/if}}
            
            {{#if showNotes}}
            <div class="highlight-box">
                <div class="section-title" style="margin-top: 0; margin-bottom: 15px; color: #856404;">⚠️ 入住注意事項</div>
                {{checkinNotes}}
            </div>
            {{/if}}
            
            {{#if showContact}}
            <div class="info-section">
                <div class="info-section-title">📞 聯絡資訊</div>
                {{checkinContact}}
            </div>
            {{/if}}
            
            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">期待您的到來，祝您住宿愉快！</p>
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
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4caf50; }
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
        .info-section { background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 25px 0; }
        .info-section-title { font-size: 20px; font-weight: bold; color: #2e7d32; margin: 0 0 15px 0; }
        .rating-section { background: #fff9c4; border: 2px solid #fbc02d; border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center; }
        .rating-stars { font-size: 32px; margin: 15px 0; }
        .google-review-btn { display: inline-block; background: #1a73e8; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-size: 17px; font-weight: 700; margin-top: 15px; transition: background 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); letter-spacing: 0.5px; }
        .google-review-btn:hover { background: #1557b0; box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
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
                <a href="{{googleReviewUrl}}" target="_blank" class="google-review-btn">在 Google 上給我們評價</a>
                {{/if}}
                <p style="margin: 15px 0 0 0; font-size: 15px; color: #666; line-height: 1.6;">您的評價將幫助其他旅客做出更好的選擇，也讓我們能持續改進服務品質</p>
            </div>
            
            <div class="info-section">
                <div class="info-section-title">💬 意見回饋</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如果您有任何建議、意見或需要協助，歡迎隨時透過以下方式與我們聯繫：</p>
                <div style="background: white; padding: 15px; border-radius: 6px; margin-bottom: 12px;">
                    <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #2e7d32;">📧 Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                    <p style="margin: 0; font-size: 16px;"><strong style="color: #2e7d32;">📞 電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                </div>
                <p style="margin: 0; font-size: 15px; color: #2e7d32; font-weight: 600;">我們會認真聆聽您的意見，並持續改進服務品質！</p>
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
            enabled: 1,
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
                <p style="color: #2e7d32; font-weight: 600; margin: 0 0 12px 0; font-size: 17px;">剩餘尾款於現場付清！</p>
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

            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">感謝您的預訂，期待為您服務！</p>
            <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px; padding-top: 20px; border-top: 1px solid #e0e0e0;">此為系統自動發送郵件，請勿直接回覆</p>
        </div>
    </div>
</body>
</html>`,
            enabled: 1
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
                <div class="info-row">
                    <span class="info-label">支付方式</span>
                    <span class="info-value">{{paymentAmount}} - {{paymentMethod}}</span>
                </div>
                <div class="info-row" style="border-bottom: none;">
                    <span class="info-label">訂房時間</span>
                    <span class="info-value">{{bookingDate}}</span>
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
</html>`,
            enabled: 1
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
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        h2 { color: #333; font-size: 20px; margin-top: 25px; margin-bottom: 15px; }
        h3 { color: #333; font-size: 18px; margin-top: 20px; margin-bottom: 10px; }
        p { margin: 10px 0; }
        strong { color: #333; }
        ul, ol { margin: 10px 0; padding-left: 30px; }
        li { margin: 5px 0; }
    </style>
</head>
<body>
    <h1>✅ 付款完成確認</h1>
    <p>感謝您的付款！</p>
    
    <p>親愛的 {{guestName}}，</p>
    <p>我們已確認收到您的付款，以下是您的訂房與付款資訊：</p>
    
    <h2>訂房與付款資訊</h2>
    <p><strong>訂房編號：</strong>{{bookingId}}</p>
    <p><strong>入住日期：</strong>{{checkInDate}}</p>
    <p><strong>退房日期：</strong>{{checkOutDate}}</p>
    <p><strong>房型：</strong>{{roomType}}</p>
    <p><strong>總金額：</strong>NT$ {{totalAmount}}</p>
    <p><strong>本次已收金額：</strong>NT$ {{finalAmount}}</p>
    <p><strong>付款方式：</strong>{{paymentMethod}}</p>
    
    <p>若您後續仍需變更或取消訂房，請儘早與我們聯繫，我們將盡力協助您。</p>
    
    <p>再次感謝您的預訂，期待您的光臨！</p>
    <p>此為系統自動發送郵件，請勿直接回覆</p>
    
    {{hotelInfoFooter}}
</body>
</html>`,
            enabled: 1
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
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; font-size: 24px; margin-bottom: 20px; }
        h2 { color: #333; font-size: 20px; margin-top: 25px; margin-bottom: 15px; }
        h3 { color: #333; font-size: 18px; margin-top: 20px; margin-bottom: 10px; }
        p { margin: 10px 0; }
        strong { color: #333; }
        ul, ol { margin: 10px 0; padding-left: 30px; }
        li { margin: 5px 0; }
    </style>
</head>
<body>
    <h1>⚠️ 訂房已自動取消</h1>
    <p>很抱歉，您的訂房因超過保留期限已自動取消</p>
    
    <p>親愛的 {{guestName}}，</p>
    <p>很抱歉通知您，由於超過匯款保留期限，您的訂房已自動取消。以下是取消的訂房資訊：</p>
    
    <h2>取消的訂房資訊</h2>
    <p><strong>訂房編號：</strong>{{bookingId}}</p>
    <p><strong>入住日期：</strong>{{checkInDate}}</p>
    <p><strong>退房日期：</strong>{{checkOutDate}}</p>
    <p><strong>住宿天數：</strong>{{nights}} 晚</p>
    <p><strong>房型：</strong>{{roomType}}</p>
    <p><strong>訂房日期：</strong>{{bookingDate}}</p>
    <p><strong>應付金額：</strong>NT$ {{finalAmount}}</p>

    <h2>📌 取消原因</h2>
    <p>此訂房因超過匯款保留期限（{{bookingDate}} 起算），且未在期限內完成付款，系統已自動取消。</p>

    <h2>💡 如需重新訂房</h2>
    <p>如果您仍希望預訂，歡迎重新進行訂房。如有任何疑問，請隨時與我們聯繫。</p>

    {{hotelInfoFooter}}
</body>
</html>`,
            enabled: 1
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
                    adults INTEGER DEFAULT 0,
                    children INTEGER DEFAULT 0,
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
                                max_occupancy INTEGER DEFAULT 0,
                                extra_beds INTEGER DEFAULT 0,
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
                                    
                                    db.run(`ALTER TABLE room_types ADD COLUMN max_occupancy INTEGER DEFAULT 0`, (err) => {
                                        if (err && !err.message.includes('duplicate column')) {
                                            console.warn('⚠️  添加 max_occupancy 欄位時發生錯誤:', err.message);
                                        } else {
                                            console.log('✅ 已添加 max_occupancy 欄位');
                                        }
                                        
                                        db.run(`ALTER TABLE room_types ADD COLUMN extra_beds INTEGER DEFAULT 0`, (err) => {
                                            if (err && !err.message.includes('duplicate column')) {
                                                console.warn('⚠️  添加 extra_beds 欄位時發生錯誤:', err.message);
                                            } else {
                                                console.log('✅ 已添加 extra_beds 欄位');
                                            }
                                        });
                                    });
                                    
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
                                        
                                        // 建立加購商品表
                                        db.run(`
                                            CREATE TABLE IF NOT EXISTS addons (
                                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                    name TEXT UNIQUE NOT NULL,
                                                    display_name TEXT NOT NULL,
                                                    price INTEGER NOT NULL,
                                                    icon TEXT DEFAULT '➕',
                                                    display_order INTEGER DEFAULT 0,
                                                    is_active INTEGER DEFAULT 1,
                                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                )
                                        `, (err) => {
                                                if (err) {
                                                    console.warn('⚠️  建立 addons 表時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 加購商品表已準備就緒');
                                                    
                                                    // 初始化預設加購商品
                                                    const defaultAddons = [
                                                        ['extra_bed', '加床', 500, '🛏️', 1],
                                                        ['breakfast', '早餐', 200, '🍳', 2],
                                                        ['afternoon_tea', '下午茶', 300, '☕', 3],
                                                        ['dinner', '晚餐', 600, '🍽️', 4],
                                                        ['bbq', '烤肉', 800, '🔥', 5],
                                                        ['spa', 'SPA', 1000, '💆', 6]
                                                    ];
                                                    
                                                    let addonCount = 0;
                                                    defaultAddons.forEach(([name, displayName, price, icon, displayOrder]) => {
                                                        db.get('SELECT id FROM addons WHERE name = ?', [name], (err, row) => {
                                                            if (!err && !row) {
                                                                db.run(
                                                                    'INSERT INTO addons (name, display_name, price, icon, display_order) VALUES (?, ?, ?, ?, ?)',
                                                                    [name, displayName, price, icon, displayOrder],
                                                                    (err) => {
                                                                        if (!err) {
                                                                            addonCount++;
                                                                            if (addonCount === defaultAddons.length) {
                                                                                console.log('✅ 預設加購商品已初始化');
                                                                            }
                                                                        }
                                                                    }
                                                                );
                                                            }
                                                        });
                                                    });
                                                }
                                                
                                                // 繼續後續初始化：為 bookings 加上 addons / addons_total 欄位
                                                db.run(`ALTER TABLE bookings ADD COLUMN addons TEXT`, (err) => {
                                                    if (err && !err.message.includes('duplicate column')) {
                                                        console.warn('⚠️  新增 addons 欄位時發生錯誤:', err.message);
                                                    }
                                                    db.run(`ALTER TABLE bookings ADD COLUMN addons_total INTEGER DEFAULT 0`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 addons_total 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN payment_deadline TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 payment_deadline 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN days_reserved INTEGER`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 days_reserved 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                });
                                            });
                                        
                                        // 初始化預設房型（如果表是空的）
                                        db.get('SELECT COUNT(*) as count FROM room_types', [], (err, row) => {
                                            if (!err && row && row.count === 0) {
                                                const defaultRooms = [
                                                    ['standard', '標準雙人房', 2000, 2, 0, '🏠', 1],
                                                    ['deluxe', '豪華雙人房', 3500, 2, 0, '✨', 2],
                                                    ['suite', '尊爵套房', 5000, 2, 0, '👑', 3],
                                                    ['family', '家庭四人房', 4500, 4, 0, '👨‍👩‍👧‍👦', 4]
                                                ];
                                                
                                                const stmt = db.prepare('INSERT INTO room_types (name, display_name, price, max_occupancy, extra_beds, icon, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
                                                defaultRooms.forEach(room => {
                                                    stmt.run(room);
                                                });
                                                stmt.finalize();
                                                console.log('✅ 預設房型已初始化');
                                            }
                                        });
                                    });
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
                                        ['enable_addons', '1', '啟用前台加購商品功能（1=啟用，0=停用）'],
                                        ['ecpay_merchant_id', '', '綠界商店代號（MerchantID）'],
                                        ['ecpay_hash_key', '', '綠界金鑰（HashKey）'],
                                        ['ecpay_hash_iv', '', '綠界向量（HashIV）'],
                                        ['hotel_name', '', '旅館名稱（顯示在郵件最下面）'],
                                        ['hotel_phone', '', '旅館電話（顯示在郵件最下面）'],
                                        ['hotel_address', '', '旅館地址（顯示在郵件最下面）'],
                                        ['hotel_email', '', '旅館信箱（顯示在郵件最下面）'],
                                        ['admin_email', process.env.ADMIN_EMAIL || 'cheng701107@gmail.com', '管理員通知信箱（新訂房通知郵件會寄到此信箱）'],
                                        ['weekday_settings', JSON.stringify({ weekdays: [1, 2, 3, 4, 5] }), '平日/假日設定（JSON 格式：{"weekdays": [1,2,3,4,5]}，預設週一到週五為平日）'],
                                        ['checkin_reminder_transport', '<p style="margin: 0 0 15px 0; font-size: 17px; font-weight: 600;">地址：{{hotelAddress}}</p>\n<div style="margin-bottom: 15px;">\n    <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">大眾運輸：</p>\n    <ul style="margin: 0; padding-left: 25px;">\n        <li>捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>\n        <li>公車：搭乘 20、32、46 路公車至「信義行政中心站」</li>\n    </ul>\n</div>\n<div>\n    <p style="margin: 8px 0; font-size: 16px; font-weight: 600;">自行開車：</p>\n    <ul style="margin: 0; padding-left: 25px;">\n        <li>國道一號：下「信義交流道」，沿信義路直行約3公里</li>\n        <li>國道三號：下「木柵交流道」，接信義快速道路</li>\n    </ul>\n</div>', '入住提醒郵件 - 交通路線內容（HTML格式）'],
                                        ['checkin_reminder_parking', '<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場位置：</strong>B1-B3 地下停車場</p>\n<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車費用：</strong></p>\n<ul style="margin: 0 0 12px 0; padding-left: 25px;">\n    <li>住宿客人：每日 NT$ 200（可無限次進出）</li>\n    <li>臨時停車：每小時 NT$ 50</li>\n</ul>\n<p style="margin: 0 0 8px 0; font-size: 16px;"><strong>停車場開放時間：</strong>24 小時</p>\n<p style="margin: 0; font-size: 15px; color: #666;">⚠️ 停車位有限，建議提前預約</p>', '入住提醒郵件 - 停車資訊內容（HTML格式）'],
                                        ['checkin_reminder_notes', '<ul style="margin: 0; padding-left: 25px;">\n    <li>入住時間：<strong>下午 3:00 後</strong></li>\n    <li>退房時間：<strong>上午 11:00 前</strong></li>\n    <li>請攜帶身分證件辦理入住手續</li>\n    <li>房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>\n    <li>請保持安靜，避免影響其他住客</li>\n    <li>貴重物品請妥善保管，建議使用房間保險箱</li>\n    <li>如需延遲退房，請提前告知櫃檯</li>\n</ul>', '入住提醒郵件 - 入住注意事項內容（HTML格式）']
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
                                            block_settings TEXT,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `, (err) => {
                                        if (err) {
                                            console.warn('⚠️  建立 email_templates 表時發生錯誤:', err.message);
                                            // 即使建立失敗，也繼續初始化
                                            initEmailTemplates().then(() => {
                                                resolve();
                                            }).catch(reject);
                                        } else {
                                            console.log('✅ 郵件模板表已準備就緒');
                                            
                                            // 添加 block_settings 欄位（如果不存在）
                                            db.run(`ALTER TABLE email_templates ADD COLUMN block_settings TEXT`, (alterErr) => {
                                                if (alterErr && !alterErr.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 block_settings 欄位時發生錯誤:', alterErr.message);
                                                }
                                                // 繼續初始化
                                                initEmailTemplates().then(() => {
                                                    resolve();
                                                }).catch(reject);
                                            });
                                            return; // 提前返回，避免重複執行
                                        }
                                        
                                        // 建立管理員資料表
                                            db.run(`
                                                CREATE TABLE IF NOT EXISTS admins (
                                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                    username TEXT UNIQUE NOT NULL,
                                                    password_hash TEXT NOT NULL,
                                                    email TEXT,
                                                    role TEXT DEFAULT 'admin',
                                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                    last_login DATETIME,
                                                    is_active INTEGER DEFAULT 1
                                                )
                                            `, (err) => {
                                                if (err) {
                                                    console.warn('⚠️  建立 admins 表時發生錯誤:', err.message);
                                                    // 繼續初始化，不中斷流程
                                                    initEmailTemplates().then(() => {
                                                        resolve();
                                                    }).catch(reject);
                                                } else {
                                                    console.log('✅ 管理員資料表已準備就緒');
                                                    
                                                    // 建立操作日誌資料表
                                                    db.run(`
                                                        CREATE TABLE IF NOT EXISTS admin_logs (
                                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                            admin_id INTEGER,
                                                            admin_username TEXT,
                                                            action TEXT NOT NULL,
                                                            resource_type TEXT,
                                                            resource_id TEXT,
                                                            details TEXT,
                                                            ip_address TEXT,
                                                            user_agent TEXT,
                                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                        )
                                                    `, (err) => {
                                                        if (err) {
                                                            console.warn('⚠️  建立 admin_logs 表時發生錯誤:', err.message);
                                                        } else {
                                                            console.log('✅ 操作日誌資料表已準備就緒');
                                                        }
                                                    });
                                                    
                                                    // 初始化預設管理員（如果不存在）
                                                    db.get('SELECT id FROM admins WHERE username = ?', ['admin'], (err, row) => {
                                                        if (!err && !row) {
                                                            // 使用 Promise 處理 bcrypt
                                                            const bcrypt = require('bcrypt');
                                                            const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
                                                            bcrypt.hash(defaultPassword, 10).then((passwordHash) => {
                                                                db.run(
                                                                    'INSERT INTO admins (username, password_hash, email, role) VALUES (?, ?, ?, ?)',
                                                                    ['admin', passwordHash, process.env.ADMIN_EMAIL || '', 'super_admin'],
                                                                    (err) => {
                                                                        if (err) {
                                                                            console.warn('⚠️  建立預設管理員時發生錯誤:', err.message);
                                                                        } else {
                                                                            console.log('✅ 預設管理員已建立（帳號：admin，密碼：' + defaultPassword + '）');
                                                                            console.log('⚠️  請立即登入並修改預設密碼！');
                                                                        }
                                                                        // 繼續初始化郵件模板
                                                                        initEmailTemplates().then(() => {
                                                                            resolve();
                                                                        }).catch(reject);
                                                                    }
                                                                );
                                                            }).catch((hashErr) => {
                                                                console.warn('⚠️  加密密碼時發生錯誤:', hashErr.message);
                                                                // 繼續初始化，不中斷流程
                                                                initEmailTemplates().then(() => {
                                                                    resolve();
                                                                }).catch(reject);
                                                            });
                                                        } else {
                                                            // 管理員已存在，繼續初始化郵件模板
                                                            initEmailTemplates().then(() => {
                                                                resolve();
                                                            }).catch(reject);
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    });
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
                adults, children,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status, addons, addons_total,
                payment_deadline, days_reserved
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
            RETURNING id
        ` : `
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                guest_name, guest_phone, guest_email,
                adults, children,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status, addons, addons_total,
                payment_deadline, days_reserved
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const addonsJson = bookingData.addons ? JSON.stringify(bookingData.addons) : null;
        const addonsTotal = bookingData.addonsTotal || 0;
        
        const values = [
            bookingData.bookingId,
            bookingData.checkInDate,
            bookingData.checkOutDate,
            bookingData.roomType,
            bookingData.guestName,
            bookingData.guestPhone,
            bookingData.guestEmail,
            bookingData.adults || 0,
            bookingData.children || 0,
            bookingData.paymentAmount,
            bookingData.paymentMethod,
            bookingData.pricePerNight,
            bookingData.nights,
            bookingData.totalAmount,
            bookingData.finalAmount,
            bookingData.bookingDate,
            bookingData.emailSent || '0',  // 支援字串格式（郵件類型）或 '0'（未發送）
            bookingData.paymentStatus || 'pending',
            bookingData.status || 'active',
            bookingData.addons ? JSON.stringify(bookingData.addons) : null,
            bookingData.addonsTotal || 0,
            bookingData.paymentDeadline || null,
            bookingData.daysReserved || null
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

// 統計資料（可選日期區間）
async function getStatistics(startDate, endDate) {
    try {
        const hasRange = !!(startDate && endDate);

        let totalSql, revenueSql, byRoomTypeSql, recentSql;
        let params = [];

        if (usePostgreSQL) {
            const whereClause = hasRange ? ' WHERE created_at::date BETWEEN $1::date AND $2::date' : '';
            totalSql = `SELECT COUNT(*) as count FROM bookings${whereClause}`;
            revenueSql = `SELECT SUM(final_amount) as total FROM bookings${whereClause}`;
            byRoomTypeSql = `SELECT room_type, COUNT(*) as count FROM bookings${whereClause} GROUP BY room_type`;

            if (hasRange) {
                recentSql = `SELECT COUNT(*) as count FROM bookings WHERE created_at::date BETWEEN $1::date AND $2::date`;
                params = [startDate, endDate];
            } else {
                recentSql = `SELECT COUNT(*) as count FROM bookings WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`;
            }
        } else {
            const whereClause = hasRange ? ' WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)' : '';
            totalSql = `SELECT COUNT(*) as count FROM bookings${whereClause}`;
            revenueSql = `SELECT SUM(final_amount) as total FROM bookings${whereClause}`;
            byRoomTypeSql = `SELECT room_type, COUNT(*) as count FROM bookings${whereClause} GROUP BY room_type`;

            if (hasRange) {
                recentSql = `SELECT COUNT(*) as count FROM bookings WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)`;
                params = [startDate, endDate];
            } else {
                recentSql = `SELECT COUNT(*) as count FROM bookings WHERE created_at >= datetime('now', '-7 days')`;
            }
        }

        const totalPromise = hasRange ? queryOne(totalSql, params) : queryOne(totalSql);
        const revenuePromise = hasRange ? queryOne(revenueSql, params) : queryOne(revenueSql);
        const byRoomTypePromise = hasRange ? query(byRoomTypeSql, params) : query(byRoomTypeSql);
        const recentPromise = hasRange ? queryOne(recentSql, params) : queryOne(recentSql);

        const [totalResult, revenueResult, byRoomTypeResult, recentResult] = await Promise.all([
            totalPromise,
            revenuePromise,
            byRoomTypePromise,
            recentPromise
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

// ==================== 客戶管理 ====================

// 取得所有客戶（聚合訂房資料）
async function getAllCustomers() {
    try {
        const sql = usePostgreSQL
            ? `SELECT 
                guest_email,
                guest_name,
                guest_phone,
                COUNT(*) as booking_count,
                SUM(final_amount) as total_spent,
                MAX(created_at) as last_booking_date
            FROM bookings
            GROUP BY guest_email, guest_name, guest_phone
            ORDER BY last_booking_date DESC`
            : `SELECT 
                guest_email,
                guest_name,
                guest_phone,
                COUNT(*) as booking_count,
                SUM(final_amount) as total_spent,
                MAX(created_at) as last_booking_date
            FROM bookings
            GROUP BY guest_email, guest_name, guest_phone
            ORDER BY last_booking_date DESC`;
        
        const result = await query(sql);
        
        // 格式化日期
        return result.rows.map(customer => ({
            ...customer,
            last_booking_date: customer.last_booking_date 
                ? new Date(customer.last_booking_date).toLocaleDateString('zh-TW')
                : null,
            total_spent: parseInt(customer.total_spent || 0),
            booking_count: parseInt(customer.booking_count || 0)
        }));
    } catch (error) {
        console.error('❌ 查詢客戶列表失敗:', error.message);
        throw error;
    }
}

// 根據 Email 取得客戶詳情（包含所有訂房記錄）
async function getCustomerByEmail(email) {
    try {
        // 先取得客戶基本資訊
        const customerSQL = usePostgreSQL
            ? `SELECT 
                guest_email,
                guest_name,
                guest_phone,
                COUNT(*) as booking_count,
                SUM(final_amount) as total_spent,
                MAX(created_at) as last_booking_date
            FROM bookings
            WHERE guest_email = $1
            GROUP BY guest_email, guest_name, guest_phone`
            : `SELECT 
                guest_email,
                guest_name,
                guest_phone,
                COUNT(*) as booking_count,
                SUM(final_amount) as total_spent,
                MAX(created_at) as last_booking_date
            FROM bookings
            WHERE guest_email = ?
            GROUP BY guest_email, guest_name, guest_phone`;
        
        const customerResult = await queryOne(customerSQL, [email]);
        
        if (!customerResult) {
            return null;
        }
        
        // 取得該客戶的所有訂房記錄
        const bookings = await getBookingsByEmail(email);
        
        return {
            guest_email: customerResult.guest_email,
            guest_name: customerResult.guest_name,
            guest_phone: customerResult.guest_phone,
            booking_count: parseInt(customerResult.booking_count || 0),
            total_spent: parseInt(customerResult.total_spent || 0),
            last_booking_date: customerResult.last_booking_date 
                ? new Date(customerResult.last_booking_date).toLocaleDateString('zh-TW')
                : null,
            bookings: bookings
        };
    } catch (error) {
        console.error('❌ 查詢客戶詳情失敗:', error.message);
        throw error;
    }
}

// 更新客戶資料（更新所有該 email 的訂房記錄）
async function updateCustomer(email, updateData) {
    try {
        const { guest_name, guest_phone } = updateData;
        
        if (!guest_name && !guest_phone) {
            throw new Error('至少需要提供姓名或電話');
        }
        
        // 構建 SET 子句和參數值
        const setParts = [];
        const values = [];
        
        if (guest_name) {
            setParts.push(usePostgreSQL ? `guest_name = $${values.length + 1}` : 'guest_name = ?');
            values.push(guest_name);
        }
        
        if (guest_phone) {
            setParts.push(usePostgreSQL ? `guest_phone = $${values.length + 1}` : 'guest_phone = ?');
            values.push(guest_phone);
        }
        
        // 添加 WHERE 條件（email 參數）
        const whereClause = usePostgreSQL ? `WHERE guest_email = $${values.length + 1}` : 'WHERE guest_email = ?';
        values.push(email);
        
        // 構建完整的 SQL
        const sql = `UPDATE bookings SET ${setParts.join(', ')} ${whereClause}`;
        
        console.log('🔍 SQL:', sql);
        console.log('🔍 Values:', values);
        console.log('🔍 Email to update:', email);
        
        const result = await query(sql, values);
        const updatedCount = result.changes || result.rowCount || 0;
        console.log(`✅ 客戶資料已更新 (email: ${email}, 更新了 ${updatedCount} 筆訂房記錄)`);
        return updatedCount;
    } catch (error) {
        console.error('❌ 更新客戶資料失敗:', error.message);
        throw error;
    }
}

// 刪除客戶（僅在沒有訂房記錄時允許）
async function deleteCustomer(email) {
    try {
        // 檢查是否有訂房記錄
        const bookings = await getBookingsByEmail(email);
        
        if (bookings && bookings.length > 0) {
            throw new Error('該客戶有訂房記錄，無法刪除');
        }
        
        // 如果沒有訂房記錄，客戶資料會自動從聚合查詢中消失
        // 因為客戶資料是從 bookings 表中聚合出來的
        console.log(`✅ 客戶已刪除 (email: ${email})`);
        return true;
    } catch (error) {
        console.error('❌ 刪除客戶失敗:', error.message);
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
// 注意：此函數已被 isCustomWeekend() 取代，保留以向後兼容
function isWeekend(dateString) {
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 週日, 6 = 週六
}

// 檢查日期是否為假日（使用自訂的平日/假日設定）
async function isCustomWeekend(dateString) {
    try {
        // 取得平日/假日設定
        const settingsJson = await getSetting('weekday_settings');
        let weekdays = [1, 2, 3, 4, 5]; // 預設：週一到週五為平日
        
        if (settingsJson) {
            try {
                const settings = typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
                if (settings.weekdays && Array.isArray(settings.weekdays)) {
                    weekdays = settings.weekdays.map(d => parseInt(d));
                    console.log(`📅 使用自訂平日/假日設定: 平日為週 ${weekdays.join(', ')}`);
                }
            } catch (e) {
                console.warn('⚠️ 解析 weekday_settings 失敗，使用預設值:', e);
            }
        } else {
            console.log('📅 未找到 weekday_settings，使用預設值（週一到週五為平日）');
        }
        
        // 檢查該日期是星期幾
        const date = new Date(dateString);
        const day = date.getDay(); // 0 = 週日, 1 = 週一, ..., 6 = 週六
        
        // 如果該日期不在 weekdays 列表中，則為假日
        const isHoliday = !weekdays.includes(day);
        console.log(`📅 日期 ${dateString} 是週${['日', '一', '二', '三', '四', '五', '六'][day]}，${isHoliday ? '是' : '不是'}假日`);
        return isHoliday;
    } catch (error) {
        console.error('❌ 檢查自訂平日/假日設定失敗:', error.message);
        // 發生錯誤時，使用預設的週末判斷（週六、週日為假日）
        return isWeekend(dateString);
    }
}

// 檢查日期是否為假日（包括週末和手動設定的假日）
async function isHolidayOrWeekend(dateString, includeWeekend = true) {
    // 先檢查是否為手動設定的假日
    const isManualHoliday = await isHoliday(dateString);
    if (isManualHoliday) {
        return true;
    }
    
    // 如果包含週末，使用自訂的平日/假日設定來判斷
    if (includeWeekend) {
        return await isCustomWeekend(dateString);
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
            INSERT INTO room_types (name, display_name, price, holiday_surcharge, max_occupancy, extra_beds, icon, display_order, is_active) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        ` : `
            INSERT INTO room_types (name, display_name, price, holiday_surcharge, max_occupancy, extra_beds, icon, display_order, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            roomData.name,
            roomData.display_name,
            roomData.price,
            roomData.holiday_surcharge !== undefined ? roomData.holiday_surcharge : 0,
            roomData.max_occupancy !== undefined ? roomData.max_occupancy : 0,
            roomData.extra_beds !== undefined ? roomData.extra_beds : 0,
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
            SET display_name = $1, price = $2, holiday_surcharge = $3, max_occupancy = $4, extra_beds = $5, icon = $6, display_order = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
        ` : `
            UPDATE room_types 
            SET display_name = ?, price = ?, holiday_surcharge = ?, max_occupancy = ?, extra_beds = ?, icon = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        const values = [
            roomData.display_name,
            roomData.price,
            roomData.holiday_surcharge !== undefined ? roomData.holiday_surcharge : 0,
            roomData.max_occupancy !== undefined ? roomData.max_occupancy : 0,
            roomData.extra_beds !== undefined ? roomData.extra_beds : 0,
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
// 注意：此函數已被 isCustomWeekend() 取代，保留以向後兼容
function isWeekend(dateString) {
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 週日, 6 = 週六
}

// 檢查日期是否為假日（使用自訂的平日/假日設定）
async function isCustomWeekend(dateString) {
    try {
        // 取得平日/假日設定
        const settingsJson = await getSetting('weekday_settings');
        let weekdays = [1, 2, 3, 4, 5]; // 預設：週一到週五為平日
        
        if (settingsJson) {
            try {
                const settings = typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
                if (settings.weekdays && Array.isArray(settings.weekdays)) {
                    weekdays = settings.weekdays.map(d => parseInt(d));
                    console.log(`📅 使用自訂平日/假日設定: 平日為週 ${weekdays.join(', ')}`);
                }
            } catch (e) {
                console.warn('⚠️ 解析 weekday_settings 失敗，使用預設值:', e);
            }
        } else {
            console.log('📅 未找到 weekday_settings，使用預設值（週一到週五為平日）');
        }
        
        // 檢查該日期是星期幾
        const date = new Date(dateString);
        const day = date.getDay(); // 0 = 週日, 1 = 週一, ..., 6 = 週六
        
        // 如果該日期不在 weekdays 列表中，則為假日
        const isHoliday = !weekdays.includes(day);
        console.log(`📅 日期 ${dateString} 是週${['日', '一', '二', '三', '四', '五', '六'][day]}，${isHoliday ? '是' : '不是'}假日`);
        return isHoliday;
    } catch (error) {
        console.error('❌ 檢查自訂平日/假日設定失敗:', error.message);
        // 發生錯誤時，使用預設的週末判斷（週六、週日為假日）
        return isWeekend(dateString);
    }
}

// 檢查日期是否為假日（包括週末和手動設定的假日）
async function isHolidayOrWeekend(dateString, includeWeekend = true) {
    // 先檢查是否為手動設定的假日
    const isManualHoliday = await isHoliday(dateString);
    if (isManualHoliday) {
        return true;
    }
    
    // 如果包含週末，使用自訂的平日/假日設定來判斷
    if (includeWeekend) {
        return await isCustomWeekend(dateString);
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
        const { template_name, subject, content, is_enabled, days_before_checkin, send_hour_checkin, days_after_checkout, send_hour_feedback, days_reserved, send_hour_payment_reminder, block_settings } = data;
        
        console.log(`📝 資料庫更新郵件模板: ${templateKey}`);
        console.log(`   接收到的設定值:`, {
            days_before_checkin,
            send_hour_checkin,
            days_after_checkout,
            send_hour_feedback,
            days_reserved,
            send_hour_payment_reminder,
            block_settings: block_settings ? '已提供' : '未提供'
        });
        
        const sql = usePostgreSQL ? `
            UPDATE email_templates 
            SET template_name = $1, subject = $2, content = $3, is_enabled = $4,
                days_before_checkin = $5, send_hour_checkin = $6,
                days_after_checkout = $7, send_hour_feedback = $8,
                days_reserved = $9, send_hour_payment_reminder = $10,
                block_settings = $11,
                updated_at = CURRENT_TIMESTAMP 
            WHERE template_key = $12
        ` : `
            UPDATE email_templates 
            SET template_name = ?, subject = ?, content = ?, is_enabled = ?,
                days_before_checkin = ?, send_hour_checkin = ?,
                days_after_checkout = ?, send_hour_feedback = ?,
                days_reserved = ?, send_hour_payment_reminder = ?,
                block_settings = ?,
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
            block_settings || null,
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
async function getBookingsForCheckinReminder(daysBeforeCheckin = 1) {
    try {
        // 使用本地時區計算目標日期（入住日期前 N 天）
        const now = new Date();
        const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBeforeCheckin);
        
        // 格式化為 YYYY-MM-DD（使用本地時區）
        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const targetDateStr = `${year}-${month}-${day}`;
        
        console.log(`📅 查詢入住提醒訂房 - 目標日期: ${targetDateStr} (入住日期前 ${daysBeforeCheckin} 天)`);
        console.log(`   當前時間: ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
        
        const sql = usePostgreSQL
            ? `SELECT * FROM bookings WHERE check_in_date = $1 AND status = 'active' AND payment_status = 'paid'`
            : `SELECT * FROM bookings WHERE check_in_date = ? AND status = 'active' AND payment_status = 'paid'`;
        
        const result = await query(sql, [targetDateStr]);
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
async function getBookingsForFeedbackRequest(daysAfterCheckout = 1) {
    try {
        // 使用本地時區計算目標日期（退房日期 + days_after_checkout 天前）
        const now = new Date();
        const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAfterCheckout);
        
        // 格式化為 YYYY-MM-DD（使用本地時區）
        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const targetDateStr = `${year}-${month}-${day}`;
        
        console.log(`📅 查詢回訪信訂房 - 目標日期: ${targetDateStr} (退房日期後${daysAfterCheckout}天)`);
        console.log(`   當前時間: ${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
        
        const sql = usePostgreSQL
            ? `SELECT * FROM bookings WHERE check_out_date = $1 AND status = 'active'`
            : `SELECT * FROM bookings WHERE check_out_date = ? AND status = 'active'`;
        
        const result = await query(sql, [targetDateStr]);
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

// ==================== 加購商品管理 ====================

// 取得所有加購商品
async function getAllAddons() {
    try {
        const sql = `SELECT * FROM addons WHERE is_active = 1 ORDER BY display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢加購商品失敗:', error.message);
        throw error;
    }
}

// 取得所有加購商品（包含已停用的，供管理後台使用）
async function getAllAddonsAdmin() {
    try {
        const sql = `SELECT * FROM addons ORDER BY display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢加購商品失敗:', error.message);
        throw error;
    }
}

// 取得單一加購商品
async function getAddonById(id) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM addons WHERE id = $1`
            : `SELECT * FROM addons WHERE id = ?`;
        return await queryOne(sql, [id]);
    } catch (error) {
        console.error('❌ 查詢加購商品失敗:', error.message);
        throw error;
    }
}

// 新增加購商品
async function createAddon(addonData) {
    try {
        const sql = usePostgreSQL
            ? `INSERT INTO addons (name, display_name, price, icon, display_order, is_active) 
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
            : `INSERT INTO addons (name, display_name, price, icon, display_order, is_active) 
               VALUES (?, ?, ?, ?, ?, ?)`;
        
        const values = [
            addonData.name,
            addonData.display_name,
            addonData.price,
            addonData.icon || '➕',
            addonData.display_order || 0,
            addonData.is_active !== undefined ? addonData.is_active : 1
        ];
        
        const result = await query(sql, values);
        return result.lastID || result.rows[0]?.id;
    } catch (error) {
        console.error('❌ 新增加購商品失敗:', error.message);
        throw error;
    }
}

// 更新加購商品
async function updateAddon(id, addonData) {
    try {
        const sql = usePostgreSQL
            ? `UPDATE addons SET display_name = $1, price = $2, icon = $3, display_order = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`
            : `UPDATE addons SET display_name = ?, price = ?, icon = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        
        const values = [
            addonData.display_name,
            addonData.price,
            addonData.icon || '➕',
            addonData.display_order || 0,
            addonData.is_active !== undefined ? addonData.is_active : 1,
            id
        ];
        
        await query(sql, values);
        return true;
    } catch (error) {
        console.error('❌ 更新加購商品失敗:', error.message);
        throw error;
    }
}

// 刪除加購商品
async function deleteAddon(id) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM addons WHERE id = $1`
            : `DELETE FROM addons WHERE id = ?`;
        
        const result = await query(sql, [id]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 刪除加購商品失敗:', error.message);
        throw error;
    }
}

async function getRoomAvailability(checkInDate, checkOutDate) {
    try {
        // 根據訂房狀態判斷前台的滿房房型
        // 當訂房狀態為 'active'（有效）或 'reserved'（保留）時，顯示滿房
        const sql = usePostgreSQL ? `
            SELECT DISTINCT rt.name
            FROM bookings b
            INNER JOIN room_types rt ON b.room_type = rt.display_name
            WHERE b.check_in_date::date < $2::date
              AND b.check_out_date::date > $1::date
              AND b.status IN ('active', 'reserved')
        ` : `
            SELECT DISTINCT rt.name
            FROM bookings b
            INNER JOIN room_types rt ON b.room_type = rt.display_name
            WHERE b.check_in_date < ?
              AND b.check_out_date > ?
              AND b.status IN ('active', 'reserved')
        `;

        const params = usePostgreSQL ? [checkInDate, checkOutDate] : [checkInDate, checkOutDate];
        const result = await query(sql, params);
        const rows = result.rows || result;
        const unavailableRooms = rows.map(r => r.name);
        return unavailableRooms || [];
    } catch (error) {
        console.error('❌ 查詢房間可用性失敗:', error.message);
        throw error;
    }
}

// 取得指定日期範圍內的訂房資料（供日曆視圖使用）
async function getBookingsInRange(startDate, endDate) {
    try {
        const sql = usePostgreSQL ? `
            SELECT booking_id, room_type, check_in_date, check_out_date, status, guest_name
            FROM bookings
            WHERE check_in_date::date <= $2::date
              AND check_out_date::date >= $1::date
              AND status IN ('active', 'reserved', 'cancelled')
            ORDER BY check_in_date, room_type
        ` : `
            SELECT booking_id, room_type, check_in_date, check_out_date, status, guest_name
            FROM bookings
            WHERE DATE(check_in_date) <= DATE(?)
              AND DATE(check_out_date) >= DATE(?)
              AND status IN ('active', 'reserved', 'cancelled')
            ORDER BY check_in_date, room_type
        `;
        const params = usePostgreSQL ? [startDate, endDate] : [startDate, endDate];
        const result = await query(sql, params);
        return result.rows || result;
    } catch (error) {
        console.error('❌ 查詢日期範圍訂房失敗:', error.message);
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

// ==================== 管理員管理 ====================

// 根據帳號查詢管理員
async function getAdminByUsername(username) {
    try {
        const sql = usePostgreSQL 
            ? `SELECT * FROM admins WHERE username = $1 AND is_active = 1`
            : `SELECT * FROM admins WHERE username = ? AND is_active = 1`;
        return await queryOne(sql, [username]);
    } catch (error) {
        console.error('❌ 查詢管理員失敗:', error.message);
        throw error;
    }
}

// 驗證管理員密碼
async function verifyAdminPassword(username, password) {
    try {
        const admin = await getAdminByUsername(username);
        if (!admin) {
            return null;
        }
        
        const bcrypt = require('bcrypt');
        const isValid = await bcrypt.compare(password, admin.password_hash);
        
        if (isValid) {
            // 更新最後登入時間
            await updateAdminLastLogin(admin.id);
            return admin;
        }
        
        return null;
    } catch (error) {
        console.error('❌ 驗證管理員密碼失敗:', error.message);
        throw error;
    }
}

// 更新管理員最後登入時間
async function updateAdminLastLogin(adminId) {
    try {
        const sql = usePostgreSQL 
            ? `UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1`
            : `UPDATE admins SET last_login = datetime('now') WHERE id = ?`;
        await query(sql, [adminId]);
    } catch (error) {
        console.error('❌ 更新管理員最後登入時間失敗:', error.message);
        // 不拋出錯誤，因為這不是關鍵操作
    }
}

// 修改管理員密碼
async function updateAdminPassword(adminId, newPassword) {
    try {
        const bcrypt = require('bcrypt');
        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        const sql = usePostgreSQL 
            ? `UPDATE admins SET password_hash = $1 WHERE id = $2`
            : `UPDATE admins SET password_hash = ? WHERE id = ?`;
        
        const result = await query(sql, [passwordHash, adminId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 修改管理員密碼失敗:', error.message);
        throw error;
    }
}

// ==================== 操作日誌管理 ====================

// 記錄管理員操作
async function logAdminAction(actionData) {
    try {
        const {
            adminId,
            adminUsername,
            action,
            resourceType,
            resourceId,
            details,
            ipAddress,
            userAgent
        } = actionData;
        
        const sql = usePostgreSQL
            ? `INSERT INTO admin_logs (admin_id, admin_username, action, resource_type, resource_id, details, ip_address, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
            : `INSERT INTO admin_logs (admin_id, admin_username, action, resource_type, resource_id, details, ip_address, user_agent)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const detailsJson = details ? JSON.stringify(details) : null;
        
        await query(sql, [
            adminId || null,
            adminUsername || null,
            action,
            resourceType || null,
            resourceId || null,
            detailsJson,
            ipAddress || null,
            userAgent || null
        ]);
        
        return true;
    } catch (error) {
        console.error('❌ 記錄操作日誌失敗:', error.message);
        // 不拋出錯誤，避免影響主要功能
        return false;
    }
}

// 取得操作日誌列表
async function getAdminLogs(options = {}) {
    try {
        const {
            limit = 100,
            offset = 0,
            adminId = null,
            action = null,
            resourceType = null,
            startDate = null,
            endDate = null
        } = options;
        
        let sql = usePostgreSQL
            ? `SELECT * FROM admin_logs WHERE 1=1`
            : `SELECT * FROM admin_logs WHERE 1=1`;
        const params = [];
        let paramIndex = 1;
        
        if (adminId) {
            sql += usePostgreSQL ? ` AND admin_id = $${paramIndex}` : ` AND admin_id = ?`;
            params.push(adminId);
            paramIndex++;
        }
        
        if (action) {
            sql += usePostgreSQL ? ` AND action = $${paramIndex}` : ` AND action = ?`;
            params.push(action);
            paramIndex++;
        }
        
        if (resourceType) {
            sql += usePostgreSQL ? ` AND resource_type = $${paramIndex}` : ` AND resource_type = ?`;
            params.push(resourceType);
            paramIndex++;
        }
        
        if (startDate) {
            sql += usePostgreSQL ? ` AND created_at >= $${paramIndex}` : ` AND created_at >= ?`;
            params.push(startDate);
            paramIndex++;
        }
        
        if (endDate) {
            sql += usePostgreSQL ? ` AND created_at <= $${paramIndex}` : ` AND created_at <= ?`;
            params.push(endDate);
            paramIndex++;
        }
        
        sql += usePostgreSQL
            ? ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
            : ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        
        const result = await query(sql, params);
        const logs = result.rows || [];
        
        // 解析 details JSON
        return logs.map(log => ({
            ...log,
            details: log.details ? JSON.parse(log.details) : null
        }));
    } catch (error) {
        console.error('❌ 查詢操作日誌失敗:', error.message);
        throw error;
    }
}

// 取得操作日誌總數
async function getAdminLogsCount(options = {}) {
    try {
        const {
            adminId = null,
            action = null,
            resourceType = null,
            startDate = null,
            endDate = null
        } = options;
        
        let sql = usePostgreSQL
            ? `SELECT COUNT(*) as count FROM admin_logs WHERE 1=1`
            : `SELECT COUNT(*) as count FROM admin_logs WHERE 1=1`;
        const params = [];
        let paramIndex = 1;
        
        if (adminId) {
            sql += usePostgreSQL ? ` AND admin_id = $${paramIndex}` : ` AND admin_id = ?`;
            params.push(adminId);
            paramIndex++;
        }
        
        if (action) {
            sql += usePostgreSQL ? ` AND action = $${paramIndex}` : ` AND action = ?`;
            params.push(action);
            paramIndex++;
        }
        
        if (resourceType) {
            sql += usePostgreSQL ? ` AND resource_type = $${paramIndex}` : ` AND resource_type = ?`;
            params.push(resourceType);
            paramIndex++;
        }
        
        if (startDate) {
            sql += usePostgreSQL ? ` AND created_at >= $${paramIndex}` : ` AND created_at >= ?`;
            params.push(startDate);
            paramIndex++;
        }
        
        if (endDate) {
            sql += usePostgreSQL ? ` AND created_at <= $${paramIndex}` : ` AND created_at <= ?`;
            params.push(endDate);
            paramIndex++;
        }
        
        const result = await queryOne(sql, params);
        return parseInt(result.count) || 0;
    } catch (error) {
        console.error('❌ 查詢操作日誌總數失敗:', error.message);
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
    initEmailTemplates,
    // 自動郵件查詢
    getBookingsForPaymentReminder,
    getBookingsForCheckinReminder,
    getBookingsForFeedbackRequest,
    // 房間可用性
    getRoomAvailability,
    getBookingsInRange,
    // 過期保留訂房
    getBookingsExpiredReservation,
    // 客戶管理
    getAllCustomers,
    getCustomerByEmail,
    updateCustomer,
    deleteCustomer,
    // 加購商品管理
    getAllAddons,
    getAllAddonsAdmin,
    getAddonById,
    createAddon,
    updateAddon,
    deleteAddon,
    // 管理員管理
    getAdminByUsername,
    verifyAdminPassword,
    updateAdminLastLogin,
    updateAdminPassword,
    // 操作日誌
    logAdminAction,
    getAdminLogs,
    getAdminLogsCount,
    // 個資保護
    anonymizeCustomerData,
    deleteCustomerData,
    // PostgreSQL 連接池（供 session store 使用）
    getPgPool: () => pgPool,
    usePostgreSQL
};

// ==================== 個資保護功能 ====================

// 匿名化客戶資料（符合法規要求，保留部分資料用於會計）
async function anonymizeCustomerData(email) {
    try {
        // 匿名化姓名、電話、Email
        const anonymizedName = email[0] + '*'.repeat(Math.max(1, email.length - 1));
        const anonymizedPhone = '09********';
        const anonymizedEmail = email.split('@')[0][0] + '***@' + email.split('@')[1];
        
        const sql = usePostgreSQL
            ? `UPDATE bookings 
               SET guest_name = $1, 
                   guest_phone = $2, 
                   guest_email = $3,
                   status = 'deleted'
               WHERE guest_email = $4`
            : `UPDATE bookings 
               SET guest_name = ?, 
                   guest_phone = ?, 
                   guest_email = ?,
                   status = 'deleted'
               WHERE guest_email = ?`;
        
        await query(sql, [anonymizedName, anonymizedPhone, anonymizedEmail, email]);
        
        console.log(`✅ 已匿名化客戶資料: ${email}`);
        return true;
    } catch (error) {
        console.error('❌ 匿名化客戶資料失敗:', error.message);
        throw error;
    }
}

// 刪除客戶資料（完全刪除，僅在特殊情況下使用）
async function deleteCustomerData(email) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM bookings WHERE guest_email = $1`
            : `DELETE FROM bookings WHERE guest_email = ?`;
        
        const result = await query(sql, [email]);
        
        console.log(`✅ 已刪除客戶資料: ${email}`);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 刪除客戶資料失敗:', error.message);
        throw error;
    }
}

