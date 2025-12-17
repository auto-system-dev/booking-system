# Railway 登入問題排查指南

## 🔍 問題：顯示「請先登入」錯誤

如果看到 `{"success":false,"message":"請先登入"}`，請按照以下步驟排查：

---

## 📋 排查步驟

### 步驟 1：確認您訪問的是哪個頁面/API

#### 情況 A：訪問 `/admin` 頁面

如果您訪問 `https://your-app.railway.app/admin`，這是正常的：
- 未登入時會顯示登入頁面
- 這是預期行為，不是錯誤

**解決方法：**
1. 在登入頁面輸入帳號：`admin`
2. 輸入密碼：`admin123`
3. 點擊「登入」按鈕

#### 情況 B：直接訪問受保護的 API

如果您直接訪問以下 API（未登入）：
- `/api/statistics`
- `/api/customers`
- `/api/admin/*`（除了登入相關）

會返回 `{"success":false,"message":"請先登入"}`，這是正常的保護機制。

**解決方法：**
1. 先訪問 `/admin` 頁面
2. 完成登入
3. 然後再訪問這些 API

---

### 步驟 2：檢查是否已正確登入

#### 檢查方法 1：查看瀏覽器開發者工具

1. 打開瀏覽器開發者工具（F12）
2. 進入 **Application** 或 **儲存** 標籤
3. 查看 **Cookies** 區塊
4. 確認是否有名為 `connect.sid` 的 Cookie

**如果沒有 Cookie：**
- Session 沒有正確建立
- 可能是 Cookie 設定問題

**如果有 Cookie：**
- 檢查 Cookie 的屬性
- 確認 `HttpOnly` 和 `Secure` 設定

#### 檢查方法 2：測試登入 API

打開瀏覽器開發者工具的 **Console** 標籤，執行：

```javascript
fetch('/api/admin/login', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
    })
})
.then(res => res.json())
.then(data => console.log('登入結果:', data));
```

**預期結果：**
```json
{
    "success": true,
    "message": "登入成功",
    "admin": {
        "username": "admin",
        "role": "super_admin"
    }
}
```

**如果返回錯誤：**
- 檢查 Railway 日誌，確認資料庫初始化是否成功
- 確認預設管理員是否已建立

---

### 步驟 3：檢查 Session Cookie 設定

#### 問題：Cookie 在 HTTPS 環境下無法設定

Railway 使用 HTTPS，但 Session 配置中的 `secure` 選項可能導致問題。

**檢查當前設定：**

在 `server.js` 中：
```javascript
cookie: {
    secure: process.env.NODE_ENV === 'production', // 這裡可能是問題
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
}
```

**解決方法：**

如果 Railway 上 `NODE_ENV` 不是 `production`，`secure` 會是 `false`，但 Railway 使用 HTTPS，這可能導致 Cookie 無法正確設定。

**建議修改：**

在 Railway 環境變數中設定：
```
NODE_ENV=production
```

或者修改 `server.js`，讓它在 Railway 環境下自動使用 `secure: true`。

---

### 步驟 4：檢查 CORS 設定

確認 CORS 設定允許 credentials：

```javascript
app.use(cors({
    credentials: true,
    origin: true
}));
```

這個設定應該是正確的，但請確認：
1. CORS 中間件在 Session 中間件之後
2. 前端使用 `credentials: 'include'`

---

### 步驟 5：檢查 Railway 環境變數

確認以下環境變數已正確設定：

1. **SESSION_SECRET**（必填）
   ```
   SESSION_SECRET=WFVY5iINOfz/A/DFWH0M1hHUvIY8q0kU2IhpdXoSwxA=
   ```

2. **NODE_ENV**（建議設定）
   ```
   NODE_ENV=production
   ```

**檢查方法：**
1. 在 Railway 後台查看 Variables
2. 確認變數已正確設定
3. 確認值沒有多餘的空格或引號

---

### 步驟 6：檢查 Railway 日誌

