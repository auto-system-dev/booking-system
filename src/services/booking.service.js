function createBookingService(deps) {
    const { db } = deps;

    async function getBookings(startDate, endDate) {
        if (startDate && endDate) {
            console.log('📅 查詢日曆區間:', startDate, '~', endDate);
            return db.getBookingsInRange(startDate, endDate);
        }
        console.log('📋 查詢所有訂房記錄');
        return db.getAllBookings();
    }

    async function getBookingById(bookingId) {
        return db.getBookingById(bookingId);
    }

    async function getBookingsByEmail(email) {
        return db.getBookingsByEmail(email);
    }

    function addBookingDefaults(bookings = []) {
        return bookings.map((booking) => ({
            ...booking,
            payment_status: booking.payment_status || 'pending',
            status: booking.status || 'active'
        }));
    }

    return {
        getBookings,
        getBookingById,
        getBookingsByEmail,
        addBookingDefaults
    };
}

module.exports = {
    createBookingService
};
