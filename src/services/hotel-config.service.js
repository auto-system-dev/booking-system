function createHotelConfigService(deps) {
    const {
        db
    } = deps;

    const DEFAULT_HOTEL_SETTINGS = {
        name: 'XX民宿',
        phone: '02-1234-5678',
        address: '台北市信義區信義路五段7號',
        email: 'service@hotel.com'
    };

    async function getHotelSettingsWithFallback() {
        const hotelName = ((await db.getSetting('hotel_name')) || '').trim() || DEFAULT_HOTEL_SETTINGS.name;
        const hotelPhone = ((await db.getSetting('hotel_phone')) || '').trim() || DEFAULT_HOTEL_SETTINGS.phone;
        const hotelAddress = ((await db.getSetting('hotel_address')) || '').trim() || DEFAULT_HOTEL_SETTINGS.address;
        const hotelEmail = ((await db.getSetting('hotel_email')) || '').trim() || DEFAULT_HOTEL_SETTINGS.email;
        return { hotelName, hotelPhone, hotelAddress, hotelEmail };
    }

    return {
        getHotelSettingsWithFallback
    };
}

module.exports = {
    createHotelConfigService
};
