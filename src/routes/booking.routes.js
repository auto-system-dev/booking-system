const express = require('express');

function createBookingRoutes(deps) {
    const {
        bookingService,
        handlers,
        publicLimiter,
        verifyCsrfToken,
        validateBooking,
        requireAuth,
        checkPermission,
        adminLimiter
    } = deps;

    const router = express.Router();

    router.post('/booking', publicLimiter, verifyCsrfToken, validateBooking, handlers.createBooking);

    router.get('/bookings', requireAuth, checkPermission('bookings.view'), adminLimiter, async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            const bookings = await bookingService.getBookings(startDate, endDate);
            const bookingsWithDefaults = bookingService.addBookingDefaults(bookings);

            return res.json({
                success: true,
                count: bookingsWithDefaults.length,
                data: bookingsWithDefaults
            });
        } catch (error) {
            console.error('查詢訂房記錄錯誤:', error);
            return res.status(500).json({
                success: false,
                message: '查詢訂房記錄失敗：' + error.message
            });
        }
    });

    router.get('/bookings/email/:email', requireAuth, checkPermission('bookings.view'), adminLimiter, async (req, res) => {
        try {
            const { email } = req.params;
            const bookings = await bookingService.getBookingsByEmail(email);

            return res.json({
                success: true,
                count: bookings.length,
                data: bookings
            });
        } catch (error) {
            console.error('查詢訂房記錄錯誤:', error);
            return res.status(500).json({
                success: false,
                message: '查詢訂房記錄失敗'
            });
        }
    });

    router.get('/bookings/:bookingId', requireAuth, checkPermission('bookings.view'), adminLimiter, async (req, res) => {
        try {
            const { bookingId } = req.params;
            const booking = await bookingService.getBookingById(bookingId);

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: '找不到該訂房記錄'
                });
            }

            console.log(`📋 查詢訂房 ${bookingId}: discount_amount=${booking.discount_amount}, original_amount=${booking.original_amount}, discount_description=${booking.discount_description}`);
            return res.json({
                success: true,
                data: booking
            });
        } catch (error) {
            console.error('查詢單筆訂房記錄錯誤:', error);
            return res.status(500).json({
                success: false,
                message: '查詢單筆訂房記錄失敗：' + error.message
            });
        }
    });

    router.put('/bookings/:bookingId', requireAuth, checkPermission('bookings.edit'), adminLimiter, handlers.updateBooking);
    router.post('/bookings/:bookingId/cancel', requireAuth, checkPermission('bookings.cancel'), adminLimiter, handlers.cancelBooking);
    router.delete('/bookings/:bookingId', requireAuth, checkPermission('bookings.delete'), adminLimiter, handlers.deleteBooking);

    return router;
}

module.exports = {
    createBookingRoutes
};
