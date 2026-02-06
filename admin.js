// 管理後台 JavaScript

// 立即確認腳本開始執行
console.log('🚀 admin.js 腳本開始執行', new Date().toISOString());

// 立即定義 handleLogin 函數，確保在任何其他代碼執行前就可用
// 直接定義真正的函數，不使用佔位符邏輯
if (typeof window !== 'undefined') {
    // 處理登入 - 直接定義為 window.handleLogin，確保立即可用
    window.handleLogin = async function handleLogin(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        
        console.log('🔐 開始處理登入...');
        
        const username = document.getElementById('loginUsername')?.value;
        const password = document.getElementById('loginPassword')?.value;
        const errorDiv = document.getElementById('loginError');
        
        // 驗證輸入
        if (!username || !password) {
            console.warn('⚠️ 帳號或密碼為空');
            if (errorDiv) {
                errorDiv.textContent = '請輸入帳號和密碼';
                errorDiv.style.display = 'block';
            }
            return;
        }
        
        // 清除錯誤訊息
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';
        }
        
        // 顯示載入狀態
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');
        const originalBtnText = submitBtn?.textContent;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '登入中...';
        }
        
        try {
            console.log('📡 發送登入請求到 /api/admin/login...');
            console.log('📡 請求詳情:', {
                url: '/api/admin/login',
                method: 'POST',
                username: username,
                hasPassword: !!password
            });
            
            let response;
            try {
                response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // 重要：包含 cookies
                    body: JSON.stringify({ username, password })
                });
            } catch (fetchError) {
                console.error('❌ Fetch 請求失敗:', fetchError);
                console.error('錯誤類型:', fetchError.name);
                console.error('錯誤訊息:', fetchError.message);
                console.error('錯誤堆疊:', fetchError.stack);
                
                // 提供更詳細的錯誤訊息
                let errorMessage = '無法連接到伺服器';
                if (fetchError.message.includes('Failed to fetch')) {
                    errorMessage = '無法連接到伺服器，請檢查網路連線或伺服器狀態';
                } else if (fetchError.message.includes('NetworkError')) {
                    errorMessage = '網路錯誤，請檢查網路連線';
                } else if (fetchError.message.includes('CORS')) {
                    errorMessage = '跨域請求被阻止，請聯繫管理員';
                }
                
                if (errorDiv) {
                    errorDiv.textContent = errorMessage;
                    errorDiv.style.display = 'block';
                }
                throw fetchError;
            }
            
            console.log('📥 收到登入回應:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            let result;
            try {
                result = await response.json();
                console.log('📥 登入回應內容:', result);
            } catch (parseError) {
                console.error('❌ 無法解析登入回應 JSON:', parseError);
                const text = await response.text();
                console.error('❌ 回應內容（文字）:', text);
                console.error('❌ 回應狀態:', response.status, response.statusText);
                throw new Error('伺服器回應格式錯誤');
            }
            
            if (result.success) {
                // 登入成功
                console.log('✅ 登入成功，準備顯示管理後台');
                console.log('✅ 管理員資訊:', result.admin);
                
                // 清除任何錯誤訊息
                if (errorDiv) {
                    errorDiv.style.display = 'none';
                    errorDiv.textContent = '';
                }
                
                // 立即顯示管理後台（如果 showAdminPage 函數已定義）
                if (typeof showAdminPage === 'function') {
                    console.log('✅ 使用 showAdminPage 函數顯示管理後台');
                    showAdminPage(result.admin);
                } else {
                    console.log('⚠️ showAdminPage 函數未定義，直接切換頁面');
                    // 如果 showAdminPage 未定義，直接切換頁面
                    const adminPage = document.getElementById('adminPage');
                    const loginPage = document.getElementById('loginPage');
                    if (adminPage) {
                        adminPage.style.display = 'flex';
                        adminPage.style.visibility = 'visible';
                        adminPage.style.opacity = '1';
                        console.log('✅ adminPage 已顯示');
                    } else {
                        console.error('❌ 找不到 adminPage 元素');
                    }
                    if (loginPage) {
                        loginPage.style.display = 'none';
                        console.log('✅ loginPage 已隱藏');
                    }
                }
                
                // 立即開始載入資料（不等待延遲）
                console.log('📊 開始載入資料...');
                
                // 並行載入資料，不等待
                const loadPromises = [];
                if (typeof loadBookings === 'function') {
                    loadPromises.push(loadBookings().catch(err => {
                        console.error('❌ 載入訂房記錄失敗:', err);
                    }));
                }
                if (typeof loadStatistics === 'function') {
                    loadPromises.push(loadStatistics().catch(err => {
                        console.error('❌ 載入統計資料失敗:', err);
                    }));
                }
                
                // 不等待載入完成，讓頁面立即顯示
                Promise.all(loadPromises).then(() => {
                    console.log('✅ 資料載入完成');
                }).catch(err => {
                    console.error('❌ 資料載入過程中有錯誤:', err);
                });
            } else {
                // 登入失敗
                console.warn('⚠️ 登入失敗:', result.message);
                if (errorDiv) {
                    errorDiv.textContent = result.message || '登入失敗，請檢查帳號密碼';
                    errorDiv.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('❌ 登入錯誤:', error);
            console.error('錯誤類型:', error.name);
            console.error('錯誤訊息:', error.message);
            console.error('錯誤堆疊:', error.stack);
            
            // 提供更詳細的錯誤訊息
            let errorMessage = '登入時發生錯誤：' + (error.message || '請稍後再試');
            if (error.message && error.message.includes('Failed to fetch')) {
                errorMessage = '無法連接到伺服器。請檢查：\n1. 網路連線是否正常\n2. 伺服器是否正在運行\n3. 是否有防火牆或代理阻擋';
            } else if (error.message && error.message.includes('NetworkError')) {
                errorMessage = '網路錯誤。請檢查網路連線。';
            } else if (error.message && error.message.includes('CORS')) {
                errorMessage = '跨域請求被阻止。請聯繫管理員。';
            }
            
            if (errorDiv) {
                errorDiv.textContent = errorMessage;
                errorDiv.style.display = 'block';
                errorDiv.style.whiteSpace = 'pre-line'; // 允許換行
                console.log('✅ 錯誤訊息已顯示給用戶');
            } else {
                console.error('❌ 找不到 errorDiv 元素，無法顯示錯誤訊息');
                alert(errorMessage); // 備用方案：使用 alert
            }
        } finally {
            // 恢復按鈕狀態
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText || '登入';
            }
        }
    };
    
    // 確認設置成功
    if (typeof window.handleLogin === 'function') {
        console.log('✅ handleLogin 函數已設置:', typeof window.handleLogin);
    } else {
        console.error('❌ handleLogin 函數設置失敗');
    }
} else {
    console.error('❌ window 對象不存在，無法設置 handleLogin');
}

// 立即確認 window.handleLogin 是否已設置
console.log('🔍 [腳本開頭] window.handleLogin 狀態:', typeof window.handleLogin);
if (typeof window.handleLogin === 'function') {
    console.log('✅ [腳本開頭] handleLogin 函數已成功設置，長度:', window.handleLogin.toString().length);
    // 確保函數可以被立即調用
    try {
        // 測試函數是否可以正常調用（不實際執行）
        const testCall = window.handleLogin.toString();
        console.log('✅ [腳本開頭] handleLogin 函數可正常訪問');
    } catch (e) {
        console.error('❌ [腳本開頭] handleLogin 函數訪問失敗:', e);
    }
} else {
    console.error('❌ [腳本開頭] handleLogin 函數設置失敗，當前類型:', typeof window.handleLogin);
}

// 添加測試登入功能（僅用於調試）
window.testLogin = async function(username = 'admin', password = 'admin123') {
    console.log('🧪 測試登入功能...');
    console.log('🧪 測試帳號:', username);
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        
        console.log('🧪 測試回應狀態:', response.status, response.statusText);
        const result = await response.json();
        console.log('🧪 測試回應內容:', result);
        
        return result;
    } catch (error) {
        console.error('🧪 測試登入失敗:', error);
        throw error;
    }
};
console.log('✅ 測試登入功能已添加，可在控制台使用: testLogin("admin", "admin123")');

// 全局錯誤處理
window.addEventListener('error', function(event) {
    console.error('❌ 全局錯誤:', event.error);
    console.error('錯誤位置:', event.filename, ':', event.lineno);
    console.error('錯誤訊息:', event.message);
});

// 未捕獲的 Promise 錯誤處理
window.addEventListener('unhandledrejection', function(event) {
    console.error('❌ 未處理的 Promise 錯誤:', event.reason);
    console.error('錯誤堆疊:', event.reason?.stack);
});

// 確保函數在全局作用域可用
// 預先聲明 closeEmailTemplateModal，確保在 HTML onclick 中可用
// 這是一個臨時函數，真正的函數定義在後面，會被覆蓋
window.closeEmailTemplateModal = function() {
    const modal = document.getElementById('emailTemplateModal');
    if (modal) {
        modal.classList.remove('active');
    }
    // 如果真正的函數已經載入，不會執行到這裡
    // 這個臨時函數只是為了確保在 HTML onclick 中可以使用
};

// toggleEditorMode 和 toggleEmailPreview 已在檔案前面定義為 window 函數，此處無需佔位符

// 檢查登入狀態
async function checkAuthStatus() {
    try {
        console.log('🔐 檢查登入狀態...');
        
        // 並行取得 CSRF Token 和檢查登入狀態，減少等待時間
        console.log('🔑 並行取得 CSRF Token 和檢查登入狀態...');
        const [csrfResult, response] = await Promise.all([
            getCsrfToken().catch(err => {
                console.warn('⚠️ 取得 CSRF Token 失敗（非關鍵）:', err);
                return null;
            }),
            adminFetch('/api/admin/check-auth')
        ]);
        
        if (csrfResult) {
            console.log('🔑 CSRF Token 已取得');
        }
        
        console.log('📡 API 回應狀態:', {
            ok: response?.ok,
            status: response?.status,
            statusText: response?.statusText
        });
        
        if (!response || !response.ok) {
            console.warn('⚠️ 檢查登入狀態 API 回應異常:', response?.status);
            try {
                const errorText = await response?.text().catch(() => '無法讀取錯誤訊息');
                console.warn('⚠️ 錯誤內容:', errorText);
            } catch (e) {
                console.warn('⚠️ 無法讀取錯誤訊息:', e);
            }
            showLoginPage();
            return;
        }
        
        console.log('📥 解析 JSON 回應...');
        const result = await response.json();
        console.log('🔐 登入狀態檢查結果:', result);
        
        if (result.success && result.authenticated) {
            // 已登入，顯示管理後台
            console.log('✅ 已登入，顯示管理後台');
            showAdminPage(result.admin);
        } else {
            // 未登入，顯示登入頁面
            console.log('ℹ️ 未登入，顯示登入頁面');
            showLoginPage();
        }
    } catch (error) {
        console.error('❌ 檢查登入狀態錯誤:', error);
        // 出錯時顯示登入頁面
        showLoginPage();
    }
}

// 顯示登入頁面
function showLoginPage() {
    const loginPage = document.getElementById('loginPage');
    const adminPage = document.getElementById('adminPage');
    
    if (adminPage) {
        adminPage.style.display = 'none';
        adminPage.style.visibility = 'hidden';
    }
    
    if (loginPage) {
        loginPage.removeAttribute('style');
        loginPage.style.display = 'flex';
        loginPage.style.visibility = 'visible';
    }
}

// 顯示管理後台
function showAdminPage(admin) {
    try {
        console.log('🚀 開始顯示管理後台...');
        const loginPage = document.getElementById('loginPage');
        const adminPage = document.getElementById('adminPage');
        
        if (!adminPage) {
            console.error('❌ 找不到 adminPage 元素');
            return;
        }
        
        // 先隱藏登入頁面
        if (loginPage) {
            loginPage.style.display = 'none';
            loginPage.style.visibility = 'hidden';
            loginPage.style.opacity = '0';
            console.log('✅ 登入頁面已隱藏');
        }
        
        // 強制移除所有內聯樣式並設置顯示
        adminPage.removeAttribute('style');
        adminPage.setAttribute('style', 'display: flex !important; visibility: visible !important; opacity: 1 !important; min-height: 100vh !important;');
        
        // 強制顯示側邊欄和主內容區
        const sidebar = adminPage.querySelector('.sidebar');
        const mainContent = adminPage.querySelector('.main-content');
        if (sidebar) {
            sidebar.style.display = 'flex';
            sidebar.style.visibility = 'visible';
        }
        if (mainContent) {
            mainContent.style.display = 'block';
            mainContent.style.visibility = 'visible';
        }
        
        // 驗證是否成功顯示
        const computedStyle = window.getComputedStyle(adminPage);
        console.log('🔍 adminPage 計算樣式:', {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            height: computedStyle.height
        });
        
        // 確保至少有一個 section 是顯示的
        let activeSection = document.querySelector('.content-section.active');
        if (!activeSection) {
            console.warn('⚠️ 沒有找到 active 的 section，設置 dashboard-section 為 active');
            // 移除所有 active 類並清除內聯樣式
            document.querySelectorAll('.content-section').forEach(sec => {
                sec.classList.remove('active');
                sec.style.display = '';
                sec.style.visibility = '';
            });
            // 設置 dashboard-section 為 active
            const dashboardSection = document.getElementById('dashboard-section');
            if (dashboardSection) {
                dashboardSection.classList.add('active');
                activeSection = dashboardSection;
                console.log('✅ 已設置 dashboard-section 為 active');
            }
        } else {
            // 清除所有 section 的內聯樣式，讓 CSS 規則控制
            document.querySelectorAll('.content-section').forEach(sec => {
                if (sec !== activeSection) {
                    sec.style.display = '';
                    sec.style.visibility = '';
                }
            });
        }
        
        // 確保 active section 顯示（CSS 應該已經處理，但為了保險起見）
        if (activeSection) {
            activeSection.style.display = 'block';
            activeSection.style.visibility = 'visible';
            console.log('✅ Active section 已顯示:', activeSection.id);
        }
        
        // 設置管理員名稱和角色
        if (admin && admin.username) {
            const usernameEl = document.getElementById('currentAdminUsername');
            if (usernameEl) {
                usernameEl.textContent = admin.username;
                console.log('✅ 管理員名稱已設置:', admin.username);
            }
            
            // 設置角色名稱
            const roleEl = document.getElementById('currentAdminRole');
            if (roleEl) {
                roleEl.textContent = admin.role_display_name || admin.role || '-';
            }
            
            // 儲存管理員權限到全域變數
            if (admin.permissions) {
                window.currentAdminPermissions = admin.permissions;
                console.log('✅ 管理員權限已載入:', admin.permissions.length, '個權限');
            }
            
            // 根據權限更新側邊欄顯示
            updateSidebarByPermissions();
        }
        
        // 立即載入初始資料（不等待，讓頁面先顯示）
        const loadPromises = [];
        if (typeof loadBookings === 'function') {
            loadPromises.push(loadBookings().catch(err => {
                console.error('❌ 載入訂房記錄失敗:', err);
            }));
        }
        if (typeof loadStatistics === 'function') {
            loadPromises.push(loadStatistics().catch(err => {
                console.error('❌ 載入統計資料失敗:', err);
            }));
        }
        
        // 不等待載入完成
        Promise.all(loadPromises).then(() => {
            console.log('✅ 初始資料載入完成');
        }).catch(err => {
            console.error('❌ 初始資料載入過程中有錯誤:', err);
        });
        
    } catch (error) {
        console.error('❌ 顯示管理後台時發生錯誤:', error);
        console.error('錯誤堆疊:', error.stack);
        // 即使出錯也嘗試顯示頁面
        const adminPage = document.getElementById('adminPage');
        if (adminPage) {
            adminPage.setAttribute('style', 'display: flex !important; visibility: visible !important; opacity: 1 !important; min-height: 100vh !important;');
        }
    }
}

// handleLogin 已在檔案開頭定義，此處無需重複定義

// 處理登出
async function handleLogout() {
    if (!confirm('確定要登出嗎？')) {
        return;
    }
    
    try {
        const response = await fetch('/api/admin/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showLoginPage();
            // 清除表單
            const loginForm = document.getElementById('loginForm');
            if (loginForm) loginForm.reset();
        } else {
            showError('登出失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('登出錯誤:', error);
        showError('登出時發生錯誤');
    }
}

// CSRF Token 快取
let csrfTokenCache = null;

// 取得 CSRF Token
async function getCsrfToken() {
    if (csrfTokenCache) {
        return csrfTokenCache;
    }
    
    try {
        const response = await fetch('/api/csrf-token', {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            csrfTokenCache = data.csrfToken;
            return csrfTokenCache;
        }
    } catch (error) {
        console.warn('無法取得 CSRF Token:', error);
    }
    return null;
}

// 確保這些函數可以在 HTML onclick 屬性中訪問
// 在 DOM 加載完成後暴露函數到 window 對象
function exposeFunctionsToWindow() {
    try {
        if (typeof toggleEditorMode === 'function') {
            window.toggleEditorMode = toggleEditorMode;
        }
        // 檢查 sendTestEmail 是否已正確設置（不是臨時函數）
        if (typeof sendTestEmail === 'function') {
            const currentFn = window.sendTestEmail;
            const isTemporary = currentFn && 
                               typeof currentFn === 'function' &&
                               (currentFn.toString().includes('尚未載入') || 
                                currentFn.toString().includes('功能載入中'));
            // 只有當當前函數是臨時函數或不存在時才設置
            if (!currentFn || isTemporary) {
                window.sendTestEmail = sendTestEmail;
                console.log('✅ exposeFunctionsToWindow: sendTestEmail 已設置');
            } else {
                console.log('✅ exposeFunctionsToWindow: sendTestEmail 已正確設置，跳過');
            }
        }
        if (typeof closeEmailTemplateModal === 'function') {
            window.closeEmailTemplateModal = closeEmailTemplateModal;
        }
        if (typeof resetCurrentTemplateToDefault === 'function') {
            window.resetCurrentTemplateToDefault = resetCurrentTemplateToDefault;
        }
        if (typeof saveEmailTemplate === 'function') {
            window.saveEmailTemplate = saveEmailTemplate;
        }
    } catch (error) {
        console.error('暴露函數到 window 對象時發生錯誤:', error);
    }
}

// 統一的 API 請求函數（自動包含 credentials 和 CSRF Token）
async function adminFetch(url, options = {}) {
    // 取得 CSRF Token
    const csrfToken = await getCsrfToken();
    
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };
    
    // 如果是 POST、PUT、PATCH、DELETE 請求，加入 CSRF Token
    if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase())) {
        defaultOptions.headers['X-CSRF-Token'] = csrfToken;
    }
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    try {
        const response = await fetch(url, mergedOptions);
        
        // 如果收到 401 未授權錯誤，靜默處理（不拋出錯誤）
        if (response.status === 401) {
            // 返回 response，讓調用者自行處理
            return response;
        }
        
        // 如果收到 403 或 CSRF 錯誤，清除 Token 快取並重試一次
        if (response.status === 403 || response.status === 400) {
            // Clone response 以便讀取 body，同時保留原始 response
            const clonedResponse = response.clone();
            const result = await clonedResponse.json().catch(() => ({}));
            if (result.message && result.message.includes('CSRF')) {
                csrfTokenCache = null; // 清除快取
                // 重新取得 Token 並重試
                const newToken = await getCsrfToken();
                if (newToken) {
                    mergedOptions.headers['X-CSRF-Token'] = newToken;
                    return await fetch(url, mergedOptions);
                }
            }
        }
        
        return response;
    } catch (error) {
        // 只有在開發環境才顯示錯誤
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('API 請求錯誤:', error);
        }
        throw error;
    }
}

let allBookings = [];
let filteredBookings = [];
let currentPage = 1;
const itemsPerPage = 10;
let currentBookingView = 'list';
let calendarStartDate = null;
let sortColumn = null; // 當前排序欄位
let sortDirection = 'asc'; // 排序方向：'asc' 或 'desc'

let isHtmlMode = false;
let isPreviewVisible = false; // 預覽是否顯示
let currentEmailStyle = 'card'; // 當前郵件樣式
let isSimpleMode = false; // 簡化編輯模式：只編輯文字內容，保護 HTML 結構

// 初始化
document.addEventListener('DOMContentLoaded', async function() {
    try {
        console.log('📋 開始初始化管理後台...', new Date().toISOString());
        console.log('📋 DOM 已載入，檢查頁面元素...');
        
        // 立即檢查關鍵元素是否存在
        const loginPage = document.getElementById('loginPage');
        const adminPage = document.getElementById('adminPage');
        console.log('🔍 頁面元素檢查:', {
            loginPage: !!loginPage,
            adminPage: !!adminPage,
            loginPageDisplay: loginPage ? window.getComputedStyle(loginPage).display : 'N/A',
            adminPageDisplay: adminPage ? window.getComputedStyle(adminPage).display : 'N/A'
        });

        // 重要：先顯示登入頁，避免等待 API（CSRF/登入狀態）時整頁空白
        // 後續 checkAuthStatus() 若判定已登入，會再切到管理後台
        showLoginPage();
        
        // 檢查登入狀態
        console.log('🔐 準備檢查登入狀態...');
        // 加上超時，避免 API 卡住導致長時間白畫面/無反應
        await Promise.race([
            checkAuthStatus(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('檢查登入狀態逾時')), 8000))
        ]).catch(err => {
            console.warn('⚠️ checkAuthStatus 未完成（可能逾時/伺服器未回應）:', err?.message || err);
            // 保持在登入頁
            showLoginPage();
        });
        
        // 導航切換
        const navItems = document.querySelectorAll('.nav-item');
        if (navItems.length === 0) {
            console.warn('⚠️ 找不到導航項目');
        } else {
            navItems.forEach(item => {
                item.addEventListener('click', function(e) {
                    e.preventDefault();
                    const section = this.dataset.section;
                    switchSection(section);
                });
            });
        }

        // 載入資料（只有在已登入時才載入）
        // 重用上面已聲明的 adminPage 變數
        if (adminPage && adminPage.style.display !== 'none') {
            console.log('📊 載入初始資料...');
            loadBookings();
            loadStatistics();
        } else {
            console.log('ℹ️ 未登入或頁面未顯示，跳過資料載入');
        }
    } catch (error) {
        console.error('❌ 初始化錯誤:', error);
        // 即使出錯也嘗試顯示登入頁面
        showLoginPage();
    }
    
    // 根據 URL hash 載入對應區塊
    const urlHash = window.location.hash;
    if (urlHash === '#dashboard') {
        switchSection('dashboard');
        loadDashboard();
    } else if (urlHash === '#bookings') {
        switchSection('bookings');
        if (currentBookingView === 'calendar') {
            loadBookingCalendar();
        } else {
            loadBookings();
        }
    } else if (urlHash === '#room-types') {
        switchSection('room-types');
        // loadRoomTypes() 會在 switchSection 中根據分頁狀態決定是否載入
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
    } else if (!urlHash) {
        // 如果沒有 URL hash，預設顯示儀表板
        switchSection('dashboard');
        loadDashboard();
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
                // 檢查函數是否已定義
                if (typeof closeEmailTemplateModal === 'function') {
                    closeEmailTemplateModal();
                } else {
                    // 如果函數未定義，直接關閉模態框
                    emailTemplateModal.classList.remove('active');
                }
            }
        });
    }
    
    // 暴露函數到 window 對象，以便在 HTML onclick 屬性中訪問
    exposeFunctionsToWindow();
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

    // 更新內容區 - 隱藏所有 section 並清除內聯樣式
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
        // 清除可能存在的內聯 display 樣式，讓 CSS 規則控制顯示/隱藏
        sec.style.display = '';
        sec.style.visibility = '';
    });
    
    // 顯示選中的 section
    const contentSection = document.getElementById(`${section}-section`);
    if (contentSection) {
        contentSection.classList.add('active');
        // 確保 active section 顯示（CSS 應該已經處理，但為了保險起見）
        contentSection.style.display = 'block';
    } else {
        console.warn('⚠️ 找不到 section:', `${section}-section`);
    }
    
    // 根據區塊載入對應資料
    if (section === 'dashboard') {
        loadDashboard();
    } else if (section === 'room-types') {
        // 載入房型管理時，檢查 localStorage 恢復分頁狀態
        const savedTab = localStorage.getItem('roomTypeTab') || 'room-types';
        switchRoomTypeTab(savedTab);
        if (savedTab === 'room-types') {
            loadRoomTypes();
        }
    } else if (section === 'addons') {
        loadAddons();
    } else if (section === 'promo-codes') {
        loadPromoCodes();
    } else if (section === 'settings') {
        loadSettings();
        // 恢復上次選擇的分頁
        const savedTab = localStorage.getItem('settingsTab') || 'basic';
        switchSettingsTab(savedTab);
    } else if (section === 'email-templates') {
        loadEmailTemplates();
    } else if (section === 'statistics') {
        loadStatistics();
    } else if (section === 'bookings') {
        if (currentBookingView === 'calendar') {
            loadBookingCalendar();
        } else {
            loadBookings();
        }
    } else if (section === 'customers') {
        // 檢查是否有保存的分頁
        const savedTab = localStorage.getItem('customerTab') || 'customers';
        switchCustomerTab(savedTab);
    } else if (section === 'admin-management') {
        loadAdmins();
    } else if (section === 'role-management') {
        loadRoles();
        loadPermissionsReference();
    }
}

// 切換房型管理分頁
function switchRoomTypeTab(tab) {
    // 保存當前分頁到 localStorage
    localStorage.setItem('roomTypeTab', tab);
    
    // 更新分頁按鈕狀態
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 顯示/隱藏對應的內容
    if (tab === 'room-types') {
        document.getElementById('roomTypesTab').classList.add('active');
        document.getElementById('roomTypesTabContent').style.display = 'block';
        document.getElementById('holidaysTabContent').style.display = 'none';
        
        // 顯示/隱藏對應的按鈕
        document.getElementById('addRoomTypeBtn').style.display = 'inline-flex';
        document.getElementById('roomTypeRefreshBtn').style.display = 'inline-flex';
        document.getElementById('holidayRefreshBtn').style.display = 'none';
        
        // 載入房型列表
        loadRoomTypes();
    } else if (tab === 'holidays') {
        document.getElementById('holidaysTab').classList.add('active');
        document.getElementById('roomTypesTabContent').style.display = 'none';
        document.getElementById('holidaysTabContent').style.display = 'block';
        
        // 顯示/隱藏對應的按鈕
        document.getElementById('addRoomTypeBtn').style.display = 'none';
        document.getElementById('roomTypeRefreshBtn').style.display = 'none';
        document.getElementById('holidayRefreshBtn').style.display = 'inline-flex';
        
        // 載入假日資料和平日/假日設定
        loadHolidays();
        // 使用 setTimeout 確保 DOM 元素已經渲染完成
        setTimeout(() => {
            loadWeekdaySettingsFromServer();
        }, 200);
    }
}

