// 全域變數
let roomTypes = [];
let addons = []; // 加購商品列表
let selectedAddons = []; // 已選擇的加購商品
let enableAddons = true; // 前台加購商品功能是否啟用
let allBuildings = [];
let selectedBuildingId = 1;
const SELECTED_BUILDING_STORAGE_KEY = 'selected_building_id_v1';

function formatAddonUnit(unitLabel) {
    const normalized = String(unitLabel || '人').trim();
    return normalized || '人';
}

function escapeAddonText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAddonMultiline(value) {
    return escapeAddonText(value).replace(/\r?\n/g, '<br>');
}

function isExtraBedAddon(addon) {
    const name = String(addon?.name || '').trim();
    const displayName = String(addon?.display_name || '').trim();
    return name === 'extra_bed' || /加床/.test(name) || /加床/.test(displayName);
}

function getExtraBedAddonDef() {
    return Array.isArray(addons) ? addons.find((addon) => isExtraBedAddon(addon)) : null;
}

function showAddonDetailModal(encodedAddonName) {
    const addonName = decodeURIComponent(encodedAddonName || '');
    const addon = addons.find(item => item.name === addonName);
    if (!addon) return;

    const details = String(addon.details || '').trim();
    const terms = String(addon.terms || '').trim();
    const summary = String(addon.summary || '').trim();

    const titleEl = document.getElementById('addonDetailTitle');
    const bodyEl = document.getElementById('addonDetailBody');
    const overlay = document.getElementById('addonDetailModal');
    if (!titleEl || !bodyEl || !overlay) return;

    titleEl.textContent = addon.display_name || addon.name;
    let html = '';
    if (summary) {
        html += `<p class="addon-detail-summary">${formatAddonMultiline(summary)}</p>`;
    }
    if (details) {
        html += `<h4 class="addon-detail-heading">詳細說明</h4><p class="addon-detail-content">${formatAddonMultiline(details)}</p>`;
    }
    if (terms) {
        html += `<h4 class="addon-detail-heading">注意事項</h4><p class="addon-detail-content">${formatAddonMultiline(terms)}</p>`;
    }
    if (!html) {
        html = '<p class="addon-detail-content">目前尚未提供詳細說明。</p>';
    }
    bodyEl.innerHTML = html;
    overlay.classList.remove('hidden');
}

function hideAddonDetailModal() {
    const overlay = document.getElementById('addonDetailModal');
    if (!overlay) return;
    overlay.classList.add('hidden');
}
let depositPercentage = 30; // 預設訂金百分比
let unavailableRooms = []; // 已滿房的房型列表
let datePicker = null; // 日期區間選擇器
let guestCounts = { adults: 2, children: 0 };
let selectedRoomQuantities = {};
let selectedRoomExtraBeds = {};
let capacityModalData = { capacity: 0, totalGuests: 0 };
let roomGalleryData = {};
let roomFacilitiesData = {};
/** 後台「旅宿設施」(landing_facilities)，供包棟模式房型卡片與銷售頁一致 */
let bookingLandingFacilitiesItems = [];
let roomFacilitiesExpandedState = {};
let currentRoomGallery = { images: [], index: 0, title: '' };
let lineUserId = null; // LINE User ID（如果從 LIFF 開啟）
let appliedPromoCode = null; // 已套用的優惠代碼
let earlyBirdDiscount = null; // 已偵測的早鳥優惠
let memberLevelDiscount = null; // 已偵測的會員折扣
let roomCountConfig = { min: 1, max: 20 };
const BOOKING_ATTRIBUTION_STORAGE_KEY = 'booking_attribution_v1';
const SYSTEM_MODE_STORAGE_KEY = 'booking_system_mode_v1';
const BOOKING_STATE_STORAGE_KEYS = [
    'booking_cart_retail_v1',
    'booking_cart_whole_property_v1',
    'booking_draft_retail_v1',
    'booking_draft_whole_property_v1',
    'booking_selected_addons_v1',
    'booking_selected_rooms_v1'
];
const bookingAttribution = initBookingAttribution();
let currentSystemMode = 'retail';
const DEFAULT_BOOKING_NOTICE_REQUIRED_LINES = [
    '4. 若需提前入住或延後退房，請提前告知，實際安排與費用依現場公告為準。',
    '5. 請妥善保管個人物品，離房時請再次確認；若有遺失請儘速聯繫櫃檯協助。',
    '6. 現場若核對入住人數或年齡與預訂資料不符，旅宿得依規範加收費用或保留入住安排權。'
];
const DEFAULT_BOOKING_NOTICE_CONTENT = [
    '1. 入住時間為 15:00 後，退房時間為 11:00 前。',
    '2. 全館禁菸，違者將酌收清潔費。',
    '3. 室內請降低音量，22:00 後請避免喧嘩。',
    ...DEFAULT_BOOKING_NOTICE_REQUIRED_LINES
].join('\n');
let bookingNoticeConfig = {
    content: DEFAULT_BOOKING_NOTICE_CONTENT
};
let bookingTermsConfig = {
    enabled: true,
    requireCheckbox: true,
    agreementText: '我已閱讀並同意以上內容'
};
let bookingCancellationConfig = {
    content: '1. 入住日 14 天（含）前取消：可全額退款。\n2. 入住日 7-13 天前取消：退還已付金額 70%。\n3. 入住日 3-6 天前取消：退還已付金額 50%。\n4. 入住日前 0-2 天取消或未入住：恕不退款。\n5. 如遇天災等不可抗力因素，依政府公告與業者規範彈性處理。'
};

const OLD_NOTICE_LINE = '4. 若有加床、停車或特殊需求，請於入住前先聯繫客服。';
const NEW_NOTICE_LINE = '6. 現場若核對入住人數或年齡與預訂資料不符，旅宿得依規範加收費用或保留入住安排權。';
const NOTICE_MISMATCH_KEYWORD = '入住人數或年齡與預訂資料不符';
const OLD_TERMS_AGREEMENT_TEXT = '若現場核對入住人數或年齡與預訂資訊不符，旅宿得依規範加收費用或保留入住安排權利。';
const NEW_TERMS_AGREEMENT_TEXT = '我已閱讀並同意以上內容';

function parsePositiveIntSetting(value, fallback = 1) {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function classifyReferrerSource(referrer) {
    const ref = String(referrer || '').toLowerCase();
    if (!ref) return 'direct';
    if (ref.includes('line.me') || ref.includes('liff.line')) return 'line';
    if (ref.includes('facebook.com') || ref.includes('fb.')) return 'facebook';
    if (ref.includes('instagram.com')) return 'instagram';
    if (ref.includes('google.')) return 'google';
    if (ref.includes('youtube.')) return 'youtube';
    if (ref.includes('booking-system') || ref.includes(location.hostname.toLowerCase())) return 'direct';
    return 'referral';
}

function initBookingAttribution() {
    const urlParams = new URLSearchParams(window.location.search || '');

    let stored = {};
    try {
        const raw = localStorage.getItem(BOOKING_ATTRIBUTION_STORAGE_KEY);
        if (raw) stored = JSON.parse(raw) || {};
    } catch (error) {
        console.warn('⚠️  讀取來源追蹤快取失敗:', error.message);
    }

    const utmSource = String(urlParams.get('utm_source') || '').trim().toLowerCase();
    const utmMedium = String(urlParams.get('utm_medium') || '').trim().toLowerCase();
    const utmCampaign = String(urlParams.get('utm_campaign') || '').trim();
    const currentReferrer = String(document.referrer || '').trim();
    const inferredSource = classifyReferrerSource(currentReferrer);

    const merged = {
        utm_source: utmSource || String(stored.utm_source || '').trim().toLowerCase() || '',
        utm_medium: utmMedium || String(stored.utm_medium || '').trim().toLowerCase() || '',
        utm_campaign: utmCampaign || String(stored.utm_campaign || '').trim() || '',
        booking_source: utmSource || String(stored.booking_source || '').trim().toLowerCase() || inferredSource || 'direct',
        referrer: currentReferrer || String(stored.referrer || '').trim() || ''
    };

    try {
        localStorage.setItem(BOOKING_ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
    } catch (error) {
        console.warn('⚠️  儲存來源追蹤快取失敗:', error.message);
    }

    return merged;
}

function normalizeSystemMode(mode) {
    const value = String(mode || '').trim();
    return value === 'whole_property' ? 'whole_property' : 'retail';
}

function showModeToast(message) {
    if (!message) return;
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.top = '18px';
    toast.style.right = '18px';
    toast.style.zIndex = '9999';
    toast.style.background = '#1f2937';
    toast.style.color = '#fff';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)';
    toast.style.fontSize = '13px';
    toast.style.maxWidth = '320px';
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3200);
}

function clearCrossModeClientState(previousMode, nextMode) {
    if (!previousMode || previousMode === nextMode) return;
    try {
        BOOKING_STATE_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        // 清除舊版/未知命名但含 cart/draft 關鍵字的暫存資料
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
            const key = localStorage.key(i);
            if (!key) continue;
            const normalizedKey = key.toLowerCase();
            if (normalizedKey.includes('cart') || normalizedKey.includes('draft')) {
                localStorage.removeItem(key);
            }
        }
    } catch (error) {
        console.warn('⚠️ 清除跨模式暫存失敗:', error.message);
    }
    const fromLabel = previousMode === 'whole_property' ? '包棟模式' : '一般模式';
    const toLabel = nextMode === 'whole_property' ? '包棟模式' : '一般模式';
    showModeToast(`已切換為${toLabel}，${fromLabel}的收藏/購物車/草稿已清除`);
}

function applySingleModeUi(mode) {
    const normalized = normalizeSystemMode(mode);
    const roomSection = document.getElementById('roomTypeGrid')?.closest('.form-section');
    const addonSection = document.getElementById('addonsGrid')?.closest('.form-section');
    const roomTitle = roomSection?.querySelector('.section-title');
    const cardHeaderTitle = document.querySelector('.card-header h1');
    const cardHeaderSubtitle = document.querySelector('.card-header .subtitle');
    const submitBtn = document.querySelector('#bookingForm .submit-btn span');
    const dateTitle = document.querySelector('#bookingForm .form-section .section-title');

    if (normalized === 'whole_property') {
        if (roomTitle) roomTitle.innerHTML = '<span class="material-symbols-outlined">villa</span> 選擇包棟方案';
        if (addonSection) addonSection.style.display = 'none';
        selectedAddons = [];
        if (cardHeaderTitle) cardHeaderTitle.textContent = '線上訂房系統';
        if (cardHeaderSubtitle) cardHeaderSubtitle.textContent = '預訂您的完美住宿體驗';
        if (submitBtn) submitBtn.textContent = '確認包棟訂房';
        if (dateTitle) dateTitle.innerHTML = '<span class="material-symbols-outlined">calendar_month</span> 選擇包棟日期';
        // 包棟模式只允許選擇一個方案
        const selectedNames = Object.keys(selectedRoomQuantities).filter((name) => Number(selectedRoomQuantities[name] || 0) > 0);
        if (selectedNames.length > 1) {
            const keepName = selectedNames[0];
            Object.keys(selectedRoomQuantities).forEach((name) => {
                selectedRoomQuantities[name] = name === keepName ? 1 : 0;
                if (name !== keepName) {
                    selectedRoomExtraBeds[name] = 0;
                }
            });
        }
    } else {
        if (roomTitle) roomTitle.innerHTML = '<span class="material-symbols-outlined">king_bed</span> 選擇房型';
        if (addonSection) addonSection.style.display = '';
        if (cardHeaderTitle) cardHeaderTitle.textContent = '線上訂房系統';
        if (cardHeaderSubtitle) cardHeaderSubtitle.textContent = '預訂您的完美住宿體驗';
        if (submitBtn) submitBtn.textContent = '確認訂房';
        if (dateTitle) dateTitle.innerHTML = '<span class="material-symbols-outlined">calendar_month</span> 選擇日期';
    }
}

