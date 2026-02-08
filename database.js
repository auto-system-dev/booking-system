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
            
            // 新增 line_user_id 欄位（如果不存在）
            try {
                await query(`
                    ALTER TABLE bookings 
                    ADD COLUMN IF NOT EXISTS line_user_id VARCHAR(255)
                `);
                console.log('✅ line_user_id 欄位已準備就緒');
            } catch (err) {
                if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
                    console.warn('⚠️  新增 line_user_id 欄位時發生錯誤:', err.message);
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
                    image_url TEXT DEFAULT NULL,
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
                { name: 'extra_beds', type: 'INTEGER', default: '0' },
                { name: 'image_url', type: 'TEXT', default: "NULL" }
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
                ['weekday_settings', JSON.stringify({ weekdays: [1, 2, 3, 4, 5] }), '平日/假日設定（JSON 格式：{"weekdays": [1,2,3,4,5]}，預設週一到週五為平日）']
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
            
            // 建立會員等級表
            await query(`
                CREATE TABLE IF NOT EXISTS member_levels (
                    id SERIAL PRIMARY KEY,
                    level_name VARCHAR(255) NOT NULL,
                    min_spent INTEGER DEFAULT 0,
                    min_bookings INTEGER DEFAULT 0,
                    discount_percent DECIMAL(5,2) DEFAULT 0,
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 會員等級表已準備就緒');
            
            // 初始化預設會員等級
            const defaultLevels = [
                ['新會員', 0, 0, 0, 1],
                ['銀卡會員', 10000, 3, 5, 2],
                ['金卡會員', 30000, 10, 10, 3],
                ['鑽石會員', 80000, 25, 15, 4]
            ];
            
            for (const [levelName, minSpent, minBookings, discountPercent, displayOrder] of defaultLevels) {
                try {
                    const existing = await queryOne('SELECT id FROM member_levels WHERE level_name = $1', [levelName]);
                    if (!existing) {
                        await query(
                            'INSERT INTO member_levels (level_name, min_spent, min_bookings, discount_percent, display_order) VALUES ($1, $2, $3, $4, $5)',
                            [levelName, minSpent, minBookings, discountPercent, displayOrder]
                        );
                    }
                } catch (err) {
                    console.warn(`⚠️  初始化會員等級 ${levelName} 失敗:`, err.message);
                }
            }
            console.log('✅ 預設會員等級已初始化');
            
            // 建立優惠代碼表
            await query(`
                CREATE TABLE IF NOT EXISTS promo_codes (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(50) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    discount_type VARCHAR(20) NOT NULL,
                    discount_value DECIMAL(10,2) NOT NULL,
                    min_spend INTEGER DEFAULT 0,
                    max_discount INTEGER DEFAULT NULL,
                    applicable_room_types TEXT,
                    total_usage_limit INTEGER DEFAULT NULL,
                    per_user_limit INTEGER DEFAULT 1,
                    start_date DATE,
                    end_date DATE,
                    is_active INTEGER DEFAULT 1,
                    can_combine_with_early_bird INTEGER DEFAULT 0,
                    can_combine_with_late_bird INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 優惠代碼表已準備就緒');
            
            // 建立優惠代碼使用記錄表
            await query(`
                CREATE TABLE IF NOT EXISTS promo_code_usages (
                    id SERIAL PRIMARY KEY,
                    promo_code_id INTEGER NOT NULL,
                    booking_id VARCHAR(255) NOT NULL,
                    guest_email VARCHAR(255) NOT NULL,
                    discount_amount DECIMAL(10,2) NOT NULL,
                    original_amount DECIMAL(10,2) NOT NULL,
                    final_amount DECIMAL(10,2) NOT NULL,
                    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE
                )
            `);
            console.log('✅ 優惠代碼使用記錄表已準備就緒');
            
            // ==================== 權限管理系統 ====================
            
            // 建立角色表
            await query(`
                CREATE TABLE IF NOT EXISTS roles (
                    id SERIAL PRIMARY KEY,
                    role_name VARCHAR(50) UNIQUE NOT NULL,
                    display_name VARCHAR(100) NOT NULL,
                    description TEXT,
                    is_system_role INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 角色表已準備就緒');
            
            // 建立權限表
            await query(`
                CREATE TABLE IF NOT EXISTS permissions (
                    id SERIAL PRIMARY KEY,
                    permission_code VARCHAR(100) UNIQUE NOT NULL,
                    permission_name VARCHAR(100) NOT NULL,
                    module VARCHAR(50) NOT NULL,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 權限表已準備就緒');
            
            // 建立角色權限關聯表
            await query(`
                CREATE TABLE IF NOT EXISTS role_permissions (
                    id SERIAL PRIMARY KEY,
                    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(role_id, permission_id)
                )
            `);
            console.log('✅ 角色權限關聯表已準備就緒');
            
            // 更新 admins 表，添加 role_id 欄位（如果不存在）
            const adminColumnsToAdd = [
                { name: 'role_id', type: 'INTEGER', default: null },
                { name: 'department', type: 'VARCHAR(100)', default: null },
                { name: 'phone', type: 'VARCHAR(20)', default: null },
                { name: 'notes', type: 'TEXT', default: null }
            ];
            
            for (const col of adminColumnsToAdd) {
                try {
                    const checkResult = await query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'admins' 
                        AND column_name = $1
                    `, [col.name]);
                    
                    if (!checkResult.rows || checkResult.rows.length === 0) {
                        const defaultClause = col.default !== null ? `DEFAULT ${col.default}` : '';
                        await query(`ALTER TABLE admins ADD COLUMN ${col.name} ${col.type} ${defaultClause}`);
                        console.log(`✅ admins 表已添加 ${col.name} 欄位`);
                    }
                } catch (err) {
                    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
                        console.warn(`⚠️  添加 admins.${col.name} 欄位時發生錯誤:`, err.message);
                    }
                }
            }
            
            // 初始化預設角色和權限
            await initRolesAndPermissions();
            
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
            </div>
            
            {{#if isDeposit}}
            <div class="remaining-box">
                <h2 style="margin-top: 0; color: #2e7d32;">💡 剩餘尾款於現場付清！</h2>
                <p style="margin: 10px 0 0 0; color: #2e7d32; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}
            
            <p style="margin-top: 30px;">如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
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
                <div style="background: white; padding: 15px; border-radius: 6px; margin-bottom: 12px;">
                    <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #1976d2;">📧 Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                    <p style="margin: 0; font-size: 16px;"><strong style="color: #1976d2;">📞 電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                </div>
                <p style="margin: 0; font-size: 15px; color: #1976d2; font-weight: 600;">期待您的到來，祝您住宿愉快！</p>
            </div>
            {{/if}}
            
            <p style="margin-top: 35px; font-size: 18px; font-weight: 600; text-align: center; color: #333;">期待您的到來，祝您住宿愉快！</p>
            <p style="margin-top: 12px; font-size: 16px; text-align: center; color: #666; line-height: 1.8;">祝您 身體健康，萬事如意</p>
            <p style="margin-top: 8px; font-size: 15px; text-align: center; color: #999;">感謝您的支持與信任</p>
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
            
            <p style="margin-top: 35px; font-size: 17px; font-weight: 500;">再次感謝您的預訂，期待您的光臨！</p>
            <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px; padding-top: 20px; border-top: 1px solid #e0e0e0;">此為系統自動發送郵件，請勿直接回覆</p>
            
            {{hotelInfoFooter}}
        </div>
    </div>
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
            </div>

            {{hotelInfoFooter}}
        </div>
    </div>
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
            
            // 對於入住提醒模板，檢查是否缺少完整的 HTML 結構或格式不正確
            let needsUpdateForHtmlStructure = false;
            if (template.key === 'checkin_reminder' && existing && existing.content && existing.content.trim() !== '') {
                const hasFullHtmlStructure = existing.content.includes('<!DOCTYPE html>') || 
                                           (existing.content.includes('<html') && existing.content.includes('</html>'));
                const hasStyleTag = existing.content.includes('<style>') || existing.content.includes('<style ');
                const hasBodyTag = existing.content.includes('<body>') || existing.content.includes('<body ');
                
                // 檢查是否使用正確的格式（檢查關鍵的 CSS 類別和結構）
                const hasCorrectFormat = existing.content.includes('font-size: 17px; font-weight: 500') && 
                                        existing.content.includes('祝您 身體健康，萬事如意') &&
                                        existing.content.includes('font-size: 16px; text-align: center; color: #666');
                
                // 如果缺少完整的 HTML 結構或格式不正確，需要更新
                if (!hasFullHtmlStructure || !hasStyleTag || !hasBodyTag || !hasCorrectFormat) {
                    console.log(`⚠️ 入住提醒模板需要更新為最新格式`);
                    console.log(`   缺少 DOCTYPE: ${!hasFullHtmlStructure}`);
                    console.log(`   缺少 style 標籤: ${!hasStyleTag}`);
                    console.log(`   缺少 body 標籤: ${!hasBodyTag}`);
                    console.log(`   格式不正確: ${!hasCorrectFormat}`);
                    needsUpdateForHtmlStructure = true;
                }
            }
            
            // 對於入住提醒和匯款提醒模板，強制更新以確保使用最新格式
            const forceUpdateCheckinReminder = template.key === 'checkin_reminder';
            const forceUpdatePaymentReminder = template.key === 'payment_reminder';
            
            // 檢查匯款提醒模板是否需要更新（檢查是否缺少圖卡樣式結構）
            let needsUpdateForPaymentReminder = false;
            if (template.key === 'payment_reminder' && existing && existing.content && existing.content.trim() !== '') {
                const hasCardStructure = existing.content.includes('class="container') || existing.content.includes("class='container") ||
                                         existing.content.includes('class="header') || existing.content.includes("class='header") ||
                                         existing.content.includes('class="content') || existing.content.includes("class='content");
                if (!hasCardStructure) {
                    needsUpdateForPaymentReminder = true;
                    console.log(`⚠️ 匯款提醒模板缺少圖卡樣式結構，需要更新`);
                }
            }
            
            if (!existing || !existing.content || existing.content.trim() === '' || existing.template_name !== template.name || isContentTooShort || needsUpdateForHtmlStructure || forceUpdateCheckinReminder || forceUpdatePaymentReminder || needsUpdateForPaymentReminder) {
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
                
                if (forceUpdateCheckinReminder) {
                    console.log(`✅ 已重新生成入住提醒模板為最新的圖卡格式`);
                } else if (existing && (!existing.content || existing.content.trim() === '')) {
                    console.log(`✅ 已更新空的郵件模板 ${template.key}`);
                } else if (existing && existing.template_name !== template.name) {
                    console.log(`✅ 已更新郵件模板名稱 ${template.key}: ${existing.template_name} -> ${template.name}`);
                } else if (isContentTooShort) {
                    console.log(`✅ 已還原郵件模板 ${template.key} 的完整內容（原內容長度: ${existing.content.length}, 新內容長度: ${template.content.length}）`);
                } else if (needsUpdateForHtmlStructure) {
                    console.log(`✅ 已更新入住提醒模板為完整的圖卡格式（包含完整的 HTML 和 CSS）`);
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
                        }
                        
                        // 第三個 ALTER TABLE - 新增 line_user_id 欄位
                        db.run(`ALTER TABLE bookings ADD COLUMN line_user_id TEXT`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.warn('⚠️  新增 line_user_id 欄位時發生錯誤:', err.message);
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
                                image_url TEXT DEFAULT NULL,
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
                                            
                                            db.run(`ALTER TABLE room_types ADD COLUMN image_url TEXT DEFAULT NULL`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 image_url 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 image_url 欄位');
                                                }
                                            });
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
                            });
                            
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
                                        ['weekday_settings', JSON.stringify({ weekdays: [1, 2, 3, 4, 5] }), '平日/假日設定（JSON 格式：{"weekdays": [1,2,3,4,5]}，預設週一到週五為平日）']
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
                                        
                                        function createAdminsTable() {
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
                                                    
                                                    // 建立會員等級表
                                                    db.run(`
                                                        CREATE TABLE IF NOT EXISTS member_levels (
                                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                            level_name TEXT NOT NULL,
                                                            min_spent INTEGER DEFAULT 0,
                                                            min_bookings INTEGER DEFAULT 0,
                                                            discount_percent REAL DEFAULT 0,
                                                            display_order INTEGER DEFAULT 0,
                                                            is_active INTEGER DEFAULT 1,
                                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                        )
                                                    `, (err) => {
                                                        if (err) {
                                                            console.warn('⚠️  建立 member_levels 表時發生錯誤:', err.message);
                                                        } else {
                                                            console.log('✅ 會員等級表已準備就緒');
                                                            
                                                            // 初始化預設會員等級
                                                            const defaultLevels = [
                                                                ['新會員', 0, 0, 0, 1],
                                                                ['銀卡會員', 10000, 3, 5, 2],
                                                                ['金卡會員', 30000, 10, 10, 3],
                                                                ['鑽石會員', 80000, 25, 15, 4]
                                                            ];
                                                            
                                                            let levelCount = 0;
                                                            defaultLevels.forEach(([levelName, minSpent, minBookings, discountPercent, displayOrder]) => {
                                                                db.get('SELECT id FROM member_levels WHERE level_name = ?', [levelName], (err, row) => {
                                                                    if (!err && !row) {
                                                                        db.run(
                                                                            'INSERT INTO member_levels (level_name, min_spent, min_bookings, discount_percent, display_order) VALUES (?, ?, ?, ?, ?)',
                                                                            [levelName, minSpent, minBookings, discountPercent, displayOrder],
                                                                            (err) => {
                                                                                if (!err) {
                                                                                    levelCount++;
                                                                                    if (levelCount === defaultLevels.length) {
                                                                                        console.log('✅ 預設會員等級已初始化');
                                                                                    }
                                                                                }
                                                                            }
                                                                        );
                                                                    }
                                                                });
                                                            });
                                                        }
                                                    });
                                                    
                                                    // 建立優惠代碼表
                                                    db.run(`
                                                        CREATE TABLE IF NOT EXISTS promo_codes (
                                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                            code TEXT UNIQUE NOT NULL,
                                                            name TEXT NOT NULL,
                                                            description TEXT,
                                                            discount_type TEXT NOT NULL,
                                                            discount_value REAL NOT NULL,
                                                            min_spend INTEGER DEFAULT 0,
                                                            max_discount INTEGER DEFAULT NULL,
                                                            applicable_room_types TEXT,
                                                            total_usage_limit INTEGER DEFAULT NULL,
                                                            per_user_limit INTEGER DEFAULT 1,
                                                            start_date DATE,
                                                            end_date DATE,
                                                            is_active INTEGER DEFAULT 1,
                                                            can_combine_with_early_bird INTEGER DEFAULT 0,
                                                            can_combine_with_late_bird INTEGER DEFAULT 0,
                                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                        )
                                                    `, (err) => {
                                                        if (err) {
                                                            console.warn('⚠️  建立 promo_codes 表時發生錯誤:', err.message);
                                                        } else {
                                                            console.log('✅ 優惠代碼表已準備就緒');
                                                            
                                                            // 建立優惠代碼使用記錄表
                                                            db.run(`
                                                                CREATE TABLE IF NOT EXISTS promo_code_usages (
                                                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                                    promo_code_id INTEGER NOT NULL,
                                                                    booking_id TEXT NOT NULL,
                                                                    guest_email TEXT NOT NULL,
                                                                    discount_amount REAL NOT NULL,
                                                                    original_amount REAL NOT NULL,
                                                                    final_amount REAL NOT NULL,
                                                                    used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                                    FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE
                                                                )
                                                            `, (err) => {
                                                                if (err) {
                                                                    console.warn('⚠️  建立 promo_code_usages 表時發生錯誤:', err.message);
                                                                } else {
                                                                    console.log('✅ 優惠代碼使用記錄表已準備就緒');
                                                                }
                                                            });
                                                        }
                                                    });
                                                    
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
                                                // 繼續建立管理員資料表
                                                createAdminsTable();
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
        });  // closes db.serialize
    });  // closes Promise (arrow function + Promise call)
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
                payment_deadline, days_reserved, line_user_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            RETURNING id
        ` : `
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                guest_name, guest_phone, guest_email,
                adults, children,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status, addons, addons_total,
                payment_deadline, days_reserved, line_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            bookingData.daysReserved || null,
            bookingData.lineUserId || null
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
        const booking = await queryOne(sql, [bookingId]);
        
        if (!booking) {
            return null;
        }
        
        // 查詢優惠代碼使用記錄
        const promoUsageSQL = usePostgreSQL
            ? `SELECT 
                pcu.discount_amount,
                pcu.original_amount,
                pcu.final_amount,
                pc.code as promo_code,
                pc.name as promo_code_name
               FROM promo_code_usages pcu
               JOIN promo_codes pc ON pcu.promo_code_id = pc.id
               WHERE pcu.booking_id = $1
               LIMIT 1`
            : `SELECT 
                pcu.discount_amount,
                pcu.original_amount,
                pcu.final_amount,
                pc.code as promo_code,
                pc.name as promo_code_name
               FROM promo_code_usages pcu
               JOIN promo_codes pc ON pcu.promo_code_id = pc.id
               WHERE pcu.booking_id = ?
               LIMIT 1`;
        
        const promoUsage = await queryOne(promoUsageSQL, [bookingId]);
        
        // 如果有使用優惠代碼，將資訊加入訂房資料
        if (promoUsage) {
            booking.promo_code = promoUsage.promo_code;
            booking.promo_code_name = promoUsage.promo_code_name;
            booking.discount_amount = parseFloat(promoUsage.discount_amount || 0);
            booking.original_amount = parseFloat(promoUsage.original_amount || booking.total_amount);
        }
        
        return booking;
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

        let totalSql, totalCheckedInSql, totalNotCheckedInSql;
        let revenueSql, revenuePaidSql, revenueUnpaidSql;
        let byRoomTypeSql;
        let transferSql, transferPaidSql, transferUnpaidSql;
        let cardSql, cardPaidSql, cardUnpaidSql;
        let params = [];

        if (usePostgreSQL) {
            // 使用入住日期（check_in_date）作為篩選條件，排除已取消的訂房
            const baseWhereClause = hasRange 
                ? ' WHERE check_in_date::date BETWEEN $1::date AND $2::date AND status != \'cancelled\''
                : ' WHERE status != \'cancelled\'';
            
            // 總訂房數
            totalSql = `SELECT COUNT(*) as count FROM bookings${baseWhereClause}`;
            
            // 總訂房數 - 已入住（check_in_date <= 今天）
            const checkedInWhereClause = hasRange 
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND check_in_date::date <= CURRENT_DATE AND status != 'cancelled'`
                : ` WHERE check_in_date::date <= CURRENT_DATE AND status != 'cancelled'`;
            totalCheckedInSql = `SELECT COUNT(*) as count FROM bookings${checkedInWhereClause}`;
            
            // 總訂房數 - 未入住（check_in_date > 今天）
            const notCheckedInWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND check_in_date::date > CURRENT_DATE AND status != 'cancelled'`
                : ` WHERE check_in_date::date > CURRENT_DATE AND status != 'cancelled'`;
            totalNotCheckedInSql = `SELECT COUNT(*) as count FROM bookings${notCheckedInWhereClause}`;
            
            // 總營收
            revenueSql = `SELECT SUM(total_amount) as total FROM bookings${baseWhereClause}`;
            
            // 總營收 - 已付款
            const revenuePaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_status = 'paid' AND status != 'cancelled'`
                : ` WHERE payment_status = 'paid' AND status != 'cancelled'`;
            revenuePaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenuePaidWhereClause}`;
            
            // 總營收 - 未付款
            const revenueUnpaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_status = 'pending' AND status != 'cancelled'`
                : ` WHERE payment_status = 'pending' AND status != 'cancelled'`;
            revenueUnpaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenueUnpaidWhereClause}`;
            
            byRoomTypeSql = `SELECT room_type, COUNT(*) as count FROM bookings${baseWhereClause} GROUP BY room_type`;
            
            // 匯款轉帳統計
            const transferBaseWhereClause = hasRange 
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_method LIKE '%匯款%' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND status != 'cancelled'`;
            transferSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferBaseWhereClause}`;
            
            // 匯款轉帳 - 已付款
            const transferPaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'`;
            transferPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferPaidWhereClause}`;
            
            // 匯款轉帳 - 未付款
            const transferUnpaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'`;
            transferUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferUnpaidWhereClause}`;
            
            // 線上刷卡統計
            const cardBaseWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'`;
            cardSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardBaseWhereClause}`;
            
            // 線上刷卡 - 已付款
            const cardPaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'`;
            cardPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardPaidWhereClause}`;
            
            // 線上刷卡 - 未付款
            const cardUnpaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'`;
            cardUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardUnpaidWhereClause}`;

            if (hasRange) {
                params = [startDate, endDate];
            }
        } else {
            // 使用入住日期（check_in_date）作為篩選條件，排除已取消的訂房
            const baseWhereClause = hasRange 
                ? ' WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND status != \'cancelled\''
                : ' WHERE status != \'cancelled\'';
            
            // 總訂房數
            totalSql = `SELECT COUNT(*) as count FROM bookings${baseWhereClause}`;
            
            // 總訂房數 - 已入住（check_in_date <= 今天）
            const checkedInWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND DATE(check_in_date) <= DATE('now') AND status != 'cancelled'`
                : ` WHERE DATE(check_in_date) <= DATE('now') AND status != 'cancelled'`;
            totalCheckedInSql = `SELECT COUNT(*) as count FROM bookings${checkedInWhereClause}`;
            
            // 總訂房數 - 未入住（check_in_date > 今天）
            const notCheckedInWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND DATE(check_in_date) > DATE('now') AND status != 'cancelled'`
                : ` WHERE DATE(check_in_date) > DATE('now') AND status != 'cancelled'`;
            totalNotCheckedInSql = `SELECT COUNT(*) as count FROM bookings${notCheckedInWhereClause}`;
            
            // 總營收
            revenueSql = `SELECT SUM(total_amount) as total FROM bookings${baseWhereClause}`;
            
            // 總營收 - 已付款
            const revenuePaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_status = 'paid' AND status != 'cancelled'`
                : ` WHERE payment_status = 'paid' AND status != 'cancelled'`;
            revenuePaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenuePaidWhereClause}`;
            
            // 總營收 - 未付款
            const revenueUnpaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_status = 'pending' AND status != 'cancelled'`
                : ` WHERE payment_status = 'pending' AND status != 'cancelled'`;
            revenueUnpaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenueUnpaidWhereClause}`;
            
            byRoomTypeSql = `SELECT room_type, COUNT(*) as count FROM bookings${baseWhereClause} GROUP BY room_type`;
            
            // 匯款轉帳統計
            const transferBaseWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_method LIKE '%匯款%' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND status != 'cancelled'`;
            transferSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferBaseWhereClause}`;
            
            // 匯款轉帳 - 已付款
            const transferPaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'`;
            transferPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferPaidWhereClause}`;
            
            // 匯款轉帳 - 未付款
            const transferUnpaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'`;
            transferUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferUnpaidWhereClause}`;
            
            // 線上刷卡統計
            const cardBaseWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'`;
            cardSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardBaseWhereClause}`;
            
            // 線上刷卡 - 已付款
            const cardPaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'`;
            cardPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardPaidWhereClause}`;
            
            // 線上刷卡 - 未付款
            const cardUnpaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'`;
            cardUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardUnpaidWhereClause}`;

            if (hasRange) {
                params = [startDate, endDate];
            }
        }

        // 執行所有查詢
        const promises = [
            hasRange ? queryOne(totalSql, params) : queryOne(totalSql),
            hasRange ? queryOne(totalCheckedInSql, params) : queryOne(totalCheckedInSql),
            hasRange ? queryOne(totalNotCheckedInSql, params) : queryOne(totalNotCheckedInSql),
            hasRange ? queryOne(revenueSql, params) : queryOne(revenueSql),
            hasRange ? queryOne(revenuePaidSql, params) : queryOne(revenuePaidSql),
            hasRange ? queryOne(revenueUnpaidSql, params) : queryOne(revenueUnpaidSql),
            hasRange ? query(byRoomTypeSql, params) : query(byRoomTypeSql),
            hasRange ? queryOne(transferSql, params) : queryOne(transferSql),
            hasRange ? queryOne(transferPaidSql, params) : queryOne(transferPaidSql),
            hasRange ? queryOne(transferUnpaidSql, params) : queryOne(transferUnpaidSql),
            hasRange ? queryOne(cardSql, params) : queryOne(cardSql),
            hasRange ? queryOne(cardPaidSql, params) : queryOne(cardPaidSql),
            hasRange ? queryOne(cardUnpaidSql, params) : queryOne(cardUnpaidSql)
        ];

        const [
            totalResult, totalCheckedInResult, totalNotCheckedInResult,
            revenueResult, revenuePaidResult, revenueUnpaidResult,
            byRoomTypeResult,
            transferResult, transferPaidResult, transferUnpaidResult,
            cardResult, cardPaidResult, cardUnpaidResult
        ] = await Promise.all(promises);
        
        return {
            totalBookings: parseInt(totalResult?.count || 0),
            totalBookingsDetail: {
                checkedIn: parseInt(totalCheckedInResult?.count || 0),
                notCheckedIn: parseInt(totalNotCheckedInResult?.count || 0)
            },
            totalRevenue: parseInt(revenueResult?.total || 0),
            totalRevenueDetail: {
                paid: parseInt(revenuePaidResult?.total || 0),
                unpaid: parseInt(revenueUnpaidResult?.total || 0)
            },
            byRoomType: byRoomTypeResult.rows || [],
            // 匯款轉帳統計
            transferBookings: {
                count: parseInt(transferResult?.count || 0),
                total: parseInt(transferResult?.total || 0),
                paid: {
                    count: parseInt(transferPaidResult?.count || 0),
                    total: parseInt(transferPaidResult?.total || 0)
                },
                unpaid: {
                    count: parseInt(transferUnpaidResult?.count || 0),
                    total: parseInt(transferUnpaidResult?.total || 0)
                }
            },
            // 線上刷卡統計
            cardBookings: {
                count: parseInt(cardResult?.count || 0),
                total: parseInt(cardResult?.total || 0),
                paid: {
                    count: parseInt(cardPaidResult?.count || 0),
                    total: parseInt(cardPaidResult?.total || 0)
                },
                unpaid: {
                    count: parseInt(cardUnpaidResult?.count || 0),
                    total: parseInt(cardUnpaidResult?.total || 0)
                }
            }
        };
    } catch (error) {
        console.error('❌ 查詢統計資料失敗:', error.message);
        throw error;
    }
}

// 取得上月和本月的營收比較統計
async function getMonthlyComparison() {
    try {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // 1-12
        
        // 計算本月第一天和最後一天（使用本地時區避免時區偏移）
        const thisMonthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        // currentMonth 是 1-12，Date 構造函數的月份參數是 0-11
        // 要獲取 currentMonth 月的最後一天，應該用 new Date(currentYear, currentMonth, 0)
        // 因為 currentMonth 是 1-12，在 Date 中就是索引 1-12（即2月到13月）
        // new Date(year, month, 0) 會返回 month 月的前一天
        // 例如：currentMonth = 2（二月），Date(2026, 2, 0) = 2026年2月28日 ✓
        // 例如：currentMonth = 1（一月），Date(2026, 1, 0) = 2026年1月31日 ✓
        // 例如：currentMonth = 12（十二月），Date(2026, 12, 0) = 2026年12月31日 ✓
        const thisMonthEndDate = new Date(currentYear, currentMonth, 0);
        // 使用本地時區格式化日期，避免 toISOString() 造成的時區偏移
        const thisMonthEndYear = thisMonthEndDate.getFullYear();
        const thisMonthEndMonth = String(thisMonthEndDate.getMonth() + 1).padStart(2, '0');
        const thisMonthEndDay = String(thisMonthEndDate.getDate()).padStart(2, '0');
        const thisMonthEnd = `${thisMonthEndYear}-${thisMonthEndMonth}-${thisMonthEndDay}`;
        
        // 計算上月第一天和最後一天（使用本地時區避免時區偏移）
        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
        const lastMonthStart = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}-01`;
        // lastMonth 是 1-12，Date 構造函數的月份參數是 0-11
        // 要獲取 lastMonth 月的最後一天，應該用 new Date(lastMonthYear, lastMonth, 0)
        // 例如：lastMonth = 1（一月），Date(2026, 1, 0) = 2026年1月31日 ✓
        // 例如：lastMonth = 12（十二月），Date(2025, 12, 0) = 2025年12月31日 ✓
        const lastMonthEndDate = new Date(lastMonthYear, lastMonth, 0);
        // 使用本地時區格式化日期，避免 toISOString() 造成的時區偏移
        const lastMonthEndYear = lastMonthEndDate.getFullYear();
        const lastMonthEndMonth = String(lastMonthEndDate.getMonth() + 1).padStart(2, '0');
        const lastMonthEndDay = String(lastMonthEndDate.getDate()).padStart(2, '0');
        const lastMonthEnd = `${lastMonthEndYear}-${lastMonthEndMonth}-${lastMonthEndDay}`;
        
        console.log(`📅 本月範圍: ${thisMonthStart} ~ ${thisMonthEnd}`);
        console.log(`📅 上月範圍: ${lastMonthStart} ~ ${lastMonthEnd}`);
        
        // 驗證日期參數
        if (!thisMonthStart || !thisMonthEnd || !lastMonthStart || !lastMonthEnd) {
            throw new Error('日期參數計算錯誤：部分日期為空');
        }
        console.log('✅ 日期參數驗證通過');
        
        // 取得總房間數（從系統設定或預設值）
        let totalRooms = 10; // 預設10間房
        try {
            const totalRoomsSetting = await getSetting('total_rooms');
            if (totalRoomsSetting) {
                totalRooms = parseInt(totalRoomsSetting) || 10;
            }
            console.log(`🏠 總房間數: ${totalRooms}`);
        } catch (error) {
            console.warn('⚠️ 取得總房間數設定失敗，使用預設值 10:', error.message);
        }
        
        console.log(`📊 開始查詢月度比較統計 (資料庫類型: ${usePostgreSQL ? 'PostgreSQL' : 'SQLite'})`);
        
        if (usePostgreSQL) {
            // 本月統計 - 以入住日期（check_in_date）為準，不是訂房日期（created_at 或 booking_date）
            const thisMonthSql = `
                SELECT 
                    COUNT(*) as booking_count,
                    COALESCE(SUM(total_amount), 0) as total_revenue,
                    COUNT(DISTINCT check_in_date) as unique_dates
                FROM bookings
                WHERE check_in_date::date BETWEEN $1::date AND $2::date
                AND status != 'cancelled'
            `;
            
            // 上月統計 - 以入住日期（check_in_date）為準，不是訂房日期（created_at 或 booking_date）
            const lastMonthSql = `
                SELECT 
                    COUNT(*) as booking_count,
                    COALESCE(SUM(total_amount), 0) as total_revenue,
                    COUNT(DISTINCT check_in_date) as unique_dates
                FROM bookings
                WHERE check_in_date::date BETWEEN $1::date AND $2::date
                AND status != 'cancelled'
            `;
            
            // 輸出實際的SQL語句和參數以便調試
            console.log(`🔍 執行上月統計查詢:`);
            console.log(`   SQL: ${lastMonthSql}`);
            console.log(`   參數: [${lastMonthStart}, ${lastMonthEnd}]`);
            
            const [thisMonthResult, lastMonthResult] = await Promise.all([
                query(thisMonthSql, [thisMonthStart, thisMonthEnd]).then(r => r.rows[0] || null),
                query(lastMonthSql, [lastMonthStart, lastMonthEnd]).then(r => r.rows[0] || null)
            ]);
            
            console.log(`📊 本月統計查詢參數: ${thisMonthStart} ~ ${thisMonthEnd}`);
            console.log(`📊 本月統計結果:`, thisMonthResult);
            console.log(`📊 上月統計查詢參數: ${lastMonthStart} ~ ${lastMonthEnd}`);
            console.log(`📊 上月統計結果:`, lastMonthResult);
            
            // 查詢實際的訂房記錄以確認（以入住日期 check_in_date 為準）
            const debugLastMonthSql = `
                SELECT booking_id, check_in_date, check_out_date, total_amount, status
                FROM bookings
                WHERE check_in_date::date BETWEEN $1::date AND $2::date
                AND status != 'cancelled'
                ORDER BY check_in_date
            `;
            const debugLastMonthResult = await query(debugLastMonthSql, [lastMonthStart, lastMonthEnd]);
            console.log(`🔍 上月實際查詢到的訂房記錄 (${debugLastMonthResult?.rows?.length || 0} 筆):`);
            if (debugLastMonthResult?.rows && debugLastMonthResult.rows.length > 0) {
                debugLastMonthResult.rows.forEach(booking => {
                    console.log(`   - ${booking.booking_id}: 入住 ${booking.check_in_date}, 退房 ${booking.check_out_date}, 金額 ${booking.total_amount}, 狀態 ${booking.status}`);
                });
            } else {
                console.log(`   (無訂房記錄)`);
            }
            
            // 計算本月平日和假日的房間夜數（包含跨月份的訂房）
            const thisMonthBookingsSql = `
                SELECT check_in_date, check_out_date, nights
                FROM bookings
                WHERE (check_in_date::date <= $2::date AND check_out_date::date > $1::date)
                AND status != 'cancelled'
            `;
            
            // 計算上月平日和假日的房間夜數（包含跨月份的訂房）
            const lastMonthBookingsSql = `
                SELECT check_in_date, check_out_date, nights
                FROM bookings
                WHERE (check_in_date::date <= $2::date AND check_out_date::date > $1::date)
                AND status != 'cancelled'
            `;
            
            console.log('📊 查詢本月和上月的訂房記錄...');
            console.log(`   本月查詢範圍: ${thisMonthStart} ~ ${thisMonthEnd}`);
            console.log(`   上月查詢範圍: ${lastMonthStart} ~ ${lastMonthEnd}`);
            const [thisMonthBookings, lastMonthBookings] = await Promise.all([
                query(thisMonthBookingsSql, [thisMonthStart, thisMonthEnd]),
                query(lastMonthBookingsSql, [lastMonthStart, lastMonthEnd])
            ]);
            console.log(`✅ 訂房記錄查詢完成: 本月 ${thisMonthBookings?.rows?.length || 0} 筆, 上月 ${lastMonthBookings?.rows?.length || 0} 筆`);
            if (lastMonthBookings?.rows?.length > 0) {
                console.log(`   上月訂房詳情:`, lastMonthBookings.rows.map(b => ({
                    check_in: b.check_in_date,
                    check_out: b.check_out_date,
                    nights: b.nights
                })));
            }
            
            // 計算住房率
            console.log('📊 計算住房率...');
            const calculateOccupancyRate = async (bookings, monthStart, monthEnd) => {
                try {
                    let weekdayRoomNights = 0;
                    let weekendRoomNights = 0;
                    let weekdayDays = 0;
                    let weekendDays = 0;
                    
                    // 計算該月的所有日期
                    const start = new Date(monthStart + 'T00:00:00');
                    const end = new Date(monthEnd + 'T00:00:00');
                    
                    // 預先計算所有日期的假日狀態
                    const holidayMap = new Map();
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                        const dateStr = d.toISOString().split('T')[0];
                        try {
                            const isHoliday = await isHolidayOrWeekend(dateStr, true);
                            holidayMap.set(dateStr, isHoliday);
                            if (isHoliday) {
                                weekendDays++;
                            } else {
                                weekdayDays++;
                            }
                        } catch (err) {
                            console.warn(`⚠️ 檢查日期 ${dateStr} 是否為假日時發生錯誤:`, err.message);
                            // 預設為平日
                            holidayMap.set(dateStr, false);
                            weekdayDays++;
                        }
                    }
                    
                    // 計算已訂房的房間夜數（只計算該月份內的日期）
                    const monthStartDate = new Date(monthStart + 'T00:00:00');
                    const monthEndDate = new Date(monthEnd + 'T23:59:59');
                    
                    const bookingRows = bookings.rows || bookings || [];
                    for (const booking of bookingRows) {
                        if (!booking || !booking.check_in_date || !booking.check_out_date) {
                            continue;
                        }
                        
                        try {
                            const checkIn = new Date(booking.check_in_date + 'T00:00:00');
                            const checkOut = new Date(booking.check_out_date + 'T00:00:00');
                            
                            // 確定計算的開始和結束日期（限制在該月份內）
                            const calcStart = checkIn < monthStartDate ? monthStartDate : checkIn;
                            const calcEnd = checkOut > monthEndDate ? monthEndDate : checkOut;
                            
                            for (let d = new Date(calcStart); d < calcEnd; d.setDate(d.getDate() + 1)) {
                                const dateStr = d.toISOString().split('T')[0];
                                // 確保日期在該月份內
                                if (dateStr >= monthStart && dateStr <= monthEnd) {
                                    const isHoliday = holidayMap.get(dateStr) || false;
                                    if (isHoliday) {
                                        weekendRoomNights += 1;
                                    } else {
                                        weekdayRoomNights += 1;
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`⚠️ 處理訂房記錄時發生錯誤:`, err.message, booking);
                            continue;
                        }
                    }
                    
                    const weekdayOccupancy = weekdayDays > 0 ? (weekdayRoomNights / (weekdayDays * totalRooms) * 100).toFixed(2) : 0;
                    const weekendOccupancy = weekendDays > 0 ? (weekendRoomNights / (weekendDays * totalRooms) * 100).toFixed(2) : 0;
                    
                    return {
                        weekdayOccupancy: parseFloat(weekdayOccupancy),
                        weekendOccupancy: parseFloat(weekendOccupancy),
                        weekdayRoomNights,
                        weekendRoomNights,
                        weekdayDays,
                        weekendDays
                    };
                } catch (error) {
                    console.error('❌ 計算住房率時發生錯誤:', error.message);
                    // 返回預設值
                    return {
                        weekdayOccupancy: 0,
                        weekendOccupancy: 0,
                        weekdayRoomNights: 0,
                        weekendRoomNights: 0,
                        weekdayDays: 0,
                        weekendDays: 0
                    };
                }
            };
            
            console.log('📊 計算住房率...');
            const [thisMonthOccupancy, lastMonthOccupancy] = await Promise.all([
                calculateOccupancyRate(thisMonthBookings, thisMonthStart, thisMonthEnd),
                calculateOccupancyRate(lastMonthBookings, lastMonthStart, lastMonthEnd)
            ]);
            console.log('✅ 住房率計算完成:', { thisMonthOccupancy, lastMonthOccupancy });
            
            // 確保 NULL 值被正確處理為 0
            const thisMonthBookingCount = thisMonthResult?.booking_count ? parseInt(thisMonthResult.booking_count) : 0;
            const thisMonthTotalRevenue = thisMonthResult?.total_revenue ? parseInt(thisMonthResult.total_revenue) : 0;
            const lastMonthBookingCount = lastMonthResult?.booking_count ? parseInt(lastMonthResult.booking_count) : 0;
            const lastMonthTotalRevenue = lastMonthResult?.total_revenue ? parseInt(lastMonthResult.total_revenue) : 0;
            
            console.log(`📊 處理後的統計數據:`, {
                thisMonth: { bookingCount: thisMonthBookingCount, totalRevenue: thisMonthTotalRevenue },
                lastMonth: { bookingCount: lastMonthBookingCount, totalRevenue: lastMonthTotalRevenue }
            });
            
            const result = {
                thisMonth: {
                    bookingCount: thisMonthBookingCount,
                    totalRevenue: thisMonthTotalRevenue,
                    weekdayOccupancy: thisMonthOccupancy.weekdayOccupancy,
                    weekendOccupancy: thisMonthOccupancy.weekendOccupancy
                },
                lastMonth: {
                    bookingCount: lastMonthBookingCount,
                    totalRevenue: lastMonthTotalRevenue,
                    weekdayOccupancy: lastMonthOccupancy.weekdayOccupancy,
                    weekendOccupancy: lastMonthOccupancy.weekendOccupancy
                }
            };
            console.log('✅ 月度比較統計查詢完成:', result);
            return result;
        } else {
            // SQLite 版本
            // 本月統計 - 以入住日期（check_in_date）為準，不是訂房日期（created_at 或 booking_date）
            const thisMonthSql = `
                SELECT 
                    COUNT(*) as booking_count,
                    COALESCE(SUM(total_amount), 0) as total_revenue,
                    COUNT(DISTINCT check_in_date) as unique_dates
                FROM bookings
                WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)
                AND status != 'cancelled'
            `;
            
            // 上月統計 - 以入住日期（check_in_date）為準，不是訂房日期（created_at 或 booking_date）
            const lastMonthSql = `
                SELECT 
                    COUNT(*) as booking_count,
                    COALESCE(SUM(total_amount), 0) as total_revenue,
                    COUNT(DISTINCT check_in_date) as unique_dates
                FROM bookings
                WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)
                AND status != 'cancelled'
            `;
            
            // 輸出實際的SQL語句和參數以便調試
            console.log(`🔍 執行上月統計查詢:`);
            console.log(`   SQL: ${lastMonthSql}`);
            console.log(`   參數: [${lastMonthStart}, ${lastMonthEnd}]`);
            
            const [thisMonthResult, lastMonthResult] = await Promise.all([
                queryOne(thisMonthSql, [thisMonthStart, thisMonthEnd]),
                queryOne(lastMonthSql, [lastMonthStart, lastMonthEnd])
            ]);
            
            console.log(`📊 本月統計查詢參數: ${thisMonthStart} ~ ${thisMonthEnd}`);
            console.log(`📊 本月統計結果:`, thisMonthResult);
            console.log(`📊 上月統計查詢參數: ${lastMonthStart} ~ ${lastMonthEnd}`);
            console.log(`📊 上月統計結果:`, lastMonthResult);
            
            // 查詢實際的訂房記錄以確認（以入住日期 check_in_date 為準）
            const debugLastMonthSql = `
                SELECT booking_id, check_in_date, check_out_date, total_amount, status
                FROM bookings
                WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)
                AND status != 'cancelled'
                ORDER BY check_in_date
            `;
            const debugLastMonthResult = await query(debugLastMonthSql, [lastMonthStart, lastMonthEnd]);
            console.log(`🔍 上月實際查詢到的訂房記錄 (${debugLastMonthResult?.length || 0} 筆):`);
            if (debugLastMonthResult && debugLastMonthResult.length > 0) {
                debugLastMonthResult.forEach(booking => {
                    console.log(`   - ${booking.booking_id}: 入住 ${booking.check_in_date}, 退房 ${booking.check_out_date}, 金額 ${booking.total_amount}, 狀態 ${booking.status}`);
                });
            } else {
                console.log(`   (無訂房記錄)`);
            }
            
            // 計算本月平日和假日的房間夜數（包含跨月份的訂房）
            const thisMonthBookingsSql = `
                SELECT check_in_date, check_out_date, nights
                FROM bookings
                WHERE (DATE(check_in_date) <= DATE(?) AND DATE(check_out_date) > DATE(?))
                AND status != 'cancelled'
            `;
            
            // 計算上月平日和假日的房間夜數（包含跨月份的訂房）
            const lastMonthBookingsSql = `
                SELECT check_in_date, check_out_date, nights
                FROM bookings
                WHERE (DATE(check_in_date) <= DATE(?) AND DATE(check_out_date) > DATE(?))
                AND status != 'cancelled'
            `;
            
            // 參數順序：第一個 ? 是月份結束日期，第二個 ? 是月份開始日期
            // 查詢邏輯：找出所有在該月份期間有房間夜數的訂房（包括跨月份的訂房）
            const [thisMonthBookings, lastMonthBookings] = await Promise.all([
                query(thisMonthBookingsSql, [thisMonthEnd, thisMonthStart]),
                query(lastMonthBookingsSql, [lastMonthEnd, lastMonthStart])
            ]);
            
            const calculateOccupancyRate = async (bookings, monthStart, monthEnd) => {
                try {
                    let weekdayRoomNights = 0;
                    let weekendRoomNights = 0;
                    let weekdayDays = 0;
                    let weekendDays = 0;
                    
                    // 計算該月的所有日期
                    const start = new Date(monthStart + 'T00:00:00');
                    const end = new Date(monthEnd + 'T00:00:00');
                    
                    // 預先計算所有日期的假日狀態
                    const holidayMap = new Map();
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                        const dateStr = d.toISOString().split('T')[0];
                        try {
                            const isHoliday = await isHolidayOrWeekend(dateStr, true);
                            holidayMap.set(dateStr, isHoliday);
                            if (isHoliday) {
                                weekendDays++;
                            } else {
                                weekdayDays++;
                            }
                        } catch (err) {
                            console.warn(`⚠️ 檢查日期 ${dateStr} 是否為假日時發生錯誤:`, err.message);
                            // 預設為平日
                            holidayMap.set(dateStr, false);
                            weekdayDays++;
                        }
                    }
                    
                    // 計算已訂房的房間夜數（只計算該月份內的日期）
                    const monthStartDate = new Date(monthStart + 'T00:00:00');
                    const monthEndDate = new Date(monthEnd + 'T23:59:59');
                    
                    const bookingRows = bookings.rows || bookings || [];
                    for (const booking of bookingRows) {
                        if (!booking || !booking.check_in_date || !booking.check_out_date) {
                            continue;
                        }
                        
                        try {
                            const checkIn = new Date(booking.check_in_date + 'T00:00:00');
                            const checkOut = new Date(booking.check_out_date + 'T00:00:00');
                            
                            // 確定計算的開始和結束日期（限制在該月份內）
                            const calcStart = checkIn < monthStartDate ? monthStartDate : checkIn;
                            const calcEnd = checkOut > monthEndDate ? monthEndDate : checkOut;
                            
                            for (let d = new Date(calcStart); d < calcEnd; d.setDate(d.getDate() + 1)) {
                                const dateStr = d.toISOString().split('T')[0];
                                // 確保日期在該月份內
                                if (dateStr >= monthStart && dateStr <= monthEnd) {
                                    const isHoliday = holidayMap.get(dateStr) || false;
                                    if (isHoliday) {
                                        weekendRoomNights += 1;
                                    } else {
                                        weekdayRoomNights += 1;
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`⚠️ 處理訂房記錄時發生錯誤:`, err.message, booking);
                            continue;
                        }
                    }
                    
                    const weekdayOccupancy = weekdayDays > 0 ? (weekdayRoomNights / (weekdayDays * totalRooms) * 100).toFixed(2) : 0;
                    const weekendOccupancy = weekendDays > 0 ? (weekendRoomNights / (weekendDays * totalRooms) * 100).toFixed(2) : 0;
                    
                    return {
                        weekdayOccupancy: parseFloat(weekdayOccupancy),
                        weekendOccupancy: parseFloat(weekendOccupancy),
                        weekdayRoomNights,
                        weekendRoomNights,
                        weekdayDays,
                        weekendDays
                    };
                } catch (error) {
                    console.error('❌ 計算住房率時發生錯誤:', error.message);
                    // 返回預設值
                    return {
                        weekdayOccupancy: 0,
                        weekendOccupancy: 0,
                        weekdayRoomNights: 0,
                        weekendRoomNights: 0,
                        weekdayDays: 0,
                        weekendDays: 0
                    };
                }
            };
            
            const [thisMonthOccupancy, lastMonthOccupancy] = await Promise.all([
                calculateOccupancyRate(thisMonthBookings, thisMonthStart, thisMonthEnd),
                calculateOccupancyRate(lastMonthBookings, lastMonthStart, lastMonthEnd)
            ]);
            
            // 確保 NULL 值被正確處理為 0
            const thisMonthBookingCount = thisMonthResult?.booking_count ? parseInt(thisMonthResult.booking_count) : 0;
            const thisMonthTotalRevenue = thisMonthResult?.total_revenue ? parseInt(thisMonthResult.total_revenue) : 0;
            const lastMonthBookingCount = lastMonthResult?.booking_count ? parseInt(lastMonthResult.booking_count) : 0;
            const lastMonthTotalRevenue = lastMonthResult?.total_revenue ? parseInt(lastMonthResult.total_revenue) : 0;
            
            console.log(`📊 處理後的統計數據:`, {
                thisMonth: { bookingCount: thisMonthBookingCount, totalRevenue: thisMonthTotalRevenue },
                lastMonth: { bookingCount: lastMonthBookingCount, totalRevenue: lastMonthTotalRevenue }
            });
            
            return {
                thisMonth: {
                    bookingCount: thisMonthBookingCount,
                    totalRevenue: thisMonthTotalRevenue,
                    weekdayOccupancy: thisMonthOccupancy.weekdayOccupancy,
                    weekendOccupancy: thisMonthOccupancy.weekendOccupancy
                },
                lastMonth: {
                    bookingCount: lastMonthBookingCount,
                    totalRevenue: lastMonthTotalRevenue,
                    weekdayOccupancy: lastMonthOccupancy.weekdayOccupancy,
                    weekendOccupancy: lastMonthOccupancy.weekendOccupancy
                }
            };
        }
    } catch (error) {
        console.error('❌ 查詢月度比較統計失敗:', error.message);
        console.error('錯誤堆疊:', error.stack);
        console.error('錯誤詳情:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// ==================== 會員等級管理 ====================

// 取得所有會員等級
async function getAllMemberLevels() {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM member_levels ORDER BY display_order ASC, id ASC`
            : `SELECT * FROM member_levels ORDER BY display_order ASC, id ASC`;
        
        const result = await query(sql);
        return result.rows.map(level => ({
            id: level.id,
            level_name: level.level_name,
            min_spent: parseInt(level.min_spent || 0),
            min_bookings: parseInt(level.min_bookings || 0),
            discount_percent: parseFloat(level.discount_percent || 0),
            display_order: parseInt(level.display_order || 0),
            is_active: parseInt(level.is_active || 1)
        }));
    } catch (error) {
        console.error('❌ 查詢會員等級列表失敗:', error.message);
        throw error;
    }
}

// 取得單一會員等級
async function getMemberLevelById(id) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM member_levels WHERE id = $1`
            : `SELECT * FROM member_levels WHERE id = ?`;
        
        const result = await queryOne(sql, [id]);
        if (!result) return null;
        
        return {
            id: result.id,
            level_name: result.level_name,
            min_spent: parseInt(result.min_spent || 0),
            min_bookings: parseInt(result.min_bookings || 0),
            discount_percent: parseFloat(result.discount_percent || 0),
            display_order: parseInt(result.display_order || 0),
            is_active: parseInt(result.is_active || 1)
        };
    } catch (error) {
        console.error('❌ 查詢會員等級失敗:', error.message);
        throw error;
    }
}

// 新增會員等級
async function createMemberLevel(levelData) {
    try {
        const { level_name, min_spent, min_bookings, discount_percent, display_order, is_active } = levelData;
        
        const sql = usePostgreSQL
            ? `INSERT INTO member_levels (level_name, min_spent, min_bookings, discount_percent, display_order, is_active) 
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`
            : `INSERT INTO member_levels (level_name, min_spent, min_bookings, discount_percent, display_order, is_active) 
               VALUES (?, ?, ?, ?, ?, ?)`;
        
        const params = [level_name, min_spent || 0, min_bookings || 0, discount_percent || 0, display_order || 0, is_active !== undefined ? is_active : 1];
        
        if (usePostgreSQL) {
            const result = await query(sql, params);
            return result.rows[0];
        } else {
            const result = await query(sql, params);
            const newId = result.lastID;
            return await getMemberLevelById(newId);
        }
    } catch (error) {
        console.error('❌ 新增會員等級失敗:', error.message);
        throw error;
    }
}

// 更新會員等級
async function updateMemberLevel(id, levelData) {
    try {
        const { level_name, min_spent, min_bookings, discount_percent, display_order, is_active } = levelData;
        
        const sql = usePostgreSQL
            ? `UPDATE member_levels 
               SET level_name = $1, min_spent = $2, min_bookings = $3, discount_percent = $4, 
                   display_order = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP 
               WHERE id = $7 RETURNING *`
            : `UPDATE member_levels 
               SET level_name = ?, min_spent = ?, min_bookings = ?, discount_percent = ?, 
                   display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`;
        
        const params = [level_name, min_spent || 0, min_bookings || 0, discount_percent || 0, display_order || 0, is_active !== undefined ? is_active : 1, id];
        
        if (usePostgreSQL) {
            const result = await query(sql, params);
            return result.rows[0];
        } else {
            await query(sql, params);
            return await getMemberLevelById(id);
        }
    } catch (error) {
        console.error('❌ 更新會員等級失敗:', error.message);
        throw error;
    }
}

// 刪除會員等級
async function deleteMemberLevel(id) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM member_levels WHERE id = $1`
            : `DELETE FROM member_levels WHERE id = ?`;
        
        await query(sql, [id]);
        return true;
    } catch (error) {
        console.error('❌ 刪除會員等級失敗:', error.message);
        throw error;
    }
}

// 計算客戶等級（根據消費金額和訂房次數）
async function calculateCustomerLevel(totalSpent, bookingCount) {
    try {
        // 取得所有啟用的等級，按 display_order 降序排列（最高等級優先）
        const sql = usePostgreSQL
            ? `SELECT * FROM member_levels 
               WHERE is_active = 1 
               ORDER BY display_order DESC, min_spent DESC, min_bookings DESC`
            : `SELECT * FROM member_levels 
               WHERE is_active = 1 
               ORDER BY display_order DESC, min_spent DESC, min_bookings DESC`;
        
        const result = await query(sql);
        const levels = result.rows;
        
        // 從最高等級開始檢查，找到第一個符合條件的等級
        for (const level of levels) {
            const minSpent = parseInt(level.min_spent || 0);
            const minBookings = parseInt(level.min_bookings || 0);
            
            if (totalSpent >= minSpent && bookingCount >= minBookings) {
                return {
                    id: level.id,
                    level_name: level.level_name,
                    discount_percent: parseFloat(level.discount_percent || 0)
                };
            }
        }
        
        // 如果沒有符合的等級，返回最低等級（通常是新會員）
        const lowestLevel = levels[levels.length - 1] || null;
        if (lowestLevel) {
            return {
                id: lowestLevel.id,
                level_name: lowestLevel.level_name,
                discount_percent: parseFloat(lowestLevel.discount_percent || 0)
            };
        }
        
        return null;
    } catch (error) {
        console.error('❌ 計算客戶等級失敗:', error.message);
        throw error;
    }
}

// ==================== 優惠代碼管理 ====================

// 取得所有優惠代碼
async function getAllPromoCodes() {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM promo_codes ORDER BY created_at DESC`
            : `SELECT * FROM promo_codes ORDER BY created_at DESC`;
        
        const result = await query(sql);
        return result.rows.map(code => ({
            id: code.id,
            code: code.code,
            name: code.name,
            description: code.description || '',
            discount_type: code.discount_type,
            discount_value: parseFloat(code.discount_value || 0),
            min_spend: parseInt(code.min_spend || 0),
            max_discount: code.max_discount ? parseInt(code.max_discount) : null,
            applicable_room_types: code.applicable_room_types ? JSON.parse(code.applicable_room_types) : null,
            total_usage_limit: code.total_usage_limit ? parseInt(code.total_usage_limit) : null,
            per_user_limit: parseInt(code.per_user_limit || 1),
            start_date: code.start_date,
            end_date: code.end_date,
            is_active: code.is_active !== undefined && code.is_active !== null ? parseInt(code.is_active) : 1,
            can_combine_with_early_bird: parseInt(code.can_combine_with_early_bird || 0),
            can_combine_with_late_bird: parseInt(code.can_combine_with_late_bird || 0),
            created_at: code.created_at,
            updated_at: code.updated_at
        }));
    } catch (error) {
        console.error('❌ 查詢優惠代碼列表失敗:', error.message);
        throw error;
    }
}

