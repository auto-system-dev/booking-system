function normalizeMode(mode) {
    const v = (mode || '').toString().trim();
    return v || 'retail';
}

function createModeGuard(deps) {
    const { db, allowedModes, getMessage } = deps;
    const allowed = Array.isArray(allowedModes) && allowedModes.length > 0 ? allowedModes : ['retail'];

    return async function modeGuard(req, res, next) {
        try {
            const currentMode = normalizeMode(await db.getSetting('system_mode'));
            req.systemMode = currentMode;

            if (!allowed.includes(currentMode)) {
                const message = typeof getMessage === 'function'
                    ? getMessage(currentMode)
                    : `目前系統模式為 ${currentMode}，此功能未啟用`;
                return res.status(403).json({
                    success: false,
                    code: 'MODE_DISABLED',
                    message
                });
            }

            return next();
        } catch (error) {
            return res.status(500).json({
                success: false,
                code: 'MODE_GUARD_ERROR',
                message: '模式檢查失敗：' + error.message
            });
        }
    };
}

module.exports = {
    createModeGuard
};

