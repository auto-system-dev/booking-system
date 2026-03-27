function createBookingService(deps) {
    const { db } = deps;

    async function getBookings(startDate, endDate, buildingId, bookingMode) {
        if (startDate && endDate) {
            console.log('📅 查詢日曆區間:', startDate, '~', endDate);
            return db.getBookingsInRange(startDate, endDate, buildingId, bookingMode);
        }
        console.log('📋 查詢所有訂房記錄');
        return db.getAllBookings(buildingId, bookingMode);
    }

    async function getBookingById(bookingId) {
        return db.getBookingById(bookingId);
    }

    async function getBookingsByEmail(email, bookingMode) {
        return db.getBookingsByEmail(email, bookingMode);
    }

    async function getCurrentSystemMode() {
        const mode = ((await db.getSetting('system_mode')) || 'retail').toString().trim();
        return ['retail', 'whole_property'].includes(mode) ? mode : 'retail';
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
        getCurrentSystemMode,
        addBookingDefaults
    };
}

module.exports = {
    createBookingService
};
