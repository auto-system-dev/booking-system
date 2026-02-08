// 全域變數
let roomTypes = [];
let addons = []; // 加購商品列表
let selectedAddons = []; // 已選擇的加購商品
let enableAddons = true; // 前台加購商品功能是否啟用
let depositPercentage = 30; // 預設訂金百分比
let unavailableRooms = []; // 已滿房的房型列表
let datePicker = null; // 日期區間選擇器
let guestCounts = { adults: 1, children: 0 };
let capacityModalData = { capacity: 0, totalGuests: 0 };
let lineUserId = null; // LINE User ID（如果從 LIFF 開啟）
let appliedPromoCode = null; // 已套用的優惠代碼

// ===== Facebook Pixel 追蹤函數 =====

/**
 * 追蹤開始結帳（進入訂房頁）
 */
function trackInitiateCheckout() {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
            content_name: '訂房頁面',
            content_category: '民宿訂房'
        });
        console.log('FB Pixel: InitiateCheckout event tracked');
    }
}

/**
 * 追蹤加入購物車（選擇房型）
 * @param {string} roomName - 房型名稱
 * @param {number} price - 房型價格
 */
function trackAddToCart(roomName, price) {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'AddToCart', {
            content_name: roomName,
            content_type: 'product',
            content_ids: [roomName],
            value: price,
            currency: 'TWD'
        });
        console.log('FB Pixel: AddToCart event tracked -', roomName);
    }
}

/**
 * 追蹤訂房完成（購買事件）
 * @param {string} bookingId - 訂房編號
 * @param {string} roomType - 房型名稱
 * @param {number} totalAmount - 總金額
 * @param {number} paidAmount - 實付金額
 */
function trackPurchase(bookingId, roomType, totalAmount, paidAmount) {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'Purchase', {
            content_name: roomType,
            content_type: 'product',
            content_ids: [roomType, bookingId],
            value: paidAmount,
            currency: 'TWD',
            num_items: 1,
            order_id: bookingId
        });
        console.log('FB Pixel: Purchase event tracked -', bookingId, 'Amount:', paidAmount);
    }
}

/**
 * 追蹤表單提交嘗試
 */
function trackSubmitApplication() {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'SubmitApplication', {
            content_name: '訂房表單提交',
            content_category: '民宿訂房'
        });
        console.log('FB Pixel: SubmitApplication event tracked');
    }
}

// 頁面載入時追蹤 InitiateCheckout（從銷售頁來的訪客）
if (document.referrer.includes('landing')) {
    trackInitiateCheckout();
}

// 初始化 LIFF（如果從 LINE 開啟）
async function initLIFF() {
    try {
        // 檢查是否在 LINE 環境中
        if (typeof liff !== 'undefined') {
            console.log('📱 偵測到 LINE LIFF SDK，初始化 LIFF...');
            
            // 從後端取得 LIFF ID（或使用全域變數）
            let liffId = window.LINE_LIFF_ID;
            
            // 如果沒有設定，嘗試從後端取得
            if (!liffId) {
                try {
                    const response = await fetch('/api/settings');
                    const result = await response.json();
                    if (result.success && result.data && result.data.line_liff_id) {
                        liffId = result.data.line_liff_id;
                    }
                } catch (e) {
                    console.warn('⚠️ 無法從後端取得 LIFF ID:', e.message);
                }
            }
            
            if (!liffId) {
                console.warn('⚠️ LINE_LIFF_ID 未設定，無法初始化 LIFF');
                return;
            }

            await liff.init({ liffId: liffId });
            console.log('✅ LIFF 初始化成功');

            // 取得 LINE User Profile
            const profile = await liff.getProfile();
            lineUserId = profile.userId;
            console.log('✅ 取得 LINE User ID:', lineUserId?.substring(0, 10) + '...');

            // 設定 LIFF 視窗標題
            liff.setTitle('線上訂房系統');
        } else {
            console.log('🌐 非 LINE 環境，跳過 LIFF 初始化');
        }
    } catch (error) {
        console.warn('⚠️ LIFF 初始化失敗:', error.message);
        // LIFF 初始化失敗不影響正常使用
    }
}

// 載入房型資料和系統設定
async function loadRoomTypesAndSettings() {
    try {
        // 同時載入房型、加購商品和設定
        const [roomTypesResponse, addonsResponse, settingsResponse] = await Promise.all([
            fetch('/api/room-types'),
            fetch('/api/addons'),
            fetch('/api/settings')
        ]);
        
        const roomTypesResult = await roomTypesResponse.json();
        const addonsResult = await addonsResponse.json();
        const settingsResult = await settingsResponse.json();
        
        roomTypes = roomTypesResult.success ? (roomTypesResult.data || []) : [];
        renderRoomTypes();
        
        // 檢查是否啟用前台加購商品功能
        enableAddons = settingsResult.success && settingsResult.data && 
                       (settingsResult.data.enable_addons === '1' || settingsResult.data.enable_addons === 'true');
        
        addons = (enableAddons && addonsResult.success) ? (addonsResult.data || []) : [];
        renderAddons();
        // 顯示/隱藏加購商品區塊（避免 :has 選擇器，改用 closest）
        const addonsSection = document.getElementById('addonsGrid')?.closest('.form-section');
        if (addonsSection) addonsSection.style.display = enableAddons && addons.length > 0 ? 'block' : 'none';
        if (!enableAddons || addons.length === 0) {
            selectedAddons = [];
        }
        
        if (settingsResult.success && settingsResult.data.deposit_percentage) {
            depositPercentage = parseInt(settingsResult.data.deposit_percentage) || 30;
        }
        
        // 更新訂金百分比顯示
        updateDepositLabel();
        
        // 根據設定顯示/隱藏付款方式
        if (settingsResult.success) {
            updatePaymentMethods(settingsResult.data);
        }
        
        // 重新計算價格（如果已選擇房型）
        calculatePrice();
    } catch (error) {
        console.error('載入房型和設定錯誤:', error);
        document.getElementById('roomTypeGrid').innerHTML = '<div class="error">載入房型失敗，請重新整理頁面</div>';
        document.getElementById('addonsGrid').innerHTML = '<div class="error">載入加購商品失敗</div>';
    }
}

