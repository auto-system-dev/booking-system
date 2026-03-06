function loadResendProvider() {
    let Resend = null;

    try {
        const resendModule = require('resend');
        Resend = resendModule.Resend || (resendModule.default && resendModule.default.Resend) || resendModule.default;

        if (Resend) {
            console.log('✅ Resend 套件已載入');
        } else {
            console.warn('⚠️  Resend 類別未找到，請檢查套件版本');
        }
    } catch (error) {
        console.warn('⚠️  Resend 套件未安裝或載入失敗:', error.message);
        console.warn('   系統將使用 Gmail 作為郵件服務');
        console.warn('   如需使用 Resend，請執行: npm install resend@6.7.0');
    }

    return Resend;
}

module.exports = {
    loadResendProvider
};