// 取得單一優惠代碼
async function getPromoCodeById(id) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM promo_codes WHERE id = $1`
            : `SELECT * FROM promo_codes WHERE id = ?`;
        
        const result = await queryOne(sql, [id]);
        if (!result) return null;
        
        return {
            id: result.id,
            code: result.code,
            name: result.name,
            description: result.description || '',
            discount_type: result.discount_type,
            discount_value: parseFloat(result.discount_value || 0),
            min_spend: parseInt(result.min_spend || 0),
            max_discount: result.max_discount ? parseInt(result.max_discount) : null,
            applicable_room_types: result.applicable_room_types ? JSON.parse(result.applicable_room_types) : null,
            total_usage_limit: result.total_usage_limit ? parseInt(result.total_usage_limit) : null,
            per_user_limit: parseInt(result.per_user_limit || 1),
            start_date: result.start_date,
            end_date: result.end_date,
            is_active: result.is_active !== undefined && result.is_active !== null ? parseInt(result.is_active) : 1,
            can_combine_with_early_bird: parseInt(result.can_combine_with_early_bird || 0),
            can_combine_with_late_bird: parseInt(result.can_combine_with_late_bird || 0)
        };
    } catch (error) {
        console.error('❌ 查詢優惠代碼失敗:', error.message);
        throw error;
    }
}

// 根據代碼取得優惠代碼
async function getPromoCodeByCode(code) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM promo_codes WHERE code = $1`
            : `SELECT * FROM promo_codes WHERE code = ?`;
        
        const result = await queryOne(sql, [code.toUpperCase()]);
        if (!result) return null;
        
        return {
            id: result.id,
            code: result.code,
            name: result.name,
            description: result.description || '',
            discount_type: result.discount_type,
            discount_value: parseFloat(result.discount_value || 0),
            min_spend: parseInt(result.min_spend || 0),
            max_discount: result.max_discount ? parseInt(result.max_discount) : null,
            applicable_room_types: result.applicable_room_types ? JSON.parse(result.applicable_room_types) : null,
            total_usage_limit: result.total_usage_limit ? parseInt(result.total_usage_limit) : null,
            per_user_limit: parseInt(result.per_user_limit || 1),
            start_date: result.start_date,
            end_date: result.end_date,
            is_active: result.is_active !== undefined && result.is_active !== null ? parseInt(result.is_active) : 1,
            can_combine_with_early_bird: parseInt(result.can_combine_with_early_bird || 0),
            can_combine_with_late_bird: parseInt(result.can_combine_with_late_bird || 0)
        };
    } catch (error) {
        console.error('❌ 查詢優惠代碼失敗:', error.message);
        throw error;
    }
}