function enforceWholePropertySingleSelection(activeRoomName) {
    if (currentSystemMode !== 'whole_property') return;
    Object.keys(selectedRoomQuantities).forEach((name) => {
        if (name !== activeRoomName) {
            selectedRoomQuantities[name] = 0;
            selectedRoomExtraBeds[name] = 0;
            syncRoomSelectionCard(name);
        }
    });
}

async function initSystemMode() {
    let mode = 'retail';
    try {
        const response = await fetch('/api/system/mode', { credentials: 'include' });
        if (response.ok) {
            const result = await response.json();
            mode = normalizeSystemMode(result?.data?.system_mode);
        }
    } catch (error) {
        console.warn('⚠️ 讀取系統模式失敗，預設一般模式:', error.message);
    }

    let previousMode = '';
    try {
        previousMode = normalizeSystemMode(localStorage.getItem(SYSTEM_MODE_STORAGE_KEY));
        localStorage.setItem(SYSTEM_MODE_STORAGE_KEY, mode);
    } catch (_) {
        // ignore storage errors
    }
    clearCrossModeClientState(previousMode, mode);
    currentSystemMode = mode;
    applySingleModeUi(mode);
}

function applyBuildingIdFromUrl() {
    try {
        const urlParams = new URLSearchParams(window.location.search || '');
        const raw = urlParams.get('buildingId');
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
            setSelectedBuildingId(parsed);
        }
    } catch (_) {}
}

function forceRoomCounterButtonsVisibility(fixedRoomCount) {
    // 上方「客房數」控制器永遠顯示 +/-；固定房數只影響房型卡片右下角數量控制器
    return fixedRoomCount;
}

function updateTopRoomCounterButtonState() {
    const roomsInput = document.getElementById('rooms');
    const controls = document.querySelectorAll('.booking-capacity-rooms .guest-counter .guest-counter-btn');
    if (!roomsInput || controls.length < 2) return;
    const current = parseInt(roomsInput.value || String(roomCountConfig.min || 1), 10) || (roomCountConfig.min || 1);
    const [minusBtn, plusBtn] = controls;
    if (minusBtn) minusBtn.disabled = current <= roomCountConfig.min;
    if (plusBtn) plusBtn.disabled = current >= roomCountConfig.max;
}

function applyRoomCountSettings(settings) {
    const roomsInput = document.getElementById('rooms');
    const roomsDisplay = document.getElementById('roomsDisplay');

    if (roomsInput && roomsDisplay) {
        const current = parseInt(roomsInput.value || String(roomCountConfig.min), 10) || roomCountConfig.min;
        const clamped = Math.min(roomCountConfig.max, Math.max(roomCountConfig.min, current));
        roomsInput.value = String(clamped);
        roomsDisplay.textContent = String(clamped);
    }

    forceRoomCounterButtonsVisibility(false);
    updateTopRoomCounterButtonState();
}

// ===== Facebook Pixel 追蹤函數 =====

/**
 * 追蹤開始結帳（進入訂房頁）
 */
function trackInitiateCheckout() {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
            content_name: '訂房頁面',
            content_category: '旅宿訂房'
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
            content_category: '旅宿訂房'
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

            // 未登入 LINE 時，跳過 user profile 取得，避免誤導性錯誤訊息
            if (typeof liff.isLoggedIn === 'function' && !liff.isLoggedIn()) {
                console.log('ℹ️ LIFF 已初始化，但目前未登入 LINE，略過 User ID 讀取');
            } else {
                try {
                    const profile = await liff.getProfile();
                    lineUserId = profile.userId;
                    console.log('✅ 取得 LINE User ID:', lineUserId?.substring(0, 10) + '...');
                } catch (profileError) {
                    // 這裡不視為致命錯誤：前台仍可正常下單
                    console.warn('⚠️ 無法取得 LINE User ID，將以一般訪客流程繼續:', profileError.message);
                }
            }

            // 設定 LIFF 視窗標題
            if (typeof liff.setTitle === 'function') {
                liff.setTitle('線上訂房系統');
            }
        } else {
            console.log('🌐 非 LINE 環境，跳過 LIFF 初始化');
        }
    } catch (error) {
        console.warn('⚠️ LIFF 初始化失敗:', error.message);
        // LIFF 初始化失敗不影響正常使用
    }
}

let _pendingRoomTypeIdFromUrl = null;

function applyRoomTypeIdFromUrl() {
    try {
        const urlParams = new URLSearchParams(window.location.search || '');
        const raw = urlParams.get('roomTypeId');
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
            _pendingRoomTypeIdFromUrl = parsed;
        }
    } catch (_) {}
}

