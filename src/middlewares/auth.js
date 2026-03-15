const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 閒置 30 分鐘
const ABS_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 絕對 8 小時

function clearAdminSession(req) {
    if (!req?.session) return;
    delete req.session.admin;
}

function validateAdminSession(req, { touch = true } = {}) {
    if (!req?.session || !req.session.admin) {
        return { valid: false, reason: 'unauthenticated' };
    }

    const now = Date.now();
    const startedAt = Number(req.session.admin.session_started_at || 0);
    const lastActivityAt = Number(req.session.admin.last_activity_at || 0);

    // 相容舊 Session：缺欄位時補上，不強制登出
    if (!startedAt || !lastActivityAt) {
        req.session.admin.session_started_at = now;
        req.session.admin.last_activity_at = now;
        return { valid: true };
    }

    if (now - startedAt > ABS_TIMEOUT_MS) {
        clearAdminSession(req);
        return { valid: false, reason: 'absolute_timeout' };
    }

    if (now - lastActivityAt > IDLE_TIMEOUT_MS) {
        clearAdminSession(req);
        return { valid: false, reason: 'idle_timeout' };
    }

    if (touch) {
        req.session.admin.last_activity_at = now;
    }

    return { valid: true };
}

function requireAuth(req, res, next) {
    const status = validateAdminSession(req, { touch: true });
    if (status.valid) {
        return next();
    }

    const message = status.reason === 'absolute_timeout'
        ? '登入已超過 8 小時，請重新登入'
        : status.reason === 'idle_timeout'
            ? '閒置超過 30 分鐘，請重新登入'
            : '請先登入';
    return res.status(401).json({ success: false, message });
}

module.exports = {
    requireAuth,
    validateAdminSession,
    clearAdminSession,
    IDLE_TIMEOUT_MS,
    ABS_TIMEOUT_MS
};
