function createCheckPermission(db) {
    return function checkPermission(permissionCode) {
        return async (req, res, next) => {
            try {
                if (!req.session || !req.session.admin) {
                    return res.status(401).json({ success: false, message: '未登入' });
                }

                const adminId = req.session.admin.id;
                const permissions = req.session.admin.permissions || [];

                if (permissions.includes(permissionCode)) {
                    return next();
                }

                const hasPermission = await db.hasPermission(adminId, permissionCode);

                if (hasPermission) {
                    if (!req.session.admin.permissions) {
                        req.session.admin.permissions = await db.getAdminPermissions(adminId);
                    }
                    return next();
                }

                await db.logAdminAction({
                    adminId: adminId,
                    adminUsername: req.session.admin.username,
                    action: 'permission_denied',
                    resourceType: 'permission',
                    resourceId: permissionCode,
                    details: JSON.stringify({ requestedPermission: permissionCode }),
                    ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
                    userAgent: req.get('user-agent') || 'unknown'
                }).catch(err => console.error('記錄權限檢查失敗日誌錯誤:', err));

                return res.status(403).json({
                    success: false,
                    message: '您沒有權限執行此操作'
                });
            } catch (error) {
                console.error('❌ checkPermission 中間件錯誤:', error.message);
                return res.status(500).json({
                    success: false,
                    message: '權限檢查失敗: ' + error.message
                });
            }
        };
    };
}

module.exports = {
    createCheckPermission
};
