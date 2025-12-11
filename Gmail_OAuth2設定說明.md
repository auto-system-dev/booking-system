# Gmail OAuth2 認證設定指南

## 📋 為什麼使用 OAuth2？

使用 Gmail OAuth2 認證的優點：
- ✅ **更安全**：不需要儲存應用程式密碼
- ✅ **不會被 IP 阻擋**：OAuth2 使用 token 認證，不受 IP 限制
- ✅ **解決連接超時問題**：Railway 環境可以正常連接
- ✅ **適合生產環境**：Google 推薦的認證方式

---

## 🔧 設定步驟

### 第一步：在 Google Cloud Console 建立專案

1. **前往 Google Cloud Console**
   - 網址：https://console.cloud.google.com/
   - 使用您的 Gmail 帳號登入

2. **建立新專案**
   - 點擊左上角的專案選擇器
   - 點擊「新增專案」
   - 輸入專案名稱（例如：`booking-system-email`）
   - 點擊「建立」

3. **啟用 Gmail API**
   - 在左側選單中，點擊「API 和服務」→「程式庫」
   - 搜尋「Gmail API」
   - 點擊「Gmail API」
   - 點擊「啟用」

---

### 第二步：建立 OAuth2 憑證

1. **建立 OAuth 同意畫面**
   - 在左側選單中，點擊「API 和服務」→「OAuth 同意畫面」
   - 選擇「外部」（除非您有 Google Workspace）
   - 點擊「建立」
   - 填寫應用程式資訊：
     - **應用程式名稱**：訂房系統（或您喜歡的名稱）
     - **使用者支援電子郵件**：您的 Gmail 帳號
     - **開發人員聯絡資訊**：您的 Gmail 帳號
   - 點擊「儲存並繼續」
   - 在「範圍」頁面，點擊「儲存並繼續」
   - 在「測試使用者」頁面，點擊「儲存並繼續」
   - 在「摘要」頁面，點擊「返回資訊主頁」

2. **建立 OAuth2 用戶端 ID**
   - 在左側選單中，點擊「API 和服務」→「憑證」
   - 點擊「建立憑證」→「OAuth 用戶端 ID」
   - **應用程式類型**：**必須選擇「網頁應用程式」**（⚠️ 不要選錯！）
   - **名稱**：輸入名稱（例如：`booking-system`）
   - **已授權的重新導向 URI**：
     - **如果使用 OAuth2 Playground 取得 Refresh Token**（推薦）：
       - 新增：`https://developers.google.com/oauthplayground`
     - 如果是本地測試：
       - 新增：`http://localhost:3000/auth/google/callback`
     - 如果是 Railway：
       - 新增：`https://your-app.railway.app/auth/google/callback`
     - **注意**：可以同時新增多個 URI，每個一行
   - 點擊「建立」
   - **重要**：複製並保存（⚠️ Client Secret 只會顯示一次！）：
     - **用戶端 ID**（Client ID）- 格式類似：`123456789-abcdefghijklmnop.apps.googleusercontent.com`
     - **用戶端密鑰**（Client Secret）- 格式類似：`GOCSPX-abcdefghijklmnopqrstuvwxyz`
   - **⚠️ 如果忘記 Client Secret**：需要刪除並重新建立 OAuth 客戶端

---

### 第三步：取得 Refresh Token

有兩種方式可以取得 Refresh Token：

#### 方法 1：使用 Google OAuth2 Playground（推薦）

1. **前往 OAuth2 Playground**
   - 網址：https://developers.google.com/oauthplayground/

2. **設定 OAuth2 參數**
   - 點擊右上角的「設定」圖示（齒輪）
   - 勾選「Use your own OAuth credentials」
   - 輸入您的 **Client ID** 和 **Client Secret**
   - 點擊「Close」

3. **授權並取得 Token**
   - 在左側，找到「Gmail API v1」
   - 勾選 `https://mail.google.com/`（或 `https://www.googleapis.com/auth/gmail.send`）
   - 點擊「Authorize APIs」
   - 登入您的 Gmail 帳號
   - **如果看到「這個應用程式未經 Google 驗證」警告**：
     - 這是正常的，因為應用程式處於測試階段
     - 點擊「繼續」（Continue）按鈕
     - 如果出現「進階」連結，可以點擊展開更多選項
     - 點擊「前往「訂房系統」（不安全）」或類似的連結
   - 確認授權權限（允許應用程式存取您的 Gmail）
   - 回到 OAuth2 Playground，點擊「Exchange authorization code for tokens」
   - **複製 Refresh Token**（這是最重要的！）

#### 方法 2：使用 Node.js 腳本（進階）

