# Railway 登入系統測試指南

## 📋 系統狀態檢查

### ✅ 已實作功能

1. **資料庫層面**
   - ✅ 管理員資料表（`admins`）
   - ✅ 密碼加密（bcrypt）
   - ✅ 預設管理員自動建立

2. **後端 API**
   - ✅ Session 管理（express-session）
   - ✅ 登入 API（`POST /api/admin/login`）
   - ✅ 登出 API（`POST /api/admin/logout`）
   - ✅ 檢查登入狀態 API（`GET /api/admin/check-auth`）
   - ✅ 登入驗證中間件（保護管理後台路由）

3. **前端介面**
   - ✅ 登入頁面
   - ✅ 登入表單
   - ✅ 錯誤訊息顯示
   - ✅ 登出按鈕
   - ✅ 自動檢查登入狀態

---

## 🔐 預設管理員帳號

系統啟動時會自動建立預設管理員：

- **帳號**：`admin`
- **密碼**：`admin123`（或環境變數 `ADMIN_DEFAULT_PASSWORD` 設定的值）

⚠️ **重要**：請在首次登入後立即修改密碼！

---

## 🚀 Railway 環境變數設定

### 必要環境變數

在 Railway 後台設定以下環境變數：

```env
# Session 密鑰（必須設定，建議使用隨機字串）
SESSION_SECRET=your-very-secure-random-string-here-change-this

# 預設管理員密碼（選填，預設為 admin123）
ADMIN_DEFAULT_PASSWORD=admin123

# 管理員 Email（選填）
ADMIN_EMAIL=admin@example.com
```

### 如何設定環境變數

1. 登入 Railway 控制台
2. 選擇 `booking-system` 服務
3. 點擊 **Variables** 標籤
4. 點擊 **New Variable** 新增環境變數
5. 輸入變數名稱和值
6. 點擊 **Deploy** 重新部署

### 生成安全的 SESSION_SECRET

可以使用以下命令生成隨機字串：

```bash
# Linux/Mac
openssl rand -base64 32

# Windows PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

---

## 🧪 測試步驟

### 1. 確認部署狀態

1. 在 Railway 控制台檢查部署狀態
2. 確認服務正在運行（綠色狀態）
3. 查看日誌，確認看到以下訊息：
   ```
   ✅ 管理員資料表已準備就緒
   ✅ 預設管理員已建立（帳號：admin，密碼：admin123）
   ```

### 2. 測試登入功能

#### 步驟 1：訪問管理後台

1. 打開瀏覽器，訪問您的 Railway 應用網址：
   ```
   https://your-app-name.railway.app/admin
   ```

2. 應該會看到登入頁面（如果已登入會自動跳轉到管理後台）

#### 步驟 2：使用預設帳號登入

1. 輸入帳號：`admin`
2. 輸入密碼：`admin123`
3. 點擊「登入」按鈕

#### 步驟 3：確認登入成功

- ✅ 應該看到管理後台主頁
- ✅ 側邊欄應該顯示管理員帳號（admin）
- ✅ 可以正常訪問所有功能

### 3. 測試登出功能

1. 點擊側邊欄底部的「登出」按鈕
2. 確認彈出確認對話框
3. 點擊「確定」
4. ✅ 應該回到登入頁面

### 4. 測試 API 端點

#### 測試檢查登入狀態 API

```bash
# 未登入時
curl https://your-app-name.railway.app/api/admin/check-auth

# 應該返回：
# {"success":true,"authenticated":false}
```

#### 測試登入 API

```bash
curl -X POST https://your-app-name.railway.app/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c cookies.txt

# 應該返回：
# {"success":true,"message":"登入成功","admin":{"username":"admin","role":"super_admin"}}
```

#### 測試受保護的 API（需要登入）

```bash
# 使用登入後的 cookies
curl https://your-app-name.railway.app/api/statistics \
  -b cookies.txt

# 如果未登入，應該返回：
# {"success":false,"message":"請先登入"}
```

---

## 🔍 常見問題排查

### 問題 1：登入後立即被登出

**可能原因：**
- Session 配置問題
- Cookie 設定問題（HTTPS/HTTP）

**解決方法：**
1. 確認 Railway 使用 HTTPS（Railway 預設提供 HTTPS）
2. 確認 `SESSION_SECRET` 已正確設定
3. 檢查瀏覽器是否允許 Cookie

### 問題 2：顯示「請先登入」錯誤

**可能原因：**
- Session 未正確建立
- Cookie 未正確傳送

**解決方法：**
1. 確認前端使用 `credentials: 'include'`（已實作）
2. 檢查瀏覽器開發者工具的 Network 標籤，確認 Cookie 有被設定
3. 確認 CORS 設定允許 credentials

### 問題 3：無法建立預設管理員

**可能原因：**
- 資料庫初始化失敗
- bcrypt 模組問題

**解決方法：**
1. 查看 Railway 日誌，確認資料庫初始化是否成功
2. 確認 `package.json` 包含 `bcrypt` 依賴
3. 檢查資料庫連接是否正常

### 問題 4：登入後無法訪問 API

**可能原因：**
- `requireAuth` 中間件問題
- Session 未正確儲存

**解決方法：**
1. 檢查伺服器日誌，確認 Session 是否建立
2. 確認 `req.session.admin` 是否存在
3. 檢查 API 路由是否正確使用 `requireAuth` 中間件

---

## 🔒 安全性檢查清單

- [ ] ✅ 已設定 `SESSION_SECRET` 環境變數
- [ ] ✅ 使用 HTTPS（Railway 自動提供）
- [ ] ✅ Cookie 設定為 `httpOnly: true`
- [ ] ✅ Cookie 在生產環境使用 `secure: true`
- [ ] ✅ 密碼使用 bcrypt 加密
- [ ] ⚠️ 建議：首次登入後修改預設密碼
- [ ] ⚠️ 建議：實作登入失敗次數限制
- [ ] ⚠️ 建議：實作密碼強度要求

---

## 📝 測試檢查清單

### 基本功能測試

- [ ] 可以訪問登入頁面
- [ ] 可以使用預設帳號登入
- [ ] 登入後可以看到管理後台
- [ ] 登入後可以訪問受保護的 API
- [ ] 可以正常登出
- [ ] 登出後無法訪問受保護的 API

### 錯誤處理測試

- [ ] 錯誤的帳號/密碼顯示錯誤訊息
- [ ] 未登入時訪問受保護的 API 返回「請先登入」
- [ ] Session 過期後自動要求重新登入

### 安全性測試

- [ ] Cookie 設定為 httpOnly
- [ ] 密碼不會以明文儲存
- [ ] Session ID 不會洩露在 URL 中

---

## 🎯 下一步建議

1. **修改預設密碼**
   - 登入後立即修改預設密碼
   - （需要實作修改密碼功能）

2. **加強安全性**
   - 實作登入失敗次數限制
   - 實作密碼強度要求
   - 實作雙因素認證（2FA）

3. **監控和日誌**
   - 記錄所有登入嘗試
   - 監控異常登入行為

---

## 📞 需要協助？

如果遇到問題：

1. 檢查 Railway 日誌
2. 檢查瀏覽器開發者工具（Console 和 Network）
3. 確認環境變數設定正確
4. 確認資料庫初始化成功

---

**最後更新：** 2024年