// 渲染加購商品
function renderAddons() {
    const grid = document.getElementById('addonsGrid');
    
    if (!grid) return;
    
    if (addons.length === 0) {
        grid.innerHTML = '<div class="loading">暫無加購商品</div>';
        return;
    }
    
    grid.innerHTML = addons.map(addon => {
        const selectedAddon = selectedAddons.find(a => a.name === addon.name);
        const quantity = selectedAddon ? selectedAddon.quantity : 0;
        const isSelected = quantity > 0;
        
        return `
            <div class="addon-option ${isSelected ? 'selected' : ''}" data-addon="${addon.name}" data-price="${addon.price}">
                <div style="display: flex; align-items: center; gap: 10px; padding: 15px; border: 2px solid ${isSelected ? '#2C8EC4' : '#ddd'}; border-radius: 8px; background: ${isSelected ? '#f0f8ff' : '#fff'}; transition: all 0.3s;">
                    <span style="font-size: 24px;">${addon.icon || '➕'}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 5px;">${addon.display_name}</div>
                        <div style="color: #2C8EC4; font-weight: 600;">NT$ ${addon.price.toLocaleString()}/人</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button type="button" class="addon-quantity-btn" onclick="changeAddonQuantity('${addon.name}', ${addon.price}, -1)" style="width: 32px; height: 32px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; color: #666;" ${quantity === 0 ? 'disabled' : ''}>−</button>
                        <span class="addon-quantity" style="min-width: 30px; text-align: center; font-weight: 600; font-size: 16px;">${quantity}</span>
                        <button type="button" class="addon-quantity-btn" onclick="changeAddonQuantity('${addon.name}', ${addon.price}, 1)" style="width: 32px; height: 32px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; color: #666;">+</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 改變加購商品數量
function changeAddonQuantity(addonName, addonPrice, change) {
    const existingIndex = selectedAddons.findIndex(a => a.name === addonName);
    let newQuantity = 0;
    
    if (existingIndex >= 0) {
        newQuantity = selectedAddons[existingIndex].quantity + change;
        if (newQuantity <= 0) {
            // 移除該加購商品
            selectedAddons.splice(existingIndex, 1);
        } else {
            // 更新數量
            selectedAddons[existingIndex].quantity = newQuantity;
        }
    } else if (change > 0) {
        // 新增加購商品
        selectedAddons.push({ name: addonName, price: addonPrice, quantity: 1 });
        newQuantity = 1;
    }
    
    // 重新渲染加購商品列表
    renderAddons();
    
    // 重新計算價格
    calculatePrice();
}

// 檢查日期是否為假日（週末）
// 注意：此函數已被後端 API 取代，保留以向後兼容
function isWeekend(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 週日, 6 = 週六
}

// 取得平日/假日設定（從系統設定）
let weekdaySettingsCache = null;
let weekdaySettingsCacheTime = 0;
const WEEKDAY_SETTINGS_CACHE_DURATION = 5 * 60 * 1000; // 5 分鐘快取

async function getWeekdaySettings() {
    // 檢查快取
    const now = Date.now();
    if (weekdaySettingsCache && (now - weekdaySettingsCacheTime) < WEEKDAY_SETTINGS_CACHE_DURATION) {
        return weekdaySettingsCache;
    }
    
    try {
        const response = await fetch('/api/settings');
        const result = await response.json();
        
        if (result.success && result.data.weekday_settings) {
            const settingsJson = result.data.weekday_settings;
            const settings = typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
            const weekdays = settings.weekdays && Array.isArray(settings.weekdays) 
                ? settings.weekdays.map(d => parseInt(d))
                : [1, 2, 3, 4, 5]; // 預設：週一到週五為平日
            
            weekdaySettingsCache = weekdays;
            weekdaySettingsCacheTime = now;
            return weekdays;
        }
    } catch (error) {
        console.warn('取得平日/假日設定失敗，使用預設值:', error);
    }
    
    // 預設值：週一到週五為平日
    weekdaySettingsCache = [1, 2, 3, 4, 5];
    weekdaySettingsCacheTime = now;
    return weekdaySettingsCache;
}

// 檢查日期是否為假日（使用自訂的平日/假日設定）
async function isCustomWeekend(dateString) {
    if (!dateString) return false;
    
    try {
        const weekdays = await getWeekdaySettings();
        const date = new Date(dateString);
        const day = date.getDay(); // 0 = 週日, 1 = 週一, ..., 6 = 週六
        
        // 如果該日期不在 weekdays 列表中，則為假日
        return !weekdays.includes(day);
    } catch (error) {
        console.warn('檢查自訂平日/假日設定失敗，使用預設週末判斷:', error);
        return isWeekend(dateString);
    }
}

// 渲染房型選項
async function renderRoomTypes() {
    const grid = document.getElementById('roomTypeGrid');
    
    if (roomTypes.length === 0) {
        grid.innerHTML = '<div class="loading">目前沒有可用的房型</div>';
        return;
    }
    
    const checkInDate = document.getElementById('checkInDate').value;
    const checkOutDate = document.getElementById('checkOutDate').value;
    const hasDates = checkInDate && checkOutDate;
    
    // 檢查入住日期是否為假日（先檢查是否為手動設定的假日，再檢查是否為週末）
    let isCheckInHoliday = false;
    if (checkInDate) {
        try {
            const response = await fetch(`/api/check-holiday?date=${checkInDate}`);
            const result = await response.json();
            if (result.success) {
                isCheckInHoliday = result.data.isHoliday;
            } else {
                // 如果 API 失敗，使用自訂的平日/假日設定判斷
                isCheckInHoliday = await isCustomWeekend(checkInDate);
            }
        } catch (error) {
            // 如果發生錯誤，使用自訂的平日/假日設定判斷
            isCheckInHoliday = await isCustomWeekend(checkInDate);
        }
    }
    
    grid.innerHTML = roomTypes.map((room, index) => {
        const isUnavailable = hasDates && unavailableRooms.includes(room.name);
        const roomOptionClass = isUnavailable ? 'room-option unavailable' : 'room-option';
        const disabledAttr = isUnavailable ? 'disabled' : '';
        
        const holidaySurcharge = room.holiday_surcharge || 0;
        // 根據入住日期判斷顯示平日價格還是假日價格
        // 注意：即使 holidaySurcharge 為 0，如果日期是假日，也應該顯示假日價格（雖然價格相同）
        const displayPrice = (checkInDate && isCheckInHoliday) 
            ? (room.price + holidaySurcharge) 
            : room.price;
        let priceDisplay = '';
        
        if (isUnavailable) {
            priceDisplay = '<span style="color: #e74c3c; font-weight: bold;">滿房</span>';
        } else {
            priceDisplay = `NT$ ${displayPrice.toLocaleString()}/晚`;
        }
        
        return `
        <div class="${roomOptionClass}" 
             data-room="${room.name}" 
             data-price="${room.price}" 
             data-holiday-surcharge="${holidaySurcharge}"
             data-max-occupancy="${room.max_occupancy != null ? room.max_occupancy : 0}"
             data-extra-beds="${room.extra_beds != null ? room.extra_beds : 0}">
            <input type="radio" id="room-${room.name}" name="roomType" value="${room.name}" ${disabledAttr}>
            <label for="room-${room.name}">
                ${room.image_url 
                    ? `<div class="room-icon room-icon-image"><img src="${room.image_url}" alt="${room.display_name}" loading="lazy"></div>` 
                    : `<div class="room-icon">${room.icon || '🏠'}</div>`}
                <div class="room-name">${room.display_name}</div>
                <div class="room-price ${isUnavailable ? 'unavailable-price' : ''}">
                    ${priceDisplay}
                </div>
            </label>
        </div>
    `;
    }).join('');
    
    // 重新綁定事件
    document.querySelectorAll('input[name="roomType"]').forEach(radio => {
        radio.addEventListener('change', function () {
            // 清除房型選擇錯誤訊息
            clearSectionError('roomTypeGrid');
            calculatePrice();
            // 如果已套用優惠代碼，重新驗證
            if (appliedPromoCode) {
                applyPromoCode();
            }
        });
    });
}

function initDatePicker() {
    if (!window.flatpickr) return;
    const rangeInput = document.getElementById('dateRange');
    const checkInInput = document.getElementById('checkInDate');
    const checkOutInput = document.getElementById('checkOutDate');
    const dateRangeInfo = document.getElementById('dateRangeInfo');

    const formatWithWeekday = (date) => {
        if (!date) return '';
        const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${m}/${d} ${weekdays[date.getDay()]}`;
    };

    datePicker = flatpickr(rangeInput, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        minDate: 'today',
        locale: flatpickr.l10ns.zh || 'zh',
        onChange: (selectedDates) => {
            const [start, end] = selectedDates;
            if (start) {
                // 使用本地日期格式，避免時區轉換問題
                const year = start.getFullYear();
                const month = String(start.getMonth() + 1).padStart(2, '0');
                const day = String(start.getDate()).padStart(2, '0');
                checkInInput.value = `${year}-${month}-${day}`;
            } else {
                checkInInput.value = '';
            }
            if (end && end > start) {
                // 使用本地日期格式，避免時區轉換問題
                const year = end.getFullYear();
                const month = String(end.getMonth() + 1).padStart(2, '0');
                const day = String(end.getDate()).padStart(2, '0');
                checkOutInput.value = `${year}-${month}-${day}`;
            } else {
                checkOutInput.value = '';
            }
            if (dateRangeInfo) {
                if (start && end && end > start) {
                    dateRangeInfo.innerHTML = `入住：${formatWithWeekday(start)}&nbsp;&nbsp;&nbsp;~&nbsp;&nbsp;&nbsp;退房：${formatWithWeekday(end)}`;
                } else if (start) {
                    dateRangeInfo.textContent = `入住：${formatWithWeekday(start)}（請再選退房日期）`;
                } else {
                    dateRangeInfo.textContent = '';
                }
            }
            calculateNights();
            calculatePrice();
            checkRoomAvailability();
            renderRoomTypes();
            // 檢查入住日期，如果為今天則禁用匯款選項
            checkPaymentMethodForCheckInDate();
            // 如果已套用優惠代碼，重新驗證
            if (appliedPromoCode) {
                applyPromoCode();
            }
        }
    });
}

