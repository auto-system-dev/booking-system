// 綠界支付模組
const crypto = require('crypto');
const querystring = require('querystring');

// 綠界測試環境設定
const ECPAY_CONFIG = {
    // 測試環境
    test: {
        MerchantID: process.env.ECPAY_MERCHANT_ID || '2000132',
        HashKey: process.env.ECPAY_HASH_KEY || '5294y06JbISpM5x9',
        HashIV: process.env.ECPAY_HASH_IV || 'v77hoKGq4kWxNNIS',
        ActionUrl: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    },
    // 正式環境（上線時使用）
    production: {
        MerchantID: process.env.ECPAY_MERCHANT_ID_PROD || '',
        HashKey: process.env.ECPAY_HASH_KEY_PROD || '',
        HashIV: process.env.ECPAY_HASH_IV_PROD || '',
        ActionUrl: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
    }
};

// 取得當前環境設定
function getConfig() {
    // 檢查 MerchantID 是否為測試環境的 ID
    const merchantID = process.env.ECPAY_MERCHANT_ID || '2000132';
    const isTestMerchantID = merchantID === '2000132';
    
    // 如果使用測試環境的 MerchantID，強制使用測試環境 API
    // 即使 NODE_ENV 是 production，也要使用測試環境（避免在正式環境誤用測試 MerchantID）
    if (isTestMerchantID) {
        return ECPAY_CONFIG.test;
    }
    
    // 否則根據 NODE_ENV 決定
    const env = process.env.NODE_ENV === 'production' ? 'production' : 'test';
    return ECPAY_CONFIG[env];
}

// 產生檢查碼（根據綠界官方文件：https://developers.ecpay.com.tw/?p=2858）
// 注意：綠界的計算方式包含空字串參數
function createCheckMacValue(params, hashKey, hashIV) {
    // 1. 過濾參數（排除 CheckMacValue，但包含空字串）
    const filteredParams = {};
    Object.keys(params).forEach(key => {
        // 排除 CheckMacValue，但包含空字串（綠界的計算方式）
        if (key !== 'CheckMacValue') {
            // 將值轉為字串，空值轉為空字串
            filteredParams[key] = String(params[key] || '');
        }
    });
    
    // 2. 將參數依 A-Z 排序
    const sortedKeys = Object.keys(filteredParams).sort();
    
    // 2. 組合參數字串：HashKey=xxx&參數1=值1&參數2=值2&...&HashIV=xxx
    let checkStr = 'HashKey=' + hashKey;
    sortedKeys.forEach(key => {
        checkStr += '&' + key + '=' + filteredParams[key];
    });
    checkStr += '&HashIV=' + hashIV;
    
    // 3. URL encode（整個字串）
    checkStr = encodeURIComponent(checkStr);
    
    // 4. 轉為小寫
    checkStr = checkStr.toLowerCase();
    
    // 5. 替換特殊字元（根據綠界 URLEncode 轉換表）
    // 注意：必須按照綠界規定的順序替換
    checkStr = checkStr
        .replace(/%20/g, '+')
        .replace(/%2d/g, '-')
        .replace(/%5f/g, '_')
        .replace(/%2e/g, '.')
        .replace(/%21/g, '!')
        .replace(/%2a/g, '*')
        .replace(/%28/g, '(')
        .replace(/%29/g, ')');
    
    // 6. SHA256 雜湊（使用 UTF-8 編碼）
    const hash = crypto.createHash('sha256').update(checkStr, 'utf8').digest('hex');
    
    // 7. 轉為大寫
    return hash.toUpperCase();
}

