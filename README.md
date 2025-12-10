# 訂房系統 + 自動跟進信系統

一個功能完整的線上訂房系統，包含美觀的使用者介面和自動郵件通知功能。

## 功能特色

- 📅 **日期選擇器**：直觀的入住/退房日期選擇
- 🛏️ **房型選擇**：多種房型選項，自動帶入房價
- 💳 **支付選項**：支援訂金/全額、匯款/刷卡
- 📧 **自動郵件**：自動發送確認信給客戶和管理員
- 🎨 **美觀介面**：類似 Google 預約圖卡的現代化設計
- 📱 **響應式設計**：支援手機、平板、電腦

## 安裝步驟

### 1. 安裝依賴套件

```bash
npm install
```

### 2. 設定環境變數

建立 `.env` 檔案（或直接在系統環境變數中設定）：

```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
ADMIN_EMAIL=admin@example.com
PORT=3000
```

### 3. Gmail 設定（如果使用 Gmail）

1. 前往 Google 帳戶設定
2. 啟用「兩步驟驗證」
3. 產生「應用程式密碼」
4. 將應用程式密碼設定到 `EMAIL_PASS`

### 4. 啟動伺服器

```bash
npm start
```

或使用開發模式（自動重啟）：

```bash
npm run dev
```

### 5. 開啟瀏覽器

訪問：http://localhost:3000

## 專案結構

```
booking-system/
├── index.html      # 前端頁面
├── style.css       # 樣式檔案
├── script.js       # 前端 JavaScript
├── server.js       # 後端伺服器
├── package.json    # 專案設定
└── README.md       # 說明文件
```

## 使用說明

### 客戶端

1. 選擇入住和退房日期
2. 選擇房型（價格自動計算）
3. 填寫個人資訊（姓名、手機、Email）
4. 選擇支付方式（訂金/全額、匯款/刷卡）
5. 確認訂房資訊和金額
6. 提交訂房申請

### 系統功能

- 自動計算住宿天數
- 自動計算總金額和應付金額
- 自動發送確認郵件給客戶
- 自動發送通知郵件給管理員

## 自訂設定

### 修改房型

編輯 `index.html` 中的房型選項：

```html
<div class="room-option" data-room="standard" data-price="2000">
    <!-- 房型內容 -->
</div>
```

### 修改郵件內容

編輯 `server.js` 中的 `generateCustomerEmail()` 和 `generateAdminEmail()` 函數。

### 連接資料庫

在 `server.js` 的 `/api/booking` 路由中，取消註解並實作資料庫儲存功能。

## 技術棧

- **前端**：HTML5, CSS3, JavaScript (Vanilla)
- **後端**：Node.js, Express
- **郵件**：Nodemailer
- **字體**：Google Fonts (Noto Sans TC)

## 注意事項

- 請確保設定正確的郵件服務帳號和密碼
- 生產環境請使用環境變數管理敏感資訊
- 建議連接資料庫以持久化儲存訂房資料
- 可根據需求整合實際的支付閘道

## 授權

ISC