// 驗證優惠代碼
async function validatePromoCode(code, totalAmount, roomType, guestEmail = null) {
    try {
        const promoCode = await getPromoCodeByCode(code);
        
        if (!promoCode) {
            return {
                valid: false,
                message: '優惠代碼不存在'
            };
        }
        
        // 檢查是否啟用
        if (!promoCode.is_active) {
            return {
                valid: false,
                message: '優惠代碼已停用'
            };
        }
        
        // 檢查有效期
        const today = new Date().toISOString().split('T')[0];
        if (promoCode.start_date && today < promoCode.start_date) {
            return {
                valid: false,
                message: '優惠代碼尚未生效'
            };
        }
        if (promoCode.end_date && today > promoCode.end_date) {
            return {
                valid: false,
                message: '優惠代碼已過期'
            };
        }
        
        // 檢查最低消費金額
        if (promoCode.min_spend > 0 && totalAmount < promoCode.min_spend) {
            return {
                valid: false,
                message: `最低消費金額需達 NT$ ${promoCode.min_spend.toLocaleString()}`
            };
        }
        
        // 檢查適用房型
        if (promoCode.applicable_room_types && promoCode.applicable_room_types.length > 0) {
            if (!promoCode.applicable_room_types.includes(roomType)) {
                return {
                    valid: false,
                    message: '此優惠代碼不適用於選擇的房型'
                };
            }
        }
        
        // 檢查總使用次數限制
        if (promoCode.total_usage_limit !== null) {
            const usageCountSQL = usePostgreSQL
                ? `SELECT COUNT(*) as count FROM promo_code_usages WHERE promo_code_id = $1`
                : `SELECT COUNT(*) as count FROM promo_code_usages WHERE promo_code_id = ?`;
            const usageCount = await queryOne(usageCountSQL, [promoCode.id]);
            if (parseInt(usageCount.count) >= promoCode.total_usage_limit) {
                return {
                    valid: false,
                    message: '優惠代碼使用次數已達上限'
                };
            }
        }
        
        // 檢查每人使用次數限制
        if (guestEmail && promoCode.per_user_limit > 0) {
            const userUsageCountSQL = usePostgreSQL
                ? `SELECT COUNT(*) as count FROM promo_code_usages WHERE promo_code_id = $1 AND guest_email = $2`
                : `SELECT COUNT(*) as count FROM promo_code_usages WHERE promo_code_id = ? AND guest_email = ?`;
            const userUsageCount = await queryOne(userUsageCountSQL, [promoCode.id, guestEmail]);
            if (parseInt(userUsageCount.count) >= promoCode.per_user_limit) {
                return {
                    valid: false,
                    message: '您已達到此優惠代碼的使用次數上限'
                };
            }
        }
        
        // 計算折扣金額
        let discountAmount = 0;
        if (promoCode.discount_type === 'fixed') {
            discountAmount = promoCode.discount_value;
        } else if (promoCode.discount_type === 'percent') {
            discountAmount = totalAmount * (promoCode.discount_value / 100);
            if (promoCode.max_discount && discountAmount > promoCode.max_discount) {
                discountAmount = promoCode.max_discount;
            }
        }
        
        const finalAmount = Math.max(0, totalAmount - discountAmount);
        
        return {
            valid: true,
            promo_code: promoCode,
            discount_amount: Math.round(discountAmount),
            original_amount: totalAmount,
            final_amount: finalAmount,
            message: `優惠代碼可用，可折抵 NT$ ${Math.round(discountAmount).toLocaleString()}`
        };
    } catch (error) {
        console.error('❌ 驗證優惠代碼失敗:', error.message);
        throw error;
    }
}

