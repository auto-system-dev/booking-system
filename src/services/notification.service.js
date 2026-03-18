function createNotificationService(deps) {
    const {
        db,
        lineBot,
        emailService,
        templateService,
        processEnv,
        replaceTemplateVariables,
        generatePaymentReceivedEmail,
        generateCancellationEmail
    } = deps;

    async function buildMailOptionsFromTemplateWithFallback(params) {
        const {
            context,
            to,
            templateKey,
            templateArgs = [],
            fallbackSubject,
            fallbackHtmlFactory
        } = params;
        const emailUser = await emailService.getRequiredEmailUser(context);

        try {
            const { subject, content } = await templateService.generateEmailFromTemplate(templateKey, ...templateArgs);
            return {
                mailOptions: {
                    from: emailUser,
                    to,
                    subject,
                    html: content
                },
                usedFallback: false
            };
        } catch (templateError) {
            console.error(`⚠️ 無法從數據庫讀取 ${templateKey} 模板，使用備用方案:`, templateError.message);
            const fallbackHtml = await fallbackHtmlFactory();
            return {
                mailOptions: {
                    from: emailUser,
                    to,
                    subject: fallbackSubject,
                    html: fallbackHtml
                },
                usedFallback: true
            };
        }
    }

    async function sendOrderQueryOtpEmail(email, code) {
        const emailUser = await emailService.getRequiredEmailUser('訂單查詢 OTP');
        await emailService.sendEmail({
            from: emailUser,
            to: email,
            subject: '【訂單查詢】一次性驗證碼',
            html: `
                <div style="font-family: 'Noto Sans TC', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #262A33;">訂單查詢驗證碼</h2>
                    <p>您好，您正在進行訂單查詢，請使用以下驗證碼完成驗證：</p>
                    <div style="background: #f5f7fb; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                        <h1 style="color: #2C8EC4; font-size: 32px; margin: 0; letter-spacing: 5px;">${code}</h1>
                    </div>
                    <p style="color: #666; font-size: 14px;">此驗證碼有效期限為 15 分鐘，且僅可使用一次。</p>
                    <p style="color: #666; font-size: 14px;">若非本人操作，請忽略此郵件。</p>
                </div>
            `
        });
    }

    async function sendCardPaymentSuccessNotifications(booking) {
        let addonsList = '';
        if (booking.addons) {
            try {
                const parsedAddons = typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons;
                if (parsedAddons && parsedAddons.length > 0) {
                    const allAddons = await db.getAllAddonsAdmin();
                    addonsList = parsedAddons.map(addon => {
                        const addonInfo = allAddons.find(a => a.name === addon.name);
                        const displayName = addonInfo ? addonInfo.display_name : addon.name;
                        const quantity = addon.quantity || 1;
                        const itemTotal = addon.price * quantity;
                        return `${displayName} x${quantity} (NT$ ${itemTotal.toLocaleString()})`;
                    }).join('、');
                }
            } catch (err) {
                console.error('處理加購商品顯示失敗:', err);
            }
        }

        const originalAmount = booking.original_amount || booking.originalAmount || booking.total_amount || booking.totalAmount || 0;
        const discountAmount = booking.discount_amount || booking.discountAmount || 0;
        const discountedTotal = booking.discountedTotal || (discountAmount > 0 ? Math.max(0, originalAmount - discountAmount) : originalAmount);

        const bookingData = {
            bookingId: booking.booking_id,
            guestName: booking.guest_name,
            guestEmail: booking.guest_email,
            guestPhone: booking.guest_phone,
            specialRequest: booking.special_request || '',
            checkInDate: booking.check_in_date,
            checkOutDate: booking.check_out_date,
            roomType: booking.room_type,
            pricePerNight: booking.price_per_night,
            nights: booking.nights,
            originalAmount: originalAmount,
            totalAmount: originalAmount,
            discountAmount: discountAmount,
            discountedTotal: discountedTotal,
            finalAmount: booking.final_amount,
            paymentAmount: booking.payment_amount,
            paymentMethod: booking.payment_method,
            paymentMethodCode: 'card',
            paymentStatus: 'paid',
            bookingDate: booking.booking_date,
            bankInfo: null,
            addons: booking.addons ? (typeof booking.addons === 'string' ? JSON.parse(booking.addons) : booking.addons) : null,
            addonsTotal: booking.addons_total || 0,
            addonsList: addonsList
        };

        const emailUser = await emailService.getRequiredEmailUser('綠界回傳寄送訂房確認');

        let customerMailOptions = null;
        try {
            const { subject, content } = await templateService.generateEmailFromTemplate('booking_confirmation', bookingData);
            customerMailOptions = {
                from: emailUser,
                to: booking.guest_email,
                subject: subject,
                html: content
            };
        } catch (templateError) {
            console.error('⚠️ 無法從數據庫讀取訂房確認模板，使用備用方案:', templateError.message);
            customerMailOptions = {
                from: emailUser,
                to: booking.guest_email,
                subject: '【訂房確認】您的訂房已成功',
                html: await templateService.generateCustomerEmail(bookingData)
            };
        }

        let emailSent = false;
        try {
            await emailService.sendEmail(customerMailOptions);
            console.log('✅ 確認郵件已發送');
            emailSent = true;
        } catch (emailError) {
            console.error('❌ 確認郵件發送失敗:', emailError.message);
        }

        if (emailSent) {
            await db.updateEmailStatus(booking.booking_id, 'booking_confirmation');
            console.log('✅ 郵件狀態已更新');
        }

        try {
            const adminEmail = await db.getSetting('admin_email') || processEnv.ADMIN_EMAIL || 'cheng701107@gmail.com';
            let adminMailOptions = null;
            try {
                const { subject, content } = await templateService.generateEmailFromTemplate('booking_confirmation_admin', bookingData);
                adminMailOptions = {
                    from: emailUser,
                    to: adminEmail,
                    subject: subject,
                    html: content
                };
            } catch (adminTemplateError) {
                console.error('⚠️ 無法從數據庫讀取管理員通知模板，使用備用方案:', adminTemplateError.message);
                adminMailOptions = {
                    from: emailUser,
                    to: adminEmail,
                    subject: `【新訂房通知】${booking.guest_name} - ${booking.booking_id}`,
                    html: templateService.generateAdminEmail(bookingData)
                };
            }
            await emailService.sendEmail(adminMailOptions);
        } catch (adminEmailError) {
            console.error('❌ 管理者通知郵件發送失敗:', adminEmailError.message);
        }

        if (booking.line_user_id) {
            try {
                await lineBot.loadSettings();
                const lineResult = await lineBot.sendBookingSuccessMessage(booking.line_user_id, {
                    bookingId: booking.booking_id,
                    guestName: booking.guest_name,
                    checkInDate: booking.check_in_date,
                    checkOutDate: booking.check_out_date,
                    roomType: booking.room_type,
                    totalAmount: originalAmount,
                    discountAmount: discountAmount,
                    discountedTotal: discountedTotal,
                    finalAmount: booking.final_amount,
                    isPaid: true
                });
                if (!lineResult.success) {
                    console.warn('⚠️ LINE 訊息發送失敗:', lineResult.error);
                }
            } catch (lineError) {
                console.error('❌ LINE 訊息發送錯誤:', lineError.message);
            }
        }
    }

    async function sendTransferBookingCreatedNotifications(params) {
        const {
            bookingData,
            guestEmail,
            guestName,
            bankInfo
        } = params;

        const customerRender = await buildMailOptionsFromTemplateWithFallback({
            context: '建立訂房寄信',
            to: guestEmail,
            templateKey: 'booking_confirmation',
            templateArgs: [bookingData, bankInfo],
            fallbackSubject: '【訂房確認】您的訂房已成功',
            fallbackHtmlFactory: () => templateService.generateCustomerEmail(bookingData)
        });

        const adminEmail = await db.getSetting('admin_email') || processEnv.ADMIN_EMAIL || 'cheng701107@gmail.com';
        const adminRender = await buildMailOptionsFromTemplateWithFallback({
            context: '建立訂房寄信',
            to: adminEmail,
            templateKey: 'booking_confirmation_admin',
            templateArgs: [bookingData],
            fallbackSubject: `【新訂房通知】${guestName} - ${bookingData.bookingId}`,
            fallbackHtmlFactory: async () => templateService.generateAdminEmail(bookingData)
        });

        let customerEmailSent = false;
        let customerEmailError = '';
        try {
            await emailService.sendEmail(customerRender.mailOptions);
            customerEmailSent = true;
            console.log('✅ 客戶確認郵件已發送');
        } catch (emailError) {
            customerEmailError = emailError.message || '未知錯誤';
            console.error('❌ 客戶郵件發送失敗:', customerEmailError);
        }

        let adminEmailSent = false;
        try {
            await emailService.sendEmail(adminRender.mailOptions);
            adminEmailSent = true;
            console.log('✅ 管理員通知郵件已發送');
        } catch (adminEmailError) {
            console.error('❌ 管理員通知郵件發送失敗:', adminEmailError.message);
        }

        return {
            customerEmailSent,
            customerEmailError,
            adminEmailSent
        };
    }

    async function sendPaymentCompletedEmail(booking) {
        const renderResult = await buildMailOptionsFromTemplateWithFallback({
            context: '手動更新付款狀態寄信',
            to: booking.guest_email,
            templateKey: 'payment_completed',
            templateArgs: [booking],
            fallbackSubject: '【收款確認】我們已收到您的款項',
            fallbackHtmlFactory: () => generatePaymentReceivedEmail(booking)
        });

        try {
            await emailService.sendEmail(renderResult.mailOptions);
            await db.updateEmailStatus(booking.booking_id, 'payment_received', true);
            return true;
        } catch (emailError) {
            console.error(`❌ 收款信發送失敗 (${booking.booking_id}):`, emailError.message);
            return false;
        }
    }

    async function sendPaymentReminderEmail(params) {
        const { booking, bankInfo, template } = params;

        const renderResult = await buildMailOptionsFromTemplateWithFallback({
            context: '匯款提醒排程',
            to: booking.guest_email,
            templateKey: 'payment_reminder',
            templateArgs: [booking, bankInfo],
            fallbackSubject: template && template.subject ? template.subject : '【重要提醒】匯款期限即將到期',
            fallbackHtmlFactory: async () => {
                const fallback = await replaceTemplateVariables(template, booking, bankInfo);
                return fallback.content;
            }
        });

        try {
            await emailService.sendEmail(renderResult.mailOptions);
            await db.updateEmailStatus(booking.booking_id, 'payment_reminder', true);
            return true;
        } catch (emailError) {
            console.error(`❌ 發送匯款提醒失敗 (${booking.booking_id}):`, emailError.message);
            return false;
        }
    }

    async function sendCancelNotificationEmail(booking) {
        const renderResult = await buildMailOptionsFromTemplateWithFallback({
            context: '自動取消通知',
            to: booking.guest_email,
            templateKey: 'cancel_notification',
            templateArgs: [booking],
            fallbackSubject: '【訂房取消通知】您的訂房已自動取消',
            fallbackHtmlFactory: () => generateCancellationEmail(booking)
        });

        try {
            await emailService.sendEmail(renderResult.mailOptions);
            await db.updateEmailStatus(booking.booking_id, 'cancel_notification', true);
            return true;
        } catch (emailError) {
            console.error(`❌ 發送取消通知失敗 (${booking.booking_id}):`, emailError.message);
            return false;
        }
    }

    async function sendCheckinReminderEmail(params) {
        const { booking, template, additionalData } = params;

        const renderResult = await buildMailOptionsFromTemplateWithFallback({
            context: '入住提醒排程',
            to: booking.guest_email,
            templateKey: 'checkin_reminder',
            templateArgs: [booking, null, additionalData],
            fallbackSubject: template && template.subject ? template.subject : '【入住提醒】歡迎您明天入住',
            fallbackHtmlFactory: async () => {
                const fallback = await replaceTemplateVariables(template, booking, null, additionalData);
                return fallback.content;
            }
        });

        if (!renderResult.mailOptions.html || renderResult.mailOptions.html.trim() === '') {
            console.error(`❌ 生成的郵件內容為空，跳過發送 (${booking.booking_id})`);
            return false;
        }

        try {
            await emailService.sendEmail(renderResult.mailOptions);
            await db.updateEmailStatus(booking.booking_id, 'checkin_reminder', true);
            return true;
        } catch (emailError) {
            console.error(`❌ 發送入住提醒失敗 (${booking.booking_id}):`, emailError.message);
            return false;
        }
    }

    async function sendFeedbackRequestEmail(params) {
        const { booking, template, additionalData } = params;

        const renderResult = await buildMailOptionsFromTemplateWithFallback({
            context: '回訪信排程',
            to: booking.guest_email,
            templateKey: 'feedback_request',
            templateArgs: [booking, null, additionalData],
            fallbackSubject: template && template.subject ? template.subject : '【感謝入住】分享您的住宿體驗',
            fallbackHtmlFactory: async () => {
                const fallback = await replaceTemplateVariables(template, booking, null, additionalData);
                return fallback.content;
            }
        });

        try {
            await emailService.sendEmail(renderResult.mailOptions);
            await db.updateEmailStatus(booking.booking_id, 'feedback_request', true);
            return true;
        } catch (emailError) {
            console.error(`❌ 發送回訪信失敗 (${booking.booking_id}):`, emailError.message);
            return false;
        }
    }

    return {
        sendOrderQueryOtpEmail,
        sendCardPaymentSuccessNotifications,
        sendTransferBookingCreatedNotifications,
        sendPaymentCompletedEmail,
        sendPaymentReminderEmail,
        sendCancelNotificationEmail,
        sendCheckinReminderEmail,
        sendFeedbackRequestEmail
    };
}

module.exports = {
    createNotificationService
};
