// 管理後台 JavaScript

let allBookings = [];
let filteredBookings = [];
let currentPage = 1;
const itemsPerPage = 10;
let currentBookingView = 'list';
let calendarStartDate = null;
let sortColumn = null; // 當前排序欄位
let sortDirection = 'asc'; // 排序方向：'asc' 或 'desc'

// Quill 編輯器實例
let quillEditor = null;
let isHtmlMode = false;

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 導航切換
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.dataset.section;
            switchSection(section);
        });
    });

    // 載入資料
    loadBookings();
    loadStatistics();
    
    // 根據 URL hash 載入對應區塊
    const urlHash = window.location.hash;
    if (urlHash === '#dashboard') {
        switchSection('dashboard');
        loadDashboard();
    } else if (urlHash === '#room-types') {
        switchSection('room-types');
        loadRoomTypes();
    } else if (urlHash === '#settings') {
        switchSection('settings');
        loadSettings();
        loadHolidays();
    } else if (urlHash === '#addons') {
        switchSection('addons');
        loadAddons();
    } else if (urlHash === '#holidays') {
        switchSection('holidays');
        loadHolidays();
    } else if (urlHash === '#email-templates') {
        switchSection('email-templates');
        loadEmailTemplates();
    } else if (urlHash === '#statistics') {
        switchSection('statistics');
        loadStatistics();
    }

    // 點擊模態框外部關閉
    document.getElementById('bookingModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeModal();
        }
    });
    
    // 點擊郵件模板模態框外部關閉
    const emailTemplateModal = document.getElementById('emailTemplateModal');
    if (emailTemplateModal) {
        emailTemplateModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeEmailTemplateModal();
            }
        });
    }
});

// 切換區塊
function switchSection(section) {
    // 更新導航狀態
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const navItem = document.querySelector(`[data-section="${section}"]`);
    if (navItem) {
        navItem.classList.add('active');
    }

    // 更新內容區
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
    });
    const contentSection = document.getElementById(`${section}-section`);
    if (contentSection) {
        contentSection.classList.add('active');
    }
    
    // 根據區塊載入對應資料
    if (section === 'dashboard') {
        loadDashboard();
    } else if (section === 'room-types') {
        loadRoomTypes();
    } else if (section === 'addons') {
        loadAddons();
    } else if (section === 'holidays') {
        loadHolidays();
    } else if (section === 'settings') {
        loadSettings();
    } else if (section === 'email-templates') {
        loadEmailTemplates();
    } else if (section === 'statistics') {
        loadStatistics();
    } else if (section === 'bookings') {
        loadBookings();
    }
}

// 載入儀表板數據
async function loadDashboard() {
    try {
        const response = await fetch('/api/dashboard');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const data = result.data;
            
            // 更新今日房況
            document.getElementById('todayCheckIns').textContent = data.todayCheckIns || 0;
            document.getElementById('todayCheckOuts').textContent = data.todayCheckOuts || 0;
            
            // 更新今日訂單
            document.getElementById('todayTransferOrders').textContent = data.todayTransferOrders || 0;
            document.getElementById('todayCardOrders').textContent = data.todayCardOrders || 0;
            
            // 更新訂房狀態
            document.getElementById('activeBookings').textContent = data.activeBookings || 0;
            document.getElementById('reservedBookings').textContent = data.reservedBookings || 0;
            document.getElementById('cancelledBookings').textContent = data.cancelledBookings || 0;
        } else {
            showError('載入儀表板數據失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入儀表板數據錯誤:', error);
        showError('載入儀表板數據時發生錯誤：' + error.message);
    }
}

// 載入訂房記錄
async function loadBookings() {
    try {
        const response = await fetch('/api/bookings');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        console.log('API 回應:', result);
        
        if (result.success) {
            allBookings = result.data || [];
            currentPage = 1;
            console.log('📊 載入的訂房記錄數量:', allBookings.length);
            if (allBookings.length > 0) {
                console.log('📊 第一筆記錄的金額:', {
                    booking_id: allBookings[0].booking_id,
                    total_amount: allBookings[0].total_amount,
                    final_amount: allBookings[0].final_amount
                });
            }
            // 應用篩選和排序
            applyFiltersAndSort();
        } else {
            showError('載入訂房記錄失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入訂房記錄錯誤:', error);
        showError('載入訂房記錄時發生錯誤：' + error.message);
    }
}

// （排房日曆功能已移除，僅保留列表檢視）

// 渲染訂房記錄
function renderBookings() {
    const tbody = document.getElementById('bookingsTableBody');
    
    if (filteredBookings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="loading">沒有找到訂房記錄</td></tr>';
        return;
    }

    // 計算分頁
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageBookings = filteredBookings.slice(start, end);

    tbody.innerHTML = pageBookings.map(booking => {
        const paymentStatus = booking.payment_status || 'pending';
        const bookingStatus = booking.status || 'active';
        const isCancelled = bookingStatus === 'cancelled';
        
        // 確保金額是數字類型並正確顯示
        const finalAmount = parseInt(booking.final_amount) || 0;
        
        return `
        <tr ${isCancelled ? 'style="opacity: 0.6; background: #f8f8f8;"' : ''}>
            <td>${booking.booking_id}</td>
            <td>${booking.guest_name}</td>
            <td>${booking.room_type}</td>
            <td>${(booking.adults || 0)}大${(booking.children || 0)}小</td>
            <td>${formatDate(booking.check_in_date)}</td>
            <td>${booking.nights} 晚</td>
            <td>NT$ ${finalAmount.toLocaleString()}</td>
            <td>${booking.payment_method}</td>
            <td>
                <span class="status-badge ${getPaymentStatusClass(paymentStatus)}">
                    ${getPaymentStatusText(paymentStatus)}
                </span>
            </td>
            <td>
                <span class="status-badge ${getBookingStatusClass(bookingStatus)}">
                    ${getBookingStatusText(bookingStatus)}
                </span>
            </td>
            <td>
                ${getEmailStatusDisplay(booking.email_sent)}
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-view" onclick="viewBookingDetail('${booking.booking_id}')">查看</button>
                    ${!isCancelled ? `
                        <button class="btn-edit" onclick="editBooking('${booking.booking_id}')">編輯</button>
                        <button class="btn-cancel" onclick="cancelBooking('${booking.booking_id}')">取消</button>
                    ` : `
                        <button class="btn-delete" onclick="deleteBooking('${booking.booking_id}')">刪除</button>
                    `}
                </div>
            </td>
        </tr>
    `;
    }).join('');

    // 渲染分頁
    renderPagination();
}

// 渲染分頁
function renderPagination() {
    const totalPages = Math.ceil(filteredBookings.length / itemsPerPage);
    const pagination = document.getElementById('pagination');
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';
    
    // 上一頁
    html += `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一頁</button>`;
    
    // 頁碼
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<button onclick="changePage(${i})" ${i === currentPage ? 'style="background: #667eea; color: white;"' : ''}>${i}</button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += `<span class="page-info">...</span>`;
        }
    }
    
    // 下一頁
    html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>下一頁</button>`;
    
    html += `<span class="page-info">共 ${filteredBookings.length} 筆，第 ${currentPage}/${totalPages} 頁</span>`;
    
    pagination.innerHTML = html;
}

// 切換頁碼
function changePage(page) {
    const totalPages = Math.ceil(filteredBookings.length / itemsPerPage);
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderBookings();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// 篩選訂房記錄
// 應用篩選和排序
function applyFiltersAndSort() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const roomType = document.getElementById('roomTypeFilter').value;
    const paymentStatus = document.getElementById('statusFilter').value;
    const checkInDate = document.getElementById('checkInDateFilter').value;
    
    console.log('🔍 篩選條件:', { searchTerm, roomType, paymentStatus, checkInDate });
    
    filteredBookings = allBookings.filter(booking => {
        const matchSearch = !searchTerm || 
            booking.booking_id.toLowerCase().includes(searchTerm) ||
            booking.guest_name.toLowerCase().includes(searchTerm) ||
            booking.guest_email.toLowerCase().includes(searchTerm) ||
            booking.guest_phone.includes(searchTerm);
        
        const matchRoomType = !roomType || booking.room_type === roomType;
        
        const matchPaymentStatus = !paymentStatus || (booking.payment_status || 'pending') === paymentStatus;
        
        const matchCheckInDate = !checkInDate || booking.check_in_date === checkInDate;
        
        return matchSearch && matchRoomType && matchPaymentStatus && matchCheckInDate;
    });
    
    // 如果有排序，應用排序
    if (sortColumn === 'check_in_date') {
        applySort();
    }
    
    console.log(`✅ 篩選結果: ${filteredBookings.length} 筆訂房記錄`);
    currentPage = 1;
    updateSortIcon();
    renderBookings();
}

function filterBookings() {
    applyFiltersAndSort();
}

// 按入住日期排序
function sortByCheckInDate() {
    if (sortColumn === 'check_in_date') {
        // 切換排序方向
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // 第一次點擊，設為升序
        sortColumn = 'check_in_date';
        sortDirection = 'asc';
    }
    
    applyFiltersAndSort();
}

// 應用排序
function applySort() {
    if (sortColumn === 'check_in_date') {
        filteredBookings.sort((a, b) => {
            const dateA = new Date(a.check_in_date);
            const dateB = new Date(b.check_in_date);
            
            if (sortDirection === 'asc') {
                return dateA - dateB;
            } else {
                return dateB - dateA;
            }
        });
    }
}

// 更新排序圖示
function updateSortIcon() {
    const icon = document.getElementById('checkInDateSortIcon');
    if (icon) {
        if (sortColumn === 'check_in_date') {
            icon.textContent = sortDirection === 'asc' ? '↑' : '↓';
            icon.style.color = '#667eea';
        } else {
            icon.textContent = '⇅';
            icon.style.color = '#999';
        }
    }
}

// 查看訂房詳情
async function viewBookingDetail(bookingId) {
    try {
        const response = await fetch(`/api/bookings/${bookingId}`);
        const result = await response.json();
        
        if (result.success) {
            showBookingModal(result.data);
        } else {
            showError('載入訂房詳情失敗');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入訂房詳情時發生錯誤');
    }
}

// 顯示訂房詳情模態框
function showBookingModal(booking) {
    const modal = document.getElementById('bookingModal');
    const modalBody = document.getElementById('modalBody');
    
    modalBody.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">訂房編號</span>
            <span class="detail-value">${booking.booking_id}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">客戶姓名</span>
            <span class="detail-value">${booking.guest_name}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">聯絡電話</span>
            <span class="detail-value">${booking.guest_phone}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Email</span>
            <span class="detail-value">${booking.guest_email}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">房型</span>
            <span class="detail-value">${booking.room_type}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">人數</span>
            <span class="detail-value">成人：${booking.adults || 0} 人，孩童：${booking.children || 0} 人</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">入住日期</span>
            <span class="detail-value">${formatDate(booking.check_in_date)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">退房日期</span>
            <span class="detail-value">${formatDate(booking.check_out_date)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">住宿天數</span>
            <span class="detail-value">${booking.nights} 晚</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">每晚房價</span>
            <span class="detail-value">NT$ ${booking.price_per_night.toLocaleString()}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">總金額</span>
            <span class="detail-value">NT$ ${booking.total_amount.toLocaleString()}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">應付金額</span>
            <span class="detail-value" style="color: #667eea; font-weight: 700; font-size: 18px;">NT$ ${booking.final_amount.toLocaleString()}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">支付方式</span>
            <span class="detail-value">${booking.payment_amount} - ${booking.payment_method}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">付款狀態</span>
            <span class="detail-value">
                <span class="status-badge ${getPaymentStatusClass(booking.payment_status || 'pending')}">
                    ${getPaymentStatusText(booking.payment_status || 'pending')}
                </span>
            </span>
        </div>
        <div class="detail-row">
            <span class="detail-label">訂房狀態</span>
            <span class="detail-value">
                <span class="status-badge ${getBookingStatusClass(booking.status || 'active')}">
                    ${getBookingStatusText(booking.status || 'active')}
                </span>
            </span>
        </div>
        <div class="detail-row">
            <span class="detail-label">郵件狀態</span>
            <span class="detail-value">
                ${getEmailStatusDisplay(booking.email_sent)}
            </span>
        </div>
        <div class="detail-row">
            <span class="detail-label">訂房時間</span>
            <span class="detail-value">${formatDateTime(booking.created_at)}</span>
        </div>
    `;
    
    modal.classList.add('active');
}