// 建立支付表單資料
function createPaymentForm(bookingData, paymentInfo, customConfig = null) {
    // 如果提供了自訂設定，使用自訂設定；否則使用預設設定
    let config;
    if (customConfig) {
        // 檢查 MerchantID 是否為測試環境的 ID
        const isTestMerchantID = customConfig.MerchantID === '2000132';
        // 根據 MerchantID 決定使用哪個 API 端點
        const actionUrl = isTestMerchantID 
            ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'  // 測試環境
            : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';        // 正式環境
        
        config = {
            MerchantID: customConfig.MerchantID,
            HashKey: customConfig.HashKey,
            HashIV: customConfig.HashIV,
            ActionUrl: actionUrl
        };
    } else {
        config = getConfig();
    }
    
    const { finalAmount, bookingId, guestName, guestEmail, guestPhone } = bookingData;
    
    // 訂單編號（限制 20 字元，使用 bookingId）
    const merchantTradeNo = bookingId.substring(0, 20);
    
    // 訂單時間（格式：yyyy/MM/dd HH:mm:ss）
    const merchantTradeDate = new Date().toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/\//g, '/').replace(/,/g, '');
    
    // 取得基礎網址（Railway 或本地）
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : (process.env.ECPAY_RETURN_URL ? new URL(process.env.ECPAY_RETURN_URL).origin : `http://localhost:${process.env.PORT || 3000}`);
    
    // 建立參數物件
    const params = {
        MerchantID: config.MerchantID,
        MerchantTradeNo: merchantTradeNo,
        MerchantTradeDate: merchantTradeDate,
        PaymentType: 'aio',
        TotalAmount: Math.round(finalAmount).toString(), // 金額（整數）
        TradeDesc: `訂房編號：${bookingId}`, // 交易描述
        ItemName: `住宿訂房-${bookingId}`, // 商品名稱
        ReturnURL: process.env.ECPAY_RETURN_URL || `${baseUrl}/api/payment/return`, // 付款完成回傳網址
        OrderResultURL: process.env.ECPAY_ORDER_RESULT_URL || `${baseUrl}/api/payment/result`, // 付款完成導向網址
        ChoosePayment: 'Credit', // 選擇付款方式：Credit（信用卡）
        EncryptType: 1, // 加密類型：1
        ClientBackURL: process.env.ECPAY_CLIENT_BACK_URL || `${baseUrl}/?bookingId=${bookingId}`, // 返回商店網址
        // 客戶資料（選填）
        CustomerName: guestName,
        CustomerEmail: guestEmail,
        CustomerPhone: guestPhone
    };
    
    // 產生檢查碼
    params.CheckMacValue = createCheckMacValue(params, config.HashKey, config.HashIV);
    
    return {
        actionUrl: config.ActionUrl,
        params: params
    };
}

// 驗證回傳資料
function verifyReturnData(returnData) {
    const config = getConfig();
    
    // 複製資料（避免修改原始資料）
    const data = { ...returnData };
    
    // 取出 CheckMacValue
    const receivedCheckMacValue = data.CheckMacValue;
    if (!receivedCheckMacValue) {
        console.error('❌ 回傳資料中沒有 CheckMacValue');
        return false;
    }
    
    // 移除 CheckMacValue 後重新計算
    delete data.CheckMacValue;
    
    // 重新計算檢查碼
    const calculatedCheckMacValue = createCheckMacValue(data, config.HashKey, config.HashIV);
    
    // 除錯資訊
    console.log('驗證 CheckMacValue:');
    console.log('  收到的:', receivedCheckMacValue);
    console.log('  計算的:', calculatedCheckMacValue);
    console.log('  比對結果:', receivedCheckMacValue === calculatedCheckMacValue);
    
    // 比對檢查碼
    return receivedCheckMacValue === calculatedCheckMacValue;
}

// 解析回傳資料
function parseReturnData(returnData) {
    return {
        merchantTradeNo: returnData.MerchantTradeNo,
        tradeNo: returnData.TradeNo,
        rtnCode: returnData.RtnCode,
        rtnMsg: returnData.RtnMsg,
        tradeAmt: parseInt(returnData.TradeAmt),
        paymentDate: returnData.PaymentDate,
        paymentType: returnData.PaymentType,
        paymentTypeChargeFee: returnData.PaymentTypeChargeFee,
        tradeDate: returnData.TradeDate,
        simulatePaid: returnData.SimulatePaid
    };
}

module.exports = {
    createPaymentForm,
    verifyReturnData,
    parseReturnData,
    getConfig
};