function autoSelectRoomTypeIfRequested() {
    const pendingId = _pendingRoomTypeIdFromUrl;
    if (!pendingId) return;

    const match = (roomTypes || []).find((rt) => Number(rt?.id) === Number(pendingId));
    if (!match) return;

    // 清掉 pending，避免重複套用（例如重整或重新載入房型）
    _pendingRoomTypeIdFromUrl = null;

    // 以 room.name 作為選取 key
    const roomName = match.name;
    if (!roomName) return;
    try {
        selectRoomTypeByName(null, roomName);
    } catch (e) {
        console.warn('自動選取房型失敗:', e?.message || e);
        return;
    }

    // 需求：從銷售頁點「預訂」後，帶到訂房頁的日期選擇區（最上方）
    try {
        const dateRangeEl = document.getElementById('dateRange');
        if (dateRangeEl && typeof dateRangeEl.scrollIntoView === 'function') {
            dateRangeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } catch (_) {}
}

// 載入房型資料和系統設定
async function loadRoomTypesAndSettings() {
    try {
        applyRoomCountSettings(null);
        // 同時載入房型、加購商品和設定
        const [buildingsResponse, roomTypesResponse, addonsResponse, settingsResponse] = await Promise.all([
            fetch('/api/buildings'),
            fetch(`/api/room-types?buildingId=${encodeURIComponent(getSelectedBuildingId())}`),
            fetch('/api/addons'),
            fetch('/api/settings')
        ]);
        
        const buildingsResult = await buildingsResponse.json();
        const roomTypesResult = await roomTypesResponse.json();
        const addonsResult = await addonsResponse.json();
        const settingsResult = await settingsResponse.json();

        allBuildings = buildingsResult.success ? (buildingsResult.data || []) : [];
        syncBuildingSelect();
        applyRoomCountSettings(settingsResult.success ? settingsResult.data : null);
        
        roomTypes = roomTypesResult.success ? (roomTypesResult.data || []) : [];
        bookingLandingFacilitiesItems = parseLandingFacilitiesForBooking(
            settingsResult.success && settingsResult.data ? settingsResult.data.landing_facilities : ''
        );
        renderRoomTypes();
        autoSelectRoomTypeIfRequested();
        
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
        
        applyBookingNoticeSettings(settingsResult.success ? settingsResult.data : null);
        applyBookingCancellationSettings(settingsResult.success ? settingsResult.data : null);
        applyBookingTermsSettings(settingsResult.success ? settingsResult.data : null);
        
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
        bookingLandingFacilitiesItems = [];
        applyRoomCountSettings(null);
        document.getElementById('roomTypeGrid').innerHTML = '<div class="error">載入房型失敗，請重新整理頁面</div>';
        document.getElementById('addonsGrid').innerHTML = '<div class="error">載入加購商品失敗</div>';
    }
}

function getSelectedBuildingId() {
    const raw = localStorage.getItem(SELECTED_BUILDING_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
        selectedBuildingId = parsed;
        return parsed;
    }
    return selectedBuildingId || 1;
}

function setSelectedBuildingId(nextId) {
    const parsed = parseInt(String(nextId ?? ''), 10);
    const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    selectedBuildingId = safe;
    try {
        localStorage.setItem(SELECTED_BUILDING_STORAGE_KEY, String(safe));
    } catch (_) {}
}

function syncBuildingSelect() {
    const sectionEl = document.getElementById('buildingSection');
    const selectEl = document.getElementById('buildingSelect');
    if (!sectionEl || !selectEl) return;

    const buildings = Array.isArray(allBuildings) ? allBuildings : [];
    const showSelect = buildings.length > 1;
    sectionEl.classList.toggle('hidden', !showSelect);

    if (!showSelect) {
        setSelectedBuildingId(1);
        selectEl.innerHTML = '';
        return;
    }

    const current = getSelectedBuildingId();
    const exists = buildings.some((b) => Number(b?.id) === Number(current));
    const effective = exists ? current : Number(buildings[0]?.id || 1);
    setSelectedBuildingId(effective);

    selectEl.innerHTML = buildings
        .map((b) => {
            const id = Number(b?.id);
            const name = String(b?.name || b?.code || `館別 ${id}`);
            return `<option value="${id}">${escapeRoomText(name)}</option>`;
        })
        .join('');
    selectEl.value = String(effective);

    if (!selectEl.dataset.boundChange) {
        selectEl.addEventListener('change', async () => {
            setSelectedBuildingId(selectEl.value);
            selectedRoomQuantities = {};
            selectedRoomExtraBeds = {};
            unavailableRooms = [];
            await loadRoomTypesAndSettings();
            await checkRoomAvailability();
            calculatePrice();
        });
        selectEl.dataset.boundChange = '1';
    }
}

function isSettingEnabled(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function applyBookingNoticeSettings(settings) {
    const contentEl = document.getElementById('bookingNoticeContent');
    const sectionEl = document.getElementById('bookingNoticeSection');
    if (!contentEl || !sectionEl) return;

    const content = String(settings?.booking_notice_content || '').trim();
    bookingNoticeConfig.content = normalizeBookingNoticeContent(content || bookingNoticeConfig.content);
    contentEl.textContent = bookingNoticeConfig.content;
    sectionEl.style.display = bookingNoticeConfig.content ? '' : 'none';
    clearSectionError('bookingNoticeSection');
}

function applyBookingCancellationSettings(settings) {
    const contentEl = document.getElementById('bookingCancellationPolicyContent');
    const openBtnEl = document.getElementById('bookingCancellationPolicyBtn');
    if (!contentEl || !openBtnEl) return;

    const policyContent = String(settings?.booking_cancellation_policy || '').trim();
    bookingCancellationConfig.content = policyContent || bookingCancellationConfig.content;
    contentEl.textContent = bookingCancellationConfig.content;
    openBtnEl.classList.toggle('hidden', !bookingCancellationConfig.content);
}

function normalizeBookingNoticeContent(content) {
    const lines = String(content || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.includes('若有加床、停車或特殊需求，請於入住前先聯繫客服'))
        .filter((line) => !line.includes(NOTICE_MISMATCH_KEYWORD));

    DEFAULT_BOOKING_NOTICE_REQUIRED_LINES.forEach((requiredLine) => {
        const hasLine = lines.some((line) => line.includes(requiredLine));
        if (!hasLine) {
            lines.push(requiredLine);
        }
    });

    return lines.join('\n').replace(OLD_NOTICE_LINE, NEW_NOTICE_LINE);
}

function applyBookingTermsSettings(settings) {
    const sectionEl = document.getElementById('bookingTermsSection');
    const checkboxEl = document.getElementById('bookingTermsAgree');
    const textEl = document.getElementById('bookingTermsAgreementText');
    if (!sectionEl || !checkboxEl || !textEl) return;

    const agreementText = String(settings?.booking_terms_agreement_text || '').trim();
    const normalizedAgreementText = agreementText === OLD_TERMS_AGREEMENT_TEXT
        ? NEW_TERMS_AGREEMENT_TEXT
        : (agreementText || NEW_TERMS_AGREEMENT_TEXT);
    bookingTermsConfig = {
        enabled: isSettingEnabled(settings?.booking_terms_enabled, true),
        requireCheckbox: true,
        agreementText: normalizedAgreementText
    };

    textEl.textContent = bookingTermsConfig.agreementText;
    checkboxEl.checked = false;
    checkboxEl.required = bookingTermsConfig.enabled && bookingTermsConfig.requireCheckbox;
    sectionEl.classList.toggle('hidden', !bookingTermsConfig.enabled);
    clearSectionError('bookingTermsSection');
}

function openBookingCancellationModal() {
    const modal = document.getElementById('bookingCancellationModal');
    if (!modal) return;
    modal.classList.remove('hidden');
}

function closeBookingCancellationModal() {
    const modal = document.getElementById('bookingCancellationModal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function escapeRoomText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 與 landing.js renderAmenities 相同：旅宿設施區塊不顯示這兩項
const BOOKING_HIDDEN_LANDING_AMENITIES = new Set(['電熱水壺', '吹風機']);

function parseLandingFacilitiesForBooking(raw) {
    const facilitiesStr = String(raw || '').trim();
    if (!facilitiesStr) return [];
    return facilitiesStr
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && !BOOKING_HIDDEN_LANDING_AMENITIES.has(f));
}

const roomFeatureIconMap = {
    '單人床': 'single_bed', '雙人床': 'king_bed', '加大雙人床': 'king_bed',
    '特大雙人床': 'king_bed', '上下鋪': 'single_bed', '和式床墊': 'airline_seat_flat',
    '沙發床': 'weekend',
    '獨立衛浴': 'bathtub', '共用衛浴': 'shower', '浴缸': 'bathtub',
    '淋浴設備': 'shower', '免治馬桶': 'wash', '私人湯池': 'hot_tub',
    '私人陽台': 'balcony', '客廳空間': 'living', '小廚房': 'countertops',
    '和室空間': 'floor', 'Mini Bar': 'local_bar', '兒童遊戲區': 'toys', '餐廳空間': 'restaurant',
    '庭院': 'yard', '山景視野': 'landscape', '海景視野': 'water', '庭園景觀': 'park',
    '免費 WiFi': 'wifi', '冷暖空調': 'ac_unit', '智慧電視': 'tv',
    '冰箱': 'kitchen', '咖啡機': 'coffee_maker', '電熱水壺': 'kettle',
    '飲水機': 'water_drop', '自動販賣機': 'local_drink', '電動車充電設備': 'ev_station',
    '吹風機': 'air', '洗衣機': 'local_laundry_service', '微波爐': 'microwave',
    '書桌': 'desk', '化粧桌': 'table_restaurant', '梳妝台': 'table_restaurant', '沙發': 'weekend', '小桌椅': 'table_restaurant',
    '寢具用品': 'bed', '毛巾': 'dry_cleaning', '浴巾': 'dry_cleaning', '牙刷/牙膏': 'brush',
    '盥洗用品': 'soap', '洗髮精': 'sanitizer', '潤髮乳': 'sanitizer', '香皂/沐浴乳': 'sanitizer', '拖鞋': 'footprint',
    '免費早餐': 'restaurant', '免費停車': 'local_parking', '寵物友善': 'pets',
    '保險箱': 'lock', '行李寄放': 'luggage', '嬰兒床': 'crib',
    '嬰兒澡盆': 'bathtub', '電梯': 'elevator', '燒烤設備': 'outdoor_grill',
    '卡拉OK': 'mic', '麻將桌': 'table_restaurant', '電動麻將桌': 'electric_bolt',
    '桌遊': 'casino', '廚房用具': 'kitchen', '無障礙設施': 'accessible', '機場接送': 'airport_shuttle'
};

function buildRoomFacilitiesBlock(roomId) {
    const facilities = roomFacilitiesData[String(roomId)] || [];
    if (!facilities.length) return '';

    const expanded = !!roomFacilitiesExpandedState[String(roomId)];
    const maxVisible = 6;
    const visibleFacilities = expanded ? facilities : facilities.slice(0, maxVisible);

    const chipsHtml = visibleFacilities.map((facility) => {
        const icon = roomFeatureIconMap[facility] || 'check_circle';
        return `
            <span class="room-facility-chip">
                <span class="material-symbols-outlined">${icon}</span>
                ${escapeRoomText(facility)}
            </span>
        `;
    }).join('');

    const toggleHtml = facilities.length > maxVisible
        ? `<button type="button" class="room-facility-toggle" onclick="toggleRoomFacilities(event, '${String(roomId)}')">${expanded ? '收合' : `顯示全部（${facilities.length}）`}</button>`
        : '';

    return `
        <div class="room-facilities-wrap">
            ${chipsHtml}
        </div>
        ${toggleHtml}
    `;
}

function toggleRoomFacilities(event, roomId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const id = String(roomId);
    roomFacilitiesExpandedState[id] = !roomFacilitiesExpandedState[id];
    const container = document.getElementById(`roomFacilitiesBlock-${id}`);
    if (container) {
        container.innerHTML = buildRoomFacilitiesBlock(id);
    }
}

function selectRoomTypeByName(event, roomName) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const roomOption = Array.from(document.querySelectorAll('.room-option')).find(el => el.dataset.room === roomName);
    const checkbox = roomOption ? roomOption.querySelector('input[name="roomType"]') : null;
    if (!checkbox || checkbox.disabled) return;
    changeRoomTypeQuantity(roomName, 1);
}

function updateRoomSelectButtons() {
    const canAddMoreRooms = true;

    document.querySelectorAll('.room-option').forEach((optionEl) => {
        const radio = optionEl.querySelector('input[name="roomType"]');
        const btn = optionEl.querySelector('.room-select-btn');
        const plusBtn = optionEl.querySelector('.room-qty-btn-plus');
        if (!radio || !btn) return;

        if (radio.disabled) {
            btn.classList.remove('is-selected');
            btn.classList.add('is-unavailable');
            btn.textContent = '滿房';
            if (plusBtn) plusBtn.disabled = true;
            return;
        }

        const roomName = optionEl.dataset.room;
        const qty = parseInt(selectedRoomQuantities[roomName] || '0', 10) || 0;
        const selected = qty > 0;
        btn.classList.remove('is-unavailable');
        btn.classList.toggle('is-selected', selected);
        const isWholePropertyMode = normalizeSystemMode(currentSystemMode) === 'whole_property';
        btn.textContent = selected ? '已選取' : (isWholePropertyMode ? '選取包棟' : '選取房型');
        if (plusBtn) plusBtn.disabled = true;
    });
}

function openRoomGallery(event, roomId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const data = roomGalleryData[String(roomId)];
    if (!data || !Array.isArray(data.images) || data.images.length === 0) return;

    currentRoomGallery = {
        images: data.images,
        index: 0,
        title: data.name || '房型照片'
    };
    renderRoomGallery();

    const overlay = document.getElementById('roomGalleryModal');
    if (overlay) overlay.classList.remove('hidden');
}

function hideRoomGalleryModal() {
    const overlay = document.getElementById('roomGalleryModal');
    if (overlay) overlay.classList.add('hidden');
}

function changeRoomGalleryImage(step) {
    const total = currentRoomGallery.images.length;
    if (!total) return;
    const nextIndex = (currentRoomGallery.index + step + total) % total;
    currentRoomGallery.index = nextIndex;
    renderRoomGallery();
}

function renderRoomGallery() {
    const titleEl = document.getElementById('roomGalleryTitle');
    const imageEl = document.getElementById('roomGalleryImage');
    const counterEl = document.getElementById('roomGalleryCounter');
    const prevBtn = document.getElementById('roomGalleryPrevBtn');
    const nextBtn = document.getElementById('roomGalleryNextBtn');
    if (!titleEl || !imageEl || !counterEl || !prevBtn || !nextBtn) return;

    const images = currentRoomGallery.images || [];
    const total = images.length;
    if (!total) return;

    const index = Math.max(0, Math.min(currentRoomGallery.index, total - 1));
    currentRoomGallery.index = index;

    titleEl.textContent = currentRoomGallery.title || '房型照片';
    imageEl.src = images[index];
    imageEl.alt = `${currentRoomGallery.title || '房型照片'} ${index + 1}`;
    counterEl.textContent = `${index + 1} / ${total}`;

    const hideNav = total <= 1;
    prevBtn.style.display = hideNav ? 'none' : '';
    nextBtn.style.display = hideNav ? 'none' : '';

    const thumbsEl = document.getElementById('roomGalleryThumbs');
    if (thumbsEl) {
        thumbsEl.innerHTML = images.map((imgUrl, thumbIndex) => `
            <button type="button" class="room-gallery-thumb ${thumbIndex === index ? 'active' : ''}" onclick="selectRoomGalleryImage(event, ${thumbIndex})" aria-label="選擇第 ${thumbIndex + 1} 張">
                <img src="${imgUrl}" alt="縮圖 ${thumbIndex + 1}">
            </button>
        `).join('');
    }
}

function selectRoomGalleryImage(event, index) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const total = currentRoomGallery.images.length;
    if (!total) return;
    currentRoomGallery.index = Math.max(0, Math.min(index, total - 1));
    renderRoomGallery();
}

// 渲染加購商品
function renderAddons() {
    const grid = document.getElementById('addonsGrid');
    
    if (!grid) return;
    
    const visibleAddons = addons.filter((addon) => !isExtraBedAddon(addon));
    if (visibleAddons.length === 0) {
        grid.innerHTML = '<div class="loading">暫無加購商品</div>';
        return;
    }
    
    grid.innerHTML = visibleAddons.map(addon => {
        const selectedAddon = selectedAddons.find(a => a.name === addon.name);
        const quantity = selectedAddon ? selectedAddon.quantity : 0;
        const isSelected = quantity > 0;
        const unitLabel = formatAddonUnit(addon.unit_label);
        const summary = String(addon.summary || '').trim();
        const details = String(addon.details || '').trim();
        const terms = String(addon.terms || '').trim();
        const hasDetailContent = !!(summary || details || terms);
        const encodedName = encodeURIComponent(addon.name || '');
        
        return `
            <div class="addon-option ${isSelected ? 'selected' : ''}" data-addon="${addon.name}" data-price="${addon.price}">
                <div style="display: flex; align-items: center; gap: 10px; padding: 15px; border: 2px solid ${isSelected ? '#2C8EC4' : '#ddd'}; border-radius: 8px; background: ${isSelected ? '#f0f8ff' : '#fff'}; transition: all 0.3s;">
                    <span style="font-size: 24px;">${addon.icon || '➕'}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 5px;">${addon.display_name}</div>
                        <div style="color: #2C8EC4; font-weight: 600;">NT$ ${addon.price.toLocaleString()}/每${unitLabel}</div>
                        ${hasDetailContent ? `<button type="button" class="addon-detail-link" onclick="showAddonDetailModal('${encodedName}')">查看詳情</button>` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button type="button" class="addon-quantity-btn" onclick="changeAddonQuantity('${addon.name}', -1)" style="width: 32px; height: 32px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; color: #666;" ${quantity === 0 ? 'disabled' : ''}>−</button>
                        <span class="addon-quantity" style="min-width: 30px; text-align: center; font-weight: 600; font-size: 16px;">${quantity}</span>
                        <button type="button" class="addon-quantity-btn" onclick="changeAddonQuantity('${addon.name}', 1)" style="width: 32px; height: 32px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; color: #666;">+</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 改變加購商品數量
function changeAddonQuantity(addonName, change) {
    const addonDef = addons.find(a => a.name === addonName);
    if (!addonDef) return;
    if (isExtraBedAddon(addonDef)) return;

    const addonPrice = Number(addonDef.price) || 0;
    const unitLabel = formatAddonUnit(addonDef.unit_label);
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
        selectedAddons.push({
            name: addonName,
            display_name: addonDef.display_name || addonName,
            price: addonPrice,
            unit_label: unitLabel,
            quantity: 1
        });
        newQuantity = 1;
    }
    
    // 重新渲染加購商品列表
    renderAddons();
    
    // 重新計算價格
    calculatePrice();
}

function getExtraBedCapacityFromAddons() {
    if (!enableAddons || !Array.isArray(selectedAddons) || selectedAddons.length === 0) return 0;
    return selectedAddons.reduce((sum, addon) => {
        const name = String(addon.name || '').trim();
        const displayName = String(addon.display_name || '').trim();
        const quantity = Number(addon.quantity || 0);
        const isExtraBed = name === 'extra_bed' || /加床/.test(displayName) || /加床/.test(name);
        if (!isExtraBed || quantity <= 0) return sum;
        return sum + quantity;
    }, 0);
}

function getTotalRoomExtraBeds() {
    return Object.values(selectedRoomExtraBeds).reduce((sum, value) => sum + (parseInt(value || '0', 10) || 0), 0);
}

function buildRoomExtraBedAddonsForSubmit(roomSelections) {
    if (!Array.isArray(roomSelections)) return [];
    return roomSelections
        .filter((room) => Number(room.selectedExtraBeds || 0) > 0 && Number(room.extraBedPrice || 0) > 0)
        .map((room) => ({
            name: `room_extra_bed_${room.name}`,
            display_name: `${room.displayName} 加床`,
            price: Number(room.extraBedPrice || 0),
            quantity: Number(room.selectedExtraBeds || 0),
            unit_label: '人'
        }));
}

function calculateRoomExtraBedTotal(roomSelections) {
    if (!Array.isArray(roomSelections)) return 0;
    return roomSelections.reduce((sum, room) => {
        const qty = Number(room.selectedExtraBeds || 0);
        const unitPrice = Number(room.extraBedPrice || 0);
        return sum + (qty > 0 && unitPrice > 0 ? qty * unitPrice : 0);
    }, 0);
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
        const emptyMsg =
            currentSystemMode === 'whole_property' ? '目前沒有可用的包棟方案' : '目前沒有可用的房型';
        grid.innerHTML = `<div class="loading">${emptyMsg}</div>`;
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
    
    roomGalleryData = {};
    roomFacilitiesData = {};

    const isWholePropertyMode = normalizeSystemMode(currentSystemMode) === 'whole_property';

    grid.innerHTML = roomTypes.map((room, index) => {
        const isUnavailable = hasDates && unavailableRooms.includes(room.name);
        const roomOptionClass = isUnavailable ? 'room-option unavailable' : 'room-option';
        const disabledAttr = isUnavailable ? 'disabled' : '';
        const roomId = room.id != null ? String(room.id) : `idx-${index}`;
        
        const holidaySurcharge = room.holiday_surcharge || 0;
        // 根據入住日期判斷顯示平日價格還是假日價格
        // 注意：即使 holidaySurcharge 為 0，如果日期是假日，也應該顯示假日價格（雖然價格相同）
        const displayPrice = (checkInDate && isCheckInHoliday) 
            ? (room.price + holidaySurcharge) 
            : room.price;
        let priceDisplay = '';
        const originalPrice = Number(room.original_price || 0);
        
        if (isUnavailable) {
            priceDisplay = '';
        } else {
            const originalPriceHtml = originalPrice > 0
                ? `<span class="room-price-old">NT$ ${originalPrice.toLocaleString()}</span>`
                : '';
            priceDisplay = `NT$ ${displayPrice.toLocaleString()}/晚${originalPriceHtml}`;
        }

        const displayName = String(room.display_name || room.name || '房型');
        const showRoomQtyControl = false;
        const bookingBadge = String(room.booking_badge || '').trim();
        const bedConfig = String(room.bed_config || '').trim();
        const maxOccupancy = room.max_occupancy != null ? Number(room.max_occupancy) : 0;
        const extraBeds = room.extra_beds != null ? Number(room.extra_beds) : 0;
        const extraBedUnitPrice = room.extra_bed_price != null ? Number(room.extra_bed_price) : 0;
        const roomBedTypes = Array.isArray(room.bed_types) ? room.bed_types.filter(Boolean) : [];
        const roomFacilitiesRaw = Array.isArray(room.room_facilities) ? room.room_facilities.filter(Boolean) : [];
        const roomFacilities = isWholePropertyMode
            ? [...bookingLandingFacilitiesItems]
            : [...new Set([...roomBedTypes, ...roomFacilitiesRaw])];
        const includedItems = Array.isArray(room.included_items_list) ? room.included_items_list.filter(Boolean) : [];
        roomFacilitiesData[roomId] = roomFacilities;

        const galleryImages = [];
        if (room.image_url) galleryImages.push(room.image_url);
        if (Array.isArray(room.gallery_images)) {
            room.gallery_images.forEach((imageUrl) => {
                if (imageUrl && !galleryImages.includes(imageUrl)) {
                    galleryImages.push(imageUrl);
                }
            });
        }
        roomGalleryData[roomId] = {
            name: displayName,
            images: galleryImages
        };

        const currentQty = Math.min(1, parseInt(selectedRoomQuantities[room.name] || '0', 10) || 0);
        if (isUnavailable) selectedRoomQuantities[room.name] = 0;
        const safeQty = isUnavailable ? 0 : currentQty;
        if (!isUnavailable) selectedRoomQuantities[room.name] = safeQty;
        const roomExtraBedLimit = Math.max(0, extraBeds * safeQty);
        const selectedExtraBedQty = Math.min(
            roomExtraBedLimit,
            Math.max(0, parseInt(selectedRoomExtraBeds[room.name] || '0', 10) || 0)
        );
        selectedRoomExtraBeds[room.name] = selectedExtraBedQty;
        const selectBtnText = isUnavailable
            ? '滿房'
            : (safeQty > 0 ? '已選取' : (isWholePropertyMode ? '選取包棟' : '選取房型'));
        const selectBtnClass = isUnavailable ? 'room-select-btn is-unavailable' : 'room-select-btn';
        const selectBtnAction = isUnavailable ? '' : `onclick='selectRoomTypeByName(event, ${JSON.stringify(room.name)})'`;
        
        return `
        <div class="${roomOptionClass}" 
             data-room="${room.name}" 
             data-room-id="${roomId}"
             data-price="${room.price}" 
             data-holiday-surcharge="${holidaySurcharge}"
             data-max-occupancy="${room.max_occupancy != null ? room.max_occupancy : 0}"
             data-extra-beds="${room.extra_beds != null ? room.extra_beds : 0}">
            <input type="checkbox" id="room-${room.name}" name="roomType" value="${room.name}" ${disabledAttr} ${safeQty > 0 ? 'checked' : ''} onchange='toggleRoomTypeSelection(${JSON.stringify(room.name)}, this.checked)'>
            <label for="room-${room.name}">
                <div class="room-name">${escapeRoomText(displayName)}</div>
                <div class="room-card-layout">
                    <div class="room-card-left">
                        ${room.image_url 
                            ? `<div class="room-icon room-icon-image">
                                ${bookingBadge ? `<span class="room-photo-badge">${escapeRoomText(bookingBadge)}</span>` : ''}
                                <img src="${room.image_url}" alt="${escapeRoomText(displayName)}" loading="lazy" ${galleryImages.length > 0 ? `onclick="openRoomGallery(event, '${roomId}')"` : ''}>
                                ${galleryImages.length > 1 ? `<span class="room-gallery-hint"><span class="material-symbols-outlined">photo_library</span> ${galleryImages.length} 張照片</span>` : ''}
                            </div>` 
                            : `<div class="room-icon">${room.icon || '🏠'}</div>`}
                        ${includedItems.length > 0 ? `<div class="room-meta-item room-meta-item-included room-meta-item-under-photo"><strong>方案包含：</strong>${escapeRoomText(includedItems.join('、'))}</div>` : ''}
                    </div>
                    <div class="room-card-right">
                        <div class="room-basic-info">
                            <div class="room-meta-item"><strong>${isWholePropertyMode ? '開放房型：' : '床型：'}</strong>${escapeRoomText(bedConfig || '依現場安排')}</div>
                            <div class="room-meta-item"><strong>入住人數：</strong>${maxOccupancy} 人</div>
                            <div class="room-meta-item"><strong>可加床數：</strong>${extraBeds} 人</div>
                        </div>
                        ${extraBeds > 0 ? `
                            <div class="room-extra-bed-control" ${safeQty > 0 ? '' : 'style="display:none;"'}>
                                <span class="room-extra-bed-label">房型加床${extraBedUnitPrice > 0 ? `（NT$ ${extraBedUnitPrice.toLocaleString()}/人）` : ''}</span>
                                <div class="room-extra-bed-actions">
                                    <button type="button" class="room-extra-bed-btn" onclick='event.preventDefault(); event.stopPropagation(); changeRoomExtraBed(${JSON.stringify(room.name)}, -1)' ${selectedExtraBedQty <= 0 ? 'disabled' : ''}>−</button>
                                    <span class="room-extra-bed-value">${selectedExtraBedQty}</span>
                                    <button type="button" class="room-extra-bed-btn" onclick='event.preventDefault(); event.stopPropagation(); changeRoomExtraBed(${JSON.stringify(room.name)}, 1)' ${selectedExtraBedQty >= roomExtraBedLimit ? 'disabled' : ''}>+</button>
                                    <span class="room-extra-bed-limit">/ ${roomExtraBedLimit}</span>
                                </div>
                            </div>
                        ` : ''}
                        ${roomFacilities.length > 0
                            ? `<div class="room-meta-item room-meta-item-facilities"><strong>${isWholePropertyMode ? '旅宿設施：' : '房型設施：'}</strong></div><div id="roomFacilitiesBlock-${roomId}" class="room-facilities-block">${buildRoomFacilitiesBlock(roomId)}</div>`
                            : ''}
                        <div class="room-card-bottom">
                            <div class="room-price ${isUnavailable ? 'unavailable-price' : ''}">
                                ${priceDisplay}
                            </div>
                            <div class="room-option-actions">
                                <button type="button" class="${selectBtnClass}" ${selectBtnAction}>${selectBtnText}</button>
                                ${showRoomQtyControl ? `<div class="room-qty-control">
                                    <button type="button" class="room-qty-btn room-qty-btn-minus" onclick='event.preventDefault(); event.stopPropagation(); changeRoomTypeQuantity(${JSON.stringify(room.name)}, -1)' ${safeQty <= 0 ? 'disabled' : ''}>−</button>
                                    <span class="room-qty-value">${safeQty}</span>
                                    <button type="button" class="room-qty-btn room-qty-btn-plus" onclick='event.preventDefault(); event.stopPropagation(); changeRoomTypeQuantity(${JSON.stringify(room.name)}, 1)'>+</button>
                                </div>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </label>
        </div>
    `;
    }).join('');
    
    updateRoomSelectButtons();
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
    calculatePrice();
}

function getSelectedRoomSelections() {
    return roomTypes
        .map((room) => {
            const quantity = parseInt(selectedRoomQuantities[room.name] || '0', 10) || 0;
            if (quantity <= 0) return null;
            const maxExtraBeds = Math.max(0, Number(room.extra_beds || 0) * quantity);
            const selectedExtraBeds = Math.min(
                maxExtraBeds,
                Math.max(0, parseInt(selectedRoomExtraBeds[room.name] || '0', 10) || 0)
            );
            return {
                name: room.name,
                displayName: room.display_name || room.name,
                quantity,
                price: Number(room.price || 0),
                maxOccupancy: Number(room.max_occupancy || 0),
                extraBeds: Number(room.extra_beds || 0),
                extraBedPrice: Number(room.extra_bed_price || 0),
                selectedExtraBeds
            };
        })
        .filter(Boolean);
}

function getTotalSelectedRoomCount() {
    return getSelectedRoomSelections().reduce((sum, room) => sum + room.quantity, 0);
}

async function computeRoomPricing(checkInDate, checkOutDate, roomSelections) {
    const selections = Array.isArray(roomSelections) ? roomSelections.filter(s => s && s.quantity > 0) : [];
    if (selections.length === 0) {
        return { roomTotal: 0, averagePricePerNight: 0, nights: 0 };
    }

    if (!checkInDate || !checkOutDate) {
        const nights = calculateNights();
        const roomTotal = selections.reduce((sum, room) => sum + (room.price * room.quantity * nights), 0);
        const totalRooms = selections.reduce((sum, room) => sum + room.quantity, 0);
        const averagePricePerNight = (nights > 0 && totalRooms > 0)
            ? Math.round(roomTotal / (nights * totalRooms))
            : 0;
        return { roomTotal, averagePricePerNight, nights };
    }

    const perRoomResults = await Promise.all(selections.map(async (room) => {
        const bid = getSelectedBuildingId();
        const response = await fetch(`/api/calculate-price?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&buildingId=${encodeURIComponent(bid)}&roomTypeName=${encodeURIComponent(room.displayName)}`);
        const result = await response.json();
        if (!result.success || !result.data) {
            throw new Error(result.message || `計算 ${room.displayName} 價格失敗`);
        }
        return {
            quantity: room.quantity,
            totalAmountPerRoom: Number(result.data.totalAmount || 0),
            nights: Number(result.data.nights || 0)
        };
    }));

    const nights = perRoomResults[0]?.nights || 0;
    const roomTotal = perRoomResults.reduce((sum, row) => sum + (row.totalAmountPerRoom * row.quantity), 0);
    const totalRooms = selections.reduce((sum, room) => sum + room.quantity, 0);
    const averagePricePerNight = (nights > 0 && totalRooms > 0)
        ? Math.round(roomTotal / (nights * totalRooms))
        : 0;
    return { roomTotal, averagePricePerNight, nights };
}

function syncRoomSelectionCard(roomName) {
    const option = Array.from(document.querySelectorAll('.room-option')).find(el => el.dataset.room === roomName);
    if (!option) return;
    const checkbox = option.querySelector('input[name="roomType"]');
    const qtyEl = option.querySelector('.room-qty-value');
    const minusBtn = option.querySelector('.room-qty-btn-minus');
    const extraBedControlEl = option.querySelector('.room-extra-bed-control');
    const extraBedValueEl = option.querySelector('.room-extra-bed-value');
    const extraBedButtons = option.querySelectorAll('.room-extra-bed-btn');
    const extraBedLimitEl = option.querySelector('.room-extra-bed-limit');
    const qty = parseInt(selectedRoomQuantities[roomName] || '0', 10) || 0;
    const roomDef = roomTypes.find((room) => room.name === roomName);
    const extraBedLimit = Math.max(0, Number(roomDef?.extra_beds || 0) * qty);
    const currentExtraBed = Math.min(
        extraBedLimit,
        Math.max(0, parseInt(selectedRoomExtraBeds[roomName] || '0', 10) || 0)
    );
    selectedRoomExtraBeds[roomName] = currentExtraBed;
    if (checkbox) checkbox.checked = qty > 0;
    if (qtyEl) qtyEl.textContent = String(qty);
    if (minusBtn) minusBtn.disabled = qty <= 0;
    if (extraBedControlEl) extraBedControlEl.style.display = qty > 0 && extraBedLimit > 0 ? '' : 'none';
    if (extraBedValueEl) extraBedValueEl.textContent = String(currentExtraBed);
    if (extraBedLimitEl) extraBedLimitEl.textContent = `/ ${extraBedLimit}`;
    if (extraBedButtons.length >= 2) {
        const [minus, plus] = extraBedButtons;
        if (minus) minus.disabled = currentExtraBed <= 0;
        if (plus) plus.disabled = currentExtraBed >= extraBedLimit;
    }
    option.classList.toggle('selected-room', qty > 0);
}

function changeRoomTypeQuantity(roomName, delta) {
    const current = parseInt(selectedRoomQuantities[roomName] || '0', 10) || 0;
    let next = current;

    if (delta > 0) {
        next = Math.min(1, current + delta);
    } else {
        next = Math.max(0, current + delta);
    }

    selectedRoomQuantities[roomName] = next;
    if (next > 0) {
        enforceWholePropertySingleSelection(roomName);
    }
    if (next <= 0) selectedRoomExtraBeds[roomName] = 0;
    syncRoomSelectionCard(roomName);
    updateRoomSelectButtons();
    clearSectionError('roomTypeGrid');
    calculatePrice();
    if (appliedPromoCode) applyPromoCode();
}

function toggleRoomTypeSelection(roomName, checked) {
    selectedRoomQuantities[roomName] = checked ? 1 : 0;
    if (checked) {
        enforceWholePropertySingleSelection(roomName);
    }
    if (!checked) selectedRoomExtraBeds[roomName] = 0;
    syncRoomSelectionCard(roomName);
    updateRoomSelectButtons();
    clearSectionError('roomTypeGrid');
    calculatePrice();
    if (appliedPromoCode) applyPromoCode();
}

function changeRoomExtraBed(roomName, delta) {
    const roomDef = roomTypes.find((room) => room.name === roomName);
    if (!roomDef) return;
    const quantity = parseInt(selectedRoomQuantities[roomName] || '0', 10) || 0;
    const limit = Math.max(0, Number(roomDef.extra_beds || 0) * quantity);
    if (limit <= 0) {
        selectedRoomExtraBeds[roomName] = 0;
        syncRoomSelectionCard(roomName);
        return;
    }
    const current = Math.max(0, parseInt(selectedRoomExtraBeds[roomName] || '0', 10) || 0);
    const next = Math.min(limit, Math.max(0, current + delta));
    selectedRoomExtraBeds[roomName] = next;
    syncRoomSelectionCard(roomName);
    calculatePrice();
    if (appliedPromoCode) applyPromoCode();
}

function getRoomCount() {
    const roomsInput = document.getElementById('rooms');
    const fallback = roomCountConfig.min || 1;
    const rooms = parseInt(roomsInput?.value || String(fallback), 10);
    return Number.isFinite(rooms) && rooms > 0 ? rooms : fallback;
}

function changeRoomCount(delta) {
    const roomsInput = document.getElementById('rooms');
    const roomsDisplay = document.getElementById('roomsDisplay');
    if (!roomsInput || !roomsDisplay) return;
    const current = parseInt(roomsInput.value || String(roomCountConfig.min), 10) || roomCountConfig.min;
    const next = Math.min(roomCountConfig.max, Math.max(roomCountConfig.min, current + delta));
    roomsInput.value = String(next);
    roomsDisplay.textContent = String(next);
    updateTopRoomCounterButtonState();
    Object.keys(selectedRoomQuantities).forEach((roomName) => syncRoomSelectionCard(roomName));
    updateRoomSelectButtons();
    clearSectionError('roomTypeGrid');
    calculatePrice();
}

// 頁面載入時執行
applyBuildingIdFromUrl();
applyRoomTypeIdFromUrl();
loadRoomTypesAndSettings();

// 頁面載入後，如果有日期，檢查房間可用性
document.addEventListener('DOMContentLoaded', async function() {
    await initSystemMode();
    forceRoomCounterButtonsVisibility(true);
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
            if (inputId === 'guestEmail') {
                input.addEventListener('blur', function() {
                    // Email 變更後重新計算，更新會員折扣顯示
                    calculatePrice();
                });
            }
        }
    });

    setupSpecialRequestToggle();
    
    setTimeout(() => {
        const checkInDate = document.getElementById('checkInDate').value;
        const checkOutDate = document.getElementById('checkOutDate').value;
        if (checkInDate && checkOutDate) {
            checkRoomAvailability();
        }
    }, 500);
});