// 根據入住日期檢查並更新付款方式選項
function checkPaymentMethodForCheckInDate() {
    const checkInInput = document.getElementById('checkInDate');
    const transferOption = document.querySelector('input[name="paymentMethod"][value="transfer"]');
    const cardOption = document.querySelector('input[name="paymentMethod"][value="card"]');
    const transferLabel = transferOption ? transferOption.closest('label') : null;
    
    if (!checkInInput || !checkInInput.value || !transferOption || !cardOption) {
        return;
    }
    
    // 取得入住日期
    const checkInDate = new Date(checkInInput.value);
    checkInDate.setHours(0, 0, 0, 0);
    
    // 取得今天日期
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 如果入住日期是今天，禁用匯款選項
    if (checkInDate.getTime() === today.getTime()) {
        // 禁用匯款選項
        transferOption.disabled = true;
        if (transferLabel) {
            transferLabel.style.opacity = '0.5';
            transferLabel.style.cursor = 'not-allowed';
            // 添加提示文字
            const transferSpan = transferLabel.querySelector('span');
            if (transferSpan && !transferSpan.textContent.includes('（今天無法使用）')) {
                transferSpan.textContent = '匯款轉帳（今天無法使用）';
            }
        }
        
        // 如果目前選中匯款，自動切換到線上刷卡
        if (transferOption.checked && cardOption) {
            cardOption.checked = true;
        }
    } else {
        // 啟用匯款選項
        transferOption.disabled = false;
        if (transferLabel) {
            transferLabel.style.opacity = '1';
            transferLabel.style.cursor = 'pointer';
            // 移除提示文字
            const transferSpan = transferLabel.querySelector('span');
            if (transferSpan) {
                transferSpan.textContent = '匯款轉帳';
            }
        }
    }
}