// 載入儀表板數據
async function loadDashboard() {
    try {
        const response = await adminFetch('/api/dashboard');
        
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
        const response = await adminFetch('/api/bookings');
        
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

// 切換訂房記錄視圖
function switchBookingView(view) {
    currentBookingView = view;
    
    // 更新標籤狀態
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    const activeTab = document.querySelector(`.view-tab[data-view="${view}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    // 顯示對應視圖
    const listView = document.getElementById('bookingListView');
    const calendarView = document.getElementById('bookingCalendarView');
    if (listView) listView.style.display = view === 'list' ? 'block' : 'none';
    if (calendarView) calendarView.style.display = view === 'calendar' ? 'block' : 'none';
    
    // 載入對應資料
    if (view === 'calendar') {
        if (!calendarStartDate) {
            calendarStartDate = new Date();
        }
        loadBookingCalendar();
    } else {
        loadBookings();
    }
}

// 重新載入當前視圖（並重設篩選條件）
function reloadCurrentBookingView() {
    if (currentBookingView === 'calendar') {
        // 日曆視圖目前沒有額外篩選，直接重新載入
        loadBookingCalendar();
        return;
    }

    // 清空列表視圖的搜尋與篩選欄位
    const searchInput = document.getElementById('searchInput');
    const roomTypeFilter = document.getElementById('roomTypeFilter');
    const statusFilter = document.getElementById('statusFilter');
    const checkInDateFilter = document.getElementById('checkInDateFilter');

    if (searchInput) searchInput.value = '';
    if (roomTypeFilter) roomTypeFilter.value = '';
    if (statusFilter) statusFilter.value = '';
    if (checkInDateFilter) checkInDateFilter.value = '';

    // 重設排序狀態（回到預設）
    sortColumn = null;
    sortDirection = 'asc';

    // 重新載入訂房記錄並套用預設條件
    loadBookings();
}

// 切換日曆月份
function changeCalendarMonth(direction) {
    if (!calendarStartDate) {
        calendarStartDate = new Date();
    }
    // 切換到上一個或下一個月
    calendarStartDate.setMonth(calendarStartDate.getMonth() + direction);
    // 確保回到該月的第一天，以便計算顯示範圍
    calendarStartDate.setDate(1);
    loadBookingCalendar();
}

// 載入訂房日曆 (月檢視)
async function loadBookingCalendar() {
    try {
        const container = document.getElementById('bookingCalendarContainer');
        if (!container) return;
        
        container.innerHTML = '<div class="loading">載入日曆中...</div>';
        
        // 取得當前顯示月份的第一天
        if (!calendarStartDate) {
            calendarStartDate = new Date();
            calendarStartDate.setDate(1);
        }
        
        const year = calendarStartDate.getFullYear();
        const month = calendarStartDate.getMonth();
        
        // 更新月份標題
        const monthTitle = document.getElementById('calendarMonthTitle');
        if (monthTitle) {
            monthTitle.textContent = `${year}年${month + 1}月`;
        }
        
        // 計算當月範圍，為了顯示完整週次，我們需要從當月 1 號所在週的週日開始
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        
        // 找到當月 1 號是星期幾 (0=日, 1=一, ...)
        const firstDayWeekday = firstDayOfMonth.getDay();
        
        // 日曆開始日期為 1 號之前的週日
        const startDate = new Date(firstDayOfMonth);
        startDate.setDate(startDate.getDate() - firstDayWeekday);
        
        // 日曆結束日期為下個月開始補滿最後一週
        const endDate = new Date(lastDayOfMonth);
        const lastDayWeekday = lastDayOfMonth.getDay();
        endDate.setDate(endDate.getDate() + (6 - lastDayWeekday));
        
        const formatDateStr = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        
        const startDateStr = formatDateStr(startDate);
        const endDateStr = formatDateStr(endDate);
        
        // 獲取房型資料 (渲染時需要顯示房型名稱)
        const roomTypesResponse = await fetch('/api/room-types');
        const roomTypesResult = await roomTypesResponse.json();
        const roomTypes = roomTypesResult.success ? roomTypesResult.data : [];
        
        // 獲取訂房資料
        const calendarUrl = `${window.location.origin}/api/bookings?startDate=${encodeURIComponent(startDateStr)}&endDate=${encodeURIComponent(endDateStr)}`;
        const bookingsResponse = await fetch(calendarUrl);
        if (!bookingsResponse.ok) {
            throw new Error(`HTTP ${bookingsResponse.status}: ${bookingsResponse.statusText}`);
        }
        const bookingsResult = await bookingsResponse.json();
        if (!bookingsResult.success) {
            throw new Error(bookingsResult.message || '獲取訂房資料失敗');
        }
        const bookings = bookingsResult.data || [];
        
        // 渲染月曆
        renderMonthlyCalendar(bookings, startDate, endDate, month);
    } catch (error) {
        console.error('載入訂房日曆錯誤:', error);
        showError('載入訂房日曆時發生錯誤：' + error.message);
        const container = document.getElementById('bookingCalendarContainer');
        if (container) {
            container.innerHTML = '<div class="loading">載入失敗</div>';
        }
    }
}

// 渲染月曆
function renderMonthlyCalendar(bookings, startDate, endDate, currentMonth) {
    const container = document.getElementById('bookingCalendarContainer');
    if (!container) return;
    
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    
    // 按日期組織訂房資料
    const bookingsByDate = {};
    bookings.forEach(booking => {
        try {
            const checkIn = new Date(booking.check_in_date + 'T00:00:00');
            const checkOut = new Date(booking.check_out_date + 'T00:00:00');
            
            for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!bookingsByDate[dateKey]) {
                    bookingsByDate[dateKey] = [];
                }
                bookingsByDate[dateKey].push(booking);
            }
        } catch (e) {
            console.warn('處理訂房日期錯誤:', booking, e);
        }
    });
    
    let html = '<div class="calendar-table-wrapper"><table class="calendar-table month-view">';
    
    // 表頭：星期
    html += '<thead><tr>';
    weekdays.forEach(day => {
        html += `<th class="date-header" style="width: 14.28%;">${day}</th>`;
    });
    html += '</tr></thead>';
    
    // 表格內容
    html += '<tbody>';
    
    let currDate = new Date(startDate);
    while (currDate <= endDate) {
        if (currDate.getDay() === 0) {
            html += '<tr>';
        }
        
        const dateKey = `${currDate.getFullYear()}-${String(currDate.getMonth() + 1).padStart(2, '0')}-${String(currDate.getDate()).padStart(2, '0')}`;
        const dayBookings = bookingsByDate[dateKey] || [];
        const isCurrentMonth = currDate.getMonth() === currentMonth;
        
        html += `<td class="booking-cell ${isCurrentMonth ? '' : 'other-month'}" data-date="${dateKey}" style="height: 120px; vertical-align: top; padding: 5px;">
            <div class="calendar-day-num" style="text-align: right; font-size: 14px; color: ${isCurrentMonth ? '#333' : '#ccc'}; margin-bottom: 5px;">${currDate.getDate()}</div>
            <div class="calendar-bookings-list" style="display: flex; flex-direction: column; gap: 2px;">`;
        
        dayBookings.forEach(booking => {
            const statusClass = booking.status === 'active' ? 'status-active' : 
                              booking.status === 'reserved' ? 'status-reserved' : 
                              'status-cancelled';
            
            // 在卡片中顯示房型 + 客戶名
            html += `<div class="calendar-booking-item ${statusClass}" onclick="event.stopPropagation(); viewBookingDetail('${escapeHtml(booking.booking_id)}')" title="${escapeHtml(booking.room_type)}: ${escapeHtml(booking.guest_name)}" style="padding: 2px 4px; font-size: 11px; margin-bottom: 1px;">
                <div class="calendar-booking-room" style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(booking.room_type)}</div>
                <div class="calendar-booking-name" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(booking.guest_name || '未知')}</div>
            </div>`;
        });
        
        html += `</div></td>`;
        
        if (currDate.getDay() === 6) {
            html += '</tr>';
        }
        currDate.setDate(currDate.getDate() + 1);
    }
    
    html += '</tbody></table></div>';
    container.innerHTML = html;
    
    // 綁定點擊事件 (快速新增訂房)
    container.querySelectorAll('.booking-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const dateStr = cell.getAttribute('data-date');
            if (dateStr) {
                // 月曆模式下點擊空白處，預設不指定房型，由 handleCalendarCellClick 處理
                handleCalendarCellClick(cell, '', dateStr);
            }
        });
    });
}

// 載入客戶列表
let allCustomers = [];
let filteredCustomers = [];

async function loadCustomers() {
    try {
        const response = await adminFetch('/api/customers');
        
        // 處理 401 未授權錯誤
        if (response.status === 401) {
            console.warn('客戶列表 API 返回 401，Session 可能已過期，重新檢查登入狀態');
            await checkAuthStatus();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            allCustomers = result.data || [];
            filteredCustomers = [...allCustomers];
            renderCustomers();
        } else {
            showError('載入客戶列表失敗：' + (result.message || '未知錯誤'));
            document.getElementById('customersTableBody').innerHTML = '<tr><td colspan="7" class="loading">載入失敗</td></tr>';
        }
    } catch (error) {
        console.error('載入客戶列表錯誤:', error);
        showError('載入客戶列表時發生錯誤：' + error.message);
        document.getElementById('customersTableBody').innerHTML = '<tr><td colspan="7" class="loading">載入失敗</td></tr>';
    }
}

// 渲染客戶列表
function renderCustomers() {
    const tbody = document.getElementById('customersTableBody');
    
    if (filteredCustomers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">沒有找到客戶資料</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredCustomers.map(customer => `
        <tr>
            <td style="text-align: left;">${escapeHtml(customer.guest_name || '-')}</td>
            <td style="text-align: left;">${escapeHtml(customer.guest_phone || '-')}</td>
            <td style="text-align: left;">${escapeHtml(customer.guest_email || '-')}</td>
            <td style="text-align: center;">
                <span class="member-badge" style="display: inline-block; padding: 4px 12px; background: #667eea; color: white; border-radius: 12px; font-size: 13px; font-weight: 500;">
                    ${escapeHtml(customer.member_level || '新會員')}
                </span>
            </td>
            <td style="text-align: center;">${customer.booking_count || 0}</td>
            <td style="text-align: right;">NT$ ${(customer.total_spent || 0).toLocaleString()}</td>
            <td style="text-align: left;">${customer.last_booking_date || '-'}</td>
            <td style="text-align: center;">
                <div class="action-buttons">
                    ${hasPermission('customers.view') ? `<button class="btn-view" onclick="viewCustomerDetails('${escapeHtml(customer.guest_email)}')">查看</button>` : ''}
                    ${hasPermission('customers.edit') ? `<button class="btn-edit" onclick="editCustomer('${escapeHtml(customer.guest_email)}', '${escapeHtml(customer.guest_name || '')}', '${escapeHtml(customer.guest_phone || '')}')">修改</button>` : ''}
                    ${hasPermission('customers.delete') ? `<button class="btn-delete" onclick="deleteCustomer('${escapeHtml(customer.guest_email)}', ${customer.booking_count || 0})">刪除</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

// 切換客戶管理分頁
function switchCustomerTab(tab) {
    // 保存當前分頁到 localStorage
    localStorage.setItem('customerTab', tab);
    
    // 更新分頁按鈕狀態
    document.querySelectorAll('#customers-section .tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 顯示/隱藏對應的內容
    if (tab === 'customers') {
        document.getElementById('customersTab').classList.add('active');
        document.getElementById('customersTabContent').style.display = 'block';
        document.getElementById('memberLevelsTabContent').style.display = 'none';
        
        // 顯示/隱藏對應的按鈕
        document.getElementById('customerRefreshBtn').style.display = 'inline-flex';
        document.getElementById('memberLevelRefreshBtn').style.display = 'none';
        
        // 載入客戶列表
        loadCustomers();
    } else if (tab === 'member-levels') {
        document.getElementById('memberLevelsTab').classList.add('active');
        document.getElementById('customersTabContent').style.display = 'none';
        document.getElementById('memberLevelsTabContent').style.display = 'block';
        
        // 顯示/隱藏對應的按鈕
        document.getElementById('customerRefreshBtn').style.display = 'none';
        document.getElementById('memberLevelRefreshBtn').style.display = 'inline-flex';
        
        // 載入等級列表
        loadMemberLevels();
    }
}

// 開啟修改客戶資料模態框
function editCustomer(email, name, phone) {
    document.getElementById('editCustomerEmail').value = email;
    document.getElementById('editCustomerName').value = name || '';
    document.getElementById('editCustomerPhone').value = phone || '';
    document.getElementById('customerEditModal').style.display = 'block';
}

// 關閉修改客戶資料模態框
function closeCustomerEditModal() {
    document.getElementById('customerEditModal').style.display = 'none';
    document.getElementById('customerEditForm').reset();
}

// 儲存客戶資料修改
async function saveCustomerEdit(event) {
    event.preventDefault();
    
    const email = document.getElementById('editCustomerEmail').value;
    const guest_name = document.getElementById('editCustomerName').value.trim();
    const guest_phone = document.getElementById('editCustomerPhone').value.trim();
    
    if (!guest_name || !guest_phone) {
        showError('請填寫完整的客戶資料');
        return;
    }
    
    try {
        const response = await adminFetch(`/api/customers/${encodeURIComponent(email)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                guest_name,
                guest_phone
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('客戶資料已更新');
            closeCustomerEditModal();
            loadCustomers(); // 重新載入客戶列表
        } else {
            showError('更新失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('更新客戶資料錯誤:', error);
        showError('更新時發生錯誤：' + error.message);
    }
}

// 刪除客戶
async function deleteCustomer(email, bookingCount) {
    if (bookingCount > 0) {
        showError('該客戶有訂房記錄，無法刪除');
        return;
    }
    
    if (!confirm(`確定要刪除客戶 ${email} 嗎？此操作無法復原。`)) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/customers/${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('客戶已刪除');
            loadCustomers(); // 重新載入客戶列表
        } else {
            showError('刪除失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('刪除客戶錯誤:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// ==================== 會員等級管理 ====================

// 載入會員等級列表
async function loadMemberLevels() {
    try {
        const response = await adminFetch('/api/member-levels');
        
        if (response.status === 401) {
            console.warn('會員等級 API 返回 401，Session 可能已過期');
            await checkAuthStatus();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            renderMemberLevels(result.data || []);
        } else {
            showError('載入會員等級列表失敗：' + (result.message || '未知錯誤'));
            document.getElementById('memberLevelsTableBody').innerHTML = '<tr><td colspan="7" class="loading">載入失敗</td></tr>';
        }
    } catch (error) {
        console.error('載入會員等級列表錯誤:', error);
        showError('載入會員等級列表時發生錯誤：' + error.message);
        document.getElementById('memberLevelsTableBody').innerHTML = '<tr><td colspan="7" class="loading">載入失敗</td></tr>';
    }
}

// 渲染會員等級列表
function renderMemberLevels(levels) {
    const tbody = document.getElementById('memberLevelsTableBody');
    
    if (levels.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">沒有會員等級資料</td></tr>';
        return;
    }
    
    // 按 display_order 排序
    const sortedLevels = [...levels].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    
    tbody.innerHTML = sortedLevels.map(level => `
        <tr>
            <td style="text-align: center;">${level.display_order || 0}</td>
            <td style="text-align: left;">
                <strong>${escapeHtml(level.level_name)}</strong>
            </td>
            <td style="text-align: right;">NT$ ${(level.min_spent || 0).toLocaleString()}</td>
            <td style="text-align: center;">${level.min_bookings || 0} 次</td>
            <td style="text-align: center;">
                ${level.discount_percent > 0 ? `<span style="color: #10b981; font-weight: 600;">${level.discount_percent}%</span>` : '<span style="color: #999;">無折扣</span>'}
            </td>
            <td style="text-align: center;">
                <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; ${level.is_active ? 'background: #d1fae5; color: #059669;' : 'background: #fee2e2; color: #dc2626;'}">
                    ${level.is_active ? '啟用' : '停用'}
                </span>
            </td>
            <td style="text-align: center;">
                <div class="action-buttons">
                    ${hasPermission('customers.edit') ? `<button class="btn-edit" onclick="editMemberLevel(${level.id})">編輯</button>` : ''}
                    ${hasPermission('customers.delete') ? `<button class="btn-delete" onclick="deleteMemberLevel(${level.id}, '${escapeHtml(level.level_name)}')">刪除</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

// 顯示新增會員等級模態框
function showAddMemberLevelModal() {
    document.getElementById('memberLevelModalTitle').textContent = '新增會員等級';
    document.getElementById('memberLevelId').value = '';
    document.getElementById('memberLevelForm').reset();
    document.getElementById('memberLevelIsActive').checked = true;
    document.getElementById('memberLevelDisplayOrder').value = '';
    document.getElementById('memberLevelModal').style.display = 'block';
}

// 編輯會員等級
async function editMemberLevel(id) {
    try {
        const response = await adminFetch(`/api/member-levels/${id}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const level = result.data;
            document.getElementById('memberLevelModalTitle').textContent = '編輯會員等級';
            document.getElementById('memberLevelId').value = level.id;
            document.getElementById('memberLevelName').value = level.level_name;
            document.getElementById('memberLevelMinSpent').value = level.min_spent || 0;
            document.getElementById('memberLevelMinBookings').value = level.min_bookings || 0;
            document.getElementById('memberLevelDiscount').value = level.discount_percent || 0;
            document.getElementById('memberLevelDisplayOrder').value = level.display_order || 0;
            document.getElementById('memberLevelIsActive').checked = level.is_active !== undefined ? level.is_active : 1;
            document.getElementById('memberLevelModal').style.display = 'block';
        } else {
            showError('載入會員等級失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入會員等級錯誤:', error);
        showError('載入會員等級時發生錯誤：' + error.message);
    }
}

// 儲存會員等級
async function saveMemberLevel(event) {
    event.preventDefault();
    
    const id = document.getElementById('memberLevelId').value;
    const level_name = document.getElementById('memberLevelName').value.trim();
    const min_spent = parseInt(document.getElementById('memberLevelMinSpent').value || 0);
    const min_bookings = parseInt(document.getElementById('memberLevelMinBookings').value || 0);
    const discount_percent = parseFloat(document.getElementById('memberLevelDiscount').value || 0);
    const display_order = parseInt(document.getElementById('memberLevelDisplayOrder').value || 0);
    const is_active = document.getElementById('memberLevelIsActive').checked ? 1 : 0;
    
    if (!level_name) {
        showError('請填寫等級名稱');
        return;
    }
    
    try {
        const url = id ? `/api/member-levels/${id}` : '/api/member-levels';
        const method = id ? 'PUT' : 'POST';
        
        const response = await adminFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                level_name,
                min_spent,
                min_bookings,
                discount_percent,
                display_order,
                is_active
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(id ? '會員等級已更新' : '會員等級已新增');
            closeMemberLevelModal();
            loadMemberLevels(); // 重新載入等級列表
        } else {
            showError((id ? '更新' : '新增') + '失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('儲存會員等級錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 刪除會員等級
async function deleteMemberLevel(id, levelName) {
    if (!confirm(`確定要刪除等級「${levelName}」嗎？此操作無法復原。`)) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/member-levels/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('會員等級已刪除');
            loadMemberLevels(); // 重新載入等級列表
        } else {
            showError('刪除失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('刪除會員等級錯誤:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// 關閉會員等級模態框
function closeMemberLevelModal() {
    document.getElementById('memberLevelModal').style.display = 'none';
    document.getElementById('memberLevelForm').reset();
    document.getElementById('memberLevelId').value = '';
}

// 篩選客戶
function filterCustomers() {
    const searchTerm = document.getElementById('customerSearchInput').value.toLowerCase().trim();
    
    if (!searchTerm) {
        filteredCustomers = [...allCustomers];
    } else {
        filteredCustomers = allCustomers.filter(customer => {
            return (
                customer.guest_name.toLowerCase().includes(searchTerm) ||
                customer.guest_phone.includes(searchTerm) ||
                customer.guest_email.toLowerCase().includes(searchTerm)
            );
        });
    }
    
    renderCustomers();
}

// 查看客戶詳情
async function viewCustomerDetails(email) {
    try {
        const response = await fetch(`/api/customers/${encodeURIComponent(email)}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const customer = result.data;
            const modal = document.getElementById('bookingModal');
            const modalBody = document.getElementById('modalBody');
            
            // 顯示客戶詳情
            modalBody.innerHTML = `
                <div style="padding: 15px;">
                    <h3 style="margin-bottom: 15px; color: #333; font-size: 20px;">客戶詳情</h3>
                    <div style="background: #f8f9fa; padding: 12px; border-radius: 8px; margin-bottom: 15px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 14px;">
                        <div>
                            <strong>客戶姓名：</strong>${escapeHtml(customer.guest_name)}
                        </div>
                        <div>
                            <strong>電話：</strong>${escapeHtml(customer.guest_phone)}
                        </div>
                        <div>
                            <strong>Email：</strong>${escapeHtml(customer.guest_email)}
                        </div>
                        <div>
                            <strong>訂房次數：</strong>${customer.booking_count || 0} 次
                        </div>
                        <div>
                            <strong>總消費金額：</strong>NT$ ${(customer.total_spent || 0).toLocaleString()}
                        </div>
                        <div>
                            <strong>最後訂房日期：</strong>${customer.last_booking_date || '-'}
                        </div>
                    </div>
                    
                    <h4 style="margin: 15px 0 10px 0; color: #333; font-size: 18px;">訂房記錄</h4>
                    <div style="overflow: visible;">
                        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th style="padding: 10px 6px; text-align: left; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; font-weight: 600; white-space: nowrap;">訂房編號</th>
                                    <th style="padding: 10px 6px; text-align: left; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; font-weight: 600; white-space: nowrap;">入住日期</th>
                                    <th style="padding: 10px 6px; text-align: left; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; font-weight: 600; white-space: nowrap;">退房日期</th>
                                    <th style="padding: 10px 6px; text-align: left; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; font-weight: 600; white-space: nowrap;">房型</th>
                                    <th style="padding: 10px 6px; text-align: right; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; font-weight: 600; white-space: nowrap;">金額</th>
                                    <th style="padding: 10px 6px; text-align: center; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; font-weight: 600; white-space: nowrap;">狀態</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${customer.bookings && customer.bookings.length > 0 
                                    ? customer.bookings.map(booking => `
                                        <tr style="border-bottom: 1px solid #f0f0f0;">
                                            <td style="padding: 10px 6px;">${escapeHtml(booking.booking_id)}</td>
                                            <td style="padding: 10px 6px;">${escapeHtml(booking.check_in_date)}</td>
                                            <td style="padding: 10px 6px;">${escapeHtml(booking.check_out_date)}</td>
                                            <td style="padding: 10px 6px;">${escapeHtml(booking.room_type)}</td>
                                            <td style="padding: 10px 6px; text-align: right;">NT$ ${(parseInt(booking.total_amount) || 0).toLocaleString()}</td>
                                            <td style="padding: 10px 6px; text-align: center;">
                                                <span class="status-badge status-${booking.status === 'active' ? 'sent' : booking.status === 'cancelled' ? 'unsent' : 'pending'}">
                                                    ${booking.status === 'active' ? '有效' : booking.status === 'cancelled' ? '已取消' : booking.status === 'reserved' ? '保留' : booking.status}
                                                </span>
                                            </td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="6" style="text-align: center; padding: 20px;">沒有訂房記錄</td></tr>'
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            
            modal.classList.add('active');
        } else {
            showError('載入客戶詳情失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入客戶詳情錯誤:', error);
        showError('載入客戶詳情時發生錯誤：' + error.message);
    }
}

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
        
        // 判斷是否已過入住日期（一般管理員不可取消已付款且已入住的訂房）
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkInDate = new Date(booking.check_in_date);
        checkInDate.setHours(0, 0, 0, 0);
        const isPastCheckIn = checkInDate < today;
        
        // 一般管理員不可取消：已付款 + 有效 + 已過入住日期
        const isSuperAdmin = window.currentAdminInfo && window.currentAdminInfo.role === 'super_admin';
        const cannotCancel = !isSuperAdmin && paymentStatus === 'paid' && bookingStatus === 'active' && isPastCheckIn;
        
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
                    ${hasPermission('bookings.view') ? `<button class="btn-view" onclick="viewBookingDetail('${booking.booking_id}')">查看</button>` : ''}
                    ${!isCancelled ? `
                        ${hasPermission('bookings.edit') ? `<button class="btn-edit" onclick="editBooking('${booking.booking_id}')">編輯</button>` : ''}
                        ${hasPermission('bookings.cancel') && !cannotCancel ? `<button class="btn-cancel" onclick="cancelBooking('${booking.booking_id}')">取消</button>` : ''}
                    ` : `
                        ${hasPermission('bookings.delete') ? `<button class="btn-delete" onclick="deleteBooking('${booking.booking_id}')">刪除</button>` : ''}
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

// 處理日曆格子點擊：有訂房 → 看詳情（保持原行為）；空白 → 快速新增訂房
function handleCalendarCellClick(cellElement, roomTypeName, dateStr) {
    // 如果此格子裡已經有訂房區塊，就不額外開快速新增（點訂房區塊本身會觸發詳情）
    const bookingItem = cellElement.querySelector('.calendar-booking-item');
    if (bookingItem) {
        return;
    }
    openQuickBookingModal(roomTypeName, dateStr);
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
            <span class="detail-value">NT$ ${(booking.original_amount || booking.total_amount).toLocaleString()}</span>
        </div>
        ${booking.promo_code ? `
        <div class="detail-row">
            <span class="detail-label">優惠代碼</span>
            <span class="detail-value">${escapeHtml(booking.promo_code)} - ${escapeHtml(booking.promo_code_name || '')}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">優惠折扣</span>
            <span class="detail-value" style="color: #10b981; font-weight: 600;">-NT$ ${(booking.discount_amount || 0).toLocaleString()}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">折後總額</span>
            <span class="detail-value" style="font-weight: 600;">NT$ ${((booking.original_amount || booking.total_amount) - (booking.discount_amount || 0)).toLocaleString()}</span>
        </div>
        ` : ''}
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

// 顯示「快速新增訂房」表單
async function openQuickBookingModal(roomTypeName, dateStr) {
    const modal = document.getElementById('bookingModal');
    const modalBody = document.getElementById('modalBody');
    
    // 預設入住日期 = 被點擊那天，退房日期 = 隔天
    const checkInDate = dateStr;
    const checkOutDateObj = new Date(dateStr + 'T00:00:00');
    checkOutDateObj.setDate(checkOutDateObj.getDate() + 1);
    const checkOutDate = `${checkOutDateObj.getFullYear()}-${String(checkOutDateObj.getMonth() + 1).padStart(2, '0')}-${String(checkOutDateObj.getDate()).padStart(2, '0')}`;
    
    // 如果沒有傳入房型名稱，則獲取房型列表供選擇
    let roomTypeHtml = '';
    if (!roomTypeName) {
        try {
            const response = await fetch('/api/room-types');
            const result = await response.json();
            const roomTypes = result.success ? result.data : [];
            roomTypeHtml = `
                <select name="room_type" required>
                    <option value="">請選擇房型</option>
                    ${roomTypes.map(rt => `<option value="${rt.display_name}">${rt.display_name}</option>`).join('')}
                </select>
            `;
        } catch (e) {
            console.error('獲取房型失敗:', e);
            roomTypeHtml = `<input type="text" name="room_type" placeholder="請手動輸入房型" required>`;
        }
    } else {
        roomTypeHtml = `<input type="text" name="room_type" value="${escapeHtml(roomTypeName)}" readonly>`;
    }
    
    modalBody.innerHTML = `
        <form id="quickBookingForm" onsubmit="saveQuickBooking(event)">
            <h3 style="margin-bottom: 15px;">快速新增訂房</h3>
            <div class="form-group">
                <label>房型</label>
                ${roomTypeHtml}
            </div>
            <div class="form-group">
                <label>入住日期</label>
                <input type="date" name="check_in_date" value="${checkInDate}" required>
            </div>
            <div class="form-group">
                <label>退房日期</label>
                <input type="date" name="check_out_date" value="${checkOutDate}" required>
            </div>
            <div class="form-group">
                <label>客戶姓名</label>
                <input type="text" name="guest_name" placeholder="請輸入客戶姓名" required>
            </div>
            <div class="form-group">
                <label>聯絡電話</label>
                <input type="tel" name="guest_phone" placeholder="選填">
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" name="guest_email" placeholder="選填">
            </div>
            <div class="form-group">
                <label>大人人數</label>
                <input type="number" name="adults" value="2" min="0" step="1">
            </div>
            <div class="form-group">
                <label>孩童人數</label>
                <input type="number" name="children" value="0" min="0" step="1">
            </div>
            <div class="form-group">
                <label>訂房狀態</label>
                <select name="status">
                    <option value="active">有效（標滿房）</option>
                    <option value="reserved">保留</option>
                </select>
            </div>
            <div class="form-group">
                <label>付款狀態</label>
                <select name="payment_status">
                    <option value="paid">已付款</option>
                    <option value="pending">未付款</option>
                </select>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn-primary">儲存</button>
                <button type="button" class="btn-cancel" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    
    modal.classList.add('active');
}

// 儲存快速新增的訂房
async function saveQuickBooking(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    
    const checkInDate = formData.get('check_in_date');
    const checkOutDate = formData.get('check_out_date');
    
    if (!checkInDate || !checkOutDate) {
        showError('請選擇入住與退房日期');
        return;
    }
    
    const payload = {
        roomType: formData.get('room_type'),
        checkInDate,
        checkOutDate,
        guestName: formData.get('guest_name'),
        guestPhone: formData.get('guest_phone') || '',
        guestEmail: formData.get('guest_email') || '',
        adults: parseInt(formData.get('adults') || '0', 10),
        children: parseInt(formData.get('children') || '0', 10),
        status: formData.get('status') || 'active',
        paymentStatus: formData.get('payment_status') || 'paid'
    };
    
    try {
        const response = await adminFetch('/api/admin/bookings/quick', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || `HTTP ${response.status}`);
        }
        
        showSuccess('訂房已建立');
        closeModal();
        // 重新載入目前視圖（週日曆＋列表一起更新）
        await loadBookingCalendar();
        await loadBookings();
    } catch (error) {
        console.error('快速新增訂房錯誤:', error);
        showError('快速新增訂房時發生錯誤：' + error.message);
    }
}

// 關閉模態框
function closeModal() {
    document.getElementById('bookingModal').classList.remove('active');
}

// 依目前日期篩選載入統計資料
async function loadStatistics() {
    try {
        // 讀取日期區間（如果兩個都有填才套用）
        const startInput = document.getElementById('statsStartDate');
        const endInput = document.getElementById('statsEndDate');
        const startDate = startInput?.value;
        const endDate = endInput?.value;

        if ((startDate && !endDate) || (!startDate && endDate)) {
            showError('請同時選擇開始與結束日期');
            return;
        }

        if (startDate && endDate && startDate > endDate) {
            showError('統計期間的開始日期不能晚於結束日期');
            return;
        }

        let url = '/api/statistics';
        if (startDate && endDate) {
            const params = new URLSearchParams({
                startDate,
                endDate
            });
            url += `?${params.toString()}`;
        }

        const response = await adminFetch(url);
        
        // 檢查 HTTP 狀態碼
        if (response.status === 401) {
            // 未登入，顯示登入頁面
            console.warn('統計資料 API 返回 401，Session 可能已過期，重新檢查登入狀態');
            await checkAuthStatus();
            return;
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('統計資料 API 錯誤:', response.status, errorText);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('統計資料 API 回應:', result);
        
        if (result.success) {
            const stats = result.data;
            
            // 總訂房數（細分：已入住/未入住）
            document.getElementById('totalBookings').textContent = stats.totalBookings || 0;
            const checkedIn = stats.totalBookingsDetail?.checkedIn || 0;
            const notCheckedIn = stats.totalBookingsDetail?.notCheckedIn || 0;
            document.getElementById('totalBookingsDetail').textContent = `已入住: ${checkedIn} / 未入住: ${notCheckedIn}`;
            
            // 總營收（細分：已付款/未付款）
            document.getElementById('totalRevenue').textContent = `NT$ ${(stats.totalRevenue || 0).toLocaleString()}`;
            const revenuePaid = stats.totalRevenueDetail?.paid || 0;
            const revenueUnpaid = stats.totalRevenueDetail?.unpaid || 0;
            document.getElementById('totalRevenueDetail').textContent = `已付款: NT$ ${revenuePaid.toLocaleString()} / 未付款: NT$ ${revenueUnpaid.toLocaleString()}`;
            
            // 匯款轉帳（細分：已付款/未付款）
            const transferCount = stats.transferBookings?.count || 0;
            const transferTotal = stats.transferBookings?.total || 0;
            const transferLabel = document.getElementById('transferBookingsLabel');
            if (transferLabel) {
                transferLabel.textContent = '匯款轉帳';
            }
            document.getElementById('transferBookings').textContent = `NT$ ${transferTotal.toLocaleString()}`;
            const transferPaidCount = stats.transferBookings?.paid?.count || 0;
            const transferPaidTotal = stats.transferBookings?.paid?.total || 0;
            const transferUnpaidCount = stats.transferBookings?.unpaid?.count || 0;
            const transferUnpaidTotal = stats.transferBookings?.unpaid?.total || 0;
            document.getElementById('transferBookingsDetail').textContent = `已付款: ${transferPaidCount} 筆 / NT$ ${transferPaidTotal.toLocaleString()} | 未付款: ${transferUnpaidCount} 筆 / NT$ ${transferUnpaidTotal.toLocaleString()}`;
            
            // 線上刷卡（細分：已付款/未付款）
            const cardCount = stats.cardBookings?.count || 0;
            const cardTotal = stats.cardBookings?.total || 0;
            document.getElementById('cardBookings').textContent = `NT$ ${cardTotal.toLocaleString()}`;
            const cardPaidCount = stats.cardBookings?.paid?.count || 0;
            const cardPaidTotal = stats.cardBookings?.paid?.total || 0;
            const cardUnpaidCount = stats.cardBookings?.unpaid?.count || 0;
            const cardUnpaidTotal = stats.cardBookings?.unpaid?.total || 0;
            document.getElementById('cardBookingsDetail').textContent = `已付款: ${cardPaidCount} 筆 / NT$ ${cardPaidTotal.toLocaleString()} | 未付款: ${cardUnpaidCount} 筆 / NT$ ${cardUnpaidTotal.toLocaleString()}`;
            
            // 渲染房型統計
            renderRoomStats(stats.byRoomType || []);
            
            // 載入月度統計資料
            loadMonthlyStats();
        } else {
            console.error('統計資料 API 返回失敗:', result);
            showError(result.message || '載入統計資料失敗');
        }
    } catch (error) {
        console.error('載入統計資料錯誤:', error);
        showError('載入統計資料時發生錯誤: ' + (error.message || '未知錯誤'));
    }
}

// 載入上月與本月的統計資料
async function loadMonthlyStats() {
    try {
        const response = await adminFetch('/api/statistics/monthly-stats');
        
        if (response.status === 401) {
            console.warn('月度統計 API 返回 401，Session 可能已過期');
            await checkAuthStatus();
            return;
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('月度統計 API 錯誤:', response.status, errorText);
            document.getElementById('monthlyStatsGrid').innerHTML = '<div class="error">載入月度統計資料失敗</div>';
            return;
        }
        
        const result = await response.json();
        
        if (result.success) {
            const stats = result.data;
            renderMonthlyStats(stats);
        } else {
            console.error('月度統計 API 返回失敗:', result);
            document.getElementById('monthlyStatsGrid').innerHTML = '<div class="error">載入月度統計資料失敗</div>';
        }
    } catch (error) {
        console.error('載入月度統計資料錯誤:', error);
        document.getElementById('monthlyStatsGrid').innerHTML = '<div class="error">載入月度統計資料時發生錯誤</div>';
    }
}

// 渲染月度統計資料
function renderMonthlyStats(stats) {
    const grid = document.getElementById('monthlyStatsGrid');
    if (!grid) return;
    
    const thisMonth = stats.thisMonth || {};
    const lastMonth = stats.lastMonth || {};
    
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const lastMonthNum = currentMonth === 1 ? 12 : currentMonth - 1;
    const monthNames = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    
    grid.innerHTML = `
        <div class="month-stat-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h4 style="margin-top: 0; margin-bottom: 15px; color: #333; font-size: 18px;">本月（${monthNames[currentMonth]}）</h4>
            <div class="stat-item" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">訂房數：</span>
                    <span style="font-weight: bold; font-size: 16px;">${thisMonth.bookingCount || 0}</span>
                </div>
            </div>
            <div class="stat-item" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">總營收：</span>
                    <span style="font-weight: bold; font-size: 16px; color: #2196F3;">NT$ ${(thisMonth.totalRevenue || 0).toLocaleString()}</span>
                </div>
            </div>
            <div class="stat-item" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">平日住房率：</span>
                    <span style="font-weight: bold; font-size: 16px;">${(thisMonth.weekdayOccupancy || 0).toFixed(2)}%</span>
                </div>
            </div>
            <div class="stat-item">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">假日住房率：</span>
                    <span style="font-weight: bold; font-size: 16px;">${(thisMonth.weekendOccupancy || 0).toFixed(2)}%</span>
                </div>
            </div>
        </div>
        <div class="month-stat-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h4 style="margin-top: 0; margin-bottom: 15px; color: #333; font-size: 18px;">上月（${monthNames[lastMonthNum]}）</h4>
            <div class="stat-item" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">訂房數：</span>
                    <span style="font-weight: bold; font-size: 16px;">${lastMonth.bookingCount || 0}</span>
                </div>
            </div>
            <div class="stat-item" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">總營收：</span>
                    <span style="font-weight: bold; font-size: 16px; color: #2196F3;">NT$ ${(lastMonth.totalRevenue || 0).toLocaleString()}</span>
                </div>
            </div>
            <div class="stat-item" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">平日住房率：</span>
                    <span style="font-weight: bold; font-size: 16px;">${(lastMonth.weekdayOccupancy || 0).toFixed(2)}%</span>
                </div>
            </div>
            <div class="stat-item">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #666;">假日住房率：</span>
                    <span style="font-weight: bold; font-size: 16px;">${(lastMonth.weekendOccupancy || 0).toFixed(2)}%</span>
                </div>
            </div>
        </div>
    `;
}

// 套用統計日期篩選
function applyStatisticsFilter() {
    loadStatistics();
}

// 重設統計日期篩選（回到全部期間）
function resetStatisticsFilter() {
    const startInput = document.getElementById('statsStartDate');
    const endInput = document.getElementById('statsEndDate');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    loadStatistics();
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
        'payment_received': { name: '收款信', class: 'status-email-received' },
        'cancel_notification': { name: '取消信', class: 'status-email-cancel' },
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
        // 先檢查是否已登入，避免未登入時發送請求導致 401 錯誤
        const authCheckResponse = await fetch('/api/admin/check-auth', {
            credentials: 'include'
        });
        
        if (!authCheckResponse.ok) {
            // 未登入，不載入房型價格（這是正常的，因為用戶還沒登入）
            // 靜默處理，不顯示錯誤訊息
            return;
        }
        
        const authResult = await authCheckResponse.json().catch(() => ({}));
        if (!authResult.success) {
            // 認證失敗，靜默返回
            return;
        }
        
        const [roomTypesResponse, settingsResponse] = await Promise.all([
            adminFetch('/api/admin/room-types').catch(err => {
                // 如果請求失敗（可能是 401），返回一個模擬的 response
                if (err.message && err.message.includes('401')) {
                    return { ok: false, status: 401, json: async () => ({ success: false }) };
                }
                throw err;
            }),
            adminFetch('/api/settings').catch(err => {
                // 如果請求失敗，返回一個模擬的 response
                return { ok: false, status: 500, json: async () => ({ success: false }) };
            })
        ]);
        
        // 檢查響應狀態
        if (!roomTypesResponse.ok) {
            if (roomTypesResponse.status === 401) {
                // 認證失敗，靜默處理（不顯示錯誤）
                return;
            }
            // 其他錯誤，只在開發環境顯示
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.warn('載入房型價格失敗:', roomTypesResponse.status);
            }
            return;
        }
        
        const roomTypesResult = await roomTypesResponse.json().catch(() => ({ success: false }));
        const settingsResult = await settingsResponse.json().catch(() => ({ success: false }));
        
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
        // 靜默處理錯誤，避免在控制台顯示不必要的錯誤訊息
        // 只有在開發環境才顯示詳細錯誤
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('載入房型價格錯誤:', error);
        }
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

// 初始化時載入（延遲執行，確保頁面完全載入後再檢查認證）
// 只在管理後台頁面載入時才執行
if (document.getElementById('adminPage')) {
    // 延遲執行，避免在登入頁面時觸發
    setTimeout(() => {
        // 檢查是否在登入頁面
        const loginPage = document.getElementById('loginPage');
        const adminPage = document.getElementById('adminPage');
        if (adminPage && window.getComputedStyle(adminPage).display !== 'none') {
            loadRoomPrices();
        }
    }, 500);
}

// 顯示編輯模態框
function showEditModal(booking) {
    const modal = document.getElementById('bookingModal');
    const modalBody = document.getElementById('modalBody');
    
    // 計算初始價格（優先使用資料庫中儲存的實際每晚價格）
    const pricePerNight = booking.price_per_night || roomPrices[booking.room_type] || 2000;
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    const calculatedTotalAmount = pricePerNight * nights;
    
    // 計算折後總額（如果有優惠折扣）
    const discountAmount = booking.discount_amount || 0;
    // 優先使用 promo_code_usages 表中的 original_amount（這是訂房時的原始總金額）
    // 如果沒有，使用 booking.total_amount（資料庫中儲存的總金額，不含折扣）
    // 最後才使用重新計算的值
    const originalAmount = booking.original_amount || booking.total_amount || calculatedTotalAmount;
    const discountedTotal = Math.max(0, originalAmount - discountAmount);
    
    // 根據原始付款方式判斷是否為訂金（檢查 payment_amount 欄位）
    const paymentAmountStr = booking.payment_amount || '';
    const isDeposit = paymentAmountStr.includes('訂金') || paymentAmountStr.includes('deposit');
    
    // 計算應付金額（使用折後總額）
    // 重要：必須使用折後總額計算訂金，而不是原始總金額
    const finalAmount = isDeposit ? Math.round(discountedTotal * depositPercentage / 100) : discountedTotal;
    
    // 調試信息（可在瀏覽器控制台查看）
    console.log('編輯訂房 - 價格計算:', {
        originalAmount,
        discountAmount,
        discountedTotal,
        isDeposit,
        depositPercentage,
        finalAmount
    });
    
    // 將優惠折扣資訊存儲在表單的 data 屬性中，供 calculateEditPrice 使用
    
    modalBody.innerHTML = `
        <form id="editBookingForm" onsubmit="saveBookingEdit(event, '${booking.booking_id}')" data-discount-amount="${discountAmount}" data-original-amount="${originalAmount}" data-price-per-night="${pricePerNight}">
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
                <select name="payment_status" id="editPaymentStatus" required>
                    <option value="pending" ${(booking.payment_status || 'pending') === 'pending' ? 'selected' : ''}>待付款</option>
                    <option value="paid" ${(booking.payment_status || 'pending') === 'paid' ? 'selected' : ''}>已付款</option>
                    <option value="failed" ${(booking.payment_status || 'pending') === 'failed' ? 'selected' : ''}>付款失敗</option>
                    <option value="refunded" ${(booking.payment_status || 'pending') === 'refunded' ? 'selected' : ''}>已退款</option>
                </select>
                ${booking.payment_method === '匯款轉帳' ? '<small style="display: block; margin-top: 5px; color: #666;">💡 提示：將付款狀態改為「已付款」時，系統會自動發送收款確認信給客戶。</small>' : ''}
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
                    <strong id="editTotalAmount">NT$ ${originalAmount.toLocaleString()}</strong>
                </div>
                ${booking.promo_code ? `
                <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>優惠代碼：</span>
                    <strong style="color: #667eea;">${escapeHtml(booking.promo_code)} - ${escapeHtml(booking.promo_code_name || '')}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>優惠折扣：</span>
                    <strong style="color: #10b981;">-NT$ ${(booking.discount_amount || 0).toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin: 5px 0; padding-top: 5px; border-top: 1px solid #ddd;">
                    <span>折後總額：</span>
                    <strong style="font-weight: 600;">NT$ ${discountedTotal.toLocaleString()}</strong>
                </div>
                ` : ''}
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
    
    // 確保初始顯示的值正確（防止表單元素設置值時觸發 onchange 事件導致計算錯誤）
    // 延遲執行，確保表單完全渲染後再設置正確的值
    setTimeout(() => {
        const editFinalAmountEl = document.getElementById('editFinalAmount');
        if (editFinalAmountEl && discountAmount > 0) {
            // 重新計算並設置正確的應付金額
            const editForm = document.getElementById('editBookingForm');
            if (editForm) {
                const discountAmountStr = editForm.dataset.discountAmount || '0';
                const originalAmountStr = editForm.dataset.originalAmount || originalAmount.toString();
                const discountAmountValue = parseFloat(discountAmountStr) || 0;
                const originalAmountValue = parseFloat(originalAmountStr) || originalAmount;
                const discountedTotalValue = Math.max(0, originalAmountValue - discountAmountValue);
                const isDepositCheck = document.getElementById('editPaymentAmountType');
                const isDepositValue = isDepositCheck ? isDepositCheck.value === 'deposit' : isDeposit;
                const correctFinalAmount = isDepositValue ? Math.round(discountedTotalValue * depositPercentage / 100) : discountedTotalValue;
                
                // 設置正確的值
                editFinalAmountEl.textContent = `NT$ ${correctFinalAmount.toLocaleString()}`;
                
                console.log('修正應付金額:', {
                    discountAmountValue,
                    originalAmountValue,
                    discountedTotalValue,
                    isDepositValue,
                    correctFinalAmount,
                    '原本顯示的值': finalAmount
                });
            }
        }
    }, 200);
}

// 計算編輯表單的價格
function calculateEditPrice() {
    const roomTypeSelect = document.getElementById('editRoomType');
    const checkInDate = document.getElementById('editCheckInDate');
    const checkOutDate = document.getElementById('editCheckOutDate');
    const paymentAmountType = document.getElementById('editPaymentAmountType');
    const editForm = document.getElementById('editBookingForm');
    
    if (!roomTypeSelect || !checkInDate || !checkOutDate || !paymentAmountType || !editForm) {
        return;
    }
    
        const selectedOption = roomTypeSelect.options[roomTypeSelect.selectedIndex];
        // 優先使用選項中的價格，如果沒有則使用資料庫中儲存的價格
        const storedPricePerNight = editForm ? parseFloat(editForm.dataset.pricePerNight || 0) : 0;
        const pricePerNight = parseInt(selectedOption.dataset.price) || storedPricePerNight || 2000;
        
        const checkIn = new Date(checkInDate.value);
        const checkOut = new Date(checkOutDate.value);
        
        if (checkIn && checkOut && checkOut > checkIn) {
            const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
            const totalAmount = pricePerNight * nights;
        
        // 檢查是否有優惠折扣（從表單的 data 屬性讀取）
        const discountAmountStr = editForm ? (editForm.dataset.discountAmount || '0') : '0';
        const originalAmountStr = editForm ? (editForm.dataset.originalAmount || totalAmount.toString()) : totalAmount.toString();
        const discountAmount = parseFloat(discountAmountStr) || 0;
        const originalAmount = parseFloat(originalAmountStr) || totalAmount;
        
        // 如果有折扣，使用折後總額；否則使用當前總金額
        // 重要：必須使用 originalAmount 和 discountAmount 來計算折後總額
        // 如果 discountAmount > 0，表示有優惠代碼，使用折後總額；否則使用當前總金額
        const discountedTotal = discountAmount > 0 ? Math.max(0, originalAmount - discountAmount) : totalAmount;
        
        const isDeposit = paymentAmountType.value === 'deposit';
        // 重要：必須使用折後總額計算訂金，而不是原始總金額或當前總金額
        const finalAmount = isDeposit ? Math.round(discountedTotal * depositPercentage / 100) : discountedTotal;
        
        // 調試信息
        console.log('calculateEditPrice - 價格計算:', {
            totalAmount: totalAmount, // 重新計算的總金額
            discountAmount: discountAmount, // 從 data 屬性讀取的折扣金額
            originalAmount: originalAmount, // 從 data 屬性讀取的原始總金額
            discountedTotal: discountedTotal, // 折後總額
            isDeposit: isDeposit,
            depositPercentage: depositPercentage,
            finalAmount: finalAmount,
            'data-discount-amount': editForm ? editForm.dataset.discountAmount : 'N/A',
            'data-original-amount': editForm ? editForm.dataset.originalAmount : 'N/A'
        });
        
        // 更新顯示
        document.getElementById('editPricePerNight').textContent = `NT$ ${pricePerNight.toLocaleString()}`;
        document.getElementById('editNights').textContent = `${nights} 晚`;
        // 如果有優惠折扣，顯示原始總金額；否則顯示當前總金額
        const displayTotalAmount = discountAmount > 0 ? originalAmount : totalAmount;
        document.getElementById('editTotalAmount').textContent = `NT$ ${displayTotalAmount.toLocaleString()}`;
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
    const editForm = document.getElementById('editBookingForm');
    
    const selectedOption = roomTypeSelect.options[roomTypeSelect.selectedIndex];
    // 優先使用選項中的價格，如果沒有則使用資料庫中儲存的價格
    const storedPricePerNight = editForm ? parseFloat(editForm.dataset.pricePerNight || 0) : 0;
    const pricePerNight = parseInt(selectedOption.dataset.price) || storedPricePerNight || 2000;
    
    const checkIn = new Date(checkInDate.value);
    const checkOut = new Date(checkOutDate.value);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    const totalAmount = pricePerNight * nights;
    
    // 檢查是否有優惠折扣（從表單的 data 屬性讀取）
    const discountAmountStr = editForm ? (editForm.dataset.discountAmount || '0') : '0';
    const originalAmountStr = editForm ? (editForm.dataset.originalAmount || totalAmount.toString()) : totalAmount.toString();
    const discountAmount = parseFloat(discountAmountStr) || 0;
    const originalAmount = parseFloat(originalAmountStr) || totalAmount;
    
    // 如果有折扣，使用折後總額；否則使用當前總金額
    // 重要：必須使用 originalAmount 和 discountAmount 來計算折後總額
    const discountedTotal = discountAmount > 0 ? Math.max(0, originalAmount - discountAmount) : totalAmount;
    
    const isDeposit = paymentAmountType.value === 'deposit';
    const finalAmount = isDeposit ? Math.round(discountedTotal * depositPercentage / 100) : discountedTotal;
    
    // 設定付款金額文字
    const paymentAmount = isDeposit ? `訂金 NT$ ${finalAmount.toLocaleString()}` : `全額 NT$ ${finalAmount.toLocaleString()}`;
    
    // 加入計算出的價格資料（確保為整數類型）
    data.price_per_night = parseInt(pricePerNight);
    data.nights = parseInt(nights);
    // 如果有優惠折扣，total_amount 應該是折後總額；否則使用原始總金額
    data.total_amount = parseInt(discountAmount > 0 ? discountedTotal : totalAmount);
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

// 根據付款方式與付款狀態決定是否顯示「收款信」勾選區塊

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
        const response = await adminFetch('/api/admin/room-types');
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

// 渲染房型列表
function renderRoomTypes() {
    const tbody = document.getElementById('roomTypesTableBody');
    
    // 顯示所有房型（包括啟用和停用的）
    const filteredRoomTypes = allRoomTypes;
    
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
                    ${hasPermission('room_types.edit') ? `<button class="btn-edit" onclick="editRoomType(${room.id})">編輯</button>` : ''}
                    ${hasPermission('room_types.delete') ? `<button class="btn-cancel" onclick="deleteRoomType(${room.id})">刪除</button>` : ''}
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
        
        const response = await adminFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(id ? '房型已更新' : '房型已新增');
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
        const response = await adminFetch(`/api/admin/room-types/${id}`, {
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
            showSuccess('房型已刪除');
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
            adminFetch('/api/admin/addons'),
            adminFetch('/api/settings')
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
        const response = await adminFetch('/api/admin/settings/enable_addons', {
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

// 渲染加購商品列表
function renderAddons() {
    const tbody = document.getElementById('addonsTableBody');
    if (!tbody) return;
    
    // 顯示所有加購商品（包括啟用和停用的）
    const filteredAddons = allAddons;
    
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
                    ${hasPermission('addons.edit') ? `<button class="btn-edit" onclick="editAddon(${addon.id})">編輯</button>` : ''}
                    ${hasPermission('addons.delete') ? `<button class="btn-cancel" onclick="deleteAddon(${addon.id})">刪除</button>` : ''}
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
        
        const response = await adminFetch(url, {
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
        
        const response = await adminFetch(`/api/admin/addons/${id}`, {
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
        const response = await adminFetch(`/api/admin/addons/${id}`, {
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

// 修改管理員密碼
async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // 驗證輸入
    if (!currentPassword) {
        showError('請輸入目前密碼');
        return;
    }
    
    if (!newPassword) {
        showError('請輸入新密碼');
        return;
    }
    
    if (newPassword.length < 8) {
        showError('新密碼長度至少需要 8 個字元');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showError('新密碼與確認密碼不一致');
        return;
    }
    
    if (currentPassword === newPassword) {
        showError('新密碼不能與目前密碼相同');
        return;
    }
    
    try {
        const response = await adminFetch('/api/admin/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('密碼已成功修改');
            // 清空表單
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
        } else {
            showError('修改密碼失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('修改密碼錯誤:', error);
        showError('修改密碼時發生錯誤：' + error.message);
    }
}

// 儲存付款設定（包含付款方式設定和訂金百分比）
async function savePaymentSettings() {
    const depositPercentage = document.getElementById('depositPercentage').value;
    const enableTransfer = document.getElementById('enableTransfer').checked ? '1' : '0';
    const enableCard = document.getElementById('enableCard').checked ? '1' : '0';
    
    // 驗證訂金百分比
    if (!depositPercentage || depositPercentage < 0 || depositPercentage > 100) {
        showError('請輸入有效的訂金百分比（0-100）');
        return;
    }
    
    // 驗證：如果啟用線上刷卡，必須填寫綠界設定
    const ecpayMerchantID = document.getElementById('ecpayMerchantID').value;
    const ecpayHashKey = document.getElementById('ecpayHashKey').value;
    const ecpayHashIV = document.getElementById('ecpayHashIV').value;
    
    if (enableCard === '1' && (!ecpayMerchantID || !ecpayHashKey || !ecpayHashIV)) {
        showError('啟用線上刷卡時，必須填寫完整的綠界串接碼（MerchantID、HashKey、HashIV）');
        return;
    }
    
    try {
        const [depositResponse, enableTransferResponse, enableCardResponse] = await Promise.all([
            adminFetch('/api/admin/settings/deposit_percentage', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: depositPercentage,
                    description: '訂金百分比（例如：30 表示 30%）'
                })
            }),
            adminFetch('/api/admin/settings/enable_transfer', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: enableTransfer,
                    description: '啟用匯款轉帳（1=啟用，0=停用）'
                })
            }),
            adminFetch('/api/admin/settings/enable_card', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: enableCard,
                    description: '啟用線上刷卡（1=啟用，0=停用）'
                })
            })
        ]);
        
        const results = await Promise.all([
            depositResponse.json(),
            enableTransferResponse.json(),
            enableCardResponse.json()
        ]);
        
        const allSuccess = results.every(r => r.success);
        if (allSuccess) {
            showSuccess('付款設定已儲存');
        } else {
            const errorMsg = results.find(r => !r.success)?.message || '請稍後再試';
            showError('儲存失敗：' + errorMsg);
        }
    } catch (error) {
        console.error('儲存付款設定錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 儲存匯款帳號設定
async function saveRemittanceAccountSettings() {
    const bankName = document.getElementById('bankName').value;
    const bankBranch = document.getElementById('bankBranch').value;
    const bankAccount = document.getElementById('bankAccount').value;
    const accountName = document.getElementById('accountName').value;
    
    try {
        const [bankNameResponse, bankBranchResponse, bankAccountResponse, accountNameResponse] = await Promise.all([
            adminFetch('/api/admin/settings/bank_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankName,
                    description: '銀行名稱（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/bank_branch', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankBranch,
                    description: '分行名稱（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/bank_account', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankAccount,
                    description: '匯款帳號（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/account_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: accountName,
                    description: '帳戶戶名（顯示在匯款轉帳確認郵件中）'
                })
            })
        ]);
        
        const results = await Promise.all([
            bankNameResponse.json(),
            bankBranchResponse.json(),
            bankAccountResponse.json(),
            accountNameResponse.json()
        ]);
        
        const allSuccess = results.every(r => r.success);
        if (allSuccess) {
            showSuccess('匯款帳號設定已儲存');
        } else {
            const errorMsg = results.find(r => !r.success)?.message || '請稍後再試';
            showError('儲存失敗：' + errorMsg);
        }
    } catch (error) {
        console.error('儲存匯款帳號設定錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 儲存綠界支付設定
async function saveEcpaySettings() {
    const ecpayMerchantID = document.getElementById('ecpayMerchantID').value;
    const ecpayHashKey = document.getElementById('ecpayHashKey').value;
    const ecpayHashIV = document.getElementById('ecpayHashIV').value;
    
    // 驗證：如果啟用線上刷卡，必須填寫綠界設定
    const enableCard = document.getElementById('enableCard').checked;
    if (enableCard && (!ecpayMerchantID || !ecpayHashKey || !ecpayHashIV)) {
        showError('啟用線上刷卡時，必須填寫完整的綠界串接碼（MerchantID、HashKey、HashIV）');
        return;
    }
    
    try {
        const [ecpayMerchantIDResponse, ecpayHashKeyResponse, ecpayHashIVResponse] = await Promise.all([
            adminFetch('/api/admin/settings/ecpay_merchant_id', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayMerchantID,
                    description: '綠界商店代號（MerchantID）'
                })
            }),
            adminFetch('/api/admin/settings/ecpay_hash_key', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayHashKey,
                    description: '綠界金鑰（HashKey）'
                })
            }),
            adminFetch('/api/admin/settings/ecpay_hash_iv', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayHashIV,
                    description: '綠界向量（HashIV）'
                })
            })
        ]);
        
        const results = await Promise.all([
            ecpayMerchantIDResponse.json(),
            ecpayHashKeyResponse.json(),
            ecpayHashIVResponse.json()
        ]);
        
        const allSuccess = results.every(r => r.success);
        if (allSuccess) {
            showSuccess('綠界支付設定已儲存');
        } else {
            const errorMsg = results.find(r => !r.success)?.message || '請稍後再試';
            showError('儲存失敗：' + errorMsg);
        }
    } catch (error) {
        console.error('儲存綠界支付設定錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 儲存旅館資訊設定
async function saveHotelInfoSettings() {
    const hotelName = document.getElementById('hotelName').value;
    const hotelPhone = document.getElementById('hotelPhone').value;
    const hotelAddress = document.getElementById('hotelAddress').value;
    const hotelEmail = document.getElementById('hotelEmail').value;
    const adminEmail = document.getElementById('adminEmail').value;
    
    // 驗證管理員信箱
    if (!adminEmail) {
        showError('請填寫管理員通知信箱');
        return;
    }
    
    // 驗證 Email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail)) {
        showError('請輸入有效的管理員通知信箱');
        return;
    }
    
    try {
        const [hotelNameResponse, hotelPhoneResponse, hotelAddressResponse, hotelEmailResponse, adminEmailResponse] = await Promise.all([
            adminFetch('/api/admin/settings/hotel_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelName,
                    description: '旅館名稱'
                })
            }),
            adminFetch('/api/admin/settings/hotel_phone', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelPhone,
                    description: '旅館電話'
                })
            }),
            adminFetch('/api/admin/settings/hotel_address', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelAddress,
                    description: '旅館地址'
                })
            }),
            adminFetch('/api/admin/settings/hotel_email', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelEmail,
                    description: '旅館信箱'
                })
            }),
            adminFetch('/api/admin/settings/admin_email', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: adminEmail,
                    description: '管理員通知信箱（新訂房通知郵件會寄到此信箱）'
                })
            })
        ]);
        
        const results = await Promise.all([
            hotelNameResponse.json(),
            hotelPhoneResponse.json(),
            hotelAddressResponse.json(),
            hotelEmailResponse.json(),
            adminEmailResponse.json()
        ]);
        
        const allSuccess = results.every(r => r.success);
        if (allSuccess) {
            showSuccess('旅館資訊已儲存');
        } else {
            const errorMsg = results.find(r => !r.success)?.message || '請稍後再試';
            showError('儲存失敗：' + errorMsg);
        }
    } catch (error) {
        console.error('儲存旅館資訊錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 儲存 Resend 設定
async function saveResendSettings() {
    const resendApiKey = document.getElementById('resendApiKey').value.trim();
    
    // 驗證必填欄位
    if (!resendApiKey) {
        showError('請填寫 Resend API Key');
        return;
    }
    
    // 驗證 API Key 格式（Resend API Key 通常以 re_ 開頭）
    if (!resendApiKey.startsWith('re_')) {
        showError('Resend API Key 格式不正確，應以 re_ 開頭');
        return;
    }
    
    try {
        const response = await adminFetch('/api/admin/settings/resend_api_key', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                value: resendApiKey,
                description: 'Resend API Key（郵件服務提供商）'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Resend 發信設定已儲存！請重新啟動伺服器以套用變更。');
            // 重新載入設定
            setTimeout(() => {
                loadSettings();
            }, 300);
        } else {
            showError('儲存 Resend 設定失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('儲存 Resend 設定錯誤:', error);
        showError('儲存 Resend 設定時發生錯誤：' + error.message);
    }
}

// 檢查 Resend 設定狀態
async function checkResendStatus() {
    const statusDiv = document.getElementById('resendStatusCheck');
    if (!statusDiv) return;
    
    statusDiv.style.display = 'block';
    statusDiv.innerHTML = '<div style="padding: 15px; background-color: #f0f9ff; border-radius: 8px; color: #0369a1;">⏳ 正在檢查 Resend 設定狀態...</div>';
    
    try {
        const response = await adminFetch('/api/admin/email-service-status');
        const result = await response.json();
        
        if (result.success) {
            const status = result.data;
            let html = '<div style="padding: 20px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">';
            html += '<h4 style="margin-top: 0; color: #1f2937;">📧 郵件服務狀態檢查</h4>';
            
            // Resend 狀態
            html += '<div style="margin-bottom: 20px; padding: 15px; background-color: white; border-radius: 6px; border-left: 4px solid #10b981;">';
            html += '<h5 style="margin-top: 0; color: #059669;">Resend 設定</h5>';
            html += '<ul style="margin: 10px 0; padding-left: 20px; color: #374151;">';
            html += `<li>套件安裝狀態: <strong>${status.resend.packageInstalled ? '✅ 已安裝' : '❌ 未安裝'}</strong></li>`;
            html += `<li>API Key 設定: <strong>${status.resend.apiKeyConfigured ? '✅ 已設定' : '❌ 未設定'}</strong></li>`;
            if (status.resend.apiKeyConfigured) {
                html += `<li>設定來源: <strong>${status.resend.apiKeySource}</strong></li>`;
                html += `<li>API Key 前綴: <strong>${status.resend.apiKeyPrefix}</strong></li>`;
            }
            html += `<li>客戶端初始化: <strong>${status.resend.clientInitialized ? '✅ 已初始化' : '❌ 未初始化'}</strong></li>`;
            html += `<li>狀態: <strong style="color: ${status.resend.status === '已啟用' ? '#059669' : '#dc2626'}">${status.resend.status}</strong></li>`;
            html += '</ul>';
            html += '</div>';
            
            // Gmail 狀態
            html += '<div style="margin-bottom: 20px; padding: 15px; background-color: white; border-radius: 6px; border-left: 4px solid #3b82f6;">';
            html += '<h5 style="margin-top: 0; color: #2563eb;">Gmail 設定（備用）</h5>';
            html += `<p style="margin: 10px 0; color: #374151;">OAuth2 設定: <strong>${status.gmail.oauth2Configured ? '✅ 已設定' : '❌ 未設定'}</strong></p>`;
            html += `<p style="margin: 10px 0; color: #374151;">狀態: <strong>${status.gmail.status}</strong></p>`;
            html += '</div>';
            
            // 當前狀態
            html += '<div style="margin-bottom: 20px; padding: 15px; background-color: white; border-radius: 6px; border-left: 4px solid #8b5cf6;">';
            html += '<h5 style="margin-top: 0; color: #7c3aed;">當前設定</h5>';
            html += `<p style="margin: 10px 0; color: #374151;">郵件服務提供商: <strong style="color: ${status.currentProvider === 'resend' ? '#059669' : '#2563eb'}">${status.currentProvider === 'resend' ? 'Resend' : 'Gmail'}</strong></p>`;
            html += `<p style="margin: 10px 0; color: #374151;">發件人信箱: <strong>${status.senderEmail}</strong></p>`;
            html += '</div>';
            
            // 建議
            if (status.recommendations && status.recommendations.length > 0) {
                html += '<div style="padding: 15px; background-color: white; border-radius: 6px; border-left: 4px solid #f59e0b;">';
                html += '<h5 style="margin-top: 0; color: #d97706;">建議事項</h5>';
                html += '<ul style="margin: 10px 0; padding-left: 20px; color: #374151;">';
                status.recommendations.forEach(rec => {
                    html += `<li>${rec}</li>`;
                });
                html += '</ul>';
                html += '</div>';
            }
            
            html += '</div>';
            statusDiv.innerHTML = html;
        } else {
            statusDiv.innerHTML = `<div style="padding: 15px; background-color: #fee2e2; border-radius: 8px; color: #dc2626;">❌ 檢查失敗: ${result.message || '未知錯誤'}</div>`;
        }
    } catch (error) {
        console.error('檢查 Resend 狀態錯誤:', error);
        statusDiv.innerHTML = `<div style="padding: 15px; background-color: #fee2e2; border-radius: 8px; color: #dc2626;">❌ 檢查時發生錯誤: ${error.message}</div>`;
    }
}

// 儲存 Gmail 發信設定
// 儲存 LINE 官方帳號設定
async function saveLineSettings() {
    const lineChannelAccessToken = document.getElementById('lineChannelAccessToken').value.trim();
    const lineChannelSecret = document.getElementById('lineChannelSecret').value.trim();
    const lineLiffId = document.getElementById('lineLiffId').value.trim();
    const lineLiffUrl = document.getElementById('lineLiffUrl').value.trim();
    
    try {
        const [
            channelAccessTokenResponse,
            channelSecretResponse,
            liffIdResponse,
            liffUrlResponse
        ] = await Promise.all([
            adminFetch('/api/admin/settings/line_channel_access_token', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: lineChannelAccessToken,
                    description: 'LINE Channel Access Token'
                })
            }),
            adminFetch('/api/admin/settings/line_channel_secret', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: lineChannelSecret,
                    description: 'LINE Channel Secret'
                })
            }),
            adminFetch('/api/admin/settings/line_liff_id', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: lineLiffId,
                    description: 'LINE LIFF App ID'
                })
            }),
            adminFetch('/api/admin/settings/line_liff_url', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: lineLiffUrl || (lineLiffId ? `https://liff.line.me/${lineLiffId}` : ''),
                    description: 'LINE LIFF App URL'
                })
            })
        ]);
        
        const results = await Promise.all([
            channelAccessTokenResponse.json(),
            channelSecretResponse.json(),
            liffIdResponse.json(),
            liffUrlResponse.json()
        ]);
        
        const hasError = results.some(result => !result.success);
        if (hasError) {
            const errorMessages = results.filter(r => !r.success).map(r => r.message).join(', ');
            showError('儲存 LINE 設定失敗：' + errorMessages);
        } else {
            showSuccess('LINE 設定已儲存');
            // 重新載入設定以確保 UI 與資料庫同步
            setTimeout(() => {
                loadSettings();
            }, 300);
        }
    } catch (error) {
        console.error('儲存 LINE 設定錯誤:', error);
        showError('儲存 LINE 設定時發生錯誤：' + error.message);
    }
}

async function saveGmailSettings() {
    const emailUser = document.getElementById('emailUser').value.trim();
    const gmailClientID = document.getElementById('gmailClientID').value.trim();
    const gmailClientSecret = document.getElementById('gmailClientSecret').value.trim();
    const gmailRefreshToken = document.getElementById('gmailRefreshToken').value.trim();
    
    // 驗證必填欄位
    if (!emailUser || !gmailClientID || !gmailClientSecret || !gmailRefreshToken) {
        showError('請填寫所有必填欄位（Gmail 帳號、Client ID、Client Secret、Refresh Token）');
        return;
    }
    
    // 驗證 Email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailUser)) {
        showError('請輸入有效的 Gmail 帳號');
        return;
    }
    
    try {
        const [
            emailUserResponse,
            gmailClientIDResponse,
            gmailClientSecretResponse,
            gmailRefreshTokenResponse
        ] = await Promise.all([
            adminFetch('/api/admin/settings/email_user', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: emailUser,
                    description: 'Gmail 發信帳號'
                })
            }),
            adminFetch('/api/admin/settings/gmail_client_id', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: gmailClientID,
                    description: 'Gmail OAuth2 Client ID'
                })
            }),
            adminFetch('/api/admin/settings/gmail_client_secret', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: gmailClientSecret,
                    description: 'Gmail OAuth2 Client Secret'
                })
            }),
            adminFetch('/api/admin/settings/gmail_refresh_token', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: gmailRefreshToken,
                    description: 'Gmail OAuth2 Refresh Token'
                })
            })
        ]);
        
        const results = await Promise.all([
            emailUserResponse.json(),
            gmailClientIDResponse.json(),
            gmailClientSecretResponse.json(),
            gmailRefreshTokenResponse.json()
        ]);
        
        const hasError = results.some(result => !result.success);
        if (hasError) {
            const errorMessages = results.filter(r => !r.success).map(r => r.message).join(', ');
            showError('儲存 Gmail 設定失敗：' + errorMessages);
        } else {
            showSuccess('Gmail 發信設定已儲存！請重新啟動伺服器以套用變更。');
        }
    } catch (error) {
        console.error('儲存 Gmail 設定錯誤:', error);
        showError('儲存 Gmail 設定時發生錯誤：' + error.message);
    }
}

