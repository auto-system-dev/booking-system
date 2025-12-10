# Railway + PostgreSQL 部署指南

## 📋 前置準備

1. **GitHub 帳號**：將程式碼推送到 GitHub
2. **Railway 帳號**：前往 [railway.app](https://railway.app) 註冊
3. **Git 已安裝**：確保本地已安裝 Git

## 🚀 部署步驟

### 第一步：推送到 GitHub

```bash
# 1. 初始化 Git（如果還沒有）
git init

# 2. 加入所有檔案
git add .

# 3. 建立第一次提交
git commit -m "Initial commit: 訂房系統 PostgreSQL 版本"

# 4. 在 GitHub 建立新儲存庫後，連接遠端
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# 5. 推送到 GitHub
git branch -M main
git push -u origin main
```

### 第二步：在 Railway 建立專案

1. **登入 Railway**
   - 前往 [railway.app](https://railway.app)
   - 使用 GitHub 帳號登入

2. **建立新專案**
   - 點擊「New Project」
   - 選擇「Deploy from GitHub repo」
   - 選擇你的儲存庫

3. **新增 PostgreSQL 資料庫**
   - 在專案中點擊「+ New」
   - 選擇「Database」→「Add PostgreSQL」
   - Railway 會自動建立 PostgreSQL 資料庫

4. **設定環境變數**
   - 在專案設定中，點擊「Variables」
   - Railway 會自動提供 `DATABASE_URL`（不需要手動設定）
   - 新增以下環境變數：
     ```
     EMAIL_USER=your-email@gmail.com
     EMAIL_PASS=your-app-password
     PORT=3000
     ECPAY_MERCHANT_ID=your-merchant-id (可選)
     ECPAY_HASH_KEY=your-hash-key (可選)
     ECPAY_HASH_IV=your-hash-iv (可選)
     ```

### 第三步：部署設定

1. **設定啟動指令**
   - 在專案設定中，點擊「Settings」
   - 確認「Start Command」為：`npm start`
   - 確認「Root Directory」為：`/`（根目錄）

2. **自動部署**
   - Railway 會自動偵測 `package.json`
   - 自動執行 `npm install`
   - 自動執行 `npm start`

### 第四步：檢查部署狀態

1. **查看日誌**
   - 在 Railway 專案中，點擊「Deployments」
   - 查看部署日誌，確認沒有錯誤

2. **測試連線**
   - Railway 會自動提供一個網址（例如：`https://your-app.railway.app`）
   - 訪問該網址，確認系統正常運作

## 🔧 環境變數說明

### 必要環境變數

- `DATABASE_URL`：Railway 自動提供，不需要手動設定
- `EMAIL_USER`：Gmail 帳號
- `EMAIL_PASS`：Gmail 應用程式密碼（不是一般密碼）

### 可選環境變數

- `PORT`：伺服器端口（Railway 會自動設定，通常不需要）
- `ECPAY_MERCHANT_ID`：綠界商店代號
- `ECPAY_HASH_KEY`：綠界金鑰
- `ECPAY_HASH_IV`：綠界向量

## 📝 Gmail 應用程式密碼設定

1. 前往 [Google 帳號設定](https://myaccount.google.com/)
2. 點擊「安全性」
3. 啟用「兩步驟驗證」
4. 在「應用程式密碼」中建立新密碼
5. 選擇「郵件」和「其他（自訂名稱）」
6. 複製產生的 16 字元密碼
7. 將此密碼設定為 `EMAIL_PASS` 環境變數

## 🔄 更新部署

每次推送到 GitHub 的 main 分支，Railway 會自動重新部署：

```bash
git add .
git commit -m "更新說明"
git push
```

## 🐛 常見問題

### 問題 1：資料庫連線失敗

**解決方法：**
- 確認 `DATABASE_URL` 環境變數已自動設定
- 檢查 PostgreSQL 服務是否正常運行
- 查看 Railway 日誌中的錯誤訊息

### 問題 2：郵件發送失敗

**解決方法：**
- 確認 `EMAIL_USER` 和 `EMAIL_PASS` 已正確設定
- 確認已使用「應用程式密碼」而非一般密碼
- 確認 Gmail 帳號已啟用「兩步驟驗證」

### 問題 3：部署失敗

**解決方法：**
- 查看 Railway 部署日誌
- 確認 `package.json` 中的 `start` 指令正確
- 確認所有依賴套件已正確安裝

## 📊 資料庫管理

### 查看資料庫

1. 在 Railway 專案中，點擊 PostgreSQL 服務
2. 點擊「Data」標籤
3. 可以查看資料表結構和資料

### 備份資料庫

Railway 提供自動備份功能：
1. 在 PostgreSQL 服務中，點擊「Backups」
2. 可以手動建立備份或設定自動備份

## 💰 費用說明

- **免費方案**：每月 $5 免費額度
- **付費方案**：根據使用量計費
- **PostgreSQL**：包含在免費額度內（小型專案足夠使用）

## 🎉 完成！

部署完成後，你的訂房系統就可以在網路上運作了！

**重要提醒：**
- 定期備份資料庫
- 監控 Railway 使用量
- 保護環境變數安全（不要分享給他人）

## 📞 需要幫助？

- Railway 文件：https://docs.railway.app
- PostgreSQL 文件：https://www.postgresql.org/docs/
- 專案問題：查看 GitHub Issues

