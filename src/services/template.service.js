function createTemplateService(deps) {
    const {
        generateEmailFromTemplate,
        generateCustomerEmail,
        generateAdminEmail
    } = deps;

    return {
        generateEmailFromTemplate,
        generateCustomerEmail,
        generateAdminEmail
    };
}

module.exports = {
    createTemplateService
};
