// Cookie 同意管理
(function() {
    'use strict';
    
    const COOKIE_CONSENT_KEY = 'cookie_consent';
    const COOKIE_CONSENT_EXPIRY_DAYS = 365; // Cookie 同意有效期（天）
    
    // 檢查是否已經有 Cookie 同意記錄
    function hasCookieConsent() {
        const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
        if (!consent) return false;
        
        try {
            const consentData = JSON.parse(consent);
            // 檢查是否過期（超過 1 年）
            if (consentData.timestamp) {
                const expiryDate = new Date(consentData.timestamp);
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                if (new Date() > expiryDate) {
                    localStorage.removeItem(COOKIE_CONSENT_KEY);
                    return false;
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }
    
    // 儲存 Cookie 同意
    function saveCookieConsent(accepted) {
        const consentData = {
            accepted: accepted,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consentData));
    }
    
    // 顯示 Cookie 橫幅
    function showCookieBanner() {
        const banner = document.getElementById('cookieBanner');
        if (banner) {
            banner.classList.remove('hidden');
        }
    }
    
    // 隱藏 Cookie 橫幅
    function hideCookieBanner() {
        const banner = document.getElementById('cookieBanner');
        if (banner) {
            banner.classList.add('hidden');
        }
    }
    
    // 處理接受 Cookie
    function handleAcceptCookies() {
        saveCookieConsent(true);
        hideCookieBanner();
        console.log('Cookie 同意：已接受');
    }
    
    // 處理拒絕 Cookie
    function handleRejectCookies() {
        saveCookieConsent(false);
        hideCookieBanner();
        // 可以選擇刪除現有的 Cookie（如果需要）
        console.log('Cookie 同意：已拒絕');
    }
    
    // 初始化
    function init() {
        // 如果已經有同意記錄，不顯示橫幅
        if (hasCookieConsent()) {
            return;
        }
        
        // 顯示 Cookie 橫幅
        showCookieBanner();
        
        // 綁定事件
        const acceptBtn = document.getElementById('acceptCookies');
        const rejectBtn = document.getElementById('rejectCookies');
        
        if (acceptBtn) {
            acceptBtn.addEventListener('click', handleAcceptCookies);
        }
        
        if (rejectBtn) {
            rejectBtn.addEventListener('click', handleRejectCookies);
        }
    }
    
    // DOM 載入完成後初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // 匯出函數供外部使用（如果需要）
    window.cookieConsent = {
        hasConsent: hasCookieConsent,
        accept: handleAcceptCookies,
        reject: handleRejectCookies
    };
})();

