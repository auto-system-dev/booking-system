const express = require('express');

function createOrderQueryRoutes(deps) {
    const {
        orderQueryService,
        publicLimiter
    } = deps;

    const router = express.Router();

    router.get('/line/:lineUserId', publicLimiter, async (req, res) => {
        try {
            const lineUserId = (req.params.lineUserId || '').trim();
            if (!lineUserId) {
                return res.status(400).json({
                    success: false,
                    message: '缺少 LINE User ID'
                });
            }

            const bookings = await orderQueryService.queryByLineUserId(lineUserId);
            return res.json({
                success: true,
                count: bookings.length,
                data: bookings
            });
        } catch (error) {
            console.error('LINE 訂單查詢失敗:', error);
            return res.status(500).json({
                success: false,
                message: '查詢失敗，請稍後再試'
            });
        }
    });

    router.post('/otp/send', publicLimiter, async (req, res) => {
        try {
            const email = (req.body.email || '').trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email 格式不正確'
                });
            }

            const result = await orderQueryService.sendOtpByEmail(email);
            if (!result.found) {
                return res.status(404).json({
                    success: false,
                    message: '找不到此 Email 的訂單資料'
                });
            }

            return res.json({
                success: true,
                message: '驗證碼已寄送，請至 Email 收信'
            });
        } catch (error) {
            console.error('寄送訂單查詢 OTP 失敗:', error);
            return res.status(500).json({
                success: false,
                message: '寄送驗證碼失敗，請稍後再試'
            });
        }
    });

    router.post('/otp/verify', publicLimiter, async (req, res) => {
        try {
            const email = (req.body.email || '').trim().toLowerCase();
            const otp = (req.body.otp || '').trim();
            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: '請提供 Email 與驗證碼'
                });
            }

            const result = await orderQueryService.verifyOtpAndQuery(email, otp);
            if (!result.valid) {
                return res.status(400).json({
                    success: false,
                    message: result.message || '驗證碼無效'
                });
            }

            return res.json({
                success: true,
                count: result.bookings.length,
                data: result.bookings
            });
        } catch (error) {
            console.error('驗證訂單查詢 OTP 失敗:', error);
            return res.status(500).json({
                success: false,
                message: '驗證失敗，請稍後再試'
            });
        }
    });

    return router;
}

module.exports = {
    createOrderQueryRoutes
};
