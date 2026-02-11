/**
 * 悠然山居民宿 - 銷售頁腳本
 * 從後台 API 動態載入設定，包含 Facebook 像素追蹤、倒數計時、導航互動等功能
 */

// 全域設定變數
let landingConfig = {};
let countdownDays = 7;

// 預設配色主題定義
const landingThemes = {
    default: { primary: '#1a3a4a', primary_light: '#2d5a6e', accent: '#c9a962', accent_hover: '#b8954d', bg_cream: '#f8f6f3', text_dark: '#2d3436', text_light: '#636e72' },
    forest:  { primary: '#2d5016', primary_light: '#4a7a2e', accent: '#d4a853', accent_hover: '#c09640', bg_cream: '#f5f7f2', text_dark: '#2d3426', text_light: '#5a6b52' },
    mountain:{ primary: '#3d4f5f', primary_light: '#5a7186', accent: '#e8b960', accent_hover: '#d4a64d', bg_cream: '#f4f5f7', text_dark: '#2c3440', text_light: '#6b7a88' },
    sakura:  { primary: '#8b4557', primary_light: '#a8637a', accent: '#f0c987', accent_hover: '#e0b870', bg_cream: '#fdf6f0', text_dark: '#3d2832', text_light: '#8a6a72' },
    sunset:  { primary: '#5a3e2b', primary_light: '#7d5a3f', accent: '#e8a54b', accent_hover: '#d49438', bg_cream: '#faf5ef', text_dark: '#3a2a1e', text_light: '#8a7060' },
    ocean:   { primary: '#1e5799', primary_light: '#3a7bc8', accent: '#ffd700', accent_hover: '#e6c200', bg_cream: '#f0f5fa', text_dark: '#1a2a3a', text_light: '#5a6a7a' },
    autumn:  { primary: '#5c4033', primary_light: '#7d5e50', accent: '#c9a962', accent_hover: '#b8954d', bg_cream: '#f9f4ef', text_dark: '#3a2e26', text_light: '#7a6a5a' },
    minimal: { primary: '#1a1a2e', primary_light: '#33334d', accent: '#e2b259', accent_hover: '#d0a048', bg_cream: '#f5f5f5', text_dark: '#1a1a1a', text_light: '#666666' }
};

// ===== 從 API 載入設定並套用至頁面 =====
async function loadLandingConfig() {
    try {
        const response = await fetch('/api/landing-settings');
        const result = await response.json();

        if (result.success && result.data) {
            landingConfig = result.data;
            landingConfig._roomTypes = result.roomTypes || [];
            console.log('📋 API 回傳房型數量:', landingConfig._roomTypes.length);
            applyConfig(landingConfig);
            console.log('✅ 銷售頁設定已從後台載入');
        } else {
            console.warn('⚠️ 無法取得銷售頁設定，使用預設值');
        }
    } catch (error) {
        console.warn('⚠️ 載入銷售頁設定失敗:', error.message);
    }
}

// 將 HEX 顏色轉為 RGB 數值
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 26, g: 58, b: 74 };
}

// 套用配色主題到 CSS 變數
function applyTheme(themeId) {
    const theme = landingThemes[themeId] || landingThemes['default'];
    const root = document.documentElement;
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--primary-light', theme.primary_light);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-hover', theme.accent_hover);
    root.style.setProperty('--bg-cream', theme.bg_cream);
    root.style.setProperty('--bg-dark', theme.primary);
    root.style.setProperty('--text-dark', theme.text_dark);
    root.style.setProperty('--text-light', theme.text_light);

    // 設定帶透明度的顏色變數（導航列、Hero overlay、陰影等用）
    const pRgb = hexToRgb(theme.primary);
    const aRgb = hexToRgb(theme.accent);
    root.style.setProperty('--primary-alpha-95', `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.95)`);
    root.style.setProperty('--primary-alpha-85', `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.85)`);
    root.style.setProperty('--primary-alpha-75', `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.75)`);
    root.style.setProperty('--primary-alpha-60', `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.6)`);
    root.style.setProperty('--primary-alpha-08', `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.08)`);
    root.style.setProperty('--accent-shadow', `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.4)`);
    root.style.setProperty('--accent-shadow-lg', `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.5)`);
    root.style.setProperty('--accent-alpha-10', `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.1)`);

    console.log(`🎨 已套用配色主題: ${themeId}`);
}