1. 在 Railway 後台，進入服務頁面
2. 點擊 **Deployments** 標籤
3. 查看最新的部署日誌
4. 確認看到以下訊息：
   ```
   ✅ 管理員資料表已準備就緒
   ✅ 預設管理員已建立（帳號：admin，密碼：admin123）
   ```

**如果沒有看到這些訊息：**
- 資料庫初始化可能失敗
- 檢查資料庫連接是否正常

---

### 步驟 7：清除瀏覽器 Cookie 和快取

1. 打開瀏覽器開發者工具（F12）
2. 進入 **Application** 或 **儲存** 標籤
3. 點擊 **Clear storage** 或 **清除儲存**
4. 勾選 **Cookies** 和 **Local storage**
5. 點擊 **Clear site data**
6. 重新訪問 `/admin` 頁面

---

## 🔧 快速修復方案

### 方案 1：強制使用 secure Cookie（推薦）

修改 `server.js` 中的 Session 配置，讓它在 Railway 環境下自動使用 `secure: true`：

```javascript
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax' // 新增：改善跨站 Cookie 處理
    }
}));
```

### 方案 2：在 Railway 設定 NODE_ENV

在 Railway 環境變數中設定：
```
NODE_ENV=production
SESSION_SECRET=WFVY5iINOfz/A/DFWH0M1hHUvIY8q0kU2IhpdXoSwxA=
```

---

## 🧪 測試步驟

### 完整測試流程

1. **清除瀏覽器 Cookie**
   - 打開開發者工具
   - 清除所有 Cookie

2. **訪問登入頁面**
   ```
   https://your-app.railway.app/admin
   ```

3. **檢查 Network 標籤**
   - 打開開發者工具的 Network 標籤
   - 訪問 `/admin` 頁面
   - 查看 `/api/admin/check-auth` 請求
   - 確認返回 `{"success":true,"authenticated":false}`

4. **執行登入**
   - 輸入帳號：`admin`
   - 輸入密碼：`admin123`
   - 點擊「登入」

5. **檢查登入後的請求**
   - 在 Network 標籤中查看登入請求
   - 確認返回 `{"success":true,"message":"登入成功"}`
   - 檢查 Response Headers 中是否有 `Set-Cookie` 標頭

6. **檢查 Cookie**
   - 進入 Application 標籤
   - 查看 Cookies
   - 確認有 `connect.sid` Cookie

7. **測試受保護的 API**
   - 訪問 `/api/statistics`
   - 應該可以正常訪問，不會返回「請先登入」

---

## 🚨 常見錯誤和解決方法

### 錯誤 1：登入後立即被登出

**原因：** Cookie 無法正確設定或讀取

**解決方法：**
1. 確認 `SESSION_SECRET` 已設定
2. 確認 `NODE_ENV=production`（如果使用 HTTPS）
3. 檢查 Cookie 的 `secure` 和 `httpOnly` 設定

### 錯誤 2：登入成功但無法訪問 API

**原因：** Session 沒有正確儲存或讀取

**解決方法：**
1. 檢查 Railway 日誌，確認沒有 Session 相關錯誤
2. 確認 `SESSION_SECRET` 在部署前後保持一致
3. 清除 Cookie 後重新登入

### 錯誤 3：Cookie 沒有被設定

**原因：** CORS 或 Cookie 設定問題

**解決方法：**
1. 確認前端使用 `credentials: 'include'`
2. 確認 CORS 設定 `credentials: true`
3. 檢查瀏覽器是否阻擋第三方 Cookie

---

## 📞 需要更多協助？

如果以上步驟都無法解決問題，請提供：

1. **Railway 日誌**
   - 複製最新的部署日誌
   - 特別注意錯誤訊息

2. **瀏覽器 Console 錯誤**
   - 打開開發者工具的 Console 標籤
   - 複製任何錯誤訊息

3. **Network 請求詳情**
   - 打開開發者工具的 Network 標籤
   - 找到登入請求
   - 查看 Request 和 Response 詳情

---

**最後更新：** 2024年

