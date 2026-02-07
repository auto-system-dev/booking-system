/**
 * 資料庫備份模組
 * 支援 SQLite 和 PostgreSQL 的自動備份功能
 * PostgreSQL 使用 JavaScript 原生 SQL 查詢匯出（不依賴 pg_dump）
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// 備份目錄（支援環境變數設定，適用於 Railway Volume 掛載）
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');

// 確保備份目錄存在
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        console.log('✅ 備份目錄已建立:', BACKUP_DIR);
    }
}

/**
 * 備份 SQLite 資料庫
 */
async function backupSQLite(dbPath) {
    try {
        ensureBackupDir();
        
        // 檢查資料庫檔案是否存在
        if (!fs.existsSync(dbPath)) {
            throw new Error(`資料庫檔案不存在: ${dbPath}`);
        }
        
        // 產生備份檔名：backup_YYYYMMDD_HHMMSS.db
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        const backupFileName = `backup_${dateStr}.db`;
        const backupPath = path.join(BACKUP_DIR, backupFileName);
        
        // 複製資料庫檔案
        fs.copyFileSync(dbPath, backupPath);
        
        // 取得檔案大小
        const stats = fs.statSync(backupPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✅ SQLite 備份成功: ${backupFileName} (${fileSizeMB} MB)`);
        
        return {
            success: true,
            fileName: backupFileName,
            filePath: backupPath,
            fileSize: stats.size,
            fileSizeMB: parseFloat(fileSizeMB),
            timestamp: now.toISOString()
        };
    } catch (error) {
        console.error('❌ SQLite 備份失敗:', error.message);
        throw error;
    }
}

/**
 * 備份 PostgreSQL 資料庫（使用 JavaScript 原生 SQL 查詢匯出）
 * 不依賴 pg_dump，適用於 Railway 等無 pg_dump 的環境
 */
async function backupPostgreSQL(databaseUrl) {
    try {
        ensureBackupDir();
        
        // 建立獨立連線池進行備份
        const pool = new Pool({
            connectionString: databaseUrl,
            ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false
        });
        
        // 產生備份檔名：backup_YYYYMMDD_HHMMSS.json
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        const backupFileName = `backup_${dateStr}.json`;
        const backupPath = path.join(BACKUP_DIR, backupFileName);
        
        console.log('📦 開始匯出 PostgreSQL 資料...');
        
        // 取得所有使用者建立的資料表
        const tablesResult = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        const tables = tablesResult.rows.map(r => r.table_name);
        console.log(`📋 找到 ${tables.length} 個資料表: ${tables.join(', ')}`);
        
        const backupData = {
            metadata: {
                version: '1.0',
                type: 'postgresql_json_backup',
                created_at: now.toISOString(),
                tables: tables,
                table_count: tables.length
            },
            data: {}
        };
        
        // 逐一匯出每個資料表的資料
        for (const table of tables) {
            try {
                // 取得資料表結構
                const columnsResult = await pool.query(`
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' AND table_name = $1
                    ORDER BY ordinal_position
                `, [table]);
                
                // 取得資料
                const dataResult = await pool.query(`SELECT * FROM "${table}"`);
                
                backupData.data[table] = {
                    columns: columnsResult.rows,
                    row_count: dataResult.rows.length,
                    rows: dataResult.rows
                };
                
                console.log(`  ✅ ${table}: ${dataResult.rows.length} 筆資料`);
            } catch (tableError) {
                console.error(`  ❌ 匯出 ${table} 失敗:`, tableError.message);
                backupData.data[table] = {
                    error: tableError.message,
                    row_count: 0,
                    rows: []
                };
            }
        }
        
        // 更新 metadata 的記錄數
        let totalRows = 0;
        for (const table of tables) {
            totalRows += (backupData.data[table]?.row_count || 0);
        }
        backupData.metadata.total_rows = totalRows;
        
        // 寫入備份檔案
        const jsonStr = JSON.stringify(backupData, null, 2);
        fs.writeFileSync(backupPath, jsonStr, 'utf8');
        
        // 關閉獨立連線池
        await pool.end();
        
        // 取得檔案大小
        const stats = fs.statSync(backupPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✅ PostgreSQL 備份成功: ${backupFileName} (${fileSizeMB} MB, ${totalRows} 筆資料)`);
        
        return {
            success: true,
            fileName: backupFileName,
            filePath: backupPath,
            fileSize: stats.size,
            fileSizeMB: parseFloat(fileSizeMB),
            timestamp: now.toISOString(),
            tableCount: tables.length,
            totalRows: totalRows
        };
    } catch (error) {
        console.error('❌ PostgreSQL 備份失敗:', error.message);
        throw error;
    }
}

/**
 * 執行資料庫備份（自動偵測資料庫類型）
 */