// 將設定套用至 HTML 元素
function applyConfig(cfg) {
    // ===== 配色主題 =====
    if (cfg.landing_theme) {
        applyTheme(cfg.landing_theme);
    }

    // ===== 基本資訊 =====
    const name = cfg.landing_name || '';
    if (name) {
        setText('navLogo', name);
        setText('footerBrand', name);
        const footerCopyright = document.getElementById('footerCopyright');
        if (footerCopyright) footerCopyright.innerHTML = `&copy; ${new Date().getFullYear()} ${name}. All rights reserved.`;
    }
    if (cfg.landing_title) {
        const titleEl = document.getElementById('heroTitle');
        if (titleEl) titleEl.innerHTML = cfg.landing_title;
    }
    setText('heroSubtitle', cfg.landing_subtitle);
    setText('heroBadge', cfg.landing_badge);
    setText('heroPricePrefix', cfg.landing_price_prefix);
    setText('heroPriceAmount', cfg.landing_price_amount);
    setText('heroPriceOriginal', cfg.landing_price_original);

    // Hero 背景圖片
    if (cfg.landing_hero_image) {
        const heroSection = document.getElementById('hero');
        if (heroSection) {
            heroSection.style.backgroundImage = `url('${cfg.landing_hero_image}')`;
        }
    }

    // CTA 按鈕文字
    const ctaText = cfg.landing_cta_text || '';
    if (ctaText) {
        setText('heroCtaText', ctaText);
        setText('navCtaBtn', ctaText);
        setText('finalCtaText', ctaText);
        setText('floatingCtaText', ctaText);
    }

    // 倒數計時
    if (cfg.landing_countdown_days) {
        countdownDays = parseInt(cfg.landing_countdown_days) || 7;
    }
    if (cfg.landing_countdown_text) {
        const cdText = document.getElementById('countdownText');
        if (cdText) cdText.innerHTML = cfg.landing_countdown_text;
    }

    // ===== 特色賣點 =====
    for (let i = 1; i <= 4; i++) {
        const icon = cfg[`landing_feature_${i}_icon`];
        const title = cfg[`landing_feature_${i}_title`];
        const desc = cfg[`landing_feature_${i}_desc`];
        if (icon) setText(`featureIcon${i}`, icon);
        if (title) setText(`featureTitle${i}`, title);
        if (desc) setText(`featureDesc${i}`, desc);
    }

    // ===== 房型展示 =====
    renderRoomCards(cfg);

    // ===== 客戶評價 =====
    if (cfg.landing_review_count) {
        setText('reviewTitle', `超過 ${cfg.landing_review_count} 位旅客的選擇`);
    }
    if (cfg.landing_review_score) {
        setText('reviewScore', cfg.landing_review_score);
    }
    renderReviewCards(cfg);

    // ===== 聯絡資訊 =====
    setText('locationAddress', cfg.landing_address);
    setText('locationDriving', cfg.landing_driving);
    setText('locationTransit', cfg.landing_transit);
    setText('locationPhone', cfg.landing_phone);

    if (cfg.landing_map_url) {
        const mapFrame = document.getElementById('locationMap');
        if (mapFrame) mapFrame.src = cfg.landing_map_url;
    }

    // ===== 社群連結 =====
    setLink('socialFb', cfg.landing_social_fb);
    setLink('socialIg', cfg.landing_social_ig);
    setLink('socialLine', cfg.landing_social_line);

    // ===== Facebook Pixel（僅在 Pixel ID 為有效數字時載入）=====
    const pixelId = cfg.landing_fb_pixel_id;
    if (pixelId && pixelId !== 'YOUR_PIXEL_ID_HERE' && /^\d+$/.test(pixelId)) {
        initFacebookPixel(pixelId);
    } else if (pixelId && !/^\d+$/.test(pixelId)) {
        console.warn('⚠️ Facebook Pixel ID 格式不正確（應為純數字）:', pixelId);
    } else {
        console.log('ℹ️ Facebook Pixel 未設定，跳過初始化');
    }

    // ===== SEO =====
    if (cfg.landing_seo_title) {
        document.title = cfg.landing_seo_title;
        setMeta('ogTitle', cfg.landing_seo_title);
    } else if (name) {
        document.title = name;
    }
    if (cfg.landing_seo_desc) {
        setMeta('metaDescription', cfg.landing_seo_desc);
        setMeta('ogDescription', cfg.landing_seo_desc);
    }
    if (cfg.landing_og_image) {
        setMeta('ogImage', cfg.landing_og_image);
    }
}

