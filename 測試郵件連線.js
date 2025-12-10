// 測試郵件連線腳本
require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('========================================');
console.log('   測試郵件連線設定');
console.log('========================================\n');

// 讀取設定
const emailUser = process.env.EMAIL_USER || 'cheng701107@gmail.com';
const emailPass = process.env.EMAIL_PASS || 'vtik qvij ravh lirg';

console.log('Email 帳號:', emailUser);
console.log('應用程式密碼:', emailPass ? '已設定（' + emailPass.length + ' 字元）' : '未設定');
console.log('\n正在測試連線...\n');

// 建立 transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: emailUser,
        pass: emailPass
    }
});

// 測試連線
transporter.verify(function(error, success) {
    if (error) {
        console.log('❌ 連線失敗！');
        console.log('錯誤訊息:', error.message);
        console.log('\n可能的原因：');
        console.log('1. Email 帳號或密碼錯誤');
        console.log('2. Gmail 需要使用「應用程式密碼」，不是一般密碼');
        console.log('3. 未啟用 Gmail 兩步驟驗證');
        console.log('4. 網路連線問題');
        console.log('\n解決方法：');
        console.log('1. 前往 https://myaccount.google.com/security');
        console.log('2. 啟用「兩步驟驗證」');
        console.log('3. 前往 https://myaccount.google.com/apppasswords');
        console.log('4. 產生新的應用程式密碼');
        console.log('5. 將密碼設定到 .env 檔案或 server.js');
    } else {
        console.log('✅ 連線成功！郵件服務已準備就緒');
        console.log('\n可以開始發送郵件了！');
    }
    
    console.log('\n========================================');
    process.exit(error ? 1 : 0);
});