async function performBackup() {
    try {
        console.log('\n[備份任務] 開始執行資料庫備份...');
        
        const usePostgreSQL = !!process.env.DATABASE_URL;
        
        if (usePostgreSQL) {
            // PostgreSQL 備份
            const result = await backupPostgreSQL(process.env.DATABASE_URL);
            console.log(`✅ 備份完成: ${result.fileName}`);
            return result;
        } else {
            // SQLite 備份
            const dbPath = path.join(__dirname, 'bookings.db');
            const result = await backupSQLite(dbPath);
            console.log(`✅ 備份完成: ${result.fileName}`);
            return result;
        }
    } catch (error) {
        console.error('❌ 資料庫備份失敗:', error.message);
        throw error;
    }
}

/**
 * 清理舊備份（保留最近 N 天）
 */
async function cleanupOldBackups(daysToKeep = 30) {
    try {
        ensureBackupDir();
        
        const files = fs.readdirSync(BACKUP_DIR);
        const now = new Date();
        const cutoffDate = new Date(now);
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        let deletedCount = 0;
        let totalSizeFreed = 0;
        
        for (const file of files) {
            // 只處理備份檔案
            if (!file.startsWith('backup_')) {
                continue;
            }
            
            const filePath = path.join(BACKUP_DIR, file);
            const stats = fs.statSync(filePath);
            const fileDate = stats.mtime;
            
            // 如果檔案超過保留期限，刪除
            if (fileDate < cutoffDate) {
                totalSizeFreed += stats.size;
                fs.unlinkSync(filePath);
                deletedCount++;
                console.log(`🗑️  刪除舊備份: ${file}`);
            }
        }
        
        if (deletedCount > 0) {
            const sizeFreedMB = (totalSizeFreed / (1024 * 1024)).toFixed(2);
            console.log(`✅ 清理完成: 刪除 ${deletedCount} 個舊備份，釋放 ${sizeFreedMB} MB`);
        } else {
            console.log('✅ 清理完成: 沒有需要刪除的舊備份');
        }
        
        return {
            deletedCount,
            totalSizeFreed,
            totalSizeFreedMB: parseFloat((totalSizeFreed / (1024 * 1024)).toFixed(2))
        };
    } catch (error) {
        console.error('❌ 清理舊備份失敗:', error.message);
        throw error;
    }
}

/**
 * 取得備份列表
 */
function getBackupList() {
    try {
        ensureBackupDir();
        
        const files = fs.readdirSync(BACKUP_DIR);
        const backups = [];
        
        for (const file of files) {
            if (!file.startsWith('backup_')) {
                continue;
            }
            
            const filePath = path.join(BACKUP_DIR, file);
            const stats = fs.statSync(filePath);
            
            backups.push({
                fileName: file,
                filePath: filePath,
                fileSize: stats.size,
                fileSizeMB: parseFloat((stats.size / (1024 * 1024)).toFixed(2)),
                createdAt: stats.birthtime,
                modifiedAt: stats.mtime
            });
        }
        
        // 按建立時間排序（最新的在前）
        backups.sort((a, b) => b.createdAt - a.createdAt);
        
        return backups;
    } catch (error) {
        console.error('❌ 取得備份列表失敗:', error.message);
        throw error;
    }
}

/**
 * 取得備份統計資訊
 */
function getBackupStats() {
    try {
        const backups = getBackupList();
        const totalSize = backups.reduce((sum, backup) => sum + backup.fileSize, 0);
        const totalSizeMB = parseFloat((totalSize / (1024 * 1024)).toFixed(2));
        
        return {
            totalBackups: backups.length,
            totalSize: totalSize,
            totalSizeMB: totalSizeMB,
            oldestBackup: backups.length > 0 ? backups[backups.length - 1].createdAt : null,
            newestBackup: backups.length > 0 ? backups[0].createdAt : null
        };
    } catch (error) {
        console.error('❌ 取得備份統計失敗:', error.message);
        throw error;
    }
}

/**
 * 刪除指定備份檔案
 */
