function createPaymentController(deps) {
    const {
        db,
        paymentClient,
        paymentService,
        logPaymentEvent
    } = deps;

    async function createPayment(req, res) {
        try {
            const { bookingId } = req.body;

            if (!bookingId) {
                return res.status(400).json({
                    success: false,
                    message: '請提供訂房編號'
                });
            }

            const booking = await db.getBookingById(bookingId);

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: '找不到該訂房記錄'
                });
            }

            const ecpayConfig = await paymentService.getEcpayConfigFromSettings(['MerchantID', 'HashKey', 'HashIV']);
            const paymentData = paymentClient.createPaymentForm({
                bookingId: booking.booking_id,
                finalAmount: booking.final_amount,
                guestName: booking.guest_name,
                guestEmail: booking.guest_email,
                guestPhone: booking.guest_phone
            }, {
                amount: booking.final_amount,
                description: `訂房編號：${booking.booking_id}`
            }, {
                MerchantID: ecpayConfig.MerchantID,
                HashKey: ecpayConfig.HashKey,
                HashIV: ecpayConfig.HashIV
            });

            return res.json({
                success: true,
                data: paymentData
            });
        } catch (error) {
            console.error('建立支付表單錯誤:', error);
            return res.status(500).json({
                success: false,
                message: '建立支付表單失敗'
            });
        }
    }

    async function paymentReturn(req, res) {
        const requestId = req.requestId || null;
        const route = '/api/payment/return';
        try {
            logPaymentEvent('info', 'payment.return.received', {
                requestId,
                route,
                method: req.method,
                bookingId: req.body?.MerchantTradeNo || null,
                tradeNo: req.body?.TradeNo || null,
                result: 'received'
            });

            const ecpayConfig = await paymentService.getEcpayConfigFromSettings(['HashKey', 'HashIV']);
            const isValid = paymentClient.verifyReturnData(req.body, {
                HashKey: ecpayConfig.HashKey,
                HashIV: ecpayConfig.HashIV
            });

            if (!isValid) {
                logPaymentEvent('error', 'ALERT_PAYMENT_SIGNATURE_VERIFY_FAILED', {
                    requestId,
                    route,
                    bookingId: req.body?.MerchantTradeNo || null,
                    tradeNo: req.body?.TradeNo || null,
                    result: 'invalid_signature'
                });
                return res.status(400).send('驗證失敗');
            }

            const paymentResult = paymentClient.parseReturnData(req.body);
            logPaymentEvent('info', 'payment.return.verified', {
                requestId,
                route,
                bookingId: paymentResult?.merchantTradeNo || null,
                tradeNo: paymentResult?.tradeNo || null,
                rtnCode: paymentResult?.rtnCode || null,
                result: 'verified'
            });

            if (paymentResult.rtnCode === '1') {
                await paymentService.handleCardPaymentSuccessByCallback(paymentResult.merchantTradeNo, {
                    requestId,
                    tradeNo: paymentResult.tradeNo
                });
            }

            logPaymentEvent('info', 'payment.return.ack', {
                requestId,
                route,
                bookingId: paymentResult?.merchantTradeNo || null,
                tradeNo: paymentResult?.tradeNo || null,
                result: 'ack_1_OK'
            });
            return res.send('1|OK');
        } catch (error) {
            console.error('處理付款回傳錯誤:', error);
            logPaymentEvent('error', 'ALERT_PAYMENT_CALLBACK_PROCESSING_ERROR', {
                requestId,
                route,
                bookingId: req.body?.MerchantTradeNo || null,
                tradeNo: req.body?.TradeNo || null,
                result: 'error',
                error: error.message
            });
            return res.status(500).send('處理失敗');
        }
    }

    async function paymentResult(req, res) {
        const requestId = req.requestId || null;
        const route = '/api/payment/result';
        try {
            const returnData = req.method === 'POST' ? req.body : req.query;
            logPaymentEvent('info', 'payment.result.received', {
                requestId,
                route,
                method: req.method,
                bookingId: returnData?.MerchantTradeNo || null,
                tradeNo: returnData?.TradeNo || null,
                result: 'received'
            });

            const ecpayConfig = await paymentService.getEcpayConfigFromSettings(['HashKey', 'HashIV']);
            const isValid = paymentClient.verifyReturnData(returnData, {
                HashKey: ecpayConfig.HashKey,
                HashIV: ecpayConfig.HashIV
            });

            if (!isValid) {
                const isTestEnv = process.env.NODE_ENV !== 'production';
                logPaymentEvent('warn', 'ALERT_PAYMENT_RESULT_SIGNATURE_VERIFY_FAILED', {
                    requestId,
                    route,
                    bookingId: returnData?.MerchantTradeNo || null,
                    tradeNo: returnData?.TradeNo || null,
                    result: 'invalid_signature'
                });
                if (!(isTestEnv && returnData.RtnCode === '1')) {
                    return res.status(400).send('付款驗證失敗');
                }
            }

            const paymentResult = paymentClient.parseReturnData(returnData);
            logPaymentEvent('info', 'payment.result.parsed', {
                requestId,
                route,
                bookingId: paymentResult?.merchantTradeNo || null,
                tradeNo: paymentResult?.tradeNo || null,
                rtnCode: paymentResult?.rtnCode || null,
                result: 'parsed'
            });

            if (paymentResult.rtnCode === '1') {
                logPaymentEvent('info', 'payment.result.render_success', {
                    requestId,
                    route,
                    bookingId: paymentResult?.merchantTradeNo || null,
                    tradeNo: paymentResult?.tradeNo || null,
                    result: 'render_success_page'
                });
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>付款成功</title>
                            <style>
                                :root {
                                    --primary-color: #2C8EC4;
                                    --card-bg: #ffffff;
                                    --header-bg: #262A33;
                                }
                                body {
                                    font-family: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                                    display: flex;
                                    justify-content: center;
                                    align-items: center;
                                    min-height: 100vh;
                                    margin: 0;
                                    background-image: url('/Background%20image.jpg');
                                    background-size: cover;
                                    background-position: center;
                                    background-repeat: no-repeat;
                                    background-attachment: fixed;
                                    padding: 20px;
                                }
                                .container {
                                    background: var(--card-bg);
                                    border-radius: 24px;
                                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                    text-align: center;
                                    max-width: 480px;
                                    width: 100%;
                                    overflow: hidden;
                                }
                                .container-header {
                                    background: var(--header-bg);
                                    color: #fff;
                                    padding: 24px 20px 16px;
                                }
                                .container-header h1 {
                                    color: #fff !important;
                                    margin: 0 0 16px;
                                    font-size: 24px;
                                }
                                .success-icon {
                                    font-size: 56px;
                                    color: #4caf50;
                                    margin-bottom: 8px;
                                }
                                .container-body {
                                    padding: 24px 28px 28px;
                                }
                                h1 { color: #333; margin: 0 0 16px; font-size: 24px; }
                                p { color: #555; margin: 6px 0; font-size: 14px; }
                                .btn {
                                    display: inline-block;
                                    margin-top: 20px;
                                    padding: 10px 28px;
                                    background: var(--primary-color);
                                    color: #fff;
                                    text-decoration: none;
                                    border-radius: 999px;
                                    font-size: 14px;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="container-header">
                                <div class="success-icon">✓</div>
                                <h1>付款成功！</h1>
                                </div>
                                <div class="container-body">
                                <p>訂單編號：${paymentResult.merchantTradeNo}</p>
                                <p>交易編號：${paymentResult.tradeNo}</p>
                                <p>付款金額：NT$ ${paymentResult.tradeAmt.toLocaleString()}</p>
                                <p>付款時間：${paymentResult.paymentDate}</p>
                                <a href="/" class="btn">返回首頁</a>
                                </div>
                            </div>
                        </body>
                    </html>
                `);
            }

            logPaymentEvent('warn', 'payment.result.render_failed', {
                requestId,
                route,
                bookingId: paymentResult?.merchantTradeNo || null,
                tradeNo: paymentResult?.tradeNo || null,
                rtnCode: paymentResult?.rtnCode || null,
                result: 'render_failed_page'
            });
            return res.send(`
                <!DOCTYPE html>
                <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>付款失敗</title>
                        <style>
                            body {
                                font-family: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                                padding: 20px;
                                background-image: url('Background%20image.jpg');
                                background-size: cover;
                                background-position: center;
                                background-repeat: no-repeat;
                                background-attachment: fixed;
                            }
                            .container {
                                background: white;
                                padding: 40px;
                                border-radius: 24px;
                                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                                text-align: center;
                                max-width: 500px;
                                animation: slideUp 0.5s ease-out;
                            }
                            @keyframes slideUp {
                                from {
                                    opacity: 0;
                                    transform: translateY(30px);
                                }
                                to {
                                    opacity: 1;
                                    transform: translateY(0);
                                }
                            }
                            .error-icon {
                                font-size: 80px;
                                color: #f44336;
                                margin-bottom: 20px;
                            }
                            h1 { 
                                color: #333; 
                                margin-bottom: 10px; 
                                font-size: 24px;
                                font-weight: 600;
                            }
                            p { 
                                color: #666; 
                                margin: 10px 0; 
                                font-size: 16px;
                            }
                            .btn {
                                display: inline-block;
                                margin-top: 20px;
                                padding: 12px 30px;
                                background: #262A33;
                                color: white;
                                text-decoration: none;
                                border-radius: 8px;
                                font-weight: 500;
                                transition: background 0.3s;
                            }
                            .btn:hover {
                                background: #1a1d24;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error-icon">✗</div>
                            <h1>付款失敗</h1>
                            <p>${paymentResult.rtnMsg || '付款處理失敗'}</p>
                            <a href="/" class="btn">返回首頁</a>
                        </div>
                    </body>
                </html>
            `);
        } catch (error) {
            console.error('處理付款導向錯誤:', error);
            logPaymentEvent('error', 'ALERT_PAYMENT_RESULT_PROCESSING_ERROR', {
                requestId,
                route,
                result: 'error',
                error: error.message
            });
            return res.status(500).send('處理失敗');
        }
    }

    return {
        createPayment,
        paymentReturn,
        paymentResult
    };
}

module.exports = {
    createPaymentController
};