// 新增優惠代碼
async function createPromoCode(codeData) {
    try {
        const {
            code, name, description, discount_type, discount_value,
            min_spend, max_discount, applicable_room_types,
            total_usage_limit, per_user_limit, start_date, end_date,
            is_active, can_combine_with_early_bird, can_combine_with_late_bird
        } = codeData;
        
        const sql = usePostgreSQL
            ? `INSERT INTO promo_codes (
                code, name, description, discount_type, discount_value,
                min_spend, max_discount, applicable_room_types,
                total_usage_limit, per_user_limit, start_date, end_date,
                is_active, can_combine_with_early_bird, can_combine_with_late_bird
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`
            : `INSERT INTO promo_codes (
                code, name, description, discount_type, discount_value,
                min_spend, max_discount, applicable_room_types,
                total_usage_limit, per_user_limit, start_date, end_date,
                is_active, can_combine_with_early_bird, can_combine_with_late_bird
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const params = [
            code.toUpperCase(),
            name,
            description || null,
            discount_type,
            discount_value,
            min_spend || 0,
            max_discount || null,
            applicable_room_types ? JSON.stringify(applicable_room_types) : null,
            total_usage_limit || null,
            per_user_limit || 1,
            start_date || null,
            end_date || null,
            is_active !== undefined ? parseInt(is_active) : 1,
            can_combine_with_early_bird || 0,
            can_combine_with_late_bird || 0
        ];
        
        if (usePostgreSQL) {
            const result = await query(sql, params);
            // 格式化返回的資料，確保與 getPromoCodeById 格式一致
            const newCode = result.rows[0];
            if (newCode) {
                return {
                    id: newCode.id,
                    code: newCode.code,
                    name: newCode.name,
                    description: newCode.description || '',
                    discount_type: newCode.discount_type,
                    discount_value: parseFloat(newCode.discount_value || 0),
                    min_spend: parseInt(newCode.min_spend || 0),
                    max_discount: newCode.max_discount ? parseInt(newCode.max_discount) : null,
                    applicable_room_types: newCode.applicable_room_types ? JSON.parse(newCode.applicable_room_types) : null,
                    total_usage_limit: newCode.total_usage_limit ? parseInt(newCode.total_usage_limit) : null,
                    per_user_limit: parseInt(newCode.per_user_limit || 1),
                    start_date: newCode.start_date,
                    end_date: newCode.end_date,
                    is_active: newCode.is_active !== undefined && newCode.is_active !== null ? parseInt(newCode.is_active) : 1,
                    can_combine_with_early_bird: parseInt(newCode.can_combine_with_early_bird || 0),
                    can_combine_with_late_bird: parseInt(newCode.can_combine_with_late_bird || 0)
                };
            }
            return null;
        } else {
            const result = await query(sql, params);
            const newId = result.lastID;
            return await getPromoCodeById(newId);
        }
    } catch (error) {
        console.error('❌ 新增優惠代碼失敗:', error.message);
        throw error;
    }
}

// 更新優惠代碼
async function updatePromoCode(id, codeData) {
    try {
        const {
            code, name, description, discount_type, discount_value,
            min_spend, max_discount, applicable_room_types,
            total_usage_limit, per_user_limit, start_date, end_date,
            is_active, can_combine_with_early_bird, can_combine_with_late_bird
        } = codeData;
        
        const sql = usePostgreSQL
            ? `UPDATE promo_codes 
               SET code = $1, name = $2, description = $3, discount_type = $4, discount_value = $5,
                   min_spend = $6, max_discount = $7, applicable_room_types = $8,
                   total_usage_limit = $9, per_user_limit = $10, start_date = $11, end_date = $12,
                   is_active = $13, can_combine_with_early_bird = $14, can_combine_with_late_bird = $15,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $16 RETURNING *`
            : `UPDATE promo_codes 
               SET code = ?, name = ?, description = ?, discount_type = ?, discount_value = ?,
                   min_spend = ?, max_discount = ?, applicable_room_types = ?,
                   total_usage_limit = ?, per_user_limit = ?, start_date = ?, end_date = ?,
                   is_active = ?, can_combine_with_early_bird = ?, can_combine_with_late_bird = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`;
        
        const params = [
            code.toUpperCase(),
            name,
            description || null,
            discount_type,
            discount_value,
            min_spend || 0,
            max_discount || null,
            applicable_room_types ? JSON.stringify(applicable_room_types) : null,
            total_usage_limit || null,
            per_user_limit || 1,
            start_date || null,
            end_date || null,
            is_active !== undefined ? parseInt(is_active) : 1,
            can_combine_with_early_bird || 0,
            can_combine_with_late_bird || 0,
            id
        ];
        
        if (usePostgreSQL) {
            const result = await query(sql, params);
            // 格式化返回的資料，確保與 getPromoCodeById 格式一致
            const updatedCode = result.rows[0];
            if (updatedCode) {
                return {
                    id: updatedCode.id,
                    code: updatedCode.code,
                    name: updatedCode.name,
                    description: updatedCode.description || '',
                    discount_type: updatedCode.discount_type,
                    discount_value: parseFloat(updatedCode.discount_value || 0),
                    min_spend: parseInt(updatedCode.min_spend || 0),
                    max_discount: updatedCode.max_discount ? parseInt(updatedCode.max_discount) : null,
                    applicable_room_types: updatedCode.applicable_room_types ? JSON.parse(updatedCode.applicable_room_types) : null,
                    total_usage_limit: updatedCode.total_usage_limit ? parseInt(updatedCode.total_usage_limit) : null,
                    per_user_limit: parseInt(updatedCode.per_user_limit || 1),
                    start_date: updatedCode.start_date,
                    end_date: updatedCode.end_date,
                    is_active: updatedCode.is_active !== undefined && updatedCode.is_active !== null ? parseInt(updatedCode.is_active) : 1,
                    can_combine_with_early_bird: parseInt(updatedCode.can_combine_with_early_bird || 0),
                    can_combine_with_late_bird: parseInt(updatedCode.can_combine_with_late_bird || 0)
                };
            }
            return await getPromoCodeById(id);
        } else {
            await query(sql, params);
            return await getPromoCodeById(id);
        }
    } catch (error) {
        console.error('❌ 更新優惠代碼失敗:', error.message);
        throw error;
    }
}

// 刪除優惠代碼
async function deletePromoCode(id) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM promo_codes WHERE id = $1`
            : `DELETE FROM promo_codes WHERE id = ?`;
        
        await query(sql, [id]);
        return true;
    } catch (error) {
        console.error('❌ 刪除優惠代碼失敗:', error.message);
        throw error;
    }
}

