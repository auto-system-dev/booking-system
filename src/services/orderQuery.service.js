function createOrderQueryService(deps) {
    const {
        db,
        dataProtection,
        notificationService
    } = deps;

    function sanitizeOrderQueryBookings(bookings = []) {
        return bookings.map((booking) => {
            const paymentAmount = Number(booking.payment_amount) || 0;
            const finalAmount = Number(booking.final_amount) || 0;
            const payableAmount = paymentAmount > 0 ? paymentAmount : finalAmount;

            return {
                booking_id: booking.booking_id || '',
                guest_name: booking.guest_name || '',
                guest_email: booking.guest_email || '',
                guest_phone: booking.guest_phone || '',
                room_type: booking.room_type || '',
                check_in_date: booking.check_in_date || '',
                check_out_date: booking.check_out_date || '',
                nights: booking.nights || 0,
                total_amount: booking.total_amount || 0,
                payment_amount: paymentAmount,
                final_amount: finalAmount,
                payable_amount: payableAmount,
                payment_method: booking.payment_method || '',
                payment_status: booking.payment_status || 'pending',
                status: booking.status || 'active',
                created_at: booking.created_at || null
            };
        });
    }

    async function queryByLineUserId(lineUserId) {
        const bookings = await db.getBookingsByLineUserId(lineUserId);
        return sanitizeOrderQueryBookings(bookings);
    }

    async function sendOtpByEmail(email) {
        const bookings = await db.getBookingsByEmail(email);
        if (!bookings || bookings.length === 0) {
            return { found: false };
        }

        const code = dataProtection.generateVerificationCode();
        dataProtection.saveVerificationCode(email, code, 'order_query');
        await notificationService.sendOrderQueryOtpEmail(email, code);
        return { found: true };
    }

    async function verifyOtpAndQuery(email, otp) {
        const verification = dataProtection.verifyCode(email, otp, 'order_query');
        if (!verification.valid) {
            return {
                valid: false,
                message: verification.message || '驗證碼無效'
            };
        }

        const bookings = await db.getBookingsByEmail(email);
        return {
            valid: true,
            bookings: sanitizeOrderQueryBookings(bookings)
        };
    }

    return {
        queryByLineUserId,
        sendOtpByEmail,
        verifyOtpAndQuery
    };
}

module.exports = {
    createOrderQueryService
};