function showCapacityModal(capacity, totalGuests) {
    capacityModalData.capacity = capacity;
    capacityModalData.totalGuests = totalGuests;
    const overlay = document.getElementById('capacityModal');
    if (!overlay) return;
    document.getElementById('capacityValue').textContent = capacity;
    document.getElementById('guestCountValue').textContent = totalGuests;
    overlay.classList.remove('hidden');
}

function hideCapacityModal() {
    const overlay = document.getElementById('capacityModal');
    if (!overlay) return;
    overlay.classList.add('hidden');
}

function changeGuestCount(type, delta) {
    const min = type === 'adults' ? 1 : 0;
    const max = 20;
    const displayEl = document.getElementById(`${type}Display`);
    const inputEl = document.getElementById(type);
    if (!displayEl || !inputEl) return;
    let current = (guestCounts[type] !== undefined) ? guestCounts[type] : (parseInt(inputEl.value) || 0);
    current = Math.min(max, Math.max(min, current + delta));
    guestCounts[type] = current;
    displayEl.textContent = current;
    inputEl.value = current;
}

// 頁面載入時執行
loadRoomTypesAndSettings();

// 頁面載入後，如果有日期，檢查房間可用性
document.addEventListener('DOMContentLoaded', async function() {
    // 初始化時檢查入住日期，如果為今天則禁用匯款選項
    setTimeout(() => {
        checkPaymentMethodForCheckInDate();
    }, 500); // 延遲一點確保 DOM 已完全載入
    // 先初始化 LIFF（如果從 LINE 開啟）
    await initLIFF();
    
    initDatePicker();
    
    // 日期選擇變更時清除錯誤訊息
    const rangeInput = document.getElementById('dateRange');
    if (rangeInput) {
        rangeInput.addEventListener('change', function() {
            clearFieldError('dateRange');
        });
    }
    
    // 輸入框變更時清除錯誤訊息
    ['guestName', 'guestPhone', 'guestEmail'].forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('input', function() {
                clearFieldError(inputId);
            });
        }
    });
    
    setTimeout(() => {
        const checkInDate = document.getElementById('checkInDate').value;
        const checkOutDate = document.getElementById('checkOutDate').value;
        if (checkInDate && checkOutDate) {
            checkRoomAvailability();
        }
    }, 500);
});

// 容納人數提醒模態框按鈕事件
document.addEventListener('DOMContentLoaded', function() {
    const cancelBtn = document.getElementById('capacityCancelBtn');
    const confirmBtn = document.getElementById('capacityConfirmBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            hideCapacityModal();
        });
    }
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            hideCapacityModal();
            window.__skipCapacityCheck = true;
            const form = document.getElementById('bookingForm');
            if (form) form.requestSubmit();
        });
    }
});

// 計算住宿天數
function calculateNights() {
    const checkIn = new Date(document.getElementById('checkInDate').value);
    const checkOut = new Date(document.getElementById('checkOutDate').value);
    
    if (checkIn && checkOut && checkOut > checkIn) {
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        document.getElementById('nightsDisplay').textContent = `共 ${nights} 晚`;
        return nights;
    } else {
        document.getElementById('nightsDisplay').textContent = '';
        return 0;
    }
}

// 計算價格（考慮平日/假日）
async function calculatePrice() {
    const selectedRoom = document.querySelector('input[name="roomType"]:checked');
    if (!selectedRoom) {
        updatePriceDisplay(0, 0, 0, 0, 'deposit', 0, 0);
        return;
    }

    const checkInDate = document.getElementById('checkInDate').value;
    const checkOutDate = document.getElementById('checkOutDate').value;
    
    // 計算加購商品總金額（只有在啟用時才計算，考慮數量）
    const addonsTotal = enableAddons ? selectedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0) : 0;
    
    if (!checkInDate || !checkOutDate) {
        // 如果沒有選擇日期，使用舊的計算方式（不考慮假日）
        const roomOption = selectedRoom.closest('.room-option');
        const pricePerNight = parseInt(roomOption.dataset.price);
        const nights = calculateNights();
        const roomTotal = pricePerNight * nights;
            let totalAmount = roomTotal + addonsTotal;
            
            // 計算優惠代碼折扣（根據當前總金額重新計算）
            let discountAmount = 0;
            if (appliedPromoCode) {
                discountAmount = calculatePromoCodeDiscount(appliedPromoCode, totalAmount);
                totalAmount = Math.max(0, totalAmount - discountAmount);
            }
            
            const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
            const depositRate = depositPercentage / 100;
            const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
            const finalAmount = totalAmount * paymentType;

            updatePriceDisplay(pricePerNight, nights, roomTotal + addonsTotal, discountAmount, paymentAmount, finalAmount, addonsTotal);
        return;
    }

    // 使用新的 API 計算價格（考慮假日）
    try {
        const roomTypeName = selectedRoom.closest('.room-option').querySelector('.room-name').textContent.trim();
        const response = await fetch(`/api/calculate-price?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&roomTypeName=${encodeURIComponent(roomTypeName)}`);
        const result = await response.json();
        
        if (result.success) {
            const { totalAmount: roomTotal, averagePricePerNight, nights } = result.data;
            let totalAmount = roomTotal + addonsTotal;
            
            // 計算優惠代碼折扣（根據當前總金額重新計算）
            let discountAmount = 0;
            if (appliedPromoCode) {
                discountAmount = calculatePromoCodeDiscount(appliedPromoCode, totalAmount);
                totalAmount = Math.max(0, totalAmount - discountAmount);
            }
            
            const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
            const depositRate = depositPercentage / 100;
            const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
            const finalAmount = totalAmount * paymentType;

            updatePriceDisplay(averagePricePerNight, nights, roomTotal + addonsTotal, discountAmount, paymentAmount, finalAmount, addonsTotal);
        } else {
            console.error('計算價格失敗:', result.message);
            // 如果 API 失敗，使用舊的計算方式
            const roomOption = selectedRoom.closest('.room-option');
            const pricePerNight = parseInt(roomOption.dataset.price);
            const nights = calculateNights();
            const roomTotal = pricePerNight * nights;
            let totalAmount = roomTotal + addonsTotal;
            
            // 計算優惠代碼折扣（根據當前總金額重新計算）
            let discountAmount = 0;
            if (appliedPromoCode) {
                discountAmount = calculatePromoCodeDiscount(appliedPromoCode, totalAmount);
                totalAmount = Math.max(0, totalAmount - discountAmount);
            }
            
            const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
            const depositRate = depositPercentage / 100;
            const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
            const finalAmount = totalAmount * paymentType;

            updatePriceDisplay(pricePerNight, nights, roomTotal + addonsTotal, discountAmount, paymentAmount, finalAmount, addonsTotal);
        }
    } catch (error) {
        console.error('計算價格錯誤:', error);
        // 如果發生錯誤，使用舊的計算方式
        const roomOption = selectedRoom.closest('.room-option');
        const pricePerNight = parseInt(roomOption.dataset.price);
        const nights = calculateNights();
        const roomTotal = pricePerNight * nights;
            let totalAmount = roomTotal + addonsTotal;
            
            // 計算優惠代碼折扣（根據當前總金額重新計算）
            let discountAmount = 0;
            if (appliedPromoCode) {
                discountAmount = calculatePromoCodeDiscount(appliedPromoCode, totalAmount);
                totalAmount = Math.max(0, totalAmount - discountAmount);
            }
            
            const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
            const depositRate = depositPercentage / 100;
            const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
            const finalAmount = totalAmount * paymentType;

            updatePriceDisplay(pricePerNight, nights, roomTotal + addonsTotal, discountAmount, paymentAmount, finalAmount, addonsTotal);
    }
}