// 記錄優惠代碼使用
async function recordPromoCodeUsage(promoCodeId, bookingId, guestEmail, discountAmount, originalAmount, finalAmount) {
    try {
        const sql = usePostgreSQL
            ? `INSERT INTO promo_code_usages (
                promo_code_id, booking_id, guest_email, discount_amount, original_amount, final_amount
            ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`
            : `INSERT INTO promo_code_usages (
                promo_code_id, booking_id, guest_email, discount_amount, original_amount, final_amount
            ) VALUES (?, ?, ?, ?, ?, ?)`;
        
        await query(sql, [
            promoCodeId,
            bookingId,
            guestEmail,
            discountAmount,
            originalAmount,
            finalAmount
        ]);
        
        return true;
    } catch (error) {
        console.error('❌ 記錄優惠代碼使用失敗:', error.message);
        throw error;
    }
}

// 取得優惠代碼使用統計
async function getPromoCodeUsageStats(promoCodeId) {
    try {
        const sql = usePostgreSQL
            ? `SELECT 
                COUNT(*) as total_usage,
                SUM(discount_amount) as total_discount,
                COUNT(DISTINCT guest_email) as unique_users
            FROM promo_code_usages
            WHERE promo_code_id = $1`
            : `SELECT 
                COUNT(*) as total_usage,
                SUM(discount_amount) as total_discount,
                COUNT(DISTINCT guest_email) as unique_users
            FROM promo_code_usages
            WHERE promo_code_id = ?`;
        
        const result = await queryOne(sql, [promoCodeId]);
        return {
            total_usage: parseInt(result.total_usage || 0),
            total_discount: parseFloat(result.total_discount || 0),
            unique_users: parseInt(result.unique_users || 0)
        };
    } catch (error) {
        console.error('❌ 查詢優惠代碼使用統計失敗:', error.message);
        throw error;
    }
}

