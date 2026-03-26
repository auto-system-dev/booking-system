/**
 * 悠然山居旅宿 - 銷售頁腳本
 * 從後台 API 動態載入設定，包含 Facebook 像素追蹤、倒數計時、導航互動等功能
 */

// 全域設定變數
let landingConfig = {};
let countdownDays = 7;
const DEFAULT_HERO_IMAGE = 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1920';
const DEFAULT_FEATURE_ITEMS = [
    { icon: 'landscape', title: '絕美山景', desc: '每間房間都能欣賞到壯闊的山巒美景', enabled: true, order: 1 },
    { icon: 'spa', title: '私人湯屋', desc: '獨立溫泉湯屋，24 小時供應天然溫泉', enabled: true, order: 2 },
    { icon: 'restaurant', title: '精緻早餐', desc: '使用在地新鮮食材，每日現做的豐盛早餐', enabled: true, order: 3 },
    { icon: 'pets', title: '寵物友善', desc: '帶著毛小孩一起來度假', enabled: true, order: 4 }
];
const DEFAULT_FACILITY_GALLERY_ITEMS = [
    {
        id: 'default_facility_lounge',
        title: '公共客廳',
        desc: '明亮寬敞的共享客廳，提供舒適沙發與閱讀角，適合聊天放鬆。',
        images: ['https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1200'],
        enabled: true,
        order: 1
    },
    {
        id: 'default_facility_dining',
        title: '餐飲空間',
        desc: '溫馨餐飲區搭配開放式座位，早餐與晚間小聚都很自在。',
        images: ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200'],
        enabled: true,
        order: 2
    },
    {
        id: 'default_facility_courtyard',
        title: '戶外休憩區',
        desc: '綠意環繞的戶外空間，白天可享受陽光，夜晚可靜心放鬆。',
        images: ['https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200'],
        enabled: true,
        order: 3
    }
];
const DEFAULT_REVIEW_ITEMS = [
    { name: '林小姐', date: '2026 年 1 月', rating: '5.0', text: '環境超棒！房間乾淨又舒適，主人非常親切熱情，早餐也很豐盛。下次還會再來！', tags: '環境優美,服務親切', enabled: true, order: 1 },
    { name: '陳先生', date: '2026 年 1 月', rating: '5.0', text: '帶著家人一起入住，孩子們玩得很開心。設備齊全，地點方便，CP 值很高！', tags: '適合家庭,設備齊全', enabled: true, order: 2 },
    { name: '王小姐', date: '2025 年 12 月', rating: '4.9', text: '位置很好找，房間寬敞明亮，窗外風景很美。整體住宿體驗非常棒，大力推薦！', tags: '景觀優美,交通方便', enabled: true, order: 3 }
];

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
    const ssrPayload = window.__LANDING_SSR__;
    if (ssrPayload && ssrPayload.data) {
        try {
            landingConfig = ssrPayload.data;
            landingConfig._roomTypes = ssrPayload.roomTypes || [];
            console.log('📋 SSR 載入房型數量:', landingConfig._roomTypes.length);
            await applyConfig(landingConfig);
            console.log('✅ 銷售頁設定已由 SSR 注入');
            return;
        } catch (error) {
            console.warn('⚠️ SSR 設定套用失敗，改用 API 重新載入:', error.message);
        }
    }

    try {
        const response = await fetch('/api/landing-settings');
        const result = await response.json();

        if (result.success && result.data) {
            landingConfig = result.data;
            landingConfig._roomTypes = result.roomTypes || [];
            console.log('📋 API 回傳房型數量:', landingConfig._roomTypes.length);
            await applyConfig(landingConfig);
            console.log('✅ 銷售頁設定已從後台載入');
        } else {
            console.warn('⚠️ 無法取得銷售頁設定，使用預設值');
        }
    } catch (error) {
        console.warn('⚠️ 載入銷售頁設定失敗:', error.message);
    }
}