如果您想要使用程式碼取得 Refresh Token，可以建立一個臨時腳本：

```javascript
const { google } = require('googleapis');
const readline = require('readline');

const oauth2Client = new google.auth.OAuth2(
    'YOUR_CLIENT_ID',
    'YOUR_CLIENT_SECRET',
    'http://localhost:3000/auth/google/callback'
);

const scopes = ['https://mail.google.com/'];

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes
});

console.log('請訪問這個 URL 並授權：');
console.log(authUrl);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('請輸入授權碼：', (code) => {
    oauth2Client.getToken(code, (err, token) => {
        if (err) {
            console.error('取得 Token 失敗:', err);
            return;
        }
        console.log('Refresh Token:', token.refresh_token);
        rl.close();
    });
});
```

---

### 第四步：設定環境變數

在 Railway 的「Variables」標籤中，或在本地 `.env` 檔案中，新增以下環境變數：

| 變數名稱 | 值 | 說明 |
|---------|-----|------|
| `EMAIL_USER` | `cheng701107@gmail.com` | 您的 Gmail 帳號 |
| `GMAIL_CLIENT_ID` | `您的 Client ID` | 從 Google Cloud Console 取得 |
| `GMAIL_CLIENT_SECRET` | `您的 Client Secret` | 從 Google Cloud Console 取得 |
| `GMAIL_REFRESH_TOKEN` | `您的 Refresh Token` | 從 OAuth2 Playground 取得 |

**本地 `.env` 檔案範例：**

```env
EMAIL_USER=cheng701107@gmail.com
GMAIL_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz
GMAIL_REFRESH_TOKEN=1//abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz
```

---

## 🚀 程式碼設定

系統會自動偵測是否使用 OAuth2：
- 如果設定了 `GMAIL_CLIENT_ID`、`GMAIL_CLIENT_SECRET` 和 `GMAIL_REFRESH_TOKEN`，會自動使用 OAuth2
- 如果沒有設定，會使用應用程式密碼（備用方案）

---

## 📝 注意事項

1. **Refresh Token 安全**
   - Refresh Token 是長期有效的，請妥善保管
   - 不要將 Refresh Token 提交到公開程式碼
   - 如果洩露，可以在 Google Cloud Console 中撤銷

2. **Token 有效期**
   - Access Token 會自動刷新
   - Refresh Token 通常不會過期（除非手動撤銷）

3. **測試環境**
   - 在測試階段，OAuth 同意畫面會顯示「未驗證的應用程式」警告
   - 這是正常的，點擊「繼續」即可
   - 正式上線時可以提交驗證

4. **已授權的重新導向 URI**
   - 如果使用 OAuth2 Playground，不需要設定重新導向 URI
   - 如果使用自己的應用程式，需要在 Google Cloud Console 中設定正確的 URI

---

## 🔍 驗證設定

設定完成後，系統會自動：
1. 使用 OAuth2 認證（如果環境變數已設定）
2. 自動刷新 Access Token
3. 發送郵件

查看 Railway 日誌，應該會看到：
```
📧 郵件服務已設定（OAuth2 認證）
   使用帳號: cheng701107@gmail.com
   認證方式: OAuth2
```

---

## ❓ 常見問題

### 錯誤：401: invalid_client

**錯誤訊息：**
- "The OAuth client was not found"
- "已封鎖存取權: 授權錯誤"
- "發生錯誤 401: invalid_client"

**可能原因和解決方法：**

1. **Client ID 或 Client Secret 不正確**
   - 檢查 Google Cloud Console → API 和服務 → 憑證
   - 確認複製的 Client ID 和 Client Secret 完整且正確
   - 注意：Client Secret 通常以 `GOCSPX-` 開頭

2. **OAuth 客戶端未建立**
   - 前往 Google Cloud Console → API 和服務 → 憑證
   - 確認已建立「OAuth 用戶端 ID」
   - 如果沒有，請按照「第二步：建立 OAuth2 憑證」重新建立

3. **應用程式類型錯誤**
   - 確認建立的 OAuth 客戶端類型是「網頁應用程式」
   - 不是「桌面應用程式」或「行動應用程式」

4. **Gmail API 未啟用**
   - 前往 Google Cloud Console → API 和服務 → 程式庫
   - 搜尋「Gmail API」並確認已啟用
   - 如果未啟用，點擊「啟用」

5. **OAuth 同意畫面未設定**
   - 前往 Google Cloud Console → API 和服務 → OAuth 同意畫面
   - 確認已建立並完成設定
   - 至少需要填寫應用程式名稱和使用者支援電子郵件