// ==================== 客戶管理 ====================

// 取得所有客戶（聚合訂房資料，以 email 為唯一值，顯示最新的姓名和電話）
async function getAllCustomers() {
    try {
        const sql = usePostgreSQL
            ? `WITH latest_customer_info AS (
                SELECT DISTINCT ON (guest_email)
                    guest_email,
                    guest_name,
                    guest_phone
                FROM bookings
                ORDER BY guest_email, created_at DESC
            ),
            customer_stats AS (
                SELECT 
                    guest_email,
                    COUNT(*) as booking_count,
                    SUM(final_amount) as total_spent,
                    MAX(created_at) as last_booking_date
                FROM bookings
                GROUP BY guest_email
            )
            SELECT 
                lci.guest_email,
                lci.guest_name,
                lci.guest_phone,
                cs.booking_count,
                cs.total_spent,
                cs.last_booking_date
            FROM latest_customer_info lci
            JOIN customer_stats cs ON lci.guest_email = cs.guest_email
            ORDER BY cs.last_booking_date DESC`
            : `SELECT 
                b1.guest_email,
                (SELECT b2.guest_name FROM bookings b2 
                 WHERE b2.guest_email = b1.guest_email 
                 ORDER BY b2.created_at DESC LIMIT 1) as guest_name,
                (SELECT b2.guest_phone FROM bookings b2 
                 WHERE b2.guest_email = b1.guest_email 
                 ORDER BY b2.created_at DESC LIMIT 1) as guest_phone,
                COUNT(*) as booking_count,
                SUM(b1.final_amount) as total_spent,
                MAX(b1.created_at) as last_booking_date
            FROM bookings b1
            GROUP BY b1.guest_email
            ORDER BY last_booking_date DESC`;
        
        const result = await query(sql);
        
        // 格式化日期並計算等級
        const customers = await Promise.all(result.rows.map(async (customer) => {
            const totalSpent = parseInt(customer.total_spent || 0);
            const bookingCount = parseInt(customer.booking_count || 0);
            
            // 計算客戶等級
            const level = await calculateCustomerLevel(totalSpent, bookingCount);
            
            return {
                ...customer,
                last_booking_date: customer.last_booking_date 
                    ? new Date(customer.last_booking_date).toLocaleDateString('zh-TW')
                    : null,
                total_spent: totalSpent,
                booking_count: bookingCount,
                member_level: level ? level.level_name : '新會員',
                member_level_id: level ? level.id : null,
                discount_percent: level ? level.discount_percent : 0
            };
        }));
        
        return customers;
    } catch (error) {
        console.error('❌ 查詢客戶列表失敗:', error.message);
        throw error;
    }
}

// 根據 Email 取得客戶詳情（包含所有訂房記錄，顯示最新的姓名和電話）
async function getCustomerByEmail(email) {
    try {
        // 先取得客戶基本資訊（使用最新的姓名和電話）
        const customerSQL = usePostgreSQL
            ? `SELECT DISTINCT ON (guest_email)
                guest_email,
                guest_name,
                guest_phone,
                COUNT(*) OVER (PARTITION BY guest_email) as booking_count,
                SUM(final_amount) OVER (PARTITION BY guest_email) as total_spent,
                MAX(created_at) OVER (PARTITION BY guest_email) as last_booking_date
            FROM bookings
            WHERE guest_email = $1
            ORDER BY guest_email, created_at DESC
            LIMIT 1`
            : `SELECT 
                guest_email,
                (SELECT guest_name FROM bookings 
                 WHERE guest_email = ? 
                 ORDER BY created_at DESC LIMIT 1) as guest_name,
                (SELECT guest_phone FROM bookings 
                 WHERE guest_email = ? 
                 ORDER BY created_at DESC LIMIT 1) as guest_phone,
                COUNT(*) as booking_count,
                SUM(final_amount) as total_spent,
                MAX(created_at) as last_booking_date
            FROM bookings
            WHERE guest_email = ?`;
        
        const customerResult = usePostgreSQL 
            ? await queryOne(customerSQL, [email])
            : await queryOne(customerSQL, [email, email, email]);
        
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
                    // 只在首次載入時輸出，減少日誌量
                    // console.log(`📅 使用自訂平日/假日設定: 平日為週 ${weekdays.join(', ')}`);
                }
            } catch (e) {
                console.warn('⚠️ 解析 weekday_settings 失敗，使用預設值:', e);
            }
        } else {
            // 移除詳細日誌以減少日誌輸出量
            // console.log('📅 未找到 weekday_settings，使用預設值（週一到週五為平日）');
        }
        
        // 檢查該日期是星期幾
        const date = new Date(dateString);
        const day = date.getDay(); // 0 = 週日, 1 = 週一, ..., 6 = 週六
        
        // 如果該日期不在 weekdays 列表中，則為假日
        const isHoliday = !weekdays.includes(day);
        // 移除詳細日誌以減少日誌輸出量（避免 Railway 速率限制）
        // console.log(`📅 日期 ${dateString} 是週${['日', '一', '二', '三', '四', '五', '六'][day]}，${isHoliday ? '是' : '不是'}假日`);
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
            INSERT INTO room_types (name, display_name, price, holiday_surcharge, max_occupancy, extra_beds, icon, image_url, display_order, is_active) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        ` : `
            INSERT INTO room_types (name, display_name, price, holiday_surcharge, max_occupancy, extra_beds, icon, image_url, display_order, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            roomData.name,
            roomData.display_name,
            roomData.price,
            roomData.holiday_surcharge !== undefined ? roomData.holiday_surcharge : 0,
            roomData.max_occupancy !== undefined ? roomData.max_occupancy : 0,
            roomData.extra_beds !== undefined ? roomData.extra_beds : 0,
            roomData.icon || '🏠',
            roomData.image_url || null,
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
            SET display_name = $1, price = $2, holiday_surcharge = $3, max_occupancy = $4, extra_beds = $5, icon = $6, image_url = $7, display_order = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
        ` : `
            UPDATE room_types 
            SET display_name = ?, price = ?, holiday_surcharge = ?, max_occupancy = ?, extra_beds = ?, icon = ?, image_url = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        const values = [
            roomData.display_name,
            roomData.price,
            roomData.holiday_surcharge !== undefined ? roomData.holiday_surcharge : 0,
            roomData.max_occupancy !== undefined ? roomData.max_occupancy : 0,
            roomData.extra_beds !== undefined ? roomData.extra_beds : 0,
            roomData.icon || '🏠',
            roomData.image_url !== undefined ? roomData.image_url : null,
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
                    // 只在首次載入時輸出，減少日誌量
                    // console.log(`📅 使用自訂平日/假日設定: 平日為週 ${weekdays.join(', ')}`);
                }
            } catch (e) {
                console.warn('⚠️ 解析 weekday_settings 失敗，使用預設值:', e);
            }
        } else {
            // 移除詳細日誌以減少日誌輸出量
            // console.log('📅 未找到 weekday_settings，使用預設值（週一到週五為平日）');
        }
        
        // 檢查該日期是星期幾
        const date = new Date(dateString);
        const day = date.getDay(); // 0 = 週日, 1 = 週一, ..., 6 = 週六
        
        // 如果該日期不在 weekdays 列表中，則為假日
        const isHoliday = !weekdays.includes(day);
        // 移除詳細日誌以減少日誌輸出量（避免 Railway 速率限制）
        // console.log(`📅 日期 ${dateString} 是週${['日', '一', '二', '三', '四', '五', '六'][day]}，${isHoliday ? '是' : '不是'}假日`);
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

// 取得日誌篩選選項
async function getLogFilterOptions() {
    try {
        const actionsSql = 'SELECT DISTINCT action FROM admin_logs ORDER BY action';
        const resourceTypesSql = 'SELECT DISTINCT resource_type FROM admin_logs WHERE resource_type IS NOT NULL ORDER BY resource_type';
        const adminsSql = 'SELECT DISTINCT admin_id, admin_username FROM admin_logs WHERE admin_id IS NOT NULL ORDER BY admin_username';
        
        const [actionsResult, resourceTypesResult, adminsResult] = await Promise.all([
            query(actionsSql),
            query(resourceTypesSql),
            query(adminsSql)
        ]);
        
        return {
            actions: (actionsResult.rows || []).map(r => r.action),
            resourceTypes: (resourceTypesResult.rows || []).map(r => r.resource_type),
            admins: (adminsResult.rows || []).map(r => ({ id: r.admin_id, username: r.admin_username }))
        };
    } catch (error) {
        console.error('❌ 取得日誌篩選選項失敗:', error.message);
        throw error;
    }
}

