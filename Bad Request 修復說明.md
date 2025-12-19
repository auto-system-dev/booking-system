# Bad Request 錯誤修復說明

## 🔧 已修復的問題

### 1. 手機號碼驗證不一致 ✅

**問題**：
- 前端驗證時只檢查 `trim()` 後的值，不處理 `-` 和空格
- 後端會移除 `-` 和空格後再驗證
- 如果用戶輸入 `0912-345-678`，前端可能通過，但後端處理後可能不符合格式

**修復**：
- 前端現在會先移除所有 `-` 和空格，再進行驗證（與後端邏輯一致）
- 發送到伺服器的手機號碼已經是清理過的格式（純數字）

**修改位置**：`script.js` 第 763-774 行

```javascript
// 修復前
const phone = phoneInput.value.trim();
const taiwanPhoneRegex = /^09\d{8}$/;

// 修復後
const phoneRaw = phoneInput.value.trim();
const phone = phoneRaw.replace(/[-\s]/g, ''); // 移除 - 和空格
const taiwanPhoneRegex = /^09\d{8}$/;
```

### 2. Email 驗證不一致 ✅

**問題**：
- 前端只檢查基本格式，不檢查長度
- 後端會轉為小寫並檢查長度（≤255 字元）
- 如果 Email 長度超過 255，前端會通過，但後端會拒絕

**修復**：
- 前端現在會轉為小寫並檢查長度（與後端邏輯一致）
- 發送到伺服器的 Email 已經是清理過的格式（小寫）

**修改位置**：`script.js` 第 776-787 行

```javascript
// 修復前
const email = emailInput.value.trim();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 修復後
const emailRaw = emailInput.value.trim();
const email = emailRaw.toLowerCase(); // 轉為小寫
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 新增長度檢查
if (email.length > 255) {
    showFieldError('guestEmail', 'Email 長度不能超過 255 字元');
    return;
}
```

### 3. 表單資料未使用清理後的值 ✅

**問題**：
- 前端驗證通過後，發送的是原始輸入值
- 可能包含 `-`、空格或大寫字母
- 後端需要再次清理，可能導致不一致

**修復**：
- 現在使用驗證後清理過的值發送到伺服器
- 手機號碼：已移除 `-` 和空格
- Email：已轉為小寫

**修改位置**：`script.js` 第 812-823 行

```javascript
// 修復前
guestPhone: document.getElementById('guestPhone').value,
guestEmail: document.getElementById('guestEmail').value,

// 修復後
guestPhone: phone, // 使用驗證後清理過的手機號碼
guestEmail: email, // 使用驗證後清理過的 Email
```

### 4. 錯誤訊息顯示不夠詳細 ✅

**問題**：
- 所有錯誤都只顯示簡單的 alert
- 用戶無法知道是哪個欄位出錯
- 無法針對特定欄位顯示錯誤訊息

**修復**：
- 根據錯誤訊息內容，自動判斷是哪個欄位出錯
- 針對特定欄位顯示錯誤訊息（使用 `showFieldError`）
- 其他錯誤仍顯示 alert

**修改位置**：`script.js` 第 906-910 行

```javascript
// 修復前
alert('訂房失敗：' + (result.message || '請稍後再試'));

// 修復後
const errorMsg = result.message || '請稍後再試';
if (errorMsg.includes('Email') || errorMsg.includes('email')) {
    showFieldError('guestEmail', errorMsg);
} else if (errorMsg.includes('手機') || errorMsg.includes('phone')) {
    showFieldError('guestPhone', errorMsg);
} else if (errorMsg.includes('日期') || errorMsg.includes('date')) {
    showFieldError('dateRange', errorMsg);
} // ... 其他欄位
```

## 📋 修復效果

### 修復前
- ❌ 前端和後端驗證邏輯不一致
- ❌ 可能發送未清理的資料到伺服器
- ❌ 錯誤訊息不夠詳細
- ❌ 用戶無法知道具體哪個欄位出錯

### 修復後
- ✅ 前端和後端驗證邏輯一致
- ✅ 發送到伺服器的資料已經清理過
- ✅ 錯誤訊息更詳細、更友善
- ✅ 針對特定欄位顯示錯誤訊息

## 🧪 測試建議

請測試以下情況，確認修復有效：

1. **手機號碼測試**：
   - ✅ `0912345678`（純數字，10 碼）
   - ✅ `0912-345-678`（帶 `-`，應該自動清理）
   - ✅ `0912 345 678`（帶空格，應該自動清理）
   - ❌ `0812345678`（不是 09 開頭，應該被拒絕）
   - ❌ `091234567`（9 碼，應該被拒絕）

2. **Email 測試**：
   - ✅ `user@example.com`（正常格式）
   - ✅ `USER@EXAMPLE.COM`（大寫，應該轉為小寫）
   - ❌ `user@example`（缺少域名，應該被拒絕）
   - ❌ 超過 255 字元的 Email（應該被拒絕）

3. **錯誤訊息測試**：
   - 提交無效的手機號碼，應該在手機欄位顯示錯誤
   - 提交無效的 Email，應該在 Email 欄位顯示錯誤
   - 提交無效的日期，應該在日期欄位顯示錯誤

## 🔍 如何確認修復

1. **打開瀏覽器開發者工具**（F12）
2. **查看 Console 標籤**：
   - 應該看到 `準備發送訂房資料:` 顯示清理後的資料
   - 手機號碼應該是純數字（無 `-` 或空格）
   - Email 應該是小寫

3. **查看 Network 標籤**：
   - 找到 `/api/booking` 請求
   - 查看 Request Payload
   - 確認資料格式正確

4. **測試錯誤情況**：
   - 輸入無效的手機號碼，應該在手機欄位顯示錯誤（不是 alert）
   - 輸入無效的 Email，應該在 Email 欄位顯示錯誤（不是 alert）

## 📝 注意事項

1. **向後兼容**：修復後的代碼仍然接受帶 `-` 或空格的手機號碼，會自動清理
2. **大小寫**：Email 會自動轉為小寫，用戶輸入大寫也沒問題
3. **錯誤訊息**：如果錯誤訊息不包含特定關鍵字，仍會顯示 alert

## 🔗 相關文件

- `Bad Request 錯誤診斷指南.md` - 完整的錯誤診斷指南
- `前端 Bad Request 問題說明.md` - 前端問題詳細說明
- `validators.js` - 後端驗證規則
- `script.js` - 前端驗證和錯誤處理

## 💡 後續建議

1. **統一驗證規則**：考慮將驗證規則提取到共用模組，確保前後端完全一致
2. **改善錯誤訊息**：可以根據錯誤類型提供更詳細的說明
3. **記錄錯誤日誌**：記錄所有 400 錯誤，方便追蹤問題
4. **自動化測試**：添加單元測試和整合測試，確保驗證邏輯正確