// ===== 工具函數 =====
function setText(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setMeta(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (el) el.setAttribute('content', value);
}

function setLink(id, url) {
    if (!url) return;
    const el = document.getElementById(id);
    if (el) {
        el.href = url;
        el.style.display = '';
        el.removeAttribute('style');
    }
}

// ===== 設施名稱對應 Material Symbol 圖示（全域） =====
const featureIconMap = {
    '單人床': 'single_bed', '雙人床': 'king_bed', '加大雙人床': 'king_bed',
    '特大雙人床': 'king_bed', '上下鋪': 'single_bed', '和式床墊': 'airline_seat_flat',
    '獨立衛浴': 'bathtub', '共用衛浴': 'shower', '浴缸': 'bathtub',
    '淋浴設備': 'shower', '免治馬桶': 'wash', '私人湯池': 'hot_tub',
    '私人陽台': 'balcony', '客廳空間': 'living', '小廚房': 'countertops',
    '和室空間': 'floor', '庭院': 'yard', '山景視野': 'landscape',
    '海景視野': 'water', '庭園景觀': 'park',
    '免費 WiFi': 'wifi', '冷暖空調': 'ac_unit', '智慧電視': 'tv',
    '冰箱': 'kitchen', '咖啡機': 'coffee_maker', '電熱水壺': 'water_drop',
    '吹風機': 'air', '洗衣機': 'local_laundry_service', '微波爐': 'microwave',
    '免費早餐': 'restaurant', '免費停車': 'local_parking', '寵物友善': 'pets',
    '保險箱': 'lock', '行李寄放': 'luggage', '嬰兒床': 'crib',
    '無障礙設施': 'accessible', '機場接送': 'airport_shuttle'
};

// 將逗號分隔的設施字串轉為帶圖示的 HTML
function buildFeatureHTML(featuresStr) {
    if (!featuresStr || !featuresStr.trim()) return '';
    return featuresStr.split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0)
        .map(name => {
            const icon = featureIconMap[name] || 'check_circle';
            return `<span><span class="material-symbols-outlined">${icon}</span> ${name}</span>`;
        })
        .join('');
}

