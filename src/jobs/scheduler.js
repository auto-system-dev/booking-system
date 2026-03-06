function registerScheduledJobs(deps) {
    const {
        cron,
        backup,
        bookingJobs,
        adminLogCleanupJobs,
        timezone = 'Asia/Taipei'
    } = deps;

    cron.schedule('0 * * * *', bookingJobs.sendPaymentReminderEmails, {
        timezone
    });
    console.log('✅ 匯款提醒定時任務已啟動（每小時檢查，根據模板設定時間發送）');

    cron.schedule('0 * * * *', bookingJobs.sendCheckinReminderEmails, {
        timezone
    });
    console.log('✅ 入住提醒定時任務已啟動（每小時檢查，根據模板設定時間發送）');

    cron.schedule('0 * * * *', bookingJobs.sendFeedbackRequestEmails, {
        timezone
    });
    console.log('✅ 回訪信定時任務已啟動（每小時檢查，根據模板設定時間發送）');

    cron.schedule('30 * * * *', bookingJobs.cancelExpiredReservations, {
        timezone
    });
    console.log('✅ 自動取消過期保留訂房定時任務已啟動（每小時 30 分檢查）');

    cron.schedule('0 2 * * *', async () => {
        try {
            await backup.performBackup();
            await backup.cleanupOldBackups(30);
        } catch (error) {
            console.error('❌ 備份任務失敗:', error.message);
        }
    }, {
        timezone
    });
    console.log('✅ 資料庫備份定時任務已啟動（每天 02:00 台灣時間，保留 30 天）');

    if (adminLogCleanupJobs.isEnabled()) {
        cron.schedule('15 3 * * *', async () => {
            await adminLogCleanupJobs.runDailyCron();
        }, {
            timezone
        });
        console.log('✅ 操作日誌自動清理任務已啟動（每天 03:15 台灣時間）');
    }
}

module.exports = {
    registerScheduledJobs
};
