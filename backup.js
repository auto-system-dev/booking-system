/**
 * 資料庫備份模組
 * 支援 SQLite 和 PostgreSQL 的自動備份功能
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// 備份目錄
const BACKUP_DIR = path.join(__dirname, 'backups');

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
 * 備份 PostgreSQL 資料庫
 */
async function backupPostgreSQL(databaseUrl) {
    try {
        ensureBackupDir();
        
        // 解析 DATABASE_URL
        // 格式：postgresql://user:password@host:port/database
        const url = new URL(databaseUrl);
        const dbName = url.pathname.slice(1); // 移除開頭的 /
        const host = url.hostname;
        const port = url.port || 5432;
        const user = url.username;
        const password = url.password;
        
        // 產生備份檔名：backup_YYYYMMDD_HHMMSS.sql
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
        const backupFileName = `backup_${dateStr}.sql`;
        const backupPath = path.join(BACKUP_DIR, backupFileName);
        
        // 設定環境變數（pg_dump 會自動讀取）
        const env = {
            ...process.env,
            PGPASSWORD: password
        };
        
        // 執行 pg_dump
        const command = `pg_dump -h ${host} -p ${port} -U ${user} -d ${dbName} -F c -f "${backupPath}"`;
        
        try {
            await execAsync(command, { env });
        } catch (execError) {
            // 如果 pg_dump 不可用，嘗試使用自訂格式失敗時改用純文字格式
            if (execError.message.includes('pg_dump')) {
                console.warn('⚠️  pg_dump 不可用，嘗試使用純文字格式...');
                const textCommand = `pg_dump -h ${host} -p ${port} -U ${user} -d ${dbName} > "${backupPath}"`;
                await execAsync(textCommand, { env });
            } else {
                throw execError;
            }
        }
        
        // 檢查備份檔案是否存在
        if (!fs.existsSync(backupPath)) {
            throw new Error('備份檔案未建立');
        }
        
        // 取得檔案大小
        const stats = fs.statSync(backupPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✅ PostgreSQL 備份成功: ${backupFileName} (${fileSizeMB} MB)`);
        
        return {
            success: true,
            fileName: backupFileName,
            filePath: backupPath,
            fileSize: stats.size,
            fileSizeMB: parseFloat(fileSizeMB),
            timestamp: now.toISOString()
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

module.exports = {
    performBackup,
    cleanupOldBackups,
    getBackupList,
    getBackupStats,
    backupSQLite,
    backupPostgreSQL
};