// ===== 動態生成房型卡片（從房型管理 + 設施設定合併） =====
function renderRoomCards(cfg) {
    const grid = document.getElementById('roomsGrid');
    if (!grid) {
        console.warn('⚠️ roomsGrid 元素不存在');
        return;
    }

    // 使用 API 回傳的 roomTypes（來自房型管理）
    const roomTypes = cfg._roomTypes || [];

    if (roomTypes.length === 0) {
        console.log('ℹ️ 無房型資料，使用預設房型卡片');
        grid.innerHTML = `
            <div class="room-card">
                <div class="room-image">
                    <img src="https://images.unsplash.com/photo-1590490360182-c33d57733427?w=600" alt="標準雙人房" loading="lazy">
                    <span class="room-badge">熱門</span>
                </div>
                <div class="room-info">
                    <h3>標準雙人房</h3>
                    <div class="room-features">
                        <span><span class="material-symbols-outlined">king_bed</span> 雙人床</span>
                        <span><span class="material-symbols-outlined">bathtub</span> 獨立衛浴</span>
                        <span><span class="material-symbols-outlined">wifi</span> 免費 WiFi</span>
                    </div>
                    <div class="room-price-row">
                        <div class="room-price">
                            <span class="price-current">NT$ 2,800</span>
                            <span class="price-old">NT$ 3,500</span>
                        </div>
                        <a href="index.html" class="room-book-btn" onclick="trackBookingClick()">預訂</a>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    const badgeClassMap = {
        '熱門': '',
        '超值': 'best-value',
        '頂級': 'premium'
    };

    grid.innerHTML = roomTypes.map(room => {
        // 從 settings 讀取該房型的設施和標籤
        const features = cfg[`landing_roomtype_${room.id}_features`] || '';
        const badge = cfg[`landing_roomtype_${room.id}_badge`] || '';
        const featureItems = buildFeatureHTML(features);
        const badgeClass = badgeClassMap[badge] || '';
        const price = room.price || 0;
        const originalPrice = room.original_price || 0;
        const holidaySurcharge = room.holiday_surcharge || 0;
        const displayName = room.display_name || room.name || '房型';

        console.log(`🏨 ${displayName} (ID:${room.id}) | 價格: ${price} | 原價: ${originalPrice} | 設施: ${features || '(未設定)'}`);

        return `
            <div class="room-card" onclick="trackViewContent('${displayName}', ${price})">
                <div class="room-image">
                    ${room.image_url ? `<img src="${room.image_url}" alt="${displayName}" loading="lazy">` : '<div style="height:200px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;color:#999;">尚無圖片</div>'}
                    ${badge ? `<span class="room-badge ${badgeClass}">${badge}</span>` : ''}
                </div>
                <div class="room-info">
                    <h3>${displayName}</h3>
                    ${featureItems ? `<div class="room-features">${featureItems}</div>` : ''}
                    <div class="room-price-row">
                        <div class="room-price">
                            <span class="price-current">NT$ ${price.toLocaleString()}</span>
                            ${originalPrice > 0 ? `<span class="price-old">NT$ ${originalPrice.toLocaleString()}</span>` : ''}
                        </div>
                        <a href="index.html" class="room-book-btn" onclick="event.stopPropagation(); trackBookingClick();">預訂</a>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    console.log('✅ 房型卡片已渲染，共', roomTypes.length, '張');
}

// ===== 動態生成評價卡片 =====
function renderReviewCards(cfg) {
    const grid = document.getElementById('reviewsGrid');
    if (!grid) return;

    const reviews = [];
    for (let i = 1; i <= 3; i++) {
        const name = cfg[`landing_review_${i}_name`];
        if (!name) continue;
        reviews.push({
            name,
            date: cfg[`landing_review_${i}_date`] || '',
            rating: cfg[`landing_review_${i}_rating`] || '5.0',
            text: cfg[`landing_review_${i}_text`] || '',
            tags: cfg[`landing_review_${i}_tags`] || ''
        });
    }

    if (reviews.length === 0) {
        // 使用預設評價
        grid.innerHTML = `
            <div class="review-card">
                <div class="review-header">
                    <div class="reviewer-avatar">旅</div>
                    <div class="reviewer-info">
                        <span class="reviewer-name">旅客</span>
                        <span class="review-date">近期</span>
                    </div>
                    <div class="review-rating">
                        <span class="material-symbols-outlined filled">star</span>
                        <span>5.0</span>
                    </div>
                </div>
                <p class="review-text">「很棒的住宿體驗，推薦給大家！」</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = reviews.map(review => {
        const avatar = review.name.charAt(0);
        const tagItems = review.tags
            ? review.tags.split(',').map(t => `<span>${t.trim()}</span>`).join('')
            : '';

        return `
            <div class="review-card">
                <div class="review-header">
                    <div class="reviewer-avatar">${avatar}</div>
                    <div class="reviewer-info">
                        <span class="reviewer-name">${review.name}</span>
                        ${review.date ? `<span class="review-date">${review.date}</span>` : ''}
                    </div>
                    <div class="review-rating">
                        <span class="material-symbols-outlined filled">star</span>
                        <span>${review.rating}</span>
                    </div>
                </div>
                <p class="review-text">「${review.text}」</p>
                ${tagItems ? `<div class="review-tags">${tagItems}</div>` : ''}
            </div>
        `;
    }).join('');
}

// ===== 動態載入 Facebook Pixel =====
function initFacebookPixel(pixelId) {
    try {
        if (!pixelId || typeof fbq !== 'undefined') return;

        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');

        fbq('init', pixelId);
        fbq('track', 'PageView');
        console.log('✅ Facebook Pixel 已初始化:', pixelId);
    } catch (error) {
        console.warn('⚠️ Facebook Pixel 初始化失敗:', error.message);
    }
}

// ===== Facebook Pixel 追蹤函數 =====

/**
 * 追蹤點擊「立即訂房」按鈕
 * 事件: Lead (潛在客戶)
 */
function trackBookingClick() {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'Lead', {
            content_name: '銷售頁 - 點擊訂房按鈕',
            content_category: '民宿訂房'
        });
        console.log('FB Pixel: Lead event tracked');
    }
}

/**
 * 追蹤查看房型內容
 * 事件: ViewContent (查看內容)
 * @param {string} roomName - 房型名稱
 * @param {number} price - 房型價格
 */
function trackViewContent(roomName, price) {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'ViewContent', {
            content_name: roomName,
            content_type: 'product',
            content_ids: [roomName],
            value: price,
            currency: 'TWD'
        });
        console.log('FB Pixel: ViewContent event tracked -', roomName);
    }
}

/**
 * 追蹤開始結帳流程（點擊最終 CTA）
 * 事件: InitiateCheckout (開始結帳)
 */
function trackInitiateCheckout() {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
            content_name: '銷售頁 - 最終 CTA',
            content_category: '民宿訂房',
            num_items: 1
        });
        console.log('FB Pixel: InitiateCheckout event tracked');
    }
    // 同時觸發 Lead 事件
    trackBookingClick();
}

/**
 * 追蹤頁面捲動深度
 * 事件: 自訂事件 ScrollDepth
 */
function trackScrollDepth(percentage) {
    if (typeof fbq !== 'undefined') {
        fbq('trackCustom', 'ScrollDepth', {
            scroll_percentage: percentage
        });
        console.log('FB Pixel: ScrollDepth event tracked -', percentage + '%');
    }
}

// ===== 捲動追蹤 =====
let scrollMilestones = { 25: false, 50: false, 75: false, 100: false };

function checkScrollDepth() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercent = Math.round((scrollTop / docHeight) * 100);
    
    Object.keys(scrollMilestones).forEach(milestone => {
        if (scrollPercent >= parseInt(milestone) && !scrollMilestones[milestone]) {
            scrollMilestones[milestone] = true;
            trackScrollDepth(parseInt(milestone));
        }
    });
}

// 節流函數
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

window.addEventListener('scroll', throttle(checkScrollDepth, 200));

// ===== 導航列效果 =====
const navbar = document.getElementById('navbar');
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

// 捲動時添加背景
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// 手機版選單切換
if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        navToggle.classList.toggle('active');
    });
    
    // 點擊連結後關閉選單
    navMenu.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('active');
            navToggle.classList.remove('active');
        });
    });
}

// ===== 倒數計時器 =====
function initCountdown() {
    // 使用 localStorage 儲存結束時間，確保重新整理不會重置
    let endDateStr = localStorage.getItem('landing_countdown_end');
    let endDate;

    if (endDateStr) {
        endDate = new Date(endDateStr);
        // 如果已過期，重新設定
        if (endDate <= new Date()) {
            endDate = null;
        }
    }

    if (!endDate) {
        endDate = new Date();
        endDate.setDate(endDate.getDate() + countdownDays);
        endDate.setHours(23, 59, 59, 0);
        localStorage.setItem('landing_countdown_end', endDate.toISOString());
    }
    
    function updateCountdown() {
        const now = new Date();
        const diff = endDate - now;
        
        if (diff <= 0) {
            // 優惠結束，重置
            endDate = new Date();
            endDate.setDate(endDate.getDate() + countdownDays);
            endDate.setHours(23, 59, 59, 0);
            localStorage.setItem('landing_countdown_end', endDate.toISOString());
            return;
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        document.getElementById('days').textContent = String(days).padStart(2, '0');
        document.getElementById('hours').textContent = String(hours).padStart(2, '0');
        document.getElementById('minutes').textContent = String(minutes).padStart(2, '0');
        document.getElementById('seconds').textContent = String(seconds).padStart(2, '0');
    }
    
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

// ===== 平滑捲動（錨點連結）=====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offsetTop = target.offsetTop - 80; // 減去導航列高度
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    });
});

// ===== 元素進場動畫 =====
function initScrollAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // 觀察需要動畫的元素
    document.querySelectorAll('.feature-card, .room-card, .review-card, .amenity-item').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// 添加動畫類別的 CSS
const animationStyle = document.createElement('style');
animationStyle.textContent = `
    .animate-in {
        opacity: 1 !important;
        transform: translateY(0) !important;
    }
`;
document.head.appendChild(animationStyle);

// ===== 頁面停留時間追蹤 =====
let pageLoadTime = Date.now();

function trackTimeOnPage() {
    const timeSpent = Math.round((Date.now() - pageLoadTime) / 1000);
    if (typeof fbq !== 'undefined' && timeSpent > 30) {
        fbq('trackCustom', 'TimeOnPage', {
            time_seconds: timeSpent,
            page: 'landing'
        });
    }
}

// 頁面離開時追蹤停留時間
window.addEventListener('beforeunload', trackTimeOnPage);

// 每 60 秒追蹤一次（用於長時間停留）
setInterval(() => {
    const timeSpent = Math.round((Date.now() - pageLoadTime) / 1000);
    if (typeof fbq !== 'undefined' && timeSpent % 60 === 0) {
        fbq('trackCustom', 'EngagedVisitor', {
            time_seconds: timeSpent
        });
    }
}, 60000);

// ===== UTM 參數追蹤 =====
function getUTMParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        utm_source: params.get('utm_source') || 'direct',
        utm_medium: params.get('utm_medium') || 'none',
        utm_campaign: params.get('utm_campaign') || 'none',
        utm_content: params.get('utm_content') || 'none',
        utm_term: params.get('utm_term') || 'none'
    };
}

// 將 UTM 參數存入 sessionStorage（傳遞給訂房頁）
function storeUTMParams() {
    const utmParams = getUTMParams();
    sessionStorage.setItem('utm_params', JSON.stringify(utmParams));
    
    // 追蹤 UTM 來源
    if (typeof fbq !== 'undefined' && utmParams.utm_source !== 'direct') {
        fbq('trackCustom', 'CampaignVisit', utmParams);
    }
}

// ===== 訂房按鈕 URL 處理 =====
function updateBookingLinks() {
    const utmParams = getUTMParams();
    const queryString = new URLSearchParams(utmParams).toString();
    
    document.querySelectorAll('a[href="index.html"]').forEach(link => {
        if (queryString && utmParams.utm_source !== 'direct') {
            link.href = `index.html?${queryString}`;
        }
    });
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
    // 先載入後台設定
    await loadLandingConfig();
    
    // 再初始化各元件
    initCountdown();
    initScrollAnimations();
    storeUTMParams();
    updateBookingLinks();
    
    console.log('✅ Landing page initialized');
    console.log('UTM Params:', getUTMParams());
});

// ===== 圖片懶載入優化 =====
if ('loading' in HTMLImageElement.prototype) {
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.src = img.dataset.src || img.src;
    });
} else {
    const lazyImages = document.querySelectorAll('img[loading="lazy"]');
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src || img.src;
                imageObserver.unobserve(img);
            }
        });
    });
    
    lazyImages.forEach(img => imageObserver.observe(img));
}
