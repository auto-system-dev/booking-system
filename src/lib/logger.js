function logPaymentEvent(level, event, data = {}) {
    const payload = {
        event,
        timestamp: new Date().toISOString(),
        ...data
    };

    if (level === 'error') {
        console.error('[PAYMENT]', JSON.stringify(payload));
        return;
    }

    if (level === 'warn') {
        console.warn('[PAYMENT]', JSON.stringify(payload));
        return;
    }

    console.log('[PAYMENT]', JSON.stringify(payload));
}

module.exports = {
    logPaymentEvent
};
