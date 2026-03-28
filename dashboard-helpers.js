/**
 * 儀表板摘要與營運 KPI 共用計算（供 /api/dashboard、/api/dashboard/ops、/api/dashboard/bundle）
 * bundle 路徑只查一次訂單與房型，減少重新整理時的重複負載。
 */

function computeDashboardSummaryFromBookings(allBookings) {
    const normalizeStatus = (status) => String(status || '').trim().toLowerCase();
    const isActiveStatus = (status) => {
        const s = normalizeStatus(status);
        return s === 'active' || s === '有效' || s === '已確認' || s === 'confirmed';
    };
    const isReservedStatus = (status) => {
        const s = normalizeStatus(status);
        return s === 'reserved' || s === '保留' || s === '保留中';
    };
    const isCancelledStatus = (status) => {
        const s = normalizeStatus(status);
        return s === 'cancelled' || s === '已取消' || s === '取消';
    };

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const list = allBookings || [];

    const todayCheckIns = list.filter(
        (booking) =>
            booking.check_in_date === todayStr &&
            (isActiveStatus(booking.status) || isReservedStatus(booking.status))
    ).length;

    const todayCheckOuts = list.filter(
        (booking) => booking.check_out_date === todayStr && isActiveStatus(booking.status)
    ).length;

    const tomorrowCheckIns = list.filter(
        (booking) =>
            booking.check_in_date === tomorrowStr &&
            (isActiveStatus(booking.status) || isReservedStatus(booking.status))
    ).length;

    const todayBookings = list.filter((booking) => {
        const bookingDate = new Date(booking.created_at || booking.booking_date);
        const bookingDateStr = `${bookingDate.getFullYear()}-${String(bookingDate.getMonth() + 1).padStart(2, '0')}-${String(bookingDate.getDate()).padStart(2, '0')}`;
        return bookingDateStr === todayStr;
    });

    const todayTransferOrders = todayBookings.filter(
        (booking) => booking.payment_method && booking.payment_method.includes('匯款')
    ).length;

    const todayCardOrders = todayBookings.filter(
        (booking) =>
            booking.payment_method &&
            (booking.payment_method.includes('線上') || booking.payment_method.includes('卡'))
    ).length;

    const activeBookings = list.filter((booking) => isActiveStatus(booking.status)).length;
    const reservedBookings = list.filter((booking) => isReservedStatus(booking.status)).length;
    const cancelledBookings = list.filter((booking) => isCancelledStatus(booking.status)).length;

    return {
        todayCheckIns,
        todayCheckOuts,
        tomorrowCheckIns,
        todayTransferOrders,
        todayCardOrders,
        activeBookings,
        reservedBookings,
        cancelledBookings
    };
}

function parseOpsDashboardQuery(query) {
    const end = query.endDate ? new Date(`${query.endDate}T00:00:00`) : new Date();
    end.setHours(0, 0, 0, 0);

    const start = query.startDate
        ? new Date(`${query.startDate}T00:00:00`)
        : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        return { ok: false, message: '日期區間格式不正確' };
    }
    return { ok: true, start, end };
}