function setupSpecialRequestToggle() {
    const toggle = document.getElementById('specialRequestToggle');
    const fields = document.getElementById('specialRequestFields');
    const textarea = document.getElementById('specialRequest');
    if (!toggle || !fields || !textarea) return;

    const syncSpecialRequestVisibility = () => {
        const enabled = !!toggle.checked;
        fields.classList.toggle('is-open', enabled);
        textarea.disabled = !enabled;

        // 關閉時清空，避免送出舊資料。
        if (!enabled && textarea.value) {
            textarea.value = '';
        }
    };

    toggle.addEventListener('change', syncSpecialRequestVisibility);
    syncSpecialRequestVisibility();
}

// 容納人數提醒模態框按鈕事件
document.addEventListener('DOMContentLoaded', function() {
    const cancelBtn = document.getElementById('capacityCancelBtn');
    const confirmBtn = document.getElementById('capacityConfirmBtn');
    const addonDetailCloseBtn = document.getElementById('addonDetailCloseBtn');
    const addonDetailModal = document.getElementById('addonDetailModal');
    const bookingCancellationPolicyBtn = document.getElementById('bookingCancellationPolicyBtn');
    const bookingCancellationCloseBtn = document.getElementById('bookingCancellationCloseBtn');
    const bookingCancellationModal = document.getElementById('bookingCancellationModal');
    const bookingTermsAgree = document.getElementById('bookingTermsAgree');
    const roomGalleryModal = document.getElementById('roomGalleryModal');
    const roomGalleryCloseBtn = document.getElementById('roomGalleryCloseBtn');
    const roomGalleryPrevBtn = document.getElementById('roomGalleryPrevBtn');
    const roomGalleryNextBtn = document.getElementById('roomGalleryNextBtn');
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
    if (addonDetailCloseBtn) {
        addonDetailCloseBtn.addEventListener('click', () => {
            hideAddonDetailModal();
        });
    }
    if (addonDetailModal) {
        addonDetailModal.addEventListener('click', (event) => {
            if (event.target === addonDetailModal) {
                hideAddonDetailModal();
            }
        });
    }
    if (bookingCancellationPolicyBtn) {
        bookingCancellationPolicyBtn.addEventListener('click', openBookingCancellationModal);
    }
    if (bookingCancellationCloseBtn) {
        bookingCancellationCloseBtn.addEventListener('click', closeBookingCancellationModal);
    }
    if (bookingCancellationModal) {
        bookingCancellationModal.addEventListener('click', (event) => {
            if (event.target === bookingCancellationModal) {
                closeBookingCancellationModal();
            }
        });
    }
    if (roomGalleryCloseBtn) {
        roomGalleryCloseBtn.addEventListener('click', hideRoomGalleryModal);
    }
    if (roomGalleryPrevBtn) {
        roomGalleryPrevBtn.addEventListener('click', () => changeRoomGalleryImage(-1));
    }
    if (roomGalleryNextBtn) {
        roomGalleryNextBtn.addEventListener('click', () => changeRoomGalleryImage(1));
    }
    if (roomGalleryModal) {
        roomGalleryModal.addEventListener('click', (event) => {
            if (event.target === roomGalleryModal) {
                hideRoomGalleryModal();
            }
        });
    }
    if (bookingTermsAgree) {
        bookingTermsAgree.addEventListener('change', () => {
            if (bookingTermsAgree.checked) {
                clearSectionError('bookingTermsSection');
            }
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideAddonDetailModal();
            closeBookingCancellationModal();
            hideRoomGalleryModal();
        } else if (event.key === 'ArrowLeft') {
            if (roomGalleryModal && !roomGalleryModal.classList.contains('hidden')) {
                changeRoomGalleryImage(-1);
            }
        } else if (event.key === 'ArrowRight') {
            if (roomGalleryModal && !roomGalleryModal.classList.contains('hidden')) {
                changeRoomGalleryImage(1);
            }
        }
    });
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

// 檢查早鳥優惠
async function checkEarlyBirdDiscount(checkInDate, roomTypeName, totalAmount) {
    try {
        console.log('🐦 檢查早鳥優惠...', { checkInDate, roomTypeName, totalAmount });
        const response = await fetch('/api/early-bird/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkInDate, roomTypeName, totalAmount })
        });
        
        if (!response.ok) {
            console.error('🐦 早鳥優惠 API 錯誤:', response.status, response.statusText);
            earlyBirdDiscount = null;
            return null;
        }
        
        const result = await response.json();
        console.log('🐦 早鳥優惠 API 回應:', JSON.stringify(result));
        
        if (result.success && result.data && result.data.applicable) {
            earlyBirdDiscount = result.data;
            console.log('🐦 早鳥優惠可用:', earlyBirdDiscount.rule.name, '折扣:', earlyBirdDiscount.discount_amount);
            return earlyBirdDiscount;
        } else {
            earlyBirdDiscount = null;
            console.log('🐦 無符合的早鳥優惠');
            return null;
        }
    } catch (error) {
        console.error('🐦 檢查早鳥優惠錯誤:', error);
        earlyBirdDiscount = null;
        return null;
    }
}

// 計算早鳥折扣金額
function calculateEarlyBirdDiscountAmount(totalAmount) {
    if (!earlyBirdDiscount || !earlyBirdDiscount.rule) return 0;
    
    const rule = earlyBirdDiscount.rule;
    let discountAmount = 0;
    
    if (rule.discount_type === 'fixed') {
        discountAmount = rule.discount_value;
    } else if (rule.discount_type === 'percent') {
        discountAmount = totalAmount * (rule.discount_value / 100);
        if (rule.max_discount && discountAmount > rule.max_discount) {
            discountAmount = rule.max_discount;
        }
    }
    
    return Math.round(discountAmount);
}

// 檢查會員折扣（依歷史已付款且有效訂單）
async function checkMemberLevelDiscount(guestEmail, totalAmount) {
    try {
        const email = String(guestEmail || '').trim().toLowerCase();
        if (!email) {
            memberLevelDiscount = null;
            return null;
        }

        const response = await fetch('/api/member-discount/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guestEmail: email, totalAmount })
        });

        if (!response.ok) {
            memberLevelDiscount = null;
            return null;
        }

        const result = await response.json();
        if (result.success && result.data) {
            memberLevelDiscount = result.data;
            return memberLevelDiscount;
        }

        memberLevelDiscount = null;
        return null;
    } catch (error) {
        console.warn('⚠️ 檢查會員折扣失敗:', error.message);
        memberLevelDiscount = null;
        return null;
    }
}

