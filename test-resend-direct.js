// 直接測試 Resend 發信功能
// 使用方法: 
//   1. 設定環境變數: $env:RESEND_API_KEY="你的APIKey"
//   2. 執行: node test-resend-direct.js
// 
// 注意：API Key 應該從管理後台設定，這裡只從環境變數讀取

const { Resend } = require('resend');

// 從環境變數讀取（不包含硬編碼的 API Key）
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || 'cheng701107@gmail.com';

if (!RESEND_API_KEY) {
    console.error('❌ 錯誤：未設定 RESEND_API_KEY');
    console.error('');
    console.error('請使用以下方式之一設定：');
    console.error('  1. PowerShell: $env:RESEND_API_KEY="你的APIKey"');
    console.error('  2. 或從管理後台 → 郵件設定中查看並複製 API Key');
    console.error('');
    console.error('注意：API Key 應該在管理後台設定，這裡只從環境變數讀取用於測試');
    process.exit(1);
}

async function testResend() {
    console.log('📧 開始測試 Resend 發信...');
    console.log('   收件人:', TO_EMAIL);
    console.log('   API Key 前綴:', RESEND_API_KEY.substring(0, 10) + '...');
    
    try {
        const resend = new Resend(RESEND_API_KEY);
        
        console.log('📤 正在發送測試郵件...');
        const result = await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: TO_EMAIL,
            subject: 'Resend 直接測試',
            html: '<h1>Hello from Resend!</h1><p>這是一封直接測試郵件，用於驗證 Resend 設定是否正常。</p>'
        });
        
        console.log('✅ 郵件發送成功！');
        console.log('   郵件 ID:', result.data?.id);
        console.log('   完整回應:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('❌ 發送失敗:');
        console.error('   錯誤訊息:', error.message);
        console.error('   錯誤詳情:', error);
        
        if (error.response) {
            console.error('   API 回應:', error.response.data);
        }
    }
}

testResend();