// 關閉模態框
function closeModal() {
    document.getElementById('bookingModal').classList.remove('active');
}

// 載入統計資料
async function loadStatistics() {
    try {
        const response = await fetch('/api/statistics');
        const result = await response.json();
        
        if (result.success) {
            const stats = result.data;
            
            document.getElementById('totalBookings').textContent = stats.totalBookings || 0;
            document.getElementById('totalRevenue').textContent = `NT$ ${(stats.totalRevenue || 0).toLocaleString()}`;
            document.getElementById('recentBookings').textContent = stats.recentBookings || 0;
            
            // 計算郵件已發送數量
            const emailSentCount = allBookings.filter(b => b.email_sent).length;
            document.getElementById('emailSent').textContent = `${emailSentCount}/${allBookings.length}`;
            
            // 渲染房型統計
            renderRoomStats(stats.byRoomType || []);
        } else {
            showError('載入統計資料失敗');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入統計資料時發生錯誤');
    }
}

// 渲染房型統計
function renderRoomStats(roomStats) {
    const container = document.getElementById('roomStatsList');
    
    if (roomStats.length === 0) {
        container.innerHTML = '<div class="loading">沒有資料</div>';
        return;
    }
    
    container.innerHTML = roomStats.map(stat => `
        <div class="room-stat-item">
            <span class="room-stat-name">${stat.room_type}</span>
            <span class="room-stat-count">${stat.count} 筆</span>
        </div>
    `).join('');
}

// 格式化日期
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// 格式化日期時間
function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 顯示錯誤訊息
function showError(message) {
    alert(message);
}

// 取得付款狀態樣式
function getPaymentStatusClass(status) {
    const statusMap = {
        'paid': 'status-paid',
        'pending': 'status-pending',
        'failed': 'status-failed',
        'refunded': 'status-refunded'
    };
    return statusMap[status] || 'status-pending';
}

// 取得付款狀態文字
function getPaymentStatusText(status) {
    const statusMap = {
        'paid': '已付款',
        'pending': '待付款',
        'failed': '付款失敗',
        'refunded': '已退款'
    };
    return statusMap[status] || '待付款';
}

// 取得訂房狀態樣式
function getBookingStatusClass(status) {
    const statusMap = {
        'active': 'status-paid',
        'reserved': 'status-pending',
        'cancelled': 'status-failed'
    };
    return statusMap[status] || 'status-paid';
}

// 取得訂房狀態文字
function getBookingStatusText(status) {
    const statusMap = {
        'active': '有效',
        'reserved': '保留',
        'cancelled': '已取消'
    };
    return statusMap[status] || '有效';
}

// 取得郵件狀態顯示（只顯示最後寄出的信）
function getEmailStatusDisplay(emailSent) {
    if (!emailSent || emailSent === '0' || emailSent === 0) {
        return '<span class="status-badge status-unsent">未發送</span>';
    }
    
    const emailTypeMap = {
        'booking_confirmation': { name: '確認信', class: 'status-email-confirmation' },
        'checkin_reminder': { name: '入住信', class: 'status-email-checkin' },
        'feedback_request': { name: '退房信', class: 'status-email-feedback' },
        'payment_reminder': { name: '繳款信', class: 'status-email-payment' },
        '1': { name: '確認信', class: 'status-email-confirmation' },  // 舊格式：數字 1 表示已發送確認信
        '0': { name: '未發送', class: 'status-unsent' }   // 舊格式：數字 0 表示未發送
    };
    
    // 如果 email_sent 是字串，解析郵件類型（只顯示最後一個）
    if (typeof emailSent === 'string') {
        const emailTypes = emailSent.split(',').filter(t => t.trim());
        if (emailTypes.length === 0) {
            return '<span class="status-badge status-unsent">未發送</span>';
        }
        
        // 只顯示最後一個郵件類型
        const lastType = emailTypes[emailTypes.length - 1].trim();
        const typeInfo = emailTypeMap[lastType] || { name: lastType, class: 'status-sent' };
        
        return `<span class="status-badge ${typeInfo.class}">${typeInfo.name}</span>`;
    }
    
    // 舊格式：數字 1 表示已發送確認信
    if (emailSent === 1 || emailSent === '1') {
        return '<span class="status-badge status-email-confirmation">確認信</span>';
    }
    
    // 其他情況：顯示已發送
    return '<span class="status-badge status-sent">已發送</span>';
}

// 編輯訂房
async function editBooking(bookingId) {
    try {
        console.log('載入訂房資料:', bookingId);
        const response = await fetch(`/api/bookings/${bookingId}`);
        const result = await response.json();
        
        if (result.success) {
            showEditModal(result.data);
        } else {
            showError('載入訂房資料失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入訂房資料時發生錯誤：' + error.message);
    }
}

// 房型價格對應表（動態載入）
let roomPrices = {};
let allRoomTypesForEdit = []; // 用於編輯表單
let depositPercentage = 30;

// 載入房型價格對應表
async function loadRoomPrices() {
    try {
        const [roomTypesResponse, settingsResponse] = await Promise.all([
            fetch('/api/admin/room-types'),
            fetch('/api/settings')
        ]);
        
        const roomTypesResult = await roomTypesResponse.json();
        const settingsResult = await settingsResponse.json();
        
        if (roomTypesResult.success) {
            roomPrices = {};
            allRoomTypesForEdit = roomTypesResult.data || [];
            roomTypesResult.data.forEach(room => {
                roomPrices[room.display_name] = room.price;
            });
        }
        
        if (settingsResult.success && settingsResult.data.deposit_percentage) {
            depositPercentage = parseInt(settingsResult.data.deposit_percentage) || 30;
        }
    } catch (error) {
        console.error('載入房型價格錯誤:', error);
    }
}

// 生成房型選項 HTML
function generateRoomTypeOptions(selectedRoomType) {
    if (allRoomTypesForEdit.length === 0) {
        // 如果還沒載入，使用預設選項
        return `
            <option value="標準雙人房" data-price="2000" ${selectedRoomType === '標準雙人房' ? 'selected' : ''}>標準雙人房 (NT$ 2,000/晚)</option>
            <option value="豪華雙人房" data-price="3500" ${selectedRoomType === '豪華雙人房' ? 'selected' : ''}>豪華雙人房 (NT$ 3,500/晚)</option>
            <option value="尊爵套房" data-price="5000" ${selectedRoomType === '尊爵套房' ? 'selected' : ''}>尊爵套房 (NT$ 5,000/晚)</option>
            <option value="家庭四人房" data-price="4500" ${selectedRoomType === '家庭四人房' ? 'selected' : ''}>家庭四人房 (NT$ 4,500/晚)</option>
        `;
    }
    
    return allRoomTypesForEdit.map(room => {
        const isSelected = room.display_name === selectedRoomType;
        return `<option value="${escapeHtml(room.display_name)}" data-price="${room.price}" ${isSelected ? 'selected' : ''}>${escapeHtml(room.display_name)} (NT$ ${room.price.toLocaleString()}/晚)</option>`;
    }).join('');
}

// 初始化時載入
loadRoomPrices();

// 顯示編輯模態框
function showEditModal(booking) {
    const modal = document.getElementById('bookingModal');
    const modalBody = document.getElementById('modalBody');
    
    // 計算初始價格
    const pricePerNight = roomPrices[booking.room_type] || 2000;
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    const totalAmount = pricePerNight * nights;
    // 根據原始付款方式計算應付金額（假設是訂金30%或全額）
    const originalFinalAmount = booking.final_amount || booking.total_amount;
    const isDeposit = originalFinalAmount < totalAmount * 0.5;
    const finalAmount = isDeposit ? totalAmount * 0.3 : totalAmount;
    
    modalBody.innerHTML = `
        <form id="editBookingForm" onsubmit="saveBookingEdit(event, '${booking.booking_id}')">
            <div class="form-group">
                <label>客戶姓名</label>
                <input type="text" name="guest_name" value="${escapeHtml(booking.guest_name)}" required>
            </div>
            <div class="form-group">
                <label>聯絡電話</label>
                <input type="tel" name="guest_phone" value="${escapeHtml(booking.guest_phone)}" required>
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" name="guest_email" value="${escapeHtml(booking.guest_email)}" required>
            </div>
            <div class="form-group">
                <label>房型</label>
                <select name="room_type" id="editRoomType" required onchange="calculateEditPrice()">
                    ${generateRoomTypeOptions(booking.room_type)}
                </select>
            </div>
            <div class="form-group">
                <label>入住日期</label>
                <input type="date" name="check_in_date" id="editCheckInDate" value="${booking.check_in_date}" required onchange="calculateEditPrice()">
            </div>
            <div class="form-group">
                <label>退房日期</label>
                <input type="date" name="check_out_date" id="editCheckOutDate" value="${booking.check_out_date}" required onchange="calculateEditPrice()">
            </div>
            <div class="form-group">
                <label>付款方式</label>
                <select name="payment_method" id="editPaymentMethod" required onchange="calculateEditPrice()">
                    <option value="匯款轉帳" ${booking.payment_method === '匯款轉帳' ? 'selected' : ''}>匯款轉帳</option>
                    <option value="線上刷卡" ${booking.payment_method === '線上刷卡' ? 'selected' : ''}>線上刷卡</option>
                </select>
            </div>
            <div class="form-group">
                <label>付款金額類型</label>
                <select name="payment_amount_type" id="editPaymentAmountType" required onchange="calculateEditPrice()">
                    <option value="deposit" ${isDeposit ? 'selected' : ''}>支付訂金 (${depositPercentage}%)</option>
                    <option value="full" ${!isDeposit ? 'selected' : ''}>支付全額</option>
                </select>
            </div>
            <div class="form-group">
                <label>付款狀態</label>
                <select name="payment_status" required>
                    <option value="pending" ${(booking.payment_status || 'pending') === 'pending' ? 'selected' : ''}>待付款</option>
                    <option value="paid" ${(booking.payment_status || 'pending') === 'paid' ? 'selected' : ''}>已付款</option>
                    <option value="failed" ${(booking.payment_status || 'pending') === 'failed' ? 'selected' : ''}>付款失敗</option>
                    <option value="refunded" ${(booking.payment_status || 'pending') === 'refunded' ? 'selected' : ''}>已退款</option>
                </select>
            </div>
            <div class="price-summary" style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h3 style="margin: 0 0 10px 0; font-size: 16px;">價格計算</h3>
                <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>每晚價格：</span>
                    <strong id="editPricePerNight">NT$ ${pricePerNight.toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>住宿天數：</span>
                    <strong id="editNights">${nights} 晚</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin: 5px 0; padding-top: 10px; border-top: 1px solid #ddd;">
                    <span>總金額：</span>
                    <strong id="editTotalAmount">NT$ ${totalAmount.toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin: 5px 0; color: #e74c3c; font-size: 18px;">
                    <span id="editPaymentTypeLabel">${isDeposit ? `應付訂金 (${depositPercentage}%)` : '應付全額'}：</span>
                    <strong id="editFinalAmount">NT$ ${finalAmount.toLocaleString()}</strong>
                </div>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-save">儲存</button>
                <button type="button" class="btn-cancel" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    
    modal.classList.add('active');
}

// 計算編輯表單的價格
function calculateEditPrice() {
    const roomTypeSelect = document.getElementById('editRoomType');
    const checkInDate = document.getElementById('editCheckInDate');
    const checkOutDate = document.getElementById('editCheckOutDate');
    const paymentAmountType = document.getElementById('editPaymentAmountType');
    
    if (!roomTypeSelect || !checkInDate || !checkOutDate || !paymentAmountType) {
        return;
    }
    
    const selectedOption = roomTypeSelect.options[roomTypeSelect.selectedIndex];
    const pricePerNight = parseInt(selectedOption.dataset.price) || 2000;
    
    const checkIn = new Date(checkInDate.value);
    const checkOut = new Date(checkOutDate.value);
    
    if (checkIn && checkOut && checkOut > checkIn) {
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        const totalAmount = pricePerNight * nights;
        const isDeposit = paymentAmountType.value === 'deposit';
        const finalAmount = isDeposit ? Math.round(totalAmount * depositPercentage / 100) : totalAmount;
        
        // 更新顯示
        document.getElementById('editPricePerNight').textContent = `NT$ ${pricePerNight.toLocaleString()}`;
        document.getElementById('editNights').textContent = `${nights} 晚`;
        document.getElementById('editTotalAmount').textContent = `NT$ ${totalAmount.toLocaleString()}`;
        document.getElementById('editPaymentTypeLabel').textContent = `${isDeposit ? `應付訂金 (${depositPercentage}%)` : '應付全額'}：`;
        document.getElementById('editFinalAmount').textContent = `NT$ ${finalAmount.toLocaleString()}`;
    } else {
        // 如果日期無效，顯示預設值
        document.getElementById('editPricePerNight').textContent = `NT$ ${pricePerNight.toLocaleString()}`;
        document.getElementById('editNights').textContent = '0 晚';
        document.getElementById('editTotalAmount').textContent = 'NT$ 0';
        document.getElementById('editFinalAmount').textContent = 'NT$ 0';
    }
}

// 儲存編輯
async function saveBookingEdit(event, bookingId) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);
    
    // 計算價格
    const roomTypeSelect = document.getElementById('editRoomType');
    const checkInDate = document.getElementById('editCheckInDate');
    const checkOutDate = document.getElementById('editCheckOutDate');
    const paymentAmountType = document.getElementById('editPaymentAmountType');
    
    const selectedOption = roomTypeSelect.options[roomTypeSelect.selectedIndex];
    const pricePerNight = parseInt(selectedOption.dataset.price) || 2000;
    
    const checkIn = new Date(checkInDate.value);
    const checkOut = new Date(checkOutDate.value);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    const totalAmount = pricePerNight * nights;
    const isDeposit = paymentAmountType.value === 'deposit';
    const finalAmount = isDeposit ? totalAmount * 0.3 : totalAmount;
    
    // 設定付款金額文字
    const paymentAmount = isDeposit ? `訂金 NT$ ${finalAmount.toLocaleString()}` : `全額 NT$ ${finalAmount.toLocaleString()}`;
    
    // 加入計算出的價格資料（確保為整數類型）
    data.price_per_night = parseInt(pricePerNight);
    data.nights = parseInt(nights);
    data.total_amount = parseInt(totalAmount);
    data.final_amount = parseInt(finalAmount);
    data.payment_amount = paymentAmount;
    
    console.log('儲存編輯:', bookingId, data);
    console.log('計算出的價格資料:', {
        price_per_night: data.price_per_night,
        nights: data.nights,
        total_amount: data.total_amount,
        final_amount: data.final_amount
    });
    
    try {
        const response = await fetch(`/api/bookings/${bookingId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        console.log('儲存結果:', result);
        console.log('HTTP 狀態碼:', response.status);
        
        if (!response.ok) {
            // 如果 HTTP 狀態碼不是 2xx，顯示錯誤
            throw new Error(result.message || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        if (result.success) {
            console.log('✅ 訂房資料更新成功，開始重新載入列表...');
            closeModal();
            // 強制重新載入列表，確保顯示最新資料
            await loadBookings();
            console.log('✅ 列表重新載入完成');
        } else {
            showError('更新失敗：' + (result.message || '請稍後再試'));
        }
    } catch (error) {
        console.error('Error:', error);
        console.error('Error stack:', error.stack);
        showError('更新時發生錯誤：' + error.message);
    }
}

// 取消訂房
async function cancelBooking(bookingId) {
    if (!confirm('確定要取消這筆訂房嗎？此操作無法復原。')) {
        return;
    }
    
    console.log('取消訂房:', bookingId);
    
    try {
        const response = await fetch(`/api/bookings/${bookingId}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const result = await response.json();
        console.log('取消結果:', result);
        
        if (result.success) {
            alert('訂房已取消');
            loadBookings(); // 重新載入列表
        } else {
            showError('取消失敗：' + (result.message || '請稍後再試'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('取消時發生錯誤：' + error.message);
    }
}

// 刪除訂房（僅限已取消的訂房）
async function deleteBooking(bookingId) {
    if (!confirm('確定要刪除這筆訂房嗎？此操作無法復原。')) {
        return;
    }
    
    console.log('刪除訂房:', bookingId);
    
    try {
        const response = await fetch(`/api/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        // 檢查回應是否為 JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('伺服器返回非 JSON 回應:', text.substring(0, 200));
            showError('刪除失敗：伺服器回應格式錯誤');
            return;
        }
        
        const result = await response.json();
        console.log('刪除結果:', result);
        
        if (result.success) {
            alert('訂房已刪除');
            loadBookings(); // 重新載入列表
        } else {
            showError('刪除失敗：' + (result.message || '請稍後再試'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// HTML 轉義（防止 XSS）
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 房型管理 ====================

let allRoomTypes = [];

// 載入房型列表
async function loadRoomTypes() {
    try {
        const response = await fetch('/api/admin/room-types');
        const result = await response.json();
        
        if (result.success) {
            allRoomTypes = result.data || [];
            renderRoomTypes();
        } else {
            showError('載入房型列表失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入房型列表錯誤:', error);
        showError('載入房型列表時發生錯誤：' + error.message);
    }
}

// 篩選房型（根據狀態）
let showOnlyActive = true; // 預設只顯示啟用的房型

function toggleRoomTypeFilter() {
    showOnlyActive = !showOnlyActive;
    renderRoomTypes();
    // 更新按鈕文字
    const filterBtn = document.getElementById('roomTypeFilterBtn');
    if (filterBtn) {
        filterBtn.innerHTML = showOnlyActive 
            ? '<span>🔍</span> 只顯示啟用房型' 
            : '<span>📋</span> 顯示所有房型';
    }
}

// 渲染房型列表
function renderRoomTypes() {
    const tbody = document.getElementById('roomTypesTableBody');
    
    // 根據篩選條件過濾房型
    const filteredRoomTypes = showOnlyActive 
        ? allRoomTypes.filter(room => room.is_active === 1)
        : allRoomTypes;
    
    if (filteredRoomTypes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading">沒有房型資料</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredRoomTypes.map(room => `
        <tr ${room.is_active === 0 ? 'style="opacity: 0.6; background: #f8f8f8;"' : ''}>
            <td>${room.display_order || 0}</td>
            <td>${room.icon || '🏠'}</td>
            <td>${room.name}</td>
            <td>${room.display_name}</td>
            <td>${room.max_occupancy ?? 0}</td>
            <td>${room.extra_beds ?? 0}</td>
            <td>NT$ ${room.price.toLocaleString()}</td>
            <td>${room.holiday_surcharge ? (room.holiday_surcharge > 0 ? '+' : '') + 'NT$ ' + room.holiday_surcharge.toLocaleString() : 'NT$ 0'}</td>
            <td>
                <span class="status-badge ${room.is_active === 1 ? 'status-sent' : 'status-unsent'}">
                    ${room.is_active === 1 ? '啟用' : '停用'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-edit" onclick="editRoomType(${room.id})">編輯</button>
                    <button class="btn-cancel" onclick="deleteRoomType(${room.id})">刪除</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// 顯示新增房型模態框
function showAddRoomTypeModal() {
    showRoomTypeModal(null);
}

// 顯示編輯房型模態框
async function editRoomType(id) {
    try {
        const room = allRoomTypes.find(r => r.id === id);
        if (room) {
            showRoomTypeModal(room);
        } else {
            showError('找不到該房型');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入房型資料時發生錯誤：' + error.message);
    }
}

// 顯示房型編輯模態框
function showRoomTypeModal(room) {
    const modal = document.getElementById('bookingModal');
    const modalBody = document.getElementById('modalBody');
    const isEdit = room !== null;
    
    modalBody.innerHTML = `
        <form id="roomTypeForm" onsubmit="saveRoomType(event, ${isEdit ? room.id : 'null'})">
            <div class="form-group">
                <label>房型代碼（英文）</label>
                <input type="text" name="name" value="${isEdit ? escapeHtml(room.name) : ''}" required ${isEdit ? 'readonly' : ''}>
                <small>用於系統內部識別，建立後無法修改</small>
            </div>
            <div class="form-group">
                <label>顯示名稱</label>
                <input type="text" name="display_name" value="${isEdit ? escapeHtml(room.display_name) : ''}" required>
            </div>
            <div class="form-group">
                <label>入住人數</label>
                <input type="number" name="max_occupancy" value="${isEdit ? (room.max_occupancy ?? 0) : 0}" min="0" step="1" required>
                <small>此房型的建議入住人數</small>
            </div>
            <div class="form-group">
                <label>加床人數</label>
                <input type="number" name="extra_beds" value="${isEdit ? (room.extra_beds ?? 0) : 0}" min="0" step="1" required>
                <small>最多可加床人數</small>
            </div>
            <div class="form-group">
                <label>平日價格（每晚）</label>
                <input type="number" name="price" value="${isEdit ? room.price : ''}" min="0" step="1" required>
                <small>平日（週一至週五）的基礎價格</small>
            </div>
            <div class="form-group">
                <label>假日加價（每晚）</label>
                <input type="number" name="holiday_surcharge" value="${isEdit ? (room.holiday_surcharge || 0) : 0}" min="-999999" step="1">
                <small>假日（週六、週日及手動設定的假日）的加價金額。可為正數（加價）或負數（折扣），0 表示假日價格與平日相同</small>
            </div>
            <div class="form-group">
                <label>圖示（Emoji）</label>
                <input type="text" name="icon" value="${isEdit ? escapeHtml(room.icon) : '🏠'}" maxlength="10">
            </div>
            <div class="form-group">
                <label>顯示順序</label>
                <input type="number" name="display_order" value="${isEdit ? room.display_order : 0}" min="0" step="1">
            </div>
            <div class="form-group">
                <label>狀態</label>
                <select name="is_active" required>
                    <option value="1" ${isEdit && room.is_active === 1 ? 'selected' : ''}>啟用</option>
                    <option value="0" ${isEdit && room.is_active === 0 ? 'selected' : ''}>停用</option>
                </select>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-save">儲存</button>
                <button type="button" class="btn-cancel" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    
    modal.classList.add('active');
}

// 儲存房型
async function saveRoomType(event, id) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const data = {
        name: formData.get('name'),
        display_name: formData.get('display_name'),
        price: parseInt(formData.get('price')),
        holiday_surcharge: parseInt(formData.get('holiday_surcharge')) || 0,
        max_occupancy: parseInt(formData.get('max_occupancy')) || 0,
        extra_beds: parseInt(formData.get('extra_beds')) || 0,
        icon: formData.get('icon') || '🏠',
        display_order: parseInt(formData.get('display_order')) || 0,
        is_active: parseInt(formData.get('is_active'))
    };
    
    try {
        const url = id ? `/api/admin/room-types/${id}` : '/api/admin/room-types';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(id ? '房型已更新' : '房型已新增');
            closeModal();
            await loadRoomTypes();
        } else {
            showError('儲存失敗：' + (result.message || '請稍後再試'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 刪除房型
async function deleteRoomType(id) {
    if (!confirm('確定要永久刪除這個房型嗎？\n\n⚠️ 注意：\n- 此操作無法復原\n- 如果該房型有訂房記錄，將無法刪除\n- 刪除後將完全從資料庫中移除')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/room-types/${id}`, {
            method: 'DELETE'
        });
        
        // 檢查 HTTP 狀態碼
        if (!response.ok) {
            // 如果狀態碼不是 2xx，嘗試解析錯誤訊息
            let errorMessage = '刪除失敗';
            try {
                const errorResult = await response.json();
                errorMessage = errorResult.message || `HTTP ${response.status}: ${response.statusText}`;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            showError(errorMessage);
            return;
        }
        
        const result = await response.json();
        
        if (result.success) {
            alert('房型已刪除');
            await loadRoomTypes();
        } else {
            showError('刪除失敗：' + (result.message || '請稍後再試'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// ==================== 加購商品管理 ====================

let allAddons = [];
let showOnlyActiveAddons = true; // 預設只顯示啟用的加購商品

// 載入加購商品列表
async function loadAddons() {
    try {
        // 同時載入加購商品列表和前台啟用設定
        const [addonsResponse, settingsResponse] = await Promise.all([
            fetch('/api/admin/addons'),
            fetch('/api/settings')
        ]);
        
        const addonsResult = await addonsResponse.json();
        const settingsResult = await settingsResponse.json();
        
        if (addonsResult.success) {
            allAddons = addonsResult.data || [];
            renderAddons();
        } else {
            showError('載入加購商品列表失敗：' + (addonsResult.message || '未知錯誤'));
        }
        
        // 載入前台啟用設定
        if (settingsResult.success && settingsResult.data) {
            const enableAddons = settingsResult.data.enable_addons === '1' || settingsResult.data.enable_addons === 'true';
            const checkbox = document.getElementById('enableAddonsFrontend');
            if (checkbox) {
                checkbox.checked = enableAddons;
            }
        }
    } catch (error) {
        console.error('載入加購商品列表錯誤:', error);
        showError('載入加購商品列表時發生錯誤：' + error.message);
    }
}

// 切換前台加購商品啟用狀態
async function toggleAddonsFrontend(isEnabled) {
    try {
        const response = await fetch('/api/admin/settings/enable_addons', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                value: isEnabled ? '1' : '0',
                description: '啟用前台加購商品功能（1=啟用，0=停用）'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(isEnabled ? '前台加購商品功能已啟用' : '前台加購商品功能已停用');
        } else {
            showError(result.message || '更新失敗');
            // 恢復 checkbox 狀態
            const checkbox = document.getElementById('enableAddonsFrontend');
            if (checkbox) {
                checkbox.checked = !isEnabled;
            }
        }
    } catch (error) {
        console.error('切換前台加購商品啟用狀態錯誤:', error);
        showError('切換前台加購商品啟用狀態時發生錯誤：' + error.message);
        // 恢復 checkbox 狀態
        const checkbox = document.getElementById('enableAddonsFrontend');
        if (checkbox) {
            checkbox.checked = !isEnabled;
        }
    }
}

// 篩選加購商品（根據狀態）
function toggleAddonFilter() {
    showOnlyActiveAddons = !showOnlyActiveAddons;
    renderAddons();
    // 更新按鈕文字
    const filterBtn = document.getElementById('addonFilterBtn');
    if (filterBtn) {
        filterBtn.innerHTML = showOnlyActiveAddons 
            ? '<span>🔍</span> 只顯示啟用加購商品' 
            : '<span>📋</span> 顯示所有加購商品';
    }
}

// 渲染加購商品列表
function renderAddons() {
    const tbody = document.getElementById('addonsTableBody');
    if (!tbody) return;
    
    // 根據篩選條件過濾加購商品
    const filteredAddons = showOnlyActiveAddons 
        ? allAddons.filter(addon => addon.is_active === 1)
        : allAddons;
    
    if (filteredAddons.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">沒有加購商品資料</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredAddons.map(addon => `
        <tr ${addon.is_active === 0 ? 'style="opacity: 0.6; background: #f8f8f8;"' : ''}>
            <td>${addon.display_order || 0}</td>
            <td>${addon.icon || '➕'}</td>
            <td>${addon.name}</td>
            <td>${addon.display_name}</td>
            <td>NT$ ${addon.price.toLocaleString()}</td>
            <td>
                <span class="status-badge ${addon.is_active === 1 ? 'status-sent' : 'status-unsent'}">
                    ${addon.is_active === 1 ? '啟用' : '停用'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-edit" onclick="editAddon(${addon.id})">編輯</button>
                    <button class="btn-cancel" onclick="deleteAddon(${addon.id})">刪除</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// 顯示新增加購商品模態框
function showAddAddonModal() {
    showAddonModal(null);
}

// 顯示編輯加購商品模態框
async function editAddon(id) {
    try {
        const addon = allAddons.find(a => a.id === id);
        if (addon) {
            showAddonModal(addon);
        } else {
            showError('找不到該加購商品');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入加購商品資料時發生錯誤：' + error.message);
    }
}

// 顯示加購商品編輯模態框
function showAddonModal(addon) {
    const modal = document.getElementById('bookingModal');
    const modalBody = document.getElementById('modalBody');
    const isEdit = addon !== null;
    
    modalBody.innerHTML = `
        <form id="addonForm" onsubmit="saveAddon(event, ${isEdit ? addon.id : 'null'})">
            <div class="form-group">
                <label>商品代碼（英文）</label>
                <input type="text" name="name" value="${isEdit ? escapeHtml(addon.name) : ''}" required ${isEdit ? 'readonly' : ''}>
                <small>用於系統內部識別，建立後無法修改</small>
            </div>
            <div class="form-group">
                <label>顯示名稱</label>
                <input type="text" name="display_name" value="${isEdit ? escapeHtml(addon.display_name) : ''}" required>
            </div>
            <div class="form-group">
                <label>價格</label>
                <input type="number" name="price" value="${isEdit ? addon.price : ''}" min="0" step="1" required>
                <small>加購商品的單價</small>
            </div>
            <div class="form-group">
                <label>圖示（Emoji）</label>
                <input type="text" name="icon" value="${isEdit ? escapeHtml(addon.icon) : '➕'}" maxlength="10">
            </div>
            <div class="form-group">
                <label>顯示順序</label>
                <input type="number" name="display_order" value="${isEdit ? addon.display_order : 0}" min="0" step="1">
            </div>
            <div class="form-group">
                <label>狀態</label>
                <select name="is_active" required>
                    <option value="1" ${isEdit && addon.is_active === 1 ? 'selected' : ''}>啟用</option>
                    <option value="0" ${isEdit && addon.is_active === 0 ? 'selected' : ''}>停用</option>
                </select>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-save">儲存</button>
                <button type="button" class="btn-cancel" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    
    modal.classList.add('active');
}

// 儲存加購商品
async function saveAddon(event, id) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const data = {
        name: formData.get('name'),
        display_name: formData.get('display_name'),
        price: parseInt(formData.get('price')),
        icon: formData.get('icon') || '➕',
        display_order: parseInt(formData.get('display_order')) || 0,
        is_active: parseInt(formData.get('is_active'))
    };
    
    try {
        const url = id ? `/api/admin/addons/${id}` : '/api/admin/addons';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            loadAddons();
            showSuccess(id ? '加購商品已更新' : '加購商品已新增');
        } else {
            showError(result.message || '儲存失敗');
        }
    } catch (error) {
        console.error('儲存加購商品錯誤:', error);
        showError('儲存加購商品時發生錯誤：' + error.message);
    }
}

// 切換加購商品啟用狀態
async function toggleAddonStatus(id, isActive) {
    try {
        const addon = allAddons.find(a => a.id === id);
        if (!addon) {
            showError('找不到該加購商品');
            return;
        }
        
        const data = {
            display_name: addon.display_name,
            price: addon.price,
            icon: addon.icon || '➕',
            display_order: addon.display_order || 0,
            is_active: isActive ? 1 : 0
        };
        
        const response = await fetch(`/api/admin/addons/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadAddons();
            showSuccess(isActive ? '加購商品已啟用' : '加購商品已停用');
        } else {
            showError(result.message || '更新失敗');
            // 恢復 checkbox 狀態
            loadAddons(); // 重新載入以恢復正確狀態
        }
    } catch (error) {
        console.error('切換加購商品狀態錯誤:', error);
        showError('切換加購商品狀態時發生錯誤：' + error.message);
        // 恢復 checkbox 狀態
        loadAddons(); // 重新載入以恢復正確狀態
    }
}

// 刪除加購商品
async function deleteAddon(id) {
    if (!confirm('確定要刪除這個加購商品嗎？此操作無法復原。')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/addons/${id}`, {
            method: 'DELETE'
        });
        
        // 檢查 HTTP 狀態碼
        if (!response.ok) {
            // 如果狀態碼不是 2xx，嘗試解析錯誤訊息
            let errorMessage = '刪除失敗';
            try {
                const errorResult = await response.json();
                errorMessage = errorResult.message || `HTTP ${response.status}: ${response.statusText}`;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            showError(errorMessage);
            return;
        }
        
        const result = await response.json();
        
        if (result.success) {
            loadAddons();
            showSuccess('加購商品已刪除');
        } else {
            showError(result.message || '刪除失敗');
        }
    } catch (error) {
        console.error('刪除加購商品錯誤:', error);
        showError('刪除加購商品時發生錯誤：' + error.message);
    }
}

// ==================== 系統設定 ====================

// 載入系統設定
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const result = await response.json();
        
        if (result.success) {
            const settings = result.data;
            document.getElementById('depositPercentage').value = settings.deposit_percentage || '30';
            document.getElementById('bankName').value = settings.bank_name || '';
            document.getElementById('bankBranch').value = settings.bank_branch || '';
            document.getElementById('bankAccount').value = settings.bank_account || '';
            document.getElementById('accountName').value = settings.account_name || '';
            
            // 付款方式啟用狀態
            document.getElementById('enableTransfer').checked = settings.enable_transfer === '1' || settings.enable_transfer === 'true';
            document.getElementById('enableCard').checked = settings.enable_card === '1' || settings.enable_card === 'true';
            
            // 綠界設定
            document.getElementById('ecpayMerchantID').value = settings.ecpay_merchant_id || '';
            document.getElementById('ecpayHashKey').value = settings.ecpay_hash_key || '';
            document.getElementById('ecpayHashIV').value = settings.ecpay_hash_iv || '';
            
            // 旅館資訊
            document.getElementById('hotelName').value = settings.hotel_name || '';
            document.getElementById('hotelPhone').value = settings.hotel_phone || '';
            document.getElementById('hotelAddress').value = settings.hotel_address || '';
            document.getElementById('hotelEmail').value = settings.hotel_email || '';
        } else {
            showError('載入設定失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入設定錯誤:', error);
        showError('載入設定時發生錯誤：' + error.message);
    }
}

// 儲存系統設定
async function saveSettings() {
    const depositPercentage = document.getElementById('depositPercentage').value;
    const bankName = document.getElementById('bankName').value;
    const bankBranch = document.getElementById('bankBranch').value;
    const bankAccount = document.getElementById('bankAccount').value;
    const accountName = document.getElementById('accountName').value;
    const enableTransfer = document.getElementById('enableTransfer').checked ? '1' : '0';
    const enableCard = document.getElementById('enableCard').checked ? '1' : '0';
    const ecpayMerchantID = document.getElementById('ecpayMerchantID').value;
    const ecpayHashKey = document.getElementById('ecpayHashKey').value;
    const ecpayHashIV = document.getElementById('ecpayHashIV').value;
    const hotelName = document.getElementById('hotelName').value;
    const hotelPhone = document.getElementById('hotelPhone').value;
    const hotelAddress = document.getElementById('hotelAddress').value;
    const hotelEmail = document.getElementById('hotelEmail').value;
    
    if (!depositPercentage || depositPercentage < 0 || depositPercentage > 100) {
        showError('請輸入有效的訂金百分比（0-100）');
        return;
    }
    
    // 驗證：如果啟用線上刷卡，必須填寫綠界設定
    if (enableCard === '1' && (!ecpayMerchantID || !ecpayHashKey || !ecpayHashIV)) {
        showError('啟用線上刷卡時，必須填寫完整的綠界串接碼（MerchantID、HashKey、HashIV）');
        return;
    }
    
    try {
        // 同時儲存所有設定
        const [
            depositResponse, bankNameResponse, bankBranchResponse, bankAccountResponse, accountNameResponse,
            enableTransferResponse, enableCardResponse,
            ecpayMerchantIDResponse, ecpayHashKeyResponse, ecpayHashIVResponse,
            hotelNameResponse, hotelPhoneResponse, hotelAddressResponse, hotelEmailResponse
        ] = await Promise.all([
            fetch('/api/admin/settings/deposit_percentage', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: depositPercentage,
                    description: '訂金百分比（例如：30 表示 30%）'
                })
            }),
            fetch('/api/admin/settings/bank_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankName,
                    description: '銀行名稱（顯示在匯款轉帳確認郵件中）'
                })
            }),
            fetch('/api/admin/settings/bank_branch', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankBranch,
                    description: '分行名稱（顯示在匯款轉帳確認郵件中）'
                })
            }),
            fetch('/api/admin/settings/bank_account', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankAccount,
                    description: '匯款帳號（顯示在匯款轉帳確認郵件中）'
                })
            }),
            fetch('/api/admin/settings/account_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: accountName,
                    description: '帳戶戶名（顯示在匯款轉帳確認郵件中）'
                })
            }),
            fetch('/api/admin/settings/enable_transfer', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: enableTransfer,
                    description: '啟用匯款轉帳（1=啟用，0=停用）'
                })
            }),
            fetch('/api/admin/settings/enable_card', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: enableCard,
                    description: '啟用線上刷卡（1=啟用，0=停用）'
                })
            }),
            fetch('/api/admin/settings/ecpay_merchant_id', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayMerchantID,
                    description: '綠界商店代號（MerchantID）'
                })
            }),
            fetch('/api/admin/settings/ecpay_hash_key', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayHashKey,
                    description: '綠界金鑰（HashKey）'
                })
            }),
            fetch('/api/admin/settings/ecpay_hash_iv', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayHashIV,
                    description: '綠界向量（HashIV）'
                })
            }),
            fetch('/api/admin/settings/hotel_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelName,
                    description: '旅館名稱（顯示在郵件最下面）'
                })
            }),
            fetch('/api/admin/settings/hotel_phone', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelPhone,
                    description: '旅館電話（顯示在郵件最下面）'
                })
            }),
            fetch('/api/admin/settings/hotel_address', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelAddress,
                    description: '旅館地址（顯示在郵件最下面）'
                })
            }),
            fetch('/api/admin/settings/hotel_email', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelEmail,
                    description: '旅館信箱（顯示在郵件最下面）'
                })
            })
        ]);
        
        const results = await Promise.all([
            depositResponse.json(),
            bankNameResponse.json(),
            bankBranchResponse.json(),
            bankAccountResponse.json(),
            accountNameResponse.json(),
            enableTransferResponse.json(),
            enableCardResponse.json(),
            ecpayMerchantIDResponse.json(),
            ecpayHashKeyResponse.json(),
            ecpayHashIVResponse.json(),
            hotelNameResponse.json(),
            hotelPhoneResponse.json(),
            hotelAddressResponse.json(),
            hotelEmailResponse.json()
        ]);
        
        const allSuccess = results.every(r => r.success);
        
        if (allSuccess) {
            alert('設定已儲存');
        } else {
            const errorMsg = results.find(r => !r.success)?.message || '請稍後再試';
            showError('儲存失敗：' + errorMsg);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 載入郵件模板列表
async function loadEmailTemplates() {
    try {
        console.log('開始載入郵件模板...');
        const response = await fetch('/api/email-templates');
        console.log('API 回應狀態:', response.status);
        
        const result = await response.json();
        console.log('API 回應結果:', result);
        
        if (result.success) {
            const templates = result.data || [];
            console.log('找到模板數量:', templates.length);
            templates.forEach((t, i) => {
                console.log(`模板 ${i + 1}: ${t.template_name} (${t.template_key}), 內容長度: ${t.content ? t.content.length : 0}`);
            });
            renderEmailTemplates(templates);
        } else {
            console.error('API 返回失敗:', result.message);
            showError('載入郵件模板時發生錯誤：' + (result.message || '未知錯誤'));
            document.getElementById('emailTemplatesList').innerHTML = '<div class="loading">載入失敗</div>';
        }
    } catch (error) {
        console.error('載入郵件模板時發生錯誤:', error);
        showError('載入郵件模板時發生錯誤：' + error.message);
        document.getElementById('emailTemplatesList').innerHTML = '<div class="loading">載入失敗</div>';
    }
}

// 渲染郵件模板列表
function renderEmailTemplates(templates) {
    const container = document.getElementById('emailTemplatesList');
    
    if (templates.length === 0) {
        container.innerHTML = '<div class="loading">沒有郵件模板</div>';
        return;
    }
    
    const templateNames = {
        'payment_reminder': '匯款提醒',
        'checkin_reminder': '入住提醒',
        'feedback_request': '感謝入住'
    };
    
    container.innerHTML = templates.map(template => `
        <div class="template-card" style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                <div>
                    <h3 style="margin: 0 0 5px 0; color: #333;">${template.template_name || templateNames[template.template_key] || template.template_key}</h3>
                    <p style="margin: 0; color: #666; font-size: 14px;">模板代碼：${template.template_key}</p>
                </div>
                <div>
                    <span class="status-badge ${template.is_enabled === 1 ? 'status-sent' : 'status-unsent'}" style="margin-right: 10px;">
                        ${template.is_enabled === 1 ? '啟用' : '停用'}
                    </span>
                    <button class="btn-edit" onclick="showEmailTemplateModal('${template.template_key}')">編輯</button>
                </div>
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 15px;">
                <div style="margin-bottom: 10px;">
                    <strong style="color: #666;">主旨：</strong>
                    <span style="color: #333;">${escapeHtml(template.subject)}</span>
                </div>
                <div style="max-height: 150px; overflow-y: auto; background: #f8f8f8; padding: 10px; border-radius: 4px; font-size: 12px; color: #666;">
                    ${escapeHtml(template.content).substring(0, 500)}${template.content.length > 500 ? '...' : ''}
                </div>
            </div>
        </div>
    `).join('');
}

// 顯示郵件模板編輯模態框
async function showEmailTemplateModal(templateKey) {
    try {
        console.log('📧 載入郵件模板:', templateKey);
        const response = await fetch(`/api/email-templates/${templateKey}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('📧 模板載入回應:', result);
        
        if (result.success) {
            const template = result.data;
            console.log('📧 模板資料:', {
                template_key: template.template_key,
                template_name: template.template_name,
                content_length: template.content ? template.content.length : 0,
                days_reserved: template.days_reserved,
                send_hour_payment_reminder: template.send_hour_payment_reminder,
                days_before_checkin: template.days_before_checkin,
                send_hour_checkin: template.send_hour_checkin,
                days_after_checkout: template.days_after_checkout,
                send_hour_feedback: template.send_hour_feedback
            });
            console.log('📧 完整模板物件:', template);
            const modal = document.getElementById('emailTemplateModal');
            const title = document.getElementById('emailTemplateModalTitle');
            const form = document.getElementById('emailTemplateForm');
            const editorContainer = document.getElementById('emailTemplateEditor');
            const textarea = document.getElementById('emailTemplateContent');
            
            title.textContent = `編輯郵件模板：${template.template_name || templateKey}`;
            document.getElementById('emailTemplateName').value = template.template_name || '';
            document.getElementById('emailTemplateSubject').value = template.subject || '';
            document.getElementById('emailTemplateEnabled').checked = template.is_enabled === 1;
            
            // 根據模板類型顯示/隱藏設定欄位
            const checkinSettings = document.getElementById('checkinReminderSettings');
            const feedbackSettings = document.getElementById('feedbackRequestSettings');
            const paymentSettings = document.getElementById('paymentReminderSettings');
            
            // 隱藏所有設定欄位
            if (checkinSettings) checkinSettings.style.display = 'none';
            if (feedbackSettings) feedbackSettings.style.display = 'none';
            if (paymentSettings) paymentSettings.style.display = 'none';
            
            // 根據模板類型顯示對應的設定欄位
            if (templateKey === 'checkin_reminder') {
                if (checkinSettings) {
                    checkinSettings.style.display = 'block';
                    document.getElementById('daysBeforeCheckin').value = template.days_before_checkin || 1;
                    document.getElementById('sendHourCheckin').value = template.send_hour_checkin || 9;
                }
            } else if (templateKey === 'feedback_request') {
                if (feedbackSettings) {
                    feedbackSettings.style.display = 'block';
                    document.getElementById('daysAfterCheckout').value = template.days_after_checkout || 1;
                    document.getElementById('sendHourFeedback').value = template.send_hour_feedback || 10;
                }
            } else if (templateKey === 'payment_reminder') {
                if (paymentSettings) {
                    paymentSettings.style.display = 'block';
                    const daysReservedValue = template.days_reserved !== null && template.days_reserved !== undefined ? template.days_reserved : 3;
                    const sendHourValue = template.send_hour_payment_reminder !== null && template.send_hour_payment_reminder !== undefined ? template.send_hour_payment_reminder : 9;
                    console.log('📧 載入匯款提醒設定值:', { 
                        days_reserved: template.days_reserved, 
                        send_hour_payment_reminder: template.send_hour_payment_reminder,
                        daysReservedValue,
                        sendHourValue
                    });
                    document.getElementById('daysReserved').value = daysReservedValue;
                    document.getElementById('sendHourPaymentReminder').value = sendHourValue;
                }
            }
            
            // 初始化 Quill 編輯器（如果還沒有）
            if (!quillEditor) {
                // 自定義 Clipboard 模組，允許更多 HTML 標籤
                const Block = Quill.import('blots/block');
                const Inline = Quill.import('blots/inline');
                
                // 註冊自定義標籤（允許 div、span 等）
                class DivBlot extends Block {
                    static tagName = 'div';
                }
                Quill.register(DivBlot);
                
                quillEditor = new Quill('#emailTemplateEditor', {
                    theme: 'snow',
                    modules: {
                        toolbar: [
                            [{ 'header': [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline', 'strike'],
                            [{ 'color': [] }, { 'background': [] }],
                            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                            [{ 'align': [] }],
                            ['link', 'image'],
                            ['clean']
                        ],
                        clipboard: {
                            // 允許更多 HTML 標籤和屬性
                            matchVisual: false,
                            // 保留所有 class 和 style 屬性
                            preserveWhitespace: true
                        }
                    },
                    placeholder: '開始編輯郵件內容...',
                    // 允許更多 HTML 標籤
                    formats: ['bold', 'italic', 'underline', 'strike', 'color', 'background', 
                             'header', 'list', 'align', 'link', 'image', 'blockquote', 'code-block']
                });
                
                // 自定義 Quill 的 HTML 處理，保留所有 class 和 style
                const originalPasteHTML = quillEditor.clipboard.convert;
                quillEditor.clipboard.convert = function(html) {
                    // 保留原始 HTML 結構，不進行轉換
                    const delta = originalPasteHTML.call(this, html);
                    return delta;
                };
            }
            
            // 將 HTML 內容載入到 Quill 編輯器
            // 需要先提取 body 內容（因為模板可能包含完整的 HTML 結構）
            let htmlContent = template.content || '';
            
            console.log('載入模板內容，原始長度:', htmlContent.length);
            
            // 如果是完整的 HTML 文檔，提取 body 內容
            if (htmlContent.includes('<body>')) {
                const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch) {
                    htmlContent = bodyMatch[1];
                    console.log('提取 body 內容後，長度:', htmlContent.length);
                }
            }
            
            // 確保 Quill 編輯器已初始化
            if (!quillEditor) {
                console.error('Quill 編輯器未初始化');
                showError('編輯器初始化失敗，請重新整理頁面');
                return;
            }
            
            // 先更新 textarea（用於儲存和作為備份）
            textarea.value = template.content || '';
            
            // 先顯示模態框
            modal.classList.add('active');
            
            // 預設使用可視化模式（用戶要求）
            isHtmlMode = false;
            editorContainer.style.display = 'block';
            textarea.style.display = 'none';
            const toggleBtn = document.getElementById('toggleEditorModeBtn');
            if (toggleBtn) {
                toggleBtn.textContent = '切換到 HTML 模式';
                toggleBtn.onclick = toggleEditorMode;
            }
            
            // 先設置 textarea（作為備份）
            textarea.value = template.content || '';
            
            // 使用 setTimeout 確保模態框完全顯示後再載入內容
            setTimeout(() => {
                try {
                    console.log('開始載入內容到編輯器');
                    console.log('要載入的 HTML 內容長度:', htmlContent.length);
                    
                    // 如果內容為空，直接返回
                    if (!htmlContent || htmlContent.trim() === '') {
                        console.log('⚠️ 內容為空，跳過載入');
                        quillEditor.setText('郵件內容為空，請編輯內容...');
                        return;
                    }
                    
                    // 先清空編輯器
                    quillEditor.setText('');
                    
                    // 方法：使用 Quill 的標準方法載入內容（傳統模式）
                    try {
                        // 先清空編輯器
                        quillEditor.setText('');
                        
                        // 使用 dangerouslyPasteHTML 方法載入內容
                        quillEditor.clipboard.dangerouslyPasteHTML(0, htmlContent);
                        console.log('✅ 內容已載入到編輯器');
                    } catch (error) {
                        console.error('❌ 載入內容時發生錯誤:', error);
                        // Fallback: 直接設置 innerHTML
                        quillEditor.root.innerHTML = htmlContent;
                    }
                } catch (error) {
                    console.error('❌ 載入內容到 Quill 時發生錯誤:', error);
                    // 最後的 fallback - 直接設置並忽略錯誤
                    try {
                        quillEditor.root.innerHTML = htmlContent;
                        console.log('✅ 使用 fallback 方法（直接設置 innerHTML）');
                    } catch (fallbackError) {
                        console.error('❌ 所有載入方法都失敗:', fallbackError);
                    }
                }
            }, 500);
            
            // 儲存 templateKey 以便儲存時使用
            form.dataset.templateKey = templateKey;
        } else {
            showError('載入郵件模板時發生錯誤：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入郵件模板時發生錯誤：' + error.message);
    }
}

// 儲存郵件模板
async function saveEmailTemplate(event) {
    event.preventDefault();
    
    const form = event.target;
    const templateKey = form.dataset.templateKey;
    
    if (!templateKey) {
        showError('找不到模板代碼');
        return;
    }
    
    // 根據當前模式獲取內容
    let content = '';
    if (isHtmlMode) {
        // HTML 模式：直接從 textarea 獲取
        content = document.getElementById('emailTemplateContent').value;
    } else {
        // 可視化模式：從 Quill 獲取 HTML，然後包裝成完整的 HTML 文檔
        const quillHtml = quillEditor.root.innerHTML;
        
        // 獲取原始完整內容（用於保留 HTML 結構）
        const originalContent = document.getElementById('emailTemplateContent').value;
        
        console.log('儲存時 - Quill HTML 長度:', quillHtml.length);
        console.log('儲存時 - 原始內容長度:', originalContent.length);
        
        // 檢查原始內容是否包含完整的 HTML 結構
        if (originalContent && (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html'))) {
            // 如果原始內容是完整 HTML，替換 body 內容
            if (originalContent.includes('<body>')) {
                // 使用更精確的正則表達式來替換 body 內容
                content = originalContent.replace(
                    /<body[^>]*>[\s\S]*?<\/body>/i,
                    `<body>${quillHtml}</body>`
                );
                console.log('使用原始 HTML 結構，替換 body 內容');
            } else if (originalContent.includes('<html')) {
                // 如果有 html 標籤但沒有 body，在 html 標籤內添加 body
                content = originalContent.replace(
                    /<html[^>]*>([\s\S]*?)<\/html>/i,
                    (match, innerContent) => {
                        if (innerContent.includes('<body>')) {
                            return match.replace(/<body[^>]*>[\s\S]*?<\/body>/i, `<body>${quillHtml}</body>`);
                        } else {
                            return `<html${match.match(/<html([^>]*)>/)?.[1] || ''}>${innerContent}<body>${quillHtml}</body></html>`;
                        }
                    }
                );
                console.log('在 HTML 標籤內添加 body');
            } else {
                // 如果沒有 body，創建完整的 HTML 結構
                content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
    </style>
</head>
<body>
${quillHtml}
</body>
</html>`;
                console.log('創建新的完整 HTML 結構');
            }
        } else {
            // 如果原始內容不是完整 HTML，創建新的完整 HTML
            content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
    </style>
</head>
<body>
${quillHtml}
</body>
</html>`;
            console.log('原始內容不是完整 HTML，創建新結構');
        }
        
        console.log('最終儲存內容長度:', content.length);
    }
    
    const data = {
        template_name: document.getElementById('emailTemplateName').value,
        subject: document.getElementById('emailTemplateSubject').value,
        content: content,
        is_enabled: document.getElementById('emailTemplateEnabled').checked ? 1 : 0
    };
    
    // 根據模板類型添加對應的設定值
    console.log('🔍 檢查模板類型:', templateKey);
    console.log('🔍 當前 data 物件:', data);
    
    if (templateKey === 'checkin_reminder') {
        const daysBeforeCheckinEl = document.getElementById('daysBeforeCheckin');
        const sendHourCheckinEl = document.getElementById('sendHourCheckin');
        console.log('🔍 入住提醒元素:', { 
            daysBeforeCheckinEl: daysBeforeCheckinEl ? '找到' : '未找到',
            sendHourCheckinEl: sendHourCheckinEl ? '找到' : '未找到',
            daysBeforeCheckinValue: daysBeforeCheckinEl ? daysBeforeCheckinEl.value : 'N/A',
            sendHourCheckinValue: sendHourCheckinEl ? sendHourCheckinEl.value : 'N/A'
        });
        if (daysBeforeCheckinEl && sendHourCheckinEl) {
            data.days_before_checkin = parseInt(daysBeforeCheckinEl.value) || 1;
            data.send_hour_checkin = parseInt(sendHourCheckinEl.value) || 9;
            console.log('✅ 已添加入住提醒設定:', { days_before_checkin: data.days_before_checkin, send_hour_checkin: data.send_hour_checkin });
        }
    } else if (templateKey === 'feedback_request') {
        const daysAfterCheckoutEl = document.getElementById('daysAfterCheckout');
        const sendHourFeedbackEl = document.getElementById('sendHourFeedback');
        console.log('🔍 感謝入住元素:', { 
            daysAfterCheckoutEl: daysAfterCheckoutEl ? '找到' : '未找到',
            sendHourFeedbackEl: sendHourFeedbackEl ? '找到' : '未找到',
            daysAfterCheckoutValue: daysAfterCheckoutEl ? daysAfterCheckoutEl.value : 'N/A',
            sendHourFeedbackValue: sendHourFeedbackEl ? sendHourFeedbackEl.value : 'N/A'
        });
        if (daysAfterCheckoutEl && sendHourFeedbackEl) {
            data.days_after_checkout = parseInt(daysAfterCheckoutEl.value) || 1;
            data.send_hour_feedback = parseInt(sendHourFeedbackEl.value) || 10;
            console.log('✅ 已添加感謝入住設定:', { days_after_checkout: data.days_after_checkout, send_hour_feedback: data.send_hour_feedback });
        }
    } else if (templateKey === 'payment_reminder') {
        const daysReservedEl = document.getElementById('daysReserved');
        const sendHourPaymentReminderEl = document.getElementById('sendHourPaymentReminder');
        console.log('🔍 匯款提醒元素檢查:', { 
            daysReservedEl: daysReservedEl ? '✅ 找到' : '❌ 未找到',
            sendHourPaymentReminderEl: sendHourPaymentReminderEl ? '✅ 找到' : '❌ 未找到',
            daysReservedValue: daysReservedEl ? daysReservedEl.value : 'N/A',
            sendHourPaymentReminderValue: sendHourPaymentReminderEl ? sendHourPaymentReminderEl.value : 'N/A'
        });
        if (daysReservedEl && sendHourPaymentReminderEl) {
            const daysReservedValue = daysReservedEl.value;
            const sendHourValue = sendHourPaymentReminderEl.value;
            console.log('🔍 原始輸入值:', { daysReservedValue, sendHourValue });
            data.days_reserved = parseInt(daysReservedValue) || 3;
            data.send_hour_payment_reminder = parseInt(sendHourValue) || 9;
            console.log('✅ 已添加匯款提醒設定:', { 
                days_reserved: data.days_reserved, 
                send_hour_payment_reminder: data.send_hour_payment_reminder 
            });
        } else {
            console.error('❌ 找不到匯款提醒設定元素！');
            console.error('   嘗試查找的元素 ID: daysReserved, sendHourPaymentReminder');
            console.error('   當前頁面中的所有 input 元素:', Array.from(document.querySelectorAll('input')).map(el => el.id));
        }
    } else {
        console.warn('⚠️ 未知的模板類型:', templateKey);
    }
    
    console.log('🔍 添加設定後的 data 物件:', data);
    
    try {
        console.log('準備儲存模板:', templateKey);
        console.log('儲存資料:', {
            template_name: data.template_name,
            subject: data.subject,
            content_length: data.content.length,
            is_enabled: data.is_enabled,
            days_before_checkin: data.days_before_checkin,
            send_hour_checkin: data.send_hour_checkin,
            days_after_checkout: data.days_after_checkout,
            send_hour_feedback: data.send_hour_feedback,
            days_reserved: data.days_reserved,
            send_hour_payment_reminder: data.send_hour_payment_reminder
        });
        console.log('完整資料物件:', data);
        
        const response = await fetch(`/api/email-templates/${templateKey}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        console.log('儲存回應:', result);
        
        if (result.success) {
            console.log('✅ 儲存成功，開始重新載入模板列表...');
            alert('郵件模板已儲存');
            closeEmailTemplateModal();
            // 重新載入模板列表以確保顯示最新內容
            await loadEmailTemplates();
            console.log('✅ 模板列表重新載入完成');
        } else {
            console.error('❌ 儲存失敗:', result);
            showError('儲存失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('儲存時發生錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 發送測試郵件
async function sendTestEmail() {
    const testEmailInput = document.getElementById('testEmailAddress');
    const testEmailBtn = document.getElementById('sendTestEmailBtn');
    const testEmailStatus = document.getElementById('testEmailStatus');
    const form = document.getElementById('emailTemplateForm');
    const templateKey = form.dataset.templateKey;
    
    if (!templateKey) {
        showError('找不到模板代碼');
        return;
    }
    
    const email = testEmailInput.value.trim();
    if (!email) {
        testEmailStatus.style.display = 'block';
        testEmailStatus.style.color = '#e74c3c';
        testEmailStatus.textContent = '請輸入 Email 地址';
        return;
    }
    
    // 簡單的 Email 格式驗證
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        testEmailStatus.style.display = 'block';
        testEmailStatus.style.color = '#e74c3c';
        testEmailStatus.textContent = '請輸入有效的 Email 地址';
        return;
    }
    
    // 禁用按鈕並顯示載入狀態
    testEmailBtn.disabled = true;
    testEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">hourglass_empty</span>發送中...';
    testEmailStatus.style.display = 'none';
    
    try {
        // 獲取當前模板內容（與儲存邏輯相同，保留完整的 HTML 結構）
        let content = '';
        if (isHtmlMode) {
            content = document.getElementById('emailTemplateContent').value;
        } else {
            const quillHtml = quillEditor.root.innerHTML;
            const originalContent = document.getElementById('emailTemplateContent').value;
            
            // 使用與儲存邏輯相同的方法，確保保留完整的 HTML 結構和 CSS
            if (originalContent && (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html'))) {
                if (originalContent.includes('<body>')) {
                    // 保留完整的 HTML 結構，只替換 body 內容
                    content = originalContent.replace(
                        /<body[^>]*>[\s\S]*?<\/body>/i,
                        `<body>${quillHtml}</body>`
                    );
                } else if (originalContent.includes('<html')) {
                    content = originalContent.replace(
                        /<html[^>]*>([\s\S]*?)<\/html>/i,
                        (match, innerContent) => {
                            if (innerContent.includes('<body>')) {
                                return match.replace(/<body[^>]*>[\s\S]*?<\/body>/i, `<body>${quillHtml}</body>`);
                            } else {
                                return `<html${match.match(/<html([^>]*)>/)?.[1] || ''}>${innerContent}<body>${quillHtml}</body></html>`;
                            }
                        }
                    );
                } else {
                    // 如果沒有完整的結構，使用原始內容的結構
                    content = originalContent.replace(/<body[^>]*>[\s\S]*?<\/body>/i, `<body>${quillHtml}</body>`);
                }
            } else {
                // 如果沒有原始內容，使用資料庫中的內容
                try {
                    const templateResponse = await fetch(`/api/email-templates/${templateKey}`);
                    const templateResult = await templateResponse.json();
                    if (templateResult.success && templateResult.data) {
                        const templateContent = templateResult.data.content;
                        if (templateContent && templateContent.includes('<body>')) {
                            content = templateContent.replace(
                                /<body[^>]*>[\s\S]*?<\/body>/i,
                                `<body>${quillHtml}</body>`
                            );
                        } else {
                            content = templateContent;
                        }
                    } else {
                        // Fallback: 創建基本結構
                        content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
    </style>
</head>
<body>
${quillHtml}
</body>
</html>`;
                    }
                } catch (e) {
                    console.error('獲取模板內容失敗:', e);
                    content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
    </style>
</head>
<body>
${quillHtml}
</body>
</html>`;
                }
            }
        }
        
        const subject = document.getElementById('emailTemplateSubject').value;
        
        // 使用編輯器中的內容（用戶修改後的內容），但保留完整的 HTML 結構
        const response = await fetch(`/api/email-templates/${templateKey}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                useEditorContent: true,  // 使用編輯器中的內容
                subject: subject,
                content: content
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            testEmailStatus.style.display = 'block';
            testEmailStatus.style.color = '#27ae60';
            testEmailStatus.textContent = '✅ 測試郵件已成功發送！請檢查收件箱。';
            testEmailInput.value = ''; // 清空輸入框
        } else {
            testEmailStatus.style.display = 'block';
            testEmailStatus.style.color = '#e74c3c';
            testEmailStatus.textContent = '❌ 發送失敗：' + (result.message || '未知錯誤');
        }
    } catch (error) {
        console.error('發送測試郵件時發生錯誤:', error);
        testEmailStatus.style.display = 'block';
        testEmailStatus.style.color = '#e74c3c';
        testEmailStatus.textContent = '❌ 發送失敗：' + error.message;
    } finally {
        // 恢復按鈕狀態
        testEmailBtn.disabled = false;
        testEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">send</span>發送測試郵件';
    }
}

// 重置郵件模板為預設圖卡樣式
async function resetEmailTemplatesToDefault() {
    if (!confirm('確定要將所有郵件模板重置為預設的圖卡樣式嗎？此操作將覆蓋所有現有的模板內容。')) {
        return;
    }
    
    try {
        // 檢查是否有打開的編輯模態框
        const modal = document.getElementById('emailTemplateModal');
        const form = document.getElementById('emailTemplateForm');
        const templateKey = form ? form.dataset.templateKey : null;
        const isModalOpen = modal && modal.classList.contains('active');
        
        const response = await fetch('/api/email-templates/reset-to-default', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ 所有郵件模板已成功重置為預設圖卡樣式！');
            
            // 如果模態框是打開的，重新載入當前模板內容
            if (isModalOpen && templateKey) {
                await showEmailTemplateModal(templateKey);
            }
            
            // 重新載入模板列表
            await loadEmailTemplates();
        } else {
            showError('重置失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('重置郵件模板錯誤:', error);
        showError('重置失敗：' + error.message);
    }
}

// 切換編輯模式（可視化 / HTML）
function toggleEditorMode() {
    const editorContainer = document.getElementById('emailTemplateEditor');
    const textarea = document.getElementById('emailTemplateContent');
    const toggleBtn = document.getElementById('toggleEditorModeBtn');
    
    if (!editorContainer || !textarea || !toggleBtn) {
        console.error('找不到必要的 DOM 元素');
        return;
    }
    
    if (isHtmlMode) {
        // 從 HTML 模式切換到可視化模式
        isHtmlMode = false;
        editorContainer.style.display = 'block';
        textarea.style.display = 'none';
        const toggleBtn = document.getElementById('toggleEditorModeBtn');
        if (toggleBtn) {
            toggleBtn.textContent = '切換到 HTML 模式';
        }
        
        // 將 textarea 的內容載入到 Quill
        let htmlContent = textarea.value;
        if (htmlContent.includes('<body>')) {
            const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            if (bodyMatch) {
                htmlContent = bodyMatch[1];
            }
        }
        quillEditor.root.innerHTML = htmlContent;
    } else {
        // 從可視化模式切換到 HTML 模式
        isHtmlMode = true;
        editorContainer.style.display = 'none';
        textarea.style.display = 'block';
        const toggleBtn = document.getElementById('toggleEditorModeBtn');
        if (toggleBtn) {
            toggleBtn.textContent = '切換到可視化模式';
        }
        
        // 將 Quill 的內容保存到 textarea
        const quillHtml = quillEditor.root.innerHTML;
        const originalContent = textarea.value;
        
        if (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html')) {
            if (originalContent.includes('<body>')) {
                textarea.value = originalContent.replace(
                    /<body[^>]*>([\s\S]*?)<\/body>/i,
                    `<body>${quillHtml}</body>`
                );
            } else {
                textarea.value = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
    </style>
</head>
<body>
${quillHtml}
</body>
</html>`;
            }
        } else {
            textarea.value = quillHtml;
        }
    }
}

// 插入變數到編輯器
function insertVariable(variable) {
    if (isHtmlMode) {
        // HTML 模式：插入到 textarea
        const textarea = document.getElementById('emailTemplateContent');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.substring(0, start) + variable + text.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
    } else {
        // 可視化模式：插入到 Quill
        const range = quillEditor.getSelection(true);
        quillEditor.insertText(range.index, variable, 'user');
        quillEditor.setSelection(range.index + variable.length);
    }
}

// 關閉郵件模板模態框
function closeEmailTemplateModal() {
    document.getElementById('emailTemplateModal').classList.remove('active');
    // 重置編輯模式
    isHtmlMode = false;
    const editorContainer = document.getElementById('emailTemplateEditor');
    const textarea = document.getElementById('emailTemplateContent');
    if (editorContainer && textarea) {
        editorContainer.style.display = 'block';
        textarea.style.display = 'none';
        const toggleBtn = document.getElementById('toggleEditorMode');
        if (toggleBtn) {
            toggleBtn.textContent = '切換到 HTML 模式';
        }
    }
}

// ==================== 假日管理 ====================

// 載入假日列表
async function loadHolidays() {
    try {
        const response = await fetch('/api/admin/holidays');
        const result = await response.json();
        
        if (result.success) {
            renderHolidays(result.data || []);
        } else {
            const container = document.getElementById('holidaysList');
            if (container) {
                container.innerHTML = '<div class="error">載入假日列表失敗</div>';
            }
        }
    } catch (error) {
        console.error('載入假日列表錯誤:', error);
        const container = document.getElementById('holidaysList');
        if (container) {
            container.innerHTML = '<div class="error">載入假日列表時發生錯誤</div>';
        }
    }
}

// 渲染假日列表
function renderHolidays(holidays) {
    const container = document.getElementById('holidaysList');
    if (!container) return;
    
    if (holidays.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">目前沒有設定假日</div>';
        return;
    }
    
    // 按日期排序
    holidays.sort((a, b) => new Date(a.holiday_date) - new Date(b.holiday_date));
    
    container.innerHTML = holidays.map(holiday => {
        const date = new Date(holiday.holiday_date);
        const dateStr = date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const dayOfWeek = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][date.getDay()];
        const isWeekend = holiday.is_weekend === 1;
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
                <div>
                    <strong>${dateStr}</strong> (${dayOfWeek})
                    ${holiday.holiday_name ? `<span style="color: #667eea; margin-left: 10px;">${escapeHtml(holiday.holiday_name)}</span>` : ''}
                    ${isWeekend ? '<span style="color: #999; margin-left: 10px; font-size: 12px;">(自動週末)</span>' : ''}
                </div>
                ${!isWeekend ? `<button class="btn-cancel" onclick="deleteHoliday('${holiday.holiday_date}')" style="padding: 5px 10px; font-size: 12px;">刪除</button>` : ''}
            </div>
        `;
    }).join('');
}

// 新增單一假日
async function addHoliday() {
    const holidayDate = document.getElementById('holidayDate').value;
    const holidayName = document.getElementById('holidayName').value.trim();
    
    if (!holidayDate) {
        showError('請選擇假日日期');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/holidays', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                holidayDate,
                holidayName: holidayName || null
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 清空表單
            document.getElementById('holidayDate').value = '';
            document.getElementById('holidayName').value = '';
            
            // 重新載入假日列表
            await loadHolidays();
            
            showSuccess('假日已新增');
        } else {
            showError('新增假日失敗: ' + result.message);
        }
    } catch (error) {
        console.error('新增假日錯誤:', error);
        showError('新增假日時發生錯誤: ' + error.message);
    }
}

// 新增連續假期
async function addHolidayRange() {
    const startDate = document.getElementById('holidayStartDate').value;
    const endDate = document.getElementById('holidayEndDate').value;
    const holidayName = document.getElementById('holidayRangeName').value.trim();
    
    if (!startDate || !endDate) {
        showError('請選擇開始日期和結束日期');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        showError('開始日期不能晚於結束日期');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/holidays', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                startDate,
                endDate,
                holidayName: holidayName || null
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 清空表單
            document.getElementById('holidayStartDate').value = '';
            document.getElementById('holidayEndDate').value = '';
            document.getElementById('holidayRangeName').value = '';
            
            // 重新載入假日列表
            await loadHolidays();
            
            showSuccess(`已新增 ${result.data.addedCount} 個假日`);
        } else {
            showError('新增連續假期失敗: ' + result.message);
        }
    } catch (error) {
        console.error('新增連續假期錯誤:', error);
        showError('新增連續假期時發生錯誤: ' + error.message);
    }
}

// 刪除假日
async function deleteHoliday(holidayDate) {
    if (!confirm('確定要刪除這個假日嗎？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/holidays/${holidayDate}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 重新載入假日列表
            await loadHolidays();
            showSuccess('假日已刪除');
        } else {
            showError('刪除假日失敗: ' + result.message);
        }
    } catch (error) {
        console.error('刪除假日錯誤:', error);
        showError('刪除假日時發生錯誤: ' + error.message);
    }
}

// 顯示成功訊息
function showSuccess(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.style.background = '#4caf50';
    errorDiv.style.color = 'white';
    errorDiv.textContent = message;
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '20px';
    errorDiv.style.right = '20px';
    errorDiv.style.padding = '15px 20px';
    errorDiv.style.borderRadius = '8px';
    errorDiv.style.zIndex = '10000';
    errorDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 3000);
}

