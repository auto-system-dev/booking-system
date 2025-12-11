# Railway 資料庫連接檢查指南

## 🔍 檢查步驟

### 步驟 1：確認 PostgreSQL 服務

從您的架構圖看到有兩個 PostgreSQL 實例：
- **Postgres** - 已顯示連接箭頭到 booking-system
- **Postgres-46ii** - 沒有連接

**建議：**
- 如果只需要一個資料庫，可以刪除多餘的 PostgreSQL 實例
- 保留與 booking-system 有連接的那個（通常是第一個建立的）

### 步驟 2：檢查環境變數

1. 在 Railway 後台，點擊 **booking-system** 服務
2. 進入 **Variables** 標籤
3. 確認是否有 `DATABASE_URL` 環境變數
4. 如果沒有，需要手動設定

### 步驟 3：設定 DATABASE_URL（如果需要）

如果 `DATABASE_URL` 不存在，需要手動設定：

1. 點擊 **Postgres** 服務（要連接的那個）
2. 進入 **Variables** 標籤
3. 找到 `DATABASE_URL` 或 `POSTGRES_URL`
4. 複製完整的連接字串（格式：`postgresql://user:password@host:port/database`）
5. 回到 **booking-system** 服務
6. 在 **Variables** 標籤中，點擊 **+ New Variable**
7. 設定：
   - **Name**: `DATABASE_URL`
   - **Value**: 貼上剛才複製的連接字串
8. 儲存後，Railway 會自動重新部署

### 步驟 4：驗證連接

部署完成後，檢查伺服器日誌：

1. 在 Railway 後台，點擊 **booking-system** 服務
2. 進入 **Deployments** 標籤
3. 點擊最新的部署記錄
4. 查看 **Logs**，應該看到：
   ```
   🗄️  使用 PostgreSQL 資料庫
   ✅ PostgreSQL 連接池已建立
   ✅ 訂房資料表已準備就緒
   ✅ 房型設定表已準備就緒
   ✅ 系統設定表已準備就緒
   ✅ 郵件模板表已準備就緒
   ```

### 步驟 5：測試應用程式

1. 打開您的應用程式網址
2. 登入管理後台
3. 檢查：
   - 訂房記錄是否正常顯示
   - 系統設定是否正常
   - 郵件模板是否正常

## 🆘 常見問題

### Q: 為什麼有兩個 PostgreSQL？

A: 可能是：
- 之前測試時建立的
- 不小心建立了重複的服務
- 建議刪除不需要的那個，只保留一個

### Q: 如何刪除多餘的 PostgreSQL？

A: 
1. 在 Railway 後台，點擊要刪除的 PostgreSQL 服務
2. 進入 **Settings** 標籤
3. 滾動到底部，點擊 **Delete Service**
4. 確認刪除

### Q: DATABASE_URL 已經存在，但還是無法連接？

A: 檢查：
1. 連接字串格式是否正確
2. PostgreSQL 服務是否在運行（顯示 "Online"）
3. 伺服器日誌是否有錯誤訊息

### Q: 如何確認連接是否成功？

A: 查看伺服器日誌：
- ✅ 成功：看到 "✅ PostgreSQL 連接池已建立"
- ❌ 失敗：看到 "❌ PostgreSQL 連接池建立失敗" 或連接錯誤

## 📝 重要提醒

1. **只保留一個 PostgreSQL** - 避免混淆和資源浪費
2. **確認 DATABASE_URL** - 必須正確設定才能連接
3. **檢查日誌** - 部署後務必檢查日誌確認連接成功
4. **資料持久化** - 一旦連接成功，資料會持久化在 PostgreSQL 中

## ✅ 完成檢查清單

- [ ] 確認只有一個 PostgreSQL 服務（或確認使用哪一個）
- [ ] 檢查 booking-system 是否有 DATABASE_URL 環境變數
- [ ] 如果沒有，手動設定 DATABASE_URL
- [ ] 重新部署應用程式
- [ ] 檢查伺服器日誌確認連接成功
- [ ] 測試應用程式功能是否正常