function buildDashboardOpsPayload(allBookings, roomTypes, start, end) {
    const normalizeStatus = (status) => String(status || '').trim().toLowerCase();
    const isActiveStatus = (status) => {
        const s = normalizeStatus(status);
        return s === 'active' || s === '有效' || s === '已確認' || s === 'confirmed';
    };
    const isReservedStatus = (status) => {
        const s = normalizeStatus(status);
        return s === 'reserved' || s === '保留' || s === '保留中';
    };
    const isCancelledStatus = (status) => {
        const s = normalizeStatus(status);
        return s === 'cancelled' || s === '已取消' || s === '取消';
    };
    const normalizePaymentStatus = (status) => String(status || '').trim().toLowerCase();
    const isPaid = (status) => {
        const s = normalizePaymentStatus(status);
        return s === 'paid' || s === '已付款' || s === '付款完成';
    };
    const isPending = (status) => {
        const s = normalizePaymentStatus(status);
        return s === 'pending' || s === '未付款' || s === '待付款';
    };
    const isFailed = (status) => {
        const s = normalizePaymentStatus(status);
        return s === 'failed' || s === '付款失敗' || s === '失敗';
    };

    const bookings = allBookings || [];
    const dayCount = Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
    const activeRoomTypes = (roomTypes || []).filter((rt) => Number(rt?.is_active ?? 1) !== 0);
    const totalRoomsCapacity = activeRoomTypes.reduce((sum, rt) => {
        const qty = Math.max(0, parseInt(rt?.qty_total, 10) || 0);
        // 未設定庫存時，維持舊預設：每房型至少 1
        return sum + (qty > 0 ? qty : 1);
    }, 0);
    const totalAvailableRoomNights = Math.max(1, totalRoomsCapacity) * dayCount;

    const normalizeDay = (value) => {
        if (!value) return null;

        if (value instanceof Date) {
            if (isNaN(value.getTime())) return null;
            return new Date(value.getFullYear(), value.getMonth(), value.getDate());
        }

        const raw = String(value).trim();
        if (!raw) return null;

        const ymdMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (ymdMatch) {
            const year = Number(ymdMatch[1]);
            const month = Number(ymdMatch[2]) - 1;
            const day = Number(ymdMatch[3]);
            const d = new Date(year, month, day);
            return isNaN(d.getTime()) ? null : d;
        }

        const fallback = new Date(raw);
        if (isNaN(fallback.getTime())) return null;
        return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
    };

    const calculateKpisByRange = (rangeStart, rangeEnd) => {
        const rangeDayCount = Math.max(1, Math.floor((rangeEnd - rangeStart) / (24 * 60 * 60 * 1000)) + 1);

        const inRangeRaw = bookings.filter((booking) => {
            const checkIn = normalizeDay(booking.check_in_date);
            if (!checkIn) return false;
            return checkIn >= rangeStart && checkIn <= rangeEnd;
        });
        // 同一 booking_id 只計一次，避免重複列造成取消率／付款率異常
        const seenBookingKeys = new Set();
        const inRangeByCheckInDate = [];
        inRangeRaw.forEach((booking, idx) => {
            const rawId = booking.booking_id != null ? String(booking.booking_id).trim() : '';
            const dedupeKey = rawId || `__idx_${idx}_${String(booking.check_in_date || '')}`;
            if (seenBookingKeys.has(dedupeKey)) return;
            seenBookingKeys.add(dedupeKey);
            inRangeByCheckInDate.push(booking);
        });

        let occupiedRoomNights = 0;
        let activeReservedRevenue = 0;
        let activeReservedNights = 0;

        const getBookingRoomsCount = (booking) => {
            // 新版：room_selections: [{ name, quantity, ... }]
            if (booking && booking.room_selections) {
                try {
                    const parsed = typeof booking.room_selections === 'string'
                        ? JSON.parse(booking.room_selections)
                        : booking.room_selections;
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const total = parsed.reduce((sum, item) => sum + (Math.max(0, parseInt(item?.quantity, 10) || 0)), 0);
                        if (total > 0) return total;
                    }
                } catch (_) {}
            }
            // 舊版：可能有 rooms
            const rooms = Math.max(0, parseInt(booking?.rooms, 10) || 0);
            if (rooms > 0) return rooms;
            return 1;
        };

        bookings.forEach((booking) => {
            if (!isActiveStatus(booking.status) && !isReservedStatus(booking.status)) return;

            const checkIn = normalizeDay(booking.check_in_date);
            const checkOut = normalizeDay(booking.check_out_date);
            if (!checkIn || !checkOut || checkOut <= checkIn) return;

            const overlapStart = checkIn > rangeStart ? checkIn : rangeStart;
            const overlapEndExclusive =
                checkOut <= new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000)
                    ? checkOut
                    : new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

            if (overlapEndExclusive <= overlapStart) return;

            const overlapNights = Math.floor((overlapEndExclusive - overlapStart) / (24 * 60 * 60 * 1000));
            if (overlapNights <= 0) return;

            const roomsCount = getBookingRoomsCount(booking);
            occupiedRoomNights += overlapNights * roomsCount;

            const totalNights = Math.max(1, Math.floor((checkOut - checkIn) / (24 * 60 * 60 * 1000)));
            const finalAmount = parseFloat(booking.final_amount || 0) || 0;
            const perNightRevenue = finalAmount / totalNights;
            activeReservedRevenue += perNightRevenue * overlapNights;
            activeReservedNights += overlapNights;
        });

        const conversionNumerator = inRangeByCheckInDate.filter(
            (b) => isActiveStatus(b.status) || isReservedStatus(b.status)
        ).length;
        const conversionDenominator = inRangeByCheckInDate.length;

        const paymentNumerator = inRangeByCheckInDate.filter((b) => isPaid(b.payment_status)).length;
        const paymentDenominator = inRangeByCheckInDate.filter(
            (b) => isPaid(b.payment_status) || isPending(b.payment_status) || isFailed(b.payment_status)
        ).length;

        const cancellationNumerator = inRangeByCheckInDate.filter((b) => isCancelledStatus(b.status)).length;
        const cancellationDenominator = inRangeByCheckInDate.length;

        const denom = Math.max(1, totalRoomsCapacity) * rangeDayCount;
        const occupancyRate = (occupiedRoomNights / denom) * 100;
        const averageRoomRate = activeReservedNights > 0 ? activeReservedRevenue / activeReservedNights : 0;
        // 分母為 0 時回傳 null（非 0%），避免與「有訂單且比率為 0」混淆；較上期無資料時應顯示 --
        const conversionRate = conversionDenominator > 0 ? (conversionNumerator / conversionDenominator) * 100 : null;
        const paymentSuccessRate = paymentDenominator > 0 ? (paymentNumerator / paymentDenominator) * 100 : null;
        const cancellationRate = cancellationDenominator > 0 ? (cancellationNumerator / cancellationDenominator) * 100 : null;

        return {
            occupancyRate,
            averageRoomRate,
            conversionRate,
            paymentSuccessRate,
            cancellationRate
        };
    };

    const currentKpis = calculateKpisByRange(start, end);

    const previousEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    previousEnd.setHours(0, 0, 0, 0);
    const previousStart = new Date(previousEnd.getTime() - (dayCount - 1) * 24 * 60 * 60 * 1000);
    previousStart.setHours(0, 0, 0, 0);
    const previousKpis = calculateKpisByRange(previousStart, previousEnd);

    const aggregateByCheckInRange = (rangeStart, rangeEnd) => {
        let orders = 0;
        let revenue = 0;
        bookings.forEach((booking) => {
            const checkIn = normalizeDay(booking.check_in_date);
            if (!checkIn || checkIn < rangeStart || checkIn > rangeEnd) return;
            // 與 getStatistics 口徑一致：總訂單／總營收排除已取消
            if (isCancelledStatus(booking.status)) return;
            orders += 1;
            revenue += Number(booking.total_amount || 0) || 0;
        });
        return { orders, revenue };
    };

    const calcMoM = (currentValue, previousValue) => {
        const current = Number(currentValue) || 0;
        const previous = Number(previousValue) || 0;
        if (previous <= 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
    };

    const currentRangeStats = aggregateByCheckInRange(start, end);
    const previousRangeStats = aggregateByCheckInRange(previousStart, previousEnd);

    const overview = {
        monthOrders: currentRangeStats.orders,
        monthRevenue: currentRangeStats.revenue,
        monthOrdersMoM: calcMoM(currentRangeStats.orders, previousRangeStats.orders),
        monthRevenueMoM: calcMoM(currentRangeStats.revenue, previousRangeStats.revenue)
    };

    const trendEnd = new Date(end);
    trendEnd.setHours(0, 0, 0, 0);
    const trendStart = new Date(trendEnd.getTime() - 29 * 24 * 60 * 60 * 1000);
    const trendLabels = [];
    const trendMap = new Map();
    for (let i = 0; i < 30; i += 1) {
        const d = new Date(trendStart.getTime() + i * 24 * 60 * 60 * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        trendLabels.push(key);
        trendMap.set(key, { orders: 0, revenue: 0 });
    }

    bookings.forEach((booking) => {
        const checkIn = normalizeDay(booking.check_in_date);
        if (!checkIn || checkIn < trendStart || checkIn > trendEnd) return;
        if (isCancelledStatus(booking.status)) return;
        const key = `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, '0')}-${String(checkIn.getDate()).padStart(2, '0')}`;
        const item = trendMap.get(key);
        if (!item) return;
        item.orders += 1;
        item.revenue += Number(booking.total_amount || 0) || 0;
    });

    const sourceMap = new Map();
    const sourceBookings = bookings.filter((booking) => {
        const checkIn = normalizeDay(booking.check_in_date);
        if (!checkIn || checkIn < start || checkIn > end) return false;
        return !isCancelledStatus(booking.status);
    });

    const resolveSource = (booking) => {
        const sourceCandidate =
            booking.utm_source ||
            booking.booking_source ||
            booking.order_source ||
            booking.source ||
            booking.channel ||
            '';
        const normalized = String(sourceCandidate || '').trim().toLowerCase();
        if (normalized) return normalized;
        if (booking.line_user_id) return 'line';
        return 'direct';
    };

    sourceBookings.forEach((booking) => {
        const source = resolveSource(booking);
        sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
    });

    const sourceTotal = sourceBookings.length || 1;
    const sources = Array.from(sourceMap.entries())
        .map(([source, orders]) => ({ source, orders, share: (orders / sourceTotal) * 100 }))
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 5);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextTwoDays = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    const nextThreeDays = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

    let pendingDueSoon = 0;
    let overdueUnpaid = 0;
    let upcomingCheckIns = 0;

    bookings.forEach((booking) => {
        const paymentDeadline = normalizeDay(booking.payment_deadline);
        if (isPending(booking.payment_status) && paymentDeadline) {
            if (paymentDeadline < today) overdueUnpaid += 1;
            if (paymentDeadline >= today && paymentDeadline <= nextTwoDays) pendingDueSoon += 1;
        }

        const checkIn = normalizeDay(booking.check_in_date);
        if (
            checkIn &&
            checkIn >= today &&
            checkIn <= nextThreeDays &&
            (isActiveStatus(booking.status) || isReservedStatus(booking.status))
        ) {
            upcomingCheckIns += 1;
        }
    });

    const todos = [
        { key: 'upcoming_checkins', title: '3 日內即將入住', value: upcomingCheckIns, severity: '' },
        { key: 'pending_due', title: '2 日內待付款到期', value: pendingDueSoon, severity: pendingDueSoon > 0 ? 'warn' : '' },
        { key: 'overdue_unpaid', title: '已逾期未付款', value: overdueUnpaid, severity: overdueUnpaid > 0 ? 'alert' : '' },
        {
            key: 'cancel_rate',
            title: '取消率預警',
            value:
                currentKpis.cancellationRate == null
                    ? '—'
                    : `${(Number(currentKpis.cancellationRate) || 0).toFixed(1)}%`,
            severity:
                currentKpis.cancellationRate == null
                    ? ''
                    : (Number(currentKpis.cancellationRate) || 0) >= 20
                      ? 'alert'
                      : ''
        }
    ];

    return {
        range: {
            startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
            endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
            dayCount
        },
        kpis: currentKpis,
        previousRange: {
            startDate: `${previousStart.getFullYear()}-${String(previousStart.getMonth() + 1).padStart(2, '0')}-${String(previousStart.getDate()).padStart(2, '0')}`,
            endDate: `${previousEnd.getFullYear()}-${String(previousEnd.getMonth() + 1).padStart(2, '0')}-${String(previousEnd.getDate()).padStart(2, '0')}`,
            dayCount
        },
        previousKpis,
        overview,
        trend: {
            labels: trendLabels,
            orders: trendLabels.map((label) => trendMap.get(label)?.orders || 0),
            revenue: trendLabels.map((label) => trendMap.get(label)?.revenue || 0)
        },
        sources,
        todos
    };
}

module.exports = {
    computeDashboardSummaryFromBookings,
    parseOpsDashboardQuery,
    buildDashboardOpsPayload
};
