# 上線前檢查清單（Runbook）

## 使用方式

- 每次部署前照順序執行。
- 任一「必過」項目失敗，先停止部署並依「失敗處置」處理。

## A. 部署前必檢（Preflight）

### 1) 環境變數（必過）

- [ ] `SESSION_SECRET` 已設定（不可空值）
- [ ] `DATABASE_URL` 已設定
- [ ] 郵件設定已齊全（擇一）
  - [ ] `EMAIL_USER` + `EMAIL_PASS`
  - [ ] `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` + `GMAIL_REFRESH_TOKEN`
- [ ] 綠界設定（使用刷卡時必填）
  - 測試：`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`
  - 正式：`ECPAY_MERCHANT_ID_PROD`、`ECPAY_HASH_KEY_PROD`、`ECPAY_HASH_IV_PROD`
- [ ] R2 設定（使用雲端圖片時）
  - [ ] `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`
  - [ ] `R2_BUCKET_NAME`、`R2_PUBLIC_URL`

### 2) 本地靜態檢查（必過）

- [ ] `node --check server.js` 成功
- [ ] 主要修改檔案無 linter error

## B. 部署後驗證（Smoke Test）

### 1) 基礎健康檢查（必過）

- [ ] `GET /health` 回傳 `status: ok`
- [ ] 後台可登入（Session 正常）

### 2) 訂單查詢驗證（必過）

- [ ] OTP 發送端點：`POST /api/order-query/otp/send` 成功
- [ ] OTP 驗證端點：`POST /api/order-query/otp/verify` 成功
- [ ] 未經 OTP 無法直接查詢公開訂房資料

### 3) 金流流程驗證（必過）

- [ ] 建立支付表單成功：`POST /api/payment/create`
- [ ] 付款完成後，`/api/payment/return` 成功處理並更新 `payment_status=paid`
- [ ] `GET/POST /api/payment/result` 可顯示結果頁（不負責寫庫）
- [ ] 重送 callback 不會重複更新（idempotency）

### 4) 郵件與媒體（建議）

- [ ] 後台測試郵件可送達
- [ ] 圖片上傳與讀取正常（R2）

## C. 監控與告警檢查

至少確認以下事件可在日誌中查到：

- [ ] `ALERT_PAYMENT_SIGNATURE_VERIFY_FAILED`
- [ ] `ALERT_PAYMENT_CALLBACK_BOOKING_NOT_FOUND`
- [ ] `ALERT_PAYMENT_CALLBACK_PROCESSING_ERROR`
- [ ] `ALERT_PAYMENT_RESULT_SIGNATURE_VERIFY_FAILED`
- [ ] `ALERT_PAYMENT_RESULT_PROCESSING_ERROR`

建議以 `requestId`、`bookingId`、`tradeNo` 串查整段付款流程。

## D. 失敗處置（Fail Procedure）

### 1) 啟動失敗

- [ ] 優先檢查缺少的環境變數
- [ ] 若為憑證問題，先補齊新憑證，再重啟服務

### 2) 付款回調失敗

- [ ] 查 `ALERT_PAYMENT_*` 事件與對應 `requestId`
- [ ] 核對 `bookingId` / `tradeNo` 是否存在且對應
- [ ] 必要時由後台手動修正單筆狀態並記錄操作

### 3) 郵件失敗

- [ ] 檢查 Gmail/Resend 憑證與配額
- [ ] 確認寄件者設定與 DNS（若使用網域）

## E. 回滾步驟（Rollback）

### 快速回滾（建議）

1. 回到上一個穩定版本（Railway Deployments 選擇上一版）。
2. 保留目前資料庫，不做破壞性回復。
3. 驗證：
   - [ ] `/health` 正常
   - [ ] 後台登入正常
   - [ ] 付款與查詢基本可用

### 回滾後追蹤

- [ ] 在問題單記錄：時間、版本、requestId、根因
- [ ] 補上測試案例後再重新部署
