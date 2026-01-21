# LINE 官方帳號串接說明

本文件說明如何將訂房系統串接到 LINE 官方帳號，使用 LIFF (LINE Frontend Framework) 來顯示訂房頁面，並在訂房成功後透過 LINE 回覆訂房資訊。

## 📋 目錄

1. [前置準備](#前置準備)
2. [設定 LINE 官方帳號](#設定-line-官方帳號)
3. [建立 LIFF 應用](#建立-liff-應用)
4. [環境變數設定](#環境變數設定)
5. [功能說明](#功能說明)
6. [測試步驟](#測試步驟)
7. [常見問題](#常見問題)

---

## 前置準備

### 1. 申請 LINE 官方帳號

1. 前往 [LINE Official Account Manager](https://manager.line.biz/)
2. 登入或註冊 LINE 帳號
3. 建立新的官方帳號（選擇「個人」或「企業」）

### 2. 啟用 Messaging API

1. 在 LINE Official Account Manager 中，進入您的官方帳號設定
2. 點選「Messaging API」標籤
3. 啟用「Messaging API」
4. 記錄以下資訊（稍後會用到）：
   - **Channel ID**
   - **Channel Secret**
   - **Channel Access Token**（需要點選「Issue」產生）

---

## 設定 LINE 官方帳號

### 1. 設定 Webhook URL

1. 在 Messaging API 設定頁面，找到「Webhook URL」
2. 輸入您的 Webhook URL：
   ```
   https://your-domain.com/api/line/webhook
   ```
   > ⚠️ 注意：請將 `your-domain.com` 替換為您的實際網域

3. 點選「Verify」驗證 Webhook URL
4. 啟用「Use webhook」

### 2. 設定自動回覆訊息

1. 在「回應設定」中，關閉「自動回應訊息」（避免與 Webhook 衝突）
2. 在「加入好友時的歡迎訊息」中，可以設定歡迎訊息

---

## 建立 LIFF 應用

### 1. 建立 LIFF App

1. 在 [LINE Developers Console](https://developers.line.biz/console/) 中，選擇您的 Provider
2. 選擇您的 Channel（Messaging API Channel）
3. 點選「LIFF」標籤
4. 點選「Add」建立新的 LIFF App
5. 填寫以下資訊：
   - **LIFF app name**: 訂房系統（可自訂）
   - **Size**: Full（全螢幕）
   - **Endpoint URL**: `https://your-domain.com/`（您的訂房系統首頁）
   - **Scope**: `profile`、`openid`
   - **Bot link feature**: 啟用（可選）

6. 記錄 **LIFF ID**（稍後會用到）

### 2. 設定 LIFF URL

1. 在 LINE Official Account Manager 中，進入「Messaging API」設定
2. 找到「Rich menu」或「圖文選單」
3. 建立圖文選單，加入「訂房」按鈕，連結到您的 LIFF URL：
   ```
   https://liff.line.me/YOUR_LIFF_ID
   ```
   > ⚠️ 注意：請將 `YOUR_LIFF_ID` 替換為您剛才記錄的 LIFF ID

---

## 環境變數設定

### 方式一：在管理後台設定（推薦）

1. 登入管理後台
2. 進入「系統設定」→「基本設定」分頁
3. 找到「LINE 官方帳號設定」區塊
4. 填寫以下設定：
   - **Channel Access Token**：從 LINE Developers Console 取得的 Channel Access Token
   - **Channel Secret**：從 LINE Developers Console 取得的 Channel Secret
   - **LIFF ID**：從 LINE Developers Console 建立的 LIFF App ID
   - **LIFF URL**（選填）：LIFF App 的完整 URL（系統會自動產生）
5. 點選「儲存設定」

> ✅ **優點**：設定方便，不需要修改環境變數，可在後台直接管理

### 方式二：使用環境變數設定（備用）

如果需要在 Railway 或本地開發環境使用環境變數設定：

#### Railway 環境變數設定

在 Railway 專案的環境變數中，加入以下設定：

```bash
# LINE Bot 設定
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
LINE_CHANNEL_SECRET=your_channel_secret
LINE_LIFF_ID=your_liff_id
LINE_LIFF_URL=https://liff.line.me/your_liff_id
```

#### 本地開發環境設定

在 `.env` 檔案中，加入以下設定：

```bash
# LINE Bot 設定
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
LINE_CHANNEL_SECRET=your_channel_secret
LINE_LIFF_ID=your_liff_id
LINE_LIFF_URL=https://liff.line.me/your_liff_id
```

> ⚠️ **注意**：
> - 系統會優先使用管理後台的設定，如果後台沒有設定，才會使用環境變數
> - 請將上述值替換為您實際的設定值

---

## 功能說明

### 1. LIFF 整合

- 當用戶從 LINE 官方帳號點擊「訂房」按鈕時，會開啟 LIFF 應用
- LIFF 應用會自動取得用戶的 LINE User ID
- 訂房表單會自動帶入 LINE User ID，用於後續發送訂房成功訊息

### 2. 訂房成功通知

- 當用戶完成訂房後，系統會自動發送 LINE 訊息通知
- 訊息內容包含：
  - 訂房編號
  - 入住日期
  - 退房日期
  - 房型
  - 應付金額

### 3. Webhook 事件處理

系統會處理以下 LINE 事件：

- **文字訊息**：當用戶輸入「訂房」或「預訂」時，自動回覆訂房連結
- **加入好友**：當新用戶加入時，自動發送歡迎訊息

---

## 測試步驟

### 1. 測試 Webhook

1. 在 LINE Official Account Manager 中，點選「Verify」驗證 Webhook URL
2. 確認 Webhook 狀態為「已啟用」
3. 發送測試訊息到您的官方帳號，確認伺服器有收到事件

### 2. 測試 LIFF

1. 在 LINE 官方帳號中，點選「訂房」按鈕
2. 確認 LIFF 應用正常開啟
3. 填寫訂房表單並提交
4. 確認訂房成功後，收到 LINE 訊息通知

### 3. 測試訂房流程

1. 從 LINE 官方帳號開啟訂房頁面
2. 選擇日期、房型等資訊
3. 填寫聯絡資訊
4. 提交訂房
5. 確認收到：
   - Email 確認信（如果已設定）
   - LINE 訂房成功訊息

---

## 常見問題

### Q1: Webhook 驗證失敗

**原因**：
- Webhook URL 無法從外部存取
- 伺服器未正確處理 POST 請求
- Channel Secret 設定錯誤

**解決方法**：
1. 確認 Webhook URL 可以從外部存取
2. 檢查伺服器日誌，確認有收到 Webhook 請求
3. 確認 `LINE_CHANNEL_SECRET` 環境變數設定正確

### Q2: LIFF 無法開啟

**原因**：
- LIFF ID 設定錯誤
- Endpoint URL 無法存取
- HTTPS 憑證問題

**解決方法**：
1. 確認 `LINE_LIFF_ID` 環境變數設定正確
2. 確認 Endpoint URL 可以從外部存取
3. 確認網站使用 HTTPS（LIFF 要求 HTTPS）

### Q3: 訂房成功後沒有收到 LINE 訊息

**原因**：
- LINE User ID 未正確取得
- Channel Access Token 設定錯誤
- 訂房時未從 LIFF 開啟

**解決方法**：
1. 確認訂房頁面是從 LINE 官方帳號開啟（而非直接開啟網頁）
2. 檢查瀏覽器 Console，確認有取得 LINE User ID
3. 確認 `LINE_CHANNEL_ACCESS_TOKEN` 環境變數設定正確
4. 檢查伺服器日誌，確認 LINE 訊息發送狀態

### Q4: LINE 訊息格式顯示異常

**原因**：
- Flex 訊息格式錯誤
- LINE API 版本問題

**解決方法**：
1. 檢查 `line-bot.js` 中的 Flex 訊息格式
2. 確認使用的是 LINE Messaging API v2
3. 如果 Flex 訊息失敗，系統會自動降級為文字訊息

---

## 技術架構

### 檔案結構

```
booking-system/
├── line-bot.js              # LINE Bot 服務模組
├── server.js                 # 主伺服器（包含 Webhook 端點）
├── script.js                 # 前台 JavaScript（包含 LIFF 初始化）
├── index.html               # 前台頁面（包含 LIFF SDK）
└── LINE官方帳號串接說明.md   # 本文件
```

### API 端點

- `POST /api/line/webhook` - LINE Webhook 接收端點
- `POST /api/booking` - 訂房 API（會自動處理 LINE User ID）

### 資料流程

1. 用戶從 LINE 官方帳號點擊「訂房」按鈕
2. LINE 開啟 LIFF 應用（`index.html`）
3. `script.js` 初始化 LIFF，取得 LINE User ID
4. 用戶填寫訂房表單並提交
5. 表單資料（包含 LINE User ID）發送到 `/api/booking`
6. 伺服器處理訂房，發送 Email 和 LINE 訊息
7. 用戶收到 LINE 訂房成功通知

---

## 進階設定

### 自訂歡迎訊息

在 `server.js` 的 Webhook 處理中，可以修改歡迎訊息：

```javascript
if (event.type === 'follow') {
    const userId = event.source.userId;
    await lineBot.sendTextMessage(userId, '您的自訂歡迎訊息');
}
```

### 自訂訂房成功訊息

在 `line-bot.js` 的 `sendBookingSuccessMessage` 函數中，可以修改 Flex 訊息格式。

---

## 支援

如有任何問題，請檢查：

1. 伺服器日誌（查看 LINE 相關錯誤訊息）
2. 瀏覽器 Console（查看 LIFF 初始化狀態）
3. LINE Developers Console（查看 API 使用狀況）

---

**最後更新**: 2024-12-19

