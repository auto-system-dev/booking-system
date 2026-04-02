# booking-system-mt 第 1 天初始化流程

這份文件用來把多租戶新系統和現有單租戶系統完全隔離。

## 0. 目標

- 新專案：`booking-system-mt`
- 新部署：`mt-dev`、`mt-staging`、`mt-prod`
- 新資料庫：三套環境各自獨立 DB
- 新環境變數：`.env.dev`、`.env.staging`、`.env.prod`

---

## 1. 建立新 repo（GitHub）

1. 到 GitHub 建立空白 repo：`booking-system-mt`
2. 在本機複製目前專案為新資料夾（避免改到舊系統）
3. 將新資料夾綁定新遠端

PowerShell 範例：

```powershell
cd C:\Users\user\Desktop
Copy-Item -Recurse -Force booking-system booking-system-mt
cd .\booking-system-mt
git remote remove origin
git remote add origin https://github.com/<your-account>/booking-system-mt.git
git branch -M main
git push -u origin main
```

---

## 2. 建立部署專案（完全隔離）

在你的雲端平台建立 3 個服務（名稱可依平台調整）：

- `booking-system-mt-dev`
- `booking-system-mt-staging`
- `booking-system-mt-prod`

每個服務都要：

- 使用不同環境變數
- 使用不同網域（或子網域）
- 指向不同資料庫

---

## 3. 建立獨立資料庫（不要與舊系統共用）

建議一環境一資料庫：

- `booking_system_mt_dev`
- `booking_system_mt_staging`
- `booking_system_mt_prod`

建議額外建立對應使用者帳號，避免全域管理帳號共用。

---

## 4. 套用分層環境變數

本專案已建立三個檔案：

- `.env.dev`
- `.env.staging`
- `.env.prod`

請替換所有 `replace_with_*` 佔位值，並把對應內容貼到各部署環境。

---

## 5. 移除/替換舊系統專屬設定

以下項目要改成多租戶新系統專用值：

- 舊系統金流商店代號、Hash Key、Webhook URL
- 舊系統 email 發信帳號
- 舊系統 S3/R2 bucket 名稱
- 舊系統 SESSION_SECRET
- 舊系統 callback / redirect 網址

建議策略：

- dev/staging 一律使用測試金流與測試 webhook
- prod 才使用正式金流

---

## 6. 初始化檢查清單

- [ ] `booking-system-mt` 已建立並 push 到新 repo
- [ ] 三套部署服務已建立
- [ ] 三個獨立 DB 已建立且連線成功
- [ ] 三套環境變數已填入正確值
- [ ] 舊系統專屬金鑰未出現在新系統
- [ ] `main`（舊系統）仍可正常部署

---

## 7. 建議下一步（第 2-7 天）

1. 建立多租戶核心表：`tenants`, `plans`, `subscriptions`
2. 實作 tenant middleware（所有查詢強制 tenant scope）
3. 完成訂閱 MVP（monthly/yearly + 到期狀態）

