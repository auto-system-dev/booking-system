function createAdminLogCleanupJobs(deps) {
    const {
        db,
        processEnv,
        setTimeoutFn = setTimeout
    } = deps;

    function isEnabled() {
        const rawValue = (processEnv.ADMIN_LOG_AUTO_CLEANUP_ENABLED || 'true').toLowerCase();
        return !['false', '0', 'no', 'off'].includes(rawValue);
    }

    async function run(trigger) {
        try {
            const result = await db.cleanupAdminLogs();
            console.log(
                `✅ 操作日誌清理完成 [${trigger}] ` +
                `(保留 ${result.retentionDays} 天, 候選 ${result.totalCandidates} 筆, 已刪除 ${result.deletedCount} 筆, 批次 ${result.runCount})`
            );

            if (result.hasRemainingCandidates) {
                console.log('ℹ️  仍有舊日誌待清理，將於下次排程繼續清理');
            }
        } catch (error) {
            console.error(`❌ 操作日誌清理失敗 [${trigger}]:`, error.message);
        }
    }

    function scheduleStartup(delayMs = 5000) {
        if (!isEnabled()) {
            console.log('ℹ️  已停用操作日誌自動清理（ADMIN_LOG_AUTO_CLEANUP_ENABLED=false）');
            return;
        }
        setTimeoutFn(() => {
            run('startup').catch((error) => {
                console.error('❌ 啟動後操作日誌清理失敗:', error.message);
            });
        }, delayMs);
    }

    async function runDailyCron() {
        if (!isEnabled()) return;
        await run('daily-cron');
    }

    return {
        isEnabled,
        run,
        scheduleStartup,
        runDailyCron
    };
}

module.exports = {
    createAdminLogCleanupJobs
};