// ==================== 權限管理系統函數 ====================

// 初始化預設角色和權限
async function initRolesAndPermissions() {
    try {
        // 預設角色列表
        const defaultRoles = [
            { role_name: 'super_admin', display_name: '超級管理員', description: '系統擁有者，擁有所有權限', is_system_role: 1 },
            { role_name: 'admin', display_name: '一般管理員', description: '店長/經理，日常營運管理', is_system_role: 1 },
            { role_name: 'staff', display_name: '客服人員', description: '客服/櫃台人員，客戶服務相關', is_system_role: 1 },
            { role_name: 'finance', display_name: '財務人員', description: '會計/財務，財務相關功能', is_system_role: 1 },
            { role_name: 'viewer', display_name: '只讀管理員', description: '實習生/外部顧問，僅查看權限', is_system_role: 1 }
        ];
        
        // 建立預設角色
        for (const role of defaultRoles) {
            const existing = await queryOne(
                usePostgreSQL 
                    ? 'SELECT id FROM roles WHERE role_name = $1' 
                    : 'SELECT id FROM roles WHERE role_name = ?',
                [role.role_name]
            );
            
            if (!existing) {
                await query(
                    usePostgreSQL 
                        ? 'INSERT INTO roles (role_name, display_name, description, is_system_role) VALUES ($1, $2, $3, $4)'
                        : 'INSERT INTO roles (role_name, display_name, description, is_system_role) VALUES (?, ?, ?, ?)',
                    [role.role_name, role.display_name, role.description, role.is_system_role]
                );
            }
        }
        console.log('✅ 預設角色已初始化');
        
        // 預設權限列表
        const defaultPermissions = [
            // 儀表板
            { code: 'dashboard.view', name: '查看儀表板', module: 'dashboard', description: '查看儀表板資訊' },
            
            // 訂房管理
            { code: 'bookings.view', name: '查看訂房記錄', module: 'bookings', description: '查看所有訂房記錄' },
            { code: 'bookings.create', name: '新增訂房', module: 'bookings', description: '手動建立訂房' },
            { code: 'bookings.edit', name: '編輯訂房', module: 'bookings', description: '修改訂房資訊' },
            { code: 'bookings.delete', name: '刪除訂房', module: 'bookings', description: '永久刪除訂房記錄' },
            { code: 'bookings.cancel', name: '取消訂房', module: 'bookings', description: '取消訂房' },
            { code: 'bookings.export', name: '匯出訂房資料', module: 'bookings', description: '匯出訂房報表' },
            
            // 客戶管理
            { code: 'customers.view', name: '查看客戶資料', module: 'customers', description: '查看客戶列表和詳情' },
            { code: 'customers.create', name: '新增客戶', module: 'customers', description: '手動建立客戶' },
            { code: 'customers.edit', name: '編輯客戶資料', module: 'customers', description: '修改客戶資訊' },
            { code: 'customers.delete', name: '刪除客戶資料', module: 'customers', description: '刪除客戶記錄' },
            { code: 'customers.export', name: '匯出客戶資料', module: 'customers', description: '匯出客戶報表' },
            
            // 房型管理
            { code: 'room_types.view', name: '查看房型', module: 'room_types', description: '查看房型設定' },
            { code: 'room_types.create', name: '新增房型', module: 'room_types', description: '建立新房型' },
            { code: 'room_types.edit', name: '編輯房型', module: 'room_types', description: '修改房型設定' },
            { code: 'room_types.delete', name: '刪除房型', module: 'room_types', description: '刪除房型' },
            
            // 加購商品
            { code: 'addons.view', name: '查看加購商品', module: 'addons', description: '查看加購商品列表' },
            { code: 'addons.create', name: '新增加購商品', module: 'addons', description: '建立新加購商品' },
            { code: 'addons.edit', name: '編輯加購商品', module: 'addons', description: '修改加購商品' },
            { code: 'addons.delete', name: '刪除加購商品', module: 'addons', description: '刪除加購商品' },
            
            // 優惠代碼
            { code: 'promo_codes.view', name: '查看優惠代碼', module: 'promo_codes', description: '查看優惠代碼列表' },
            { code: 'promo_codes.create', name: '新增優惠代碼', module: 'promo_codes', description: '建立新優惠代碼' },
            { code: 'promo_codes.edit', name: '編輯優惠代碼', module: 'promo_codes', description: '修改優惠代碼' },
            { code: 'promo_codes.delete', name: '刪除優惠代碼', module: 'promo_codes', description: '刪除優惠代碼' },
            
            // 統計資料
            { code: 'statistics.view', name: '查看統計資料', module: 'statistics', description: '查看營運統計' },
            { code: 'statistics.export', name: '匯出報表', module: 'statistics', description: '匯出統計報表' },
            
            // 系統設定
            { code: 'settings.view', name: '查看系統設定', module: 'settings', description: '查看系統設定' },
            { code: 'settings.edit', name: '編輯系統設定', module: 'settings', description: '修改系統設定' },
            { code: 'settings.payment', name: '支付設定', module: 'settings', description: '管理支付設定' },
            { code: 'settings.email', name: '郵件設定', module: 'settings', description: '管理郵件設定' },
            
            // 郵件模板
            { code: 'email_templates.view', name: '查看郵件模板', module: 'email_templates', description: '查看郵件模板' },
            { code: 'email_templates.edit', name: '編輯郵件模板', module: 'email_templates', description: '修改郵件模板' },
            { code: 'email_templates.send_test', name: '發送測試郵件', module: 'email_templates', description: '發送測試郵件' },
            
            // 管理員管理
            { code: 'admins.view', name: '查看管理員列表', module: 'admins', description: '查看所有管理員' },
            { code: 'admins.create', name: '新增管理員', module: 'admins', description: '建立新管理員帳號' },
            { code: 'admins.edit', name: '編輯管理員資料', module: 'admins', description: '修改管理員資訊' },
            { code: 'admins.delete', name: '刪除管理員', module: 'admins', description: '刪除管理員帳號' },
            { code: 'admins.change_password', name: '修改其他管理員密碼', module: 'admins', description: '重設其他管理員的密碼' },
            
            // 角色權限管理
            { code: 'roles.view', name: '查看角色列表', module: 'roles', description: '查看所有角色' },
            { code: 'roles.create', name: '新增角色', module: 'roles', description: '建立新角色' },
            { code: 'roles.edit', name: '編輯角色', module: 'roles', description: '修改角色資訊' },
            { code: 'roles.delete', name: '刪除角色', module: 'roles', description: '刪除角色' },
            { code: 'roles.assign_permissions', name: '分配權限', module: 'roles', description: '為角色分配權限' },
            
            // 操作日誌
            { code: 'logs.view', name: '查看操作日誌', module: 'logs', description: '查看系統操作日誌' },
            { code: 'logs.export', name: '匯出操作日誌', module: 'logs', description: '匯出操作日誌' },
            
            // 資料備份
            { code: 'backup.view', name: '查看備份', module: 'backup', description: '查看備份列表' },
            { code: 'backup.create', name: '建立備份', module: 'backup', description: '建立資料備份' },
            { code: 'backup.restore', name: '還原備份', module: 'backup', description: '還原資料備份' },
            { code: 'backup.delete', name: '刪除備份', module: 'backup', description: '刪除備份檔案' }
        ];
        
        // 建立預設權限
        for (const perm of defaultPermissions) {
            const existing = await queryOne(
                usePostgreSQL 
                    ? 'SELECT id FROM permissions WHERE permission_code = $1' 
                    : 'SELECT id FROM permissions WHERE permission_code = ?',
                [perm.code]
            );
            
            if (!existing) {
                await query(
                    usePostgreSQL 
                        ? 'INSERT INTO permissions (permission_code, permission_name, module, description) VALUES ($1, $2, $3, $4)'
                        : 'INSERT INTO permissions (permission_code, permission_name, module, description) VALUES (?, ?, ?, ?)',
                    [perm.code, perm.name, perm.module, perm.description]
                );
            }
        }
        console.log('✅ 預設權限已初始化');
        
        // 為每個角色分配預設權限
        await assignDefaultPermissions();
        
        // 遷移現有管理員到新角色系統
        await migrateAdminsToRoles();
        
    } catch (error) {
        console.error('❌ 初始化角色和權限失敗:', error.message);
        throw error;
    }
}

// 為每個角色分配預設權限
async function assignDefaultPermissions() {
    try {
        // 角色權限對應
        const rolePermissions = {
            'super_admin': 'all', // 超級管理員擁有所有權限
            'admin': [
                'dashboard.view',
                'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.cancel', 'bookings.export',
                'customers.view', 'customers.edit',
                'room_types.view', 'room_types.create', 'room_types.edit',
                'addons.view', 'addons.create', 'addons.edit',
                'promo_codes.view', 'promo_codes.create', 'promo_codes.edit',
                'statistics.view', 'statistics.export',
                'settings.view',
                'email_templates.view', 'email_templates.edit',
                'logs.view'
            ],
            'staff': [
                'dashboard.view',
                'bookings.view', 'bookings.create', 'bookings.edit',
                'customers.view', 'customers.edit',
                'room_types.view',
                'addons.view'
            ],
            'finance': [
                'dashboard.view',
                'bookings.view', 'bookings.export',
                'customers.view',
                'statistics.view', 'statistics.export',
                'logs.view'
            ],
            'viewer': [
                'dashboard.view',
                'bookings.view',
                'customers.view',
                'room_types.view',
                'addons.view',
                'promo_codes.view',
                'statistics.view',
                'settings.view',
                'email_templates.view',
                'logs.view'
            ]
        };
        
        // 取得所有角色
        const roles = await query('SELECT id, role_name FROM roles');
        
        for (const role of roles.rows) {
            const permissions = rolePermissions[role.role_name];
            
            if (!permissions) continue;
            
            // 取得角色當前的權限數量
            const existingCount = await queryOne(
                usePostgreSQL 
                    ? 'SELECT COUNT(*) as count FROM role_permissions WHERE role_id = $1'
                    : 'SELECT COUNT(*) as count FROM role_permissions WHERE role_id = ?',
                [role.id]
            );
            
            // 如果已經有權限，跳過（避免重複分配）
            if (existingCount && parseInt(existingCount.count) > 0) continue;
            
            if (permissions === 'all') {
                // 超級管理員取得所有權限
                const allPerms = await query('SELECT id FROM permissions');
                for (const perm of allPerms.rows) {
                    try {
                        await query(
                            usePostgreSQL 
                                ? 'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
                                : 'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                            [role.id, perm.id]
                        );
                    } catch (err) {
                        // 忽略重複鍵錯誤
                    }
                }
            } else {
                // 其他角色取得指定權限
                for (const permCode of permissions) {
                    const perm = await queryOne(
                        usePostgreSQL 
                            ? 'SELECT id FROM permissions WHERE permission_code = $1'
                            : 'SELECT id FROM permissions WHERE permission_code = ?',
                        [permCode]
                    );
                    
                    if (perm) {
                        try {
                            await query(
                                usePostgreSQL 
                                    ? 'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
                                    : 'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                                [role.id, perm.id]
                            );
                        } catch (err) {
                            // 忽略重複鍵錯誤
                        }
                    }
                }
            }
        }
        console.log('✅ 角色預設權限已分配');
    } catch (error) {
        console.error('❌ 分配角色權限失敗:', error.message);
        throw error;
    }
}

// 遷移現有管理員到新角色系統
async function migrateAdminsToRoles() {
    try {
        // 取得所有沒有 role_id 的管理員
        const admins = await query(
            usePostgreSQL
                ? 'SELECT id, role FROM admins WHERE role_id IS NULL'
                : 'SELECT id, role FROM admins WHERE role_id IS NULL'
        );
        
        if (!admins.rows || admins.rows.length === 0) {
            return;
        }
        
        for (const admin of admins.rows) {
            // 根據舊的 role 欄位找到對應的 role_id
            let roleName = admin.role || 'admin';
            
            // 映射舊角色名稱到新角色
            const roleMapping = {
                'super_admin': 'super_admin',
                'admin': 'admin',
                'staff': 'staff',
                'finance': 'finance',
                'viewer': 'viewer'
            };
            
            roleName = roleMapping[roleName] || 'admin';
            
            const role = await queryOne(
                usePostgreSQL
                    ? 'SELECT id FROM roles WHERE role_name = $1'
                    : 'SELECT id FROM roles WHERE role_name = ?',
                [roleName]
            );
            
            if (role) {
                await query(
                    usePostgreSQL
                        ? 'UPDATE admins SET role_id = $1 WHERE id = $2'
                        : 'UPDATE admins SET role_id = ? WHERE id = ?',
                    [role.id, admin.id]
                );
            }
        }
        console.log('✅ 現有管理員已遷移到新角色系統');
    } catch (error) {
        console.error('❌ 遷移管理員角色失敗:', error.message);
        // 不拋出錯誤，因為這不是關鍵操作
    }
}

