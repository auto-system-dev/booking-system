function createEmailConfigService(deps) {
    const {
        db,
        processEnv
    } = deps;

    async function getRequiredEmailUser(context = '') {
        const emailUser = ((await db.getSetting('email_user')) || processEnv.EMAIL_USER || '').trim();
        if (!emailUser) {
            const contextLabel = context ? `（${context}）` : '';
            throw new Error(`未設定後台寄件信箱 email_user / EMAIL_USER${contextLabel}`);
        }
        return emailUser;
    }

    return {
        getRequiredEmailUser
    };
}

module.exports = {
    createEmailConfigService
};