6. **在 OAuth2 Playground 中設定錯誤**
   - 確認在 OAuth2 Playground 中勾選了「Use your own OAuth credentials」
   - 確認輸入的 Client ID 和 Client Secret 正確
   - 確認選擇的範圍是 `https://mail.google.com/` 或 `https://www.googleapis.com/auth/gmail.send`

**排查步驟：**

1. 重新檢查 Google Cloud Console 設定：
   ```
   ✅ 專案已建立
   ✅ Gmail API 已啟用
   ✅ OAuth 同意畫面已設定
   ✅ OAuth 用戶端 ID 已建立（類型：網頁應用程式）
   ✅ 已複製正確的 Client ID 和 Client Secret
   ```

2. 在 OAuth2 Playground 中重新設定：
   - 清除瀏覽器快取
   - 重新開啟 OAuth2 Playground
   - 重新輸入 Client ID 和 Client Secret
   - 重新授權

3. 如果仍然失敗，嘗試建立新的 OAuth 客戶端：
   - 在 Google Cloud Console 中刪除舊的客戶端
   - 重新建立新的 OAuth 客戶端
   - 使用新的 Client ID 和 Client Secret

---

### 錯誤：403: access_denied

**錯誤訊息：**
- "已封鎖存取權: 「訂房系統」未完成 Google 驗證程序"
- "這個應用程式目前處於測試階段，只有獲得開發人員核准的測試人員可以存取"
- "發生錯誤 403: access_denied"

**原因說明：**
這個錯誤表示您的 OAuth 客戶端設定正確（不再是 401），但應用程式處於「測試」階段，只有被加入測試使用者清單的帳號才能使用。

**解決方法：**

1. **將您的 Gmail 帳號加入測試使用者清單**
   - 前往 Google Cloud Console → API 和服務 → OAuth 同意畫面
   - 向下滾動到「測試使用者」區塊
   - 點擊「+ 新增使用者」
   - 輸入您的 Gmail 帳號（例如：`cheng701107@gmail.com`）
   - 點擊「新增」
   - **重要**：可以新增多個測試使用者

2. **重新授權**
   - 回到 OAuth2 Playground
   - 重新點擊「Authorize APIs」
   - 這次應該可以成功授權

3. **（可選）發布應用程式（僅供個人使用）**
   - 如果您只會自己使用，可以跳過 Google 驗證
   - 在 OAuth 同意畫面中，點擊「發布應用程式」
   - 選擇「發布」並確認
   - **注意**：發布後，任何 Google 帳號都可以使用，但不需要 Google 驗證

**重要提醒：**
- 測試階段最多可以新增 **100 個測試使用者**
- 每個需要使用此應用程式的 Gmail 帳號都必須加入測試使用者清單
- 如果應用程式需要給公眾使用，需要完成 Google 驗證程序（較複雜，需要提交審核）

---

**Q: Refresh Token 在哪裡可以找到？**
A: 在 OAuth2 Playground 中，授權後點擊「Exchange authorization code for tokens」，Refresh Token 會顯示在回應中。

**Q: 如果 Refresh Token 過期了怎麼辦？**
A: 重新在 OAuth2 Playground 中授權並取得新的 Refresh Token。

**Q: 可以同時使用多個 Gmail 帳號嗎？**
A: 可以，每個帳號需要各自的 OAuth2 憑證和 Refresh Token。

**Q: OAuth2 和應用程式密碼有什麼差別？**
A: 
- **應用程式密碼**：簡單但可能被 IP 阻擋，不適合生產環境
- **OAuth2**：更安全，不會被 IP 阻擋，適合生產環境

**Q: 為什麼 Railway 環境建議使用 OAuth2？**
A: Railway 的 IP 可能被 Gmail 阻擋，導致連接超時。OAuth2 使用 token 認證，不受 IP 限制。

---

## 📚 參考資料

- Google OAuth2 文件：https://developers.google.com/identity/protocols/oauth2
- Gmail API 文件：https://developers.google.com/gmail/api
- OAuth2 Playground：https://developers.google.com/oauthplayground/
- Nodemailer OAuth2 文件：https://nodemailer.com/smtp/oauth2/

---

## 🔄 從應用程式密碼切換到 OAuth2

如果您目前使用應用程式密碼，想要切換到 OAuth2：

1. 按照上述步驟設定 OAuth2
2. 在 Railway 環境變數中新增：
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`
3. 保留 `EMAIL_USER`（仍然需要）
4. 可以移除 `EMAIL_PASS`（不再需要）
5. 重新部署應用程式

系統會自動偵測並使用 OAuth2 認證。

