# PostgreSQL 遷移指南

## ✅ 已完成的工作

系統已成功遷移到支援 PostgreSQL，同時保持向後兼容 SQLite（本地開發用）。

### 主要變更

1. **安裝 `pg` 套件** - PostgreSQL 客戶端庫
2. **修改 `database.js`** - 支援 PostgreSQL 和 SQLite 雙資料庫
3. **自動檢測環境** - 根據 `DATABASE_URL` 環境變數自動選擇資料庫類型
4. **統一查詢接口** - 所有資料庫操作使用統一的 `query()` 和 `queryOne()` 函數
5. **SQL 語法轉換** - 自動處理 PostgreSQL 和 SQLite 的語法差異

## 🚀 Railway 部署步驟

### 步驟 1：在 Railway 建立 PostgreSQL 服務

1. 登入 [Railway](https://railway.app)
2. 選擇您的專案
3. 點擊「**+ New**」→「**Database**」→「**Add PostgreSQL**」
4. Railway 會自動建立 PostgreSQL 服務並設定環境變數 `DATABASE_URL`

### 步驟 2：確認環境變數

Railway 會自動設定以下環境變數：
- `DATABASE_URL` - PostgreSQL 連接字串（格式：`postgresql://user:password@host:port/database`）

### 步驟 3：重新部署

1. Railway 會自動偵測到 GitHub 的更新
2. 點擊「**Deploy**」重新部署應用程式
3. 系統會自動：
   - 檢測到 `DATABASE_URL` 環境變數
   - 使用 PostgreSQL 連接
   - 自動建立所有資料表
   - 初始化預設資料（房型、設定、郵件模板）

## 📋 資料庫結構

系統會自動建立以下資料表：

1. **bookings** - 訂房記錄
2. **room_types** - 房型設定
3. **settings** - 系統設定
4. **email_templates** - 郵件模板

## 🔄 資料遷移（如果已有資料）

如果您本地有重要的訂房記錄，需要先匯出再匯入：

### 匯出 SQLite 資料

```bash
sqlite3 bookings.db .dump > backup.sql
```

### 匯入到 PostgreSQL

需要將 SQL 語法轉換為 PostgreSQL 格式後匯入。建議使用以下工具：
- [pgloader](https://pgloader.readthedocs.io/) - 自動轉換並遷移
- 或手動轉換 SQL 語法後匯入

## ⚙️ 本地開發

本地開發時，如果沒有設定 `DATABASE_URL`，系統會自動使用 SQLite：
- 資料庫檔案：`bookings.db`
- 不需要額外設定

## 🔍 驗證部署

部署完成後，檢查以下項目：

1. **伺服器日誌** - 應該顯示：
   ```
   🗄️  使用 PostgreSQL 資料庫
   ✅ PostgreSQL 連接池已建立
   ✅ 訂房資料表已準備就緒
   ✅ 房型設定表已準備就緒
   ✅ 系統設定表已準備就緒
   ✅ 郵件模板表已準備就緒
   ```

2. **管理後台** - 登入後檢查：
   - 訂房記錄是否正常顯示
   - 系統設定是否正常
   - 郵件模板是否正常

## 🆘 常見問題

### Q: 部署後資料不見了？

A: 這是正常的，因為 Railway 使用的是全新的 PostgreSQL 資料庫。系統會自動初始化預設資料（房型、設定、郵件模板），但訂房記錄需要重新建立。

### Q: 如何備份 PostgreSQL 資料？

A: Railway 提供自動備份功能，或使用以下命令：
```bash
pg_dump $DATABASE_URL > backup.sql
```

### Q: 本地開發時如何切換到 PostgreSQL？

A: 在 `.env` 檔案中設定 `DATABASE_URL`：
```env
DATABASE_URL=postgresql://user:password@localhost:5432/database
```

## 📝 注意事項

1. **資料持久化** - PostgreSQL 資料會持久化在 Railway 的資料庫服務中，不會因為重新部署而遺失
2. **環境變數** - 確保 `DATABASE_URL` 已正確設定
3. **SSL 連接** - Railway 的 PostgreSQL 使用 SSL，系統已自動處理
4. **連接池** - 系統使用連接池管理資料庫連接，提高效能

## ✅ 完成

完成以上步驟後，您的系統就會使用 PostgreSQL 資料庫，資料不會因為重新部署而遺失！

