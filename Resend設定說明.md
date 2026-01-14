# Resend 郵件服務設定說明

## 📧 什麼是 Resend？

Resend 是一個現代化的郵件服務提供商，專為開發者設計，提供簡單易用的 API 和穩定的郵件發送服務。

### 優點

- ✅ **免費額度**：每月 3,000 封免費郵件
- ✅ **設定簡單**：只需要一個 API Key
- ✅ **穩定可靠**：專為生產環境設計
- ✅ **快速整合**：API 簡單易用
- ✅ **適合 Railway**：在 Railway 等雲端平台運行穩定

## 🚀 快速開始

### 1. 註冊 Resend 帳號

1. 前往 [Resend 官網](https://resend.com/)
2. 點擊「Sign Up」註冊帳號
3. 完成 Email 驗證

### 2. 取得 API Key

1. 登入 Resend 後，前往 [API Keys 頁面](https://resend.com/api-keys)
2. 點擊「Create API Key」
3. 輸入 API Key 名稱（例如：`booking-system`）
4. 選擇權限（選擇「Full Access」）
5. 點擊「Add」建立 API Key
6. **重要**：複製 API Key（格式：`re_xxxxxxxxxxxx`），只會顯示一次！

### 3. 設定到系統中

#### 方法一：管理後台設定（推薦）

1. 登入管理後台
2. 前往「系統設定」→「郵件設定」
3. 在「Resend 發信設定（推薦）」區塊中：
   - 貼上您的 Resend API Key（格式：`re_xxxxxxxxxxxx`）
   - 點擊「儲存設定」
4. **重要**：在「Gmail 發信設定（備用）」區塊中設定「Gmail 帳號」欄位作為發件人信箱
5. **重新啟動伺服器**以套用變更

#### 方法二：環境變數設定

在 Railway 或 `.env` 檔案中設定：

```env
RESEND_API_KEY=re_xxxxxxxxxxxx
```

然後重新啟動伺服器。

## 🔄 郵件服務優先順序

系統會按照以下順序選擇郵件服務：

1. **Resend**（如果已設定 `resend_api_key` 或 `RESEND_API_KEY`）
   - 優先使用資料庫設定（`resend_api_key`）
   - 如果資料庫沒有設定，則使用環境變數（`RESEND_API_KEY`）
2. **Gmail OAuth2**（如果已設定 Gmail OAuth2 憑證）
3. **Gmail 應用程式密碼**（備用方案）

**重要**：
- 如果同時設定了 Resend 和 Gmail，系統會優先使用 Resend
- 如果 Resend 發送失敗，系統會自動切換到 Gmail 備用方案
- 設定來源優先順序：資料庫設定 > 環境變數

## 📝 發件人信箱設定

### Resend 發件人信箱

Resend 需要驗證發件人信箱或網域。有兩種方式：

#### 方式一：使用 Resend 提供的測試信箱（開發階段）

在系統設定中，發件人信箱可以使用：
- `onboarding@resend.dev`（Resend 提供的測試信箱）

#### 方式二：驗證您的網域（生產環境推薦）

1. 前往 Resend → [Domains](https://resend.com/domains)
2. 點擊「Add Domain」
3. 輸入您的網域（例如：`yourdomain.com`）
4. 按照指示設定 DNS 記錄
5. 驗證完成後，可以使用 `noreply@yourdomain.com` 等信箱

### 設定發件人信箱

**重要**：即使使用 Resend，您仍需要在管理後台的「郵件設定」→「Gmail 發信設定」區塊中設定「Gmail 帳號」欄位。這個欄位在 Resend 模式下會作為發件人信箱使用。

發件人信箱的設定順序：
1. 系統會優先使用 `mailOptions.from`（如果郵件發送時有指定）
2. 如果沒有指定，則使用資料庫中的 `email_user` 設定
3. 如果資料庫沒有設定，則使用環境變數 `EMAIL_USER`
4. 最後才會使用預設值

**建議**：在管理後台的「Gmail 發信設定」中設定「Gmail 帳號」欄位，這樣無論使用 Resend 還是 Gmail，發件人信箱都會一致。

## 🔍 測試郵件發送

1. 在管理後台 →「郵件模板」中選擇任一模板
2. 點擊「發送測試郵件」
3. 輸入測試信箱
4. 點擊「發送」

如果設定正確，您應該會收到測試郵件。

## ⚠️ 常見問題

### Q: Resend 和 Gmail 可以同時使用嗎？

A: 可以，但系統會優先使用 Resend。如果 Resend 發送失敗，會自動切換到 Gmail。

### Q: 如何切換回 Gmail？

A: 在管理後台的「郵件設定」→「Resend 發信設定」中，清空「Resend API Key」欄位並儲存，然後重新啟動伺服器。系統會自動切換回使用 Gmail 服務。

### Q: Resend 發送失敗會怎樣？

A: 如果 Resend 發送失敗，系統會自動切換到 Gmail 備用方案（如果已設定 Gmail）。這確保了郵件發送的可靠性。

### Q: Resend API Key 格式是什麼？

A: Resend API Key 通常以 `re_` 開頭，例如：`re_1234567890abcdef`

### Q: 免費額度用完怎麼辦？

A: Resend 提供付費方案，價格合理。也可以設定 Gmail 作為備用方案。

### Q: 需要重新啟動伺服器嗎？

A: 是的，修改郵件設定後需要重新啟動伺服器才能生效。

## 📚 參考資料

- [Resend 官方文件](https://resend.com/docs)
- [Resend API 文件](https://resend.com/docs/api-reference)
- [Resend 定價](https://resend.com/pricing)

## 🎉 完成！

設定完成後，您的系統就會使用 Resend 發送郵件了。Resend 比 Gmail 更穩定，特別是在 Railway 等雲端平台上。


