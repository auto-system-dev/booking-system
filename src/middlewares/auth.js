function requireAuth(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    }
    return res.status(401).json({ success: false, message: '請先登入' });
}

module.exports = {
    requireAuth
};