// 載入系統設定
// 切換系統設定分頁
function switchSettingsTab(tab) {
    // 隱藏所有分頁內容
    const allTabContents = document.querySelectorAll('#settings-section .tab-content');
    allTabContents.forEach(content => {
        content.classList.remove('active');
    });
    
    // 移除所有分頁按鈕的 active 狀態
    const allTabButtons = document.querySelectorAll('#settings-section .tab-button');
    allTabButtons.forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 顯示選中的分頁內容
    const contentId = `settingsTab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`;
    const content = document.getElementById(contentId);
    if (content) {
        content.classList.add('active');
    } else {
        console.error('找不到分頁內容:', contentId);
    }
    
    // 設定選中的分頁按鈕為 active
    const buttonId = `settingsTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
    const button = document.getElementById(buttonId);
    if (button) {
        button.classList.add('active');
    } else {
        console.error('找不到分頁按鈕:', buttonId);
    }
    
    // 儲存當前分頁到 localStorage
    localStorage.setItem('settingsTab', tab);
}

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
            
            // 管理員通知信箱
            document.getElementById('adminEmail').value = settings.admin_email || '';
            
            // LINE 官方帳號設定
            document.getElementById('lineChannelAccessToken').value = settings.line_channel_access_token || '';
            document.getElementById('lineChannelSecret').value = settings.line_channel_secret || '';
            document.getElementById('lineLiffId').value = settings.line_liff_id || '';
            document.getElementById('lineLiffUrl').value = settings.line_liff_url || '';
            
            // Resend 發信設定
            const resendApiKeyInput = document.getElementById('resendApiKey');
            if (resendApiKeyInput) {
                resendApiKeyInput.value = settings.resend_api_key || '';
            }
            
            // Gmail 發信設定
            document.getElementById('emailUser').value = settings.email_user || '';
            document.getElementById('gmailClientID').value = settings.gmail_client_id || '';
            document.getElementById('gmailClientSecret').value = settings.gmail_client_secret || '';
            document.getElementById('gmailRefreshToken').value = settings.gmail_refresh_token || '';
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
            adminFetch('/api/admin/settings/deposit_percentage', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: depositPercentage,
                    description: '訂金百分比（例如：30 表示 30%）'
                })
            }),
            adminFetch('/api/admin/settings/bank_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankName,
                    description: '銀行名稱（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/bank_branch', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankBranch,
                    description: '分行名稱（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/bank_account', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: bankAccount,
                    description: '匯款帳號（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/account_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: accountName,
                    description: '帳戶戶名（顯示在匯款轉帳確認郵件中）'
                })
            }),
            adminFetch('/api/admin/settings/enable_transfer', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: enableTransfer,
                    description: '啟用匯款轉帳（1=啟用，0=停用）'
                })
            }),
            adminFetch('/api/admin/settings/enable_card', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: enableCard,
                    description: '啟用線上刷卡（1=啟用，0=停用）'
                })
            }),
            adminFetch('/api/admin/settings/ecpay_merchant_id', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayMerchantID,
                    description: '綠界商店代號（MerchantID）'
                })
            }),
            adminFetch('/api/admin/settings/ecpay_hash_key', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayHashKey,
                    description: '綠界金鑰（HashKey）'
                })
            }),
            adminFetch('/api/admin/settings/ecpay_hash_iv', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: ecpayHashIV,
                    description: '綠界向量（HashIV）'
                })
            }),
            adminFetch('/api/admin/settings/hotel_name', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelName,
                    description: '旅館名稱（顯示在郵件最下面）'
                })
            }),
            adminFetch('/api/admin/settings/hotel_phone', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelPhone,
                    description: '旅館電話（顯示在郵件最下面）'
                })
            }),
            adminFetch('/api/admin/settings/hotel_address', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    value: hotelAddress,
                    description: '旅館地址（顯示在郵件最下面）'
                })
            }),
            adminFetch('/api/admin/settings/hotel_email', {
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
            showSuccess('設定已儲存');
            // 儲存成功後，重新載入設定以確保 UI 與資料庫同步
            // 但不要立即重新載入，給伺服器一點時間處理
            setTimeout(() => {
                loadSettings();
            }, 300);
        } else {
            const errorMsg = results.find(r => !r.success)?.message || '請稍後再試';
            showError('儲存失敗：' + errorMsg);
            // 即使部分失敗，也重新載入設定以顯示實際狀態
            setTimeout(() => {
                loadSettings();
            }, 300);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 載入平日/假日設定
function loadWeekdaySettings(settingsJson) {
    try {
        console.log('📋 開始解析平日/假日設定:', settingsJson);
        
        let weekdays = [1, 2, 3, 4, 5]; // 預設：週一到週五為平日
        if (settingsJson) {
            const settings = typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
            console.log('📋 解析後的設定:', settings);
            if (settings.weekdays && Array.isArray(settings.weekdays)) {
                weekdays = settings.weekdays.map(d => parseInt(d));
                console.log('📋 平日列表:', weekdays);
            }
        }
        
        // 設定 checkbox 狀態
        // 注意：未勾選的日期 = 平日，勾選的日期 = 假日
        // 所以如果 weekdays 包含某個日期，該日期是平日，checkbox 應該不勾選
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let loadedCount = 0;
        let missingCount = 0;
        
        for (let i = 0; i <= 6; i++) {
            const checkboxId = `weekday${dayNames[i]}`;
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                // weekdays 列表中的日期是平日（未勾選），不在列表中的是假日（勾選）
                checkbox.checked = !weekdays.includes(i);
                loadedCount++;
                console.log(`✅ ${dayNames[i]} (${i}): ${checkbox.checked ? '假日' : '平日'}`);
            } else {
                missingCount++;
                console.warn(`⚠️ 找不到 checkbox: ${checkboxId} (可能不在當前頁面)`);
            }
        }
        
        if (loadedCount > 0) {
            console.log(`✅ 已載入 ${loadedCount}/7 個 checkbox`);
        } else if (missingCount > 0) {
            console.log(`ℹ️ 假日設定 checkbox 不在當前頁面（${missingCount} 個元素未找到）`);
        }
    } catch (error) {
        console.error('❌ 載入平日/假日設定錯誤:', error);
        // 使用預設值：週一到週五為平日（不勾選），週六週日為假日（勾選）
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 0; i <= 6; i++) {
            const checkbox = document.getElementById(`weekday${dayNames[i]}`);
            if (checkbox) {
                // 週一到週五（1-5）不勾選（平日），週日（0）和週六（6）勾選（假日）
                checkbox.checked = (i === 0 || i === 6);
            }
        }
    }
}

// 取得平日/假日設定
function getWeekdaySettings() {
    const weekdays = [];
    // 未勾選的日期 = 平日，所以收集未勾選的日期
    for (let i = 0; i <= 6; i++) {
        const checkbox = document.getElementById(`weekday${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}`);
        if (checkbox && !checkbox.checked) {
            weekdays.push(i);
        }
    }
    return JSON.stringify({ weekdays });
}

// 更新平日/假日設定（checkbox 變更時觸發）
function updateWeekdaySettings() {
    // 這個函數可以在 checkbox 變更時做一些即時反饋，目前不需要特別處理
    // 設定會在點擊「儲存平日/假日設定」時儲存
}

// 從伺服器載入平日/假日設定
async function loadWeekdaySettingsFromServer(retryCount = 0) {
    try {
        // 檢查 DOM 元素是否準備好
        const firstCheckbox = document.getElementById('weekdaySun');
        if (!firstCheckbox && retryCount < 5) {
            console.log(`⏳ DOM 元素尚未準備好，${100 * (retryCount + 1)}ms 後重試...`);
            setTimeout(() => {
                loadWeekdaySettingsFromServer(retryCount + 1);
            }, 100 * (retryCount + 1));
            return;
        }
        
        if (!firstCheckbox) {
            console.error('❌ 無法找到 weekday checkbox 元素');
            return;
        }
        
        console.log('🔄 開始載入平日/假日設定...');
        const response = await fetch('/api/settings');
        const result = await response.json();
        
        console.log('📥 收到設定資料:', result);
        
        if (result.success) {
            const weekdaySettings = result.data.weekday_settings;
            console.log('📅 weekday_settings 值:', weekdaySettings);
            
            // 無論是否有資料，都調用 loadWeekdaySettings
            loadWeekdaySettings(weekdaySettings);
            console.log('✅ 平日/假日設定已載入');
        } else {
            console.error('❌ 載入設定失敗:', result.message);
            loadWeekdaySettings(null);
        }
    } catch (error) {
        console.error('❌ 載入平日/假日設定錯誤:', error);
        loadWeekdaySettings(null);
    }
}

// 儲存平日/假日設定（獨立按鈕）
async function saveWeekdaySettings() {
    try {
        const settingsValue = getWeekdaySettings();
        console.log('💾 準備儲存平日/假日設定:', settingsValue);
        
        const response = await adminFetch('/api/admin/settings/weekday_settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                value: settingsValue,
                description: '平日/假日設定（JSON 格式：{"weekdays": [1,2,3,4,5]}）'
            })
        });
        
        const result = await response.json();
        console.log('💾 儲存結果:', result);
        
        if (result.success) {
            showSuccess('平日/假日設定已儲存');
            // 重新載入設定以確保 UI 同步
            setTimeout(() => {
                loadWeekdaySettingsFromServer();
            }, 500);
        } else {
            showError('儲存失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('❌ 儲存平日/假日設定錯誤:', error);
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

// 根據模板類型獲取標題顏色（統一的輔助函數）
function getHeaderColorForTemplate(templateKey) {
    if (templateKey === 'payment_reminder') {
        return '#e74c3c'; // 紅色（匯款提醒）
    } else if (templateKey === 'booking_confirmation') {
        return '#198754'; // 綠色（訂房確認（客戶））
    } else if (templateKey === 'booking_confirmation_admin') {
        return '#e74c3c'; // 紅色（訂房確認（管理員））
    } else if (templateKey === 'payment_completed') {
        return '#198754'; // 綠色（付款完成確認）
    } else if (templateKey === 'cancel_notification') {
        return '#e74c3c'; // 紅色（取消通知）
    } else {
        return '#262A33'; // 預設深灰色（入住提醒、感謝入住）
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
        'feedback_request': '感謝入住',
        'booking_confirmation': '訂房確認（客戶）',
        'booking_confirmation_admin': '訂房確認（管理員）',
        'payment_completed': '付款完成確認',
        'cancel_notification': '取消通知'
    };
    
    container.innerHTML = templates.map(template => `
        <div class="template-card" style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" onclick="showEmailTemplateModal('${template.template_key}')">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; gap: 12px;">
                <div>
                    <h3 style="margin: 0 0 5px 0; color: #333;">${template.template_name || templateNames[template.template_key] || template.template_key}</h3>
                    <p style="margin: 0; color: #666; font-size: 14px;">模板代碼：${template.template_key}</p>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                    <span class="status-badge ${template.is_enabled === 1 ? 'status-sent' : 'status-unsent'}">
                        ${template.is_enabled === 1 ? '啟用中' : '已停用'}
                    </span>
                    <button class="btn-edit" type="button" onclick="event.stopPropagation(); showEmailTemplateModal('${template.template_key}')">編輯</button>
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

// 重置郵件模板為預設圖卡樣式
// 直接定義為 window.resetCurrentTemplateToDefault，確保在事件監聽器設置前就可用
window.resetCurrentTemplateToDefault = async function resetCurrentTemplateToDefault() {
    const form = document.getElementById('emailTemplateForm');
    if (!form || !form.dataset.templateKey) {
        showError('無法獲取當前模板資訊');
        return;
    }
    
    const templateKey = form.dataset.templateKey;
    const templateName = document.getElementById('emailTemplateModalTitle')?.textContent?.replace('編輯郵件模板：', '') || templateKey;
    
    if (!confirm(`確定要將郵件模板「${templateName}」重置為預設的圖卡樣式嗎？此操作將覆蓋現有的模板內容。`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/email-templates/reset-to-default', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ templateKey })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`✅ ${result.message}`);
            
            // 重新載入當前模板內容
            await showEmailTemplateModal(templateKey);
            
            // 重新載入模板列表（如果列表可見）
            await loadEmailTemplates();
        } else {
            showError('重置失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('重置郵件模板錯誤:', error);
        showError('重置失敗：' + error.message);
    }
};

// 清除入住提醒郵件的區塊內容（使用新的預設格式）
async function clearCheckinBlocks() {
    if (!confirm('確定要清除入住提醒郵件的區塊內容嗎？系統將使用最新的預設格式。此操作不會影響其他設定。')) {
        return;
    }
    
    try {
        const response = await fetch('/api/email-templates/checkin_reminder/clear-blocks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('已清除區塊內容，系統將使用新的預設格式');
            
            // 重新載入模板以顯示新的預設內容
            const form = document.getElementById('emailTemplateForm');
            if (form && form.dataset.templateKey === 'checkin_reminder') {
                // 重新載入模板
                await showEmailTemplateModal('checkin_reminder');
            }
        } else {
            showError('清除失敗：' + result.message);
        }
    } catch (error) {
        console.error('清除入住提醒區塊內容錯誤:', error);
        showError('清除失敗：' + error.message);
    }
}

// 切換編輯模式（可視化 / HTML）
// 直接定義為 window.toggleEditorMode，確保在事件監聽器設置前就可用
window.toggleEditorMode = function toggleEditorMode() {
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
        if (quillEditor) {
            quillEditor.root.innerHTML = htmlContent;
        }
        
        // 更新預覽
        if (isPreviewVisible) {
            setTimeout(() => refreshEmailPreview(), 100);
        }
    } else {
        // 從可視化模式切換到 HTML 模式
        isHtmlMode = true;
        editorContainer.style.display = 'none';
        textarea.style.display = 'block';
        const toggleBtn = document.getElementById('toggleEditorModeBtn');
        if (toggleBtn) {
            toggleBtn.textContent = '切換到可視化模式';
        }
        
        // 將 Quill 的內容同步到 textarea
        let quillHtml = '';
        if (quillEditor) {
            quillHtml = quillEditor.root.innerHTML;
        }
        const originalContent = textarea.value;
        
        // 如果原始內容是完整 HTML，替換 body 內容
        if (originalContent && (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html'))) {
            if (originalContent.includes('<body>')) {
                textarea.value = originalContent.replace(
                    /<body[^>]*>[\s\S]*?<\/body>/i,
                    `<body>${quillHtml}</body>`
                );
            } else {
                textarea.value = originalContent.replace(
                    /<\/head>/i,
                    `</head><body>${quillHtml}</body>`
                );
            }
        } else {
            textarea.value = quillHtml;
        }
        
        // 為 textarea 加入 input 事件監聽，自動更新預覽
        textarea.removeEventListener('input', window.handleTextareaInput);
        textarea.addEventListener('input', window.handleTextareaInput);
        
        // 更新預覽
        if (isPreviewVisible) {
            setTimeout(() => refreshEmailPreview(), 100);
        }
    }
};

// textarea input 事件處理器
// 直接定義為 window.handleTextareaInput，確保在事件監聽器設置前就可用
window.handleTextareaInput = function handleTextareaInput() {
    if (isPreviewVisible && isHtmlMode) {
        clearTimeout(window.previewUpdateTimer);
        window.previewUpdateTimer = setTimeout(() => {
            refreshEmailPreview();
        }, 300);
    }
};

// 重新整理郵件預覽
// 直接定義為 window.refreshEmailPreview，確保在事件監聽器設置前就可用
window.refreshEmailPreview = function refreshEmailPreview() {
    const previewContent = document.getElementById('emailPreviewContent');
    if (!previewContent) return;
    
    console.log('🔄 更新預覽，當前樣式:', currentEmailStyle);
    
    // 如果不是 HTML 模式，先將 Quill 的內容同步到 textarea（保留結構）
    if (!isHtmlMode && quillEditor) {
        const quillHtml = quillEditor.root.innerHTML;
        const textarea = document.getElementById('emailTemplateContent');
        const originalContent = textarea.value;
        
        // 如果原始內容是完整 HTML，需要更新 body 內的 .content div 內容
        if (originalContent && (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html'))) {
            if (originalContent.includes('<body>')) {
                const bodyMatch = originalContent.match(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i);
                if (bodyMatch) {
                    const bodyContent = bodyMatch[2];
                    const contentDivStartRegex = /<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>/i;
                    const contentStartMatch = bodyContent.match(contentDivStartRegex);
                    
                    if (contentStartMatch) {
                        const startIndex = contentStartMatch.index;
                        const startTag = contentStartMatch[0];
                        const afterStartTag = bodyContent.substring(startIndex + startTag.length);
                        
                        // 計算嵌套的 div 層級，找到對應的結束標籤
                        let divCount = 1;
                        let currentIndex = 0;
                        let endIndex = -1;
                        
                        while (currentIndex < afterStartTag.length && divCount > 0) {
                            const openDiv = afterStartTag.indexOf('<div', currentIndex);
                            const closeDiv = afterStartTag.indexOf('</div>', currentIndex);
                            
                            if (closeDiv === -1) break;
                            
                            if (openDiv !== -1 && openDiv < closeDiv) {
                                divCount++;
                                currentIndex = openDiv + 4;
                            } else {
                                divCount--;
                                if (divCount === 0) {
                                    endIndex = closeDiv;
                                    break;
                                }
                                currentIndex = closeDiv + 6;
                            }
                        }
                        
                        if (endIndex !== -1) {
                            const beforeContent = bodyContent.substring(0, startIndex + startTag.length);
                            const afterContent = bodyContent.substring(startIndex + startTag.length + endIndex);
                            const newBodyContent = beforeContent + quillHtml + afterContent;
                            
                            textarea.value = originalContent.replace(
                                /<body[^>]*>[\s\S]*?<\/body>/i,
                                bodyMatch[1] + newBodyContent + bodyMatch[3]
                            );
                            console.log('✅ 已同步 Quill 內容到 textarea');
                        }
                    }
                }
            }
        }
    }
    
    // 從 textarea 獲取完整的原始 HTML
    const fullHtml = document.getElementById('emailTemplateContent').value;
    let bodyContent = '';
    
    // 從完整 HTML 中提取 body 內容
    if (fullHtml.includes('<body>')) {
        const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            bodyContent = bodyMatch[1];
        } else {
            bodyContent = fullHtml;
        }
    } else {
        bodyContent = fullHtml;
    }
    
    // 移除所有 style 標籤和 script 標籤
    bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    bodyContent = bodyContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    
    // 構建完整的 HTML 文檔用於預覽
    const previewHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #262A33; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    </style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
    
    // 更新預覽 iframe
    previewContent.srcdoc = previewHtml;
};

// 切換簡化編輯模式
// 直接定義為 window.toggleSimpleMode，確保在事件監聽器設置前就可用
window.toggleSimpleMode = function toggleSimpleMode() {
    isSimpleMode = !isSimpleMode;
    const simpleModeBtn = document.getElementById('toggleSimpleModeBtn');
    const simpleModeText = document.getElementById('simpleModeText');
    const editorContainer = document.getElementById('emailTemplateEditor');
    
    if (isSimpleMode) {
        // 啟用簡化模式：隱藏格式化工具列，只允許編輯文字
        if (simpleModeBtn) {
            simpleModeBtn.style.backgroundColor = '#10b981';
            simpleModeBtn.style.color = 'white';
        }
        if (simpleModeText) {
            simpleModeText.textContent = '簡化模式（已啟用）';
        }
        
        // 隱藏 Quill 工具列
        if (quillEditor && quillEditor.getModule('toolbar')) {
            const toolbarElement = quillEditor.container.querySelector('.ql-toolbar');
            if (toolbarElement) {
                toolbarElement.style.display = 'none';
            }
        }
        
        // 添加提示訊息
        if (editorContainer) {
            let hintDiv = editorContainer.parentElement.querySelector('.simple-mode-hint');
            if (!hintDiv) {
                hintDiv = document.createElement('div');
                hintDiv.className = 'simple-mode-hint';
                hintDiv.style.cssText = 'background: #d1fae5; border: 2px solid #10b981; border-radius: 8px; padding: 12px; margin-bottom: 10px; color: #065f46; font-size: 13px;';
                hintDiv.innerHTML = '<strong>🛡️ 簡化編輯模式已啟用</strong><br>您現在只能編輯文字內容，所有 HTML 結構和樣式都會被保護。使用上方的變數按鈕可以插入動態內容。';
                editorContainer.parentElement.insertBefore(hintDiv, editorContainer);
            }
            hintDiv.style.display = 'block';
        }
        
        console.log('✅ 簡化編輯模式已啟用');
    } else {
        // 關閉簡化模式：顯示格式化工具列
        if (simpleModeBtn) {
            simpleModeBtn.style.backgroundColor = '';
            simpleModeBtn.style.color = '';
        }
        if (simpleModeText) {
            simpleModeText.textContent = '簡化模式';
        }
        
        // 顯示 Quill 工具列
        if (quillEditor && quillEditor.getModule('toolbar')) {
            const toolbarElement = quillEditor.container.querySelector('.ql-toolbar');
            if (toolbarElement) {
                toolbarElement.style.display = '';
            }
        }
        
        // 隱藏提示訊息
        if (editorContainer) {
            const hintDiv = editorContainer.parentElement.querySelector('.simple-mode-hint');
            if (hintDiv) {
                hintDiv.style.display = 'none';
            }
        }
        
        console.log('✅ 簡化編輯模式已關閉');
    }
};

// 切換郵件預覽顯示
// 直接定義為 window.toggleEmailPreview，確保在事件監聽器設置前就可用
window.toggleEmailPreview = function toggleEmailPreview() {
    isPreviewVisible = !isPreviewVisible;
    const previewArea = document.getElementById('emailPreviewArea');
    const editorArea = document.getElementById('emailEditorArea');
    const previewBtn = document.getElementById('togglePreviewBtn');
    const previewBtnText = document.getElementById('previewBtnText');
    
    if (isPreviewVisible) {
        if (previewArea) previewArea.style.display = 'block';
        if (editorArea) editorArea.style.flex = '1';
        if (previewBtnText) previewBtnText.textContent = '隱藏預覽';
        refreshEmailPreview();
    } else {
        if (previewArea) previewArea.style.display = 'none';
        if (editorArea) editorArea.style.flex = '1';
        if (previewBtnText) previewBtnText.textContent = '顯示預覽';
    }
};

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
            const textarea = document.getElementById('emailTemplateContent');
            
            // 檢查並修復錯誤的模板名稱和主旨（防止 email 地址格式）
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            let templateName = template.template_name || '';
            let templateSubject = template.subject || '';
            
            // 如果模板名稱是 email 地址格式，使用預設名稱
            if (emailRegex.test(templateName.trim())) {
                console.warn('⚠️ 檢測到錯誤的模板名稱格式（email 地址），使用預設名稱');
                const templateNames = {
                    'payment_reminder': '匯款提醒',
                    'checkin_reminder': '入住提醒',
                    'feedback_request': '感謝入住',
                    'booking_confirmation': '訂房確認（客戶）',
                    'booking_confirmation_admin': '訂房確認（管理員）',
                    'payment_completed': '付款完成確認',
                    'cancel_notification': '取消通知'
                };
                templateName = templateNames[templateKey] || templateKey;
            }
            
            // 如果主旨是 email 地址格式，使用預設主旨
            if (emailRegex.test(templateSubject.trim())) {
                console.warn('⚠️ 檢測到錯誤的郵件主旨格式（email 地址），使用預設主旨');
                const defaultSubjects = {
                    'payment_reminder': '【重要提醒】匯款期限即將到期',
                    'checkin_reminder': '【入住提醒】歡迎您明天入住',
                    'feedback_request': '【感謝入住】分享您的住宿體驗',
                    'booking_confirmation': '【訂房確認】您的訂房已成功',
                    'booking_confirmation_admin': '【新訂房通知】{{guestName}} - {{bookingId}}',
                    'payment_completed': '【訂房確認】您的訂房已成功',
                    'cancel_notification': '【訂房取消通知】您的訂房已自動取消'
                };
                templateSubject = defaultSubjects[templateKey] || '郵件主旨';
            }
            
            title.textContent = `編輯郵件模板：${templateName}`;
            document.getElementById('emailTemplateName').value = templateName;
            document.getElementById('emailTemplateSubject').value = templateSubject;
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
                    // ✅ 完全手動版：不再自動從 block_settings 合併或改寫 content
                    // 之後編輯器看到的內容 = 資料庫裡存的 content，儲存時也只更新 content
                }
                // 顯示「還原郵件範本」按鈕
                const restoreBtn = document.getElementById('restoreTemplateBtn');
                if (restoreBtn) {
                    restoreBtn.style.display = 'flex';
                }
            } else {
                // 顯示「還原郵件範本」按鈕（所有模板都可以還原）
                const restoreBtn = document.getElementById('restoreTemplateBtn');
                if (restoreBtn) {
                    restoreBtn.style.display = 'flex';
                }
            }
            
            // 儲存當前模板 key 到全域變數，供還原功能使用
            window.currentTemplateKey = templateKey;
            
            if (templateKey === 'feedback_request') {
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
            
            // ✅ 簡化版：直接將內容載入到 textarea，不使用 Quill 編輯器
            let htmlContent = template.content || '';
            
            console.log('載入模板內容，原始長度:', htmlContent.length);
            
            // 對於 checkin_reminder，從 block_settings 讀取區塊內容並合併到主內容中
            if (templateKey === 'checkin_reminder') {
                console.log('✅ 入住提醒模板：從 block_settings 讀取區塊內容');
                
                // 解析 block_settings
                let blockSettings = {};
                if (template.block_settings) {
                    try {
                        blockSettings = typeof template.block_settings === 'string' 
                            ? JSON.parse(template.block_settings) 
                            : template.block_settings;
                        console.log('✅ 已讀取 block_settings:', {
                            hasTransport: !!blockSettings.transport?.content,
                            hasParking: !!blockSettings.parking?.content,
                            hasNotes: !!blockSettings.notes?.content,
                            hasContact: !!blockSettings.contact?.content
                        });
                    } catch (e) {
                        console.warn('⚠️ 解析 block_settings 失敗:', e);
                    }
                }
                
                // 提取 body 內容（如果有的話）
                let bodyContent = htmlContent;
                let hasFullHtml = false;
                if (htmlContent.includes('<body>')) {
                    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch) {
                        bodyContent = bodyMatch[1];
                        hasFullHtml = true;
                    }
                }
                
                // 合併區塊內容到主內容中（優先對應新版 card 版型的 section-card 結構）
                // 替換交通路線區塊的內容
                if (blockSettings.transport?.content && blockSettings.transport.content.trim()) {
                    const transportContent = blockSettings.transport.content.trim();
                    // 尋找交通路線區塊的 section-body 並替換內容
                    bodyContent = bodyContent.replace(
                        /(<div[^>]*class\s*=\s*["'][^"']*section-card[^"']*section-transport[^"']*["'][^>]*>[\s\S]*?<div[^>]*class\s*=\s*["'][^"']*section-body[^"']*["'][^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<!--\s*停車資訊)/i,
                        (match, start, oldContent, end) => {
                            return start + transportContent + end;
                        }
                    );
                }
                
                // 替換停車資訊區塊的內容
                if (blockSettings.parking?.content && blockSettings.parking.content.trim()) {
                    const parkingContent = blockSettings.parking.content.trim();
                    bodyContent = bodyContent.replace(
                        /(<div[^>]*class\s*=\s*["'][^"']*section-card[^"']*section-parking[^"']*["'][^>]*>[\s\S]*?<div[^>]*class\s*=\s*["'][^"']*section-body[^"']*["'][^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<!--\s*入住注意事項)/i,
                        (match, start, oldContent, end) => {
                            return start + parkingContent + end;
                        }
                    );
                }
                
                // 替換入住注意事項區塊的內容
                if (blockSettings.notes?.content && blockSettings.notes.content.trim()) {
                    const notesContent = blockSettings.notes.content.trim();
                    bodyContent = bodyContent.replace(
                        /(<div[^>]*class\s*=\s*["'][^"']*section-card[^"']*section-notes[^"']*["'][^>]*>[\s\S]*?<div[^>]*class\s*=\s*["'][^"']*section-body[^"']*["'][^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<!--\s*聯絡資訊)/i,
                        (match, start, oldContent, end) => {
                            return start + notesContent + end;
                        }
                    );
                }
                
                // 替換聯絡資訊區塊的內容
                if (blockSettings.contact?.content && blockSettings.contact.content.trim()) {
                    const contactContent = blockSettings.contact.content.trim();
                    // 尋找最後一個聯絡資訊區塊
                    const contactRegex = /(<div[^>]*class\s*=\s*["'][^"']*section-card[^"']*section-contact[^"']*["'][^>]*>[\s\S]*?<div[^>]*class\s*=\s*["'][^"']*section-body[^"']*["'][^>]*>)([\s\S]*?)(<\/div>\s*<\/div>)/gi;
                    const matches = [...bodyContent.matchAll(contactRegex)];
                    if (matches.length > 0) {
                        // 替換最後一個匹配
                        const lastMatch = matches[matches.length - 1];
                        const startIndex = lastMatch.index;
                        const endIndex = startIndex + lastMatch[0].length;
                        bodyContent = bodyContent.substring(0, startIndex) + 
                                    lastMatch[1] + contactContent + lastMatch[3] + 
                                    bodyContent.substring(endIndex);
                    }
                }
                
                // 如果原始內容包含完整的 HTML 結構，保持結構；否則只使用 body 內容
                if (hasFullHtml) {
                    // 替換 body 標籤內的內容
                    htmlContent = htmlContent.replace(
                        /<body[^>]*>[\s\S]*?<\/body>/i,
                        `<body>${bodyContent}</body>`
                    );
                } else {
                    htmlContent = bodyContent;
                }

                // 🔁 兼容舊版：如果模板裡仍然使用 {{checkinTransport}} 等佔位符，
                // 直接用 block_settings 的內容做字串替換，讓編輯器可以看到實際 HTML。
                if (blockSettings.transport?.content && blockSettings.transport.content.trim()) {
                    const transportContent = blockSettings.transport.content.trim();
                    htmlContent = htmlContent.replace(/\{\{checkinTransport\}\}/g, transportContent);
                }
                if (blockSettings.parking?.content && blockSettings.parking.content.trim()) {
                    const parkingContent = blockSettings.parking.content.trim();
                    htmlContent = htmlContent.replace(/\{\{checkinParking\}\}/g, parkingContent);
                }
                if (blockSettings.notes?.content && blockSettings.notes.content.trim()) {
                    const notesContent = blockSettings.notes.content.trim();
                    htmlContent = htmlContent.replace(/\{\{checkinNotes\}\}/g, notesContent);
                }
                if (blockSettings.contact?.content && blockSettings.contact.content.trim()) {
                    const contactContent = blockSettings.contact.content.trim();
                    htmlContent = htmlContent.replace(/\{\{checkinContact\}\}/g, contactContent);
                }
                
                console.log('✅ 已合併（含字串替換）區塊內容到主內容，最終長度:', htmlContent.length);
            } else {
                // 其他模板：如果是完整的 HTML 文檔，提取 body 內容
                if (htmlContent.includes('<body>')) {
                    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch) {
                        htmlContent = bodyMatch[1];
                        console.log('提取 body 內容後，長度:', htmlContent.length);
                    }
                }
            }
            
            // 先顯示模態框
            modal.classList.add('active');
            
            // 直接將內容載入到 textarea
            if (textarea) {
                textarea.value = htmlContent || '';
                console.log('✅ 內容已載入到 textarea，長度:', textarea.value.length);
            }
            
            // 儲存 templateKey 以便儲存時使用
            form.dataset.templateKey = templateKey;
            
            // 設置發送測試郵件按鈕的事件監聽器（直接使用本地函數）
            const sendTestEmailBtn = document.getElementById('sendTestEmailBtn');
            if (sendTestEmailBtn) {
                // 移除舊的事件監聽器（如果有的話）
                const newBtn = sendTestEmailBtn.cloneNode(true);
                sendTestEmailBtn.parentNode.replaceChild(newBtn, sendTestEmailBtn);
                
                newBtn.addEventListener('click', async function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // 直接內聯發送邏輯，避免作用域問題
                    const testEmailInput = document.getElementById('testEmailAddress');
                    const testEmailBtn = newBtn; // 使用當前按鈕
                    const testEmailStatus = document.getElementById('testEmailStatus');
                    const form = document.getElementById('emailTemplateForm');
                    const templateKey = form ? form.dataset.templateKey : null;
                    
                    if (!templateKey) {
                        alert('找不到模板代碼');
                        return;
                    }
                    
                    const email = testEmailInput ? testEmailInput.value.trim() : '';
                    if (!email) {
                        if (testEmailStatus) {
                            testEmailStatus.style.display = 'block';
                            testEmailStatus.style.color = '#e74c3c';
                            testEmailStatus.textContent = '請輸入 Email 地址';
                        }
                        return;
                    }
                    
                    // Email 格式驗證
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(email)) {
                        if (testEmailStatus) {
                            testEmailStatus.style.display = 'block';
                            testEmailStatus.style.color = '#e74c3c';
                            testEmailStatus.textContent = '請輸入有效的 Email 地址';
                        }
                        return;
                    }
                    
                    // 禁用按鈕並顯示載入狀態
                    testEmailBtn.disabled = true;
                    testEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">hourglass_empty</span>發送中...';
                    if (testEmailStatus) {
                        testEmailStatus.style.display = 'none';
                    }
                    
                    try {
                        // 獲取模板內容
                        let content = '';
                        const contentEl = document.getElementById('emailTemplateContent');
                        const subjectEl = document.getElementById('emailTemplateSubject');
                        const subject = subjectEl ? subjectEl.value : '';
                        
                        if (typeof isHtmlMode !== 'undefined' && isHtmlMode && contentEl) {
                            content = contentEl.value;
                        } else if (typeof quillEditor !== 'undefined' && quillEditor) {
                            const quillHtml = quillEditor.root.innerHTML;
                            const originalContent = contentEl ? contentEl.value : '';
                            
                            if (originalContent && (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html'))) {
                                if (originalContent.includes('<body>')) {
                                    content = originalContent.replace(
                                        /<body[^>]*>[\s\S]*?<\/body>/i,
                                        `<body>${quillHtml}</body>`
                                    );
                                } else {
                                    content = originalContent;
                                }
                            } else {
                                // 從 API 獲取模板
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
                                    }
                                } catch (e) {
                                    console.error('獲取模板內容失敗:', e);
                                }
                            }
                        }
                        
                        // 如果是入住提醒郵件，不再使用區塊設定（所有內容已合併到主內容中）
                        let blockSettings = null;
                        if (templateKey === 'checkin_reminder') {
                            // 所有內容已合併到 content 中，不需要 blockSettings
                            blockSettings = null;
                        }
                        
                        // 發送測試郵件
                        const response = await fetch(`/api/email-templates/${templateKey}/test`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                email: email,
                                useEditorContent: true,
                                subject: subject,
                                content: content,
                                blockSettings: blockSettings
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            if (testEmailStatus) {
                                testEmailStatus.style.display = 'block';
                                testEmailStatus.style.color = '#27ae60';
                                testEmailStatus.textContent = '✅ 測試郵件已成功發送！請檢查收件箱。';
                            }
                            if (testEmailInput) {
                                testEmailInput.value = '';
                            }
                        } else {
                            if (testEmailStatus) {
                                testEmailStatus.style.display = 'block';
                                testEmailStatus.style.color = '#e74c3c';
                                testEmailStatus.textContent = '❌ 發送失敗：' + (result.message || '未知錯誤');
                            }
                        }
                    } catch (error) {
                        console.error('發送測試郵件時發生錯誤:', error);
                        if (testEmailStatus) {
                            testEmailStatus.style.display = 'block';
                            testEmailStatus.style.color = '#e74c3c';
                            testEmailStatus.textContent = '❌ 發送失敗：' + error.message;
                        }
                    } finally {
                        // 恢復按鈕狀態
                        testEmailBtn.disabled = false;
                        testEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">send</span>發送測試郵件';
                    }
                });
                
                console.log('✅ sendTestEmail 按鈕事件監聽器已設置（直接使用本地函數）');
            }
            
            // 設置關閉模態框按鈕的事件監聽器
            const closeBtn = document.getElementById('emailTemplateModalClose');
            const cancelBtn = document.getElementById('emailTemplateModalCancel');
            
            if (closeBtn) {
                // 移除舊的事件監聽器
                const newCloseBtn = closeBtn.cloneNode(true);
                closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                
                if (typeof closeEmailTemplateModal === 'function') {
                    newCloseBtn.addEventListener('click', closeEmailTemplateModal);
                    console.log('✅ 關閉按鈕事件監聽器已設置');
                } else {
                    console.error('❌ closeEmailTemplateModal 函數未定義');
                    newCloseBtn.addEventListener('click', function() {
                        const modal = document.getElementById('emailTemplateModal');
                        if (modal) {
                            modal.classList.remove('active');
                        }
                    });
                }
            }
            
            if (cancelBtn) {
                // 移除舊的事件監聽器
                const newCancelBtn = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
                
                if (typeof closeEmailTemplateModal === 'function') {
                    newCancelBtn.addEventListener('click', closeEmailTemplateModal);
                    console.log('✅ 取消按鈕事件監聽器已設置');
                } else {
                    console.error('❌ closeEmailTemplateModal 函數未定義');
                    newCancelBtn.addEventListener('click', function() {
                        const modal = document.getElementById('emailTemplateModal');
                        if (modal) {
                            modal.classList.remove('active');
                        }
                    });
                }
            }
            
            // 設置重置圖卡樣式按鈕的事件監聽器
            const resetTemplateStyleBtn = document.getElementById('resetTemplateStyleBtn');
            if (resetTemplateStyleBtn) {
                const newResetBtn = resetTemplateStyleBtn.cloneNode(true);
                resetTemplateStyleBtn.parentNode.replaceChild(newResetBtn, resetTemplateStyleBtn);
                
                newResetBtn.addEventListener('click', async function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        // 函數已在前面定義，直接調用
                        if (typeof window.resetCurrentTemplateToDefault === 'function') {
                            await window.resetCurrentTemplateToDefault();
                        } else {
                            console.error('❌ resetCurrentTemplateToDefault 函數未定義');
                            alert('重置功能無法使用，請重新整理頁面');
                        }
                    } catch (error) {
                        console.error('❌ 調用 resetCurrentTemplateToDefault 時發生錯誤:', error);
                        alert('重置時發生錯誤：' + error.message);
                    }
                });
                console.log('✅ resetTemplateStyleBtn 按鈕事件監聽器已設置');
            }
            
            // 設置清除入住提醒區塊內容按鈕的事件監聽器
            const clearCheckinBlocksBtn = document.getElementById('clearCheckinBlocksBtn');
            if (clearCheckinBlocksBtn) {
                const newClearBtn = clearCheckinBlocksBtn.cloneNode(true);
                clearCheckinBlocksBtn.parentNode.replaceChild(newClearBtn, clearCheckinBlocksBtn);
                
                newClearBtn.addEventListener('click', async function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    await clearCheckinBlocks();
                });
                
                console.log('✅ clearCheckinBlocksBtn 按鈕事件監聽器已設置');
            }
            
            // 設置簡化模式按鈕的事件監聽器
            const toggleSimpleModeBtn = document.getElementById('toggleSimpleModeBtn');
            if (toggleSimpleModeBtn) {
                const newSimpleBtn = toggleSimpleModeBtn.cloneNode(true);
                toggleSimpleModeBtn.parentNode.replaceChild(newSimpleBtn, toggleSimpleModeBtn);
                
                newSimpleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        if (typeof window.toggleSimpleMode === 'function') {
                            window.toggleSimpleMode();
                        } else {
                            alert('簡化模式功能尚未載入，請稍候再試');
                        }
                    } catch (error) {
                        console.error('❌ 調用 toggleSimpleMode 時發生錯誤:', error);
                        alert('切換簡化模式時發生錯誤：' + error.message);
                    }
                });
                console.log('✅ toggleSimpleModeBtn 按鈕事件監聽器已設置');
            }
            
            // 設置顯示預覽按鈕的事件監聽器
            const togglePreviewBtn = document.getElementById('togglePreviewBtn');
            if (togglePreviewBtn) {
                const newToggleBtn = togglePreviewBtn.cloneNode(true);
                togglePreviewBtn.parentNode.replaceChild(newToggleBtn, togglePreviewBtn);
                
                newToggleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        // 優先使用本地函數（函數提升，應該可用）
                        if (typeof toggleEmailPreview === 'function') {
                            const fnString = toggleEmailPreview.toString();
                            // 檢查是否是佔位符函數
                            if (!fnString.includes('尚未載入') && !fnString.includes('功能載入中')) {
                                toggleEmailPreview();
                                return;
                            }
                        }
                        // 備用：使用 window 上的函數（但檢查是否為佔位符）
                        if (typeof window.toggleEmailPreview === 'function') {
                            const fnString = window.toggleEmailPreview.toString();
                            if (!fnString.includes('尚未載入') && !fnString.includes('功能載入中')) {
                                window.toggleEmailPreview();
                                return;
                            }
                        }
                        alert('預覽功能尚未載入，請稍候再試');
                    } catch (error) {
                        console.error('❌ 調用 toggleEmailPreview 時發生錯誤:', error);
                        alert('預覽時發生錯誤：' + error.message);
                    }
                });
                console.log('✅ togglePreviewBtn 按鈕事件監聽器已設置');
            }
        } else {
            showError('載入郵件模板時發生錯誤：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('Error:', error);
        showError('載入郵件模板時發生錯誤：' + error.message);
    }
}

