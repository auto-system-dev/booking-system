// 全域變數
let roomTypes = [];
let depositPercentage = 30; // 預設訂金百分比
let unavailableRooms = []; // 已滿房的房型列表

// 設定最小日期為今天
const today = new Date().toISOString().split('T')[0];
document.getElementById('checkInDate').setAttribute('min', today);
document.getElementById('checkOutDate').setAttribute('min', today);

// 載入房型資料和系統設定
async function loadRoomTypesAndSettings() {
    try {
        // 同時載入房型和設定
        const [roomTypesResponse, settingsResponse] = await Promise.all([
            fetch('/api/room-types'),
            fetch('/api/settings')
        ]);
        
        const roomTypesResult = await roomTypesResponse.json();
        const settingsResult = await settingsResponse.json();
        
        if (roomTypesResult.success) {
            roomTypes = roomTypesResult.data || [];
            renderRoomTypes();
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

// 渲染房型選項
function renderRoomTypes() {
    const grid = document.getElementById('roomTypeGrid');
    
    if (roomTypes.length === 0) {
        grid.innerHTML = '<div class="loading">目前沒有可用的房型</div>';
        return;
    }
    
    const checkInDate = document.getElementById('checkInDate').value;
    const checkOutDate = document.getElementById('checkOutDate').value;
    const hasDates = checkInDate && checkOutDate;
    
    grid.innerHTML = roomTypes.map((room, index) => {
        const isUnavailable = hasDates && unavailableRooms.includes(room.name);
        const roomOptionClass = isUnavailable ? 'room-option unavailable' : 'room-option';
        const disabledAttr = isUnavailable ? 'disabled' : '';
        
        return `
        <div class="${roomOptionClass}" data-room="${room.name}" data-price="${room.price}">
            <input type="radio" id="room-${room.name}" name="roomType" value="${room.name}" ${disabledAttr} ${isUnavailable ? '' : 'required'}>
            <label for="room-${room.name}">
                <div class="room-icon">${room.icon || '🏠'}</div>
                <div class="room-name">${room.display_name}</div>
                <div class="room-price ${isUnavailable ? 'unavailable-price' : ''}">
                    ${isUnavailable ? '<span style="color: #e74c3c; font-weight: bold;">滿房</span>' : `NT$ ${room.price.toLocaleString()}/晚`}
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

// 計算價格
function calculatePrice() {
    const selectedRoom = document.querySelector('input[name="roomType"]:checked');
    if (!selectedRoom) {
        updatePriceDisplay(0, 0, 0, 'deposit');
        return;
    }

    const roomOption = selectedRoom.closest('.room-option');
    const pricePerNight = parseInt(roomOption.dataset.price);
    const nights = calculateNights();
    const totalAmount = pricePerNight * nights;
    
    const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
    const depositRate = depositPercentage / 100; // 轉換為小數（例如：30% -> 0.3）
    const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
    const finalAmount = totalAmount * paymentType;

    updatePriceDisplay(pricePerNight, nights, totalAmount, paymentAmount, finalAmount);
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
function updatePriceDisplay(pricePerNight, nights, totalAmount, paymentType, finalAmount = 0, depositPercent = null) {
    // 如果沒有提供 depositPercent，使用全域變數
    if (depositPercent === null) {
        depositPercent = depositPercentage;
    }
    
    document.getElementById('roomPricePerNight').textContent = `NT$ ${pricePerNight.toLocaleString()}`;
    document.getElementById('nightsCount').textContent = `${nights} 晚`;
    document.getElementById('totalAmount').textContent = `NT$ ${totalAmount.toLocaleString()}`;
    
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
});

document.getElementById('checkOutDate').addEventListener('change', function() {
    calculateNights();
    calculatePrice();
    checkRoomAvailability(); // 檢查房間可用性
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
    const totalAmount = pricePerNight * nights;
    const depositRate = depositPercentage / 100;
    const paymentType = formData.paymentAmount === 'deposit' ? depositRate : 1;
    const finalAmount = totalAmount * paymentType;
    
    formData.pricePerNight = pricePerNight;
    formData.nights = nights;
    formData.totalAmount = totalAmount;
    formData.finalAmount = finalAmount;
    
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

