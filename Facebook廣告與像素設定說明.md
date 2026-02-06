# Facebook 廣告與像素設定說明

## 目錄
1. [銷售頁架構說明](#銷售頁架構說明)
2. [建立 Facebook Pixel](#建立-facebook-pixel)
3. [設定像素追蹤事件](#設定像素追蹤事件)
4. [Facebook 廣告設定建議](#facebook-廣告設定建議)
5. [轉換 API 進階設定](#轉換-api-進階設定)
6. [自訂受眾建立](#自訂受眾建立)
7. [A/B 測試建議](#ab-測試建議)

---

## 銷售頁架構說明

已為您建立的銷售頁包含以下文件：

| 文件 | 說明 |
|------|------|
| `landing.html` | 銷售頁主檔案 |
| `landing.css` | 銷售頁樣式 |
| `landing.js` | 互動功能與像素追蹤 |

### 銷售頁區塊

1. **Hero 區** - 全螢幕視覺 + 價格 + CTA
2. **限時倒數** - 製造急迫感
3. **特色賣點** - 4 大亮點
4. **房型展示** - 3 種房型卡片
5. **評價推薦** - 客戶好評
6. **設施服務** - 完善設施列表
7. **交通位置** - 地圖與聯絡資訊
8. **最終 CTA** - 強力號召行動

---

## 建立 Facebook Pixel

### 步驟 1：進入事件管理工具

1. 前往 [Facebook Business Suite](https://business.facebook.com/)
2. 點擊左側選單「事件管理工具」
3. 點擊「連結資料來源」→「網站」

### 步驟 2：建立像素

1. 選擇「Facebook Pixel」
2. 輸入像素名稱（例如：悠然山居民宿像素）
3. 輸入網站 URL
4. 點擊「建立」

### 步驟 3：取得 Pixel ID

建立完成後，您會得到一個 15-16 位數的 **Pixel ID**，例如：`1234567890123456`

### 步驟 4：安裝到銷售頁

打開 `landing.html`，找到以下程式碼：

```html
<!-- Facebook Pixel Code -->
<script>
    // ...略...
    fbq('init', 'YOUR_PIXEL_ID_HERE');  <!-- 替換這裡 -->
    fbq('track', 'PageView');
</script>
<noscript>
    <img height="1" width="1" style="display:none"
    src="https://www.facebook.com/tr?id=YOUR_PIXEL_ID_HERE&ev=PageView&noscript=1"/>  <!-- 還有這裡 -->
</noscript>
```

將 `YOUR_PIXEL_ID_HERE` 替換為您的實際 Pixel ID。

---

## 設定像素追蹤事件

銷售頁已內建以下追蹤事件：

### 標準事件

| 事件名稱 | 觸發時機 | 用途 |
|----------|----------|------|
| `PageView` | 頁面載入 | 追蹤訪客數 |
| `Lead` | 點擊訂房按鈕 | 追蹤潛在客戶 |
| `ViewContent` | 點擊房型卡片 | 追蹤興趣房型 |
| `InitiateCheckout` | 點擊最終 CTA | 追蹤準備下單 |

### 自訂事件

| 事件名稱 | 觸發時機 | 用途 |
|----------|----------|------|
| `ScrollDepth` | 捲動至 25%/50%/75%/100% | 追蹤內容參與度 |
| `TimeOnPage` | 停留超過 30 秒後離開 | 追蹤頁面品質 |
| `EngagedVisitor` | 每停留 60 秒 | 追蹤高互動訪客 |
| `CampaignVisit` | 從廣告來訪（有 UTM） | 追蹤廣告效果 |

---

## Facebook 廣告設定建議

### 廣告目標選擇

根據您的目標，建議使用以下廣告目標：

| 階段 | 廣告目標 | 說明 |
|------|----------|------|
| 曝光期 | 流量 | 導引流量至銷售頁 |
| 互動期 | 互動 | 增加貼文互動 |
| 轉換期 | 轉換 | 追蹤 Lead 或 InitiateCheckout |
| 再行銷 | 轉換 | 針對已訪問者投放 |

### UTM 參數設定

在 Facebook 廣告後台設定廣告連結時，請加入 UTM 參數：

```
https://your-domain.com/landing.html?utm_source=facebook&utm_medium=cpc&utm_campaign=spring_promo&utm_content=video_ad
```

| 參數 | 範例 | 說明 |
|------|------|------|
| `utm_source` | facebook | 流量來源 |
| `utm_medium` | cpc | 媒體類型（cpc=付費廣告） |
| `utm_campaign` | spring_promo | 活動名稱 |
| `utm_content` | video_ad | 廣告素材識別 |

### 廣告素材建議

#### 圖片廣告
- 尺寸：1080 x 1080（方形）或 1200 x 628（橫幅）
- 文字佔比：< 20%
- 重點：展示民宿美景 + 價格優惠

#### 影片廣告
- 長度：15-30 秒
- 前 3 秒：抓住注意力（美景/優惠）
- 結尾：明確 CTA

#### 輪播廣告
- 展示不同房型
- 每張圖片一個賣點

### 廣告文案範例

```
🏡 悠然山居民宿 | 限時 8 折優惠

✨ 絕美山景 × 私人溫泉 × 精緻早餐
📍 遠離城市喧囂，享受片刻寧靜

💰 每晚只要 NT$2,800 起（原價$3,500）
⏰ 限時優惠倒數中！

👉 立即預訂，享受專屬假期
```

---

## 轉換 API 進階設定

為了提高追蹤準確度（避免 iOS 14.5+ 影響），建議同時設定 **Conversions API**。

### 在 server.js 中添加轉換 API

```javascript
// 安裝：npm install node-fetch

const fetch = require('node-fetch');

// Facebook Conversions API 設定
const FB_PIXEL_ID = 'YOUR_PIXEL_ID';
const FB_ACCESS_TOKEN = 'YOUR_ACCESS_TOKEN'; // 從事件管理工具取得

async function sendConversionEvent(eventName, eventData, userData) {
    const url = `https://graph.facebook.com/v18.0/${FB_PIXEL_ID}/events`;
    
    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            event_source_url: eventData.url,
            user_data: {
                em: userData.email ? hashSHA256(userData.email.toLowerCase()) : undefined,
                ph: userData.phone ? hashSHA256(userData.phone) : undefined,
                client_ip_address: userData.ip,
                client_user_agent: userData.userAgent,
                fbc: userData.fbc, // Facebook Click ID
                fbp: userData.fbp  // Facebook Browser ID
            },
            custom_data: eventData.customData
        }],
        access_token: FB_ACCESS_TOKEN
    };
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('Conversion API response:', await response.json());
    } catch (error) {
        console.error('Conversion API error:', error);
    }
}

// SHA256 雜湊函數
const crypto = require('crypto');
function hashSHA256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
```

### 在訂房完成時觸發

```javascript
// 在 server.js 的訂房成功處理中添加
app.post('/api/bookings', async (req, res) => {
    // ... 訂房邏輯 ...
    
    // 發送 Purchase 轉換事件
    await sendConversionEvent('Purchase', {
        url: req.headers.referer,
        customData: {
            currency: 'TWD',
            value: totalAmount,
            content_name: roomType,
            content_type: 'product'
        }
    }, {
        email: req.body.email,
        phone: req.body.phone,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        fbc: req.cookies._fbc,
        fbp: req.cookies._fbp
    });
});
```

---

## 自訂受眾建立

### 建立網站訪客受眾

1. 前往「受眾」工具
2. 點擊「建立受眾」→「自訂受眾」→「網站」
3. 設定條件：

| 受眾類型 | 條件 | 用途 |
|----------|------|------|
| 所有訪客 | 瀏覽任何頁面，過去 30 天 | 基礎再行銷 |
| 高意願訪客 | 觸發 Lead 事件 | 精準再行銷 |
| 準備下單 | 觸發 InitiateCheckout 事件 | 購物車放棄 |
| 深度互動 | ScrollDepth >= 75% | 內容互動者 |
| 已訂房客戶 | 觸發 Purchase 事件 | 排除 / 回購 |

### 類似受眾建立

1. 選擇來源受眾（例如：已訂房客戶）
2. 選擇國家/地區：台灣
3. 選擇相似度：1%（最精準）

---

## A/B 測試建議

### 測試項目

| 測試項目 | 變體 A | 變體 B |
|----------|--------|--------|
| Hero 標題 | 遠離塵囂，擁抱自然 | 山林秘境，療癒假期 |
| CTA 文字 | 立即預訂 | 馬上搶優惠 |
| 優惠呈現 | 8 折優惠 | 省 $700 |
| 價格顯示 | NT$2,800 起 | 每晚只要 $2,800 |

### 測試方法

1. 複製 `landing.html` 為 `landing-b.html`
2. 修改測試變體
3. 在 Facebook 廣告使用「A/B 測試」功能
4. 分析 7 天後的轉換數據

---

## 快速檢查清單

### 上線前確認

- [ ] 替換 Pixel ID（`YOUR_PIXEL_ID_HERE`）
- [ ] 替換 Google Maps 嵌入代碼
- [ ] 更新民宿名稱、價格、圖片
- [ ] 更新聯絡資訊與地址
- [ ] 更新 Open Graph 圖片 URL
- [ ] 測試所有 CTA 按鈕連結
- [ ] 使用 [Facebook Pixel Helper](https://chrome.google.com/webstore/detail/facebook-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc) 驗證像素

### 像素驗證

1. 安裝 Chrome 擴充功能「Facebook Pixel Helper」
2. 瀏覽銷售頁
3. 點擊擴充功能圖示
4. 確認看到 `PageView` 事件
5. 點擊訂房按鈕，確認看到 `Lead` 事件

---

## 常見問題

### Q: 像素沒有追蹤到數據？

1. 確認 Pixel ID 正確
2. 確認像素代碼在 `<head>` 區塊
3. 使用 Pixel Helper 檢查
4. 確認網站已部署（本機 localhost 可能有限制）

### Q: iOS 14.5+ 用戶追蹤不到？

1. 設定 Conversions API（伺服器端追蹤）
2. 啟用「整合事件評估」
3. 設定網域驗證

### Q: 轉換數據與實際訂房不符？

1. 檢查事件觸發時機
2. 確認「歸因視窗」設定（建議 7 天點擊、1 天瀏覽）
3. 排除測試流量

---

## 下一步

1. ✅ 設定 Facebook Pixel ID
2. ✅ 部署銷售頁
3. ✅ 使用 Pixel Helper 驗證
4. ✅ 建立廣告活動
5. ✅ 設定自訂受眾
6. ✅ 監控轉換數據

如有任何問題，歡迎隨時詢問！

