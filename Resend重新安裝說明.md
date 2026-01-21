# Resend 重新安裝說明

## 🔧 為什麼需要重新安裝？

如果安裝 Resend 後出現空白頁，可能是因為：
- Resend 套件安裝不完整或損壞
- node_modules 快取問題
- 套件版本衝突

## 📋 重新安裝步驟

### 方法一：使用自動安裝腳本（推薦）

1. 雙擊執行 `重新安裝Resend.bat`
2. 等待安裝完成
3. 重新啟動伺服器

### 方法二：手動安裝

#### Windows PowerShell：

```powershell
# 1. 移除舊的 Resend 套件
npm uninstall resend

# 2. 清理 npm 快取
npm cache clean --force

# 3. 重新安裝 Resend
npm install resend@6.7.0

# 4. 驗證安裝
npm list resend
```

#### 或使用完整重新安裝：

```powershell
# 刪除 node_modules 和 package-lock.json（謹慎使用）
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json

# 重新安裝所有依賴
npm install
```

## ✅ 驗證安裝

安裝完成後，檢查以下項目：

1. **檢查 package.json**
   ```json
   "resend": "^6.7.0"
   ```

2. **檢查 node_modules**
   - 確認 `node_modules/resend` 資料夾存在
   - 確認 `node_modules/resend/package.json` 存在

3. **啟動伺服器測試**
   ```bash
   node server.js
   ```
   
   應該看到以下訊息之一：
   - `✅ Resend 套件已載入`（如果已安裝）
   - `⚠️  Resend 套件未安裝或載入失敗`（如果未安裝）

## 🔍 故障排除

### 問題 1：npm install 失敗

**解決方法**：
```powershell
# 使用管理員權限執行 PowerShell
npm install resend@6.7.0 --force
```

### 問題 2：安裝後仍出現空白頁

**檢查項目**：
1. 確認 `server.js` 已正確更新（檢查檔案頂部是否有 Resend 的 require）
2. 檢查伺服器日誌是否有錯誤訊息
3. 確認 Resend API Key 是否正確設定

**解決方法**：
```powershell
# 完全重新安裝
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

### 問題 3：版本衝突

**解決方法**：
```powershell
# 安裝特定版本
npm install resend@6.7.0 --save-exact
```

## 📝 安裝後的設定

1. **設定 Resend API Key**
   - 在管理後台 →「系統設定」→「郵件設定」
   - 在「Resend 發信設定」區塊中輸入 API Key
   - 點擊「儲存設定」

2. **設定發件人信箱**
   - 在「Gmail 發信設定」區塊中設定「Gmail 帳號」
   - 這個信箱會作為 Resend 的發件人信箱

3. **重新啟動伺服器**
   - 停止目前運行的伺服器（Ctrl+C）
   - 重新啟動：`node server.js` 或執行 `快速啟動.bat`

## 🎯 預期結果

安裝成功後，啟動伺服器時應該看到：

```
✅ Resend 套件已載入
📧 郵件服務已設定（Resend）
   服務提供商: Resend
   設定來源: 資料庫
```

如果沒有設定 Resend API Key，則會看到：

```
⚠️  Resend 套件未安裝或載入失敗: ...
   系統將使用 Gmail 作為郵件服務
```

## 📚 相關文件

- [Resend設定說明.md](./Resend設定說明.md) - Resend 完整設定說明
- [package.json](./package.json) - 專案依賴清單

## ⚠️ 注意事項

1. **不要刪除 node_modules**
   - 除非確定要完全重新安裝所有套件
   - 刪除後需要重新安裝所有依賴，耗時較長

2. **備份重要資料**
   - 重新安裝前建議備份 `bookings.db`（如果使用 SQLite）
   - 備份環境變數設定

3. **檢查網路連線**
   - npm install 需要網路連線
   - 如果使用代理，請設定 npm 代理

## 🆘 仍有問題？

如果重新安裝後仍有問題，請檢查：

1. Node.js 版本（建議 v16 或以上）
   ```bash
   node --version
   ```

2. npm 版本（建議 v8 或以上）
   ```bash
   npm --version
   ```

3. 伺服器日誌中的錯誤訊息
4. 瀏覽器控制台的錯誤訊息





