# Railway 部署問題修復清單

## ✅ 已修復的問題

### 1. 資料庫連接問題（SQLITE_ERROR: no such table: room_types）

**問題原因：**
- `/api/admin/room-types` API 端點仍使用舊的 SQLite 直接連接
- 沒有使用新的資料庫抽象層

**已修復：**
- ✅ 修改 `/api/admin/room-types` 使用 `db.getAllRoomTypesAdmin()`
- ✅ 新增 `getAllRoomTypesAdmin()` 函數（包含已停用的房型）
- ✅ 所有資料庫操作現在都使用統一的抽象層

**需要確認：**
- [ ] Railway 上是否設定了 `DATABASE_URL` 環境變數
- [ ] 重新部署後檢查伺服器日誌是否顯示 "✅ PostgreSQL 連接池已建立"

### 2. 綠界支付錯誤（10200094 - 正式環境誤用測試環境 MerchantID）

**問題原因：**
- 在正式環境（Railway）使用了測試環境的 MerchantID（2000132）
- 沒有設定正式環境的綠界支付參數

**解決方案：**

#### 步驟 1：確認環境變數

在 Railway 後台，檢查 `booking-system` 服務的環境變數：

1. 登入 Railway 後台
2. 點擊 `booking-system` 服務
3. 進入 **Variables** 標籤
4. 確認以下環境變數：

**必須設定：**
- [ ] `NODE_ENV=production` （必須設為 `production`）
- [ ] `DATABASE_URL` （PostgreSQL 連接字串）

**綠界支付正式環境（必須設定其中一組）：**

**選項 A：使用環境變數（推薦）**
- [ ] `ECPAY_MERCHANT_ID_PROD=您的正式商店代號`
- [ ] `ECPAY_HASH_KEY_PROD=您的正式HashKey`
- [ ] `ECPAY_HASH_IV_PROD=您的正式HashIV`

**選項 B：使用資料庫設定**
- [ ] 在管理後台的「系統設定」中設定：
  - `ecpay_merchant_id_prod`
  - `ecpay_hash_key_prod`
  - `ecpay_hash_iv_prod`

#### 步驟 2：取得正式環境參數

如果您還沒有正式環境的參數：

1. 前往 https://www.ecpay.com.tw/
2. 註冊並申請商店帳號
3. 登入綠界商店後台
4. 取得正式環境的：
   - MerchantID（商店代號）
   - HashKey（金鑰）
   - HashIV（向量）

#### 步驟 3：設定環境變數

在 Railway 後台設定：

1. 點擊 `booking-system` 服務
2. 進入 **Variables** 標籤
3. 點擊 **+ New Variable**
4. 依序添加：
   ```
   Name: NODE_ENV
   Value: production
   
   Name: ECPAY_MERCHANT_ID_PROD
   Value: 您的正式商店代號
   
   Name: ECPAY_HASH_KEY_PROD
   Value: 您的正式HashKey
   
   Name: ECPAY_HASH_IV_PROD
   Value: 您的正式HashIV
   ```
5. 儲存後，Railway 會自動重新部署

#### 步驟 4：驗證設定

部署完成後，檢查伺服器日誌：

1. 在 Railway 後台，點擊 `booking-system` 服務
2. 進入 **Deployments** 標籤
3. 點擊最新的部署記錄
4. 查看 **Logs**，應該看到：
   ```
   🌍 當前環境: 正式環境 (Production)
   💰 使用正式環境設定
   綠界設定:
   - MerchantID: [您的正式商店代號]
   - HashKey: [已設定]
   - HashIV: [已設定]
   ```

## 🔍 完整檢查清單

### 資料庫連接
- [ ] `DATABASE_URL` 環境變數已設定
- [ ] PostgreSQL 服務顯示 "Online"
- [ ] 伺服器日誌顯示 "✅ PostgreSQL 連接池已建立"
- [ ] 伺服器日誌顯示 "✅ 訂房資料表已準備就緒"
- [ ] 管理後台可以正常載入房型列表

### 綠界支付
- [ ] `NODE_ENV=production` 已設定
- [ ] `ECPAY_MERCHANT_ID_PROD` 已設定（或使用資料庫設定）
- [ ] `ECPAY_HASH_KEY_PROD` 已設定（或使用資料庫設定）
- [ ] `ECPAY_HASH_IV_PROD` 已設定（或使用資料庫設定）
- [ ] 伺服器日誌顯示 "💰 使用正式環境設定"
- [ ] 測試支付功能正常

## 🆘 如果還有問題

### 資料庫問題
1. 檢查 Railway 日誌是否有錯誤訊息
2. 確認 PostgreSQL 服務是否正常運行
3. 確認 `DATABASE_URL` 格式是否正確

### 綠界支付問題
1. 檢查伺服器日誌中的「綠界設定」部分
2. 確認 MerchantID 不是 `2000132`（測試環境的）
3. 確認 `NODE_ENV` 確實設為 `production`
4. 如果使用資料庫設定，確認管理後台的設定是否正確

## 📝 注意事項

1. **環境變數優先級**：
   - 環境變數 > 資料庫設定 > 預設值
   - 正式環境會優先使用 `ECPAY_MERCHANT_ID_PROD`，如果沒有才使用資料庫設定

2. **測試環境 vs 正式環境**：
   - 測試環境：使用 `ECPAY_MERCHANT_ID`（或預設 2000132）
   - 正式環境：使用 `ECPAY_MERCHANT_ID_PROD`（必須設定）

3. **重新部署**：
   - 修改環境變數後，Railway 會自動重新部署
   - 部署完成後，檢查日誌確認設定是否正確