// 更新訂金標籤
function updateDepositLabel() {
    const depositLabel = document.getElementById('depositLabel');
    if (depositLabel) {
        depositLabel.textContent = `支付訂金 (${depositPercentage}%)`;
    }
}

// 根據設定更新付款方式顯示
function updatePaymentMethods(settings) {
    const enableTransfer = settings.enable_transfer === '1' || settings.enable_transfer === 'true';
    const enableCard = settings.enable_card === '1' || settings.enable_card === 'true';
    
    // 取得付款方式選項
    const transferOption = document.querySelector('input[name="paymentMethod"][value="transfer"]');
    const cardOption = document.querySelector('input[name="paymentMethod"][value="card"]');
    const transferLabel = transferOption ? transferOption.closest('label') : null;
    const cardLabel = cardOption ? cardOption.closest('label') : null;
    
    // 顯示/隱藏匯款轉帳選項
    if (transferLabel) {
        transferLabel.style.display = enableTransfer ? 'flex' : 'none';
        if (!enableTransfer && transferOption && transferOption.checked) {
            // 如果匯款轉帳被停用且目前選中，改選線上刷卡
            if (cardOption && enableCard) {
                cardOption.checked = true;
            }
        }
    }
    
    // 顯示/隱藏線上刷卡選項
    if (cardLabel) {
        cardLabel.style.display = enableCard ? 'flex' : 'none';
        if (!enableCard && cardOption && cardOption.checked) {
            // 如果線上刷卡被停用且目前選中，改選匯款轉帳
            if (transferOption && enableTransfer) {
                transferOption.checked = true;
            }
        }
    }
    
    // 如果兩種付款方式都被停用，顯示提示
    if (!enableTransfer && !enableCard) {
        const paymentMethodGroup = document.querySelector('.payment-method-group');
        if (paymentMethodGroup) {
            paymentMethodGroup.innerHTML = '<p style="color: #e74c3c; padding: 10px;">目前沒有可用的付款方式，請聯繫客服</p>';
        }
    }
    
    // 更新後，檢查入住日期是否為今天
    checkPaymentMethodForCheckInDate();
}

// 套用優惠代碼
async function applyPromoCode() {
    const code = document.getElementById('promoCodeInput').value.trim().toUpperCase();
    const messageDiv = document.getElementById('promoCodeMessage');
    const discountDiv = document.getElementById('promoCodeDiscount');
    
    if (!code) {
        messageDiv.innerHTML = '<span style="color: #dc2626;">請輸入優惠代碼</span>';
        appliedPromoCode = null;
        discountDiv.style.display = 'none';
        calculatePrice(); // 重新計算價格
        return;
    }
    
    // 取得當前訂房資訊
    const checkInDate = document.getElementById('checkInDate').value;
    const selectedRoom = document.querySelector('input[name="roomType"]:checked');
    if (!selectedRoom || !checkInDate) {
        messageDiv.innerHTML = '<span style="color: #dc2626;">請先選擇房型和日期</span>';
        return;
    }
    
    const roomTypeName = selectedRoom.closest('.room-option').querySelector('.room-name').textContent.trim();
    
    // 先計算當前總金額（不含折扣）
    const checkOutDate = document.getElementById('checkOutDate').value;
    if (!checkOutDate) {
        messageDiv.innerHTML = '<span style="color: #dc2626;">請選擇退房日期</span>';
        return;
    }
    
    try {
        // 取得當前總金額
        const priceResponse = await fetch(`/api/calculate-price?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&roomTypeName=${encodeURIComponent(roomTypeName)}`);
        const priceResult = await priceResponse.json();
        
        if (!priceResult.success) {
            messageDiv.innerHTML = '<span style="color: #dc2626;">無法計算價格，請重新選擇日期</span>';
            return;
        }
        
        const addonsTotal = enableAddons ? selectedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0) : 0;
        const totalAmount = priceResult.data.totalAmount + addonsTotal;
        const guestEmail = document.getElementById('guestEmail').value;
        
        // 驗證優惠代碼
        const response = await fetch('/api/promo-codes/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code: code,
                totalAmount: totalAmount,
                roomType: roomTypeName,
                checkInDate: checkInDate,
                guestEmail: guestEmail || null
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            appliedPromoCode = result.data;
            messageDiv.innerHTML = `<span style="color: #10b981;">✓ ${result.data.message}</span>`;
            discountDiv.innerHTML = `折抵金額：NT$ ${result.data.discount_amount.toLocaleString()}`;
            discountDiv.style.display = 'block';
            
            // 重新計算價格
            calculatePrice();
        } else {
            appliedPromoCode = null;
            messageDiv.innerHTML = `<span style="color: #dc2626;">${result.message || '優惠代碼無效'}</span>`;
            discountDiv.style.display = 'none';
            // 重新計算價格（移除折扣）
            calculatePrice();
        }
    } catch (error) {
        console.error('驗證優惠代碼錯誤:', error);
        messageDiv.innerHTML = '<span style="color: #dc2626;">驗證優惠代碼時發生錯誤</span>';
        appliedPromoCode = null;
        discountDiv.style.display = 'none';
    }
}