// 取得管理員所有權限
async function getAdminPermissions(adminId) {
    try {
        const sql = usePostgreSQL
            ? `SELECT DISTINCT p.permission_code 
               FROM permissions p
               INNER JOIN role_permissions rp ON p.id = rp.permission_id
               INNER JOIN roles r ON rp.role_id = r.id
               INNER JOIN admins a ON a.role_id = r.id
               WHERE a.id = $1`
            : `SELECT DISTINCT p.permission_code 
               FROM permissions p
               INNER JOIN role_permissions rp ON p.id = rp.permission_id
               INNER JOIN roles r ON rp.role_id = r.id
               INNER JOIN admins a ON a.role_id = r.id
               WHERE a.id = ?`;
        
        const result = await query(sql, [adminId]);
        return result.rows.map(row => row.permission_code);
    } catch (error) {
        console.error('❌ 取得管理員權限失敗:', error.message);
        return [];
    }
}

// 檢查管理員是否有特定權限
async function hasPermission(adminId, permissionCode) {
    try {
        const sql = usePostgreSQL
            ? `SELECT 1 
               FROM permissions p
               INNER JOIN role_permissions rp ON p.id = rp.permission_id
               INNER JOIN roles r ON rp.role_id = r.id
               INNER JOIN admins a ON a.role_id = r.id
               WHERE a.id = $1 AND p.permission_code = $2
               LIMIT 1`
            : `SELECT 1 
               FROM permissions p
               INNER JOIN role_permissions rp ON p.id = rp.permission_id
               INNER JOIN roles r ON rp.role_id = r.id
               INNER JOIN admins a ON a.role_id = r.id
               WHERE a.id = ? AND p.permission_code = ?
               LIMIT 1`;
        
        const result = await queryOne(sql, [adminId, permissionCode]);
        return !!result;
    } catch (error) {
        console.error('❌ 檢查權限失敗:', error.message);
        return false;
    }
}

// 取得角色的所有權限
async function getRolePermissions(roleId) {
    try {
        const sql = usePostgreSQL
            ? `SELECT p.permission_code, p.permission_name, p.module, p.description
               FROM permissions p
               INNER JOIN role_permissions rp ON p.id = rp.permission_id
               WHERE rp.role_id = $1
               ORDER BY p.module, p.permission_code`
            : `SELECT p.permission_code, p.permission_name, p.module, p.description
               FROM permissions p
               INNER JOIN role_permissions rp ON p.id = rp.permission_id
               WHERE rp.role_id = ?
               ORDER BY p.module, p.permission_code`;
        
        const result = await query(sql, [roleId]);
        return result.rows;
    } catch (error) {
        console.error('❌ 取得角色權限失敗:', error.message);
        return [];
    }
}

// 取得所有角色
async function getAllRoles() {
    try {
        const sql = `SELECT r.*, 
                     (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id) as permission_count,
                     (SELECT COUNT(*) FROM admins WHERE role_id = r.id) as admin_count
                     FROM roles r 
                     ORDER BY r.id`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 取得所有角色失敗:', error.message);
        throw error;
    }
}

// 取得角色詳情（包含權限）
async function getRoleById(roleId) {
    try {
        const sql = usePostgreSQL
            ? 'SELECT * FROM roles WHERE id = $1'
            : 'SELECT * FROM roles WHERE id = ?';
        const role = await queryOne(sql, [roleId]);
        
        if (role) {
            role.permissions = await getRolePermissions(roleId);
        }
        
        return role;
    } catch (error) {
        console.error('❌ 取得角色詳情失敗:', error.message);
        throw error;
    }
}

// 取得所有權限（按模組分組）
async function getAllPermissions() {
    try {
        const sql = 'SELECT * FROM permissions ORDER BY module, permission_code';
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 取得所有權限失敗:', error.message);
        throw error;
    }
}

// 取得所有權限（按模組分組）
async function getAllPermissionsGrouped() {
    try {
        const permissions = await getAllPermissions();
        const grouped = {};
        
        for (const perm of permissions) {
            if (!grouped[perm.module]) {
                grouped[perm.module] = [];
            }
            grouped[perm.module].push(perm);
        }
        
        return grouped;
    } catch (error) {
        console.error('❌ 取得權限分組失敗:', error.message);
        throw error;
    }
}

// 建立新角色
async function createRole(roleData) {
    try {
        const { role_name, display_name, description } = roleData;
        
        const sql = usePostgreSQL
            ? 'INSERT INTO roles (role_name, display_name, description) VALUES ($1, $2, $3) RETURNING id'
            : 'INSERT INTO roles (role_name, display_name, description) VALUES (?, ?, ?)';
        
        const result = await query(sql, [role_name, display_name, description || '']);
        
        return usePostgreSQL ? result.rows[0].id : result.lastID;
    } catch (error) {
        console.error('❌ 建立角色失敗:', error.message);
        throw error;
    }
}

// 更新角色
async function updateRole(roleId, roleData) {
    try {
        const { display_name, description } = roleData;
        
        const sql = usePostgreSQL
            ? 'UPDATE roles SET display_name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND is_system_role = 0'
            : 'UPDATE roles SET display_name = ?, description = ?, updated_at = datetime(\'now\') WHERE id = ? AND is_system_role = 0';
        
        const result = await query(sql, [display_name, description || '', roleId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 更新角色失敗:', error.message);
        throw error;
    }
}

// 刪除角色
async function deleteRole(roleId) {
    try {
        // 檢查是否為系統角色
        const role = await queryOne(
            usePostgreSQL ? 'SELECT is_system_role FROM roles WHERE id = $1' : 'SELECT is_system_role FROM roles WHERE id = ?',
            [roleId]
        );
        
        if (!role) {
            throw new Error('角色不存在');
        }
        
        if (role.is_system_role) {
            throw new Error('無法刪除系統內建角色');
        }
        
        // 檢查是否有管理員使用此角色
        const adminCount = await queryOne(
            usePostgreSQL ? 'SELECT COUNT(*) as count FROM admins WHERE role_id = $1' : 'SELECT COUNT(*) as count FROM admins WHERE role_id = ?',
            [roleId]
        );
        
        if (adminCount && parseInt(adminCount.count) > 0) {
            throw new Error('此角色仍有管理員使用中，無法刪除');
        }
        
        const sql = usePostgreSQL
            ? 'DELETE FROM roles WHERE id = $1 AND is_system_role = 0'
            : 'DELETE FROM roles WHERE id = ? AND is_system_role = 0';
        
        const result = await query(sql, [roleId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 刪除角色失敗:', error.message);
        throw error;
    }
}

// 更新角色權限
async function updateRolePermissions(roleId, permissionCodes) {
    try {
        // 檢查是否為超級管理員角色（不允許修改）
        const role = await queryOne(
            usePostgreSQL ? 'SELECT role_name FROM roles WHERE id = $1' : 'SELECT role_name FROM roles WHERE id = ?',
            [roleId]
        );
        
        if (role && role.role_name === 'super_admin') {
            throw new Error('無法修改超級管理員的權限');
        }
        
        // 刪除現有權限
        await query(
            usePostgreSQL ? 'DELETE FROM role_permissions WHERE role_id = $1' : 'DELETE FROM role_permissions WHERE role_id = ?',
            [roleId]
        );
        
        // 新增新的權限
        for (const permCode of permissionCodes) {
            const perm = await queryOne(
                usePostgreSQL 
                    ? 'SELECT id FROM permissions WHERE permission_code = $1'
                    : 'SELECT id FROM permissions WHERE permission_code = ?',
                [permCode]
            );
            
            if (perm) {
                await query(
                    usePostgreSQL 
                        ? 'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)'
                        : 'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                    [roleId, perm.id]
                );
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ 更新角色權限失敗:', error.message);
        throw error;
    }
}

// 取得所有管理員（包含角色資訊）
async function getAllAdmins() {
    try {
        const sql = `SELECT a.id, a.username, a.email, a.role, a.role_id, a.department, a.phone, a.notes,
                     a.created_at, a.last_login, a.is_active,
                     r.display_name as role_display_name, r.role_name
                     FROM admins a
                     LEFT JOIN roles r ON a.role_id = r.id
                     ORDER BY a.id`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 取得所有管理員失敗:', error.message);
        throw error;
    }
}

// 取得管理員詳情（包含權限）
async function getAdminById(adminId) {
    try {
        const sql = usePostgreSQL
            ? `SELECT a.*, r.display_name as role_display_name, r.role_name
               FROM admins a
               LEFT JOIN roles r ON a.role_id = r.id
               WHERE a.id = $1`
            : `SELECT a.*, r.display_name as role_display_name, r.role_name
               FROM admins a
               LEFT JOIN roles r ON a.role_id = r.id
               WHERE a.id = ?`;
        const admin = await queryOne(sql, [adminId]);
        
        if (admin) {
            admin.permissions = await getAdminPermissions(adminId);
            // 移除敏感資訊
            delete admin.password_hash;
        }
        
        return admin;
    } catch (error) {
        console.error('❌ 取得管理員詳情失敗:', error.message);
        throw error;
    }
}

// 建立管理員
async function createAdmin(adminData) {
    try {
        const { username, password, email, role_id, department, phone, notes } = adminData;
        
        const bcrypt = require('bcrypt');
        const passwordHash = await bcrypt.hash(password, 10);
        
        const sql = usePostgreSQL
            ? `INSERT INTO admins (username, password_hash, email, role_id, department, phone, notes) 
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`
            : `INSERT INTO admins (username, password_hash, email, role_id, department, phone, notes) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        const result = await query(sql, [username, passwordHash, email || '', role_id, department || '', phone || '', notes || '']);
        
        return usePostgreSQL ? result.rows[0].id : result.lastID;
    } catch (error) {
        console.error('❌ 建立管理員失敗:', error.message);
        throw error;
    }
}

// 更新管理員
async function updateAdmin(adminId, adminData) {
    try {
        const { email, role_id, department, phone, notes, is_active } = adminData;
        
        const sql = usePostgreSQL
            ? `UPDATE admins SET email = $1, role_id = $2, department = $3, phone = $4, notes = $5, is_active = $6
               WHERE id = $7`
            : `UPDATE admins SET email = ?, role_id = ?, department = ?, phone = ?, notes = ?, is_active = ?
               WHERE id = ?`;
        
        const result = await query(sql, [email || '', role_id, department || '', phone || '', notes || '', is_active !== undefined ? is_active : 1, adminId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 更新管理員失敗:', error.message);
        throw error;
    }
}

// 刪除管理員
async function deleteAdmin(adminId) {
    try {
        // 檢查是否為最後一個超級管理員
        const admin = await queryOne(
            usePostgreSQL ? 'SELECT role_id FROM admins WHERE id = $1' : 'SELECT role_id FROM admins WHERE id = ?',
            [adminId]
        );
        
        if (admin) {
            const superAdminRole = await queryOne(
                usePostgreSQL ? 'SELECT id FROM roles WHERE role_name = $1' : 'SELECT id FROM roles WHERE role_name = ?',
                ['super_admin']
            );
            
            if (superAdminRole && admin.role_id === superAdminRole.id) {
                const superAdminCount = await queryOne(
                    usePostgreSQL ? 'SELECT COUNT(*) as count FROM admins WHERE role_id = $1' : 'SELECT COUNT(*) as count FROM admins WHERE role_id = ?',
                    [superAdminRole.id]
                );
                
                if (superAdminCount && parseInt(superAdminCount.count) <= 1) {
                    throw new Error('無法刪除最後一個超級管理員');
                }
            }
        }
        
        const sql = usePostgreSQL
            ? 'DELETE FROM admins WHERE id = $1'
            : 'DELETE FROM admins WHERE id = ?';
        
        const result = await query(sql, [adminId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 刪除管理員失敗:', error.message);
        throw error;
    }
}

// 更新管理員角色
async function updateAdminRole(adminId, roleId) {
    try {
        const sql = usePostgreSQL
            ? 'UPDATE admins SET role_id = $1 WHERE id = $2'
            : 'UPDATE admins SET role_id = ? WHERE id = ?';
        
        const result = await query(sql, [roleId, adminId]);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ 更新管理員角色失敗:', error.message);
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
    getMonthlyComparison,
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
    // 會員等級管理
    getAllMemberLevels,
    getMemberLevelById,
    createMemberLevel,
    updateMemberLevel,
    deleteMemberLevel,
    calculateCustomerLevel,
    // 優惠代碼管理
    getAllPromoCodes,
    getPromoCodeById,
    getPromoCodeByCode,
    validatePromoCode,
    createPromoCode,
    updatePromoCode,
    deletePromoCode,
    recordPromoCodeUsage,
    getPromoCodeUsageStats,
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
    getLogFilterOptions,
    // 個資保護
    anonymizeCustomerData,
    deleteCustomerData,
    // 權限管理系統
    initRolesAndPermissions,
    getAdminPermissions,
    hasPermission,
    getRolePermissions,
    getAllRoles,
    getRoleById,
    getAllPermissions,
    getAllPermissionsGrouped,
    createRole,
    updateRole,
    deleteRole,
    updateRolePermissions,
    getAllAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    deleteAdmin,
    updateAdminRole,
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

