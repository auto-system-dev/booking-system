function createEmailFallbackTemplatesService(deps) {
    const {
        getHotelSettingsWithFallback,
        generateEmailFromTemplate
    } = deps;

    async function getHotelInfoFooter() {
        try {
            const { hotelName, hotelPhone, hotelAddress, hotelEmail } = await getHotelSettingsWithFallback();

            let footer = '<div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd;">';
            footer += '<h3 style="color: #333; margin-bottom: 15px; font-size: 18px;">🏨 旅館資訊</h3>';
            footer += '<div style="color: #666; line-height: 1.8;">';

            if (hotelName) {
                footer += `<p style="margin: 5px 0;"><strong>旅館名稱：</strong>${hotelName}</p>`;
            }
            if (hotelPhone) {
                footer += `<p style="margin: 5px 0;"><strong>聯絡電話：</strong>${hotelPhone}</p>`;
            }
            if (hotelAddress) {
                footer += `<p style="margin: 5px 0;"><strong>地址：</strong>${hotelAddress}</p>`;
            }
            if (hotelEmail) {
                footer += `<p style="margin: 5px 0;"><strong>Email：</strong>${hotelEmail}</p>`;
            }

            footer += '</div></div>';
            return footer;
        } catch (error) {
            console.error('取得旅館資訊失敗:', error);
            return '';
        }
    }

    async function generateCustomerEmail(data) {
        console.log('📧 生成客戶郵件，資料:', {
            paymentMethodCode: data.paymentMethodCode,
            daysReserved: data.daysReserved,
            paymentDeadline: data.paymentDeadline,
            bankInfo: data.bankInfo
        });
        return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 0; width: 100%; }
            .header { background: #262A33; color: white; padding: 30px 20px; text-align: center; border-radius: 0; }
            .content { background: #f9f9f9; padding: 30px 20px; border-radius: 0; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; flex-wrap: wrap; }
            .info-label { font-weight: 600; color: #666; flex: 0 0 auto; }
            .info-value { color: #333; flex: 1 1 auto; text-align: right; word-break: break-word; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #262A33; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            @media only screen and (max-width: 600px) {
                .container { padding: 0; }
                .header { padding: 25px 15px; }
                .header h1 { font-size: 24px; }
                .header p { font-size: 16px; }
                .content { padding: 20px 15px; }
                .info-row { flex-direction: column; align-items: flex-start; padding: 10px 0; }
                .info-label { width: 100%; margin-bottom: 5px; font-size: 14px; }
                .info-value { text-align: left; width: 100%; font-size: 15px; }
                .highlight { padding: 15px; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🏨 訂房確認成功</h1>
                <p>感謝您的預訂！</p>
            </div>
            <div class="content">
                <p>親愛的 ${data.guestName}，</p>
                <p style="margin-bottom: 25px;">您的訂房已成功確認，以下是您的訂房資訊：</p>

                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${data.bookingId}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${new Date(data.checkInDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${new Date(data.checkOutDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">住宿天數</span>
                        <span class="info-value">${data.nights} 晚</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${data.roomType}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房價（每晚）</span>
                        <span class="info-value">NT$ ${data.pricePerNight.toLocaleString()}</span>
                    </div>
                    ${data.addonsList ? `
                    <div class="info-row">
                        <span class="info-label">加購商品</span>
                        <span class="info-value">${data.addonsList}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">加購商品總額</span>
                        <span class="info-value">NT$ ${(data.addonsTotal || 0).toLocaleString()}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">總金額</span>
                        <span class="info-value">NT$ ${data.totalAmount.toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">支付方式</span>
                        <span class="info-value">${data.paymentAmount} - ${data.paymentMethod}</span>
                    </div>
                    <div class="info-row" style="border-bottom: none; margin-top: 15px; padding-top: 15px; border-top: 2px solid #667eea;">
                        <span class="info-label" style="font-size: 18px;">${data.paymentStatus === 'paid' ? '已付金額' : '應付金額'}</span>
                        <span class="info-value" style="font-size: 20px; color: ${data.paymentStatus === 'paid' ? '#4caf50' : '#667eea'}; font-weight: 700;">NT$ ${data.finalAmount.toLocaleString()}</span>
                    </div>
                </div>

                ${data.paymentStatus === 'paid' ? `
                <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 15px; margin: 20px 0;">
                    <p style="color: #2e7d32; font-weight: 600; margin: 0; font-size: 16px;">✅ 付款已完成！</p>
                    <p style="color: #2e7d32; margin: 10px 0 0 0; font-size: 14px;">感謝您的付款，訂房已確認完成。</p>
                </div>
                ` : ''}

                ${data.paymentAmount && data.paymentAmount.includes('訂金') && data.paymentStatus !== 'paid' ? (() => {
                    const discountedTotal = data.discountedTotal || data.totalAmount || 0;
                    const remainingAmount = Math.max(0, discountedTotal - (data.finalAmount || 0));
                    return `
                <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 15px; margin: 20px 0;">
                    <p style="color: #2e7d32; font-weight: 600; margin: 0; font-size: 16px;">💡 剩餘尾款於現場付清！</p>
                    <p style="color: #2e7d32; margin: 10px 0 0 0; font-size: 18px; font-weight: 700;">剩餘尾款：NT$ ${remainingAmount.toLocaleString()}</p>
                </div>
                `;
                })() : ''}

                ${data.paymentMethodCode === 'transfer' ? `
                <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #856404; margin-top: 0;">💰 匯款提醒</h3>
                    <p style="color: #856404; font-weight: 600; margin: 10px 0;">
                        ⏰ 此訂房將為您保留 <strong>${data.daysReserved || 3} 天</strong>，請於 <strong>${data.paymentDeadline ? data.paymentDeadline + '前' : (data.daysReserved || 3) + '天內'}</strong>完成匯款，逾期將自動取消訂房。
                    </p>
                    ${data.bankInfo && data.bankInfo.account ? `
                    <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                        <p style="margin: 8px 0; color: #333;"><strong>匯款資訊：</strong></p>
                        ${data.bankInfo.bankName ? `<p style="margin: 5px 0; color: #333;">銀行：${data.bankInfo.bankName}${data.bankInfo.bankBranch ? ' - ' + data.bankInfo.bankBranch : ''}</p>` : ''}
                        <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">${data.bankInfo.account}</span></p>
                        ${data.bankInfo.accountName ? `<p style="margin: 5px 0; color: #333;">戶名：${data.bankInfo.accountName}</p>` : ''}
                        <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>${data.bookingId ? data.bookingId.slice(-5) : ''}</strong></p>
                        <p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">匯款後請加入官方LINE告知，謝謝！</p>
                    </div>
                    ` : '<p style="color: #856404; margin: 10px 0;">⚠️ 匯款資訊尚未設定，請聯繫客服取得匯款帳號。</p>'}
                </div>
                ` : ''}

                <p style="margin-top: 30px;"><strong>重要提醒：</strong></p>
                <ul>
                    <li>請於入住當天攜帶身分證件辦理入住手續</li>
                    <li>如需取消或變更訂房，請提前 3 天通知</li>
                    <li>如有任何問題，請隨時與我們聯繫</li>
                </ul>

                <div class="footer" style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd;">
                    <p>感謝您的預訂，期待為您服務！</p>
                    <p>此為系統自動發送郵件，請勿直接回覆</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    }

    async function generatePaymentReceivedEmail(booking) {
        try {
            const { content } = await generateEmailFromTemplate('payment_completed', booking);
            return content;
        } catch (error) {
            console.error('⚠️ 無法從數據庫讀取付款完成確認模板，使用備用方案:', error.message);
            const hotelInfoFooter = await getHotelInfoFooter();
            const checkInDate = new Date(booking.check_in_date);
            const checkOutDate = new Date(booking.check_out_date);

            return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #198754; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #e8f5e9; border: 2px solid #198754; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✅ 已收到您的匯款</h1>
                <p>感謝您的付款！</p>
            </div>
            <div class="content">
                <p>親愛的 ${booking.guest_name}，</p>
                <p style="margin-bottom: 20px;">我們已確認收到您本次訂房的匯款，以下是您的訂房與付款資訊：</p>

                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${booking.booking_id}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${checkInDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${checkOutDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${booking.room_type}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">總金額</span>
                        <span class="info-value">NT$ ${Number(booking.total_amount || 0).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">本次已收金額</span>
                        <span class="info-value" style="color: #198754; font-weight: 700;">NT$ ${Number(booking.final_amount || 0).toLocaleString()}</span>
                    </div>
                    <div class="info-row" style="border-bottom: none;">
                        <span class="info-label">付款方式</span>
                        <span class="info-value">${booking.payment_method}</span>
                    </div>
                </div>

                <p>若您後續仍需變更或取消訂房，請儘早與我們聯繫，我們將盡力協助您。</p>

                <div class="footer">
                    <p>再次感謝您的預訂，期待您的光臨！</p>
                    <p>此為系統自動發送郵件，請勿直接回覆</p>
                </div>
                ${hotelInfoFooter}
            </div>
        </div>
    </body>
    </html>
    `;
        }
    }

    function generateAdminEmail(data) {
        return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e74c3c; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔔 新訂房通知</h1>
            </div>
            <div class="content">
                <p>您有一筆新的訂房申請：</p>

                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${data.bookingId}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">客戶姓名</span>
                        <span class="info-value">${data.guestName}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">聯絡電話</span>
                        <span class="info-value">${data.guestPhone}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Email</span>
                        <span class="info-value">${data.guestEmail}</span>
                    </div>
                    ${data.specialRequest ? `
                    <div class="info-row">
                        <span class="info-label">特殊需求</span>
                        <span class="info-value">${data.specialRequest}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${new Date(data.checkInDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${new Date(data.checkOutDate).toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${data.roomType}</span>
                    </div>
                    ${data.addonsList ? `
                    <div class="info-row">
                        <span class="info-label">加購商品</span>
                        <span class="info-value">${data.addonsList}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">加購商品總額</span>
                        <span class="info-value">NT$ ${(data.addonsTotal || 0).toLocaleString()}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">總金額</span>
                        <span class="info-value" style="color: #333; font-weight: 600;">NT$ ${(data.totalAmount || 0).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">${data.paymentStatus === 'paid' ? '已付金額' : '應付金額'}</span>
                        <span class="info-value" style="color: ${data.paymentStatus === 'paid' ? '#4caf50' : '#e74c3c'}; font-weight: 700;">NT$ ${data.finalAmount.toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">支付方式</span>
                        <span class="info-value">${data.paymentAmount} - ${data.paymentMethod}</span>
                    </div>
                    ${data.paymentStatus === 'paid' ? `
                    <div class="info-row">
                        <span class="info-label">付款狀態</span>
                        <span class="info-value" style="color: #4caf50; font-weight: 700;">✅ 已付款</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">訂房時間</span>
                        <span class="info-value">${new Date(data.bookingDate).toLocaleString('zh-TW')}</span>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    }

    async function generateCancellationEmail(booking) {
        const hotelInfoFooter = await getHotelInfoFooter();
        const bookingDate = new Date(booking.created_at);
        const checkInDate = new Date(booking.check_in_date);
        const checkOutDate = new Date(booking.check_out_date);

        const msPerDay = 1000 * 60 * 60 * 24;
        const nights = Math.max(1, Math.round((checkOutDate - checkInDate) / msPerDay));

        return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
            .info-label { font-weight: 600; color: #666; }
            .info-value { color: #333; }
            .highlight { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e74c3c; }
            .warning-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚠️ 訂房已自動取消</h1>
                <p>很抱歉，您的訂房因超過保留期限已自動取消</p>
            </div>
            <div class="content">
                <p>親愛的 ${booking.guest_name}，</p>
                <p style="margin-bottom: 25px;">很抱歉通知您，由於超過匯款保留期限，您的訂房已自動取消。以下是取消的訂房資訊：</p>

                <div class="highlight">
                    <div class="info-row">
                        <span class="info-label">訂房編號</span>
                        <span class="info-value"><strong>${booking.booking_id}</strong></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">入住日期</span>
                        <span class="info-value">${checkInDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">退房日期</span>
                        <span class="info-value">${checkOutDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">住宿天數</span>
                        <span class="info-value">${nights} 晚</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">房型</span>
                        <span class="info-value">${booking.room_type || '-'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">訂房日期</span>
                        <span class="info-value">${bookingDate.toLocaleDateString('zh-TW')}</span>
                    </div>
                    <div class="info-row" style="border-bottom: none;">
                        <span class="info-label">應付金額</span>
                        <span class="info-value">NT$ ${(booking.final_amount || 0).toLocaleString()}</span>
                    </div>
                </div>

                <div class="warning-box">
                    <h3 style="color: #856404; margin-top: 0;">📌 取消原因</h3>
                    <p style="color: #856404; margin: 10px 0;">
                        此訂房因超過匯款保留期限，且未在期限內完成付款，系統已自動取消。
                    </p>
                </div>

                <div style="background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #2e7d32; margin-top: 0;">💡 如需重新訂房</h3>
                    <p style="color: #2e7d32; margin: 10px 0;">
                        如果您仍希望預訂，歡迎重新進行訂房。如有任何疑問，請隨時與我們聯繫。
                    </p>
                </div>

                ${hotelInfoFooter}
            </div>
        </div>
    </body>
    </html>
    `;
    }

    return {
        generateCustomerEmail,
        generateAdminEmail,
        generatePaymentReceivedEmail,
        generateCancellationEmail
    };
}

module.exports = {
    createEmailFallbackTemplatesService
};
