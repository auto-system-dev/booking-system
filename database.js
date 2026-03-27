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
                    building_id INTEGER DEFAULT 1,
                    room_selections TEXT,
                    guest_name VARCHAR(255) NOT NULL,
                    guest_phone VARCHAR(255) NOT NULL,
                    guest_email VARCHAR(255) NOT NULL,
                    special_request TEXT,
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
                    booking_mode VARCHAR(50) DEFAULT 'retail',
                    utm_source VARCHAR(120),
                    utm_medium VARCHAR(120),
                    utm_campaign VARCHAR(160),
                    booking_source VARCHAR(120),
                    referrer TEXT,
                    discount_amount DECIMAL(10,2) DEFAULT 0,
                    discount_description TEXT,
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

            // 新增 booking_mode 欄位（如果不存在）
            try {
                await query(`
                    ALTER TABLE bookings
                    ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(50) DEFAULT 'retail'
                `);
                console.log('✅ booking_mode 欄位已準備就緒');
            } catch (err) {
                if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
                    console.warn('⚠️  新增 booking_mode 欄位時發生錯誤:', err.message);
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
                { name: 'special_request', type: 'TEXT', default: null },
                { name: 'room_selections', type: 'TEXT', default: null },
                { name: 'payment_deadline', type: 'TEXT', default: null },
                { name: 'days_reserved', type: 'INTEGER', default: null },
                { name: 'utm_source', type: 'VARCHAR(120)', default: null },
                { name: 'utm_medium', type: 'VARCHAR(120)', default: null },
                { name: 'utm_campaign', type: 'VARCHAR(160)', default: null },
                { name: 'booking_source', type: 'VARCHAR(120)', default: null },
                { name: 'referrer', type: 'TEXT', default: null },
                { name: 'discount_amount', type: 'DECIMAL(10,2)', default: '0' },
                { name: 'discount_description', type: 'TEXT', default: null },
                { name: 'building_id', type: 'INTEGER', default: '1' }
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
            
            // 回填既有訂單的 building_id（舊資料預設為預設館）
            try {
                await query(`UPDATE bookings SET building_id = 1 WHERE building_id IS NULL`);
            } catch (err) {
                console.warn('⚠️  回填 bookings.building_id 失敗:', err.message);
            }
            
            // 建立房型設定表
            // ===== 館別（buildings）=====
            await query(`
                CREATE TABLE IF NOT EXISTS buildings (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(80) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // 預設館（保底，讓舊系統在只有 1 館時不需改前台流程）
            try {
                await query(
                    `INSERT INTO buildings (id, code, name, display_order, is_active)
                     VALUES (1, 'default', '預設館', 0, 1)
                     ON CONFLICT (id) DO NOTHING`
                );
                await query(
                    `INSERT INTO buildings (code, name, display_order, is_active)
                     VALUES ('default', '預設館', 0, 1)
                     ON CONFLICT (code) DO NOTHING`
                );
            } catch (err) {
                // 相容舊版 Postgres / 欄位已存在狀況
                if (!String(err.message || '').includes('conflict')) {
                    console.warn('⚠️  初始化預設館別時發生錯誤:', err.message);
                }
            }

            await query(`
                CREATE TABLE IF NOT EXISTS room_types (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    building_id INTEGER DEFAULT 1,
                    display_name VARCHAR(255) NOT NULL,
                    price INTEGER NOT NULL,
                    original_price INTEGER DEFAULT 0,
                    holiday_surcharge INTEGER DEFAULT 0,
                    max_occupancy INTEGER DEFAULT 0,
                    extra_beds INTEGER DEFAULT 0,
                    extra_bed_price INTEGER DEFAULT 0,
                    bed_config TEXT DEFAULT '',
                    included_items TEXT DEFAULT '',
                    booking_badge TEXT DEFAULT '',
                    icon VARCHAR(255) DEFAULT '🏠',
                    image_url TEXT DEFAULT NULL,
                    show_on_landing INTEGER DEFAULT 1,
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 房型設定表已準備就緒');
            
            // 檢查並添加欄位（如果不存在）- 使用 ADD COLUMN IF NOT EXISTS（PostgreSQL 9.6+）
            const roomTypeColumnsToAdd = [
                { name: 'building_id', type: 'INTEGER', default: '1' },
                { name: 'holiday_surcharge', type: 'INTEGER', default: '0' },
                { name: 'max_occupancy', type: 'INTEGER', default: '0' },
                { name: 'extra_beds', type: 'INTEGER', default: '0' },
                { name: 'extra_bed_price', type: 'INTEGER', default: '0' },
                { name: 'bed_config', type: 'TEXT', default: "''" },
                { name: 'included_items', type: 'TEXT', default: "''" },
                { name: 'booking_badge', type: 'TEXT', default: "''" },
                { name: 'image_url', type: 'TEXT', default: "NULL" },
                { name: 'original_price', type: 'INTEGER', default: '0' },
                { name: 'show_on_landing', type: 'INTEGER', default: '1' }
            ];
            
            for (const col of roomTypeColumnsToAdd) {
                try {
                    await query(`ALTER TABLE room_types ADD COLUMN IF NOT EXISTS ${col.name} ${col.type} DEFAULT ${col.default}`);
                } catch (addErr) {
                    // 如果 ADD COLUMN IF NOT EXISTS 不支援，使用舊方式
                    if (addErr.message && !addErr.message.includes('already exists') && !addErr.message.includes('duplicate column')) {
                        try {
                            const checkResult = await query(`
                                SELECT column_name FROM information_schema.columns 
                                WHERE table_name = 'room_types' AND column_name = $1
                            `, [col.name]);
                            if (!checkResult.rows || checkResult.rows.length === 0) {
                                await query(`ALTER TABLE room_types ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`);
                                console.log(`✅ 已添加 room_types.${col.name} 欄位`);
                            }
                        } catch (innerErr) {
                            console.warn(`⚠️  添加 room_types.${col.name} 欄位時發生錯誤:`, innerErr.message);
                        }
                    }
                }
            }
            console.log('✅ room_types 欄位遷移完成');

            // 確保既有房型資料都有 building_id（舊資料回填預設館）
            try {
                await query(`UPDATE room_types SET building_id = 1 WHERE building_id IS NULL`);
            } catch (err) {
                console.warn('⚠️  回填 room_types.building_id 失敗:', err.message);
            }

            // 調整唯一性：room_types.name 不需全站唯一，改為同館別內唯一（building_id + name）
            // 避免多館別時相同房型代碼（例如 standard）衝突
            try {
                // 若原本存在 name 的 UNIQUE constraint（常見名稱：room_types_name_key），嘗試移除
                await query(`ALTER TABLE room_types DROP CONSTRAINT IF EXISTS room_types_name_key`);
            } catch (err) {
                // 不阻斷：有些環境 constraint 名稱不同或已移除
            }
            try {
                // 再用索引確保唯一性（避免 constraint 名稱不一致的問題）
                await query(`CREATE UNIQUE INDEX IF NOT EXISTS room_types_building_id_name_key ON room_types (building_id, name)`);
            } catch (err) {
                console.warn('⚠️  建立 room_types(building_id,name) 唯一索引失敗:', err.message);
            }

            // ===== 房型庫存（每館每房型）=====
            try {
                await query(`
                    CREATE TABLE IF NOT EXISTS room_type_inventory (
                        id SERIAL PRIMARY KEY,
                        building_id INTEGER NOT NULL,
                        room_type_id INTEGER NOT NULL,
                        qty_total INTEGER NOT NULL DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (building_id, room_type_id)
                    )
                `);
            } catch (err) {
                console.warn('⚠️  建立 room_type_inventory 失敗:', err.message);
            }
            // 初始化既有房型庫存：qty_total=1（僅對尚未建立者）
            try {
                await query(`
                    INSERT INTO room_type_inventory (building_id, room_type_id, qty_total)
                    SELECT COALESCE(rt.building_id, 1) as building_id, rt.id as room_type_id, 1 as qty_total
                    FROM room_types rt
                    LEFT JOIN room_type_inventory inv
                      ON inv.building_id = COALESCE(rt.building_id, 1) AND inv.room_type_id = rt.id
                    WHERE inv.id IS NULL
                `);
            } catch (_) { /* ignore */ }

            // room_type_inventory FK（非必要）
            try {
                await query(`
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.table_constraints
                            WHERE constraint_type = 'FOREIGN KEY'
                              AND table_name = 'room_type_inventory'
                              AND constraint_name = 'fk_inv_building'
                        ) THEN
                            ALTER TABLE room_type_inventory
                                ADD CONSTRAINT fk_inv_building
                                FOREIGN KEY (building_id) REFERENCES buildings(id)
                                ON DELETE CASCADE;
                        END IF;
                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.table_constraints
                            WHERE constraint_type = 'FOREIGN KEY'
                              AND table_name = 'room_type_inventory'
                              AND constraint_name = 'fk_inv_roomtype'
                        ) THEN
                            ALTER TABLE room_type_inventory
                                ADD CONSTRAINT fk_inv_roomtype
                                FOREIGN KEY (room_type_id) REFERENCES room_types(id)
                                ON DELETE CASCADE;
                        END IF;
                    END $$;
                `);
            } catch (_) { /* ignore */ }

            // 盡量加上 FK（若已存在或權限不足則略過）
            try {
                await query(`
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.table_constraints
                            WHERE constraint_type = 'FOREIGN KEY'
                              AND table_name = 'room_types'
                              AND constraint_name = 'fk_room_types_building'
                        ) THEN
                            ALTER TABLE room_types
                                ADD CONSTRAINT fk_room_types_building
                                FOREIGN KEY (building_id) REFERENCES buildings(id)
                                ON DELETE RESTRICT;
                        END IF;
                    END $$;
                `);
            } catch (err) {
                // 非必要，失敗不阻斷
            }
            
            // 建立房型圖庫表（多張照片）
            await query(`
                CREATE TABLE IF NOT EXISTS room_type_images (
                    id SERIAL PRIMARY KEY,
                    room_type_id INTEGER NOT NULL,
                    image_url TEXT NOT NULL,
                    display_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 房型圖庫表已準備就緒');
            
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
                    unit_label VARCHAR(50) DEFAULT '人',
                    summary VARCHAR(120) DEFAULT '',
                    details TEXT DEFAULT '',
                    terms TEXT DEFAULT '',
                    icon VARCHAR(255) DEFAULT '➕',
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 加購商品表已準備就緒');

            // 加購商品欄位遷移（舊資料庫補上 unit_label）
            try {
                await query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS unit_label VARCHAR(50) DEFAULT '人'`);
                await query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS summary VARCHAR(120) DEFAULT ''`);
                await query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS details TEXT DEFAULT ''`);
                await query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS terms TEXT DEFAULT ''`);
            } catch (addErr) {
                if (addErr.message && !addErr.message.includes('already exists') && !addErr.message.includes('duplicate column')) {
                    try {
                        const checkResult = await query(`
                            SELECT column_name FROM information_schema.columns
                            WHERE table_name = 'addons' AND column_name = ANY($1)
                        `, [['unit_label', 'summary', 'details', 'terms']]);
                        const existingColumns = new Set((checkResult.rows || []).map(row => row.column_name));
                        if (!existingColumns.has('unit_label')) {
                            await query(`ALTER TABLE addons ADD COLUMN unit_label VARCHAR(50) DEFAULT '人'`);
                            console.log('✅ 已添加 addons.unit_label 欄位');
                        }
                        if (!existingColumns.has('summary')) {
                            await query(`ALTER TABLE addons ADD COLUMN summary VARCHAR(120) DEFAULT ''`);
                            console.log('✅ 已添加 addons.summary 欄位');
                        }
                        if (!existingColumns.has('details')) {
                            await query(`ALTER TABLE addons ADD COLUMN details TEXT DEFAULT ''`);
                            console.log('✅ 已添加 addons.details 欄位');
                        }
                        if (!existingColumns.has('terms')) {
                            await query(`ALTER TABLE addons ADD COLUMN terms TEXT DEFAULT ''`);
                            console.log('✅ 已添加 addons.terms 欄位');
                        }
                    } catch (innerErr) {
                        console.warn('⚠️  添加 addons 延伸欄位時發生錯誤:', innerErr.message);
                    }
                }
            }
            
            // 初始化預設加購商品
            const defaultAddons = [
                ['breakfast', '早餐', 200, '人', '🍳', 1],
                ['afternoon_tea', '下午茶', 300, '份', '☕', 2],
                ['dinner', '晚餐', 600, '份', '🍽️', 3],
                ['bbq', '烤肉', 800, '份', '🔥', 4],
                ['spa', 'SPA', 1000, '人', '💆', 5]
            ];
            
            for (const [name, displayName, price, unitLabel, icon, displayOrder] of defaultAddons) {
                try {
                    const existing = await queryOne('SELECT id FROM addons WHERE name = $1', [name]);
                    if (!existing) {
                        await query(
                            'INSERT INTO addons (name, display_name, price, unit_label, icon, display_order) VALUES ($1, $2, $3, $4, $5, $6)',
                            [name, displayName, price, unitLabel, icon, displayOrder]
                        );
                    }
                } catch (err) {
                    console.warn(`⚠️  初始化加購商品 ${name} 失敗:`, err.message);
                }
            }
            console.log('✅ 預設加購商品已初始化');

            // 已改為「房型內加床」，清理舊版加購商品「加床」
            await query(`DELETE FROM addons WHERE name = 'extra_bed'`);
            
            // 初始化預設房型
            const roomCount = await queryOne('SELECT COUNT(*) as count FROM room_types');
            if (roomCount && parseInt(roomCount.count) === 0) {
                const defaultRooms = [
                    ['standard', '標準雙人房', 2000, 2, 0, '🏠', 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80', 1],
                    ['deluxe', '豪華雙人房', 3500, 2, 0, '✨', 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80', 2],
                    ['suite', '尊爵套房', 5000, 2, 0, '👑', 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80', 3],
                    ['family', '家庭四人房', 4500, 4, 0, '👨‍👩‍👧‍👦', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=80', 4]
                ];
                
                for (const room of defaultRooms) {
                    await query(
                        'INSERT INTO room_types (name, display_name, price, max_occupancy, extra_beds, extra_bed_price, icon, image_url, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                        [room[0], room[1], room[2], room[3], room[4], 0, room[5], room[6], room[7]]
                    );
                }
                console.log('✅ 預設房型已初始化');
            }
            
            // 為已有的房型補上預設照片（如果 image_url 為空）
            const defaultImages = {
                'standard': 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80',
                'deluxe': 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80',
                'suite': 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80',
                'family': 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=80'
            };
            
            // 需要被替換的舊照片 URL（用於更新已過時的預設照片）
            const oldImageUrls = [
                'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=800&q=80'
            ];
            
            for (const [roomName, imageUrl] of Object.entries(defaultImages)) {
                try {
                    // 更新空的或舊版預設照片
                    let condition = '(image_url IS NULL OR image_url = $3';
                    const params = [imageUrl, roomName, ''];
                    oldImageUrls.forEach((oldUrl, idx) => {
                        condition += ` OR image_url = $${idx + 4}`;
                        params.push(oldUrl);
                    });
                    condition += ')';
                    
                    await query(
                        `UPDATE room_types SET image_url = $1 WHERE name = $2 AND ${condition}`,
                        params
                    );
                } catch (err) {
                    // 靜默處理
                }
            }
            console.log('✅ 房型預設照片已檢查/補齊');
            
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
                ['system_mode', 'retail', '系統模式（retail=散客訂房，whole_property=包棟訂房；每次僅啟用一種）'],
                ['min_room_count', '1', '前台客房數最小值（預設 1）'],
                ['max_room_count', '1', '前台客房數最大值（預設 1）'],
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
            
            // 建立早鳥/晚鳥優惠設定表
            await query(`
                CREATE TABLE IF NOT EXISTS early_bird_settings (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    discount_type VARCHAR(20) NOT NULL DEFAULT 'percent',
                    discount_value DECIMAL(10,2) NOT NULL,
                    min_days_before INTEGER NOT NULL DEFAULT 0,
                    max_days_before INTEGER DEFAULT NULL,
                    max_discount INTEGER DEFAULT NULL,
                    apply_day_type VARCHAR(20) DEFAULT 'all',
                    applicable_room_types TEXT DEFAULT NULL,
                    is_active INTEGER DEFAULT 1,
                    priority INTEGER DEFAULT 0,
                    start_date DATE DEFAULT NULL,
                    end_date DATE DEFAULT NULL,
                    description TEXT DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ 早鳥/晚鳥優惠設定表已準備就緒');
            try {
                await query(`ALTER TABLE early_bird_settings ADD COLUMN IF NOT EXISTS apply_day_type VARCHAR(20) DEFAULT 'all'`);
            } catch (err) {
                if (!err.message || (!err.message.includes('already exists') && !err.message.includes('duplicate column'))) {
                    console.warn('⚠️  添加 early_bird_settings.apply_day_type 欄位時發生錯誤:', err.message);
                }
            }
            
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
                <p style="margin: 8px 0 0 0;">匯款後請加入官方LINE告知，謝謝！</p>
            </div>
            
            {{#if isDeposit}}
            <div class="remaining-box">
                <h2 style="margin-top: 0; color: #2e7d32;">💡 剩餘尾款於現場付清！</h2>
                <p style="margin: 10px 0 0 0; color: #2e7d32; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ {{remainingAmount}}</p>
            </div>
            {{/if}}
            
            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            <p style="margin-top: 20px;">如有任何問題，請隨時與我們聯繫。</p>
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
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.8; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { font-size: 28px; font-weight: bold; margin: 0 0 10px 0; }
        .header p { font-size: 18px; margin: 0; opacity: 0.95; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #4caf50; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; font-size: 16px; min-width: 140px; flex: 0 0 auto; }
        .info-value { color: #333; font-size: 16px; text-align: right; font-weight: 500; flex: 1 1 auto; word-break: break-word; }
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
        .google-review-btn,
        .google-review-btn:link,
        .google-review-btn:visited { display: inline-block; background: #1a73e8; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; padding: 14px 28px; border-radius: 6px; text-decoration: none !important; font-size: 17px; font-weight: 700; margin-top: 15px; transition: background 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); letter-spacing: 0.5px; }
        .google-review-btn:hover,
        .google-review-btn:active { background: #1557b0; box-shadow: 0 4px 8px rgba(0,0,0,0.3); color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-decoration: none !important; }

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
            .rating-section { padding: 20px 15px; margin: 20px 0; }
            .rating-stars { font-size: 28px; }
            .google-review-btn { display: block; width: 100%; box-sizing: border-box; padding: 12px 16px; font-size: 16px; }
        }
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
                <a href="{{googleReviewUrl}}" target="_blank" class="google-review-btn" style="color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; text-decoration:none !important;">在 Google 上給我們評價</a>
                {{/if}}
                <p style="margin: 15px 0 0 0; font-size: 15px; color: #666; line-height: 1.6;">您的評價將幫助其他旅客做出更好的選擇，也讓我們能持續改進服務品質</p>
            </div>
            
            <div class="info-section">
                <div class="info-section-title">💬 意見回饋</div>
                <p style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.8;">如果您有任何建議、意見或需要協助，歡迎隨時透過以下方式與我們聯繫：</p>
                <p style="margin: 0 0 8px 0; font-size: 16px;"><strong style="color: #333;">Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                <p style="margin: 0; font-size: 16px;"><strong style="color: #333;">電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 8px 0 0 0; font-size: 16px;"><strong style="color: #333;">官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;">{{officialLineUrl}}</a></p>
                {{/if}}
                <p style="margin: 8px 0 0 0; font-size: 15px; color: #2e7d32; font-weight: 600;">我們會認真聆聽您的意見，並持續改進服務品質！</p>
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
                    <p style="margin: 8px 0 0 0; color: #666; font-size: 15px; line-height: 1.6;">
                        匯款後請加入官方LINE告知，謝謝！
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

            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
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
        .contact-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #ffcc80; }
        .contact-row:last-child { border-bottom: none; }
        .contact-label { min-width: 120px; font-size: 16px; font-weight: 700; color: #5d4037; }
        .contact-value { flex: 1; font-size: 16px; color: #333; word-break: break-word; }
        
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
            .contact-row { flex-direction: column; align-items: flex-start; gap: 4px; }
            .contact-label { min-width: auto; font-size: 14px; }
            .contact-value { font-size: 15px; }
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
                <div class="contact-row">
                    <span class="contact-label">客戶姓名</span>
                    <span class="contact-value">{{guestName}}</span>
                </div>
                <div class="contact-row">
                    <span class="contact-label">聯絡電話</span>
                    <span class="contact-value">{{guestPhone}}</span>
                </div>
                <div class="contact-row">
                    <span class="contact-label">Email</span>
                    <span class="contact-value">{{guestEmail}}</span>
                </div>
                <div class="contact-row">
                    <span class="contact-label">特殊需求</span>
                    <span class="contact-value">{{specialRequest}}</span>
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
            <div style="margin-top: 30px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 700; color: #333;">聯絡資訊</p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>電話：</strong><a href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;">{{hotelPhone}}</a></p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #333;"><strong>Email：</strong><a href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;">{{hotelEmail}}</a></p>
                {{#if officialLineUrl}}
                <p style="margin: 0; font-size: 15px; color: #333;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
            </div>
            
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
                {{#if officialLineUrl}}
                <p style="color: #2e7d32; margin: 10px 0;"><strong>官方 LINE：</strong><a href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: underline;">{{officialLineUrl}}</a></p>
                {{/if}}
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

            // 檢查感謝入住模板是否缺少手機響應式
            let needsUpdateForFeedbackResponsive = false;
            if (template.key === 'feedback_request' && existing && existing.content && existing.content.trim() !== '') {
                const hasViewport = existing.content.includes('meta name="viewport"');
                const hasMediaQuery = existing.content.includes('@media only screen and (max-width: 600px)');
                const hasMobileInfoRow = existing.content.includes('.info-row { flex-direction: column');
                if (!hasViewport || !hasMediaQuery || !hasMobileInfoRow) {
                    needsUpdateForFeedbackResponsive = true;
                    console.log(`⚠️ 感謝入住模板缺少手機響應式結構，需要更新`);
                }
            }

            // 檢查感謝入住模板是否缺少官方 LINE 聯絡資訊
            let needsUpdateForFeedbackOfficialLine = false;
            if (template.key === 'feedback_request' && existing && existing.content && existing.content.trim() !== '') {
                const hasOfficialLineField = existing.content.includes('{{officialLineUrl}}');
                if (!hasOfficialLineField) {
                    needsUpdateForFeedbackOfficialLine = true;
                    console.log(`⚠️ 感謝入住模板缺少官方 LINE 聯絡資訊，需要更新`);
                }
            }

            // 檢查感謝入住模板是否仍有舊樣式（聯絡資訊前方小圖示、白底區塊）
            let needsUpdateForFeedbackContactStyle = false;
            if (template.key === 'feedback_request' && existing && existing.content && existing.content.trim() !== '') {
                const hasLegacyIcons = existing.content.includes('📧 Email') || existing.content.includes('📞 電話') || existing.content.includes('💬 官方 LINE');
                const hasLegacyWhiteBox = existing.content.includes('background: white; padding: 15px; border-radius: 6px; margin-bottom: 12px;');
                if (hasLegacyIcons || hasLegacyWhiteBox) {
                    needsUpdateForFeedbackContactStyle = true;
                    console.log(`⚠️ 感謝入住模板仍為舊聯絡資訊樣式，需要更新`);
                }
            }

            // 檢查感謝入住模板是否仍使用舊色彩與舊行距（聯絡資訊藍字、結語無上間距）
            let needsUpdateForFeedbackContactTextColorAndSpacing = false;
            if (template.key === 'feedback_request' && existing && existing.content && existing.content.trim() !== '') {
                const hasBlackContactLinks = existing.content.includes('href="mailto:{{hotelEmail}}" style="color: #333; text-decoration: none;"') ||
                    existing.content.includes('href="tel:{{hotelPhone}}" style="color: #333; text-decoration: none;"') ||
                    existing.content.includes('href="{{officialLineUrl}}" target="_blank" style="color: #333; text-decoration: none;"');
                const hasGreenContactLabels = existing.content.includes('<strong style="color: #2e7d32;">Email：</strong>') ||
                    existing.content.includes('<strong style="color: #2e7d32;">電話：</strong>') ||
                    existing.content.includes('<strong style="color: #2e7d32;">官方 LINE：</strong>');
                const hasOldClosingSpacing = existing.content.includes('<p style="margin: 0; font-size: 15px; color: #2e7d32; font-weight: 600;">我們會認真聆聽您的意見，並持續改進服務品質！</p>');
                const hasExpectedBlueEmailLink = existing.content.includes('href="mailto:{{hotelEmail}}" style="color: #1976d2; text-decoration: none;"');
                const hasExpectedBluePhoneLink = existing.content.includes('href="tel:{{hotelPhone}}" style="color: #1976d2; text-decoration: none;"');
                const hasExpectedBlueLineLink = existing.content.includes('href="{{officialLineUrl}}" target="_blank" style="color: #1976d2; text-decoration: none;"');
                const missingExpectedBlueContactStyles = !hasExpectedBlueEmailLink || !hasExpectedBluePhoneLink || !hasExpectedBlueLineLink;

                if (hasBlackContactLinks || hasGreenContactLabels || hasOldClosingSpacing || missingExpectedBlueContactStyles) {
                    needsUpdateForFeedbackContactTextColorAndSpacing = true;
                    console.log(`⚠️ 感謝入住模板聯絡資訊文字顏色或結語行距仍為舊版，需要更新`);
                }
            }

            // 檢查訂房確認模板是否缺少聯絡資訊區塊（電話 / Email / 官方 LINE）
            let needsUpdateForBookingContactInfo = false;
            if (template.key === 'booking_confirmation' && existing && existing.content && existing.content.trim() !== '') {
                const hasPhoneField = existing.content.includes('{{hotelPhone}}');
                const hasEmailField = existing.content.includes('{{hotelEmail}}');
                const hasOfficialLineField = existing.content.includes('{{officialLineUrl}}');
                if (!hasPhoneField || !hasEmailField || !hasOfficialLineField) {
                    needsUpdateForBookingContactInfo = true;
                    console.log(`⚠️ 訂房確認模板缺少完整聯絡資訊區塊，需要更新`);
                }
            }

            // 檢查訂房確認模板是否缺少匯款後加入官方 LINE 提示
            let needsUpdateForBookingTransferLineNotice = false;
            if (template.key === 'booking_confirmation' && existing && existing.content && existing.content.trim() !== '') {
                const hasTransferLineNotice = existing.content.includes('匯款後請加入官方LINE告知，謝謝！');
                if (!hasTransferLineNotice) {
                    needsUpdateForBookingTransferLineNotice = true;
                    console.log('⚠️ 訂房確認模板缺少匯款後官方 LINE 提示，需要更新');
                }
            }

            // 檢查訂房確認模板是否缺少結尾文案
            let needsUpdateForBookingFooterText = false;
            if (template.key === 'booking_confirmation' && existing && existing.content && existing.content.trim() !== '') {
                const hasThanksText = existing.content.includes('感謝您的預訂，期待為您服務！');
                const hasAutoNoticeText = existing.content.includes('此為系統自動發送郵件，請勿直接回覆');
                if (!hasThanksText || !hasAutoNoticeText) {
                    needsUpdateForBookingFooterText = true;
                    console.log('⚠️ 訂房確認模板缺少結尾文案，需要更新');
                }
            }

            // 檢查訂房確認（管理員）客戶聯絡資訊排版是否仍為舊版（未對齊）
            let needsUpdateForBookingAdminContactAlign = false;
            if (template.key === 'booking_confirmation_admin' && existing && existing.content && existing.content.trim() !== '') {
                const hasNewContactLayout = existing.content.includes('.contact-row { display: flex; align-items: center;');
                const hasLegacyInlineLayout = existing.content.includes('style="min-width: auto; font-size: 16px;">客戶姓名</span>') ||
                    existing.content.includes('style="text-align: right; font-size: 16px; font-weight: 600;">{{guestName}}</span>');
                const missingSpecialRequestInContact = !existing.content.includes('<span class="contact-label">特殊需求</span>') ||
                    !existing.content.includes('{{specialRequest}}');
                if (!hasNewContactLayout || hasLegacyInlineLayout || missingSpecialRequestInContact) {
                    needsUpdateForBookingAdminContactAlign = true;
                    console.log('⚠️ 訂房確認（管理員）客戶聯絡資訊仍為舊排版，需要更新');
                }
            }
            
            // 檢查付款完成模板是否缺少聯絡資訊區塊（電話 / Email / 官方 LINE）
            let needsUpdateForPaymentCompletedContactInfo = false;
            if (template.key === 'payment_completed' && existing && existing.content && existing.content.trim() !== '') {
                const hasPhoneField = existing.content.includes('{{hotelPhone}}');
                const hasEmailField = existing.content.includes('{{hotelEmail}}');
                const hasOfficialLineField = existing.content.includes('{{officialLineUrl}}');
                if (!hasPhoneField || !hasEmailField || !hasOfficialLineField) {
                    needsUpdateForPaymentCompletedContactInfo = true;
                    console.log(`⚠️ 付款完成模板缺少完整聯絡資訊區塊，需要更新`);
                }
            }

            // 檢查取消通知模板是否缺少官方 LINE 聯絡資訊
            let needsUpdateForCancelNotificationOfficialLine = false;
            if (template.key === 'cancel_notification' && existing && existing.content && existing.content.trim() !== '') {
                const hasOfficialLineField = existing.content.includes('{{officialLineUrl}}');
                if (!hasOfficialLineField) {
                    needsUpdateForCancelNotificationOfficialLine = true;
                    console.log(`⚠️ 取消通知模板缺少官方 LINE 聯絡資訊，需要更新`);
                }
            }
            
            if (!existing || !existing.content || existing.content.trim() === '' || existing.template_name !== template.name || isContentTooShort || needsUpdateForHtmlStructure || forceUpdateCheckinReminder || forceUpdatePaymentReminder || needsUpdateForPaymentReminder || needsUpdateForFeedbackResponsive || needsUpdateForFeedbackOfficialLine || needsUpdateForFeedbackContactStyle || needsUpdateForFeedbackContactTextColorAndSpacing || needsUpdateForBookingContactInfo || needsUpdateForBookingTransferLineNotice || needsUpdateForBookingFooterText || needsUpdateForBookingAdminContactAlign || needsUpdateForPaymentCompletedContactInfo || needsUpdateForCancelNotificationOfficialLine) {
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
                } else if (needsUpdateForBookingFooterText) {
                    console.log(`✅ 已補齊訂房確認模板中的結尾文案`);
                } else if (needsUpdateForBookingAdminContactAlign) {
                    console.log('✅ 已更新訂房確認（管理員）客戶聯絡資訊排版為對齊版');
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
                    building_id INTEGER DEFAULT 1,
                    room_selections TEXT,
                    guest_name TEXT NOT NULL,
                    guest_phone TEXT NOT NULL,
                    guest_email TEXT NOT NULL,
                    special_request TEXT,
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
                    booking_mode TEXT DEFAULT 'retail',
                    utm_source TEXT,
                    utm_medium TEXT,
                    utm_campaign TEXT,
                    booking_source TEXT,
                    referrer TEXT,
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

                            db.run(`ALTER TABLE bookings ADD COLUMN booking_mode TEXT DEFAULT 'retail'`, (modeErr) => {
                                if (modeErr && !modeErr.message.includes('duplicate column')) {
                                    console.warn('⚠️  新增 booking_mode 欄位時發生錯誤:', modeErr.message);
                                }
                            });
                            
                            // 新增 discount_amount 和 discount_description 欄位
                            db.run(`ALTER TABLE bookings ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0`, (err) => {
                                if (err && !err.message.includes('duplicate column')) {
                                    console.warn('⚠️  新增 discount_amount 欄位時發生錯誤:', err.message);
                                }
                            });
                            db.run(`ALTER TABLE bookings ADD COLUMN discount_description TEXT`, (err) => {
                                if (err && !err.message.includes('duplicate column')) {
                                    console.warn('⚠️  新增 discount_description 欄位時發生錯誤:', err.message);
                                }
                            });

                            db.run(`ALTER TABLE bookings ADD COLUMN building_id INTEGER DEFAULT 1`, (err) => {
                                if (err && !err.message.includes('duplicate column')) {
                                    console.warn('⚠️  新增 bookings.building_id 欄位時發生錯誤:', err.message);
                                }
                                db.run(`UPDATE bookings SET building_id = 1 WHERE building_id IS NULL`);
                            });

                            db.run(`ALTER TABLE bookings ADD COLUMN room_selections TEXT`, (err) => {
                                if (err && !err.message.includes('duplicate column')) {
                                    console.warn('⚠️  新增 bookings.room_selections 欄位時發生錯誤:', err.message);
                                }
                            });
                            
                            // 建立房型設定表
                            db.run(`
                            CREATE TABLE IF NOT EXISTS room_types (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT UNIQUE NOT NULL,
                                building_id INTEGER DEFAULT 1,
                                display_name TEXT NOT NULL,
                                price INTEGER NOT NULL,
                                holiday_surcharge INTEGER DEFAULT 0,
                                max_occupancy INTEGER DEFAULT 0,
                                extra_beds INTEGER DEFAULT 0,
                                extra_bed_price INTEGER DEFAULT 0,
                                bed_config TEXT DEFAULT '',
                                included_items TEXT DEFAULT '',
                                booking_badge TEXT DEFAULT '',
                                icon TEXT DEFAULT '🏠',
                                image_url TEXT DEFAULT NULL,
                                show_on_landing INTEGER DEFAULT 1,
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

                                // ===== 館別（buildings）=====
                                db.run(`
                                    CREATE TABLE IF NOT EXISTS buildings (
                                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                                        code TEXT UNIQUE NOT NULL,
                                        name TEXT NOT NULL,
                                        display_order INTEGER DEFAULT 0,
                                        is_active INTEGER DEFAULT 1,
                                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                    )
                                `, (err) => {
                                    if (err) {
                                        console.warn('⚠️  建立 buildings 表時發生錯誤:', err.message);
                                    } else {
                                        // 預設館（保底）
                                        db.get('SELECT id FROM buildings WHERE id = 1 OR code = ?', ['default'], (err, row) => {
                                            if (!err && !row) {
                                                db.run(
                                                    'INSERT INTO buildings (id, code, name, display_order, is_active) VALUES (1, ?, ?, 0, 1)',
                                                    ['default', '預設館']
                                                );
                                            }
                                        });
                                    }
                                });
                                
                                // 先補上 building_id 欄位（如果不存在）
                                db.run(`ALTER TABLE room_types ADD COLUMN building_id INTEGER DEFAULT 1`, (err) => {
                                    if (err && !err.message.includes('duplicate column')) {
                                        console.warn('⚠️  添加 building_id 欄位時發生錯誤:', err.message);
                                    }
                                    // 回填既有資料
                                    db.run(`UPDATE room_types SET building_id = 1 WHERE building_id IS NULL`);
                                });

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

                                            db.run(`ALTER TABLE room_types ADD COLUMN extra_bed_price INTEGER DEFAULT 0`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 extra_bed_price 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 extra_bed_price 欄位');
                                                }
                                            });

                                            db.run(`ALTER TABLE room_types ADD COLUMN bed_config TEXT DEFAULT ''`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 bed_config 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 bed_config 欄位');
                                                }
                                            });
                                            db.run(`ALTER TABLE room_types ADD COLUMN included_items TEXT DEFAULT ''`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 included_items 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 included_items 欄位');
                                                }
                                            });
                                            db.run(`ALTER TABLE room_types ADD COLUMN booking_badge TEXT DEFAULT ''`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 booking_badge 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 booking_badge 欄位');
                                                }
                                            });
                                            
                                            db.run(`ALTER TABLE room_types ADD COLUMN image_url TEXT DEFAULT NULL`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 image_url 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 image_url 欄位');
                                                }
                                            });
                                            db.run(`ALTER TABLE room_types ADD COLUMN show_on_landing INTEGER DEFAULT 1`, (err) => {
                                                if (err && !err.message.includes('duplicate column')) {
                                                    console.warn('⚠️  添加 show_on_landing 欄位時發生錯誤:', err.message);
                                                } else {
                                                    console.log('✅ 已添加 show_on_landing 欄位');
                                                }
                                            });

                                    // ===== 房型庫存（每館每房型）=====
                                    db.run(`
                                        CREATE TABLE IF NOT EXISTS room_type_inventory (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            building_id INTEGER NOT NULL,
                                            room_type_id INTEGER NOT NULL,
                                            qty_total INTEGER NOT NULL DEFAULT 1,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            UNIQUE(building_id, room_type_id)
                                        )
                                    `, (invErr) => {
                                        if (invErr) {
                                            console.warn('⚠️  建立 room_type_inventory 表時發生錯誤:', invErr.message);
                                        } else {
                                            db.all(`SELECT id, COALESCE(building_id, 1) as building_id FROM room_types`, (selErr, rows) => {
                                                if (selErr) return;
                                                (rows || []).forEach((r) => {
                                                    db.get(
                                                        `SELECT id FROM room_type_inventory WHERE building_id = ? AND room_type_id = ?`,
                                                        [r.building_id || 1, r.id],
                                                        (gErr, row) => {
                                                            if (!gErr && !row) {
                                                                db.run(
                                                                    `INSERT INTO room_type_inventory (building_id, room_type_id, qty_total) VALUES (?, ?, 1)`,
                                                                    [r.building_id || 1, r.id]
                                                                );
                                                            }
                                                        }
                                                    );
                                                });
                                            });
                                        }
                                    });
                                        });
                                    });
                                    
                                    // 建立房型圖庫表（多張照片）
                                    db.run(`
                                        CREATE TABLE IF NOT EXISTS room_type_images (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            room_type_id INTEGER NOT NULL,
                                            image_url TEXT NOT NULL,
                                            display_order INTEGER DEFAULT 0,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `, (err) => {
                                        if (err) {
                                            console.warn('⚠️  建立 room_type_images 表時發生錯誤:', err.message);
                                        } else {
                                            console.log('✅ 房型圖庫表已準備就緒');
                                        }
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
                                                    unit_label TEXT DEFAULT '人',
                                                    summary TEXT DEFAULT '',
                                                    details TEXT DEFAULT '',
                                                    terms TEXT DEFAULT '',
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
                                                    db.run(`ALTER TABLE addons ADD COLUMN unit_label TEXT DEFAULT '人'`, (alterErr) => {
                                                        if (alterErr && !alterErr.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 addons.unit_label 欄位時發生錯誤:', alterErr.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE addons ADD COLUMN summary TEXT DEFAULT ''`, (alterErr) => {
                                                        if (alterErr && !alterErr.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 addons.summary 欄位時發生錯誤:', alterErr.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE addons ADD COLUMN details TEXT DEFAULT ''`, (alterErr) => {
                                                        if (alterErr && !alterErr.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 addons.details 欄位時發生錯誤:', alterErr.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE addons ADD COLUMN terms TEXT DEFAULT ''`, (alterErr) => {
                                                        if (alterErr && !alterErr.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 addons.terms 欄位時發生錯誤:', alterErr.message);
                                                        }
                                                    });

                                                    const defaultAddons = [
                                                        ['breakfast', '早餐', 200, '人', '🍳', 1],
                                                        ['afternoon_tea', '下午茶', 300, '份', '☕', 2],
                                                        ['dinner', '晚餐', 600, '份', '🍽️', 3],
                                                        ['bbq', '烤肉', 800, '份', '🔥', 4],
                                                        ['spa', 'SPA', 1000, '人', '💆', 5]
                                                    ];
                                                    
                                                    let addonCount = 0;
                                                    defaultAddons.forEach(([name, displayName, price, unitLabel, icon, displayOrder]) => {
                                                        db.get('SELECT id FROM addons WHERE name = ?', [name], (err, row) => {
                                                            if (!err && !row) {
                                                                db.run(
                                                                    'INSERT INTO addons (name, display_name, price, unit_label, icon, display_order) VALUES (?, ?, ?, ?, ?, ?)',
                                                                    [name, displayName, price, unitLabel, icon, displayOrder],
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

                                                    // 已改為「房型內加床」，清理舊版加購商品「加床」
                                                    db.run(`DELETE FROM addons WHERE name = 'extra_bed'`, (err) => {
                                                        if (err) {
                                                            console.warn('⚠️  清理 extra_bed 加購商品失敗:', err.message);
                                                        }
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
                                                    db.run(`ALTER TABLE bookings ADD COLUMN special_request TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 special_request 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN utm_source TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 utm_source 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN utm_medium TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 utm_medium 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN utm_campaign TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 utm_campaign 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN booking_source TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 booking_source 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE bookings ADD COLUMN referrer TEXT`, (err) => {
                                                        if (err && !err.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 referrer 欄位時發生錯誤:', err.message);
                                                        }
                                                    });
                                                });
                                            });
                                        
                                        // 初始化預設房型（如果表是空的）
                                        db.get('SELECT COUNT(*) as count FROM room_types', [], (err, row) => {
                                            if (!err && row && row.count === 0) {
                                                const defaultRooms = [
                                                    ['standard', '標準雙人房', 2000, 2, 0, '🏠', 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80', 1],
                                                    ['deluxe', '豪華雙人房', 3500, 2, 0, '✨', 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80', 2],
                                                    ['suite', '尊爵套房', 5000, 2, 0, '👑', 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80', 3],
                                                    ['family', '家庭四人房', 4500, 4, 0, '👨‍👩‍👧‍👦', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=80', 4]
                                                ];
                                                
                                                const stmt = db.prepare('INSERT INTO room_types (name, display_name, price, max_occupancy, extra_beds, extra_bed_price, icon, image_url, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
                                                defaultRooms.forEach(room => {
                                                    stmt.run(room[0], room[1], room[2], room[3], room[4], 0, room[5], room[6], room[7]);
                                                });
                                                stmt.finalize();
                                                console.log('✅ 預設房型已初始化');
                                            }
                                            
                                            // 為已有的房型補上預設照片（如果 image_url 為空）
                                            const defaultImages = {
                                                'standard': 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80',
                                                'deluxe': 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80',
                                                'suite': 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80',
                                                'family': 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=80'
                                            };
                                            
                                            Object.entries(defaultImages).forEach(([roomName, imageUrl]) => {
                                                db.run(
                                                    'UPDATE room_types SET image_url = ? WHERE name = ? AND (image_url IS NULL OR image_url = ?)',
                                                    [imageUrl, roomName, '']
                                                );
                                            });
                                            console.log('✅ 房型預設照片已檢查/補齊');
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
                                        ['system_mode', 'retail', '系統模式（retail=散客訂房，whole_property=包棟訂房；每次僅啟用一種）'],
                                        ['min_room_count', '1', '前台客房數最小值（預設 1）'],
                                        ['max_room_count', '1', '前台客房數最大值（預設 1）'],
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
                                                    
                                                    // 建立早鳥/晚鳥優惠設定表
                                                    db.run(`
                                                        CREATE TABLE IF NOT EXISTS early_bird_settings (
                                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                            name TEXT NOT NULL,
                                                            discount_type TEXT NOT NULL DEFAULT 'percent',
                                                            discount_value REAL NOT NULL,
                                                            min_days_before INTEGER NOT NULL DEFAULT 0,
                                                            max_days_before INTEGER DEFAULT NULL,
                                                            max_discount INTEGER DEFAULT NULL,
                                                            apply_day_type TEXT DEFAULT 'all',
                                                            applicable_room_types TEXT DEFAULT NULL,
                                                            is_active INTEGER DEFAULT 1,
                                                            priority INTEGER DEFAULT 0,
                                                            start_date DATE DEFAULT NULL,
                                                            end_date DATE DEFAULT NULL,
                                                            description TEXT DEFAULT NULL,
                                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                        )
                                                    `, (err) => {
                                                        if (err) {
                                                            console.warn('⚠️  建立 early_bird_settings 表時發生錯誤:', err.message);
                                                        } else {
                                                            console.log('✅ 早鳥/晚鳥優惠設定表已準備就緒');
                                                        }
                                                    });
                                                    db.run(`ALTER TABLE early_bird_settings ADD COLUMN apply_day_type TEXT DEFAULT 'all'`, (alterErr) => {
                                                        if (alterErr && !alterErr.message.includes('duplicate column')) {
                                                            console.warn('⚠️  新增 early_bird_settings.apply_day_type 欄位時發生錯誤:', alterErr.message);
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
                building_id,
                room_selections,
                guest_name, guest_phone, guest_email, special_request,
                adults, children,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status, booking_mode, addons, addons_total,
                payment_deadline, days_reserved, line_user_id,
                utm_source, utm_medium, utm_campaign, booking_source, referrer,
                discount_amount, discount_description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
            RETURNING id
        ` : `
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                building_id,
                room_selections,
                guest_name, guest_phone, guest_email, special_request,
                adults, children,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status, booking_mode, addons, addons_total,
                payment_deadline, days_reserved, line_user_id,
                utm_source, utm_medium, utm_campaign, booking_source, referrer,
                discount_amount, discount_description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const addonsJson = bookingData.addons ? JSON.stringify(bookingData.addons) : null;
        const addonsTotal = bookingData.addonsTotal || 0;
        
        // 組合折扣說明
        let discountDesc = '';
        if (bookingData.earlyBirdRule) {
            discountDesc += `早鳥優惠（${bookingData.earlyBirdRule.name}）：-NT$${bookingData.earlyBirdDiscount || 0}`;
        }
        if (bookingData.promoDiscount > 0 && bookingData.promoCode) {
            if (discountDesc) discountDesc += '；';
            discountDesc += `優惠代碼（${bookingData.promoCode}）：-NT$${bookingData.promoDiscount}`;
        }
        
        const values = [
            bookingData.bookingId,
            bookingData.checkInDate,
            bookingData.checkOutDate,
            bookingData.roomType,
            bookingData.buildingId || 1,
            bookingData.roomSelections ? JSON.stringify(bookingData.roomSelections) : null,
            bookingData.guestName,
            bookingData.guestPhone,
            bookingData.guestEmail,
            bookingData.specialRequest || null,
            bookingData.adults || 0,
            bookingData.children || 0,
            bookingData.paymentAmount,
            bookingData.paymentMethod,
            bookingData.pricePerNight,
            bookingData.nights,
            bookingData.totalAmount,
            bookingData.finalAmount,
            bookingData.bookingDate,
            bookingData.emailSent || '0',
            bookingData.paymentStatus || 'pending',
            bookingData.status || 'active',
            bookingData.bookingMode || 'retail',
            bookingData.addons ? JSON.stringify(bookingData.addons) : null,
            bookingData.addonsTotal || 0,
            bookingData.paymentDeadline || null,
            bookingData.daysReserved || null,
            bookingData.lineUserId || null,
            bookingData.utmSource || null,
            bookingData.utmMedium || null,
            bookingData.utmCampaign || null,
            bookingData.bookingSource || null,
            bookingData.referrer || null,
            bookingData.discountAmount || 0,
            discountDesc || null
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

// 查詢所有訂房記錄（可選館別）
async function getAllBookings(buildingId, bookingMode) {
    try {
        const bid = parseInt(buildingId, 10);
        const hasBuildingFilter = Number.isFinite(bid) && bid > 0;
        const safeBid = hasBuildingFilter ? bid : 1;
        const mode = ['retail', 'whole_property'].includes((bookingMode || '').toString().trim())
            ? (bookingMode || '').toString().trim()
            : '';

        let sql = `SELECT * FROM bookings WHERE 1=1`;
        const params = [];
        let paramIndex = 1;

        if (hasBuildingFilter) {
            if (usePostgreSQL) {
                sql += ` AND (building_id = $${paramIndex} OR ($${paramIndex} = 1 AND (building_id IS NULL OR building_id = 0)))`;
                params.push(safeBid);
                paramIndex += 1;
            } else {
                sql += ` AND (building_id = ? OR (? = 1 AND (building_id IS NULL OR building_id = 0)))`;
                params.push(safeBid, safeBid);
            }
        }

        if (mode) {
            if (usePostgreSQL) {
                sql += ` AND COALESCE(booking_mode, 'retail') = $${paramIndex}`;
                params.push(mode);
            } else {
                sql += ` AND COALESCE(booking_mode, 'retail') = ?`;
                params.push(mode);
            }
        }

        sql += ` ORDER BY created_at DESC`;
        const result = await query(sql, params);
        return result.rows || result || [];
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
            // 優先使用 bookings 表的 discount_amount（包含早鳥+優惠代碼），否則用 promo_code_usages 的
            if (!booking.discount_amount || parseFloat(booking.discount_amount) === 0) {
                booking.discount_amount = parseFloat(promoUsage.discount_amount || 0);
            }
            booking.original_amount = parseFloat(promoUsage.original_amount || booking.total_amount);
        }
        
        // 確保 discount_amount 是數字
        booking.discount_amount = parseFloat(booking.discount_amount || 0);
        
        console.log(`📊 getBookingById [${bookingId}]: discount_amount=${booking.discount_amount}, promoUsage=${!!promoUsage}, total_amount=${booking.total_amount}, final_amount=${booking.final_amount}, payment_amount=${booking.payment_amount}, discount_description=${booking.discount_description}`);
        
        // 嘗試從現有資料推算折扣金額（用於舊訂單沒有 discount_amount 的情況）
        // 僅在 payment_amount 可辨識為「訂金 xx%」或「全額」時才反推，避免把應付金額誤判成折扣。
        if (booking.discount_amount === 0 && !promoUsage) {
            const paymentAmountStr = booking.payment_amount || '';
            let paymentRate = null;
            
            const depositMatch = paymentAmountStr.match(/(\d+)%/);
            if (depositMatch) {
                paymentRate = parseInt(depositMatch[1]) / 100;
            } else if (paymentAmountStr.includes('全額')) {
                paymentRate = 1;
            }

            if (!paymentRate || paymentRate <= 0) {
                console.log(`📊 跳過折扣反推：無法從 payment_amount 解析付款比例 (payment_amount=${paymentAmountStr})`);
                return booking;
            }
            
            const totalAmt = parseFloat(booking.total_amount) || 0;
            const actualFinal = parseFloat(booking.final_amount) || 0;
            const expectedFinalWithoutDiscount = Math.round(totalAmt * paymentRate);
            
            console.log(`📊 折扣反推計算: paymentRate=${paymentRate}, totalAmt=${totalAmt}, actualFinal=${actualFinal}, expectedFinal=${expectedFinalWithoutDiscount}`);
            
            if (expectedFinalWithoutDiscount > actualFinal && actualFinal > 0) {
                // 有折扣，反推折扣金額
                const discountedTotal = Math.round(actualFinal / paymentRate);
                booking.discount_amount = totalAmt - discountedTotal;
                booking.original_amount = totalAmt;
                console.log(`📊 反推結果: discountedTotal=${discountedTotal}, discount_amount=${booking.discount_amount}`);
            } else {
                console.log(`📊 無需反推折扣（expectedFinal=${expectedFinalWithoutDiscount} <= actualFinal=${actualFinal}）`);
            }
        }
        
        return booking;
    } catch (error) {
        console.error('❌ 查詢訂房記錄失敗:', error.message);
        throw error;
    }
}

// 根據 Email 查詢訂房記錄
async function getBookingsByEmail(email, bookingMode) {
    try {
        const mode = ['retail', 'whole_property'].includes((bookingMode || '').toString().trim())
            ? (bookingMode || '').toString().trim()
            : '';
        const sql = usePostgreSQL
            ? `SELECT * FROM bookings WHERE guest_email = $1 ${mode ? `AND COALESCE(booking_mode, 'retail') = $2` : ''} ORDER BY created_at DESC`
            : `SELECT * FROM bookings WHERE guest_email = ? ${mode ? `AND COALESCE(booking_mode, 'retail') = ?` : ''} ORDER BY created_at DESC`;
        const params = mode ? [email, mode] : [email];
        const result = await query(sql, params);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢訂房記錄失敗:', error.message);
        throw error;
    }
}

// 根據 LINE User ID 查詢訂房記錄
async function getBookingsByLineUserId(lineUserId) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM bookings WHERE line_user_id = $1 ORDER BY created_at DESC`
            : `SELECT * FROM bookings WHERE line_user_id = ? ORDER BY created_at DESC`;
        const result = await query(sql, [lineUserId]);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢 LINE 訂房記錄失敗:', error.message);
        throw error;
    }
}

// 更新訂房資料
async function updateBooking(bookingId, updateData) {
    try {
        const allowedFields = [
            'guest_name', 'guest_phone', 'guest_email', 'special_request', 'room_type',
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

// 統計資料（可選日期區間 + 可選館別）
async function getStatistics(startDate, endDate, buildingId) {
    try {
        const hasRange = !!(startDate && endDate);
        const bid = parseInt(buildingId, 10);
        const hasBuildingFilter = Number.isFinite(bid) && bid > 0;
        const safeBid = hasBuildingFilter ? bid : 1;

        let totalSql, totalCheckedInSql, totalNotCheckedInSql;
        let revenueSql, revenuePaidSql, revenueUnpaidSql;
        let byRoomTypeSql;
        let bySourceSql;
        let transferSql, transferPaidSql, transferUnpaidSql;
        let cardSql, cardPaidSql, cardUnpaidSql;
        let params = [];

        if (usePostgreSQL) {
            // 使用入住日期（check_in_date）作為篩選條件，排除已取消的訂房
            const buildingClause = hasBuildingFilter
                ? (hasRange
                    ? ` AND (building_id = $3 OR ($3 = 1 AND (building_id IS NULL OR building_id = 0)))`
                    : ` AND (building_id = $1 OR ($1 = 1 AND (building_id IS NULL OR building_id = 0)))`)
                : '';
            const baseWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND status != 'cancelled'${buildingClause}`
                : ` WHERE status != 'cancelled'${buildingClause}`;
            
            // 總訂房數
            totalSql = `SELECT COUNT(*) as count FROM bookings${baseWhereClause}`;
            
            // 總訂房數 - 已入住（check_in_date <= 今天）
            const checkedInWhereClause = hasRange 
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND check_in_date::date <= CURRENT_DATE AND status != 'cancelled'${buildingClause}`
                : ` WHERE check_in_date::date <= CURRENT_DATE AND status != 'cancelled'${buildingClause}`;
            totalCheckedInSql = `SELECT COUNT(*) as count FROM bookings${checkedInWhereClause}`;
            
            // 總訂房數 - 未入住（check_in_date > 今天）
            const notCheckedInWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND check_in_date::date > CURRENT_DATE AND status != 'cancelled'${buildingClause}`
                : ` WHERE check_in_date::date > CURRENT_DATE AND status != 'cancelled'${buildingClause}`;
            totalNotCheckedInSql = `SELECT COUNT(*) as count FROM bookings${notCheckedInWhereClause}`;
            
            // 總營收
            revenueSql = `SELECT SUM(total_amount) as total FROM bookings${baseWhereClause}`;
            
            // 總營收 - 已付款
            const revenuePaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_status = 'paid' AND status != 'cancelled'${buildingClause}`;
            revenuePaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenuePaidWhereClause}`;
            
            // 總營收 - 未付款
            const revenueUnpaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_status = 'pending' AND status != 'cancelled'${buildingClause}`;
            revenueUnpaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenueUnpaidWhereClause}`;
            
            // 房型：入住日於區間內（含已取消）計算取消率；有效訂單（非取消）計算筆數與營收
            byRoomTypeSql = hasRange
                ? `SELECT 
                        COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(room_type::text, '')), ''), '(未指定)') AS room_type,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled') AS active_count,
                        COALESCE(SUM(CASE WHEN COALESCE(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0)::bigint AS revenue,
                        COUNT(*)::bigint AS total_in_range,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') = 'cancelled')::bigint AS cancelled_count
                    FROM bookings
                    WHERE check_in_date::date BETWEEN $1::date AND $2::date${buildingClause}
                    GROUP BY 1
                    ORDER BY active_count DESC, revenue DESC`
                : `SELECT 
                        COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(room_type::text, '')), ''), '(未指定)') AS room_type,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled') AS active_count,
                        COALESCE(SUM(CASE WHEN COALESCE(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0)::bigint AS revenue,
                        COUNT(*)::bigint AS total_in_range,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') = 'cancelled')::bigint AS cancelled_count
                    FROM bookings
                    WHERE TRUE${buildingClause}
                    GROUP BY 1
                    ORDER BY active_count DESC, revenue DESC`;
            
            // 來源分析（與營運儀表 resolveSource 口徑一致：utm_source → booking_source → line → direct）
            bySourceSql = hasRange
                ? `SELECT 
                        src AS booking_source,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled')::bigint AS active_count,
                        COALESCE(SUM(CASE WHEN COALESCE(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0)::bigint AS revenue,
                        COUNT(*)::bigint AS total_in_range,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') = 'cancelled')::bigint AS cancelled_count,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled' AND payment_status = 'paid')::bigint AS paid_active_count
                    FROM (
                        SELECT 
                            status,
                            payment_status,
                            total_amount,
                            COALESCE(
                                NULLIF(LOWER(TRIM(BOTH FROM COALESCE(utm_source::text, ''))), ''),
                                NULLIF(LOWER(TRIM(BOTH FROM COALESCE(booking_source::text, ''))), ''),
                                CASE 
                                    WHEN line_user_id IS NOT NULL AND TRIM(BOTH FROM COALESCE(line_user_id::text, '')) <> '' THEN 'line'
                                    ELSE NULL
                                END,
                                'direct'
                            ) AS src
                        FROM bookings
                        WHERE check_in_date::date BETWEEN $1::date AND $2::date${buildingClause}
                    ) b
                    GROUP BY src
                    ORDER BY active_count DESC, revenue DESC`
                : `SELECT 
                        src AS booking_source,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled')::bigint AS active_count,
                        COALESCE(SUM(CASE WHEN COALESCE(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0)::bigint AS revenue,
                        COUNT(*)::bigint AS total_in_range,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') = 'cancelled')::bigint AS cancelled_count,
                        COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled' AND payment_status = 'paid')::bigint AS paid_active_count
                    FROM (
                        SELECT 
                            status,
                            payment_status,
                            total_amount,
                            COALESCE(
                                NULLIF(LOWER(TRIM(BOTH FROM COALESCE(utm_source::text, ''))), ''),
                                NULLIF(LOWER(TRIM(BOTH FROM COALESCE(booking_source::text, ''))), ''),
                                CASE 
                                    WHEN line_user_id IS NOT NULL AND TRIM(BOTH FROM COALESCE(line_user_id::text, '')) <> '' THEN 'line'
                                    ELSE NULL
                                END,
                                'direct'
                            ) AS src
                        FROM bookings
                        ${hasBuildingFilter ? `WHERE (building_id = $1 OR ($1 = 1 AND (building_id IS NULL OR building_id = 0)))` : ''}
                    ) b
                    GROUP BY src
                    ORDER BY active_count DESC, revenue DESC`;
            
            // 匯款轉帳統計
            const transferBaseWhereClause = hasRange 
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_method LIKE '%匯款%' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_method LIKE '%匯款%' AND status != 'cancelled'${buildingClause}`;
            transferSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferBaseWhereClause}`;
            
            // 匯款轉帳 - 已付款
            const transferPaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`;
            transferPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferPaidWhereClause}`;
            
            // 匯款轉帳 - 未付款
            const transferUnpaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`;
            transferUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferUnpaidWhereClause}`;
            
            // 線上刷卡統計
            const cardBaseWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'${buildingClause}`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'${buildingClause}`;
            cardSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardBaseWhereClause}`;
            
            // 線上刷卡 - 已付款
            const cardPaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`;
            cardPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardPaidWhereClause}`;
            
            // 線上刷卡 - 未付款
            const cardUnpaidWhereClause = hasRange
                ? ` WHERE check_in_date::date BETWEEN $1::date AND $2::date AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`;
            cardUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardUnpaidWhereClause}`;

            if (hasRange) {
                params = hasBuildingFilter ? [startDate, endDate, safeBid] : [startDate, endDate];
            } else if (hasBuildingFilter) {
                params = [safeBid];
            }
        } else {
            // 使用入住日期（check_in_date）作為篩選條件，排除已取消的訂房
            const buildingClause = hasBuildingFilter
                ? ' AND (building_id = ? OR (? = 1 AND (building_id IS NULL OR building_id = 0)))'
                : '';
            const baseWhereClause = hasRange 
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND status != 'cancelled'${buildingClause}`
                : ` WHERE status != 'cancelled'${buildingClause}`;
            
            // 總訂房數
            totalSql = `SELECT COUNT(*) as count FROM bookings${baseWhereClause}`;
            
            // 總訂房數 - 已入住（check_in_date <= 今天）
            const checkedInWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND DATE(check_in_date) <= DATE('now') AND status != 'cancelled'${buildingClause}`
                : ` WHERE DATE(check_in_date) <= DATE('now') AND status != 'cancelled'${buildingClause}`;
            totalCheckedInSql = `SELECT COUNT(*) as count FROM bookings${checkedInWhereClause}`;
            
            // 總訂房數 - 未入住（check_in_date > 今天）
            const notCheckedInWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND DATE(check_in_date) > DATE('now') AND status != 'cancelled'${buildingClause}`
                : ` WHERE DATE(check_in_date) > DATE('now') AND status != 'cancelled'${buildingClause}`;
            totalNotCheckedInSql = `SELECT COUNT(*) as count FROM bookings${notCheckedInWhereClause}`;
            
            // 總營收
            revenueSql = `SELECT SUM(total_amount) as total FROM bookings${baseWhereClause}`;
            
            // 總營收 - 已付款
            const revenuePaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_status = 'paid' AND status != 'cancelled'${buildingClause}`;
            revenuePaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenuePaidWhereClause}`;
            
            // 總營收 - 未付款
            const revenueUnpaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_status = 'pending' AND status != 'cancelled'${buildingClause}`;
            revenueUnpaidSql = `SELECT SUM(total_amount) as total FROM bookings${revenueUnpaidWhereClause}`;
            
            // 房型（SQLite）：入住日於區間內（含已取消）計算取消率
            byRoomTypeSql = hasRange
                ? `SELECT 
                        CASE WHEN TRIM(COALESCE(room_type, '')) = '' THEN '(未指定)' ELSE TRIM(room_type) END AS room_type,
                        SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN 1 ELSE 0 END) AS active_count,
                        COALESCE(SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue,
                        COUNT(*) AS total_in_range,
                        SUM(CASE WHEN IFNULL(status, '') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
                    FROM bookings
                    WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)${buildingClause}
                    GROUP BY CASE WHEN TRIM(COALESCE(room_type, '')) = '' THEN '(未指定)' ELSE TRIM(room_type) END
                    ORDER BY active_count DESC, revenue DESC`
                : `SELECT 
                        CASE WHEN TRIM(COALESCE(room_type, '')) = '' THEN '(未指定)' ELSE TRIM(room_type) END AS room_type,
                        SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN 1 ELSE 0 END) AS active_count,
                        COALESCE(SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue,
                        COUNT(*) AS total_in_range,
                        SUM(CASE WHEN IFNULL(status, '') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
                    FROM bookings
                    WHERE 1=1${buildingClause}
                    GROUP BY CASE WHEN TRIM(COALESCE(room_type, '')) = '' THEN '(未指定)' ELSE TRIM(room_type) END
                    ORDER BY active_count DESC, revenue DESC`;
            
            // 來源分析（SQLite）
            bySourceSql = hasRange
                ? `SELECT 
                        src AS booking_source,
                        SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN 1 ELSE 0 END) AS active_count,
                        COALESCE(SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue,
                        COUNT(*) AS total_in_range,
                        SUM(CASE WHEN IFNULL(status, '') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
                        SUM(CASE WHEN IFNULL(status, '') != 'cancelled' AND payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_active_count
                    FROM (
                        SELECT 
                            status,
                            payment_status,
                            total_amount,
                            COALESCE(
                                NULLIF(LOWER(TRIM(COALESCE(utm_source, ''))), ''),
                                NULLIF(LOWER(TRIM(COALESCE(booking_source, ''))), ''),
                                CASE 
                                    WHEN line_user_id IS NOT NULL AND TRIM(COALESCE(line_user_id, '')) != '' THEN 'line'
                                    ELSE NULL
                                END,
                                'direct'
                            ) AS src
                        FROM bookings
                        WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)
                    ) b
                    GROUP BY src
                    ORDER BY active_count DESC, revenue DESC`
                : `SELECT 
                        src AS booking_source,
                        SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN 1 ELSE 0 END) AS active_count,
                        COALESCE(SUM(CASE WHEN IFNULL(status, '') != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue,
                        COUNT(*) AS total_in_range,
                        SUM(CASE WHEN IFNULL(status, '') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
                        SUM(CASE WHEN IFNULL(status, '') != 'cancelled' AND payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_active_count
                    FROM (
                        SELECT 
                            status,
                            payment_status,
                            total_amount,
                            COALESCE(
                                NULLIF(LOWER(TRIM(COALESCE(utm_source, ''))), ''),
                                NULLIF(LOWER(TRIM(COALESCE(booking_source, ''))), ''),
                                CASE 
                                    WHEN line_user_id IS NOT NULL AND TRIM(COALESCE(line_user_id, '')) != '' THEN 'line'
                                    ELSE NULL
                                END,
                                'direct'
                            ) AS src
                        FROM bookings
                    ) b
                    GROUP BY src
                    ORDER BY active_count DESC, revenue DESC`;
            
            // 匯款轉帳統計
            const transferBaseWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_method LIKE '%匯款%' AND status != 'cancelled'`
                : ` WHERE payment_method LIKE '%匯款%' AND status != 'cancelled'`;
            transferSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferBaseWhereClause}`;
            
            // 匯款轉帳 - 已付款
            const transferPaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`;
            transferPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferPaidWhereClause}`;
            
            // 匯款轉帳 - 未付款
            const transferUnpaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`
                : ` WHERE payment_method LIKE '%匯款%' AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`;
            transferUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${transferUnpaidWhereClause}`;
            
            // 線上刷卡統計
            const cardBaseWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'${buildingClause}`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND status != 'cancelled'${buildingClause}`;
            cardSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardBaseWhereClause}`;
            
            // 線上刷卡 - 已付款
            const cardPaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'paid' AND status != 'cancelled'${buildingClause}`;
            cardPaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardPaidWhereClause}`;
            
            // 線上刷卡 - 未付款
            const cardUnpaidWhereClause = hasRange
                ? ` WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?) AND (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`
                : ` WHERE (payment_method LIKE '%線上%' OR payment_method LIKE '%卡%') AND payment_status = 'pending' AND status != 'cancelled'${buildingClause}`;
            cardUnpaidSql = `SELECT COUNT(*) as count, SUM(total_amount) as total FROM bookings${cardUnpaidWhereClause}`;

            if (hasRange) {
                params = hasBuildingFilter ? [startDate, endDate, safeBid, safeBid] : [startDate, endDate];
            } else if (hasBuildingFilter) {
                params = [safeBid, safeBid];
            }
        }

        // 執行所有查詢
        const shouldBindParams = hasRange || hasBuildingFilter;
        const promises = [
            shouldBindParams ? queryOne(totalSql, params) : queryOne(totalSql),
            shouldBindParams ? queryOne(totalCheckedInSql, params) : queryOne(totalCheckedInSql),
            shouldBindParams ? queryOne(totalNotCheckedInSql, params) : queryOne(totalNotCheckedInSql),
            shouldBindParams ? queryOne(revenueSql, params) : queryOne(revenueSql),
            shouldBindParams ? queryOne(revenuePaidSql, params) : queryOne(revenuePaidSql),
            shouldBindParams ? queryOne(revenueUnpaidSql, params) : queryOne(revenueUnpaidSql),
            shouldBindParams ? query(byRoomTypeSql, params) : query(byRoomTypeSql),
            shouldBindParams ? query(bySourceSql, params) : query(bySourceSql),
            shouldBindParams ? queryOne(transferSql, params) : queryOne(transferSql),
            shouldBindParams ? queryOne(transferPaidSql, params) : queryOne(transferPaidSql),
            shouldBindParams ? queryOne(transferUnpaidSql, params) : queryOne(transferUnpaidSql),
            shouldBindParams ? queryOne(cardSql, params) : queryOne(cardSql),
            shouldBindParams ? queryOne(cardPaidSql, params) : queryOne(cardPaidSql),
            shouldBindParams ? queryOne(cardUnpaidSql, params) : queryOne(cardUnpaidSql)
        ];

        const [
            totalResult, totalCheckedInResult, totalNotCheckedInResult,
            revenueResult, revenuePaidResult, revenueUnpaidResult,
            byRoomTypeResult,
            bySourceResult,
            transferResult, transferPaidResult, transferUnpaidResult,
            cardResult, cardPaidResult, cardUnpaidResult
        ] = await Promise.all(promises);

        const totalRev = parseInt(revenueResult?.total || 0, 10);
        const totalActiveBookings = parseInt(totalResult?.count || 0, 10);
        const rawRoomRows = byRoomTypeResult.rows || [];
        let effectiveRoomRows = rawRoomRows;

        // 房型分析：若有日期區間，優先用 room_selections 拆分（支援多房型訂單）
        // 目的：避免多房型訂單全部堆在 bookings.room_type 字串，導致房型排行與營收分攤失真
        try {
            if (hasRange) {
                const roomTypesForMap = await getRoomTypesByBuilding(safeBid, { activeOnly: false });
                const displayNameByRoomName = new Map();
                (roomTypesForMap || []).forEach((rt) => {
                    const nameKey = String(rt?.name || '').trim();
                    const displayKey = String(rt?.display_name || rt?.name || '').trim();
                    if (nameKey && displayKey) displayNameByRoomName.set(nameKey, displayKey);
                });

                const bookingWherePg = hasBuildingFilter
                    ? ` AND (building_id = $3 OR ($3 = 1 AND (building_id IS NULL OR building_id = 0)))`
                    : '';
                const bookingWhereSqlite = hasBuildingFilter
                    ? ` AND (building_id = ? OR (? = 1 AND (building_id IS NULL OR building_id = 0)))`
                    : '';
                const bookingsForRoomTypeSql = usePostgreSQL
                    ? `
                        SELECT status, total_amount, room_type, room_selections
                        FROM bookings
                        WHERE check_in_date::date BETWEEN $1::date AND $2::date
                        ${bookingWherePg}
                      `
                    : `
                        SELECT status, total_amount, room_type, room_selections
                        FROM bookings
                        WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)
                        ${bookingWhereSqlite}
                      `;
                const bookingsForRoomTypeParams = usePostgreSQL
                    ? (hasBuildingFilter ? [startDate, endDate, safeBid] : [startDate, endDate])
                    : (hasBuildingFilter ? [startDate, endDate, safeBid, safeBid] : [startDate, endDate]);

                const bookingsForRoomTypeResult = await query(bookingsForRoomTypeSql, bookingsForRoomTypeParams);
                const bookingRows = bookingsForRoomTypeResult.rows || bookingsForRoomTypeResult || [];

                const normalizeStatus = (s) => String(s || '').trim().toLowerCase();
                const isCancelled = (s) => {
                    const x = normalizeStatus(s);
                    return x === 'cancelled' || x === '已取消' || x === '取消';
                };

                const agg = new Map(); // room_type(display_name) -> { active_count, revenue, total_in_range, cancelled_count }
                const touch = (roomTypeLabel) => {
                    const key = String(roomTypeLabel || '').trim() || '(未指定)';
                    if (!agg.has(key)) {
                        agg.set(key, { room_type: key, active_count: 0, revenue: 0, total_in_range: 0, cancelled_count: 0 });
                    }
                    return agg.get(key);
                };

                for (const b of bookingRows) {
                    const cancelled = isCancelled(b?.status);
                    const totalAmount = Math.max(0, parseInt(b?.total_amount, 10) || 0);

                    let selections = null;
                    if (b && b.room_selections) {
                        try {
                            selections = typeof b.room_selections === 'string' ? JSON.parse(b.room_selections) : b.room_selections;
                        } catch (_) {
                            selections = null;
                        }
                    }

                    if (Array.isArray(selections) && selections.length > 0) {
                        const items = selections
                            .map((it) => ({
                                name: String(it?.name || '').trim(),
                                quantity: Math.max(0, parseInt(it?.quantity, 10) || 0)
                            }))
                            .filter((it) => it.name && it.quantity > 0);

                        if (items.length > 0) {
                            const qtySum = items.reduce((sum, it) => sum + it.quantity, 0);
                            for (const it of items) {
                                const label = displayNameByRoomName.get(it.name) || it.name;
                                const row = touch(label);
                                row.total_in_range += 1;
                                if (cancelled) {
                                    row.cancelled_count += 1;
                                } else {
                                    row.active_count += 1;
                                    const share = qtySum > 0 ? (it.quantity / qtySum) : 0;
                                    row.revenue += Math.round(totalAmount * share);
                                }
                            }
                            continue;
                        }
                    }

                    // fallback：舊資料可能只存 display_name 在 room_type
                    const label = String(b?.room_type || '').trim() || '(未指定)';
                    const row = touch(label);
                    row.total_in_range += 1;
                    if (cancelled) {
                        row.cancelled_count += 1;
                    } else {
                        row.active_count += 1;
                        row.revenue += totalAmount;
                    }
                }

                effectiveRoomRows = Array.from(agg.values())
                    .sort((a, b) => (b.active_count - a.active_count) || (b.revenue - a.revenue));
            }
        } catch (roomSplitErr) {
            console.warn('⚠️  以 room_selections 拆分房型分析失敗，改用原本 SQL 統計:', roomSplitErr.message || roomSplitErr);
        }

        const byRoomType = effectiveRoomRows.map((r) => {
            const activeCount = parseInt(r.active_count ?? r.count ?? 0, 10);
            const revenue = parseInt(r.revenue || 0, 10);
            const totalInRange = parseInt(r.total_in_range || 0, 10);
            const cancelledCount = parseInt(r.cancelled_count || 0, 10);
            const cancelRate = totalInRange > 0 ? (cancelledCount / totalInRange) * 100 : 0;
            const avgPrice = activeCount > 0 ? Math.round(revenue / activeCount) : 0;
            const revenueShare = totalRev > 0 ? (revenue / totalRev) * 100 : 0;
            return {
                room_type: r.room_type,
                count: activeCount,
                revenue,
                avg_price: avgPrice,
                cancel_rate: cancelRate,
                revenue_share: revenueShare
            };
        });

        const rawSourceRows = bySourceResult.rows || [];
        const bySource = rawSourceRows.map((r) => {
            const activeCount = parseInt(r.active_count ?? 0, 10);
            const revenue = parseInt(r.revenue || 0, 10);
            const totalInRange = parseInt(r.total_in_range || 0, 10);
            const cancelledCount = parseInt(r.cancelled_count || 0, 10);
            const paidActive = parseInt(r.paid_active_count ?? 0, 10);
            const cancelRate = totalInRange > 0 ? (cancelledCount / totalInRange) * 100 : 0;
            const paymentSuccessRate = activeCount > 0 ? (paidActive / activeCount) * 100 : 0;
            const revenueShare = totalRev > 0 ? (revenue / totalRev) * 100 : 0;
            return {
                source: r.booking_source,
                count: activeCount,
                revenue,
                payment_success_rate: paymentSuccessRate,
                cancel_rate: cancelRate,
                revenue_share: revenueShare
            };
        });
        
        return {
            totalBookings: totalActiveBookings,
            totalBookingsDetail: {
                checkedIn: parseInt(totalCheckedInResult?.count || 0),
                notCheckedIn: parseInt(totalNotCheckedInResult?.count || 0)
            },
            totalRevenue: totalRev,
            totalRevenueDetail: {
                paid: parseInt(revenuePaidResult?.total || 0),
                unpaid: parseInt(revenueUnpaidResult?.total || 0)
            },
            byRoomType,
            bySource,
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
// 報表用：本地日期 YYYY-MM-DD
function formatLocalYMD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalYMD(ymd) {
    const parts = String(ymd || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** 含首尾日的天數 */
function daysInclusive(ymdStart, ymdEnd) {
    const a = parseLocalYMD(ymdStart);
    const b = parseLocalYMD(ymdEnd);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000) + 1;
}

/**
 * 與本期等長、緊鄰的前一期（前期末日 = 本期首日的前一天）
 */
function computePreviousPeriod(ymdStart, ymdEnd) {
    const n = daysInclusive(ymdStart, ymdEnd);
    if (n <= 0) return null;
    const start = parseLocalYMD(ymdStart);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (n - 1));
    return { start: formatLocalYMD(prevStart), end: formatLocalYMD(prevEnd) };
}

async function fetchTotalRoomsForReport() {
    let totalRooms = 10;
    try {
        const totalRoomsSetting = await getSetting('total_rooms');
        if (totalRoomsSetting) {
            totalRooms = parseInt(totalRoomsSetting, 10) || 10;
        }
    } catch (_) { /* 預設 */ }
    return totalRooms;
}

/** 依區間計算平日/假日住房率（與原月度邏輯相同，區間可為任意連續日期） */
async function calculateOccupancyForRange(bookingsResult, rangeStart, rangeEnd, totalRooms) {
    try {
        let weekdayRoomNights = 0;
        let weekendRoomNights = 0;
        let weekdayDays = 0;
        let weekendDays = 0;

        const start = new Date(rangeStart + 'T00:00:00');
        const end = new Date(rangeEnd + 'T00:00:00');

        const holidayMap = new Map();
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            try {
                const isHoliday = await isHolidayOrWeekend(dateStr, true);
                holidayMap.set(dateStr, isHoliday);
                if (isHoliday) weekendDays++;
                else weekdayDays++;
            } catch (err) {
                console.warn(`⚠️ 檢查日期 ${dateStr} 是否為假日時發生錯誤:`, err.message);
                holidayMap.set(dateStr, false);
                weekdayDays++;
            }
        }

        const rangeStartDate = new Date(rangeStart + 'T00:00:00');
        const rangeEndDate = new Date(rangeEnd + 'T23:59:59');
        const bookingRows = bookingsResult.rows || bookingsResult || [];

        for (const booking of bookingRows) {
            if (!booking || !booking.check_in_date || !booking.check_out_date) continue;
            try {
                const checkIn = new Date(booking.check_in_date + 'T00:00:00');
                const checkOut = new Date(booking.check_out_date + 'T00:00:00');
                const calcStart = checkIn < rangeStartDate ? rangeStartDate : checkIn;
                const calcEnd = checkOut > rangeEndDate ? rangeEndDate : checkOut;
                for (let d = new Date(calcStart); d < calcEnd; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    if (dateStr >= rangeStart && dateStr <= rangeEnd) {
                        const isHoliday = holidayMap.get(dateStr) || false;
                        if (isHoliday) weekendRoomNights += 1;
                        else weekdayRoomNights += 1;
                    }
                }
            } catch (err) {
                console.warn('⚠️ 處理訂房記錄時發生錯誤:', err.message, booking);
            }
        }

        const weekdayOccupancy = weekdayDays > 0 ? (weekdayRoomNights / (weekdayDays * totalRooms) * 100).toFixed(2) : 0;
        const weekendOccupancy = weekendDays > 0 ? (weekendRoomNights / (weekendDays * totalRooms) * 100).toFixed(2) : 0;

        return {
            weekdayOccupancy: parseFloat(weekdayOccupancy),
            weekendOccupancy: parseFloat(weekendOccupancy)
        };
    } catch (error) {
        console.error('❌ 計算住房率時發生錯誤:', error.message);
        return { weekdayOccupancy: 0, weekendOccupancy: 0 };
    }
}

/** 單一期間：訂房數、營收、平日/假日住房率（入住日口徑 + 與區間重疊之夜數） */
async function getComparisonSlice(rangeStart, rangeEnd, totalRooms) {
    if (usePostgreSQL) {
        const countSql = `
            SELECT 
                COUNT(*)::bigint as booking_count,
                COALESCE(SUM(total_amount), 0)::bigint as total_revenue
            FROM bookings
            WHERE check_in_date::date BETWEEN $1::date AND $2::date
            AND status != 'cancelled'
        `;
        const countRow = await query(countSql, [rangeStart, rangeEnd]).then((r) => r.rows[0] || {});
        const bookingsSql = `
            SELECT check_in_date, check_out_date, nights
            FROM bookings
            WHERE (check_in_date::date <= $2::date AND check_out_date::date > $1::date)
            AND status != 'cancelled'
        `;
        const bookingsRes = await query(bookingsSql, [rangeStart, rangeEnd]);
        const occ = await calculateOccupancyForRange(bookingsRes, rangeStart, rangeEnd, totalRooms);
        return {
            bookingCount: parseInt(countRow.booking_count || 0, 10),
            totalRevenue: parseInt(countRow.total_revenue || 0, 10),
            weekdayOccupancy: occ.weekdayOccupancy,
            weekendOccupancy: occ.weekendOccupancy
        };
    }

    const countSql = `
        SELECT 
            COUNT(*) as booking_count,
            COALESCE(SUM(total_amount), 0) as total_revenue
        FROM bookings
        WHERE DATE(check_in_date) BETWEEN DATE(?) AND DATE(?)
        AND status != 'cancelled'
    `;
    const countRow = await queryOne(countSql, [rangeStart, rangeEnd]) || {};
    const bookingsSql = `
        SELECT check_in_date, check_out_date, nights
        FROM bookings
        WHERE (DATE(check_in_date) <= DATE(?) AND DATE(check_out_date) > DATE(?))
        AND status != 'cancelled'
    `;
    const bookingsRes = await query(bookingsSql, [rangeEnd, rangeStart]);
    const occ = await calculateOccupancyForRange(bookingsRes, rangeStart, rangeEnd, totalRooms);
    return {
        bookingCount: parseInt(countRow.booking_count || 0, 10),
        totalRevenue: parseInt(countRow.total_revenue || 0, 10),
        weekdayOccupancy: occ.weekdayOccupancy,
        weekendOccupancy: occ.weekendOccupancy
    };
}

/** 所選期間 vs 等長前期（營運報表「區間比較」） */
async function getPeriodComparison(currentStart, currentEnd) {
    const prev = computePreviousPeriod(currentStart, currentEnd);
    if (!prev) {
        throw new Error('日期區間無效');
    }
    const totalRooms = await fetchTotalRoomsForReport();
    const [currentSlice, previousSlice] = await Promise.all([
        getComparisonSlice(currentStart, currentEnd, totalRooms),
        getComparisonSlice(prev.start, prev.end, totalRooms)
    ]);
    return {
        currentPeriod: {
            ...currentSlice,
            startDate: currentStart,
            endDate: currentEnd
        },
        previousPeriod: {
            ...previousSlice,
            startDate: prev.start,
            endDate: prev.end
        }
    };
}

async function getMonthlyComparison() {
    try {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;

        const thisMonthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        const thisMonthEndDate = new Date(currentYear, currentMonth, 0);
        const thisMonthEnd = formatLocalYMD(thisMonthEndDate);

        const lastMonthNum = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
        const lastMonthStart = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-01`;
        const lastMonthEndDate = new Date(lastMonthYear, lastMonthNum, 0);
        const lastMonthEnd = formatLocalYMD(lastMonthEndDate);

        const totalRooms = await fetchTotalRoomsForReport();
        const [thisSlice, lastSlice] = await Promise.all([
            getComparisonSlice(thisMonthStart, thisMonthEnd, totalRooms),
            getComparisonSlice(lastMonthStart, lastMonthEnd, totalRooms)
        ]);

        return {
            thisMonth: thisSlice,
            lastMonth: lastSlice
        };
    } catch (error) {
        console.error('❌ 查詢月度比較統計失敗:', error.message);
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
            is_active: level.is_active !== undefined && level.is_active !== null ? parseInt(level.is_active, 10) : 1
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
            is_active: result.is_active !== undefined && result.is_active !== null ? parseInt(result.is_active, 10) : 1
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
        // 取得所有啟用的等級
        const sql = usePostgreSQL
            ? `SELECT * FROM member_levels 
               WHERE is_active = 1 
               ORDER BY display_order ASC, id ASC`
            : `SELECT * FROM member_levels 
               WHERE is_active = 1 
               ORDER BY display_order ASC, id ASC`;
        
        const result = await query(sql);
        const levels = result.rows;
        
        // 先找出所有符合門檻的等級
        const qualifiedLevels = levels.filter((level) => {
            const minSpent = parseInt(level.min_spent || 0, 10);
            const minBookings = parseInt(level.min_bookings || 0, 10);
            return totalSpent >= minSpent && bookingCount >= minBookings;
        });

        // 從符合門檻的等級中選擇「門檻最高」者，避免 0 門檻的新會員覆蓋其他等級
        if (qualifiedLevels.length > 0) {
            qualifiedLevels.sort((a, b) => {
                const aMinSpent = parseInt(a.min_spent || 0, 10);
                const bMinSpent = parseInt(b.min_spent || 0, 10);
                if (bMinSpent !== aMinSpent) return bMinSpent - aMinSpent;

                const aMinBookings = parseInt(a.min_bookings || 0, 10);
                const bMinBookings = parseInt(b.min_bookings || 0, 10);
                if (bMinBookings !== aMinBookings) return bMinBookings - aMinBookings;

                const aDiscount = parseFloat(a.discount_percent || 0);
                const bDiscount = parseFloat(b.discount_percent || 0);
                if (bDiscount !== aDiscount) return bDiscount - aDiscount;

                // 同門檻時，display_order 較大者視為較高等級
                const aOrder = parseInt(a.display_order || 0, 10);
                const bOrder = parseInt(b.display_order || 0, 10);
                return bOrder - aOrder;
            });

            const best = qualifiedLevels[0];
            return {
                id: best.id,
                level_name: best.level_name,
                discount_percent: parseFloat(best.discount_percent || 0)
            };
        }
        
        // 如果沒有符合的等級，返回最低等級（通常是新會員）
        const lowestLevel = levels[0] || null;
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

// ==================== 早鳥/晚鳥優惠管理 ====================

// 取得所有早鳥優惠規則
async function getAllEarlyBirdSettings() {
    try {
        const sql = `SELECT * FROM early_bird_settings ORDER BY priority DESC, min_days_before DESC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢早鳥優惠設定失敗:', error.message);
        throw error;
    }
}

// 取得單一早鳥優惠規則
async function getEarlyBirdSettingById(id) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM early_bird_settings WHERE id = $1`
            : `SELECT * FROM early_bird_settings WHERE id = ?`;
        return await queryOne(sql, [id]);
    } catch (error) {
        console.error('❌ 查詢早鳥優惠設定失敗:', error.message);
        throw error;
    }
}

// 建立早鳥優惠規則
async function createEarlyBirdSetting(data) {
    try {
        const sql = usePostgreSQL
            ? `INSERT INTO early_bird_settings (name, discount_type, discount_value, min_days_before, max_days_before, max_discount, apply_day_type, applicable_room_types, is_active, priority, start_date, end_date, description)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`
            : `INSERT INTO early_bird_settings (name, discount_type, discount_value, min_days_before, max_days_before, max_discount, apply_day_type, applicable_room_types, is_active, priority, start_date, end_date, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const params = [
            data.name,
            data.discount_type || 'percent',
            data.discount_value,
            data.min_days_before || 0,
            data.max_days_before || null,
            data.max_discount || null,
            data.apply_day_type || 'all',
            data.applicable_room_types ? JSON.stringify(data.applicable_room_types) : null,
            data.is_active !== undefined ? data.is_active : 1,
            data.priority || 0,
            data.start_date || null,
            data.end_date || null,
            data.description || null
        ];
        
        if (usePostgreSQL) {
            return await queryOne(sql, params);
        } else {
            const result = await query(sql, params);
            return await getEarlyBirdSettingById(result.lastID);
        }
    } catch (error) {
        console.error('❌ 建立早鳥優惠設定失敗:', error.message);
        throw error;
    }
}

// 更新早鳥優惠規則
async function updateEarlyBirdSetting(id, data) {
    try {
        const sql = usePostgreSQL
            ? `UPDATE early_bird_settings SET 
                name = $1, discount_type = $2, discount_value = $3, 
                min_days_before = $4, max_days_before = $5, max_discount = $6,
                apply_day_type = $7, applicable_room_types = $8, is_active = $9, priority = $10, 
                start_date = $11, end_date = $12, description = $13,
                updated_at = CURRENT_TIMESTAMP
               WHERE id = $14 RETURNING *`
            : `UPDATE early_bird_settings SET 
                name = ?, discount_type = ?, discount_value = ?, 
                min_days_before = ?, max_days_before = ?, max_discount = ?,
                apply_day_type = ?, applicable_room_types = ?, is_active = ?, priority = ?, 
                start_date = ?, end_date = ?, description = ?,
                updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`;
        
        const params = [
            data.name,
            data.discount_type || 'percent',
            data.discount_value,
            data.min_days_before || 0,
            data.max_days_before || null,
            data.max_discount || null,
            data.apply_day_type || 'all',
            data.applicable_room_types ? JSON.stringify(data.applicable_room_types) : null,
            data.is_active !== undefined ? data.is_active : 1,
            data.priority || 0,
            data.start_date || null,
            data.end_date || null,
            data.description || null,
            id
        ];
        
        if (usePostgreSQL) {
            return await queryOne(sql, params);
        } else {
            await query(sql, params);
            return await getEarlyBirdSettingById(id);
        }
    } catch (error) {
        console.error('❌ 更新早鳥優惠設定失敗:', error.message);
        throw error;
    }
}

// 刪除早鳥優惠規則
async function deleteEarlyBirdSetting(id) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM early_bird_settings WHERE id = $1`
            : `DELETE FROM early_bird_settings WHERE id = ?`;
        await query(sql, [id]);
        return true;
    } catch (error) {
        console.error('❌ 刪除早鳥優惠設定失敗:', error.message);
        throw error;
    }
}

// 計算早鳥/晚鳥折扣（核心邏輯）
// checkInDate: 入住日期 (YYYY-MM-DD)
// roomTypeName: 房型名稱（用於判斷適用房型）
// totalAmount: 原始總金額
async function calculateEarlyBirdDiscount(checkInDate, roomTypeName, totalAmount) {
    try {
        // 計算提前天數
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkIn = new Date(checkInDate);
        checkIn.setHours(0, 0, 0, 0);
        const daysBeforeCheckIn = Math.floor((checkIn - today) / (1000 * 60 * 60 * 24));
        
        console.log(`🐦 早鳥優惠計算: 入住日=${checkInDate}, 提前天數=${daysBeforeCheckIn}, 房型=${roomTypeName}, 金額=${totalAmount}`);
        
        // 取得所有啟用的規則
        const allRules = await getAllEarlyBirdSettings();
        console.log(`🐦 共有 ${allRules.length} 條規則`);
        const checkInIsHoliday = await isHolidayOrWeekend(checkInDate, true);
        const activeRules = allRules.filter(rule => {
            // is_active 可能是字串 "0"/"1" 或數字 0/1
            const isActive = parseInt(rule.is_active) === 1;
            if (!isActive) {
                console.log(`🐦 規則「${rule.name}」已停用，跳過`);
                return false;
            }
            
            // 檢查規則有效期間
            const now = new Date();
            if (rule.start_date && new Date(rule.start_date) > now) {
                console.log(`🐦 規則「${rule.name}」尚未生效 (start_date=${rule.start_date})`);
                return false;
            }
            if (rule.end_date && new Date(rule.end_date) < now) {
                console.log(`🐦 規則「${rule.name}」已過期 (end_date=${rule.end_date})`);
                return false;
            }
            
            // 檢查提前天數是否在範圍內
            if (daysBeforeCheckIn < rule.min_days_before) {
                console.log(`🐦 規則「${rule.name}」不符合: 提前${daysBeforeCheckIn}天 < 最少${rule.min_days_before}天`);
                return false;
            }
            if (rule.max_days_before !== null && rule.max_days_before !== undefined && daysBeforeCheckIn > rule.max_days_before) {
                console.log(`🐦 規則「${rule.name}」不符合: 提前${daysBeforeCheckIn}天 > 最多${rule.max_days_before}天`);
                return false;
            }

            const applyDayType = String(rule.apply_day_type || 'all').trim().toLowerCase();
            if (applyDayType === 'weekday' && checkInIsHoliday) {
                console.log(`🐦 規則「${rule.name}」不符合: 僅平日，但入住日 ${checkInDate} 為假日`);
                return false;
            }
            if (applyDayType === 'holiday' && !checkInIsHoliday) {
                console.log(`🐦 規則「${rule.name}」不符合: 僅假日，但入住日 ${checkInDate} 為平日`);
                return false;
            }
            
            // 檢查適用房型
            if (rule.applicable_room_types) {
                try {
                    const roomTypes = JSON.parse(rule.applicable_room_types);
                    if (Array.isArray(roomTypes) && roomTypes.length > 0) {
                        if (!roomTypes.includes(roomTypeName)) {
                            console.log(`🐦 規則「${rule.name}」不適用房型: ${roomTypeName} 不在 [${roomTypes.join(',')}]`);
                            return false;
                        }
                    }
                } catch (e) {
                    // 解析失敗，視為適用所有房型
                }
            }
            
            console.log(`🐦 規則「${rule.name}」符合條件！`);
            return true;
        });
        
        if (activeRules.length === 0) {
            console.log('🐦 沒有符合條件的早鳥優惠規則');
            return { applicable: false, discount_amount: 0, rule: null };
        }
        
        // 取優先級最高的規則（已排序）
        const bestRule = activeRules[0];
        
        // 計算折扣金額
        let discountAmount = 0;
        if (bestRule.discount_type === 'fixed') {
            discountAmount = bestRule.discount_value;
        } else if (bestRule.discount_type === 'percent') {
            discountAmount = totalAmount * (bestRule.discount_value / 100);
            if (bestRule.max_discount && discountAmount > bestRule.max_discount) {
                discountAmount = bestRule.max_discount;
            }
        }
        
        discountAmount = Math.round(discountAmount);
        
        console.log(`🐦 套用早鳥優惠: ${bestRule.name}, 折扣=${discountAmount}, 規則ID=${bestRule.id}`);
        
        return {
            applicable: true,
            discount_amount: discountAmount,
            rule: {
                id: bestRule.id,
                name: bestRule.name,
                discount_type: bestRule.discount_type,
                discount_value: bestRule.discount_value,
                max_discount: bestRule.max_discount,
                apply_day_type: bestRule.apply_day_type || 'all',
                min_days_before: bestRule.min_days_before,
                max_days_before: bestRule.max_days_before,
                description: bestRule.description
            },
            days_before_checkin: daysBeforeCheckIn
        };
    } catch (error) {
        console.error('❌ 計算早鳥優惠失敗:', error.message);
        return { applicable: false, discount_amount: 0, rule: null };
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
                    COUNT(*) FILTER (WHERE COALESCE(status, '') != 'cancelled')::bigint as booking_count,
                    COALESCE(SUM(CASE WHEN payment_status = 'paid' AND COALESCE(status, '') != 'cancelled' THEN final_amount ELSE 0 END), 0)::bigint as total_spent,
                    MAX(created_at) as last_booking_date
                FROM bookings
                GROUP BY guest_email
            )
            SELECT 
                lci.guest_email,
                lci.guest_name,
                lci.guest_phone,
                COALESCE(cs.booking_count, 0) as booking_count,
                COALESCE(cs.total_spent, 0) as total_spent,
                cs.last_booking_date
            FROM latest_customer_info lci
            LEFT JOIN customer_stats cs ON lci.guest_email = cs.guest_email
            ORDER BY cs.last_booking_date DESC`
            : `SELECT 
                b1.guest_email,
                (SELECT b2.guest_name FROM bookings b2 
                 WHERE b2.guest_email = b1.guest_email 
                 ORDER BY b2.created_at DESC LIMIT 1) as guest_name,
                (SELECT b2.guest_phone FROM bookings b2 
                 WHERE b2.guest_email = b1.guest_email 
                 ORDER BY b2.created_at DESC LIMIT 1) as guest_phone,
                SUM(CASE WHEN COALESCE(b1.status, '') != 'cancelled' THEN 1 ELSE 0 END) as booking_count,
                SUM(CASE WHEN b1.payment_status = 'paid' AND COALESCE(b1.status, '') != 'cancelled' THEN b1.final_amount ELSE 0 END) as total_spent,
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
              AND payment_status = 'paid'
              AND status = 'active'
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
            WHERE guest_email = ?
              AND payment_status = 'paid'
              AND status = 'active'`;
        
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

// 取得客戶「已付款且有效」訂房統計（用於會員等級/會員折扣判斷）
async function getPaidActiveCustomerStatsByEmail(email) {
    try {
        const sql = usePostgreSQL
            ? `SELECT
                COUNT(*) as booking_count,
                COALESCE(SUM(final_amount), 0) as total_spent
               FROM bookings
               WHERE guest_email = $1
                 AND payment_status = 'paid'
                 AND status = 'active'`
            : `SELECT
                COUNT(*) as booking_count,
                COALESCE(SUM(final_amount), 0) as total_spent
               FROM bookings
               WHERE guest_email = ?
                 AND payment_status = 'paid'
                 AND status = 'active'`;

        const result = await queryOne(sql, [email]);
        return {
            booking_count: parseInt(result?.booking_count || 0, 10),
            total_spent: parseInt(result?.total_spent || 0, 10)
        };
    } catch (error) {
        console.error('❌ 查詢客戶已付款有效統計失敗:', error.message);
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

// ==================== 館別管理（buildings） ====================

async function getAllBuildingsAdmin() {
    try {
        const sql = `SELECT * FROM buildings ORDER BY display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢館別失敗:', error.message);
        throw error;
    }
}

async function getActiveBuildingsPublic() {
    try {
        const sql = usePostgreSQL
            ? `SELECT id, code, name, display_order FROM buildings WHERE is_active = 1 ORDER BY display_order ASC, id ASC`
            : `SELECT id, code, name, display_order FROM buildings WHERE is_active = 1 ORDER BY display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢可用館別失敗:', error.message);
        throw error;
    }
}

async function getBuildingById(id) {
    try {
        const buildingId = Number(id);
        if (!Number.isFinite(buildingId) || buildingId <= 0) return null;

        const sql = usePostgreSQL
            ? `SELECT id, code, name, display_order, is_active FROM buildings WHERE id = $1`
            : `SELECT id, code, name, display_order, is_active FROM buildings WHERE id = ?`;
        const result = await query(sql, [buildingId]);
        const row = (result.rows || [])[0];
        return row || null;
    } catch (error) {
        console.error('❌ 查詢館別（by id）失敗:', error.message);
        throw error;
    }
}

async function createBuilding(building) {
    try {
        const code = String(building.code || '').trim();
        const name = String(building.name || '').trim();
        if (!code || !name) {
            throw new Error('請提供館別代碼與名稱');
        }
        const displayOrder = Number.isFinite(Number(building.display_order)) ? Number(building.display_order) : 0;
        const isActive = (String(building.is_active ?? '1').trim() === '0') ? 0 : 1;

        const sql = usePostgreSQL
            ? `INSERT INTO buildings (code, name, display_order, is_active) VALUES ($1, $2, $3, $4) RETURNING id`
            : `INSERT INTO buildings (code, name, display_order, is_active) VALUES (?, ?, ?, ?)`;
        const result = await query(sql, [code, name, displayOrder, isActive]);
        return usePostgreSQL ? (result.rows?.[0]?.id) : result.lastID;
    } catch (error) {
        console.error('❌ 新增館別失敗:', error.message);
        throw error;
    }
}

async function updateBuilding(id, building) {
    try {
        const buildingId = parseInt(id, 10);
        if (!Number.isFinite(buildingId) || buildingId <= 0) {
            throw new Error('無效的館別 ID');
        }
        if (buildingId === 1) {
            // 預設館可改名稱/排序/啟用，但代碼固定
            if (building.code && String(building.code).trim() !== 'default') {
                throw new Error('預設館代碼不可變更');
            }
        }

        const name = String(building.name || '').trim();
        const code = String(building.code || '').trim();
        const displayOrder = Number.isFinite(Number(building.display_order)) ? Number(building.display_order) : 0;
        const isActive = (String(building.is_active ?? '1').trim() === '0') ? 0 : 1;
        if (!name) throw new Error('請提供館別名稱');
        if (!code) throw new Error('請提供館別代碼');

        const sql = usePostgreSQL
            ? `UPDATE buildings SET code = $1, name = $2, display_order = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`
            : `UPDATE buildings SET code = ?, name = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        const result = await query(sql, [code, name, displayOrder, isActive, buildingId]);
        return result.changes || 0;
    } catch (error) {
        console.error('❌ 更新館別失敗:', error.message);
        throw error;
    }
}

async function deleteBuilding(id) {
    try {
        const buildingId = parseInt(id, 10);
        if (!Number.isFinite(buildingId) || buildingId <= 0) {
            throw new Error('無效的館別 ID');
        }
        if (buildingId === 1) {
            throw new Error('預設館不可刪除');
        }

        // 若館別仍有房型，不允許刪除（避免孤兒資料）
        const cntSql = usePostgreSQL
            ? `SELECT COUNT(*)::bigint as cnt FROM room_types WHERE building_id = $1`
            : `SELECT COUNT(*) as cnt FROM room_types WHERE building_id = ?`;
        const row = await queryOne(cntSql, [buildingId]);
        const cnt = parseInt(row?.cnt || row?.count || 0, 10);
        if (cnt > 0) {
            throw new Error('此館別仍有房型，請先移動或刪除房型後再刪除館別');
        }

        const sql = usePostgreSQL
            ? `DELETE FROM buildings WHERE id = $1`
            : `DELETE FROM buildings WHERE id = ?`;
        const result = await query(sql, [buildingId]);
        return result.changes || 0;
    } catch (error) {
        console.error('❌ 刪除館別失敗:', error.message);
        throw error;
    }
}

async function getRoomTypesBuildingStatsAdmin() {
    try {
        const totalSql = `SELECT COUNT(*) as cnt FROM room_types`;
        const totalRow = await queryOne(totalSql, []);
        const total = parseInt(totalRow?.cnt || totalRow?.count || 0, 10);

        const groupSql = usePostgreSQL
            ? `SELECT building_id, COUNT(*)::bigint as cnt FROM room_types GROUP BY building_id ORDER BY building_id NULLS FIRST`
            : `SELECT building_id, COUNT(*) as cnt FROM room_types GROUP BY building_id ORDER BY building_id`;
        const groupRes = await query(groupSql, []);
        const groups = (groupRes.rows || []).map((r) => ({
            building_id: r.building_id === undefined ? null : r.building_id,
            cnt: parseInt(r.cnt || r.count || 0, 10)
        }));

        const sampleSql = usePostgreSQL
            ? `SELECT id, name, display_name, building_id, is_active FROM room_types ORDER BY id ASC LIMIT 10`
            : `SELECT id, name, display_name, building_id, is_active FROM room_types ORDER BY id ASC LIMIT 10`;
        const sampleRes = await query(sampleSql, []);
        const samples = sampleRes.rows || [];

        return { total, groups, samples };
    } catch (error) {
        console.error('❌ 查詢房型館別分佈失敗:', error.message);
        throw error;
    }
}

// 取得所有房型（只包含啟用的，供前台使用）
async function getAllRoomTypes() {
    try {
        // 兼容舊簽名：不帶參數時回傳預設館
        return await getRoomTypesByBuilding(1, { activeOnly: true });
    } catch (error) {
        console.error('❌ 查詢房型失敗:', error.message);
        throw error;
    }
}

async function getRoomTypesByBuilding(buildingId = 1, options = {}) {
    try {
        const { activeOnly = true } = options;
        const bid = parseInt(buildingId, 10);
        const safeBid = Number.isFinite(bid) && bid > 0 ? bid : 1;
        const activeClause = activeOnly ? 'AND is_active = 1' : '';
        const sql = usePostgreSQL
            ? `SELECT * FROM room_types WHERE (building_id = $1 OR ($1 = 1 AND (building_id IS NULL OR building_id = 0))) ${activeClause} ORDER BY display_order ASC, id ASC`
            : `SELECT * FROM room_types WHERE (building_id = ? OR (? = 1 AND (building_id IS NULL OR building_id = 0))) ${activeClause} ORDER BY display_order ASC, id ASC`;
        const params = usePostgreSQL ? [safeBid] : [safeBid, safeBid];
        const result = await query(sql, params);
        return result.rows || [];
    } catch (error) {
        console.error('❌ 查詢房型（依館別）失敗:', error.message);
        throw error;
    }
}

// 取得所有房型（包含已停用的，供管理後台使用）
async function getAllRoomTypesAdmin(buildingId) {
    try {
        const bid = parseInt(buildingId, 10);
        const hasBuildingFilter = Number.isFinite(bid) && bid > 0;
        const safeBid = hasBuildingFilter ? bid : null;

        // 加上庫存（qty_total）供後台顯示/編輯（每館每房型）
        const sql = hasBuildingFilter
            ? (usePostgreSQL
                ? `
                    SELECT rt.*, COALESCE(inv.qty_total, 1) AS qty_total
                    FROM room_types rt
                    LEFT JOIN room_type_inventory inv
                      ON inv.building_id = rt.building_id AND inv.room_type_id = rt.id
                    WHERE (rt.building_id = $1 OR ($1 = 1 AND (rt.building_id IS NULL OR rt.building_id = 0)))
                    ORDER BY rt.display_order ASC, rt.id ASC
                  `
                : `
                    SELECT rt.*, COALESCE(inv.qty_total, 1) AS qty_total
                    FROM room_types rt
                    LEFT JOIN room_type_inventory inv
                      ON inv.building_id = rt.building_id AND inv.room_type_id = rt.id
                    WHERE (rt.building_id = ? OR (? = 1 AND (rt.building_id IS NULL OR rt.building_id = 0)))
                    ORDER BY rt.display_order ASC, rt.id ASC
                  `)
            : `
                SELECT rt.*, COALESCE(inv.qty_total, 1) AS qty_total
                FROM room_types rt
                LEFT JOIN room_type_inventory inv
                  ON inv.building_id = rt.building_id AND inv.room_type_id = rt.id
                ORDER BY rt.display_order ASC, rt.id ASC
              `;

        const params = hasBuildingFilter
            ? (usePostgreSQL ? [safeBid] : [safeBid, safeBid])
            : [];

        const result = params.length ? await query(sql, params) : await query(sql);
        return result.rows || [];
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
            INSERT INTO room_types (building_id, name, display_name, price, original_price, holiday_surcharge, max_occupancy, extra_beds, extra_bed_price, bed_config, included_items, booking_badge, icon, image_url, show_on_landing, display_order, is_active) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id
        ` : `
            INSERT INTO room_types (building_id, name, display_name, price, original_price, holiday_surcharge, max_occupancy, extra_beds, extra_bed_price, bed_config, included_items, booking_badge, icon, image_url, show_on_landing, display_order, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            roomData.building_id !== undefined && roomData.building_id !== null ? roomData.building_id : 1,
            roomData.name,
            roomData.display_name,
            roomData.price,
            roomData.original_price !== undefined ? roomData.original_price : 0,
            roomData.holiday_surcharge !== undefined ? roomData.holiday_surcharge : 0,
            roomData.max_occupancy !== undefined ? roomData.max_occupancy : 0,
            roomData.extra_beds !== undefined ? roomData.extra_beds : 0,
            roomData.extra_bed_price !== undefined ? roomData.extra_bed_price : 0,
            roomData.bed_config !== undefined ? roomData.bed_config : '',
            roomData.included_items !== undefined ? roomData.included_items : '',
            roomData.booking_badge !== undefined ? roomData.booking_badge : '',
            roomData.icon || '🏠',
            roomData.image_url || null,
            roomData.show_on_landing !== undefined ? roomData.show_on_landing : 1,
            roomData.display_order || 0,
            roomData.is_active !== undefined ? roomData.is_active : 1
        ];
        
        const result = await query(sql, values);
        const newId = result.lastID || result.rows[0]?.id;

        // 初始化/更新庫存（每館每房型）
        const buildingId = roomData.building_id !== undefined && roomData.building_id !== null ? roomData.building_id : 1;
        const qtyTotal = roomData.qty_total !== undefined && roomData.qty_total !== null
            ? Math.max(0, parseInt(roomData.qty_total, 10) || 0)
            : 1;
        await upsertRoomTypeInventory(buildingId, newId, qtyTotal);

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
            SET building_id = $1, display_name = $2, price = $3, original_price = $4, holiday_surcharge = $5, max_occupancy = $6, extra_beds = $7, extra_bed_price = $8, bed_config = $9, included_items = $10, booking_badge = $11, icon = $12, image_url = $13, show_on_landing = $14, display_order = $15, is_active = $16, updated_at = CURRENT_TIMESTAMP
            WHERE id = $17
        ` : `
            UPDATE room_types 
            SET building_id = ?, display_name = ?, price = ?, original_price = ?, holiday_surcharge = ?, max_occupancy = ?, extra_beds = ?, extra_bed_price = ?, bed_config = ?, included_items = ?, booking_badge = ?, icon = ?, image_url = ?, show_on_landing = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        const values = [
            roomData.building_id !== undefined && roomData.building_id !== null ? roomData.building_id : 1,
            roomData.display_name,
            roomData.price,
            roomData.original_price !== undefined ? roomData.original_price : 0,
            roomData.holiday_surcharge !== undefined ? roomData.holiday_surcharge : 0,
            roomData.max_occupancy !== undefined ? roomData.max_occupancy : 0,
            roomData.extra_beds !== undefined ? roomData.extra_beds : 0,
            roomData.extra_bed_price !== undefined ? roomData.extra_bed_price : 0,
            roomData.bed_config !== undefined ? roomData.bed_config : '',
            roomData.included_items !== undefined ? roomData.included_items : '',
            roomData.booking_badge !== undefined ? roomData.booking_badge : '',
            roomData.icon || '🏠',
            roomData.image_url !== undefined ? roomData.image_url : null,
            roomData.show_on_landing !== undefined ? roomData.show_on_landing : 1,
            roomData.display_order || 0,
            roomData.is_active !== undefined ? roomData.is_active : 1,
            id
        ];
        
        const result = await query(sql, values);

        // 同步庫存（每館每房型）
        if (roomData.qty_total !== undefined && roomData.qty_total !== null) {
            const buildingId = roomData.building_id !== undefined && roomData.building_id !== null ? roomData.building_id : 1;
            const qtyTotal = Math.max(0, parseInt(roomData.qty_total, 10) || 0);
            await upsertRoomTypeInventory(buildingId, id, qtyTotal);
        }

        console.log(`✅ 房型已更新 (影響行數: ${result.changes})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 更新房型失敗:', error.message);
        throw error;
    }
}

async function upsertRoomTypeInventory(buildingId, roomTypeId, qtyTotal) {
    const bid = parseInt(buildingId, 10);
    const rid = parseInt(roomTypeId, 10);
    const qty = Math.max(0, parseInt(qtyTotal, 10) || 0);
    if (!Number.isFinite(bid) || bid <= 0 || !Number.isFinite(rid) || rid <= 0) return;

    const sql = usePostgreSQL
        ? `
            INSERT INTO room_type_inventory (building_id, room_type_id, qty_total, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (building_id, room_type_id)
            DO UPDATE SET qty_total = EXCLUDED.qty_total, updated_at = CURRENT_TIMESTAMP
          `
        : `
            INSERT INTO room_type_inventory (building_id, room_type_id, qty_total, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(building_id, room_type_id)
            DO UPDATE SET qty_total = excluded.qty_total, updated_at = CURRENT_TIMESTAMP
          `;

    await query(sql, [bid, rid, qty]);
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

// ==================== 房型圖庫管理 ====================

async function getRoomTypeGalleryImages(roomTypeId) {
    try {
        const sql = usePostgreSQL
            ? `SELECT * FROM room_type_images WHERE room_type_id = $1 ORDER BY display_order ASC, id ASC`
            : `SELECT * FROM room_type_images WHERE room_type_id = ? ORDER BY display_order ASC, id ASC`;
        const result = await query(sql, [roomTypeId]);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢房型圖庫失敗:', error.message);
        throw error;
    }
}

async function getAllRoomTypeGalleryImages() {
    try {
        const sql = `SELECT * FROM room_type_images ORDER BY room_type_id ASC, display_order ASC, id ASC`;
        const result = await query(sql);
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢所有房型圖庫失敗:', error.message);
        throw error;
    }
}

async function addRoomTypeGalleryImage(roomTypeId, imageUrl, displayOrder = 0) {
    try {
        const sql = usePostgreSQL
            ? `INSERT INTO room_type_images (room_type_id, image_url, display_order) VALUES ($1, $2, $3) RETURNING id`
            : `INSERT INTO room_type_images (room_type_id, image_url, display_order) VALUES (?, ?, ?)`;
        const result = await query(sql, [roomTypeId, imageUrl, displayOrder]);
        const newId = result.lastID || result.rows?.[0]?.id;
        console.log(`✅ 圖庫圖片已新增 (ID: ${newId})`);
        return newId;
    } catch (error) {
        console.error('❌ 新增圖庫圖片失敗:', error.message);
        throw error;
    }
}

async function deleteRoomTypeGalleryImage(imageId) {
    try {
        const sql = usePostgreSQL
            ? `DELETE FROM room_type_images WHERE id = $1`
            : `DELETE FROM room_type_images WHERE id = ?`;
        const result = await query(sql, [imageId]);
        console.log(`✅ 圖庫圖片已刪除 (ID: ${imageId})`);
        return result.changes;
    } catch (error) {
        console.error('❌ 刪除圖庫圖片失敗:', error.message);
        throw error;
    }
}

async function updateRoomTypeGalleryOrder(imageId, displayOrder) {
    try {
        const sql = usePostgreSQL
            ? `UPDATE room_type_images SET display_order = $1 WHERE id = $2`
            : `UPDATE room_type_images SET display_order = ? WHERE id = ?`;
        await query(sql, [displayOrder, imageId]);
    } catch (error) {
        console.error('❌ 更新圖庫排序失敗:', error.message);
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
        const sql = `SELECT *, COALESCE(unit_label, '人') AS unit_label FROM addons WHERE is_active = 1 ORDER BY display_order ASC, id ASC`;
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
        const sql = `SELECT *, COALESCE(unit_label, '人') AS unit_label FROM addons ORDER BY display_order ASC, id ASC`;
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
            ? `SELECT *, COALESCE(unit_label, '人') AS unit_label FROM addons WHERE id = $1`
            : `SELECT *, COALESCE(unit_label, '人') AS unit_label FROM addons WHERE id = ?`;
        return await queryOne(sql, [id]);
    } catch (error) {
        console.error('❌ 查詢加購商品失敗:', error.message);
        throw error;
    }
}

// 新增加購商品
async function createAddon(addonData) {
    try {
        const summary = String(addonData.summary || '').trim();
        const details = String(addonData.details || '').trim();
        const terms = String(addonData.terms || '').trim();
        const sql = usePostgreSQL
            ? `INSERT INTO addons (name, display_name, price, unit_label, summary, details, terms, icon, display_order, is_active) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`
            : `INSERT INTO addons (name, display_name, price, unit_label, summary, details, terms, icon, display_order, is_active) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const values = [
            addonData.name,
            addonData.display_name,
            addonData.price,
            addonData.unit_label || '人',
            summary,
            details,
            terms,
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
        const summary = String(addonData.summary || '').trim();
        const details = String(addonData.details || '').trim();
        const terms = String(addonData.terms || '').trim();
        const sql = usePostgreSQL
            ? `UPDATE addons SET display_name = $1, price = $2, unit_label = $3, summary = $4, details = $5, terms = $6, icon = $7, display_order = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $10`
            : `UPDATE addons SET display_name = ?, price = ?, unit_label = ?, summary = ?, details = ?, terms = ?, icon = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        
        const values = [
            addonData.display_name,
            addonData.price,
            addonData.unit_label || '人',
            summary,
            details,
            terms,
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

async function getRoomAvailability(checkInDate, checkOutDate, buildingId = 1) {
    try {
        const bid = parseInt(buildingId, 10);
        const safeBid = Number.isFinite(bid) && bid > 0 ? bid : 1;

        // 注意：前台送單可能是「多房型+數量」(roomSelections)，單純用 bookings.room_type = rt.display_name 的 SQL 無法準確計算。
        // 這裡改成：拉出重疊訂單 + room_selections，於 JS 端累加各房型數量，再與 room_type_inventory.qty_total 比對。

        const roomTypes = await getRoomTypesByBuilding(safeBid, { activeOnly: true });
        if (!roomTypes.length) return [];

        const roomTypeByDisplayName = new Map();
        const roomTypeByName = new Map();
        roomTypes.forEach((rt) => {
            if (rt.display_name) roomTypeByDisplayName.set(String(rt.display_name), rt);
            if (rt.name) roomTypeByName.set(String(rt.name), rt);
        });

        // 讀取庫存
        const invSql = usePostgreSQL
            ? `SELECT room_type_id, qty_total FROM room_type_inventory WHERE building_id = $1`
            : `SELECT room_type_id, qty_total FROM room_type_inventory WHERE building_id = ?`;
        const invResult = await query(invSql, [safeBid]);
        const invRows = invResult.rows || invResult || [];
        const qtyTotalByRoomTypeId = new Map(
            invRows
                .map((r) => [Number(r.room_type_id), Math.max(0, parseInt(r.qty_total, 10) || 0)])
                .filter(([id]) => Number.isFinite(id))
        );

        // 讀取重疊訂單（有效/保留）
        const bookingsSql = usePostgreSQL
            ? `
                SELECT id, room_type, room_selections
                FROM bookings
                WHERE building_id = $3
                  AND status IN ('active', 'reserved')
                  AND check_in_date::date < $2::date
                  AND check_out_date::date > $1::date
            `
            : `
                SELECT id, room_type, room_selections
                FROM bookings
                WHERE building_id = ?
                  AND status IN ('active', 'reserved')
                  AND check_in_date < ?
                  AND check_out_date > ?
            `;
        const bookingsParams = usePostgreSQL
            ? [checkInDate, checkOutDate, safeBid]
            : [safeBid, checkOutDate, checkInDate];
        const bookingsResult = await query(bookingsSql, bookingsParams);
        const bookingRows = bookingsResult.rows || bookingsResult || [];

        // 逐單累加各房型佔用數
        const usedByRoomTypeId = new Map();
        const bump = (roomTypeId, qty) => {
            const id = Number(roomTypeId);
            const q = Math.max(0, parseInt(qty, 10) || 0);
            if (!Number.isFinite(id) || q <= 0) return;
            usedByRoomTypeId.set(id, (usedByRoomTypeId.get(id) || 0) + q);
        };

        for (const b of bookingRows) {
            let selections = null;
            if (b && b.room_selections) {
                try {
                    selections = JSON.parse(b.room_selections);
                } catch (_) {
                    selections = null;
                }
            }

            if (Array.isArray(selections) && selections.length > 0) {
                // selections: [{ name, quantity, ... }]
                for (const item of selections) {
                    const key = String(item?.name || '').trim();
                    const rt = roomTypeByName.get(key) || roomTypeByDisplayName.get(key);
                    if (rt && rt.id) {
                        bump(rt.id, item?.quantity || 1);
                    }
                }
                continue;
            }

            // fallback: 舊資料可能只存 display_name
            const rawRoomType = String(b?.room_type || '').trim();
            const rt = roomTypeByDisplayName.get(rawRoomType) || roomTypeByName.get(rawRoomType);
            if (rt && rt.id) {
                bump(rt.id, 1);
            }
        }

        // 判斷滿房
        const unavailable = [];
        for (const rt of roomTypes) {
            const qtyTotal = qtyTotalByRoomTypeId.has(Number(rt.id))
                ? qtyTotalByRoomTypeId.get(Number(rt.id))
                : 1;
            const used = usedByRoomTypeId.get(Number(rt.id)) || 0;
            if (used >= qtyTotal) {
                unavailable.push(rt.name);
            }
        }

        return unavailable.filter(Boolean);
    } catch (error) {
        console.error('❌ 查詢房間可用性失敗:', error.message);
        throw error;
    }
}

// 取得指定日期範圍內的訂房資料（供日曆視圖使用，可選館別）
async function getBookingsInRange(startDate, endDate, buildingId, bookingMode) {
    try {
        const bid = parseInt(buildingId, 10);
        const hasBuildingFilter = Number.isFinite(bid) && bid > 0;
        const safeBid = hasBuildingFilter ? bid : 1;
        const mode = ['retail', 'whole_property'].includes((bookingMode || '').toString().trim())
            ? (bookingMode || '').toString().trim()
            : '';

        const sql = usePostgreSQL ? `
            SELECT booking_id, room_type, check_in_date, check_out_date, status, guest_name, COALESCE(booking_mode, 'retail') AS booking_mode
            FROM bookings
            WHERE check_in_date::date <= $2::date
              AND check_out_date::date >= $1::date
              AND status IN ('active', 'reserved', 'cancelled')
              ${hasBuildingFilter ? `AND (building_id = $3 OR ($3 = 1 AND (building_id IS NULL OR building_id = 0)))` : ''}
              ${mode ? `AND COALESCE(booking_mode, 'retail') = ${hasBuildingFilter ? '$4' : '$3'}` : ''}
            ORDER BY check_in_date, room_type
        ` : `
            SELECT booking_id, room_type, check_in_date, check_out_date, status, guest_name, COALESCE(booking_mode, 'retail') AS booking_mode
            FROM bookings
            WHERE DATE(check_in_date) <= DATE(?)
              AND DATE(check_out_date) >= DATE(?)
              AND status IN ('active', 'reserved', 'cancelled')
              ${hasBuildingFilter ? `AND (building_id = ? OR (? = 1 AND (building_id IS NULL OR building_id = 0)))` : ''}
              ${mode ? `AND COALESCE(booking_mode, 'retail') = ?` : ''}
            ORDER BY check_in_date, room_type
        `;
        const params = usePostgreSQL
            ? (hasBuildingFilter
                ? (mode ? [startDate, endDate, safeBid, mode] : [startDate, endDate, safeBid])
                : (mode ? [startDate, endDate, mode] : [startDate, endDate]))
            : (hasBuildingFilter
                ? (mode ? [startDate, endDate, safeBid, safeBid, mode] : [startDate, endDate, safeBid, safeBid])
                : (mode ? [startDate, endDate, mode] : [startDate, endDate]));
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

// 清理過舊操作日誌（安全版，限制單次刪除量）
async function cleanupAdminLogs(options = {}) {
    try {
        const parseIntWithDefault = (value, defaultValue) => {
            const parsed = parseInt(value, 10);
            return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
        };

        const retentionDaysRaw = options.retentionDays ?? process.env.ADMIN_LOG_RETENTION_DAYS;
        const minRetentionDaysRaw = process.env.ADMIN_LOG_MIN_RETENTION_DAYS;
        const maxDeletePerRunRaw = options.maxDeletePerRun ?? process.env.ADMIN_LOG_MAX_DELETE_PER_RUN;
        const maxBatchesPerRunRaw = options.maxBatchesPerRun ?? process.env.ADMIN_LOG_MAX_BATCHES_PER_RUN;
        const dryRun = options.dryRun === true;

        const retentionDays = parseIntWithDefault(retentionDaysRaw, 180);
        const minRetentionDays = parseIntWithDefault(minRetentionDaysRaw, 30);
        const safeRetentionDays = Math.max(retentionDays, minRetentionDays);
        const maxDeletePerRun = parseIntWithDefault(maxDeletePerRunRaw, 2000);
        const maxBatchesPerRun = parseIntWithDefault(maxBatchesPerRunRaw, 10);

        const countSql = usePostgreSQL
            ? `SELECT COUNT(*) as count
               FROM admin_logs
               WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`
            : `SELECT COUNT(*) as count
               FROM admin_logs
               WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')`;
        const countRow = await queryOne(countSql, [safeRetentionDays]);
        const totalCandidates = parseInt(countRow?.count, 10) || 0;

        if (dryRun) {
            return {
                retentionDays: safeRetentionDays,
                    cutoffDate: new Date(Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000).toISOString(),
                totalCandidates,
                deletedCount: 0,
                runCount: 0,
                dryRun: true
            };
        }

        let deletedCount = 0;
        let runCount = 0;

        for (let i = 0; i < maxBatchesPerRun; i++) {
            const deleteSql = usePostgreSQL
                ? `WITH target_rows AS (
                       SELECT id
                       FROM admin_logs
                       WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
                       ORDER BY created_at ASC
                       LIMIT $2
                   )
                   DELETE FROM admin_logs
                   WHERE id IN (SELECT id FROM target_rows)`
                : `DELETE FROM admin_logs
                   WHERE id IN (
                       SELECT id
                       FROM admin_logs
                       WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
                       ORDER BY created_at ASC
                       LIMIT ?
                   )`;

            const deleteResult = await query(deleteSql, [safeRetentionDays, maxDeletePerRun]);
            const deletedThisRun = deleteResult.changes || 0;
            deletedCount += deletedThisRun;
            runCount += 1;

            if (deletedThisRun < maxDeletePerRun) {
                break;
            }
        }

        return {
            retentionDays: safeRetentionDays,
            cutoffDate: new Date(Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000).toISOString(),
            totalCandidates,
            deletedCount,
            runCount,
            dryRun: false,
            hasRemainingCandidates: deletedCount < totalCandidates
        };
    } catch (error) {
        console.error('❌ 清理操作日誌失敗:', error.message);
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
    getBookingsByLineUserId,
    updateBooking,
    cancelBooking,
    deleteBooking,
    getStatistics,
    getMonthlyComparison,
    getPeriodComparison,
    // 房型管理
    // 館別管理
    getAllBuildingsAdmin,
    getActiveBuildingsPublic,
    getBuildingById,
    createBuilding,
    updateBuilding,
    deleteBuilding,
    getRoomTypesBuildingStatsAdmin,
    getAllRoomTypes,
    getRoomTypesByBuilding,
    getAllRoomTypesAdmin,
    getRoomTypeById,
    createRoomType,
    updateRoomType,
    deleteRoomType,
    // 房型圖庫
    getRoomTypeGalleryImages,
    getAllRoomTypeGalleryImages,
    addRoomTypeGalleryImage,
    deleteRoomTypeGalleryImage,
    updateRoomTypeGalleryOrder,
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
    getPaidActiveCustomerStatsByEmail,
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
    // 早鳥/晚鳥優惠管理
    getAllEarlyBirdSettings,
    getEarlyBirdSettingById,
    createEarlyBirdSetting,
    updateEarlyBirdSetting,
    deleteEarlyBirdSetting,
    calculateEarlyBirdDiscount,
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
    cleanupAdminLogs,
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

