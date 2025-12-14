// 全域變數
let roomTypes = [];
let addons = []; // 加購商品列表
let selectedAddons = []; // 已選擇的加購商品
let enableAddons = true; // 前台加購商品功能是否啟用
let depositPercentage = 30; // 預設訂金百分比
let unavailableRooms = []; // 已滿房的房型列表

// 設定最小日期為今天
const today = new Date().toISOString().split('T')[0];
document.getElementById('checkInDate').setAttribute('min', today);
document.getElementById('checkOutDate').setAttribute('min', today);

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
        
        if (roomTypesResult.success) {
            roomTypes = roomTypesResult.data || [];
            renderRoomTypes();
        }
        
        // 檢查是否啟用前台加購商品功能
        enableAddons = settingsResult.success && settingsResult.data && 
                       (settingsResult.data.enable_addons === '1' || settingsResult.data.enable_addons === 'true');
        
        if (enableAddons && addonsResult.success) {
            addons = addonsResult.data || [];
            renderAddons();
            // 顯示加購商品區塊
            const addonsSection = document.querySelector('.form-section:has(#addonsGrid)');
            if (addonsSection) {
                addonsSection.style.display = 'block';
            }
        } else {
            // 隱藏加購商品區塊
            const addonsSection = document.querySelector('.form-section:has(#addonsGrid)');
            if (addonsSection) {
                addonsSection.style.display = 'none';
            }
            addons = [];
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
function isWeekend(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 週日, 6 = 週六
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
                // 如果 API 失敗，使用週末判斷
                isCheckInHoliday = isWeekend(checkInDate);
            }
        } catch (error) {
            // 如果發生錯誤，使用週末判斷
            isCheckInHoliday = isWeekend(checkInDate);
        }
    }
    
    grid.innerHTML = roomTypes.map((room, index) => {
        const isUnavailable = hasDates && unavailableRooms.includes(room.name);
        const roomOptionClass = isUnavailable ? 'room-option unavailable' : 'room-option';
        const disabledAttr = isUnavailable ? 'disabled' : '';
        
        const holidaySurcharge = room.holiday_surcharge || 0;
        // 根據入住日期判斷顯示平日價格還是假日價格
        const displayPrice = (checkInDate && isCheckInHoliday && holidaySurcharge !== 0) 
            ? (room.price + holidaySurcharge) 
            : room.price;
        let priceDisplay = '';
        
        if (isUnavailable) {
            priceDisplay = '<span style="color: #e74c3c; font-weight: bold;">滿房</span>';
        } else {
            priceDisplay = `NT$ ${displayPrice.toLocaleString()}/晚`;
        }
        
        return `
        <div class="${roomOptionClass}" data-room="${room.name}" data-price="${room.price}" data-holiday-surcharge="${holidaySurcharge}">
            <input type="radio" id="room-${room.name}" name="roomType" value="${room.name}" ${disabledAttr} ${isUnavailable ? '' : 'required'}>
            <label for="room-${room.name}">
                <div class="room-icon">${room.icon || '🏠'}</div>
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
        radio.addEventListener('change', calculatePrice);
    });
}

// 頁面載入時執行
loadRoomTypesAndSettings();

// 頁面載入後，如果有日期，檢查房間可用性
document.addEventListener('DOMContentLoaded', function() {
    // 延遲一下，確保日期輸入框已初始化
    setTimeout(() => {
        const checkInDate = document.getElementById('checkInDate').value;
        const checkOutDate = document.getElementById('checkOutDate').value;
        if (checkInDate && checkOutDate) {
            checkRoomAvailability();
        }
    }, 500);
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
        updatePriceDisplay(0, 0, 0, 'deposit', 0, 0);
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
        const totalAmount = roomTotal + addonsTotal;
        
        const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
        const depositRate = depositPercentage / 100;
        const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
        const finalAmount = totalAmount * paymentType;

        updatePriceDisplay(pricePerNight, nights, totalAmount, paymentAmount, finalAmount, addonsTotal);
        return;
    }

    // 使用新的 API 計算價格（考慮假日）
    try {
        const roomTypeName = selectedRoom.closest('.room-option').querySelector('.room-name').textContent.trim();
        const response = await fetch(`/api/calculate-price?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&roomTypeName=${encodeURIComponent(roomTypeName)}`);
        const result = await response.json();
        
        if (result.success) {
            const { totalAmount: roomTotal, averagePricePerNight, nights } = result.data;
            const totalAmount = roomTotal + addonsTotal;
            
            const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
            const depositRate = depositPercentage / 100;
            const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
            const finalAmount = totalAmount * paymentType;

            updatePriceDisplay(averagePricePerNight, nights, totalAmount, paymentAmount, finalAmount, addonsTotal);
        } else {
            console.error('計算價格失敗:', result.message);
            // 如果 API 失敗，使用舊的計算方式
            const roomOption = selectedRoom.closest('.room-option');
            const pricePerNight = parseInt(roomOption.dataset.price);
            const nights = calculateNights();
            const roomTotal = pricePerNight * nights;
            const totalAmount = roomTotal + addonsTotal;
            
            const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
            const depositRate = depositPercentage / 100;
            const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
            const finalAmount = totalAmount * paymentType;

            updatePriceDisplay(pricePerNight, nights, totalAmount, paymentAmount, finalAmount, addonsTotal);
        }
    } catch (error) {
        console.error('計算價格錯誤:', error);
        // 如果發生錯誤，使用舊的計算方式
        const roomOption = selectedRoom.closest('.room-option');
        const pricePerNight = parseInt(roomOption.dataset.price);
        const nights = calculateNights();
        const roomTotal = pricePerNight * nights;
        const totalAmount = roomTotal + addonsTotal;
        
        const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
        const depositRate = depositPercentage / 100;
        const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
        const finalAmount = totalAmount * paymentType;

        updatePriceDisplay(pricePerNight, nights, totalAmount, paymentAmount, finalAmount, addonsTotal);
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
}

// 更新價格顯示
function updatePriceDisplay(pricePerNight, nights, totalAmount, paymentType, finalAmount = 0, addonsTotal = 0, depositPercent = null) {
    // 如果沒有提供 depositPercent，使用全域變數
    if (depositPercent === null) {
        depositPercent = depositPercentage;
    }
    
    document.getElementById('roomPricePerNight').textContent = `NT$ ${pricePerNight.toLocaleString()}`;
    document.getElementById('nightsCount').textContent = `${nights} 晚`;
    
    // 如果有加購商品，顯示加購商品金額
    const totalAmountElement = document.getElementById('totalAmount');
    if (addonsTotal > 0 && selectedAddons.length > 0) {
        const roomTotal = totalAmount - addonsTotal;
        // 計算加購商品明細
        const addonsDetail = selectedAddons.map(addon => {
            const addonName = addons.find(a => a.name === addon.name)?.display_name || addon.name;
            return `${addonName} x${addon.quantity || 1}`;
        }).join('、');
        
        totalAmountElement.innerHTML = `
            <div style="margin-bottom: 5px; color: #666;">房型總額：NT$ ${roomTotal.toLocaleString()}</div>
            <div style="margin-bottom: 5px; color: #666;">加購商品（${addonsDetail}）：NT$ ${addonsTotal.toLocaleString()}</div>
            <div style="font-weight: 700; font-size: 18px; color: #2C8EC4; border-top: 2px solid #ddd; padding-top: 5px; margin-top: 5px;">總金額：NT$ ${totalAmount.toLocaleString()}</div>
        `;
    } else {
        totalAmountElement.textContent = `NT$ ${totalAmount.toLocaleString()}`;
    }
    
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

// 日期變更事件
document.getElementById('checkInDate').addEventListener('change', function() {
    const checkIn = new Date(this.value);
    const checkOutInput = document.getElementById('checkOutDate');
    
    // 設定退房日期最小值為入住日期後一天
    if (checkIn) {
        const minCheckOut = new Date(checkIn);
        minCheckOut.setDate(minCheckOut.getDate() + 1);
        checkOutInput.setAttribute('min', minCheckOut.toISOString().split('T')[0]);
        
        // 如果退房日期早於入住日期，清空退房日期
        const checkOut = new Date(checkOutInput.value);
        if (checkOut <= checkIn) {
            checkOutInput.value = '';
        }
    }
    
    calculateNights();
    calculatePrice();
    checkRoomAvailability(); // 檢查房間可用性
    renderRoomTypes(); // 重新渲染房型（更新價格顯示）
});

document.getElementById('checkOutDate').addEventListener('change', function() {
    calculateNights();
    calculatePrice();
    checkRoomAvailability(); // 檢查房間可用性
    renderRoomTypes(); // 重新渲染房型（更新價格顯示）
});

// 房型選擇事件
document.querySelectorAll('input[name="roomType"]').forEach(radio => {
    radio.addEventListener('change', calculatePrice);
});

// 支付選項變更事件
document.querySelectorAll('input[name="paymentAmount"]').forEach(radio => {
    radio.addEventListener('change', calculatePrice);
});

// 表單提交
document.getElementById('bookingForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitBtn = this.querySelector('.submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>處理中...</span>';
    
    // 收集表單資料
    const formData = {
        checkInDate: document.getElementById('checkInDate').value,
        checkOutDate: document.getElementById('checkOutDate').value,
        roomType: document.querySelector('input[name="roomType"]:checked').value,
        guestName: document.getElementById('guestName').value,
        guestPhone: document.getElementById('guestPhone').value,
        guestEmail: document.getElementById('guestEmail').value,
        paymentAmount: document.querySelector('input[name="paymentAmount"]:checked').value,
        paymentMethod: document.querySelector('input[name="paymentMethod"]:checked').value
    };
    
    // 計算價格資訊
    const selectedRoom = document.querySelector('input[name="roomType"]:checked').closest('.room-option');
    const pricePerNight = parseInt(selectedRoom.dataset.price);
    const nights = calculateNights();
    // 計算加購商品總金額（只有在啟用時才計算，考慮數量）
    const addonsTotal = enableAddons ? selectedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0) : 0;
    const roomTotal = pricePerNight * nights;
    const totalAmount = roomTotal + addonsTotal;
    const depositRate = depositPercentage / 100;
    const paymentType = formData.paymentAmount === 'deposit' ? depositRate : 1;
    const finalAmount = totalAmount * paymentType;
    
    formData.pricePerNight = pricePerNight;
    formData.nights = nights;
    formData.totalAmount = totalAmount;
    formData.finalAmount = finalAmount;
    formData.addons = enableAddons ? selectedAddons : []; // 加購商品陣列（只有在啟用時才包含，包含數量）
    formData.addonsTotal = addonsTotal; // 加購商品總金額
    
    console.log('準備發送訂房資料:', formData);
    
    try {
        console.log('正在發送請求到 /api/booking...');
        const response = await fetch('/api/booking', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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
                
                // 滾動到頂部
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else {
            alert('訂房失敗：' + (result.message || '請稍後再試'));
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