// ===== 入住提醒（checkin_reminder）表單式編輯：data <-> html =====
function _getVal(id) {
    const el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
}

function _setVal(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value ?? '';
}

function _splitLines(text) {
    return (text || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
}

function getDefaultCheckinStructuredData() {
    return {
        transport: {
            address: '{{hotelAddress}}',
            mrt: '捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘',
            bus: '公車：搭乘 20、32、46 路公車至「信義行政中心站」',
            driveLines: [
                '國道一號：下「信義交流道」，沿信義路直行約3公里',
                '國道三號：下「木柵交流道」，接信義快速道路'
            ]
        },
        parking: {
            location: 'B1-B3 地下停車場',
            feeGuest: '住宿客人：每日 NT$ 200（可無限次進出）',
            feeTemp: '臨時停車：每小時 NT$ 50',
            openTime: '24 小時',
            note: '⚠️ 停車位有限，建議提前預約'
        },
        notes: {
            checkinTime: '下午 3:00 後',
            checkoutTime: '上午 11:30 前',
            reminders: [
                '請攜帶身分證件辦理入住手續',
                '房間內禁止吸菸，違者將收取清潔費 NT$ 3,000',
                '請保持安靜，避免影響其他住客',
                '貴重物品請妥善保管，建議使用房間保險箱',
                '如需延遲退房，請提前告知櫃檯'
            ]
        }
    };
}

function generateCheckinTransportHtmlFromForm(data) {
    const address = (data.address || '{{hotelAddress}}').trim();
    const mrt = (data.mrt || '').trim();
    const bus = (data.bus || '').trim();
    const driveLines = Array.isArray(data.driveLines) ? data.driveLines : _splitLines(data.driveLines);

    const transitItems = [mrt, bus].filter(Boolean).map(t => `<li>${escapeHtml(t)}</li>`).join('');
    const driveItems = driveLines.filter(Boolean).map(t => `<li>${escapeHtml(t)}</li>`).join('');

    return `<p style="margin: 0 0 10px 0; font-size: 15px; color: #444; line-height: 1.6;"><strong>地址：</strong>${escapeHtml(address)}</p>
<p style="margin: 0 0 10px 0; font-size: 15px; color: #444; line-height: 1.6;"><strong>大眾運輸：</strong></p>
<ul style="margin: 0 0 15px 0; padding-left: 25px; font-size: 15px; color: #444; line-height: 1.8;">
    ${transitItems || '<li>（請填寫交通資訊）</li>'}
</ul>
<p style="margin: 0 0 10px 0; font-size: 15px; color: #444; line-height: 1.6;"><strong>自行開車：</strong></p>
<ul style="margin: 0; padding-left: 25px; font-size: 15px; color: #444; line-height: 1.8;">
    ${driveItems || '<li>（請填寫開車路線）</li>'}
</ul>`;
}

function generateCheckinParkingHtmlFromForm(data) {
    const location = (data.location || '').trim();
    const feeGuest = (data.feeGuest || '').trim();
    const feeTemp = (data.feeTemp || '').trim();
    const openTime = (data.openTime || '').trim();
    const note = (data.note || '').trim();

    const feeItems = [feeGuest, feeTemp].filter(Boolean).map(t => `<li>${escapeHtml(t)}</li>`).join('');

    return `<p style="margin: 0 0 10px 0; font-size: 15px; color: #444; line-height: 1.6;"><strong>停車場位置：</strong>${escapeHtml(location || '（請填寫停車場位置）')}</p>
<p style="margin: 0 0 10px 0; font-size: 15px; color: #444; line-height: 1.6;"><strong>停車費用：</strong></p>
<ul style="margin: 0 0 15px 0; padding-left: 25px; font-size: 15px; color: #444; line-height: 1.8;">
    ${feeItems || '<li>（請填寫停車費用）</li>'}
</ul>
<p style="margin: 0 0 10px 0; font-size: 15px; color: #444; line-height: 1.6;"><strong>停車場開放時間：</strong>${escapeHtml(openTime || '（請填寫開放時間）')}</p>
${note ? `<p style="margin: 15px 0 0 0; font-size: 15px; color: #856404; line-height: 1.6;">${escapeHtml(note)}</p>` : ''}`;
}

function generateCheckinNotesHtmlFromForm(data) {
    const checkinTime = (data.checkinTime || '').trim();
    const checkoutTime = (data.checkoutTime || '').trim();
    const reminders = Array.isArray(data.reminders) ? data.reminders : _splitLines(data.reminders);
    const reminderItems = reminders.filter(Boolean).map(t => `<li>${escapeHtml(t)}</li>`).join('');

    return `<p style="margin: 0 0 8px 0; font-size: 15px; color: #444; line-height: 1.6;">入住時間：<strong>${escapeHtml(checkinTime || '（請填寫入住時間）')}</strong></p>
<p style="margin: 0 0 15px 0; font-size: 15px; color: #444; line-height: 1.6;">退房時間：<strong>${escapeHtml(checkoutTime || '（請填寫退房時間）')}</strong></p>
<ul style="margin: 0; padding-left: 25px; font-size: 15px; color: #444; line-height: 1.8;">
    ${reminderItems || '<li>（請填寫提醒事項）</li>'}
</ul>`;
}

function readCheckinStructuredForm() {
    const driveLines = _splitLines(_getVal('checkinTransportDriveLines'));
    const reminders = _splitLines(_getVal('checkinNotesReminderLines'));
    return {
        transport: {
            address: _getVal('checkinTransportAddress') || '{{hotelAddress}}',
            mrt: _getVal('checkinTransportMrt'),
            bus: _getVal('checkinTransportBus'),
            driveLines
        },
        parking: {
            location: _getVal('checkinParkingLocation'),
            feeGuest: _getVal('checkinParkingFeeGuest'),
            feeTemp: _getVal('checkinParkingFeeTemp'),
            openTime: _getVal('checkinParkingOpenTime'),
            note: _getVal('checkinParkingNote')
        },
        notes: {
            checkinTime: _getVal('checkinNotesCheckinTime'),
            checkoutTime: _getVal('checkinNotesCheckoutTime'),
            reminders
        }
    };
}

function populateCheckinStructuredFields(blockSettings) {
    const defaults = getDefaultCheckinStructuredData();
    const transportData = (blockSettings.transport && blockSettings.transport.data) ? blockSettings.transport.data : defaults.transport;
    const parkingData = (blockSettings.parking && blockSettings.parking.data) ? blockSettings.parking.data : defaults.parking;
    const notesData = (blockSettings.notes && blockSettings.notes.data) ? blockSettings.notes.data : defaults.notes;

    _setVal('checkinTransportAddress', transportData.address ?? defaults.transport.address);
    _setVal('checkinTransportMrt', transportData.mrt ?? defaults.transport.mrt);
    _setVal('checkinTransportBus', transportData.bus ?? defaults.transport.bus);
    _setVal('checkinTransportDriveLines', Array.isArray(transportData.driveLines) ? transportData.driveLines.join('\n') : (transportData.driveLines || defaults.transport.driveLines.join('\n')));

    _setVal('checkinParkingLocation', parkingData.location ?? defaults.parking.location);
    _setVal('checkinParkingFeeGuest', parkingData.feeGuest ?? defaults.parking.feeGuest);
    _setVal('checkinParkingFeeTemp', parkingData.feeTemp ?? defaults.parking.feeTemp);
    _setVal('checkinParkingOpenTime', parkingData.openTime ?? defaults.parking.openTime);
    _setVal('checkinParkingNote', parkingData.note ?? defaults.parking.note);

    _setVal('checkinNotesCheckinTime', notesData.checkinTime ?? defaults.notes.checkinTime);
    _setVal('checkinNotesCheckoutTime', notesData.checkoutTime ?? defaults.notes.checkoutTime);
    _setVal('checkinNotesReminderLines', Array.isArray(notesData.reminders) ? notesData.reminders.join('\n') : (notesData.reminders || defaults.notes.reminders.join('\n')));
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
    
    // 獲取並驗證模板名稱和主旨
    let templateName = document.getElementById('emailTemplateName').value.trim();
    let templateSubject = document.getElementById('emailTemplateSubject').value.trim();
    
    // 檢查並修復錯誤的模板名稱和主旨（防止 email 地址格式）
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // 如果模板名稱是 email 地址格式，使用預設名稱
    if (emailRegex.test(templateName)) {
        console.warn('⚠️ 檢測到錯誤的模板名稱格式（email 地址），使用預設名稱');
        const templateNames = {
            'payment_reminder': '匯款提醒',
            'checkin_reminder': '入住提醒',
            'feedback_request': '感謝入住',
            'booking_confirmation': '訂房確認（客戶）',
            'booking_confirmation_admin': '訂房確認（管理員）',
            'payment_completed': '付款完成確認',
            'cancel_notification': '取消通知'
        };
        templateName = templateNames[templateKey] || templateKey;
        // 更新表單欄位
        document.getElementById('emailTemplateName').value = templateName;
    }
    
    // 如果主旨是 email 地址格式，使用預設主旨
    if (emailRegex.test(templateSubject)) {
        console.warn('⚠️ 檢測到錯誤的郵件主旨格式（email 地址），使用預設主旨');
        const defaultSubjects = {
            'payment_reminder': '【重要提醒】匯款期限即將到期',
            'checkin_reminder': '【入住提醒】歡迎您明天入住',
            'feedback_request': '【感謝入住】分享您的住宿體驗',
            'booking_confirmation': '【訂房確認】您的訂房已成功',
            'booking_confirmation_admin': '【新訂房通知】{{guestName}} - {{bookingId}}',
            'payment_completed': '【訂房確認】您的訂房已成功',
            'cancel_notification': '【訂房取消通知】您的訂房已自動取消'
        };
        templateSubject = defaultSubjects[templateKey] || '郵件主旨';
        // 更新表單欄位
        document.getElementById('emailTemplateSubject').value = templateSubject;
    }
    
    // 根據當前模式獲取內容
    let content = '';
    const textarea = document.getElementById('emailTemplateContent');
    
    if (isHtmlMode) {
        // HTML 模式：直接從 textarea 獲取
        content = textarea ? textarea.value : '';
        console.log('📝 HTML 模式：從 textarea 獲取內容，長度:', content.length);
        
        // 如果 textarea 的內容不是完整 HTML，從資料庫讀取模板結構
        if (content && !content.includes('<!DOCTYPE html>') && !content.includes('<html')) {
            console.log('⚠️ HTML 模式：textarea 內容不是完整 HTML，從資料庫讀取模板結構');
            try {
                const templateResponse = await fetch(`/api/email-templates/${templateKey}`);
                const templateResult = await templateResponse.json();
                if (templateResult.success && templateResult.data && templateResult.data.content) {
                    const templateContent = templateResult.data.content;
                    // 使用模板的結構，但替換 body 內容為 textarea 的內容
                    if (templateContent.includes('<body>')) {
                        content = templateContent.replace(
                            /<body[^>]*>[\s\S]*?<\/body>/i,
                            `<body>${content}</body>`
                        );
                        console.log('✅ HTML 模式：使用資料庫模板結構，替換 body 內容');
                    } else {
                        // 如果模板沒有 body，直接使用 textarea 的內容
                        content = content;
                    }
                }
            } catch (e) {
                console.error('HTML 模式：獲取資料庫模板失敗:', e);
                // 如果失敗，直接使用 textarea 的內容（不完整，但至少保存了用戶的修改）
            }
        }
    } else {
        // 可視化模式：從 Quill 獲取 HTML
        // 由於 text-change 事件已經同步更新了 textarea，直接使用 textarea 的值
        // 這樣可以確保使用最新的內容，並且保留完整的 HTML 結構
        content = textarea ? textarea.value : (quillEditor ? quillEditor.root.innerHTML : '');
        
        console.log('📝 可視化模式：從 textarea 獲取內容（已同步），長度:', content.length);
        console.log('📝 內容預覽（前 500 字元）:', content.substring(0, 500));
        
        // 如果 textarea 的內容不是完整 HTML，從資料庫讀取模板結構
        if (content && !content.includes('<!DOCTYPE html>') && !content.includes('<html')) {
            console.log('⚠️ textarea 內容不是完整 HTML，從資料庫讀取模板結構');
            try {
                const templateResponse = await fetch(`/api/email-templates/${templateKey}`);
                const templateResult = await templateResponse.json();
                if (templateResult.success && templateResult.data && templateResult.data.content) {
                    const templateContent = templateResult.data.content;
                    // 使用模板的結構，但替換 body 內容為 Quill 的內容
                    if (templateContent.includes('<body>')) {
                        content = templateContent.replace(
                            /<body[^>]*>[\s\S]*?<\/body>/i,
                            `<body>${content}</body>`
                        );
                        console.log('✅ 使用資料庫模板結構，替換 body 內容');
                    } else {
                        // 如果模板沒有 body，直接使用 Quill 的內容
                        content = content;
                    }
                }
            } catch (e) {
                console.error('獲取資料庫模板失敗:', e);
                // 如果失敗，直接使用 Quill 的內容（不完整，但至少保存了用戶的修改）
            }
        }
        
        // 備用：如果上面的邏輯沒有獲取到內容，直接使用 Quill 的內容
        if (!content || content.trim() === '') {
            const quillHtml = quillEditor.root.innerHTML;
            console.log('⚠️ 使用備用方案：直接從 Quill 獲取內容');
            
            // 從資料庫讀取模板結構
            try {
                const templateResponse = await fetch(`/api/email-templates/${templateKey}`);
                const templateResult = await templateResponse.json();
                if (templateResult.success && templateResult.data && templateResult.data.content) {
                    const templateContent = templateResult.data.content;
                    if (templateContent.includes('<body>')) {
                        content = templateContent.replace(
                            /<body[^>]*>[\s\S]*?<\/body>/i,
                            `<body>${quillHtml}</body>`
                        );
                        console.log('✅ 使用資料庫模板結構（備用方案）');
                    } else {
                        content = quillHtml;
                    }
                } else {
                    content = quillHtml;
                }
            } catch (e) {
                console.error('獲取資料庫模板失敗（備用方案）:', e);
                content = quillHtml;
            }
        }
        
        // 如果 content 仍然為空，這不應該發生，但為了安全起見
        if (!content || content.trim() === '') {
            console.error('❌ 內容為空，使用 Quill 的內容作為最後備用方案');
            const quillHtml = quillEditor.root.innerHTML;
            // 從資料庫讀取模板結構
            try {
                const templateResponse = await fetch(`/api/email-templates/${templateKey}`);
                const templateResult = await templateResponse.json();
                if (templateResult.success && templateResult.data && templateResult.data.content) {
                    const templateContent = templateResult.data.content;
                    if (templateContent.includes('<body>')) {
                        content = templateContent.replace(
                            /<body[^>]*>[\s\S]*?<\/body>/i,
                            `<body>${quillHtml}</body>`
                        );
                    } else {
                        content = quillHtml;
                    }
                } else {
                    content = quillHtml;
                }
            } catch (e) {
                console.error('獲取資料庫模板失敗（最後備用方案）:', e);
                content = quillHtml;
            }
        }
        
        // 移除所有舊的複雜邏輯，因為 textarea 已經被同步更新了
        // 舊的複雜邏輯已移除，直接使用上面獲取的 content
        
        console.log('最終儲存內容長度:', content.length);
        console.log('最終儲存內容預覽（前 500 字元）:', content.substring(0, 500));
    }
    
    // 確保 content 不為空
    if (!content || content.trim() === '') {
        showError('郵件模板內容不能為空');
        return;
    }
    
    const data = {
        template_name: templateName,
        subject: templateSubject,
        content: content,  // 使用從編輯器獲取的內容
        is_enabled: document.getElementById('emailTemplateEnabled').checked ? 1 : 0
    };
    
    console.log('📝 準備儲存的資料:', {
        template_name: data.template_name,
        subject: data.subject,
        content_length: data.content.length,
        content_preview: data.content.substring(0, 200),
        is_enabled: data.is_enabled
    });
    
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
                } else {
                    content = originalContent;
                }
            } else {
                // 如果原始內容不是完整 HTML，從資料庫讀取模板結構
                try {
                    const templateResponse = await fetch(`/api/email-templates/${templateKey}`);
                    const templateResult = await templateResponse.json();
                    if (templateResult.success && templateResult.data && templateResult.data.content) {
                        const templateContent = templateResult.data.content;
                        if (templateContent.includes('<body>')) {
                            content = templateContent.replace(
                                /<body[^>]*>[\s\S]*?<\/body>/i,
                                `<body>${quillHtml}</body>`
                            );
                        } else {
                            content = quillHtml;
                        }
                    } else {
                        content = quillHtml;
                    }
                } catch (e) {
                    console.error('獲取資料庫模板失敗:', e);
                    content = quillHtml;
                }
            }
        }
        
        // 獲取主旨
        const subject = document.getElementById('emailTemplateSubject').value;
        
        // 獲取模板名稱
        const templateName = document.getElementById('emailTemplateName').value;
        
        // 準備請求資料
        // 重要：測試郵件應該直接使用資料庫中的完整模板內容，而不是編輯器中的部分內容
        // 這樣可以確保使用最新的優化版本（包含完整的 HTML 結構和 CSS）
        // 不發送 content，讓後端直接從資料庫讀取完整的模板內容
        const requestData = {
            email: email,
            useEditorContent: false, // 設為 false，讓後端使用資料庫中的最新完整內容
            subject: subject
            // 不發送 content，讓後端直接從資料庫讀取完整的模板內容（7873 字元）
        };
        
        console.log('📧 測試郵件：不發送編輯器內容，讓後端直接從資料庫讀取完整模板');
        
        // 如果是入住提醒郵件，不再使用區塊設定（所有內容已合併到主內容中）
        if (templateKey === 'checkin_reminder') {
            // 所有內容已合併到主郵件內容中，不需要 blockSettings
            requestData.blockSettings = null;
        }
        
        console.log('📧 發送測試郵件請求:', {
            templateKey,
            email,
            useEditorContent: false,
            subject,
            hasBlockSettings: !!requestData.blockSettings,
            note: '不發送 content，讓後端直接從資料庫讀取完整的模板內容'
        });
        
        const response = await fetch(`/api/email-templates/${templateKey}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        console.log('📧 測試郵件回應:', result);
        
        if (result.success) {
            testEmailStatus.style.display = 'block';
            testEmailStatus.style.color = '#27ae60';
            testEmailStatus.textContent = '測試郵件已發送，請檢查收件箱';
        } else {
            testEmailStatus.style.display = 'block';
            testEmailStatus.style.color = '#e74c3c';
            testEmailStatus.textContent = '發送失敗：' + (result.message || '未知錯誤');
        }
    } catch (error) {
        console.error('發送測試郵件錯誤:', error);
        testEmailStatus.style.display = 'block';
        testEmailStatus.style.color = '#e74c3c';
        testEmailStatus.textContent = '發送時發生錯誤：' + (error.message || '請稍後再試');
    } finally {
        // 恢復按鈕狀態
        testEmailBtn.disabled = false;
        testEmailBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">mail</span>發送測試郵件';
    }
}

// 移除錯誤的代碼片段 - 這些代碼不應該在這裡
// 以下是錯誤的代碼片段，已移除

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
        
        // 如果是入住提醒郵件，不再使用區塊設定（所有內容已合併到主內容中）
        let blockSettings = null;
        if (templateKey === 'checkin_reminder') {
            // 所有內容已合併到主郵件內容中，不需要 blockSettings
            blockSettings = null;
        }
        
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
                content: content,
                ...(blockSettings ? { blockSettings: blockSettings } : {})  // 如果有區塊設定，一併發送
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

// 明確綁定到 window，避免被早期佔位符覆蓋
window.sendTestEmail = sendTestEmail;

// 還原郵件模板為預設內容
async function restoreEmailTemplate() {
    const templateKey = window.currentTemplateKey;
    if (!templateKey) {
        showError('無法識別當前模板，請重新開啟編輯視窗');
        return;
    }
    
    if (!confirm('確定要還原為預設範本嗎？此操作將覆蓋目前的內容，且無法復原。')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/email-templates/${templateKey}/default`, {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            const defaultTemplate = result.data;
            
            // 更新表單中的內容
            const nameInput = document.getElementById('emailTemplateName');
            const subjectInput = document.getElementById('emailTemplateSubject');
            const contentTextarea = document.getElementById('emailTemplateContent');
            
            if (nameInput) nameInput.value = defaultTemplate.name;
            if (subjectInput) subjectInput.value = defaultTemplate.subject;
            if (contentTextarea) {
                contentTextarea.value = defaultTemplate.content;
                
                // 如果使用 Quill 編輯器，也需要更新
                // 安全檢查：確保 quillEditor 和 isHtmlMode 存在
                try {
                    const quillEditorExists = typeof quillEditor !== 'undefined' && quillEditor !== null;
                    const isHtmlModeExists = typeof isHtmlMode !== 'undefined';
                    const isHtmlModeValue = isHtmlModeExists ? isHtmlMode : true; // 預設為 HTML 模式
                    
                    if (quillEditorExists && !isHtmlModeValue) {
                        // 提取 body 內容
                        let bodyContent = defaultTemplate.content;
                        if (bodyContent.includes('<body>')) {
                            const bodyMatch = bodyContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                            if (bodyMatch && bodyMatch[1]) {
                                bodyContent = bodyMatch[1];
                            }
                        }
                        quillEditor.root.innerHTML = bodyContent;
                    }
                } catch (e) {
                    console.warn('更新 Quill 編輯器時發生錯誤（可能未初始化）:', e);
                    // 忽略錯誤，因為可能是在 HTML 模式下，不需要更新 Quill
                }
                
                // 更新預覽
                try {
                    const isPreviewVisibleExists = typeof isPreviewVisible !== 'undefined';
                    if (isPreviewVisibleExists && isPreviewVisible && typeof refreshEmailPreview === 'function') {
                        setTimeout(() => refreshEmailPreview(), 100);
                    }
                } catch (e) {
                    console.warn('更新預覽時發生錯誤:', e);
                }
            }
            
            showSuccess('已還原為預設範本內容，請點擊「儲存」按鈕將變更儲存到資料庫');
        } else {
            showError('還原失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('還原郵件模板錯誤:', error);
        showError('還原失敗：' + error.message);
    }
}

// 明確綁定到 window
window.restoreEmailTemplate = restoreEmailTemplate;

// 立即暴露 sendTestEmail 到全局作用域（確保在函數定義後立即執行）
// 強制覆蓋預先聲明的臨時函數
// 使用立即執行的 IIFE，確保在函數定義後立即執行
(function() {
    'use strict';
    // 立即設置，不等待
    if (typeof sendTestEmail === 'function') {
        // 強制刪除舊的臨時函數（如果存在）
        try {
            delete window.sendTestEmail;
        } catch (e) {
            // 忽略刪除錯誤
        }
        
        // 方法 1: 直接賦值（多次確保成功）
        window.sendTestEmail = sendTestEmail;
        window.sendTestEmail = sendTestEmail; // 再次設置確保成功
        
        // 方法 2: 使用 defineProperty 強制覆蓋（確保可配置）
        try {
            Object.defineProperty(window, 'sendTestEmail', {
                value: sendTestEmail,
                writable: true,
                configurable: true,
                enumerable: true
            });
        } catch (e) {
            // 如果失敗，再次直接賦值
            window.sendTestEmail = sendTestEmail;
        }
        
        // 確認設置成功
        const currentFn = window.sendTestEmail;
        const currentFnString = currentFn && typeof currentFn === 'function' ? currentFn.toString() : '';
        const isStillTemporary = currentFnString.includes('尚未載入') || 
                                 currentFnString.includes('功能載入中');
        
        if (isStillTemporary && currentFnString.length < 200) {
            console.error('❌ sendTestEmail 設置失敗，仍然是臨時函數，長度:', currentFnString.length);
            console.error('臨時函數內容:', currentFnString);
        } else {
            const fnLength = sendTestEmail.toString().length;
            console.log('✅ sendTestEmail 已立即設置到 window，長度:', fnLength);
            console.log('✅ 確認 window.sendTestEmail 已正確覆蓋臨時函數');
        }
    } else {
        console.error('❌ sendTestEmail 函數尚未定義，無法立即設置');
    }
})();

// 使用立即執行的代碼塊進行詳細檢查和設置
{
    'use strict';
    console.log('🔧 開始導出 sendTestEmail 函數...');
    
    // 確保 sendTestEmail 函數已定義
    if (typeof sendTestEmail !== 'function') {
        console.error('❌ sendTestEmail 函數尚未定義，無法導出');
    } else {
        console.log('✅ sendTestEmail 函數已定義，長度:', sendTestEmail.toString().length);
        
        // 檢查當前 window.sendTestEmail 是否為臨時函數
        const currentWindowFn = window.sendTestEmail;
        const currentFnString = currentWindowFn && typeof currentWindowFn === 'function' ? currentWindowFn.toString() : '';
        const isTemporaryFunction = currentWindowFn && 
                                     typeof currentWindowFn === 'function' &&
                                     (currentFnString.includes('尚未載入') || 
                                      currentFnString.includes('功能載入中')) &&
                                     currentFnString.length < 200;
        
        if (isTemporaryFunction) {
            console.log('🔄 檢測到臨時函數，準備覆蓋...');
            console.log('臨時函數內容:', currentFnString.substring(0, 100));
            console.log('臨時函數長度:', currentFnString.length);
        } else if (currentWindowFn === sendTestEmail) {
            console.log('✅ window.sendTestEmail 已經是正確的函數');
        } else {
            // 強制覆蓋：無論當前是什麼，都要設置為正確的函數
            // 方法 1: 先刪除（如果可能）
            try {
                if (isTemporaryFunction) {
                    delete window.sendTestEmail;
                    console.log('✅ 已刪除臨時函數');
                }
            } catch (e) {
                console.warn('⚠️ 刪除舊函數時發生錯誤（繼續嘗試設置）:', e);
            }
            
            // 方法 2: 直接賦值（多次確保成功）
            window.sendTestEmail = sendTestEmail;
            window.sendTestEmail = sendTestEmail; // 再次設置確保成功
            console.log('✅ 已設置 window.sendTestEmail = sendTestEmail');
            
            // 方法 3: 使用 defineProperty 強制覆蓋（確保可配置）
            try {
                Object.defineProperty(window, 'sendTestEmail', {
                    value: sendTestEmail,
                    writable: true,
                    configurable: true,
                    enumerable: true
                });
                console.log('✅ 已使用 defineProperty 設置');
            } catch (e) {
                console.warn('⚠️ defineProperty 失敗，使用直接賦值:', e);
                // 如果 defineProperty 失敗，再次直接賦值
                window.sendTestEmail = sendTestEmail;
            }
        }
    }
}

// 再次確認設置（使用 IIFE 確保在下一輪事件循環中也能正確設置）
(function exportSendTestEmailIIFE() {
    'use strict';
    // 延遲一點點，確保所有同步代碼都已執行
    setTimeout(function() {
        if (typeof sendTestEmail === 'function') {
            const currentFn = window.sendTestEmail;
            const isTemporary = currentFn && 
                               typeof currentFn === 'function' &&
                               (currentFn.toString().includes('尚未載入') || 
                                currentFn.toString().includes('功能載入中'));
            if (isTemporary || currentFn !== sendTestEmail) {
                console.log('🔄 IIFE: 檢測到函數需要更新，重新設置...');
                window.sendTestEmail = sendTestEmail;
                Object.defineProperty(window, 'sendTestEmail', {
                    value: sendTestEmail,
                    writable: true,
                    configurable: true,
                    enumerable: true
                });
                console.log('✅ IIFE: sendTestEmail 已重新設置');
            }
        }
    }, 0);
})();


// 重置單個郵件模板為預設文字樣式（從模板卡片中調用，保留以備將來需要）
async function resetEmailTemplateToDefault(templateKey, templateName) {
    if (!confirm(`確定要將郵件模板「${templateName}」重置為預設的文字樣式嗎？此操作將覆蓋現有的模板內容。`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/email-templates/reset-to-default', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ templateKey })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`✅ ${result.message}`);
            
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
// toggleEditorMode 已在檔案前面定義為 window.toggleEditorMode，此處無需重複定義

// handleTextareaInput 已在檔案前面定義為 window.handleTextareaInput，此處無需重複定義

// 插入變數到編輯器
function insertVariable(variable) {
    // ✅ 簡化版：直接插入到 textarea
    const textarea = document.getElementById('emailTemplateContent');
    if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.substring(0, start) + variable + text.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
    }
}

// toggleEmailPreview 已在檔案前面定義為 window.toggleEmailPreview，此處無需重複定義

// refreshEmailPreview 已在檔案前面定義為 window.refreshEmailPreview，此處無需重複定義
// 保留原函數定義以備參考，但實際使用的是前面的版本
function refreshEmailPreview_old() {
    const previewContent = document.getElementById('emailPreviewContent');
    if (!previewContent) return;
    
    console.log('🔄 更新預覽，當前樣式:', currentEmailStyle);
    
    // 如果不是 HTML 模式，先將 Quill 的內容同步到 textarea（保留結構）
    if (!isHtmlMode && quillEditor) {
        const quillHtml = quillEditor.root.innerHTML;
        const textarea = document.getElementById('emailTemplateContent');
        const originalContent = textarea.value;
        
        // 如果原始內容是完整 HTML，需要更新 body 內的 .content div 內容（不是整個 .container）
        if (originalContent && (originalContent.includes('<!DOCTYPE html>') || originalContent.includes('<html'))) {
            if (originalContent.includes('<body>')) {
                const bodyMatch = originalContent.match(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i);
                if (bodyMatch) {
                    const bodyContent = bodyMatch[2];
                    
                    // 優先找到 .content div，只替換 .content div 內的內容，保留 .header
                    const contentDivStartRegex = /<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>/i;
                    const contentStartMatch = bodyContent.match(contentDivStartRegex);
                    
                    if (contentStartMatch) {
                        const startIndex = contentStartMatch.index;
                        const startTag = contentStartMatch[0];
                        const afterStartTag = bodyContent.substring(startIndex + startTag.length);
                        
                        // 計算嵌套的 div 層級，找到對應的結束標籤
                        let divCount = 1;
                        let currentIndex = 0;
                        let endIndex = -1;
                        
                        while (currentIndex < afterStartTag.length && divCount > 0) {
                            const openDiv = afterStartTag.indexOf('<div', currentIndex);
                            const closeDiv = afterStartTag.indexOf('</div>', currentIndex);
                            
                            if (closeDiv === -1) break;
                            
                            if (openDiv !== -1 && openDiv < closeDiv) {
                                divCount++;
                                currentIndex = openDiv + 4;
                            } else {
                                divCount--;
                                if (divCount === 0) {
                                    endIndex = closeDiv;
                                    break;
                                }
                                currentIndex = closeDiv + 6;
                            }
                        }
                        
                        if (endIndex !== -1) {
                            // 找到了對應的結束標籤，只替換 .content div 內的內容
                            const beforeContent = bodyContent.substring(0, startIndex + startTag.length);
                            const afterContent = bodyContent.substring(startIndex + startTag.length + endIndex);
                            const newBodyContent = beforeContent + quillHtml + afterContent;
                            
                            textarea.value = originalContent.replace(
                                /<body[^>]*>[\s\S]*?<\/body>/i,
                                bodyMatch[1] + newBodyContent + bodyMatch[3]
                            );
                            console.log('✅ 已同步 Quill 內容到 textarea（只替換 .content div 內的內容，保留 .header）');
                        } else {
                            // 如果無法找到結束標籤，嘗試使用 .container 的方式
                            console.warn('⚠️ 無法找到 .content div 的結束標籤，嘗試使用 .container 方式');
                            const containerStartIndex = bodyContent.search(/<div[^>]*class\s*=\s*["']container["'][^>]*>/i);
                            if (containerStartIndex !== -1) {
                                const containerStartTagMatch = bodyContent.substring(containerStartIndex).match(/(<div[^>]*class\s*=\s*["']container["'][^>]*>)/i);
                                if (containerStartTagMatch) {
                                    const containerStartTag = containerStartTagMatch[1];
                                    const containerStartPos = containerStartIndex + containerStartTagMatch[0].length;
                                    
                                    let divCount = 1;
                                    let pos = containerStartPos;
                                    let containerEndPos = -1;
                                    
                                    while (pos < bodyContent.length && divCount > 0) {
                                        const nextOpenDiv = bodyContent.indexOf('<div', pos);
                                        const nextCloseDiv = bodyContent.indexOf('</div>', pos);
                                        
                                        if (nextCloseDiv === -1) {
                                            containerEndPos = bodyContent.length;
                                            break;
                                        }
                                        
                                        if (nextOpenDiv !== -1 && nextOpenDiv < nextCloseDiv) {
                                            divCount++;
                                            pos = nextOpenDiv + 4;
                                        } else {
                                            divCount--;
                                            if (divCount === 0) {
                                                containerEndPos = nextCloseDiv;
                                                break;
                                            }
                                            pos = nextCloseDiv + 6;
                                        }
                                    }
                                    
                                    if (containerEndPos !== -1) {
                                        const beforeContainer = bodyContent.substring(0, containerStartIndex);
                                        const afterContainer = bodyContent.substring(containerEndPos + 6);
                                        const newBodyContent = beforeContainer + containerStartTag + quillHtml + '</div>' + afterContainer;
                                        
                                        textarea.value = originalContent.replace(
                                            /<body[^>]*>[\s\S]*?<\/body>/i,
                                            bodyMatch[1] + newBodyContent + bodyMatch[3]
                                        );
                                        console.log('✅ 已同步 Quill 內容到 textarea（使用 .container 方式）');
                                    }
                                }
                            }
                        }
                    } else {
                        // 如果沒有 .content div，嘗試使用 .container 的方式
                        console.warn('⚠️ 未找到 .content div，嘗試使用 .container 方式');
                        const containerStartIndex = bodyContent.search(/<div[^>]*class\s*=\s*["']container["'][^>]*>/i);
                        if (containerStartIndex !== -1) {
                            const containerStartTagMatch = bodyContent.substring(containerStartIndex).match(/(<div[^>]*class\s*=\s*["']container["'][^>]*>)/i);
                            if (containerStartTagMatch) {
                                const containerStartTag = containerStartTagMatch[1];
                                const containerStartPos = containerStartIndex + containerStartTagMatch[0].length;
                                
                                let divCount = 1;
                                let pos = containerStartPos;
                                let containerEndPos = -1;
                                
                                while (pos < bodyContent.length && divCount > 0) {
                                    const nextOpenDiv = bodyContent.indexOf('<div', pos);
                                    const nextCloseDiv = bodyContent.indexOf('</div>', pos);
                                    
                                    if (nextCloseDiv === -1) {
                                        containerEndPos = bodyContent.length;
                                        break;
                                    }
                                    
                                    if (nextOpenDiv !== -1 && nextOpenDiv < nextCloseDiv) {
                                        divCount++;
                                        pos = nextOpenDiv + 4;
                                    } else {
                                        divCount--;
                                        if (divCount === 0) {
                                            containerEndPos = nextCloseDiv;
                                            break;
                                        }
                                        pos = nextCloseDiv + 6;
                                    }
                                }
                                
                                if (containerEndPos !== -1) {
                                    const beforeContainer = bodyContent.substring(0, containerStartIndex);
                                    const afterContainer = bodyContent.substring(containerEndPos + 6);
                                    const newBodyContent = beforeContainer + containerStartTag + quillHtml + '</div>' + afterContainer;
                                    
                                    textarea.value = originalContent.replace(
                                        /<body[^>]*>[\s\S]*?<\/body>/i,
                                        bodyMatch[1] + newBodyContent + bodyMatch[3]
                                    );
                                    console.log('✅ 已同步 Quill 內容到 textarea（使用 .container 方式）');
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 始終從 textarea 獲取完整的原始 HTML（包含完整結構）
    const fullHtml = document.getElementById('emailTemplateContent').value;
    let bodyContent = '';
    
    // 從完整 HTML 中提取 body 內容
    if (fullHtml.includes('<body>')) {
        const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            bodyContent = bodyMatch[1];
        } else {
            bodyContent = fullHtml;
        }
    } else if (fullHtml.includes('<!DOCTYPE html>') || fullHtml.includes('<html')) {
        const htmlMatch = fullHtml.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
        if (htmlMatch) {
            bodyContent = htmlMatch[1].replace(/<head[^>]*>[\s\S]*?<\/head>/i, '').trim();
        } else {
            bodyContent = fullHtml;
        }
    } else {
        bodyContent = fullHtml;
    }
    
    // 移除所有 style 標籤和 script 標籤
    bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    bodyContent = bodyContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    
    // 檢查內容結構
    console.log('📋 提取的內容前 500 字元:', bodyContent.substring(0, 500));
    console.log('📋 內容是否包含 .header:', bodyContent.includes('class="header') || bodyContent.includes("class='header"));
    console.log('📋 內容是否包含 .container:', bodyContent.includes('class="container') || bodyContent.includes("class='container"));
    
    // 提取 .container 內的內容（處理嵌套的 div）
    // 使用智能方法找到 .container 的完整範圍
    const containerStartIndex = bodyContent.search(/<div[^>]*class\s*=\s*["']container["'][^>]*>/i);
    if (containerStartIndex !== -1) {
        // 找到開始標籤
        const containerStartTagMatch = bodyContent.substring(containerStartIndex).match(/(<div[^>]*class\s*=\s*["']container["'][^>]*>)/i);
        if (containerStartTagMatch) {
            const containerStartPos = containerStartIndex + containerStartTagMatch[0].length;
            
            // 計算嵌套的 div 數量來找到正確的結束位置
            let divCount = 1;
            let pos = containerStartPos;
            let containerEndPos = -1;
            
            while (pos < bodyContent.length && divCount > 0) {
                const nextOpenDiv = bodyContent.indexOf('<div', pos);
                const nextCloseDiv = bodyContent.indexOf('</div>', pos);
                
                if (nextCloseDiv === -1) {
                    containerEndPos = bodyContent.length;
                    break;
                }
                
                if (nextOpenDiv !== -1 && nextOpenDiv < nextCloseDiv) {
                    divCount++;
                    pos = nextOpenDiv + 4;
                } else {
                    divCount--;
                    if (divCount === 0) {
                        containerEndPos = nextCloseDiv;
                        break;
                    }
                    pos = nextCloseDiv + 6;
                }
            }
            
            if (containerEndPos !== -1) {
                // 提取 .container 內容後，需要進一步提取 .content div 內的實際內容
                const containerContent = bodyContent.substring(containerStartPos, containerEndPos);
                
                // 嘗試提取 .content div 內的內容
                const contentDivStartRegex = /<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>/i;
                const contentStartMatch = containerContent.match(contentDivStartRegex);
                
                if (contentStartMatch) {
                    const contentStartIndex = contentStartMatch.index;
                    const contentStartTag = contentStartMatch[0];
                    const afterContentStart = containerContent.substring(contentStartIndex + contentStartTag.length);
                    
                    // 計算嵌套的 div 層級，找到 .content div 的結束標籤
                    let divCount = 1;
                    let pos = 0;
                    let contentEndPos = -1;
                    
                    while (pos < afterContentStart.length && divCount > 0) {
                        const openDiv = afterContentStart.indexOf('<div', pos);
                        const closeDiv = afterContentStart.indexOf('</div>', pos);
                        
                        if (closeDiv === -1) break;
                        
                        if (openDiv !== -1 && openDiv < closeDiv) {
                            divCount++;
                            pos = openDiv + 4;
                        } else {
                            divCount--;
                            if (divCount === 0) {
                                contentEndPos = closeDiv;
                                break;
                            }
                            pos = closeDiv + 6;
                        }
                    }
                    
                    if (contentEndPos !== -1) {
                        // 提取 .content div 內的實際內容，但保留 .header
                        const contentInner = afterContentStart.substring(0, contentEndPos);
                        const headerMatch = containerContent.match(/(<div[^>]*class\s*=\s*["'][^"']*header[^"']*["'][^>]*>[\s\S]*?<\/div>)/i);
                        const headerHtml = headerMatch ? headerMatch[1] : '';
                        
                        bodyContent = headerHtml + contentStartTag + contentInner + '</div>';
                        console.log('✅ 已提取 .container 內容，並提取 .content div 內的實際內容，長度:', bodyContent.length);
                        console.log('📋 提取的內容前 300 字元:', bodyContent.substring(0, 300));
                    } else {
                        // 如果無法找到 .content div 的結束標籤，使用整個 container 內容
                        bodyContent = containerContent;
                        console.log('⚠️ 未找到 .content div 的結束標籤，使用整個 .container 內容');
                    }
                } else {
                    // 如果沒有 .content div，使用整個 container 內容
                    bodyContent = containerContent;
                    console.log('⚠️ 未找到 .content div，使用整個 .container 內容');
                }
            } else {
                console.log('⚠️ 未找到 .container 的結束標籤');
            }
        }
    } else {
        console.log('⚠️ 未找到 .container，使用原始內容');
    }
    
    // 檢查內容是否包含 .header 和 .content 結構
    const hasHeader = bodyContent.includes('class="header') || bodyContent.includes("class='header");
    const hasContent = bodyContent.includes('class="content') || bodyContent.includes("class='content");
    
    console.log('📋 檢查結構 - hasHeader:', hasHeader, 'hasContent:', hasContent);
    
    // 如果沒有完整的結構，嘗試從原始 HTML 中提取結構或自動重建
    if (!hasHeader || !hasContent) {
        console.log('⚠️ 內容缺少 .header 或 .content 結構，嘗試重建');
        const fullHtml = document.getElementById('emailTemplateContent').value;
        
        // 從原始 HTML 中提取 .header 和 .content 的結構
        let headerHtml = '';
        let contentHtml = '';
        let contentStartTag = '';
        
        if (fullHtml.includes('<body>')) {
            const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            if (bodyMatch) {
                const originalBody = bodyMatch[1];
                const containerMatch = originalBody.match(/<div[^>]*class\s*=\s*["']container["'][^>]*>([\s\S]*?)<\/div>/i);
                if (containerMatch) {
                    const originalContainerContent = containerMatch[1];
                    // 檢查原始內容是否有 .header 和 .content
                    const originalHeaderMatch = originalContainerContent.match(/(<div[^>]*class\s*=\s*["']header["'][^>]*>[\s\S]*?<\/div>)/i);
                    
                    // 使用更智能的方法提取 .content（處理嵌套的 div）
                    const contentStartIndex = originalContainerContent.search(/<div[^>]*class\s*=\s*["']content["'][^>]*>/i);
                    if (contentStartIndex !== -1) {
                        // 找到開始標籤
                        const contentStartTagMatch = originalContainerContent.substring(contentStartIndex).match(/(<div[^>]*class\s*=\s*["']content["'][^>]*>)/i);
                        if (contentStartTagMatch) {
                            contentStartTag = contentStartTagMatch[1];
                            const contentStartPos = contentStartIndex + contentStartTagMatch[0].length;
                            
                            // 從開始標籤後開始，計算嵌套的 div 數量來找到正確的結束位置
                            let divCount = 1; // 已經有一個開始的 <div class="content">
                            let pos = contentStartPos;
                            let contentEndPos = -1;
                            
                            while (pos < originalContainerContent.length && divCount > 0) {
                                const nextOpenDiv = originalContainerContent.indexOf('<div', pos);
                                const nextCloseDiv = originalContainerContent.indexOf('</div>', pos);
                                
                                if (nextCloseDiv === -1) {
                                    // 沒有找到結束標籤，使用到字符串末尾
                                    contentEndPos = originalContainerContent.length;
                                    break;
                                }
                                
                                if (nextOpenDiv !== -1 && nextOpenDiv < nextCloseDiv) {
                                    // 先遇到 <div，增加計數
                                    divCount++;
                                    pos = nextOpenDiv + 4; // 跳過 '<div'
                                } else {
                                    // 先遇到 </div>，減少計數
                                    divCount--;
                                    if (divCount === 0) {
                                        contentEndPos = nextCloseDiv;
                                        break;
                                    }
                                    pos = nextCloseDiv + 6; // 跳過 '</div>'
                                }
                            }
                            
                            if (contentEndPos !== -1) {
                                contentHtml = originalContainerContent.substring(contentStartPos, contentEndPos);
                                console.log('✅ 從原始 HTML 提取到 .content 結構，內容長度:', contentHtml.length);
                                console.log('📋 提取的 .content 內容前 200 字元:', contentHtml.substring(0, 200));
                            }
                        }
                    }
                    
                    if (originalHeaderMatch) {
                        headerHtml = originalHeaderMatch[1];
                        console.log('✅ 從原始 HTML 提取到 .header 結構，長度:', headerHtml.length);
                    }
                }
            }
        }
        
        // 如果從原始 HTML 提取到了完整的結構，使用原始結構
        if (headerHtml && contentStartTag && contentHtml) {
            // 使用原始結構，但將 Quill 編輯的內容合併進去
            // 檢查 bodyContent 是否包含實際內容（不只是 header 或空白）
            let cleanedBodyContent = bodyContent.replace(/<div[^>]*class\s*=\s*["']header["'][^>]*>[\s\S]*?<\/div>/i, '').trim();
            
            // 移除可能的空白標籤和空白字符
            cleanedBodyContent = cleanedBodyContent.replace(/^\s*<div[^>]*class\s*=\s*["']content["'][^>]*>/i, '').replace(/<\/div>\s*$/i, '').trim();
            
            // 檢查是否有實際的文字內容（不只是 HTML 標籤）
            const textContent = cleanedBodyContent.replace(/<[^>]+>/g, '').trim();
            
            // 優先使用 Quill 編輯器中的內容（bodyContent），因為這是最新的編輯內容
            // 但如果 bodyContent 為空或太短，則使用原始的 contentHtml
            let actualContent = cleanedBodyContent;
            
            // 檢查 bodyContent 是否有實際內容
            if (cleanedBodyContent.length < 50 || textContent.length < 5) {
                // 如果 bodyContent 太短或沒有實際內容，使用原始的 contentHtml
                actualContent = contentHtml;
                console.log('⚠️ bodyContent 太短或沒有實際內容，使用原始的 contentHtml');
            } else {
                console.log('✅ 使用 Quill 編輯器中的內容（bodyContent）');
            }
            
            console.log('📋 bodyContent 清理後長度:', cleanedBodyContent.length);
            console.log('📋 bodyContent 文字內容長度:', textContent.length);
            console.log('📋 原始 contentHtml 長度:', contentHtml.length);
            console.log('📋 將使用的實際內容長度:', actualContent.length);
            console.log('📋 將使用的實際內容前 300 字元:', actualContent.substring(0, 300));
            
            bodyContent = headerHtml + contentStartTag + actualContent + '</div>';
            console.log('✅ 使用原始 HTML 結構，合併編輯內容，新內容長度:', bodyContent.length);
        } else {
            // 如果從原始 HTML 提取失敗，自動創建結構
            if (!headerHtml) {
                // 先檢查 bodyContent 中是否已經有 .header div（可能在 .container 內）
                const existingHeaderMatch = bodyContent.match(/(<div[^>]*class\s*=\s*["'][^"']*header[^"']*["'][^>]*>[\s\S]*?<\/div>)/i);
                
                if (existingHeaderMatch) {
                    // 如果已經有 .header div，使用它並從 bodyContent 中移除
                    headerHtml = existingHeaderMatch[1];
                    bodyContent = bodyContent.replace(/(<div[^>]*class\s*=\s*["'][^"']*header[^"']*["'][^>]*>[\s\S]*?<\/div>)/i, '');
                    console.log('✅ 從 bodyContent 中提取到 .header 結構');
                } else {
                    // 檢查內容中是否有標題（h1），但只在 .header div 內查找，不要從 .content div 內提取
                    // 先移除可能的 .content div 內容，只檢查結構部分
                    const structurePart = bodyContent.replace(/<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>[\s\S]*?<\/div>/i, '');
                    const titleMatch = structurePart.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                    
                    if (titleMatch) {
                        headerHtml = `<div class="header"><h1>${titleMatch[1]}</h1></div>`;
                        // 只從結構部分移除標題，不要影響 .content div 內的內容
                        bodyContent = bodyContent.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '');
                        console.log('✅ 自動創建 .header 結構（從結構部分提取標題）');
                    } else {
                        // 如果沒有標題，根據模板類型創建默認標題
                        const form = document.getElementById('emailTemplateForm');
                        const templateKey = form ? form.dataset.templateKey : null;
                        let defaultTitle = '郵件';
                        if (templateKey === 'checkin_reminder') {
                            defaultTitle = '入住提醒';
                        } else if (templateKey === 'payment_reminder') {
                            defaultTitle = '匯款期限提醒';
                        } else if (templateKey === 'feedback_request') {
                            defaultTitle = '感謝您的入住';
                        } else if (templateKey === 'booking_confirmation') {
                            defaultTitle = '訂房確認成功';
                        }
                        headerHtml = `<div class="header"><h1>🏨 ${defaultTitle}</h1></div>`;
                        console.log('✅ 創建默認 .header 結構:', defaultTitle);
                    }
                }
            } else {
                // 如果提取到了 header，但 bodyContent 可能還包含 header，需要移除
                // 只移除 .header div，不要移除 .content div 內的文字
                bodyContent = bodyContent.replace(/(<div[^>]*class\s*=\s*["'][^"']*header[^"']*["'][^>]*>[\s\S]*?<\/div>)/i, '');
                console.log('✅ 已移除 bodyContent 中的重複 header');
            }
            
            if (!contentStartTag) {
                contentStartTag = '<div class="content">';
                console.log('✅ 創建 .content 開始標籤');
            }
            
            // 重建完整的結構
            bodyContent = headerHtml + contentStartTag + bodyContent + '</div>';
            console.log('✅ 已重建 .header 和 .content 結構，新內容長度:', bodyContent.length);
        }
    }
    
    // 無論如何都使用當前選擇的樣式包裝內容
    let htmlContent = wrapEmailContent(bodyContent);
    
    console.log('📧 包裝後的 HTML 長度:', htmlContent.length);
    console.log('📧 使用的樣式:', currentEmailStyle);
    
    // 替換變數為範例資料
    htmlContent = replaceEmailVariables(htmlContent);
    
    // 使用 iframe 來顯示預覽，確保樣式完全隔離
    const iframe = previewContent;
    
    // 確保 iframe 已載入
    if (!iframe.contentDocument && !iframe.contentWindow) {
        console.error('❌ iframe 未準備好');
        return;
    }
    
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const iframeWin = iframe.contentWindow;
    
    // 完全清除 iframe 內容並重新寫入
    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();
    
    // 強制重新計算樣式
    if (iframeWin) {
        iframeWin.location.reload = function() {}; // 防止重新載入
    }
    
    // 驗證樣式是否正確應用
    setTimeout(() => {
        try {
            const styleElement = iframeDoc.querySelector('style');
            if (styleElement) {
                const styleText = styleElement.textContent || styleElement.innerHTML;
                console.log('✅ iframe 內的樣式長度:', styleText.length);
                console.log('✅ iframe 內的樣式前 200 字元:', styleText.substring(0, 200));
                
                // 檢查是否有正確的樣式類
                const container = iframeDoc.querySelector('.container');
                const header = iframeDoc.querySelector('.header');
                const body = iframeDoc.querySelector('body');
                
                if (container && iframeWin) {
                    const computedStyle = iframeWin.getComputedStyle(container);
                    const headerStyle = header ? iframeWin.getComputedStyle(header) : null;
                    const bodyStyle = body ? iframeWin.getComputedStyle(body) : null;
                    
                    console.log('✅ .container 的實際樣式:', {
                        maxWidth: computedStyle.maxWidth,
                        margin: computedStyle.margin,
                        padding: computedStyle.padding,
                        backgroundColor: computedStyle.backgroundColor,
                        borderRadius: computedStyle.borderRadius
                    });
                    
                    if (headerStyle) {
                        console.log('✅ .header 的實際樣式:', {
                            backgroundColor: headerStyle.backgroundColor,
                            color: headerStyle.color,
                            padding: headerStyle.padding,
                            borderRadius: headerStyle.borderRadius
                        });
                    } else {
                        console.warn('⚠️ 找不到 .header 元素');
                        // 檢查 iframe 內的所有元素
                        const allDivs = iframeDoc.querySelectorAll('div');
                        console.log('📋 iframe 內的所有 div 元素數量:', allDivs.length);
                        allDivs.forEach((div, index) => {
                            if (index < 5) { // 只顯示前 5 個
                                console.log(`📋 div[${index}]:`, div.className, div.outerHTML.substring(0, 100));
                            }
                        });
                    }
                    
                    if (bodyStyle) {
                        console.log('✅ body 的實際樣式:', {
                            backgroundColor: bodyStyle.backgroundColor,
                            fontFamily: bodyStyle.fontFamily
                        });
                    }
                } else {
                    console.warn('⚠️ 找不到 .container 元素');
                }
            } else {
                console.error('❌ iframe 內找不到 style 標籤');
            }
        } catch (error) {
            console.error('❌ 檢查樣式時發生錯誤:', error);
        }
    }, 200);
    
    console.log('✅ 預覽已更新');
}

// 包裝郵件內容為完整 HTML
function wrapEmailContent(content) {
    const style = getEmailStyleCSS(currentEmailStyle);
    console.log('🎨 獲取的樣式 CSS 長度:', style.length);
    console.log('🎨 樣式 CSS 前 200 字元:', style.substring(0, 200));
    
    // 確保內容不包含任何現有的 style 標籤，避免樣式衝突
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // 移除所有內聯樣式（style 屬性），讓樣式完全由 CSS 類控制
    content = content.replace(/\s+style\s*=\s*["'][^"']*["']/gi, '');
    
    const wrappedHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>${style}</style>
</head>
<body>
    <div class="container">
        ${content}
    </div>
</body>
</html>`;
    
    console.log('📦 包裝後的 HTML 前 500 字元:', wrappedHtml.substring(0, 500));
    return wrappedHtml;
}

// 替換郵件變數為範例資料
function replaceEmailVariables(html) {
    const sampleData = {
        '{{guestName}}': '王小明',
        '{{bookingId}}': 'BK20241212001',
        '{{checkInDate}}': '2024/12/20',
        '{{checkOutDate}}': '2024/12/22',
        '{{roomType}}': '豪華雙人房',
        '{{finalAmount}}': '6,000',
        '{{totalAmount}}': '6,000',
        '{{paymentDeadline}}': '2024/12/15',
        '{{daysReserved}}': '3',
        '{{bankName}}': '台灣銀行',
        '{{bankBranchDisplay}}': '（台北分行）',
        '{{bankAccount}}': '123-456-789-012',
        '{{accountName}}': '某某旅館',
        '{{addonsList}}': '早餐券 x2、停車券 x1',
        '{{addonsTotal}}': '500',
        '{{remainingAmount}}': '4,200',
        '{{#if addonsList}}': '',
        '{{/if}}': '',
        '{{#if isDeposit}}': '',
        '{{/if}}': ''
    };
    
    let result = html;
    for (const [key, value] of Object.entries(sampleData)) {
        result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    // 移除條件判斷標籤
    result = result.replace(/{{#if\s+\w+}}/g, '');
    result = result.replace(/{{\/if}}/g, '');
    
    return result;
}

// 獲取郵件樣式 CSS
function getEmailStyleCSS(style) {
    // 根據當前模板類型選擇正確的標題欄顏色
    const form = document.getElementById('emailTemplateForm');
    const templateKey = form ? form.dataset.templateKey : null;
    // 使用統一的函數獲取標題顏色
    const headerColor = getHeaderColorForTemplate(templateKey);
    
    const styles = {
        card: `
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${headerColor}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${headerColor}; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0; }
        `,
        modern: `
            body { font-family: 'Microsoft JhengHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #2c3e50; margin: 0; padding: 0; background: #f0f2f5; }
            .container { max-width: 650px; margin: 0 auto; padding: 0; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .info-box { background: #f8f9fa; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #667eea; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
            .info-row { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #e8ecf0; }
            .info-label { font-weight: 600; color: #7f8c8d; font-size: 14px; }
            .info-value { color: #2c3e50; font-weight: 500; }
            .highlight { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 12px; padding: 25px; margin: 25px 0; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        `,
        minimal: `
            body { font-family: 'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif; line-height: 1.8; color: #333; margin: 0; padding: 0; background: #ffffff; }
            .container { max-width: 580px; margin: 0 auto; padding: 40px 30px; }
            .header { border-bottom: 3px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
            .content { padding: 0; }
            .info-box { background: #fff; padding: 25px; margin: 30px 0; border-left: 3px solid #000; }
            .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; }
            .info-label { font-weight: 400; color: #666; font-size: 14px; letter-spacing: 0.5px; }
            .info-value { color: #000; font-weight: 500; }
            .highlight { border: 2px solid #000; padding: 25px; margin: 30px 0; background: #fff; }
        `,
        business: `
            body { font-family: 'Microsoft JhengHei', 'Georgia', serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; padding: 0; background: white; border: 1px solid #ddd; }
            .header { background: #1a1a1a; color: white; padding: 35px 30px; text-align: center; border-bottom: 4px solid #c9a961; }
            .content { padding: 35px 30px; }
            .info-box { background: #faf8f3; padding: 25px; margin: 25px 0; border-left: 4px solid #c9a961; }
            .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e5e5; }
            .info-label { font-weight: 600; color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
            .info-value { color: #1a1a1a; font-weight: 500; }
            .highlight { background: #faf8f3; border-left: 4px solid #c9a961; padding: 20px; margin: 25px 0; }
        `,
        elegant: `
            body { font-family: 'Microsoft JhengHei', 'Playfair Display', serif; line-height: 1.7; color: #3d3d3d; margin: 0; padding: 0; background: #faf9f7; }
            .container { max-width: 620px; margin: 0 auto; padding: 0; background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            .header { background: #8b7355; color: white; padding: 45px 35px; text-align: center; }
            .content { padding: 45px 35px; }
            .info-box { background: #f5f3f0; padding: 30px; margin: 30px 0; border-left: 3px solid #8b7355; border-radius: 4px; }
            .info-row { display: flex; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #e8e6e3; }
            .info-label { font-weight: 500; color: #8b7355; font-size: 14px; font-style: italic; }
            .info-value { color: #3d3d3d; font-weight: 400; }
            .highlight { background: #f5f3f0; border: 1px solid #d4c4b0; border-radius: 4px; padding: 25px; margin: 30px 0; }
        `
    };
    return styles[style] || styles.card;
}

// 應用郵件樣式（已移除樣式選擇器，固定使用預設的圖卡樣式）
// 此函數保留以備將來需要，但始終使用 'card' 樣式
function applyEmailStyle(style) {
    // 固定使用預設的圖卡樣式
    currentEmailStyle = 'card';
    console.log('🎨 固定使用預設的圖卡樣式');
    if (isPreviewVisible) {
        console.log('🎨 預覽已顯示，立即更新預覽');
        refreshEmailPreview();
    }
}

// 關閉郵件模板模態框
function closeEmailTemplateModal() {
    document.getElementById('emailTemplateModal').classList.remove('active');
    // 重置編輯模式
    isHtmlMode = false;
    isPreviewVisible = false;
    currentEmailStyle = 'card';
    const editorContainer = document.getElementById('emailTemplateEditor');
    const textarea = document.getElementById('emailTemplateContent');
    const previewArea = document.getElementById('emailPreviewArea');
    const previewBtnText = document.getElementById('previewBtnText');
    
    if (editorContainer && textarea) {
        editorContainer.style.display = 'block';
        textarea.style.display = 'none';
        const toggleBtn = document.getElementById('toggleEditorModeBtn');
        if (toggleBtn) {
            toggleBtn.textContent = '切換到 HTML 模式';
        }
    }
    if (previewArea) {
        previewArea.style.display = 'none';
    }
    if (previewBtnText) {
        previewBtnText.textContent = '顯示預覽';
    }
    // 郵件樣式選擇器已移除，固定使用預設的圖卡樣式
}

// 立即暴露 closeEmailTemplateModal 到全局作用域
window.closeEmailTemplateModal = closeEmailTemplateModal;

// ==================== 假日管理 ====================

// 載入假日列表
async function loadHolidays() {
    try {
        const response = await adminFetch('/api/admin/holidays');
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
                ${!isWeekend && hasPermission('room_types.edit') ? `<button class="btn-cancel" onclick="deleteHoliday('${holiday.holiday_date}')" style="padding: 5px 10px; font-size: 12px;">刪除</button>` : ''}
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
        const response = await adminFetch('/api/admin/holidays', {
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
        const response = await adminFetch('/api/admin/holidays', {
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
        const response = await adminFetch(`/api/admin/holidays/${holidayDate}`, {
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

// 明確將關鍵函數暴露到全局作用域，確保可以在 HTML 的 onclick/onsubmit 中使用
// 在文件末尾執行，確保所有函數都已定義
// 使用多種方法確保函數暴露成功
(function exposeFunctionsToGlobal() {
    console.log('🔧 開始暴露函數到全局作用域...');
    
    // 方法 1: 直接暴露（函數聲明會被提升）
    try {
        window.handleLogin = handleLogin;
        window.handleLogout = handleLogout;
        window.checkAuthStatus = checkAuthStatus;
        window.showAdminPage = showAdminPage;
        window.showLoginPage = showLoginPage;
        console.log('✅ 方法 1: 直接暴露成功');
    } catch (error) {
        console.error('❌ 方法 1 失敗:', error);
    }
    
    // 方法 2: 延遲暴露（確保所有代碼都已執行）
    setTimeout(function() {
        try {
            if (typeof handleLogin === 'function') window.handleLogin = handleLogin;
            if (typeof handleLogout === 'function') window.handleLogout = handleLogout;
            if (typeof checkAuthStatus === 'function') window.checkAuthStatus = checkAuthStatus;
            if (typeof showAdminPage === 'function') window.showAdminPage = showAdminPage;
            if (typeof showLoginPage === 'function') window.showLoginPage = showLoginPage;
            // 導出郵件模板相關函數
            if (typeof closeEmailTemplateModal === 'function') window.closeEmailTemplateModal = closeEmailTemplateModal;
            // 檢查 sendTestEmail 是否已正確設置（不是臨時函數）
            if (typeof sendTestEmail === 'function') {
                const currentFn = window.sendTestEmail;
                const isTemporary = currentFn && 
                                   typeof currentFn === 'function' &&
                                   (currentFn.toString().includes('尚未載入') || 
                                    currentFn.toString().includes('功能載入中'));
                // 只有當當前函數是臨時函數或不存在時才設置
                if (!currentFn || isTemporary) {
                    window.sendTestEmail = sendTestEmail;
                    console.log('✅ sendTestEmail 在延遲暴露中設置成功');
                } else {
                    console.log('✅ sendTestEmail 已正確設置，跳過覆蓋');
                }
            }
            if (typeof saveEmailTemplate === 'function') window.saveEmailTemplate = saveEmailTemplate;
            if (typeof toggleEditorMode === 'function') window.toggleEditorMode = toggleEditorMode;
            if (typeof resetCurrentTemplateToDefault === 'function') window.resetCurrentTemplateToDefault = resetCurrentTemplateToDefault;
            console.log('✅ 方法 2: 延遲暴露完成');
        } catch (error) {
            console.error('❌ 方法 2 失敗:', error);
        }
    }, 0);
    
    // 立即檢查暴露結果
    console.log('✅ 關鍵函數已暴露到全局作用域:', {
        handleLogin: typeof window.handleLogin,
        handleLogout: typeof window.handleLogout,
        checkAuthStatus: typeof window.checkAuthStatus,
        showAdminPage: typeof window.showAdminPage,
        showLoginPage: typeof window.showLoginPage,
        closeEmailTemplateModal: typeof window.closeEmailTemplateModal,
        sendTestEmail: typeof window.sendTestEmail
    });
})();

// ==================== 優惠代碼管理 ====================

let allPromoCodes = [];

// 載入優惠代碼列表
async function loadPromoCodes() {
    try {
        const response = await adminFetch('/api/admin/promo-codes');
        
        if (response.status === 401) {
            console.warn('優惠代碼 API 返回 401，Session 可能已過期');
            await checkAuthStatus();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // 確保資料格式正確，包含使用統計
            allPromoCodes = (result.data || []).map(code => ({
                ...code,
                is_active: parseInt(code.is_active) || 0, // 確保 is_active 是整數
                usage_stats: code.usage_stats || { total_usage: 0, total_discount: 0, unique_users: 0 }
            }));
            console.log('載入優惠代碼列表:', allPromoCodes.map(c => ({ code: c.code, is_active: c.is_active })));
            renderPromoCodes();
        } else {
            showError('載入優惠代碼列表失敗：' + (result.message || '未知錯誤'));
            document.getElementById('promoCodesTableBody').innerHTML = '<tr><td colspan="9" class="loading">載入失敗</td></tr>';
        }
    } catch (error) {
        console.error('載入優惠代碼列表錯誤:', error);
        showError('載入優惠代碼列表時發生錯誤：' + error.message);
        document.getElementById('promoCodesTableBody').innerHTML = '<tr><td colspan="9" class="loading">載入失敗</td></tr>';
    }
}

// 渲染優惠代碼列表
function renderPromoCodes() {
    const tbody = document.getElementById('promoCodesTableBody');
    
    if (allPromoCodes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading">沒有優惠代碼資料</td></tr>';
        return;
    }
    
    tbody.innerHTML = allPromoCodes.map(code => {
        const discountDisplay = code.discount_type === 'fixed' 
            ? `NT$ ${code.discount_value.toLocaleString()}`
            : `${code.discount_value}%${code.max_discount ? ` (最高 NT$ ${code.max_discount.toLocaleString()})` : ''}`;
        
        const totalUsage = code.usage_stats && code.usage_stats.total_usage !== undefined ? code.usage_stats.total_usage : 0;
        const usageLimit = code.total_usage_limit !== null && code.total_usage_limit !== undefined ? code.total_usage_limit : '∞';
        const usageInfo = `${totalUsage} 次 / ${usageLimit}`;
        
        const dateRange = code.start_date || code.end_date
            ? `${code.start_date || '立即'} ~ ${code.end_date || '永久'}`
            : '永久有效';
        
        // 確保 is_active 是數字類型
        const isActive = parseInt(code.is_active) === 1;
        
        return `
        <tr ${!isActive ? 'style="opacity: 0.6; background: #f8f8f8;"' : ''}>
            <td style="text-align: left;"><strong>${escapeHtml(code.code)}</strong></td>
            <td style="text-align: left;">${escapeHtml(code.name)}</td>
            <td style="text-align: center;">${code.discount_type === 'fixed' ? '固定金額' : '百分比'}</td>
            <td style="text-align: right;">${discountDisplay}</td>
            <td style="text-align: right;">${code.min_spend > 0 ? `NT$ ${code.min_spend.toLocaleString()}` : '無限制'}</td>
            <td style="text-align: center;">${usageInfo}</td>
            <td style="text-align: left;">${dateRange}</td>
            <td style="text-align: center;">
                <span class="status-badge ${isActive ? 'status-sent' : 'status-unsent'}">
                    ${isActive ? '啟用' : '停用'}
                </span>
            </td>
            <td style="text-align: center;">
                <div class="action-buttons">
                    ${hasPermission('promo_codes.edit') ? `<button class="btn-edit" onclick="editPromoCode(${code.id})">編輯</button>` : ''}
                    ${hasPermission('promo_codes.delete') ? `<button class="btn-delete" onclick="deletePromoCode(${code.id}, '${escapeHtml(code.code)}')">刪除</button>` : ''}
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

// 顯示新增優惠代碼模態框
function showAddPromoCodeModal() {
    document.getElementById('promoCodeModalTitle').textContent = '新增優惠代碼';
    document.getElementById('promoCodeId').value = '';
    document.getElementById('promoCodeForm').reset();
    document.getElementById('promoCodeIsActive').checked = true;
    document.getElementById('promoCodeDiscountType').value = 'fixed';
    updatePromoCodeDiscountType();
    document.getElementById('promoCodeModal').style.display = 'block';
}

// 更新折扣類型顯示
function updatePromoCodeDiscountType() {
    const discountType = document.getElementById('promoCodeDiscountType').value;
    const suffix = document.getElementById('promoCodeDiscountSuffix');
    const maxDiscountGroup = document.getElementById('promoCodeMaxDiscountGroup');
    const discountValue = document.getElementById('promoCodeDiscountValue');
    
    if (discountType === 'fixed') {
        suffix.textContent = 'NT$';
        maxDiscountGroup.style.display = 'none';
        discountValue.step = '1';
        discountValue.placeholder = '0';
    } else {
        suffix.textContent = '%';
        maxDiscountGroup.style.display = 'block';
        discountValue.step = '0.1';
        discountValue.placeholder = '0.0';
    }
}

// 編輯優惠代碼
async function editPromoCode(id) {
    try {
        const response = await adminFetch(`/api/admin/promo-codes/${id}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const code = result.data;
            document.getElementById('promoCodeModalTitle').textContent = '編輯優惠代碼';
            document.getElementById('promoCodeId').value = code.id;
            document.getElementById('promoCodeCode').value = code.code;
            document.getElementById('promoCodeName').value = code.name;
            document.getElementById('promoCodeDescription').value = code.description || '';
            document.getElementById('promoCodeDiscountType').value = code.discount_type;
            document.getElementById('promoCodeDiscountValue').value = code.discount_value;
            document.getElementById('promoCodeMaxDiscount').value = code.max_discount || '';
            document.getElementById('promoCodeMinSpend').value = code.min_spend || 0;
            document.getElementById('promoCodeTotalUsageLimit').value = code.total_usage_limit || '';
            document.getElementById('promoCodePerUserLimit').value = code.per_user_limit || 1;
            document.getElementById('promoCodeStartDate').value = code.start_date || '';
            document.getElementById('promoCodeEndDate').value = code.end_date || '';
            // 確保 is_active 正確處理（可能是 0/1 或 true/false）
            const isActive = code.is_active !== undefined ? (parseInt(code.is_active) === 1 || code.is_active === true) : true;
            document.getElementById('promoCodeIsActive').checked = isActive;
            
            updatePromoCodeDiscountType();
            document.getElementById('promoCodeModal').style.display = 'block';
        } else {
            showError('載入優惠代碼失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('載入優惠代碼錯誤:', error);
        showError('載入優惠代碼時發生錯誤：' + error.message);
    }
}

// 儲存優惠代碼
async function savePromoCode(event) {
    event.preventDefault();
    
    const id = document.getElementById('promoCodeId').value;
    const code = document.getElementById('promoCodeCode').value.trim().toUpperCase();
    const name = document.getElementById('promoCodeName').value.trim();
    const description = document.getElementById('promoCodeDescription').value.trim();
    const discount_type = document.getElementById('promoCodeDiscountType').value;
    const discount_value = parseFloat(document.getElementById('promoCodeDiscountValue').value || 0);
    const max_discount = document.getElementById('promoCodeMaxDiscount').value ? parseInt(document.getElementById('promoCodeMaxDiscount').value) : null;
    const min_spend = parseInt(document.getElementById('promoCodeMinSpend').value || 0);
    const total_usage_limit = document.getElementById('promoCodeTotalUsageLimit').value ? parseInt(document.getElementById('promoCodeTotalUsageLimit').value) : null;
    const per_user_limit = parseInt(document.getElementById('promoCodePerUserLimit').value || 1);
    const start_date = document.getElementById('promoCodeStartDate').value || null;
    const end_date = document.getElementById('promoCodeEndDate').value || null;
    const is_active = document.getElementById('promoCodeIsActive').checked ? 1 : 0;
    console.log('儲存優惠代碼 - is_active:', is_active, 'checked:', document.getElementById('promoCodeIsActive').checked);
    
    if (!code || !name || !discount_type || discount_value <= 0) {
        showError('請填寫完整的優惠代碼資料');
        return;
    }
    
    try {
        const url = id ? `/api/admin/promo-codes/${id}` : '/api/admin/promo-codes';
        const method = id ? 'PUT' : 'POST';
        
        const response = await adminFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code,
                name,
                description,
                discount_type,
                discount_value,
                max_discount,
                min_spend,
                total_usage_limit,
                per_user_limit,
                start_date,
                end_date,
                is_active,
                can_combine_with_early_bird: 0,
                can_combine_with_late_bird: 0
            })
        });
        
        const result = await response.json();
        
        console.log('儲存優惠代碼回應:', result);
        console.log('返回的 is_active:', result.data?.is_active);
        
        if (result.success) {
            showSuccess(id ? '優惠代碼已更新' : '優惠代碼已新增');
            closePromoCodeModal();
            // 強制重新載入列表，確保資料更新
            await loadPromoCodes();
        } else {
            showError((id ? '更新' : '新增') + '失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('儲存優惠代碼錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 刪除優惠代碼
async function deletePromoCode(id, code) {
    if (!confirm(`確定要刪除優惠代碼「${code}」嗎？此操作無法復原。`)) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/admin/promo-codes/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('優惠代碼已刪除');
            loadPromoCodes();
        } else {
            showError('刪除失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('刪除優惠代碼錯誤:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// 關閉優惠代碼模態框
function closePromoCodeModal() {
    document.getElementById('promoCodeModal').style.display = 'none';
    document.getElementById('promoCodeForm').reset();
    document.getElementById('promoCodeId').value = '';
}

// ==================== 權限管理系統 ====================

// 全域權限變數
window.currentAdminPermissions = window.currentAdminPermissions || [];

// 檢查是否有指定權限
function hasPermission(permissionCode) {
    return window.currentAdminPermissions && window.currentAdminPermissions.includes(permissionCode);
}

// 根據權限顯示/隱藏元素
function checkPermissionAndShow(elementId, permissionCode) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = hasPermission(permissionCode) ? '' : 'none';
    }
}

// 更新側邊欄和按鈕根據權限顯示
function updateSidebarByPermissions() {
    console.log('🔐 更新權限顯示...');
    
    // 更新需要權限的側邊欄項目
    document.querySelectorAll('.nav-item.permission-required').forEach(item => {
        const requiredPermission = item.dataset.permission;
        if (requiredPermission) {
            if (hasPermission(requiredPermission)) {
                item.style.display = '';
                console.log(`✅ 顯示選單項目: ${item.dataset.section} (需要 ${requiredPermission})`);
            } else {
                item.style.display = 'none';
                console.log(`❌ 隱藏選單項目: ${item.dataset.section} (缺少 ${requiredPermission})`);
            }
        }
    });
    
    // 更新需要權限的按鈕
    document.querySelectorAll('button.permission-required, .btn-primary.permission-required, .btn-save.permission-required').forEach(btn => {
        const requiredPermission = btn.dataset.permission;
        if (requiredPermission) {
            if (hasPermission(requiredPermission)) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        }
    });
}

// ==================== 管理員管理 ====================

// 載入管理員列表
async function loadAdmins() {
    console.log('📋 載入管理員列表...');
    const tbody = document.getElementById('adminsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" class="loading">載入中...</td></tr>';
    
    try {
        const response = await adminFetch('/api/admin/admins');
        const result = await response.json();
        
        if (result.success) {
            const admins = result.admins || [];
            
            if (admins.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #666;">尚無管理員資料</td></tr>';
                return;
            }
            
            tbody.innerHTML = admins.map(admin => `
                <tr>
                    <td style="text-align: center;">${admin.id}</td>
                    <td style="text-align: left;">
                        <strong>${escapeHtml(admin.username)}</strong>
                    </td>
                    <td style="text-align: left;">${escapeHtml(admin.email || '-')}</td>
                    <td style="text-align: center;">
                        <span class="badge badge-${getRoleBadgeClass(admin.role_name)}">
                            ${escapeHtml(admin.role_display_name || admin.role || '-')}
                        </span>
                    </td>
                    <td style="text-align: left;">${escapeHtml(admin.department || '-')}</td>
                    <td style="text-align: center;">
                        <span class="status-badge ${admin.is_active ? 'status-active' : 'status-cancelled'}">
                            ${admin.is_active ? '啟用' : '停用'}
                        </span>
                    </td>
                    <td style="text-align: left;">${admin.last_login ? formatDateTime(admin.last_login) : '-'}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 5px; justify-content: center;">
                            ${hasPermission('admins.edit') ? `
                                <button class="btn-icon" onclick="showEditAdminModal(${admin.id})" title="編輯">
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                            ` : ''}
                            ${hasPermission('admins.change_password') ? `
                                <button class="btn-icon" onclick="showResetPasswordModal(${admin.id}, '${escapeHtml(admin.username)}')" title="重設密碼">
                                    <span class="material-symbols-outlined">key</span>
                                </button>
                            ` : ''}
                            ${hasPermission('admins.delete') ? `
                                <button class="btn-icon btn-danger" onclick="deleteAdmin(${admin.id}, '${escapeHtml(admin.username)}')" title="刪除">
                                    <span class="material-symbols-outlined">delete</span>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">載入失敗：${result.message}</td></tr>`;
        }
    } catch (error) {
        console.error('載入管理員列表錯誤:', error);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">載入失敗：${error.message}</td></tr>`;
    }
}

// 根據角色名稱返回對應的 badge 類別
function getRoleBadgeClass(roleName) {
    const roleClasses = {
        'super_admin': 'danger',
        'admin': 'primary',
        'staff': 'info',
        'finance': 'warning',
        'viewer': 'secondary'
    };
    return roleClasses[roleName] || 'secondary';
}

// 顯示新增管理員模態框
async function showAddAdminModal() {
    document.getElementById('adminModalTitle').textContent = '新增管理員';
    document.getElementById('editAdminId').value = '';
    document.getElementById('adminForm').reset();
    document.getElementById('adminUsername').disabled = false;
    document.getElementById('adminPassword').required = true;
    document.getElementById('adminPasswordGroup').style.display = 'block';
    document.getElementById('adminIsActiveGroup').style.display = 'none';
    
    // 載入角色選項
    await loadRoleOptions();
    
    document.getElementById('adminModal').style.display = 'block';
}

// 顯示編輯管理員模態框
async function showEditAdminModal(adminId) {
    document.getElementById('adminModalTitle').textContent = '編輯管理員';
    document.getElementById('editAdminId').value = adminId;
    document.getElementById('adminUsername').disabled = true;
    document.getElementById('adminPassword').required = false;
    document.getElementById('adminPasswordGroup').style.display = 'none'; // 編輯時不顯示密碼欄位
    document.getElementById('adminIsActiveGroup').style.display = 'block';
    
    // 載入角色選項
    await loadRoleOptions();
    
    try {
        const response = await adminFetch(`/api/admin/admins/${adminId}`);
        const result = await response.json();
        
        if (result.success) {
            const admin = result.admin;
            document.getElementById('adminUsername').value = admin.username;
            document.getElementById('adminEmail').value = admin.email || '';
            document.getElementById('adminRoleId').value = admin.role_id || '';
            document.getElementById('adminDepartment').value = admin.department || '';
            document.getElementById('adminPhone').value = admin.phone || '';
            document.getElementById('adminNotes').value = admin.notes || '';
            document.getElementById('adminIsActive').checked = admin.is_active === 1 || admin.is_active === true;
            
            document.getElementById('adminModal').style.display = 'block';
        } else {
            showError('載入管理員資料失敗：' + result.message);
        }
    } catch (error) {
        console.error('載入管理員資料錯誤:', error);
        showError('載入管理員資料失敗：' + error.message);
    }
}

// 載入角色選項
async function loadRoleOptions() {
    const select = document.getElementById('adminRoleId');
    select.innerHTML = '<option value="">載入中...</option>';
    
    try {
        const response = await adminFetch('/api/admin/roles');
        const result = await response.json();
        
        if (result.success) {
            const roles = result.roles || [];
            select.innerHTML = '<option value="">請選擇角色</option>' + 
                roles.map(role => `<option value="${role.id}">${escapeHtml(role.display_name)}</option>`).join('');
        } else {
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    } catch (error) {
        console.error('載入角色選項錯誤:', error);
        select.innerHTML = '<option value="">載入失敗</option>';
    }
}

// 關閉管理員模態框
function closeAdminModal() {
    document.getElementById('adminModal').style.display = 'none';
    document.getElementById('adminForm').reset();
    document.getElementById('editAdminId').value = '';
}

// 儲存管理員
async function saveAdmin(event) {
    event.preventDefault();
    
    const adminId = document.getElementById('editAdminId').value;
    const isNew = !adminId;
    
    const adminData = {
        username: document.getElementById('adminUsername').value.trim(),
        password: document.getElementById('adminPassword').value,
        email: document.getElementById('adminEmail').value.trim(),
        role_id: parseInt(document.getElementById('adminRoleId').value),
        department: document.getElementById('adminDepartment').value.trim(),
        phone: document.getElementById('adminPhone').value.trim(),
        notes: document.getElementById('adminNotes').value.trim()
    };
    
    // 編輯模式時添加 is_active
    if (!isNew) {
        adminData.is_active = document.getElementById('adminIsActive').checked ? 1 : 0;
    }
    
    // 驗證
    if (!adminData.username) {
        showError('請輸入帳號');
        return;
    }
    if (isNew && (!adminData.password || adminData.password.length < 6)) {
        showError('密碼至少需要 6 個字元');
        return;
    }
    if (!adminData.role_id) {
        showError('請選擇角色');
        return;
    }
    
    try {
        const url = isNew ? '/api/admin/admins' : `/api/admin/admins/${adminId}`;
        const method = isNew ? 'POST' : 'PUT';
        
        const response = await adminFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adminData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(isNew ? '管理員已新增' : '管理員資料已更新');
            closeAdminModal();
            loadAdmins();
        } else {
            showError((isNew ? '新增' : '更新') + '失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('儲存管理員錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 刪除管理員
async function deleteAdmin(adminId, username) {
    if (!confirm(`確定要刪除管理員「${username}」嗎？此操作無法復原。`)) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/admin/admins/${adminId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('管理員已刪除');
            loadAdmins();
        } else {
            showError('刪除失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('刪除管理員錯誤:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// 顯示重設密碼模態框
function showResetPasswordModal(adminId, username) {
    document.getElementById('resetPasswordAdminId').value = adminId;
    document.getElementById('resetPasswordInfo').textContent = `將為管理員「${username}」重設密碼`;
    document.getElementById('resetPasswordForm').reset();
    document.getElementById('resetPasswordModal').style.display = 'block';
}

// 關閉重設密碼模態框
function closeResetPasswordModal() {
    document.getElementById('resetPasswordModal').style.display = 'none';
    document.getElementById('resetPasswordForm').reset();
}

// 重設管理員密碼
async function resetAdminPassword(event) {
    event.preventDefault();
    
    const adminId = document.getElementById('resetPasswordAdminId').value;
    const newPassword = document.getElementById('newAdminPassword').value;
    const confirmPassword = document.getElementById('confirmNewAdminPassword').value;
    
    if (newPassword.length < 6) {
        showError('新密碼至少需要 6 個字元');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showError('兩次輸入的密碼不一致');
        return;
    }
    
    try {
        const response = await adminFetch(`/api/admin/admins/${adminId}/reset-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('密碼已重設');
            closeResetPasswordModal();
        } else {
            showError('重設密碼失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('重設密碼錯誤:', error);
        showError('重設密碼時發生錯誤：' + error.message);
    }
}

// ==================== 角色管理 ====================

// 載入角色列表
async function loadRoles() {
    console.log('📋 載入角色列表...');
    const tbody = document.getElementById('rolesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" class="loading">載入中...</td></tr>';
    
    try {
        const response = await adminFetch('/api/admin/roles');
        const result = await response.json();
        
        if (result.success) {
            const roles = result.roles || [];
            
            if (roles.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #666;">尚無角色資料</td></tr>';
                return;
            }
            
            tbody.innerHTML = roles.map(role => `
                <tr>
                    <td style="text-align: center;">${role.id}</td>
                    <td style="text-align: left;"><code>${escapeHtml(role.role_name)}</code></td>
                    <td style="text-align: left;"><strong>${escapeHtml(role.display_name)}</strong></td>
                    <td style="text-align: left;">${escapeHtml(role.description || '-')}</td>
                    <td style="text-align: center;">${role.permission_count || 0}</td>
                    <td style="text-align: center;">${role.admin_count || 0}</td>
                    <td style="text-align: center;">
                        ${role.is_system_role ? '<span class="badge badge-info">系統</span>' : '<span class="badge badge-secondary">自訂</span>'}
                    </td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 5px; justify-content: center;">
                            ${hasPermission('roles.assign_permissions') ? `
                                <button class="btn-icon" onclick="showEditRoleModal(${role.id})" title="編輯權限">
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                            ` : ''}
                            ${!role.is_system_role && hasPermission('roles.delete') ? `
                                <button class="btn-icon btn-danger" onclick="deleteRole(${role.id}, '${escapeHtml(role.display_name)}')" title="刪除">
                                    <span class="material-symbols-outlined">delete</span>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">載入失敗：${result.message}</td></tr>`;
        }
    } catch (error) {
        console.error('載入角色列表錯誤:', error);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">載入失敗：${error.message}</td></tr>`;
    }
}

// 載入權限參考列表
async function loadPermissionsReference() {
    const container = document.getElementById('permissionsReferenceList');
    if (!container) return;
    
    try {
        const response = await adminFetch('/api/admin/permissions');
        const result = await response.json();
        
        if (result.success) {
            const permissions = result.permissions || {};
            
            let html = '';
            for (const [module, perms] of Object.entries(permissions)) {
                html += `
                    <div style="margin-bottom: 15px;">
                        <h4 style="margin: 0 0 8px 0; color: #333; text-transform: capitalize;">
                            <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 5px;">${getModuleIcon(module)}</span>
                            ${getModuleDisplayName(module)}
                        </h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px;">
                            ${perms.map(p => `
                                <div style="background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #e0e0e0;">
                                    <code style="font-size: 12px; color: #667eea;">${p.permission_code}</code>
                                    <div style="font-size: 13px; color: #333;">${escapeHtml(p.permission_name)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            container.innerHTML = html || '<p style="color: #666;">尚無權限資料</p>';
        } else {
            container.innerHTML = `<p style="color: red;">載入失敗：${result.message}</p>`;
        }
    } catch (error) {
        console.error('載入權限參考列表錯誤:', error);
        container.innerHTML = `<p style="color: red;">載入失敗：${error.message}</p>`;
    }
}

// 取得模組圖示
function getModuleIcon(module) {
    const icons = {
        'dashboard': 'speed',
        'bookings': 'event_note',
        'customers': 'people',
        'room_types': 'king_bed',
        'addons': 'add_shopping_cart',
        'promo_codes': 'local_offer',
        'statistics': 'monitoring',
        'settings': 'settings',
        'email_templates': 'mail',
        'admins': 'manage_accounts',
        'roles': 'admin_panel_settings',
        'logs': 'history',
        'backup': 'backup'
    };
    return icons[module] || 'folder';
}

// 取得模組顯示名稱
function getModuleDisplayName(module) {
    const names = {
        'dashboard': '儀表板',
        'bookings': '訂房管理',
        'customers': '客戶管理',
        'room_types': '房型管理',
        'addons': '加購商品',
        'promo_codes': '優惠代碼',
        'statistics': '統計資料',
        'settings': '系統設定',
        'email_templates': '郵件模板',
        'admins': '管理員管理',
        'roles': '角色權限',
        'logs': '操作日誌',
        'backup': '資料備份'
    };
    return names[module] || module;
}

// 顯示新增角色模態框
async function showAddRoleModal() {
    document.getElementById('roleModalTitle').textContent = '新增角色';
    document.getElementById('editRoleId').value = '';
    document.getElementById('roleForm').reset();
    document.getElementById('roleCode').disabled = false;
    
    // 載入權限列表
    await loadPermissionsList();
    
    document.getElementById('roleModal').style.display = 'block';
}

// 顯示編輯角色模態框
async function showEditRoleModal(roleId) {
    document.getElementById('roleModalTitle').textContent = '編輯角色權限';
    document.getElementById('editRoleId').value = roleId;
    document.getElementById('roleCode').disabled = true;
    
    // 先載入權限列表
    await loadPermissionsList();
    
    try {
        const response = await adminFetch(`/api/admin/roles/${roleId}`);
        const result = await response.json();
        
        if (result.success) {
            const role = result.role;
            document.getElementById('roleCode').value = role.role_name;
            document.getElementById('roleDisplayName').value = role.display_name;
            document.getElementById('roleDescription').value = role.description || '';
            
            // 勾選已有的權限
            if (role.permissions) {
                role.permissions.forEach(p => {
                    const checkbox = document.querySelector(`input[name="permissions"][value="${p.permission_code}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                });
            }
            
            // 如果是超級管理員，禁用權限編輯
            if (role.role_name === 'super_admin') {
                document.querySelectorAll('input[name="permissions"]').forEach(cb => {
                    cb.disabled = true;
                });
                document.getElementById('roleDisplayName').disabled = true;
                document.getElementById('roleDescription').disabled = true;
            }
            
            document.getElementById('roleModal').style.display = 'block';
        } else {
            showError('載入角色資料失敗：' + result.message);
        }
    } catch (error) {
        console.error('載入角色資料錯誤:', error);
        showError('載入角色資料失敗：' + error.message);
    }
}

// 載入權限列表（用於編輯）
async function loadPermissionsList() {
    const container = document.getElementById('permissionsContainer');
    container.innerHTML = '<div class="loading">載入權限列表中...</div>';
    
    try {
        const response = await adminFetch('/api/admin/permissions');
        const result = await response.json();
        
        if (result.success) {
            const permissions = result.permissions || {};
            
            let html = '';
            for (const [module, perms] of Object.entries(permissions)) {
                html += `
                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid #667eea;">
                            <span class="material-symbols-outlined" style="font-size: 20px; color: #667eea;">${getModuleIcon(module)}</span>
                            <strong style="color: #333;">${getModuleDisplayName(module)}</strong>
                            <button type="button" class="btn-secondary" style="padding: 2px 8px; font-size: 11px; margin-left: auto;" onclick="toggleModulePermissions('${module}')">切換</button>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
                            ${perms.map(p => `
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #fff; border-radius: 4px; border: 1px solid #e0e0e0; cursor: pointer;">
                                    <input type="checkbox" name="permissions" value="${p.permission_code}" data-module="${module}" style="width: 16px; height: 16px;">
                                    <span style="font-size: 13px;">${escapeHtml(p.permission_name)}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            container.innerHTML = html || '<p style="color: #666;">尚無權限資料</p>';
        } else {
            container.innerHTML = `<p style="color: red;">載入失敗：${result.message}</p>`;
        }
    } catch (error) {
        console.error('載入權限列表錯誤:', error);
        container.innerHTML = `<p style="color: red;">載入失敗：${error.message}</p>`;
    }
}

// 切換模組權限
function toggleModulePermissions(module) {
    const checkboxes = document.querySelectorAll(`input[name="permissions"][data-module="${module}"]`);
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

// 全選權限
function selectAllPermissions() {
    document.querySelectorAll('input[name="permissions"]').forEach(cb => {
        if (!cb.disabled) cb.checked = true;
    });
}

// 取消全選權限
function deselectAllPermissions() {
    document.querySelectorAll('input[name="permissions"]').forEach(cb => {
        if (!cb.disabled) cb.checked = false;
    });
}

// 關閉角色模態框
function closeRoleModal() {
    document.getElementById('roleModal').style.display = 'none';
    document.getElementById('roleForm').reset();
    document.getElementById('editRoleId').value = '';
    document.getElementById('roleCode').disabled = false;
    document.getElementById('roleDisplayName').disabled = false;
    document.getElementById('roleDescription').disabled = false;
    document.querySelectorAll('input[name="permissions"]').forEach(cb => cb.disabled = false);
}

// 儲存角色
async function saveRole(event) {
    event.preventDefault();
    
    const roleId = document.getElementById('editRoleId').value;
    const isNew = !roleId;
    
    const roleName = document.getElementById('roleCode').value.trim();
    const displayName = document.getElementById('roleDisplayName').value.trim();
    const description = document.getElementById('roleDescription').value.trim();
    
    // 取得選中的權限
    const selectedPermissions = [];
    document.querySelectorAll('input[name="permissions"]:checked').forEach(cb => {
        selectedPermissions.push(cb.value);
    });
    
    // 驗證
    if (!roleName) {
        showError('請輸入角色代碼');
        return;
    }
    if (!displayName) {
        showError('請輸入顯示名稱');
        return;
    }
    
    try {
        if (isNew) {
            // 新增角色
            const response = await adminFetch('/api/admin/roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role_name: roleName,
                    display_name: displayName,
                    description: description
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // 新增成功後，分配權限
                const newRoleId = result.roleId;
                await adminFetch(`/api/admin/roles/${newRoleId}/permissions`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permissions: selectedPermissions })
                });
                
                showSuccess('角色已新增');
                closeRoleModal();
                loadRoles();
            } else {
                showError('新增失敗：' + (result.message || '未知錯誤'));
            }
        } else {
            // 更新角色
            const updateResponse = await adminFetch(`/api/admin/roles/${roleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    display_name: displayName,
                    description: description
                })
            });
            
            // 更新權限
            await adminFetch(`/api/admin/roles/${roleId}/permissions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissions: selectedPermissions })
            });
            
            showSuccess('角色已更新');
            closeRoleModal();
            loadRoles();
        }
    } catch (error) {
        console.error('儲存角色錯誤:', error);
        showError('儲存時發生錯誤：' + error.message);
    }
}

// 刪除角色
async function deleteRole(roleId, displayName) {
    if (!confirm(`確定要刪除角色「${displayName}」嗎？此操作無法復原。`)) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/admin/roles/${roleId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('角色已刪除');
            loadRoles();
        } else {
            showError('刪除失敗：' + (result.message || '未知錯誤'));
        }
    } catch (error) {
        console.error('刪除角色錯誤:', error);
        showError('刪除時發生錯誤：' + error.message);
    }
}

// 格式化日期時間
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}