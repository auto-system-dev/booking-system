function createPaymentService(deps) {
    const {
        db,
        notificationService,
        logPaymentEvent,
        processEnv
    } = deps;

    async function getEcpayConfigFromSettings(requiredKeys = ['MerchantID', 'HashKey', 'HashIV']) {
        const isProductionEnv = processEnv.NODE_ENV === 'production';
        const envKeyMap = isProductionEnv
            ? {
                MerchantID: 'ECPAY_MERCHANT_ID_PROD',
                HashKey: 'ECPAY_HASH_KEY_PROD',
                HashIV: 'ECPAY_HASH_IV_PROD'
            }
            : {
                MerchantID: 'ECPAY_MERCHANT_ID',
                HashKey: 'ECPAY_HASH_KEY',
                HashIV: 'ECPAY_HASH_IV'
            };

        const dbConfig = {
            MerchantID: ((await db.getSetting('ecpay_merchant_id')) || '').trim(),
            HashKey: ((await db.getSetting('ecpay_hash_key')) || '').trim(),
            HashIV: ((await db.getSetting('ecpay_hash_iv')) || '').trim()
        };

        const config = {
            isProduction: isProductionEnv,
            MerchantID: dbConfig.MerchantID || (processEnv[envKeyMap.MerchantID] || '').trim(),
            HashKey: dbConfig.HashKey || (processEnv[envKeyMap.HashKey] || '').trim(),
            HashIV: dbConfig.HashIV || (processEnv[envKeyMap.HashIV] || '').trim()
        };

        const missing = requiredKeys.filter((key) => !config[key]);
        if (missing.length > 0) {
            const envNames = missing.map((key) => envKeyMap[key]).join('、');
            throw new Error(
                `綠界支付設定不完整，缺少：${missing.join(', ')}。請在系統設定的「綠界支付設定」中設定，或使用環境變數 ${envNames}`
            );
        }

        return config;
    }

    async function handleCardPaymentSuccessByCallback(bookingId, context = {}) {
        if (!bookingId) {
            throw new Error('缺少 bookingId，無法處理付款成功回調');
        }

        logPaymentEvent('info', 'payment.callback.process.start', {
            requestId: context.requestId || null,
            route: '/api/payment/return',
            bookingId: bookingId,
            tradeNo: context.tradeNo || null,
            result: 'processing'
        });

        const booking = await db.getBookingById(bookingId);
        if (!booking) {
            logPaymentEvent('error', 'ALERT_PAYMENT_CALLBACK_BOOKING_NOT_FOUND', {
                requestId: context.requestId || null,
                route: '/api/payment/return',
                bookingId: bookingId,
                tradeNo: context.tradeNo || null,
                result: 'failed'
            });
            throw new Error(`找不到訂房記錄: ${bookingId}`);
        }

        if (booking.payment_status === 'paid') {
            logPaymentEvent('info', 'payment.callback.idempotent_skip', {
                requestId: context.requestId || null,
                route: '/api/payment/return',
                bookingId: bookingId,
                tradeNo: context.tradeNo || null,
                result: 'already_processed'
            });
            return { alreadyProcessed: true };
        }

        await db.updateBooking(bookingId, {
            payment_status: 'paid',
            status: 'active'
        });
        console.log('✅ 付款狀態已更新為「已付款」，訂房狀態已更新為「有效」');

        if (!(booking.payment_method && booking.payment_method.includes('刷卡'))) {
            logPaymentEvent('info', 'payment.callback.process.done', {
                requestId: context.requestId || null,
                route: '/api/payment/return',
                bookingId: bookingId,
                tradeNo: context.tradeNo || null,
                result: 'paid_updated_non_card'
            });
            return { alreadyProcessed: false };
        }

        await notificationService.sendCardPaymentSuccessNotifications(booking);

        logPaymentEvent('info', 'payment.callback.process.done', {
            requestId: context.requestId || null,
            route: '/api/payment/return',
            bookingId: bookingId,
            tradeNo: context.tradeNo || null,
            result: 'paid_updated_notified'
        });
        return { alreadyProcessed: false };
    }

    return {
        getEcpayConfigFromSettings,
        handleCardPaymentSuccessByCallback
    };
}

module.exports = {
    createPaymentService
};