// 計算優惠代碼折扣金額（根據當前總金額重新計算）
function calculatePromoCodeDiscount(promoCode, totalAmount) {
    if (!promoCode || !totalAmount) return 0;
    
    let discountAmount = 0;
    if (promoCode.discount_type === 'fixed') {
        // 固定金額折扣
        discountAmount = promoCode.discount_value || 0;
    } else if (promoCode.discount_type === 'percent') {
        // 百分比折扣
        discountAmount = totalAmount * (promoCode.discount_value / 100);
        // 檢查是否有最高折扣限制
        if (promoCode.max_discount && discountAmount > promoCode.max_discount) {
            discountAmount = promoCode.max_discount;
        }
    }
    
    return Math.round(discountAmount);
}

// 更新價格顯示
function updatePriceDisplay(pricePerNight, nights, totalAmount, discountAmount = 0, paymentType, finalAmount = 0, addonsTotal = 0, depositPercent = null) {
    // 如果沒有提供 depositPercent，使用全域變數
    if (depositPercent === null) {
        depositPercent = depositPercentage;
    }
    
    document.getElementById('roomPricePerNight').textContent = `NT$ ${pricePerNight.toLocaleString()}`;
    document.getElementById('nightsCount').textContent = `${nights} 晚`;
    
    // 顯示總金額（包含折扣明細）
    const totalAmountElement = document.getElementById('totalAmount');
    const roomTotal = totalAmount - addonsTotal;
    let html = '';
    
    // 房型總額
    if (addonsTotal > 0) {
        html += `<div style="margin-bottom: 5px; color: #666;">房型總額：NT$ ${roomTotal.toLocaleString()}</div>`;
        // 加購商品明細
        const addonsDetail = selectedAddons.map(addon => {
            const addonName = addons.find(a => a.name === addon.name)?.display_name || addon.name;
            return `${addonName} x${addon.quantity || 1}`;
        }).join('、');
        html += `<div style="margin-bottom: 5px; color: #666;">加購商品（${addonsDetail}）：NT$ ${addonsTotal.toLocaleString()}</div>`;
    }
    
    // 顯示總金額（原始總金額，折扣前）
    html += `<div style="margin-bottom: 5px; color: #333;">總金額：NT$ ${totalAmount.toLocaleString()}</div>`;
    
    // 顯示折扣
    if (discountAmount > 0 && appliedPromoCode) {
        html += `<div style="margin-bottom: 5px; color: #10b981; font-weight: 600;">優惠折扣（${appliedPromoCode.name}）：-NT$ ${discountAmount.toLocaleString()}</div>`;
        const finalTotal = totalAmount - discountAmount;
        html += `<div style="font-weight: 700; font-size: 18px; color: #2C8EC4; border-top: 2px solid #ddd; padding-top: 5px; margin-top: 5px;">折抵後金額：NT$ ${finalTotal.toLocaleString()}</div>`;
    }
    // 沒有折扣時，不需要再顯示一次總金額（因為上面已經顯示了）
    
    totalAmountElement.innerHTML = html || `NT$ ${totalAmount.toLocaleString()}`;
    
    const paymentLabel = paymentType === 'deposit' ? `應付訂金 (${depositPercent}%)` : '應付全額';
    document.getElementById('paymentTypeLabel').textContent = paymentLabel;
    document.getElementById('paymentAmount').textContent = `NT$ ${finalAmount.toLocaleString()}`;
}

// 檢查房間可用性
async function checkRoomAvailability() {
    const checkInDate = document.getElementById('checkInDate').value;
    const checkOutDate = document.getElementById('checkOutDate').value;
    
    if (!checkInDate || !checkOutDate) {
        unavailableRooms = [];
        renderRoomTypes();
        return;
    }
    
    try {
        const response = await fetch(`/api/room-availability?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}`);
        const result = await response.json();
        
        if (result.success) {
            unavailableRooms = result.data || [];
            renderRoomTypes();
        } else {
            console.error('檢查房間可用性失敗:', result.message);
            unavailableRooms = [];
            renderRoomTypes();
        }
    } catch (error) {
        console.error('檢查房間可用性錯誤:', error);
        unavailableRooms = [];
        renderRoomTypes();
    }
}

// 日期變更事件（已由 flatpickr 控制）

// 房型選擇事件
document.querySelectorAll('input[name="roomType"]').forEach(radio => {
    radio.addEventListener('change', calculatePrice);
});

// 支付選項變更事件
document.querySelectorAll('input[name="paymentAmount"]').forEach(radio => {
    radio.addEventListener('change', calculatePrice);
});

// 統一的錯誤訊息顯示函數
function showFieldError(inputId, message, scrollTo = true) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // 清除先前的錯誤訊息
    clearFieldError(inputId);
    
    // 建立錯誤訊息元素
    const errorDiv = document.createElement('div');
    errorDiv.className = 'field-error-message';
    errorDiv.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 5px;">error</span>${message}`;
    errorDiv.style.cssText = 'color: #e74c3c; font-weight: 600; padding: 8px 12px; background: #ffe6e6; border-radius: 6px; margin-top: 8px; font-size: 14px; display: flex; align-items: center; border-left: 3px solid #e74c3c;';
    
    // 插入錯誤訊息（在輸入框之後）
    const formGroup = input.closest('.form-group') || input.closest('.date-input-wrapper') || input.parentElement;
    if (formGroup) {
        formGroup.appendChild(errorDiv);
    } else {
        input.parentElement.insertAdjacentElement('afterend', errorDiv);
    }
    
    // 設定輸入框樣式
    input.style.borderColor = '#e74c3c';
    input.style.boxShadow = '0 0 0 2px rgba(231, 76, 60, 0.2)';
    
    // 聚焦並滾動
    input.focus();
    if (scrollTo) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 清除錯誤訊息
function clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // 移除錯誤訊息元素
    const formGroup = input.closest('.form-group') || input.closest('.date-input-wrapper') || input.parentElement;
    const errorMsg = formGroup ? formGroup.querySelector('.field-error-message') : null;
    if (errorMsg) {
        errorMsg.remove();
    }
    
    // 恢復輸入框樣式
    input.style.borderColor = '';
    input.style.boxShadow = '';
    input.setCustomValidity('');
}

// 顯示區塊錯誤訊息（用於房型選擇等）
function showSectionError(sectionId, message, scrollTo = true) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    // 清除先前的錯誤訊息
    clearSectionError(sectionId);
    
    // 建立錯誤訊息元素
    const errorDiv = document.createElement('div');
    errorDiv.className = 'section-error-message';
    errorDiv.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle; margin-right: 8px;">error</span>${message}`;
    errorDiv.style.cssText = 'color: #e74c3c; font-weight: 600; padding: 12px; background: #ffe6e6; border-radius: 8px; margin-top: 10px; text-align: center; display: flex; align-items: center; justify-content: center; border-left: 4px solid #e74c3c;';
    
    // 插入錯誤訊息
    section.appendChild(errorDiv);
    
    // 滾動到區塊
    if (scrollTo) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 清除區塊錯誤訊息
function clearSectionError(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    const errorMsg = section.querySelector('.section-error-message');
    if (errorMsg) {
        errorMsg.remove();
    }
}

