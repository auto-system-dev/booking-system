/**
 * 一次性遷移腳本：將本地 uploads/ 目錄的圖片搬移到 Cloudflare R2，
 * 並更新資料庫中所有圖片 URL。
 *
 * 使用方式：node migrate-to-r2.js
 *
 * 此腳本需要在能存取 uploads/ 目錄的環境中執行（例如 Railway）。
 * 執行前請確保 .env 中已設定好 R2 相關環境變數。
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
    console.error('❌ 請先在 .env 中設定所有 R2 環境變數');
    process.exit(1);
}

const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

async function uploadToR2(filePath, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileBuffer = fs.readFileSync(filePath);

    await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: mimeType,
    }));

    return `${R2_PUBLIC_URL}/${fileName}`;
}

async function getDbClient() {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (DATABASE_URL && DATABASE_URL.startsWith('postgresql')) {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: DATABASE_URL });
        return {
            type: 'pg',
            pool,
            query: (sql, params) => pool.query(sql, params),
            close: () => pool.end(),
        };
    } else {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, 'booking.db');
        const db = new sqlite3.Database(dbPath);
        return {
            type: 'sqlite',
            db,
            query: (sql, params) => new Promise((resolve, reject) => {
                db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows });
                });
            }),
            run: (sql, params) => new Promise((resolve, reject) => {
                db.run(sql, params, function (err) {
                    if (err) reject(err);
                    else resolve({ rowCount: this.changes });
                });
            }),
            close: () => new Promise((resolve) => db.close(resolve)),
        };
    }
}

async function needsMigration() {
    const client = await getDbClient();
    try {
        const result = await client.query(
            "SELECT COUNT(*) as cnt FROM room_types WHERE image_url LIKE '/uploads/%'"
        );
        const roomCount = parseInt(result.rows[0].cnt);

        const result2 = await client.query(
            "SELECT COUNT(*) as cnt FROM room_type_images WHERE image_url LIKE '/uploads/%'"
        );
        const galleryCount = parseInt(result2.rows[0].cnt);

        const result3 = await client.query(
            "SELECT COUNT(*) as cnt FROM settings WHERE value LIKE '/uploads/%'"
        );
        const settingsCount = parseInt(result3.rows[0].cnt);

        return (roomCount + galleryCount + settingsCount) > 0;
    } catch {
        return false;
    } finally {
        await client.close();
    }
}

async function migrate() {
    // 檢查是否需要遷移（資料庫中還有 /uploads/ 路徑才執行）
    const hasLocalUrls = await needsMigration();
    const hasLocalFiles = fs.existsSync(uploadsDir) &&
        fs.readdirSync(uploadsDir).some(f => Object.keys(MIME_TYPES).includes(path.extname(f).toLowerCase()));

    if (!hasLocalUrls && !hasLocalFiles) {
        console.log('✅ 圖片已全部遷移至 R2，跳過遷移步驟。');
        return;
    }

    console.log('========================================');
    console.log('  圖片遷移工具：本地 → Cloudflare R2');
    console.log('========================================\n');

    // 步驟 1：掃描 uploads 目錄
    if (!fs.existsSync(uploadsDir)) {
        console.log('⚠️  uploads 目錄不存在，沒有需要搬移的檔案');
        console.log('將直接更新資料庫中的圖片路徑...\n');
    }

    const files = fs.existsSync(uploadsDir)
        ? fs.readdirSync(uploadsDir).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return Object.keys(MIME_TYPES).includes(ext);
        })
        : [];

    console.log(`📁 找到 ${files.length} 個圖片檔案\n`);

    // 步驟 2：上傳所有圖片到 R2
    const uploadedMap = {}; // { 'filename.jpg': 'https://r2-url/filename.jpg' }
    let uploadSuccess = 0;
    let uploadFailed = 0;

    for (const fileName of files) {
        const filePath = path.join(uploadsDir, fileName);
        try {
            const r2Url = await uploadToR2(filePath, fileName);
            uploadedMap[fileName] = r2Url;
            uploadSuccess++;
            console.log(`  ✅ ${fileName} → ${r2Url}`);
        } catch (error) {
            uploadFailed++;
            console.error(`  ❌ ${fileName} 上傳失敗: ${error.message}`);
        }
    }

    console.log(`\n📤 上傳結果: ${uploadSuccess} 成功, ${uploadFailed} 失敗\n`);

    // 步驟 3：更新資料庫
    console.log('🔄 開始更新資料庫...\n');
    const client = await getDbClient();
    let dbUpdated = 0;

    try {
        // 3a. 更新 room_types.image_url
        const roomTypes = await client.query(
            "SELECT id, image_url FROM room_types WHERE image_url IS NOT NULL AND image_url LIKE '/uploads/%'"
        );
        for (const row of roomTypes.rows) {
            const fileName = path.basename(row.image_url);
            const newUrl = uploadedMap[fileName] || `${R2_PUBLIC_URL}/${fileName}`;
            if (client.type === 'sqlite') {
                await client.run('UPDATE room_types SET image_url = ? WHERE id = ?', [newUrl, row.id]);
            } else {
                await client.query('UPDATE room_types SET image_url = $1 WHERE id = $2', [newUrl, row.id]);
            }
            console.log(`  🏨 room_types #${row.id}: ${row.image_url} → ${newUrl}`);
            dbUpdated++;
        }

        // 3b. 更新 room_type_images.image_url
        const galleryImages = await client.query(
            "SELECT id, image_url FROM room_type_images WHERE image_url LIKE '/uploads/%'"
        );
        for (const row of galleryImages.rows) {
            const fileName = path.basename(row.image_url);
            const newUrl = uploadedMap[fileName] || `${R2_PUBLIC_URL}/${fileName}`;
            if (client.type === 'sqlite') {
                await client.run('UPDATE room_type_images SET image_url = ? WHERE id = ?', [newUrl, row.id]);
            } else {
                await client.query('UPDATE room_type_images SET image_url = $1 WHERE id = $2', [newUrl, row.id]);
            }
            console.log(`  🖼️  room_type_images #${row.id}: ${row.image_url} → ${newUrl}`);
            dbUpdated++;
        }

        // 3c. 更新 settings 中的圖片路徑（銷售頁圖片等）
        const settings = await client.query(
            "SELECT key, value FROM settings WHERE value LIKE '/uploads/%'"
        );
        for (const row of settings.rows) {
            const fileName = path.basename(row.value);
            const newUrl = uploadedMap[fileName] || `${R2_PUBLIC_URL}/${fileName}`;
            if (client.type === 'sqlite') {
                await client.run('UPDATE settings SET value = ? WHERE key = ?', [newUrl, row.key]);
            } else {
                await client.query('UPDATE settings SET value = $1 WHERE key = $2', [newUrl, row.key]);
            }
            console.log(`  ⚙️  settings[${row.key}]: ${row.value} → ${newUrl}`);
            dbUpdated++;
        }

    } catch (error) {
        console.error('❌ 資料庫更新錯誤:', error.message);
    } finally {
        await client.close();
    }

    // 結果
    console.log('\n========================================');
    console.log('  遷移完成！');
    console.log('========================================');
    console.log(`  📤 圖片上傳: ${uploadSuccess} 成功 / ${uploadFailed} 失敗`);
    console.log(`  💾 資料庫更新: ${dbUpdated} 筆`);
    console.log('========================================\n');

    if (uploadFailed === 0 && files.length > 0) {
        console.log('💡 所有圖片已搬移到 R2，你可以在確認一切正常後刪除本地 uploads/ 目錄。');
    }
}

migrate().catch(err => {
    console.error('❌ 遷移腳本執行失敗:', err);
    process.exit(1);
});
