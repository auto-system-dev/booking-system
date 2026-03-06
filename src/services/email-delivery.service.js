function createEmailDeliveryService(deps) {
    const {
        db,
        Resend,
        getHotelSettingsWithFallback,
        emailRuntime
    } = deps;

    async function sendEmailViaGmail(mailOptions) {
        if (emailRuntime.sendEmailViaGmailAPI) {
            try {
                return await emailRuntime.sendEmailViaGmailAPI(mailOptions);
            } catch (gmailError) {
                console.log('⚠️  Gmail API 失敗，嘗試 SMTP...');
                try {
                    return await emailRuntime.transporter.sendMail(mailOptions);
                } catch (smtpError) {
                    throw gmailError;
                }
            }
        }

        return await emailRuntime.transporter.sendMail(mailOptions);
    }

    async function sendEmail(mailOptions) {
        try {
            if (emailRuntime.emailServiceProvider === 'resend' && emailRuntime.resendClient && Resend) {
                try {
                    console.log('📧 使用 Resend 發送郵件...');

                    const senderEmail = 'resend@resend.dev';
                    let fromEmail = senderEmail;
                    const resendSenderName = ((await db.getSetting('resend_sender_name')) || (await getHotelSettingsWithFallback()).hotelName || '').trim();
                    if (resendSenderName) {
                        fromEmail = `"${resendSenderName}" <${senderEmail}>`;
                        console.log('   使用寄件人名稱:', resendSenderName);
                    }

                    const result = await emailRuntime.resendClient.emails.send({
                        from: fromEmail,
                        to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
                        subject: mailOptions.subject,
                        html: mailOptions.html,
                        text: mailOptions.text || mailOptions.html.replace(/<[^>]*>/g, '')
                    });

                    console.log('✅ Resend 郵件已發送');
                    console.log('   發送給:', mailOptions.to);
                    console.log('   發件人:', fromEmail);
                    console.log('   郵件 ID:', result.data?.id);

                    return {
                        messageId: result.data?.id || 'resend-' + Date.now(),
                        accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to]
                    };
                } catch (resendError) {
                    console.error('❌ Resend 發送失敗:', resendError.message);
                    console.error('   錯誤詳情:', resendError);
                    if (emailRuntime.transporter || emailRuntime.sendEmailViaGmailAPI) {
                        console.log('⚠️  Resend 失敗，切換到 Gmail 備用方案...');
                        return await sendEmailViaGmail(mailOptions);
                    }
                    throw resendError;
                }
            }

            if (!emailRuntime.resendClient && emailRuntime.emailServiceProvider === 'resend') {
                console.warn('⚠️  Resend 客戶端未初始化，切換到 Gmail');
                emailRuntime.emailServiceProvider = 'gmail';
            }

            return await sendEmailViaGmail(mailOptions);
        } catch (error) {
            console.error('❌ 郵件發送失敗:', error);
            throw error;
        }
    }

    return {
        sendEmail
    };
}

module.exports = {
    createEmailDeliveryService
};
