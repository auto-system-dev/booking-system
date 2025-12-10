# 修復 Node.js PATH 設定

## 問題說明

Node.js 已安裝在 `C:\Program Files\nodejs\`，但沒有加入到系統 PATH 環境變數中，所以無法直接使用 `node` 和 `npm` 命令。

## 解決方案

### 方法一：使用批次檔（立即可用）

我已經更新了 `快速啟動.bat` 和 `重新啟動伺服器.bat`，它們會自動使用完整路徑，無需設定 PATH。

**直接雙擊執行即可！**

---

### 方法二：將 Node.js 加入 PATH（永久解決）

#### 步驟 1：開啟環境變數設定

1. 按 `Win + R` 開啟執行視窗
2. 輸入：`sysdm.cpl` 然後按 Enter
3. 點擊「進階」標籤
4. 點擊「環境變數」按鈕

#### 步驟 2：編輯 PATH 變數

1. 在「系統變數」區域找到 `Path`
2. 點擊「編輯」
3. 點擊「新增」
4. 輸入：`C:\Program Files\nodejs`
5. 點擊「確定」儲存所有變更

#### 步驟 3：重新啟動終端機

- **關閉所有 PowerShell 或 CMD 視窗**
- **重新開啟新的終端機視窗**
- 執行 `node --version` 測試

---

### 方法三：在當前 PowerShell 中暫時加入 PATH

在 PowerShell 中執行（僅在當前視窗有效）：

```powershell
$env:Path += ";C:\Program Files\nodejs"
```

然後就可以使用 `node` 和 `npm` 命令了。

---

## 驗證設定

設定完成後，執行以下命令驗證：

```powershell
node --version
npm --version
```

應該會顯示版本號碼。

---

## 推薦做法

**現在立即使用：**
- 直接雙擊 `快速啟動.bat` 或 `重新啟動伺服器.bat`

**長期使用：**
- 使用方法二將 Node.js 加入系統 PATH
- 之後就可以在任何地方使用 `node` 和 `npm` 命令

