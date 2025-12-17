# Session 診斷測試

## 🔍 在瀏覽器 Console 執行以下測試

### 測試 1：檢查當前登入狀態

```javascript
fetch('/api/admin/check-auth', { credentials: 'include' })
  .then(res => res.json())
  .then(data => console.log('登入狀態:', data));
```

**預期結果：**
- 如果已登入：`{success: true, authenticated: true, admin: {...}}`
- 如果未登入：`{success: true, authenticated: false}`

### 測試 2：檢查 Cookie

```javascript
console.log('Cookies:', document.cookie);
```

**預期結果：**
- 應該看到 `connect.sid=...` 的 Cookie

### 測試 3：手動登入並測試統計資料

```javascript
// 步驟 1：登入
fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
})
.then(res => res.json())
.then(data => {
    console.log('登入結果:', data);
    
    // 步驟 2：檢查登入狀態
    return fetch('/api/admin/check-auth', { credentials: 'include' });
})
.then(res => res.json())
.then(data => {
    console.log('登入狀態:', data);
    
    // 步驟 3：測試統計資料
    return fetch('/api/statistics', { credentials: 'include' });
})
.then(res => {
    console.log('統計資料狀態碼:', res.status);
    return res.json();
})
.then(data => console.log('統計資料:', data))
.catch(err => console.error('錯誤:', err));
```

### 測試 4：檢查 Network 請求詳情

1. 打開開發者工具的 **Network** 標籤
2. 找到 `/api/statistics` 請求
3. 點擊查看 **Request Headers**
4. 確認是否有 `Cookie: connect.sid=...`
5. 查看 **Response Headers**
6. 確認是否有 `Set-Cookie`（如果是登入請求）

## 🐛 可能的問題和解決方法

### 問題 1：Cookie 沒有被設定

**症狀：** `document.cookie` 是空的

**可能原因：**
- `SESSION_SECRET` 未設定
- Cookie 的 `secure` 設定不正確
- 瀏覽器阻擋了 Cookie

**解決方法：**
1. 確認 Railway 環境變數已設定：
   ```
   NODE_ENV=production
   SESSION_SECRET=WFVY5iINOfz/A/DFWH0M1hHUvIY8q0kU2IhpdXoSwxA=
   ```
2. 清除瀏覽器 Cookie 後重新登入
3. 檢查瀏覽器是否允許 Cookie

### 問題 2：Cookie 有設定但請求沒有傳送

**症狀：** `document.cookie` 有值，但 Network 請求中沒有 Cookie header

**可能原因：**
- `adminFetch` 函數沒有正確使用
- CORS 設定問題

**解決方法：**
1. 確認所有 API 呼叫都使用 `adminFetch` 或包含 `credentials: 'include'`
2. 檢查 CORS 設定

### 問題 3：Session 過期

**症狀：** 登入後立即返回 401

**可能原因：**
- Session 沒有正確儲存
- `SESSION_SECRET` 在部署後改變

**解決方法：**
1. 確認 `SESSION_SECRET` 在部署前後保持一致
2. 重新登入

## 📋 檢查清單

- [ ] 已設定 `NODE_ENV=production`
- [ ] 已設定 `SESSION_SECRET`
- [ ] 瀏覽器有 `connect.sid` Cookie
- [ ] Network 請求包含 Cookie header
- [ ] 登入 API 返回成功
- [ ] `/api/admin/check-auth` 返回 `authenticated: true`
- [ ] `/api/statistics` 請求包含 Cookie

