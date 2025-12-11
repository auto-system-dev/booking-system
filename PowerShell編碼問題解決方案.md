# PowerShell 編碼問題解決方案

## 🔴 問題原因

從錯誤訊息可以看到：
```
Set-Location 'C:\Users\user\Desktop\程??◆發'
```

**亂碼原因：**
1. **PowerShell 編碼設定**：PowerShell 預設使用系統編碼（通常是 GBK 或 Big5），而不是 UTF-8
2. **終端機編碼不一致**：Cursor 的終端機可能使用 UTF-8，而 PowerShell 使用其他編碼
3. **路徑中的中文字符**：當編碼不一致時，中文字符會顯示為亂碼（如 `程??◆發`）

---

## ✅ 解決方案

### 方法 1：設定 PowerShell 編碼為 UTF-8（推薦）

#### 步驟 1：檢查當前編碼

在 PowerShell 中執行：
```powershell
[Console]::OutputEncoding
[Console]::InputEncoding
$OutputEncoding
```

#### 步驟 2：設定 UTF-8 編碼

在 PowerShell 中執行：
```powershell
# 設定輸出編碼為 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 設定控制台代碼頁為 UTF-8
chcp 65001
```

#### 步驟 3：永久設定（選填）

如果要永久設定，可以修改 PowerShell 設定檔：

1. 檢查設定檔位置：
```powershell
$PROFILE
```

2. 如果設定檔不存在，建立它：
```powershell
if (!(Test-Path -Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force
}
```

3. 編輯設定檔，加入以下內容：
```powershell
# 設定 UTF-8 編碼
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
```

4. 重新載入設定檔：
```powershell
. $PROFILE
```

---

### 方法 2：在 Cursor 中設定終端機編碼

1. 開啟 Cursor 設定：
   - 按 `Ctrl + ,` 或點擊 `File` → `Preferences` → `Settings`

2. 搜尋 "terminal encoding" 或 "編碼"

3. 設定終端機編碼為 UTF-8：
   ```json
   {
     "terminal.integrated.encoding": "utf8"
   }
   ```

4. 重新啟動終端機

---

### 方法 3：使用 Git Bash 替代 PowerShell（推薦）

如果 PowerShell 編碼問題持續，可以改用 Git Bash：

1. 在 Cursor 中：
   - 按 `Ctrl + Shift + P`
   - 輸入 "Terminal: Select Default Profile"
   - 選擇 "Git Bash"

2. Git Bash 預設使用 UTF-8，不會有編碼問題

---

## 🌐 Cursor 中文化設定

### Cursor 介面語言設定

1. **開啟設定**：
   - 按 `Ctrl + ,` 或點擊 `File` → `Preferences` → `Settings`

2. **搜尋語言設定**：
   - 搜尋 "locale" 或 "language"

3. **設定語言**：
   - 在設定檔（`settings.json`）中加入：
   ```json
   {
     "locale": "zh-TW"
   }
   ```

4. **安裝中文語言包**（如果需要）：
   - 按 `Ctrl + Shift + X` 開啟擴充功能
   - 搜尋 "Chinese (Traditional)" 或 "繁體中文"
   - 安裝並重新啟動 Cursor

---

## 🔧 快速修復（臨時方案）

如果只是暫時需要執行命令，可以在命令前加上編碼設定：

```powershell
# 在命令前設定編碼
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; git push
```

或使用 Git Bash：
```bash
git push
```

---

## 📝 建議

### 最佳實踐

1. **使用 Git Bash**：
   - 預設 UTF-8 編碼
   - 更好的中文支援
   - 與 Git 整合更好

2. **設定 PowerShell 編碼**：
   - 如果必須使用 PowerShell
   - 按照方法 1 永久設定 UTF-8

3. **避免路徑中的中文**：
   - 如果可能，使用英文路徑
   - 例如：`C:\Users\user\Desktop\Programming` 而不是 `程式開發`

---

## 🆘 如果還有問題

### 檢查編碼

```powershell
# 檢查當前編碼
[Console]::OutputEncoding.EncodingName
[Console]::InputEncoding.EncodingName
```

### 測試中文顯示

```powershell
# 測試中文輸出
Write-Host "測試中文：程式開發"
```

### 如果還是亂碼

1. 檢查系統地區設定：
   - Windows 設定 → 時間與語言 → 地區
   - 確認地區設定正確

2. 檢查字型設定：
   - Cursor 設定 → Terminal → Font Family
   - 使用支援中文的字型（如 "Consolas", "Microsoft YaHei Mono"）

---

## ✅ 完成檢查清單

- [ ] 設定 PowerShell 編碼為 UTF-8
- [ ] 或改用 Git Bash
- [ ] 設定 Cursor 終端機編碼
- [ ] 測試中文路徑是否正常顯示
- [ ] 確認 Git 命令可以正常執行