// 表單提交
document.getElementById('bookingForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitBtn = this.querySelector('.submit-btn');
    
    // ============================================
    // 驗證順序：由上到下
    // ============================================
    
    // 1. 日期選擇驗證
    const checkIn = document.getElementById('checkInDate').value;
    const checkOut = document.getElementById('checkOutDate').value;
    const rangeInput = document.getElementById('dateRange');
    if (!checkIn || !checkOut) {
        showFieldError('dateRange', '請先選擇入住與退房日期');
        return;
    }
    clearFieldError('dateRange');
    
    // 2. 房型選擇驗證
    const selectedRoomRadio = document.querySelector('input[name="roomType"]:checked');
    const roomTypeGrid = document.getElementById('roomTypeGrid');
    
    if (!selectedRoomRadio) {
        const roomTypeRadios = document.querySelectorAll('input[name="roomType"]');
        if (roomTypeRadios.length === 0) {
            showSectionError('roomTypeGrid', '目前沒有可用的房型，請稍後再試');
            return;
        }
        showSectionError('roomTypeGrid', '請選擇房型');
        // 嘗試聚焦第一個房型選項
        const firstRoomRadio = roomTypeRadios[0];
        if (firstRoomRadio) {
            firstRoomRadio.focus();
        }
        return;
    }
    clearSectionError('roomTypeGrid');
    
    // 3. 姓名驗證
    const nameInput = document.getElementById('guestName');
    const name = nameInput.value.trim();
    if (!name) {
        showFieldError('guestName', '請填寫姓名');
        return;
    }
    clearFieldError('guestName');
    
    // 4. 手機驗證（與後端驗證邏輯一致）
    const phoneInput = document.getElementById('guestPhone');
    const phoneRaw = phoneInput.value.trim();
    // 移除所有非數字字元（與後端 sanitizePhone 邏輯一致）
    const phone = phoneRaw.replace(/[-\s]/g, '');
    const taiwanPhoneRegex = /^09\d{8}$/;
    if (!phoneRaw) {
        showFieldError('guestPhone', '請填寫手機號碼');
        return;
    } else if (!taiwanPhoneRegex.test(phone)) {
        showFieldError('guestPhone', '請輸入有效的手機號碼（09 開頭，共 10 碼）');
        return;
    }
    clearFieldError('guestPhone');
    
    // 5. Email 驗證（與後端驗證邏輯一致）
    const emailInput = document.getElementById('guestEmail');
    const emailRaw = emailInput.value.trim();
    // 轉為小寫並檢查長度（與後端 sanitizeEmail 邏輯一致）
    const email = emailRaw.toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRaw) {
        showFieldError('guestEmail', '請填寫 Email');
        return;
    } else if (!emailRegex.test(email)) {
        showFieldError('guestEmail', '請輸入有效的 Email 格式（例如：example@email.com）');
        return;
    } else if (email.length > 255) {
        showFieldError('guestEmail', 'Email 長度不能超過 255 字元');
        return;
    }
    clearFieldError('guestEmail');
    
    // 6. 付款方式驗證：如果入住日期為今天，不允許選擇匯款
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked');
    if (paymentMethod && paymentMethod.value === 'transfer') {
        const checkInDate = new Date(checkIn);
        checkInDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (checkInDate.getTime() === today.getTime()) {
            alert('入住日期為今天時，無法選擇匯款轉帳，請選擇線上刷卡');
            const cardOption = document.querySelector('input[name="paymentMethod"][value="card"]');
            if (cardOption) {
                cardOption.checked = true;
            }
            return;
        }
    }
    
    // 所有驗證通過，開始提交
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>處理中...</span>';
    
    const adults = parseInt(document.getElementById('adults').value) || 0;
    const children = parseInt(document.getElementById('children').value) || 0;
    const totalGuests = adults + children;
    
    // 選取的房型與容量檢查
    const selectedRoom = document.querySelector('input[name="roomType"]:checked').closest('.room-option');
    const maxOcc = parseInt(selectedRoom.dataset.maxOccupancy || '0');
    const extraBeds = parseInt(selectedRoom.dataset.extraBeds || '0');
    const capacity = (maxOcc || 0) + (extraBeds || 0);
    
    if (!window.__skipCapacityCheck && capacity > 0 && totalGuests > capacity) {
        showCapacityModal(capacity, totalGuests);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>確認訂房</span>';
        return;
    }
    window.__skipCapacityCheck = false;
    
    // 收集表單資料（使用驗證後清理過的資料）
    const formData = {
        checkInDate: document.getElementById('checkInDate').value,
        checkOutDate: document.getElementById('checkOutDate').value,
        roomType: document.querySelector('input[name="roomType"]:checked').value,
        guestName: document.getElementById('guestName').value.trim(),
        guestPhone: phone, // 使用驗證後清理過的手機號碼（已移除 - 和空格）
        guestEmail: email, // 使用驗證後清理過的 Email（已轉小寫）
        adults,
        children,
        paymentAmount: document.querySelector('input[name="paymentAmount"]:checked').value,
        paymentMethod: document.querySelector('input[name="paymentMethod"]:checked').value
    };
    
    // 計算價格資訊（考慮假日）
    const checkInDate = formData.checkInDate;
    const checkOutDate = formData.checkOutDate;
    const nights = calculateNights();
    // 計算加購商品總金額（只有在啟用時才計算，考慮數量）
    const addonsTotal = enableAddons ? selectedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0) : 0;
    
    // 使用 API 計算價格（考慮假日）
    let pricePerNight = parseInt(selectedRoom.dataset.price); // 預設值
    let roomTotal = pricePerNight * nights; // 預設值
    
    if (checkInDate && checkOutDate) {
        try {
            const roomTypeName = selectedRoom.closest('.room-option').querySelector('.room-name').textContent.trim();
            const priceResponse = await fetch(`/api/calculate-price?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&roomTypeName=${encodeURIComponent(roomTypeName)}`);
            const priceResult = await priceResponse.json();
            
            if (priceResult.success) {
                roomTotal = priceResult.data.totalAmount;
                pricePerNight = priceResult.data.averagePricePerNight;
                console.log('✅ 使用 API 計算價格（考慮假日）:', { roomTotal, pricePerNight, nights });
            } else {
                console.warn('⚠️ API 計算價格失敗，使用基礎價格:', priceResult.message);
            }
        } catch (priceError) {
            console.error('❌ 計算價格錯誤，使用基礎價格:', priceError);
        }
    }
    
    let totalAmount = roomTotal + addonsTotal;
    
    // 計算優惠代碼折扣
    let discountAmount = 0;
    if (appliedPromoCode) {
        discountAmount = appliedPromoCode.discount_amount || 0;
        totalAmount = Math.max(0, totalAmount - discountAmount);
    }
    
    const depositRate = depositPercentage / 100;
    const paymentType = formData.paymentAmount === 'deposit' ? depositRate : 1;
    const finalAmount = totalAmount * paymentType;
    
    formData.pricePerNight = pricePerNight;
    formData.nights = nights;
    formData.totalAmount = roomTotal + addonsTotal; // 原始總金額（不含折扣）
    formData.finalAmount = finalAmount; // 最終應付金額（含折扣）
    formData.addons = enableAddons ? selectedAddons : []; // 加購商品陣列（只有在啟用時才包含，包含數量）
    formData.addonsTotal = addonsTotal; // 加購商品總金額
    formData.promoCode = appliedPromoCode ? appliedPromoCode.code : null; // 優惠代碼（如果有）
    
    // 如果有 LINE User ID，加入表單資料中
    if (lineUserId) {
        formData.lineUserId = lineUserId;
        console.log('📱 加入 LINE User ID 到訂房資料');
    }
    
    console.log('準備發送訂房資料:', formData);
    
    try {
        // 取得 CSRF Token
        let csrfToken = null;
        try {
            const tokenResponse = await fetch('/api/csrf-token', {
                credentials: 'include'
            });
            if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json();
                csrfToken = tokenData.csrfToken;
            }
        } catch (tokenError) {
            console.warn('無法取得 CSRF Token:', tokenError);
        }
        
        console.log('正在發送請求到 /api/booking...');
        const headers = {
            'Content-Type': 'application/json',
        };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        
        const response = await fetch('/api/booking', {
            method: 'POST',
            headers: headers,
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        
        console.log('收到回應，狀態碼:', response.status);
        const result = await response.json();
        console.log('回應資料:', result);
        
        if (response.ok) {
            // 如果是線上刷卡，導向支付頁面
            if (result.paymentMethod === 'card' && result.paymentData) {
                // 建立並提交支付表單
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = result.paymentData.actionUrl;
                
                // 加入所有參數
                Object.keys(result.paymentData.params).forEach(key => {
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = key;
                    input.value = result.paymentData.params[key];
                    form.appendChild(input);
                });
                
                document.body.appendChild(form);
                form.submit();
            } else {
                // 匯款轉帳：顯示成功訊息
                document.getElementById('bookingForm').style.display = 'none';
                document.getElementById('successMessage').classList.remove('hidden');
                
                // Facebook Pixel: 追蹤訂房完成（Purchase 事件）
                const selectedRoom = document.querySelector('input[name="roomType"]:checked');
                const roomTypeName = selectedRoom ? 
                    selectedRoom.closest('.room-option').querySelector('.room-name').textContent.trim() : '';
                const paidAmount = parseInt(document.getElementById('paymentAmount').textContent.replace(/[^0-9]/g, '')) || 0;
                const totalAmount = parseInt(document.getElementById('totalAmount').textContent.replace(/[^0-9]/g, '')) || 0;
                trackPurchase(result.bookingId, roomTypeName, totalAmount, paidAmount);
                
                // 滾動到頂部
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else {
            // 顯示更詳細的錯誤訊息
            const errorMsg = result.message || '請稍後再試';
            console.error('訂房失敗:', errorMsg, result);
            
            // 根據錯誤類型顯示不同的訊息
            if (errorMsg.includes('Email') || errorMsg.includes('email')) {
                showFieldError('guestEmail', errorMsg);
            } else if (errorMsg.includes('手機') || errorMsg.includes('phone')) {
                showFieldError('guestPhone', errorMsg);
            } else if (errorMsg.includes('日期') || errorMsg.includes('date')) {
                showFieldError('dateRange', errorMsg);
            } else if (errorMsg.includes('姓名') || errorMsg.includes('name')) {
                showFieldError('guestName', errorMsg);
            } else if (errorMsg.includes('房型') || errorMsg.includes('room')) {
                showSectionError('roomTypeGrid', errorMsg);
            } else {
                // 其他錯誤顯示 alert
                alert('訂房失敗：' + errorMsg);
            }
            
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>確認訂房</span>';
        }
    } catch (error) {
        console.error('Error:', error);
        alert('發生錯誤，請稍後再試');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>確認訂房</span>';
    }
});

// 初始化價格顯示
calculatePrice();

