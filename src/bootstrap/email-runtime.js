function createEmailRuntime() {
    return {
        transporter: null,
        getAccessToken: null,
        sendEmailViaGmailAPI: null,
        oauth2Client: null,
        gmail: null,
        resendClient: null,
        emailServiceProvider: 'gmail',
        configuredSenderEmail: ''
    };
}

function resetEmailRuntime(emailRuntime) {
    emailRuntime.transporter = null;
    emailRuntime.getAccessToken = null;
    emailRuntime.sendEmailViaGmailAPI = null;
    emailRuntime.oauth2Client = null;
    emailRuntime.gmail = null;
    emailRuntime.resendClient = null;
    emailRuntime.emailServiceProvider = 'gmail';
    emailRuntime.configuredSenderEmail = '';
}

function getConfiguredSenderEmail(emailRuntime) {
    return emailRuntime.configuredSenderEmail || '';
}

module.exports = {
    createEmailRuntime,
    resetEmailRuntime,
    getConfiguredSenderEmail
};
