async function startServer(deps) {
    const {
        app,
        port,
        processEnv,
        db,
        initEmailService,
        getConfiguredSenderEmail,
        storage,
        registerScheduledJobs,
        cron,
        backup,
        bookingJobs,
        adminLogCleanupJobs
    } = deps;

    console.log('📋 開始啟動伺服器...');
    console.log('📋 環境變數檢查:', {
        PORT: processEnv.PORT || '未設定（將使用 3000）',
        NODE_ENV: processEnv.NODE_ENV || '未設定',
        DATABASE_URL: processEnv.DATABASE_URL ? '已設定' : '未設定',
        RAILWAY_ENVIRONMENT: processEnv.RAILWAY_ENVIRONMENT || '未設定'
    });

    console.log('💾 初始化資料庫...');
    await db.initDatabase();
    console.log('✅ 資料庫初始化完成');

    adminLogCleanupJobs.scheduleStartup(5000);

    console.log('📧 初始化郵件服務...');
    await initEmailService();
    console.log('✅ 郵件服務初始化完成');

    app.listen(port, '0.0.0.0', () => {
        console.log('\n========================================');
        console.log('🚀 訂房系統伺服器已啟動');
        console.log(`📍 端口: ${port}`);
        console.log(`🌐 監聽地址: 0.0.0.0:${port}`);
        console.log(`📧 Email: ${getConfiguredSenderEmail() || '未設定（請至後台設定 email_user）'}`);
        console.log('💾 資料庫: PostgreSQL');
        console.log(`📁 備份目錄: ${processEnv.BACKUP_DIR || './backups'}`);
        console.log(`🖼️ 圖片儲存: ${storage.isCloudStorage ? 'Cloudflare R2' : (processEnv.UPLOADS_DIR || './uploads')}`);
        console.log('========================================\n');
        console.log('等待請求中...\n');

        registerScheduledJobs({
            cron,
            backup,
            bookingJobs,
            adminLogCleanupJobs,
            timezone: 'Asia/Taipei'
        });
    });
}

module.exports = {
    startServer
};
