/**
 * 悠然山居民宿 - 銷售頁腳本
 * 包含 Facebook 像素追蹤、倒數計時、導航互動等功能
 */

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
    // 設定優惠結束時間（可自訂，這裡設為 7 天後）
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 0);
    
    function updateCountdown() {
        const now = new Date();
        const diff = endDate - now;
        
        if (diff <= 0) {
            // 優惠結束，重置為新的 7 天
            endDate.setDate(endDate.getDate() + 7);
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
document.addEventListener('DOMContentLoaded', () => {
    initCountdown();
    initScrollAnimations();
    storeUTMParams();
    updateBookingLinks();
    
    console.log('Landing page initialized');
    console.log('UTM Params:', getUTMParams());
});

// ===== 圖片懶載入優化 =====
if ('loading' in HTMLImageElement.prototype) {
    // 瀏覽器支援原生懶載入
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.src = img.dataset.src || img.src;
    });
} else {
    // 使用 Intersection Observer 作為後備方案
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

