# Railway 環境變數設定指南

## 🔐 設定 SESSION_SECRET 環境變數

### 步驟 1：生成隨機字串

#### 方法 1：使用 PowerShell（Windows）

打開 PowerShell，執行以下命令：

```powershell
# 生成 32 位隨機字串
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

或者使用更簡單的方式：

```powershell
# 使用 .NET 方法生成隨機字串
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

#### 方法 2：使用線上工具

訪問以下網站生成隨機字串：
- https://www.random.org/strings/
- https://randomkeygen.com/

建議設定：
- 長度：至少 32 個字元
- 類型：字母和數字混合

#### 方法 3：使用 Node.js

如果您有 Node.js 環境，可以執行：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

### 步驟 2：在 Railway 後台設定環境變數

#### 詳細步驟：

1. **登入 Railway**
   - 訪問 https://railway.app
   - 使用您的帳號登入

2. **選擇專案和服務**
   - 在 Dashboard 中找到 `booking-system` 專案
   - 點擊進入專案
   - 選擇 `booking-system` 服務（或您的服務名稱）

3. **進入 Variables 標籤**
   - 在服務頁面中，點擊頂部的 **Variables** 標籤
   - 或點擊左側選單的 **Variables**

4. **新增環境變數**
   - 點擊 **New Variable** 按鈕
   - 或點擊 **+ Add Variable** 按鈕

5. **輸入變數資訊**
   - **Variable Name（變數名稱）**：輸入 `SESSION_SECRET`
   - **Value（值）**：貼上剛才生成的隨機字串
   - 例如：
     ```
     Variable Name: SESSION_SECRET
     Value: aB3xK9mP2qR7vT5wY8zN1cF4hJ6gL0sD
     ```

6. **儲存設定**
   - 點擊 **Add** 或 **Save** 按鈕
   - Railway 會自動觸發重新部署

---

### 步驟 3：設定其他建議的環境變數

同時建議設定以下環境變數：

#### ADMIN_DEFAULT_PASSWORD（選填）

```
Variable Name: ADMIN_DEFAULT_PASSWORD
Value: admin123
```

**說明：** 如果不設定，預設值為 `admin123`

#### ADMIN_EMAIL（選填）

```
Variable Name: ADMIN_EMAIL
Value: admin@example.com
```

**說明：** 管理員的 Email 地址（可選）

---

### 步驟 4：驗證設定是否成功

#### 方法 1：檢查 Railway 日誌

1. 在 Railway 服務頁面，點擊 **Deployments** 標籤
2. 查看最新的部署日誌
3. 確認沒有看到 Session 相關的錯誤訊息

#### 方法 2：檢查應用程式行為

1. 訪問您的應用：`https://your-app-name.railway.app/admin`
2. 嘗試登入
3. 如果登入後可以正常使用，表示 Session 設定成功

#### 方法 3：查看環境變數（進階）

如果 Railway 提供查看環境變數的功能，可以確認：
- `SESSION_SECRET` 是否存在
- 值是否正確設定

---

## 📋 完整的環境變數清單

### 必要環境變數

| 變數名稱 | 說明 | 範例值 | 是否必填 |
|---------|------|--------|:--------:|
| `SESSION_SECRET` | Session 加密密鑰 | `aB3xK9mP2qR7vT5wY8zN1cF4hJ6gL0sD` | ✅ **必填** |

### 選填環境變數

| 變數名稱 | 說明 | 預設值 | 是否必填 |
|---------|------|--------|:--------:|
| `ADMIN_DEFAULT_PASSWORD` | 預設管理員密碼 | `admin123` | ❌ 選填 |
| `ADMIN_EMAIL` | 管理員 Email | 空字串 | ❌ 選填 |
| `NODE_ENV` | 環境模式 | `development` | ❌ 選填 |

### 資料庫相關（如果使用 PostgreSQL）

| 變數名稱 | 說明 | 是否必填 |
|---------|------|:--------:|
| `DATABASE_URL` | PostgreSQL 連接字串 | ✅ 如果使用 PostgreSQL |

---

## 🔒 安全性建議

### 1. SESSION_SECRET 設定建議

- ✅ **長度**：至少 32 個字元，建議 64 個字元
- ✅ **複雜度**：包含大小寫字母、數字和特殊字元
- ✅ **唯一性**：每個應用程式使用不同的 SESSION_SECRET
- ✅ **保密性**：不要將 SESSION_SECRET 提交到 Git 倉庫

### 2. 生產環境注意事項

- ⚠️ **不要使用預設值**：`your-secret-key-change-this-in-production`
- ⚠️ **定期更換**：建議定期更換 SESSION_SECRET（會導致所有使用者需要重新登入）
- ⚠️ **不要分享**：不要將 SESSION_SECRET 分享給他人

---

## 🚨 常見問題

### Q1: 設定環境變數後需要重新部署嗎？

**A:** Railway 會自動觸發重新部署。如果沒有自動部署，可以手動點擊 **Deploy** 按鈕。

### Q2: 如何修改已設定的環境變數？

**A:** 
1. 進入 Variables 標籤
2. 找到要修改的變數
3. 點擊變數右側的編輯圖示（鉛筆圖示）
4. 修改值後儲存

### Q3: 如何刪除環境變數？

**A:**
1. 進入 Variables 標籤
2. 找到要刪除的變數
3. 點擊變數右側的刪除圖示（垃圾桶圖示）
4. 確認刪除

### Q4: 設定環境變數後，應用程式還是使用舊值？

**A:**
1. 確認環境變數已正確儲存
2. 等待 Railway 完成重新部署
3. 清除瀏覽器快取和 Cookie
4. 重新訪問應用程式

### Q5: 忘記設定的 SESSION_SECRET 怎麼辦？

**A:**
1. 在 Railway 後台查看 Variables
2. 如果看不到值（Railway 可能會隱藏），需要重新生成並設定
3. 重新設定後，所有使用者的 Session 會失效，需要重新登入

---

## 📸 Railway 操作截圖說明

### 1. 找到 Variables 標籤

在服務頁面頂部，您會看到多個標籤：
- **Deployments** - 部署記錄
- **Variables** - 環境變數 ← **點擊這裡**
- **Settings** - 設定
- **Metrics** - 監控指標

### 2. 新增環境變數

在 Variables 頁面：
- 點擊 **New Variable** 或 **+ Add Variable**
- 輸入變數名稱和值
- 點擊 **Add** 或 **Save**

### 3. 編輯環境變數

在變數列表中：
- 每個變數右側有編輯和刪除按鈕
- 點擊編輯按鈕可以修改值
- 點擊刪除按鈕可以刪除變數

---

## ✅ 設定完成檢查清單

- [ ] 已生成隨機的 SESSION_SECRET（至少 32 個字元）
- [ ] 已在 Railway 後台設定 SESSION_SECRET 環境變數
- [ ] Railway 已自動觸發重新部署
- [ ] 部署完成後，可以正常登入管理後台
- [ ] 登入後 Session 正常運作（不會立即登出）

---

**最後更新：** 2024年

