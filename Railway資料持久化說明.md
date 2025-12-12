# Railway 資料持久化說明

## 📊 資料持久化狀態

### ✅ 如果使用 PostgreSQL（推薦）

**資料會持久化保存** ✅

如果您的 Railway 專案中：
1. 有建立 **PostgreSQL** 服務
2. 設定了 `DATABASE_URL` 環境變數
3. 系統會自動使用 PostgreSQL

**資料持久化保證：**
- ✅ 資料儲存在 PostgreSQL 資料庫服務中
- ✅ 關閉服務後再開啟，資料**仍然存在**
- ✅ 重新部署應用程式，資料**不會遺失**
- ✅ Railway 的 PostgreSQL 服務會持續運行，資料永久保存

**如何確認是否使用 PostgreSQL：**
1. 在 Railway 後台查看您的專案
2. 檢查是否有 **PostgreSQL** 服務（通常顯示為 "Postgres" 或 "PostgreSQL"）
3. 檢查 **booking-system** 服務的環境變數中是否有 `DATABASE_URL`
4. 查看伺服器日誌，應該看到：
   ```
   🗄️  使用 PostgreSQL 資料庫
   ✅ PostgreSQL 連接池已建立
   ```

### ⚠️ 如果使用 SQLite（不推薦）

**資料不會持久化** ❌

如果您的 Railway 專案中：
1. **沒有** PostgreSQL 服務
2. **沒有**設定 `DATABASE_URL` 環境變數
3. 系統會使用 SQLite（本地檔案資料庫）

**資料持久化問題：**
- ❌ 資料儲存在應用程式的檔案系統中
- ❌ Railway 的檔案系統是**臨時的**
- ❌ 關閉服務後再開啟，資料**可能會遺失**
- ❌ 重新部署應用程式，資料**會遺失**

**解決方案：**
- 使用 **Railway Volume** 來持久化 SQLite 檔案（見下方說明）
- 或遷移到 **PostgreSQL**（強烈推薦）

## 🔍 如何確認資料是否會持久化

### 方法 1：檢查 Railway 後台

1. 登入 [Railway](https://railway.app)
2. 選擇您的專案
3. 查看服務列表：
   - ✅ 如果有 **PostgreSQL** 服務 → 資料會持久化
   - ❌ 如果只有 **booking-system** 服務 → 資料不會持久化

### 方法 2：檢查環境變數

1. 在 Railway 後台，點擊 **booking-system** 服務
2. 進入 **Variables** 標籤
3. 查看是否有 `DATABASE_URL`：
   - ✅ 如果有 → 資料會持久化（使用 PostgreSQL）
   - ❌ 如果沒有 → 資料不會持久化（使用 SQLite）

### 方法 3：查看伺服器日誌

1. 在 Railway 後台，點擊 **booking-system** 服務
2. 進入 **Deployments** 標籤
3. 點擊最新的部署記錄
4. 查看 **Logs**：
   - ✅ 看到 `🗄️  使用 PostgreSQL 資料庫` → 資料會持久化
   - ❌ 看到 `✅ 已連接到 SQLite 資料庫` → 資料不會持久化

## 🛠️ 如何確保資料持久化

### 方案 1：使用 PostgreSQL（強烈推薦）

#### 步驟 1：建立 PostgreSQL 服務

1. 在 Railway 後台，選擇您的專案
2. 點擊「**+ New**」→「**Database**」→「**Add PostgreSQL**」
3. Railway 會自動：
   - 建立 PostgreSQL 服務
   - 設定 `DATABASE_URL` 環境變數
   - 連接到 booking-system 服務

#### 步驟 2：確認連接

1. Railway 會自動重新部署應用程式
2. 查看伺服器日誌，確認看到：
   ```
   🗄️  使用 PostgreSQL 資料庫
   ✅ PostgreSQL 連接池已建立
   ✅ 訂房資料表已準備就緒
   ```

#### 步驟 3：測試

1. 在管理後台建立一筆測試訂房記錄
2. 關閉服務（如果需要的話）
3. 重新開啟服務
4. 檢查訂房記錄是否還在 ✅

### 方案 2：使用 Volume 持久化 SQLite（臨時方案）

如果暫時不想遷移到 PostgreSQL，可以使用 Volume：

#### 步驟 1：建立 Volume

1. 在 Railway 後台，選擇您的專案
2. 點擊「**+ New**」→「**Volume**」
3. 設定：
   - **Name**: `database`
   - **Mount Path**: `/data`

#### 步驟 2：修改程式碼

需要修改 `database.js` 使用 Volume 路徑：

```javascript
// 在 Railway 上使用 Volume，本地使用當前目錄
const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILUME_VOLUME_MOUNT_PATH, 'bookings.db')
    : path.join(__dirname, 'bookings.db');
```

#### 步驟 3：設定環境變數

在 Railway 環境變數中設定：
```
RAILWAY_VOLUME_MOUNT_PATH=/data
```

## 📝 關於 "Keep" 功能

Railway 的 "Keep" 功能通常是指：
- **Keep Service Alive**：保持服務運行（避免休眠）
- **Keep Deployment**：保留部署記錄

**重要：**
- "Keep" 功能**不會**影響資料持久化
- 資料持久化取決於**資料庫類型**（PostgreSQL vs SQLite）
- 即使服務休眠，PostgreSQL 的資料仍然存在

## ✅ 總結

### 資料會持久化的情況：
- ✅ 使用 PostgreSQL + 有設定 `DATABASE_URL`
- ✅ 使用 SQLite + 有設定 Volume

### 資料不會持久化的情況：
- ❌ 使用 SQLite + 沒有設定 Volume
- ❌ 資料只存在於臨時檔案系統中

## 🔧 建議

**強烈建議使用 PostgreSQL**，因為：
1. ✅ Railway 提供免費的 PostgreSQL 服務
2. ✅ 資料自動持久化，不需要額外設定
3. ✅ 更適合生產環境
4. ✅ 支援更好的並發處理
5. ✅ 有完整的備份機制

## 🆘 如果資料遺失了

如果發現資料遺失，可能是：
1. 使用了 SQLite 且沒有 Volume
2. PostgreSQL 服務被刪除
3. `DATABASE_URL` 環境變數被移除

**解決方案：**
1. 立即建立 PostgreSQL 服務
2. 確認 `DATABASE_URL` 已設定
3. 重新部署應用程式
4. 資料會自動初始化（但舊資料無法恢復）

## 📞 需要幫助？

如果您不確定目前的設定，可以：
1. 檢查 Railway 後台的服務列表
2. 檢查環境變數
3. 查看伺服器日誌
4. 或告訴我您的 Railway 後台顯示的服務列表，我可以幫您確認