function calculateMemberDiscountAmount(totalAmount) {
    const percent = parseFloat(memberLevelDiscount?.discount_percent || 0);
    if (percent <= 0 || totalAmount <= 0) return 0;
    return Math.round(totalAmount * (percent / 100));
}

// 計算價格（考慮平日/假日）
async function calculatePrice() {
    clearCapacityWarning();
    const roomSelections = getSelectedRoomSelections();
    const roomsCount = getTotalSelectedRoomCount();
    if (roomSelections.length === 0) {
        updatePriceDisplay(0, 0, 0, 0, 'deposit', 0, 0, null, 0, 0, 0, roomsCount, []);
        return;
    }

    const checkInDate = document.getElementById('checkInDate').value;
    const checkOutDate = document.getElementById('checkOutDate').value;
    const roomTypeValue = roomSelections[0]?.name || '';
    
    // 計算加購商品總金額（排除「加床」，改由房型內加床處理）
    const nonExtraBedAddons = enableAddons ? selectedAddons.filter((addon) => !isExtraBedAddon(addon)) : [];
    const addonsTotal = nonExtraBedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0);
    const roomExtraBedTotal = calculateRoomExtraBedTotal(roomSelections);
    
    // 內部函數：計算折扣並更新顯示
    function applyDiscountsAndDisplay(pricePerNight, nights, roomTotal) {
        let totalAmount = roomTotal + addonsTotal + roomExtraBedTotal;
        const originalTotal = totalAmount;
        
        // 0. 計算會員等級折扣
        let memberDiscountAmount = 0;
        if (memberLevelDiscount && memberLevelDiscount.applicable) {
            memberDiscountAmount = calculateMemberDiscountAmount(totalAmount);
        }
        
        // 1. 計算早鳥折扣
        let ebDiscountAmount = 0;
        console.log('🐦 applyDiscountsAndDisplay - earlyBirdDiscount:', earlyBirdDiscount ? JSON.stringify(earlyBirdDiscount) : 'null');
        if (earlyBirdDiscount && earlyBirdDiscount.applicable) {
            ebDiscountAmount = calculateEarlyBirdDiscountAmount(totalAmount);
            console.log('🐦 早鳥折扣金額:', ebDiscountAmount);
        }
        
        // 2. 計算優惠代碼折扣
        let promoDiscountAmount = 0;
        if (appliedPromoCode) {
            // 檢查是否可疊加
            const canCombine = appliedPromoCode.can_combine_with_early_bird === 1;
            if (ebDiscountAmount > 0 && !canCombine) {
                // 不能疊加，取較大的
                const promoCalc = calculatePromoCodeDiscount(appliedPromoCode, totalAmount);
                if (promoCalc > ebDiscountAmount) {
                    promoDiscountAmount = promoCalc;
                    ebDiscountAmount = 0;
                }
            } else {
                promoDiscountAmount = calculatePromoCodeDiscount(appliedPromoCode, totalAmount);
            }
        }
        
        const totalDiscount = memberDiscountAmount + ebDiscountAmount + promoDiscountAmount;
        totalAmount = Math.max(0, totalAmount - totalDiscount);
        
        const paymentAmount = document.querySelector('input[name="paymentAmount"]:checked').value;
        const depositRate = depositPercentage / 100;
        const paymentType = paymentAmount === 'deposit' ? depositRate : 1;
        const finalAmount = totalAmount * paymentType;
        
        updatePriceDisplay(pricePerNight, nights, originalTotal, totalDiscount, paymentAmount, finalAmount, addonsTotal, null, memberDiscountAmount, ebDiscountAmount, promoDiscountAmount, roomsCount, roomSelections, roomExtraBedTotal);
    }
    
    if (!checkInDate || !checkOutDate) {
        // 如果沒有選擇日期，使用基礎價格估算
        earlyBirdDiscount = null;
        const { roomTotal, averagePricePerNight: pricePerNight, nights } = await computeRoomPricing('', '', roomSelections);
        const guestEmail = document.getElementById('guestEmail')?.value || '';
        await checkMemberLevelDiscount(guestEmail, roomTotal + addonsTotal);
        applyDiscountsAndDisplay(pricePerNight, nights, roomTotal);
        return;
    }

    // 使用新的 API 計算價格（考慮假日）
    try {
        const { roomTotal, averagePricePerNight, nights } = await computeRoomPricing(checkInDate, checkOutDate, roomSelections);
        if (roomSelections.length === 1) {
            await checkEarlyBirdDiscount(checkInDate, roomTypeValue, roomTotal + addonsTotal);
        } else {
            earlyBirdDiscount = null;
        }
        const guestEmail = document.getElementById('guestEmail')?.value || '';
        await checkMemberLevelDiscount(guestEmail, roomTotal + addonsTotal);
        applyDiscountsAndDisplay(averagePricePerNight, nights, roomTotal);
    } catch (error) {
        console.error('計算價格錯誤:', error);
        const { roomTotal, averagePricePerNight: pricePerNight, nights } = await computeRoomPricing('', '', roomSelections);
        if (roomSelections.length === 1) {
            await checkEarlyBirdDiscount(checkInDate, roomTypeValue, roomTotal + addonsTotal);
        } else {
            earlyBirdDiscount = null;
        }
        const guestEmail = document.getElementById('guestEmail')?.value || '';
        await checkMemberLevelDiscount(guestEmail, roomTotal + addonsTotal);
        applyDiscountsAndDisplay(pricePerNight, nights, roomTotal);
    }
}