function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => reject(new Error(`圖片載入失敗: ${url}`));
        img.src = url;
    });
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
async function applyConfig(cfg) {
    // ===== 配色主題 =====
    if (cfg.landing_theme) {
        applyTheme(cfg.landing_theme);
    }

    // ===== 基本資訊 =====
    const name = cfg.landing_name || '';
    if (name) {
        setText('navLogoText', name);
        setText('footerBrandText', name);
        const footerCopyright = document.getElementById('footerCopyright');
        if (footerCopyright) footerCopyright.innerHTML = `&copy; ${new Date().getFullYear()} ${name}. All rights reserved.`;
    }
    setBrandLogos(cfg.landing_nav_logo);
    if (cfg.landing_title) {
        const titleEl = document.getElementById('heroTitle');
        if (titleEl) titleEl.innerHTML = cfg.landing_title;
    }
    setText('heroSubtitle', cfg.landing_subtitle);
    setText('heroBadge', cfg.landing_badge);
    setText('heroPricePrefix', cfg.landing_price_prefix);
    setText('heroPriceAmount', cfg.landing_price_amount);
    setText('heroPriceOriginal', cfg.landing_price_original);
    setText('aboutSectionTitle', cfg.landing_about_title);
    setText('aboutSectionSubtitle', cfg.landing_about_subtitle);
    setText('aboutCardDesc', cfg.landing_about_card_desc);

    // Hero 背景圖片（先預載再套用，避免刷新時先看到預設圖再切換）
    const heroSection = document.getElementById('hero');
    if (heroSection) {
        const targetHeroImage = cfg.landing_hero_image || DEFAULT_HERO_IMAGE;
        try {
            await preloadImage(targetHeroImage);
            heroSection.style.backgroundImage = `url('${targetHeroImage}')`;
        } catch (error) {
            console.warn('⚠️ Hero 圖片載入失敗，改用預設圖:', error.message);
            heroSection.style.backgroundImage = `url('${DEFAULT_HERO_IMAGE}')`;
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

    // Hero 與最終 CTA 信任文案（圖示名稱自動修正：空白 -> 底線、小寫）
    setIcon('heroTrustIcon1', cfg.landing_hero_trust_icon_1);
    setIcon('heroTrustIcon2', cfg.landing_hero_trust_icon_2);
    setIcon('heroTrustIcon3', cfg.landing_hero_trust_icon_3);
    setIcon('finalGuaranteeIcon', cfg.landing_final_guarantee_icon);
    setText('heroTrust1', cfg.landing_hero_trust_1);
    setText('heroTrust2', cfg.landing_hero_trust_2);
    setText('heroTrust3', cfg.landing_hero_trust_3);
    setText('finalGuaranteeText', cfg.landing_final_guarantee);
    const isTrustEnabled = (value) => {
        if (value === undefined || value === null || value === '') return true;
        const normalized = String(value).trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    };
    const trustEnabledFlags = [
        isTrustEnabled(cfg.landing_hero_trust_enabled_1),
        isTrustEnabled(cfg.landing_hero_trust_enabled_2),
        isTrustEnabled(cfg.landing_hero_trust_enabled_3)
    ];
    trustEnabledFlags.forEach((enabled, index) => {
        const item = document.getElementById(`heroTrustItem${index + 1}`);
        if (item) item.style.display = enabled ? '' : 'none';
    });
    const trustGroup = document.getElementById('heroTrustGroup');
    if (trustGroup) {
        trustGroup.style.display = trustEnabledFlags.some(Boolean) ? '' : 'none';
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
    setText('featuresSectionTitle', cfg.landing_features_title);
    setText('featuresSectionSubtitle', cfg.landing_features_subtitle);
    renderFeatureCards(cfg);

    // ===== 房型展示 =====
    setText('roomsSectionTitle', cfg.landing_rooms_title);
    setText('roomsSectionSubtitle', cfg.landing_rooms_subtitle);
    renderRoomCards(cfg);

    // ===== 旅宿設施 =====
    renderAmenities(cfg);
    renderFacilityGallery(cfg);

    // ===== 客戶評價 =====
    if (cfg.landing_review_count) {
        setText('reviewTitle', `超過 ${cfg.landing_review_count} 位旅客的選擇`);
    }
    if (cfg.landing_review_score) {
        setText('reviewScore', cfg.landing_review_score);
    }
    renderReviewCards(cfg);

    // ===== 聯絡資訊 =====
    setText('locationSectionTitle', cfg.landing_location_title);
    setText('finalCtaTitle', cfg.landing_final_cta_title);
    setText('finalCtaDesc', cfg.landing_final_cta_desc);
    setText('locationAddress', cfg.landing_address);
    setText('locationDriving', cfg.landing_driving);
    setText('locationPhone', cfg.landing_phone);

    // 大眾運輸：有資料才顯示
    const transitCard = document.getElementById('transitCard');
    if (cfg.landing_transit && cfg.landing_transit.trim()) {
        setText('locationTransit', cfg.landing_transit);
        if (transitCard) transitCard.style.display = '';
    } else {
        if (transitCard) transitCard.style.display = 'none';
    }

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
    if (cfg.landing_favicon) {
        setFavicon(cfg.landing_favicon);
    }
}

function resolveFeatureItems(cfg) {
    let items = [];
    const raw = cfg.landing_features_items;
    if (raw) {
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) {
                items = parsed.map((item, index) => ({
                    icon: normalizeIconName(item.icon) || 'check_circle',
                    title: String(item.title || '').trim(),
                    desc: String(item.desc || '').trim(),
                    enabled: item.enabled !== false,
                    order: Number(item.order) || (index + 1)
                }));
            }
        } catch (error) {
            console.warn('⚠️ landing_features_items JSON 解析失敗，改用舊版欄位:', error.message);
        }
    }

    if (!items.length) {
        for (let i = 1; i <= 4; i++) {
            const icon = normalizeIconName(cfg[`landing_feature_${i}_icon`]);
            const title = String(cfg[`landing_feature_${i}_title`] || '').trim();
            const desc = String(cfg[`landing_feature_${i}_desc`] || '').trim();
            if (!icon && !title && !desc) continue;
            items.push({
                icon: icon || 'check_circle',
                title,
                desc,
                enabled: true,
                order: i
            });
        }
    }

    if (!items.length) {
        items = DEFAULT_FEATURE_ITEMS.map(item => ({ ...item }));
    }

    return items
        .filter(item => item.enabled !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function renderFeatureCards(cfg) {
    const grid = document.getElementById('featuresGrid');
    if (!grid) return;

    const items = resolveFeatureItems(cfg);
    grid.innerHTML = items.map(item => `
        <div class="feature-card">
            <div class="feature-icon">
                <span class="material-symbols-outlined">${escapeHtml(item.icon || 'check_circle')}</span>
            </div>
            <h3>${escapeHtml(item.title || '特色服務')}</h3>
            <p>${escapeHtml(item.desc || '')}</p>
        </div>
    `).join('');
}

// ===== 工具函數 =====
function setText(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setBrandLogos(imageUrl) {
    const navLogo = document.getElementById('navLogo');
    const logoImg = document.getElementById('navLogoImage');
    const footerLogoImg = document.getElementById('footerLogoImage');
    if (!navLogo || !logoImg || !footerLogoImg) return;
    if (imageUrl && String(imageUrl).trim()) {
        const normalizedUrl = String(imageUrl).trim();
        logoImg.src = normalizedUrl;
        footerLogoImg.src = normalizedUrl;
        logoImg.style.display = '';
        footerLogoImg.style.display = '';
        navLogo.classList.add('has-image');
    } else {
        logoImg.removeAttribute('src');
        footerLogoImg.removeAttribute('src');
        logoImg.style.display = 'none';
        footerLogoImg.style.display = 'none';
        navLogo.classList.remove('has-image');
    }
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeIconName(value) {
    if (!value || typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/[ -]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function setIcon(id, value) {
    const normalized = normalizeIconName(value);
    if (!normalized) return;
    const el = document.getElementById(id);
    if (el) el.textContent = normalized;
}

function setMeta(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (el) el.setAttribute('content', value);
}

function setFavicon(url) {
    if (!url) return;
    const iconEl = document.getElementById('customerFavicon');
    const appleIconEl = document.getElementById('customerAppleTouchIcon');
    if (iconEl) iconEl.href = url;
    if (appleIconEl) appleIconEl.href = url;
}

function setLink(id, url) {
    if (!url) return;
    const el = document.getElementById(id);
    if (el) {
        const raw = String(url).trim();
        if (!raw || raw === '#') return;

        let normalized = raw;
        const hasScheme = /^(https?:\/\/|line:\/\/|mailto:|tel:)/i.test(raw);
        if (!hasScheme) {
            normalized = `https://${raw}`;
        }

        el.href = normalized;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
        el.style.display = '';
        el.removeAttribute('style');
    }
}

// ===== 設施名稱對應 Material Symbol 圖示（全域） =====
const featureIconMap = {
    '單人床': 'single_bed', '雙人床': 'king_bed', '加大雙人床': 'king_bed',
    '特大雙人床': 'king_bed', '上下鋪': 'single_bed', '和式床墊': 'airline_seat_flat',
    '沙發床': 'weekend',
    '獨立衛浴': 'bathtub', '共用衛浴': 'shower', '浴缸': 'bathtub',
    '淋浴設備': 'shower', '免治馬桶': 'wash', '私人湯池': 'hot_tub',
    '私人陽台': 'balcony', '客廳空間': 'living', '小廚房': 'countertops',
    '和室空間': 'floor', 'Mini Bar': 'local_bar', '兒童遊戲區': 'toys', '餐廳空間': 'restaurant',
    '庭院': 'yard', '山景視野': 'landscape',
    '海景視野': 'water', '庭園景觀': 'park',
    '免費 WiFi': 'wifi', '冷暖空調': 'ac_unit', '智慧電視': 'tv',
    '冰箱': 'kitchen', '咖啡機': 'coffee_maker', '電熱水壺': 'kettle',
    '飲水機': 'water_drop', '自動販賣機': 'local_drink', '電動車充電設備': 'ev_station',
    '吹風機': 'air', '洗衣機': 'local_laundry_service', '微波爐': 'microwave',
    '書桌': 'desk', '化粧桌': 'table_restaurant', '梳妝台': 'table_restaurant', '沙發': 'weekend', '小桌椅': 'table_restaurant', '鏡子': 'crop_portrait',
    '寢具用品': 'bed', '毛巾': 'dry_cleaning', '浴巾': 'dry_cleaning', '牙刷/牙膏': 'brush',
    '盥洗用品': 'soap', '洗髮精': 'sanitizer', '潤髮乳': 'sanitizer', '香皂/沐浴乳': 'sanitizer', '拖鞋': 'footprint',
    '免費早餐': 'restaurant', '免費停車': 'local_parking', '寵物友善': 'pets',
    '保險箱': 'lock', '行李寄放': 'luggage', '嬰兒床': 'crib',
    '嬰兒澡盆': 'bathtub', '電梯': 'elevator', '燒烤設備': 'outdoor_grill',
    '卡拉OK': 'mic', '麻將桌': 'table_restaurant', '電動麻將桌': 'electric_bolt',
    '桌遊': 'casino', '廚房用具': 'kitchen',
    '無障礙設施': 'accessible', '機場接送': 'airport_shuttle'
};

// 旅宿設施項目（不應顯示在個別房型卡片中）
const propertyFacilities = new Set([
    '客廳空間', '小廚房', '和室空間', 'Mini Bar', '兒童遊戲區', '餐廳空間', '庭院',
    '飲水機', '自動販賣機', '電動車充電設備', '洗衣機', '微波爐',
    '免費早餐', '免費停車', '寵物友善', '保險箱', '行李寄放', '嬰兒床', '嬰兒澡盆', '電梯', '燒烤設備', '卡拉OK', '麻將桌', '電動麻將桌', '桌遊', '廚房用具', '無障礙設施', '機場接送'
]);

// 將逗號分隔的設施字串轉為帶圖示的 HTML（自動過濾掉旅宿設施）
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

function getRoomFeatureItemsForLanding(room, cfg) {
    const bedTypes = Array.isArray(room?.bed_types) ? room.bed_types.filter(Boolean) : [];
    const roomFacilities = Array.isArray(room?.room_facilities) ? room.room_facilities.filter(Boolean) : [];
    const merged = [...new Set([...bedTypes, ...roomFacilities])];
    if (merged.length > 0) return merged;

    // 向後相容：若尚未提供 bed_types/room_facilities，退回舊的 settings 字串
    const fallback = String(cfg?.[`landing_roomtype_${room?.id}_features`] || '').trim();
    if (!fallback) return [];
    return fallback.split(',').map((item) => item.trim()).filter(Boolean);
}

// ===== 動態生成旅宿設施區塊 =====
const hiddenAmenities = new Set(['電熱水壺', '吹風機']);

function renderAmenities(cfg) {
    const grid = document.getElementById('amenitiesGrid');
    if (!grid) return;

    const facilitiesStr = cfg.landing_facilities || '';
    if (!facilitiesStr.trim()) {
        // 沒有設定時隱藏整個設施區塊
        const section = document.getElementById('amenities');
        if (section) section.style.display = 'none';
        return;
    }

    const items = facilitiesStr
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0 && !hiddenAmenities.has(f));
    if (!items.length) {
        const section = document.getElementById('amenities');
        if (section) section.style.display = 'none';
        return;
    }
    grid.innerHTML = items.map(name => {
        const icon = featureIconMap[name] || 'check_circle';
        return `<div class="amenity-item">
            <span class="material-symbols-outlined">${icon}</span>
            <span>${name}</span>
        </div>`;
    }).join('');
}

function renderFacilityGallery(cfg) {
    const section = document.getElementById('public-facilities');
    const grid = document.getElementById('facilityGalleryGrid');
    if (!section || !grid) return;

    let items = [];
    try {
        const raw = cfg.landing_facility_gallery || '[]';
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
            items = parsed
                .map(item => {
                    const images = resolveFacilityGalleryImages(item);
                    return {
                        ...item,
                        images
                    };
                })
                .filter(item => item && item.images.length > 0 && item.enabled !== false)
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        }
    } catch (error) {
        console.warn('⚠️ landing_facility_gallery JSON 解析失敗:', error.message);
    }

    if (!items.length) {
        items = DEFAULT_FACILITY_GALLERY_ITEMS.map((item, index) => ({
            ...item,
            order: index + 1,
            images: resolveFacilityGalleryImages(item)
        }));
    }

    section.style.display = '';
    window._facilityGalleryItems = items.map(item => ({
        title: item.title || '公共設施',
        images: item.images
    }));

    grid.innerHTML = items.map((item, index) => `
        <article class="facility-gallery-card" onclick="openFacilityGallery(${index})">
            <div class="facility-gallery-image-wrap">
                <img class="facility-gallery-image" src="${escapeHtml(item.images[0])}" alt="${escapeHtml(item.title || '公共設施照片')}" loading="lazy">
                ${item.images.length > 1 ? `<span class="room-gallery-hint"><span class="material-symbols-outlined">photo_library</span> ${item.images.length} 張照片</span>` : ''}
            </div>
            <div class="facility-gallery-info">
                <div class="facility-gallery-title">${escapeHtml(item.title || '公共設施')}</div>
                ${item.desc ? `<div class="facility-gallery-desc">${escapeHtml(item.desc)}</div>` : ''}
            </div>
        </article>
    `).join('');
}

function openFacilityGallery(index = 0) {
    const list = window._facilityGalleryItems || [];
    const item = list[index];
    if (!item || !Array.isArray(item.images) || !item.images.length) return;
    openImageGallery(item.title || '公共設施相簿', item.images, 0);
}

function resolveFacilityGalleryImages(item) {
    const images = [];
    if (item && Array.isArray(item.images)) {
        item.images.forEach(url => {
            const normalized = String(url || '').trim();
            if (normalized) images.push(normalized);
        });
    }
    // 相容舊資料：只有 image 欄位
    if (item && item.image) {
        const legacy = String(item.image).trim();
        if (legacy && !images.includes(legacy)) images.push(legacy);
    }
    return images;
}

// ===== 動態生成房型卡片（從房型管理 + 設施設定合併） =====
function renderRoomCards(cfg) {
    const grid = document.getElementById('roomsGrid');
    if (!grid) {
        console.warn('⚠️ roomsGrid 元素不存在');
        return;
    }

    // 使用 API 回傳的 roomTypes（來自房型管理）
    const allRoomTypes = cfg._roomTypes || [];
    const bid = getLandingSelectedBuildingId();
    const roomTypes = allRoomTypes.filter((rt) => {
        const raw = rt?.building_id ?? rt?.buildingId ?? 1;
        const rtBid = raw === null || raw === undefined ? 1 : Number(raw);
        // 相容舊資料：預設館時也包含 building_id 為 null/0 的房型
        if (Number(bid) === 1) return rtBid === 1 || rtBid === 0 || Number.isNaN(rtBid);
        return rtBid === Number(bid);
    });

    if (roomTypes.length === 0) {
        console.log('ℹ️ 無房型資料，使用預設房型卡片');
        const bookingUrl = getLandingBookingUrl();
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
                        <a href="${bookingUrl}" class="room-book-btn" onclick="trackBookingClick()">預訂</a>
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

    // 儲存圖庫資料供 lightbox 使用
    window._roomGalleryData = {};
    
    grid.innerHTML = roomTypes.map(room => {
        const bookingUrl = appendQueryParam(getLandingBookingUrl(), 'roomTypeId', room.id);
        const featureItemsList = getRoomFeatureItemsForLanding(room, cfg);
        const features = featureItemsList.join(',');
        const badge = cfg[`landing_roomtype_${room.id}_badge`] || '';
        const featureItems = buildFeatureHTML(features);
        const badgeClass = badgeClassMap[badge] || '';
        const price = room.price || 0;
        const originalPrice = room.original_price || 0;
        const holidaySurcharge = room.holiday_surcharge || 0;
        const displayName = room.display_name || room.name || '房型';

        // 組合所有圖片：主圖 + 圖庫
        const allImages = [];
        if (room.image_url) allImages.push(room.image_url);
        if (room.gallery_images && room.gallery_images.length > 0) {
            room.gallery_images.forEach(url => { if (url !== room.image_url) allImages.push(url); });
        }
        window._roomGalleryData[room.id] = { images: allImages, name: displayName };
        
        const hasGallery = allImages.length > 1;

        console.log(`🏨 ${displayName} (ID:${room.id}) | 價格: ${price} | 原價: ${originalPrice} | 圖庫: ${allImages.length}張`);

        return `
            <div class="room-card" onclick="trackViewContent('${displayName}', ${price})">
                <div class="room-image" onclick="event.stopPropagation(); ${hasGallery ? `openRoomGallery(${room.id})` : ''};" style="${hasGallery ? 'cursor:pointer;' : ''}">
                    ${room.image_url ? `<img src="${room.image_url}" alt="${displayName}" loading="lazy">` : '<div style="height:200px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;color:#999;">尚無圖片</div>'}
                    ${badge ? `<span class="room-badge ${badgeClass}">${badge}</span>` : ''}
                    ${hasGallery ? `<span class="room-gallery-hint"><span class="material-symbols-outlined">photo_library</span> ${allImages.length} 張照片</span>` : ''}
                </div>
                <div class="room-info">
                    <h3>${displayName}</h3>
                    ${featureItems ? `<div class="room-features">${featureItems}</div>` : ''}
                    <div class="room-price-row">
                        <div class="room-price">
                            <span class="price-current">NT$ ${price.toLocaleString()}</span>
                            ${originalPrice > 0 ? `<span class="price-old">NT$ ${originalPrice.toLocaleString()}</span>` : ''}
                        </div>
                        <a href="${bookingUrl}" class="room-book-btn" onclick="trackBookingClick();">預訂</a>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    console.log('✅ 房型卡片已渲染，共', roomTypes.length, '張');
}

function resolveReviewItems(cfg) {
    let items = [];
    const raw = cfg ? cfg.landing_reviews_items : null;
    if (raw) {
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) {
                items = parsed.map((item, index) => ({
                    name: String(item.name || '').trim(),
                    date: String(item.date || '').trim(),
                    rating: String(item.rating || '').trim() || '5.0',
                    text: String(item.text || '').trim(),
                    tags: String(item.tags || '').trim(),
                    enabled: item.enabled !== false,
                    order: Number(item.order) || (index + 1)
                }));
            }
        } catch (error) {
            console.warn('解析 landing_reviews_items 失敗，將嘗試舊版評價欄位:', error);
        }
    }

    if (!items.length) {
        for (let i = 1; i <= 3; i++) {
            const name = String(cfg[`landing_review_${i}_name`] || '').trim();
            const text = String(cfg[`landing_review_${i}_text`] || '').trim();
            const date = String(cfg[`landing_review_${i}_date`] || '').trim();
            const rating = String(cfg[`landing_review_${i}_rating`] || '').trim();
            const tags = String(cfg[`landing_review_${i}_tags`] || '').trim();
            if (!name && !text && !date && !rating && !tags) continue;
            items.push({
                name,
                date,
                rating: rating || '5.0',
                text,
                tags,
                enabled: true,
                order: i
            });
        }
    }

    if (!items.length) {
        items = DEFAULT_REVIEW_ITEMS.map(item => ({ ...item }));
    }

    return items
        .filter(item => item.enabled !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

// ===== 動態生成評價卡片 =====
function renderReviewCards(cfg) {
    const grid = document.getElementById('reviewsGrid');
    if (!grid) return;

    const reviews = resolveReviewItems(cfg);
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
            content_category: '旅宿訂房'
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
            content_category: '旅宿訂房',
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
    const setMobileMenuState = (open) => {
        navMenu.classList.toggle('active', open);
        navToggle.classList.toggle('active', open);
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const closeMobileMenu = () => {
        setMobileMenuState(false);
    };

    navToggle.addEventListener('click', () => {
        const isOpen = navMenu.classList.contains('active');
        setMobileMenuState(!isOpen);
    });
    
    // 點擊連結後關閉選單
    navMenu.querySelectorAll('.nav-link, .nav-cta').forEach(link => {
        link.addEventListener('click', () => {
            closeMobileMenu();
        });
    });

    // 點選單外區域可關閉
    document.addEventListener('click', (event) => {
        const isOpen = navMenu.classList.contains('active');
        if (!isOpen) return;
        const clickedInsideMenu = navMenu.contains(event.target);
        const clickedToggle = navToggle.contains(event.target);
        if (!clickedInsideMenu && !clickedToggle) {
            closeMobileMenu();
        }
    });

    // Esc 可關閉選單
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMobileMenu();
        }
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
document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach(anchor => {
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
const LANDING_SELECTED_BUILDING_STORAGE_KEY = 'selected_building_id_v1';
let landingAllBuildings = [];
let landingSelectedBuildingId = 1;

function getLandingSelectedBuildingId() {
    try {
        const raw = localStorage.getItem(LANDING_SELECTED_BUILDING_STORAGE_KEY);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
            landingSelectedBuildingId = parsed;
            return parsed;
        }
    } catch (_) {}
    return landingSelectedBuildingId || 1;
}

function setLandingSelectedBuildingId(nextId) {
    const parsed = parseInt(String(nextId ?? ''), 10);
    const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    landingSelectedBuildingId = safe;
    try {
        localStorage.setItem(LANDING_SELECTED_BUILDING_STORAGE_KEY, String(safe));
    } catch (_) {}
}

function getLandingBookingUrl() {
    const utmParams = getUTMParams();
    const qs = new URLSearchParams(utmParams);
    const buildingId = getLandingSelectedBuildingId();
    if (buildingId && Number(buildingId) > 0) {
        qs.set('buildingId', String(buildingId));
    }
    const queryString = qs.toString();
    return queryString ? `/booking?${queryString}` : '/booking';
}

function appendQueryParam(url, key, value) {
    try {
        const u = new URL(url, window.location.origin);
        u.searchParams.set(String(key), String(value));
        return u.pathname + (u.search ? u.search : '');
    } catch (_) {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`;
    }
}

function updateBookingLinks() {
    const bookingUrl = getLandingBookingUrl();
    let base;
    try {
        base = new URL(bookingUrl, window.location.origin);
    } catch (_) {
        base = null;
    }
    document.querySelectorAll('a').forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) return;
        try {
            const u = new URL(href, window.location.origin);
            if (u.pathname !== '/booking') return;

            // 合併：保留 link 自己的參數（例如 roomTypeId），同時補上 buildingId / utm 參數
            if (base) {
                base.searchParams.forEach((v, k) => {
                    if (!u.searchParams.has(k) || !u.searchParams.get(k)) {
                        u.searchParams.set(k, v);
                    }
                });
            } else {
                // fallback：至少補上 buildingId
                const bid = getLandingSelectedBuildingId();
                if (bid && !u.searchParams.has('buildingId')) {
                    u.searchParams.set('buildingId', String(bid));
                }
            }

            link.href = u.pathname + (u.search ? u.search : '');
        } catch (_) {}
    });
}

async function loadLandingBuildings() {
    try {
        const res = await fetch('/api/buildings');
        if (!res.ok) return [];
        const j = await res.json();
        if (!j || !j.success) return [];
        return Array.isArray(j.data) ? j.data : [];
    } catch (_) {
        return [];
    }
}

function syncLandingBuildingSwitch(cfg) {
    const wrap = document.getElementById('roomsBuildingSwitch');
    const selectEl = document.getElementById('roomsBuildingSelect');
    if (!wrap || !selectEl) return;

    const buildings = Array.isArray(landingAllBuildings)
        ? landingAllBuildings.filter((b) => Number(b?.is_active ?? 1) !== 0)
        : [];
    const show = buildings.length > 1;
    wrap.style.display = show ? '' : 'none';

    if (!show) {
        setLandingSelectedBuildingId(1);
        selectEl.innerHTML = '';
        return;
    }

    const current = getLandingSelectedBuildingId();
    const exists = buildings.some((b) => Number(b?.id) === Number(current));
    const effective = exists ? current : Number(buildings[0]?.id || 1);
    setLandingSelectedBuildingId(effective);

    selectEl.innerHTML = buildings
        .map((b) => {
            const id = Number(b?.id);
            const name = String(b?.name || b?.code || `館別 ${id}`);
            return `<option value="${id}">${escapeHtml(name)}</option>`;
        })
        .join('');
    selectEl.value = String(effective);

    if (!selectEl.dataset.boundChange) {
        selectEl.addEventListener('change', () => {
            setLandingSelectedBuildingId(selectEl.value);
            renderRoomCards(cfg);
            updateBookingLinks();
        });
        selectEl.dataset.boundChange = '1';
    }
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
    // 先載入後台設定
    await loadLandingConfig();

    // 載入館別並同步房型展示（只在多館時顯示切換）
    landingAllBuildings = await loadLandingBuildings();
    landingSelectedBuildingId = getLandingSelectedBuildingId();
    syncLandingBuildingSwitch(landingConfig);
    
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

// ===== 房型圖庫 Lightbox =====
let _galleryCurrentIndex = 0;
let _galleryImages = [];

function openRoomGallery(roomId) {
    const data = window._roomGalleryData && window._roomGalleryData[roomId];
    if (!data || data.images.length === 0) return;
    openImageGallery(data.name, data.images, 0);
}

function openImageGallery(title, images, startIndex = 0) {
    if (!Array.isArray(images) || images.length === 0) return;

    _galleryImages = images.filter(Boolean);
    if (_galleryImages.length === 0) return;
    _galleryCurrentIndex = Math.max(0, Math.min(startIndex, _galleryImages.length - 1));

    const overlay = document.getElementById('galleryLightbox');
    if (!overlay) return;

    document.getElementById('galleryTitle').textContent = title || '圖片';
    updateGalleryDisplay();
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeGalleryLightbox() {
    const overlay = document.getElementById('galleryLightbox');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}

function galleryPrev() {
    if (_galleryImages.length === 0) return;
    _galleryCurrentIndex = (_galleryCurrentIndex - 1 + _galleryImages.length) % _galleryImages.length;
    updateGalleryDisplay();
}

function galleryNext() {
    if (_galleryImages.length === 0) return;
    _galleryCurrentIndex = (_galleryCurrentIndex + 1) % _galleryImages.length;
    updateGalleryDisplay();
}

function updateGalleryDisplay() {
    const mainImg = document.getElementById('galleryMainImage');
    const counter = document.getElementById('galleryCounter');
    const thumbs = document.getElementById('galleryThumbnails');
    if (!mainImg) return;
    
    mainImg.src = _galleryImages[_galleryCurrentIndex];
    if (counter) counter.textContent = `${_galleryCurrentIndex + 1} / ${_galleryImages.length}`;
    
    if (thumbs) {
        thumbs.innerHTML = _galleryImages.map((url, i) => 
            `<div class="gallery-thumb ${i === _galleryCurrentIndex ? 'active' : ''}" onclick="galleryGoTo(${i})">
                <img src="${url}" alt="" loading="lazy">
            </div>`
        ).join('');
    }
}

function galleryGoTo(index) {
    _galleryCurrentIndex = index;
    updateGalleryDisplay();
}

// 鍵盤操作
document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('galleryLightbox');
    if (!overlay || !overlay.classList.contains('active')) return;
    if (e.key === 'Escape') closeGalleryLightbox();
    if (e.key === 'ArrowLeft') galleryPrev();
    if (e.key === 'ArrowRight') galleryNext();
});

// 觸控滑動支援
(function() {
    let touchStartX = 0;
    document.addEventListener('touchstart', (e) => {
        const overlay = document.getElementById('galleryLightbox');
        if (!overlay || !overlay.classList.contains('active')) return;
        touchStartX = e.touches[0].clientX;
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
        const overlay = document.getElementById('galleryLightbox');
        if (!overlay || !overlay.classList.contains('active')) return;
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) {
            if (diff > 0) galleryNext();
            else galleryPrev();
        }
    }, { passive: true });
})();
