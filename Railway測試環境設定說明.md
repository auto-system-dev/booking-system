# Railway 測試環境設定說明

## ✅ 可以在 Railway 使用測試參數

**是的，Railway 可以使用測試參數！** 系統會根據 `NODE_ENV` 環境變數來判斷使用哪組參數。

## 🔍 環境判斷邏輯

系統的判斷邏輯如下：

```javascript
if (NODE_ENV === 'production') {
    // 使用正式環境參數
    // ECPAY_MERCHANT_ID_PROD
    // ECPAY_HASH_KEY_PROD
    // ECPAY_HASH_IV_PROD
} else {
    // 使用測試環境參數
    // ECPAY_MERCHANT_ID (預設: 2000132)
    // ECPAY_HASH_KEY (預設: 5294y06JbISpM5x9)
    // ECPAY_HASH_IV (預設: v77hoKGq4kWxNNIS)
}
```

## 🧪 在 Railway 使用測試參數

### 方法 1：不設定 NODE_ENV（推薦）

**最簡單的方式：**

1. 在 Railway 後台，點擊 `booking-system` 服務
2. 進入 **Variables** 標籤
3. **不要設定** `NODE_ENV`，或刪除它（如果已存在）
4. 系統會自動使用測試環境參數

**結果：**
- ✅ 使用測試環境的 MerchantID（2000132）
- ✅ 使用測試環境的 API 端點（`payment-stage.ecpay.com.tw`）
- ✅ 不會真的扣款，適合測試

### 方法 2：明確設定為測試環境

1. 在 Railway 後台，點擊 `booking-system` 服務
2. 進入 **Variables** 標籤
3. 設定：
   ```
   NODE_ENV=development
   ```
   或
   ```
   NODE_ENV=test
   ```
4. 系統會使用測試環境參數

### 方法 3：使用環境變數覆蓋（可選）

如果需要使用自己的測試帳號：

1. 在 Railway 後台設定：
   ```
   NODE_ENV=development
   ECPAY_MERCHANT_ID=2000132
   ECPAY_HASH_KEY=5294y06JbISpM5x9
   ECPAY_HASH_IV=v77hoKGq4kWxNNIS
   ```

## 💰 在 Railway 使用正式參數

如果要在 Railway 使用正式環境參數：

1. 在 Railway 後台設定：
   ```
   NODE_ENV=production
   ECPAY_MERCHANT_ID_PROD=您的正式商店代號
   ECPAY_HASH_KEY_PROD=您的正式HashKey
   ECPAY_HASH_IV_PROD=您的正式HashIV
   ```

## 📋 環境變數對照表

| 環境 | NODE_ENV | 使用的參數 | API 端點 |
|------|----------|-----------|---------|
| **測試環境** | `development`、`test` 或**未設定** | `ECPAY_MERCHANT_ID`<br>`ECPAY_HASH_KEY`<br>`ECPAY_HASH_IV` | `payment-stage.ecpay.com.tw` |
| **正式環境** | `production` | `ECPAY_MERCHANT_ID_PROD`<br>`ECPAY_HASH_KEY_PROD`<br>`ECPAY_HASH_IV_PROD` | `payment.ecpay.com.tw` |

## 🔍 如何確認當前環境

部署後，查看伺服器日誌：

### 測試環境會顯示：
```
🌍 當前環境: 測試環境 (Test)
🧪 使用測試環境設定
📋 綠界設定:
- MerchantID: 2000****
- HashKey: 已設定
- HashIV: 已設定
```

### 正式環境會顯示：
```
🌍 當前環境: 正式環境 (Production)
💰 使用正式環境設定
📋 綠界設定:
- MerchantID: [您的正式商店代號]
- HashKey: 已設定
- HashIV: 已設定
```

## ⚠️ 重要提醒

### 測試環境
- ✅ 可以使用測試參數（2000132）
- ✅ 不會真的扣款
- ✅ 適合開發和測試
- ⚠️ 綠界會檢查，如果在正式 API 端點使用測試 MerchantID 會報錯（10200094）

### 正式環境
- ✅ 會真的扣款
- ✅ 需要申請正式商店帳號
- ⚠️ 必須使用正式環境的 MerchantID、HashKey、HashIV
- ⚠️ 如果使用測試 MerchantID（2000132）會報錯（10200094）

## 🎯 建議設定

### 開發/測試階段
```
NODE_ENV=development
（或不設定 NODE_ENV）
```

### 正式上線
```
NODE_ENV=production
ECPAY_MERCHANT_ID_PROD=您的正式商店代號
ECPAY_HASH_KEY_PROD=您的正式HashKey
ECPAY_HASH_IV_PROD=您的正式HashIV
```

## 📝 總結

**Railway 可以使用測試參數！** 只需要：
1. **不要設定** `NODE_ENV=production`
2. 系統會自動使用測試環境參數（預設值）
3. 可以正常測試支付功能，不會真的扣款

如果遇到錯誤 10200094，通常是因為：
- 設定了 `NODE_ENV=production`，但沒有設定正式環境參數
- 或使用了正式 API 端點但傳入了測試 MerchantID

解決方法：
- 如果要測試：移除或修改 `NODE_ENV` 為 `development`
- 如果要正式上線：設定 `NODE_ENV=production` 並提供正式環境參數

