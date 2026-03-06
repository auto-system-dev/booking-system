function createEmailService(deps) {
    const {
        getRequiredEmailUser,
        sendEmail
    } = deps;

    return {
        getRequiredEmailUser,
        sendEmail
    };
}

module.exports = {
    createEmailService
};