// 更新訂金標籤
function updateDepositLabel() {
    const depositLabel = document.getElementById('depositLabel');
    if (depositLabel) {
        depositLabel.textContent = `支付訂金 (${depositPercentage}%)`;
    }
}

function setBookingSubmitButtonState(disabled, text = null) {
    const submitBtn = document.querySelector('#bookingForm .submit-btn');
    if (!submitBtn) return;

    submitBtn.disabled = !!disabled;
    if (text) {
        submitBtn.innerHTML = `<span>${text}</span>`;
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
    const paymentMethodGroup = document.querySelector('.payment-method-group');
    const paymentMethodRadioGroup = paymentMethodGroup ? paymentMethodGroup.querySelector('.radio-group') : null;
    
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
        if (paymentMethodGroup) {
            if (paymentMethodRadioGroup) {
                paymentMethodRadioGroup.style.display = 'none';
            }

            let unavailableHint = paymentMethodGroup.querySelector('.payment-method-unavailable-hint');
            if (!unavailableHint) {
                unavailableHint = document.createElement('p');
                unavailableHint.className = 'payment-method-unavailable-hint';
                unavailableHint.style.color = '#e74c3c';
                unavailableHint.style.padding = '10px 0';
                unavailableHint.textContent = '目前沒有可用的付款方式，請聯繫客服';
                paymentMethodGroup.appendChild(unavailableHint);
            }

            if (transferOption) transferOption.checked = false;
            if (cardOption) cardOption.checked = false;
        }
        setBookingSubmitButtonState(true, '目前暫停受理');
    } else {
        if (paymentMethodRadioGroup) {
            paymentMethodRadioGroup.style.display = '';
        }
        if (paymentMethodGroup) {
            const unavailableHint = paymentMethodGroup.querySelector('.payment-method-unavailable-hint');
            if (unavailableHint) unavailableHint.remove();
        }
        setBookingSubmitButtonState(false, '確認訂房');

        // 確保至少有一種可用付款方式被選中
        const selectedPaymentMethod = document.querySelector('input[name="paymentMethod"]:checked');
        if (!selectedPaymentMethod) {
            if (enableTransfer && transferOption) {
                transferOption.checked = true;
            } else if (enableCard && cardOption) {
                cardOption.checked = true;
            }
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
    const roomSelections = getSelectedRoomSelections();
    if (roomSelections.length === 0 || !checkInDate) {
        messageDiv.innerHTML = '<span style="color: #dc2626;">請先選擇房型和日期</span>';
        return;
    }
    const roomTypeName = roomSelections[0]?.displayName || '';
    
    // 先計算當前總金額（不含折扣）
    const checkOutDate = document.getElementById('checkOutDate').value;
    if (!checkOutDate) {
        messageDiv.innerHTML = '<span style="color: #dc2626;">請選擇退房日期</span>';
        return;
    }
    
    try {
        // 取得當前總金額
        const pricing = await computeRoomPricing(checkInDate, checkOutDate, roomSelections);
        if (!pricing || !Number.isFinite(pricing.roomTotal)) {
            messageDiv.innerHTML = '<span style="color: #dc2626;">無法計算價格，請重新選擇日期</span>';
            return;
        }
        
        const addonsTotal = enableAddons
            ? selectedAddons.filter((addon) => !isExtraBedAddon(addon)).reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0)
            : 0;
        const totalAmount = pricing.roomTotal + addonsTotal + calculateRoomExtraBedTotal(roomSelections);
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
function updatePriceDisplay(pricePerNight, nights, totalAmount, discountAmount = 0, paymentType, finalAmount = 0, addonsTotal = 0, depositPercent = null, memberAmount = 0, earlyBirdAmount = 0, promoAmount = 0, roomsCount = 1, roomSelections = [], roomExtraBedTotal = 0) {
    // 如果沒有提供 depositPercent，使用全域變數
    if (depositPercent === null) {
        depositPercent = depositPercentage;
    }
    
    const normalizedSelections = Array.isArray(roomSelections)
        ? roomSelections.filter((room) => room && Number(room.quantity || 0) > 0)
        : [];
    const roomUnitText = roomsCount > 1 ? ` x ${roomsCount} 間` : '';
    const roomPriceText = normalizedSelections.length > 1
        ? normalizedSelections
            .map((room) => `NT$ ${Number(room.price || 0).toLocaleString()} x ${Number(room.quantity || 0)} 間`)
            .join(' + ')
        : `NT$ ${pricePerNight.toLocaleString()}${roomUnitText}`;
    document.getElementById('roomPricePerNight').textContent = roomPriceText;
    document.getElementById('nightsCount').textContent = roomsCount > 1 ? `${nights} 晚 x ${roomsCount} 間` : `${nights} 晚`;
    
    // 顯示總金額（包含折扣明細）
    const totalAmountElement = document.getElementById('totalAmount');
    const roomTotal = totalAmount - addonsTotal - roomExtraBedTotal;
    let html = '';
    
    // 房型總額
    if (roomExtraBedTotal > 0 || addonsTotal > 0) {
        html += `<div style="margin-bottom: 5px; color: #666;">房型總額：NT$ ${roomTotal.toLocaleString()}</div>`;
        if (roomExtraBedTotal > 0) {
            const extraBedDetail = normalizedSelections
                .filter((room) => Number(room.selectedExtraBeds || 0) > 0)
                .map((room) => `${room.displayName} x${Number(room.selectedExtraBeds || 0)}`)
                .join('、');
            html += `<div style="margin-bottom: 5px; color: #666;">房型內加床（${extraBedDetail}）：NT$ ${roomExtraBedTotal.toLocaleString()}</div>`;
        }
        // 加購商品明細
        const addonsDetail = selectedAddons
            .filter((addon) => !isExtraBedAddon(addon))
            .map(addon => {
            const addonName = addons.find(a => a.name === addon.name)?.display_name || addon.name;
            const unitLabel = formatAddonUnit(addon.unit_label || addons.find(a => a.name === addon.name)?.unit_label);
            return `${addonName} x${addon.quantity || 1}（每${unitLabel}）`;
        }).join('、');
        if (addonsTotal > 0) {
            html += `<div style="margin-bottom: 5px; color: #666;">加購商品（${addonsDetail}）：NT$ ${addonsTotal.toLocaleString()}</div>`;
        }
    }
    
    // 顯示總金額（原始總金額，折扣前）
    html += `<div style="margin-bottom: 5px; color: #333;">總金額：NT$ ${totalAmount.toLocaleString()}</div>`;
    
    // 顯示早鳥優惠折扣
    if (earlyBirdAmount > 0 && earlyBirdDiscount && earlyBirdDiscount.rule) {
        const ruleName = earlyBirdDiscount.rule.name;
        const daysInfo = earlyBirdDiscount.days_before_checkin;
        html += `<div style="margin-bottom: 5px; color: #f59e0b; font-weight: 600;">
            <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">nest_eco_leaf</span>
            早鳥優惠（${ruleName}，提前${daysInfo}天）：-NT$ ${earlyBirdAmount.toLocaleString()}
        </div>`;
    }
    
    // 顯示會員折扣
    if (memberAmount > 0 && memberLevelDiscount) {
        const levelName = memberLevelDiscount.level_name || '會員';
        const percent = parseFloat(memberLevelDiscount.discount_percent || 0);
        html += `<div style="margin-bottom: 5px; color: #2563eb; font-weight: 600;">會員折扣（${levelName}${percent > 0 ? ` ${percent}%` : ''}）：-NT$ ${memberAmount.toLocaleString()}</div>`;
    }

    // 顯示優惠代碼折扣
    if (promoAmount > 0 && appliedPromoCode) {
        html += `<div style="margin-bottom: 5px; color: #10b981; font-weight: 600;">優惠折扣（${appliedPromoCode.name}）：-NT$ ${promoAmount.toLocaleString()}</div>`;
    }
    
    // 顯示折抵後金額
    const totalDiscountAmount = (memberAmount || 0) + (earlyBirdAmount || 0) + (promoAmount || 0);
    if (totalDiscountAmount > 0) {
        const finalTotal = totalAmount - totalDiscountAmount;
        html += `<div style="font-weight: 700; font-size: 18px; color: #2C8EC4; border-top: 2px solid #ddd; padding-top: 5px; margin-top: 5px;">折抵後金額：NT$ ${finalTotal.toLocaleString()}</div>`;
    }
    
    totalAmountElement.innerHTML = html || `NT$ ${totalAmount.toLocaleString()}`;
    
    const paymentLabel = paymentType === 'deposit' ? `應付訂金 (${depositPercent}%)` : '應付全額';
    document.getElementById('paymentTypeLabel').textContent = paymentLabel;
    document.getElementById('paymentAmount').textContent = `NT$ ${finalAmount.toLocaleString()}`;
    
    // 更新早鳥優惠提示區塊
    updateEarlyBirdNotice();
}

// 更新早鳥優惠提示區塊
function updateEarlyBirdNotice() {
    let noticeEl = document.getElementById('earlyBirdNotice');
    
    // 如果元素不存在，建立在價格摘要區之前
    if (!noticeEl) {
        const priceSummarySection = document.querySelector('.price-summary');
        if (priceSummarySection && priceSummarySection.parentNode) {
            noticeEl = document.createElement('div');
            noticeEl.id = 'earlyBirdNotice';
            noticeEl.className = 'form-section';
            noticeEl.style.display = 'none';
            priceSummarySection.parentNode.insertBefore(noticeEl, priceSummarySection);
        } else {
            return;
        }
    }
    
    if (earlyBirdDiscount && earlyBirdDiscount.applicable && earlyBirdDiscount.rule) {
        const rule = earlyBirdDiscount.rule;
        const days = earlyBirdDiscount.days_before_checkin;
        
        let discountText = '';
        if (rule.discount_type === 'percent') {
            const offPercent = (100 - rule.discount_value) / 10;
            discountText = `享 ${offPercent} 折優惠`;
            if (rule.max_discount) {
                discountText += `（最高折抵 NT$ ${rule.max_discount.toLocaleString()}）`;
            }
        } else {
            discountText = `折抵 NT$ ${parseInt(rule.discount_value).toLocaleString()}`;
        }
        
        noticeEl.innerHTML = `
            <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #f59e0b; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 12px;">
                <span class="material-symbols-outlined" style="font-size: 32px; color: #d97706;">nest_eco_leaf</span>
                <div>
                    <div style="font-weight: 700; color: #92400e; font-size: 15px; margin-bottom: 4px;">
                        🎉 恭喜！您符合早鳥優惠
                    </div>
                    <div style="color: #78350f; font-size: 14px;">
                        您提前 <strong>${days}</strong> 天預訂，${discountText}
                    </div>
                    <div style="color: #92400e; font-size: 12px; margin-top: 4px;">
                        ${rule.name}${rule.description ? ' — ' + rule.description : ''}（系統自動套用，無需輸入代碼）
                    </div>
                </div>
            </div>`;
        noticeEl.style.display = 'block';
    } else {
        noticeEl.style.display = 'none';
        noticeEl.innerHTML = '';
    }
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
        const bid = getSelectedBuildingId();
        const response = await fetch(`/api/room-availability?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&buildingId=${encodeURIComponent(bid)}`);
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

function showCapacityWarning(message) {
    const warningEl = document.getElementById('bookingCapacityWarning');
    if (!warningEl) return;
    warningEl.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle; margin-right: 8px;">warning</span>${message}`;
    warningEl.classList.remove('hidden');
    warningEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearCapacityWarning() {
    const warningEl = document.getElementById('bookingCapacityWarning');
    if (!warningEl) return;
    warningEl.textContent = '';
    warningEl.classList.add('hidden');
}

// 表單提交
document.getElementById('bookingForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitBtn = this.querySelector('.submit-btn');
    clearCapacityWarning();
    
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
    const roomTypeGrid = document.getElementById('roomTypeGrid');
    const roomSelections = getSelectedRoomSelections();
    const selectedRoomCount = roomSelections.reduce((sum, item) => sum + item.quantity, 0);

    if (roomSelections.length === 0) {
        const roomTypeRadios = document.querySelectorAll('input[name="roomType"]');
        if (roomTypeRadios.length === 0) {
            const errMsg =
                currentSystemMode === 'whole_property'
                    ? '目前沒有可用的包棟方案，請稍後再試'
                    : '目前沒有可用的房型，請稍後再試';
            showSectionError('roomTypeGrid', errMsg);
            return;
        }
        showSectionError('roomTypeGrid', '請至少選擇 1 間房型');
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
    
    // 6. 付款方式驗證：必須至少有一種可用付款方式
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked');
    if (!paymentMethod) {
        const paymentMethodGroup = document.querySelector('.payment-method-group');
        const hasPaymentMethodInputs = document.querySelectorAll('input[name="paymentMethod"]').length > 0;
        if (hasPaymentMethodInputs) {
            await appAlert('目前無可用付款方式，請聯繫客服協助下單');
        } else {
            await appAlert('付款方式載入中，請稍後再試');
        }
        if (paymentMethodGroup) {
            paymentMethodGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    // 7. 付款方式驗證：如果入住日期為今天，不允許選擇匯款
    if (paymentMethod && paymentMethod.value === 'transfer') {
        const checkInDate = new Date(checkIn);
        checkInDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (checkInDate.getTime() === today.getTime()) {
            await appAlert('入住日期為今天時，無法選擇匯款轉帳，請選擇線上刷卡');
            const cardOption = document.querySelector('input[name="paymentMethod"][value="card"]');
            if (cardOption) {
                cardOption.checked = true;
            }
            return;
        }
    }

    // 8. 條款同意驗證（由後台設定控制）
    if (bookingTermsConfig.enabled) {
        const bookingTermsAgree = document.getElementById('bookingTermsAgree');
        if (!bookingTermsAgree || !bookingTermsAgree.checked) {
            showSectionError('bookingTermsSection', '送出訂房前，請先勾選同意使用條款與隱私政策');
            return;
        }
        clearSectionError('bookingTermsSection');
    }
    
    // 所有驗證通過，開始提交
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>處理中...</span>';
    
    const adults = parseInt(document.getElementById('adults').value) || 0;
    const children = parseInt(document.getElementById('children').value) || 0;
    const totalGuests = adults + children;
    // 選取的房型與容量檢查
    const baseCapacity = roomSelections.reduce((sum, room) => {
        const roomCapacity = (room.maxOccupancy || 0) * room.quantity + (room.selectedExtraBeds || 0);
        return sum + roomCapacity;
    }, 0);
    const totalCapacity = baseCapacity;
    
    if (totalCapacity > 0 && totalGuests > totalCapacity) {
        const unassignedGuests = totalGuests - totalCapacity;
        showCapacityWarning(`請留意：目前入住人數已超過所選房型可安排上限，建議調整房型或該房型加床數量；若與現場房況不符可能無法安排入住（尚有 ${unassignedGuests} 位旅客未安排）。`);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>確認訂房</span>';
        return;
    }
    
    // 收集表單資料（使用驗證後清理過的資料）
    const specialRequestEnabled = !!document.getElementById('specialRequestToggle')?.checked;
    const specialRequest = specialRequestEnabled
        ? String(document.getElementById('specialRequest')?.value || '').trim().slice(0, 300)
        : '';
    const formData = {
        checkInDate: document.getElementById('checkInDate').value,
        checkOutDate: document.getElementById('checkOutDate').value,
        buildingId: getSelectedBuildingId(),
        roomType: roomSelections[0]?.name || '',
        guestName: document.getElementById('guestName').value.trim(),
        guestPhone: phone, // 使用驗證後清理過的手機號碼（已移除 - 和空格）
        guestEmail: email, // 使用驗證後清理過的 Email（已轉小寫）
        adults,
        children,
        rooms: selectedRoomCount,
        roomSelections,
        paymentAmount: document.querySelector('input[name="paymentAmount"]:checked').value,
        paymentMethod: paymentMethod.value,
        specialRequest,
        bookingNoticeAgreed: true,
        bookingTermsAgreed: !!document.getElementById('bookingTermsAgree')?.checked,
        utm_source: bookingAttribution.utm_source || '',
        utm_medium: bookingAttribution.utm_medium || '',
        utm_campaign: bookingAttribution.utm_campaign || '',
        booking_source: bookingAttribution.booking_source || 'direct',
        referrer: bookingAttribution.referrer || ''
    };
    
    // 計算價格資訊（考慮假日）
    const checkInDate = formData.checkInDate;
    const checkOutDate = formData.checkOutDate;
    const nights = calculateNights();
    // 計算加購商品總金額（排除「加床」，改由房型內加床）
    const nonExtraBedAddons = enableAddons ? selectedAddons.filter((addon) => !isExtraBedAddon(addon)) : [];
    const addonsTotal = nonExtraBedAddons.reduce((sum, addon) => sum + (addon.price * (addon.quantity || 1)), 0);
    const roomExtraBedTotal = calculateRoomExtraBedTotal(roomSelections);
    
    // 使用 API 計算價格（考慮假日）
    let pricePerNight = roomSelections[0]?.price || 0; // 預設值
    let roomTotal = pricePerNight * nights * selectedRoomCount; // 預設值
    
    if (checkInDate && checkOutDate) {
        try {
            const pricing = await computeRoomPricing(checkInDate, checkOutDate, roomSelections);
            roomTotal = pricing.roomTotal;
            pricePerNight = pricing.averagePricePerNight;
            console.log('✅ 使用 API 計算價格（多房型）:', { roomTotal, pricePerNight, nights });
        } catch (priceError) {
            console.error('❌ 計算價格錯誤，使用基礎價格:', priceError);
        }
    }
    
    let totalAmount = roomTotal + addonsTotal + roomExtraBedTotal;
    
    // 計算早鳥優惠折扣
    let ebDiscount = 0;
    if (earlyBirdDiscount && earlyBirdDiscount.applicable) {
        ebDiscount = calculateEarlyBirdDiscountAmount(totalAmount);
    }

    // 計算會員折扣
    let memberDiscount = 0;
    if (memberLevelDiscount && memberLevelDiscount.applicable) {
        memberDiscount = calculateMemberDiscountAmount(totalAmount);
    }
    
    // 計算優惠代碼折扣
    let promoDiscount = 0;
    if (appliedPromoCode) {
        const canCombine = appliedPromoCode.can_combine_with_early_bird === 1;
        if (ebDiscount > 0 && !canCombine) {
            const promoCalc = appliedPromoCode.discount_amount || 0;
            if (promoCalc > ebDiscount) {
                promoDiscount = promoCalc;
                ebDiscount = 0;
            }
        } else {
            promoDiscount = appliedPromoCode.discount_amount || 0;
        }
    }
    
    const discountAmount = memberDiscount + ebDiscount + promoDiscount;
    totalAmount = Math.max(0, totalAmount - discountAmount);
    
    const depositRate = depositPercentage / 100;
    const paymentType = formData.paymentAmount === 'deposit' ? depositRate : 1;
    const finalAmount = totalAmount * paymentType;
    
    formData.pricePerNight = pricePerNight;
    formData.nights = nights;
    formData.totalGuests = Number(formData.adults || 0) + Number(formData.children || 0);
    formData.totalAmount = roomTotal + addonsTotal + roomExtraBedTotal; // 原始總金額（不含折扣）
    formData.finalAmount = finalAmount; // 最終應付金額（含折扣）
    const roomExtraBedAddons = buildRoomExtraBedAddonsForSubmit(roomSelections);
    formData.addons = enableAddons ? nonExtraBedAddons.concat(roomExtraBedAddons) : roomExtraBedAddons; // 加購商品＋房型內加床
    formData.addonsTotal = addonsTotal + roomExtraBedTotal; // 加購商品總金額（含房型內加床）
    formData.promoCode = appliedPromoCode ? appliedPromoCode.code : null; // 優惠代碼（如果有）
    formData.earlyBirdRuleId = earlyBirdDiscount && earlyBirdDiscount.applicable ? earlyBirdDiscount.rule.id : null; // 早鳥優惠規則ID
    
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
        
        const bookingApiEndpoint = currentSystemMode === 'whole_property' ? '/api/whole-property/booking' : '/api/booking';
        console.log(`正在發送請求到 ${bookingApiEndpoint}...`);
        const headers = {
            'Content-Type': 'application/json',
        };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        
        const response = await fetch(bookingApiEndpoint, {
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
                const roomTypeName = getSelectedRoomSelections()
                    .map(room => `${room.displayName} x${room.quantity}`)
                    .join('、');
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
                await appAlert('訂房失敗：' + errorMsg);
            }
            
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>確認訂房</span>';
        }
    } catch (error) {
        console.error('Error:', error);
        await appAlert('發生錯誤，請稍後再試');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>確認訂房</span>';
    }
});

// 初始化價格顯示
calculatePrice();

