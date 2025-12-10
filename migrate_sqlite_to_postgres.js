// SQLite 到 PostgreSQL 資料遷移腳本
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

// SQLite 資料庫路徑
const SQLITE_DB_PATH = path.join(__dirname, 'bookings.db');

// PostgreSQL 連接池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1') ? false : {
        rejectUnauthorized: false
    }
});

async function migrateData() {
    console.log('========================================');
    console.log('   開始遷移資料：SQLite → PostgreSQL');
    console.log('========================================\n');

    // 檢查 SQLite 資料庫是否存在
    const fs = require('fs');
    if (!fs.existsSync(SQLITE_DB_PATH)) {
        console.error('❌ 找不到 SQLite 資料庫檔案:', SQLITE_DB_PATH);
        process.exit(1);
    }

    const sqliteDb = new sqlite3.Database(SQLITE_DB_PATH);
    const pgClient = await pool.connect();

    try {
        await pgClient.query('BEGIN');

        // 1. 遷移訂房記錄 (bookings)
        console.log('📦 遷移訂房記錄...');
        const bookings = await new Promise((resolve, reject) => {
            sqliteDb.all('SELECT * FROM bookings', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (bookings.length > 0) {
            for (const booking of bookings) {
                try {
                    await pgClient.query(`
                        INSERT INTO bookings (
                            booking_id, check_in_date, check_out_date, room_type,
                            guest_name, guest_phone, guest_email,
                            payment_amount, payment_method,
                            price_per_night, nights, total_amount, final_amount,
                            booking_date, email_sent, payment_status, status, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                        ON CONFLICT (booking_id) DO NOTHING
                    `, [
                        booking.booking_id,
                        booking.check_in_date,
                        booking.check_out_date,
                        booking.room_type,
                        booking.guest_name,
                        booking.guest_phone,
                        booking.guest_email,
                        booking.payment_amount,
                        booking.payment_method,
                        booking.price_per_night,
                        booking.nights,
                        booking.total_amount,
                        booking.final_amount,
                        booking.booking_date,
                        booking.email_sent ? (typeof booking.email_sent === 'number' ? booking.email_sent.toString() : booking.email_sent) : '0',
                        booking.payment_status || 'pending',
                        booking.status || 'active',
                        booking.created_at || new Date().toISOString()
                    ]);
                } catch (err) {
                    if (!err.message.includes('duplicate key')) {
                        console.warn(`⚠️  遷移訂房記錄 ${booking.booking_id} 時發生錯誤:`, err.message);
                    }
                }
            }
            console.log(`✅ 已遷移 ${bookings.length} 筆訂房記錄`);
        } else {
            console.log('ℹ️  沒有訂房記錄需要遷移');
        }

        // 2. 遷移房型設定 (room_types)
        console.log('\n📦 遷移房型設定...');
        const roomTypes = await new Promise((resolve, reject) => {
            sqliteDb.all('SELECT * FROM room_types', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (roomTypes.length > 0) {
            for (const room of roomTypes) {
                try {
                    await pgClient.query(`
                        INSERT INTO room_types (id, name, display_name, price, icon, display_order, is_active, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (id) DO UPDATE SET
                            display_name = EXCLUDED.display_name,
                            price = EXCLUDED.price,
                            icon = EXCLUDED.icon,
                            display_order = EXCLUDED.display_order,
                            is_active = EXCLUDED.is_active,
                            updated_at = EXCLUDED.updated_at
                    `, [
                        room.id,
                        room.name,
                        room.display_name,
                        room.price,
                        room.icon || '🏠',
                        room.display_order || 0,
                        room.is_active !== undefined ? room.is_active : 1,
                        room.created_at || new Date().toISOString(),
                        room.updated_at || new Date().toISOString()
                    ]);
                } catch (err) {
                    if (!err.message.includes('duplicate key')) {
                        console.warn(`⚠️  遷移房型 ${room.name} 時發生錯誤:`, err.message);
                    }
                }
            }
            console.log(`✅ 已遷移 ${roomTypes.length} 個房型設定`);
        } else {
            console.log('ℹ️  沒有房型設定需要遷移');
        }

        // 3. 遷移系統設定 (settings)
        console.log('\n📦 遷移系統設定...');
        const settings = await new Promise((resolve, reject) => {
            sqliteDb.all('SELECT * FROM settings', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (settings.length > 0) {
            for (const setting of settings) {
                try {
                    await pgClient.query(`
                        INSERT INTO settings (key, value, description, updated_at)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (key) DO UPDATE SET
                            value = EXCLUDED.value,
                            description = EXCLUDED.description,
                            updated_at = EXCLUDED.updated_at
                    `, [
                        setting.key,
                        setting.value,
                        setting.description,
                        setting.updated_at || new Date().toISOString()
                    ]);
                } catch (err) {
                    if (!err.message.includes('duplicate key')) {
                        console.warn(`⚠️  遷移設定 ${setting.key} 時發生錯誤:`, err.message);
                    }
                }
            }
            console.log(`✅ 已遷移 ${settings.length} 個系統設定`);
        } else {
            console.log('ℹ️  沒有系統設定需要遷移');
        }

        // 4. 遷移郵件模板 (email_templates)
        console.log('\n📦 遷移郵件模板...');
        const templates = await new Promise((resolve, reject) => {
            sqliteDb.all('SELECT * FROM email_templates', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (templates.length > 0) {
            for (const template of templates) {
                try {
                    await pgClient.query(`
                        INSERT INTO email_templates (
                            template_key, template_name, subject, content, is_enabled,
                            days_before_checkin, send_hour_checkin,
                            days_after_checkout, send_hour_feedback,
                            days_reserved, send_hour_payment_reminder,
                            created_at, updated_at
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
                            updated_at = EXCLUDED.updated_at
                    `, [
                        template.template_key,
                        template.template_name,
                        template.subject,
                        template.content,
                        template.is_enabled !== undefined ? template.is_enabled : 1,
                        template.days_before_checkin || null,
                        template.send_hour_checkin || null,
                        template.days_after_checkout || null,
                        template.send_hour_feedback || null,
                        template.days_reserved || null,
                        template.send_hour_payment_reminder || null,
                        template.created_at || new Date().toISOString(),
                        template.updated_at || new Date().toISOString()
                    ]);
                } catch (err) {
                    if (!err.message.includes('duplicate key')) {
                        console.warn(`⚠️  遷移模板 ${template.template_key} 時發生錯誤:`, err.message);
                    }
                }
            }
            console.log(`✅ 已遷移 ${templates.length} 個郵件模板`);
        } else {
            console.log('ℹ️  沒有郵件模板需要遷移');
        }

        await pgClient.query('COMMIT');
        console.log('\n========================================');
        console.log('✅ 資料遷移完成！');
        console.log('========================================\n');

    } catch (err) {
        await pgClient.query('ROLLBACK');
        console.error('\n❌ 遷移失敗:', err.message);
        throw err;
    } finally {
        sqliteDb.close();
        pgClient.release();
        await pool.end();
    }
}

// 執行遷移
migrateData()
    .then(() => {
        console.log('🎉 所有資料已成功遷移到 PostgreSQL！');
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ 遷移過程發生錯誤:', err);
        process.exit(1);
    });

