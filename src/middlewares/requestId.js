const { randomUUID } = require('crypto');

function requestIdMiddleware(req, res, next) {
    const incomingId = (req.headers['x-request-id'] || '').toString().trim();
    req.requestId = incomingId || randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
}

module.exports = requestIdMiddleware;