function deleteBackup(fileName) {
    try {
        ensureBackupDir();
        
        // 防止路徑遍歷攻擊
        const safeName = path.basename(fileName);
        if (!safeName.startsWith('backup_')) {
            throw new Error('無效的備份檔案名稱');
        }
        
        const filePath = path.join(BACKUP_DIR, safeName);
        
        if (!fs.existsSync(filePath)) {
            throw new Error('備份檔案不存在');
        }
        
        const stats = fs.statSync(filePath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        fs.unlinkSync(filePath);
        
        console.log(`🗑️ 已刪除備份: ${safeName} (${fileSizeMB} MB)`);
        
        return {
            success: true,
            fileName: safeName,
            fileSizeMB: parseFloat(fileSizeMB)
        };
    } catch (error) {
        console.error('❌ 刪除備份失敗:', error.message);
        throw error;
    }
}

/**
 * 還原 PostgreSQL 備份（從 JSON 備份檔案）
 */
async function restorePostgreSQL(databaseUrl, fileName) {
    try {
        ensureBackupDir();
        
        const safeName = path.basename(fileName);
        const filePath = path.join(BACKUP_DIR, safeName);
        
        if (!fs.existsSync(filePath)) {
            throw new Error('備份檔案不存在');
        }
        
        console.log(`🔄 開始還原 PostgreSQL 備份: ${safeName}`);
        
        // 讀取備份檔案
        const rawData = fs.readFileSync(filePath, 'utf8');
        const backupData = JSON.parse(rawData);
        
        if (!backupData.metadata || backupData.metadata.type !== 'postgresql_json_backup') {
            throw new Error('無效的備份檔案格式，僅支援 JSON 格式備份還原');
        }
        
        // 建立獨立連線池
        const pool = new Pool({
            connectionString: databaseUrl,
            ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false
        });
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const tables = backupData.metadata.tables || Object.keys(backupData.data);
            let restoredTables = 0;
            let totalRowsRestored = 0;
            
            for (const table of tables) {
                const tableData = backupData.data[table];
                if (!tableData || !tableData.rows || tableData.rows.length === 0) {
                    console.log(`  ⏭️ ${table}: 無資料，跳過`);
                    continue;
                }
                
                try {
                    // 清空資料表（使用 TRUNCATE CASCADE 處理外鍵）
                    await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
                    
                    // 批次插入資料
                    const columns = Object.keys(tableData.rows[0]);
                    const columnNames = columns.map(c => `"${c}"`).join(', ');
                    
                    for (const row of tableData.rows) {
                        const values = columns.map(c => row[c]);
                        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                        
                        await client.query(
                            `INSERT INTO "${table}" (${columnNames}) VALUES (${placeholders})`,
                            values
                        );
                    }
                    
                    // 重設序列（auto-increment）
                    if (columns.includes('id')) {
                        await client.query(`
                            SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), 
                                COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)
                        `).catch(() => {
                            // 如果沒有序列就跳過
                        });
                    }
                    
                    restoredTables++;
                    totalRowsRestored += tableData.rows.length;
                    console.log(`  ✅ ${table}: 還原 ${tableData.rows.length} 筆資料`);
                } catch (tableError) {
                    console.error(`  ❌ 還原 ${table} 失敗:`, tableError.message);
                    throw tableError;
                }
            }
            
            await client.query('COMMIT');
            
            console.log(`✅ PostgreSQL 還原完成: ${restoredTables} 個資料表, ${totalRowsRestored} 筆資料`);
            
            return {
                success: true,
                fileName: safeName,
                restoredTables,
                totalRowsRestored
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
            await pool.end();
        }
    } catch (error) {
        console.error('❌ PostgreSQL 還原失敗:', error.message);
        throw error;
    }
}

/**
 * 還原 SQLite 備份
 */
async function restoreSQLite(fileName) {
    try {
        ensureBackupDir();
        
        const safeName = path.basename(fileName);
        const filePath = path.join(BACKUP_DIR, safeName);
        
        if (!fs.existsSync(filePath)) {
            throw new Error('備份檔案不存在');
        }
        
        if (!safeName.endsWith('.db')) {
            throw new Error('無效的 SQLite 備份檔案格式');
        }
        
        const dbPath = path.join(__dirname, 'bookings.db');
        
        // 先備份目前的資料庫（安全措施）
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        const preRestoreBackup = `backup_pre_restore_${dateStr}.db`;
        const preRestorePath = path.join(BACKUP_DIR, preRestoreBackup);
        
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, preRestorePath);
            console.log(`📦 還原前備份: ${preRestoreBackup}`);
        }
        
        // 覆蓋目前的資料庫檔案
        fs.copyFileSync(filePath, dbPath);
        
        const stats = fs.statSync(dbPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✅ SQLite 還原完成: ${safeName} (${fileSizeMB} MB)`);
        
        return {
            success: true,
            fileName: safeName,
            fileSizeMB: parseFloat(fileSizeMB),
            preRestoreBackup
        };
    } catch (error) {
        console.error('❌ SQLite 還原失敗:', error.message);
        throw error;
    }
}

/**
 * 還原備份（自動偵測資料庫類型）
 */
async function restoreBackup(fileName) {
    try {
        console.log(`\n[還原任務] 開始還原備份: ${fileName}`);
        
        const usePostgreSQL = !!process.env.DATABASE_URL;
        
        if (usePostgreSQL) {
            return await restorePostgreSQL(process.env.DATABASE_URL, fileName);
        } else {
            return await restoreSQLite(fileName);
        }
    } catch (error) {
        console.error('❌ 還原備份失敗:', error.message);
        throw error;
    }
}

module.exports = {
    performBackup,
    cleanupOldBackups,
    getBackupList,
    getBackupStats,
    deleteBackup,
    restoreBackup,
    backupSQLite,
    backupPostgreSQL
};

