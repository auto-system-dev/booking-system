function calculateDynamicPaymentDeadline(createdAt, checkInDate, configDaysReserved = 3) {
    const created = new Date(createdAt);
    created.setHours(0, 0, 0, 0);

    const checkIn = new Date(typeof checkInDate === 'string' && !checkInDate.includes('T') ? checkInDate + 'T00:00:00' : checkInDate);
    checkIn.setHours(0, 0, 0, 0);

    const diffTime = checkIn.getTime() - created.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let deadline = new Date(created);
    let actualDaysReserved = configDaysReserved;

    if (diffDays > configDaysReserved) {
        deadline.setDate(deadline.getDate() + (configDaysReserved - 1));
        actualDaysReserved = configDaysReserved;
    } else if (diffDays === 1) {
        deadline.setDate(deadline.getDate() + 0);
        actualDaysReserved = 1;
    } else if (diffDays <= configDaysReserved && diffDays > 1) {
        actualDaysReserved = diffDays;
        deadline.setDate(deadline.getDate() + (actualDaysReserved - 1));
    } else {
        deadline.setDate(deadline.getDate() + (configDaysReserved - 1));
        actualDaysReserved = configDaysReserved;
    }

    deadline.setHours(23, 59, 59, 999);
    return { deadline, actualDaysReserved };
}

function formatPaymentDeadline(deadline) {
    if (!deadline || isNaN(deadline.getTime())) return '';

    if (deadline.getHours() === 23 && deadline.getMinutes() === 59) {
        return deadline.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    return deadline.toLocaleString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

module.exports = {
    calculateDynamicPaymentDeadline,
    formatPaymentDeadline
};
