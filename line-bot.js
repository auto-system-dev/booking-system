// LINE Bot 服務模組
const axios = require('axios');
const db = require('./database');

class LineBotService {
    constructor() {
        this.channelAccessToken = '';
        this.channelSecret = '';
        this.apiBaseUrl = 'https://api.line.me/v2';
        // 初始化時載入設定
        this.loadSettings();
    }

    /**
     * 從資料庫或環境變數載入設定
     */
    async loadSettings() {
        try {
            // 優先使用資料庫設定，其次使用環境變數
            const dbChannelAccessToken = await db.getSetting('line_channel_access_token');
            const dbChannelSecret = await db.getSetting('line_channel_secret');
            
            this.channelAccessToken = dbChannelAccessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
            this.channelSecret = dbChannelSecret || process.env.LINE_CHANNEL_SECRET || '';
            
            if (this.channelAccessToken || this.channelSecret) {
                console.log('✅ LINE Bot 設定已載入（來源：' + (dbChannelAccessToken ? '資料庫' : '環境變數') + '）');
            }
        } catch (error) {
            console.warn('⚠️ 載入 LINE Bot 設定失敗，使用環境變數:', error.message);
            // 如果資料庫讀取失敗，使用環境變數
            this.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
            this.channelSecret = process.env.LINE_CHANNEL_SECRET || '';
        }
    }

    /**
     * 發送文字訊息
     * @param {string} userId - LINE User ID
     * @param {string} message - 訊息內容
     */
    async sendTextMessage(userId, message) {
        if (!this.channelAccessToken) {
            console.warn('⚠️ LINE Channel Access Token 未設定，無法發送訊息');
            return { success: false, error: 'LINE Channel Access Token 未設定' };
        }

        if (!userId) {
            console.warn('⚠️ LINE User ID 未提供');
            return { success: false, error: 'LINE User ID 未提供' };
        }

        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/bot/message/push`,
                {
                    to: userId,
                    messages: [
                        {
                            type: 'text',
                            text: message
                        }
                    ]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.channelAccessToken}`
                    }
                }
            );

            console.log('✅ LINE 訊息發送成功:', response.data);
            return { success: true, data: response.data };
        } catch (error) {
            console.error('❌ LINE 訊息發送失敗:', error.response?.data || error.message);
            return { 
                success: false, 
                error: error.response?.data?.message || error.message 
            };
        }
    }

    /**
     * 發送 Flex 訊息（用於訂房成功通知）
     * @param {string} userId - LINE User ID
     * @param {Object} bookingData - 訂房資料
     */
    async sendBookingSuccessMessage(userId, bookingData) {
        if (!this.channelAccessToken) {
            console.warn('⚠️ LINE Channel Access Token 未設定，無法發送訊息');
            return { success: false, error: 'LINE Channel Access Token 未設定' };
        }

        if (!userId) {
            console.warn('⚠️ LINE User ID 未提供');
            return { success: false, error: 'LINE User ID 未提供' };
        }

        try {
            // 建立 Flex 訊息內容
            const flexMessage = {
                type: 'flex',
                altText: '訂房成功通知',
                contents: {
                    type: 'bubble',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            {
                                type: 'text',
                                text: '✅ 訂房成功',
                                weight: 'bold',
                                size: 'xl',
                                color: '#ffffff'
                            }
                        ],
                        backgroundColor: '#4CAF50',
                        paddingAll: '20px'
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            {
                                type: 'text',
                                text: `感謝 ${bookingData.guestName} 的訂房！`,
                                weight: 'bold',
                                size: 'lg',
                                margin: 'md'
                            },
                            {
                                type: 'separator',
                                margin: 'md'
                            },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'md',
                                spacing: 'sm',
                                contents: [
                                    {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '訂房編號',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: bookingData.bookingId || 'N/A',
                                                size: 'sm',
                                                color: '#333333',
                                                align: 'end',
                                                weight: 'bold'
                                            }
                                        ]
                                    },
                                    {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '入住日期',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: bookingData.checkInDate || 'N/A',
                                                size: 'sm',
                                                color: '#333333',
                                                align: 'end'
                                            }
                                        ]
                                    },
                                    {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '退房日期',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: bookingData.checkOutDate || 'N/A',
                                                size: 'sm',
                                                color: '#333333',
                                                align: 'end'
                                            }
                                        ]
                                    },
                                    {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '房型',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: bookingData.roomType || 'N/A',
                                                size: 'sm',
                                                color: '#333333',
                                                align: 'end'
                                            }
                                        ]
                                    },
                                    {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '總金額',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: `NT$ ${(bookingData.totalAmount || 0).toLocaleString()}`,
                                                size: 'sm',
                                                color: '#333333',
                                                align: 'end'
                                            }
                                        ]
                                    },
                                    ...(bookingData.discountAmount && bookingData.discountAmount > 0 ? [{
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '優惠折扣',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: `-NT$ ${Math.round(bookingData.discountAmount).toLocaleString()}`,
                                                size: 'sm',
                                                color: '#10b981',
                                                align: 'end',
                                                weight: 'bold'
                                            }
                                        ]
                                    }, {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: '折後總額',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: `NT$ ${Math.round(bookingData.discountedTotal || bookingData.totalAmount || 0).toLocaleString()}`,
                                                size: 'sm',
                                                color: '#333333',
                                                align: 'end',
                                                weight: 'bold'
                                            }
                                        ]
                                    }] : []),
                                    {
                                        type: 'box',
                                        layout: 'horizontal',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: bookingData.isPaid ? '已付金額' : '應付金額',
                                                size: 'sm',
                                                color: '#666666',
                                                flex: 1
                                            },
                                            {
                                                type: 'text',
                                                text: `NT$ ${(bookingData.finalAmount || 0).toLocaleString()}`,
                                                size: 'sm',
                                                color: '#FF6B6B',
                                                align: 'end',
                                                weight: 'bold'
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    footer: {
                        type: 'box',
                        layout: 'vertical',
                        spacing: 'sm',
                        contents: [
                            {
                                type: 'text',
                                text: '確認信已發送至您的 Email',
                                size: 'xs',
                                color: '#666666',
                                align: 'center',
                                wrap: true
                            }
                        ],
                        paddingAll: 'md'
                    }
                }
            };

            const response = await axios.post(
                `${this.apiBaseUrl}/bot/message/push`,
                {
                    to: userId,
                    messages: [flexMessage]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.channelAccessToken}`
                    }
                }
            );

            console.log('✅ LINE Flex 訊息發送成功:', response.data);
            return { success: true, data: response.data };
        } catch (error) {
            console.error('❌ LINE Flex 訊息發送失敗:', error.response?.data || error.message);
            // 如果 Flex 訊息失敗，嘗試發送簡單文字訊息
            return await this.sendTextMessage(userId, this.formatBookingTextMessage(bookingData));
        }
    }

    /**
     * 格式化訂房成功文字訊息（備用方案）
     */
    formatBookingTextMessage(bookingData) {
        const amountLabel = bookingData.isPaid ? '已付金額' : '應付金額';
        let message = `✅ 訂房成功！

訂房編號：${bookingData.bookingId || 'N/A'}
入住日期：${bookingData.checkInDate || 'N/A'}
退房日期：${bookingData.checkOutDate || 'N/A'}
房型：${bookingData.roomType || 'N/A'}
總金額：NT$ ${(bookingData.totalAmount || 0).toLocaleString()}`;
        
        if (bookingData.discountAmount && bookingData.discountAmount > 0) {
            message += `\n優惠折扣：-NT$ ${Math.round(bookingData.discountAmount).toLocaleString()}`;
            message += `\n折後總額：NT$ ${Math.round(bookingData.discountedTotal || bookingData.totalAmount || 0).toLocaleString()}`;
        }
        
        message += `\n${amountLabel}：NT$ ${(bookingData.finalAmount || 0).toLocaleString()}

確認信已發送至您的 Email，請查收。`;
        
        return message;
    }

    /**
     * 驗證 LINE Webhook 簽章
     * @param {string} signature - LINE 簽章
     * @param {Buffer} body - 請求內容
     */
    verifySignature(signature, body) {
        if (!this.channelSecret) {
            console.warn('⚠️ LINE Channel Secret 未設定，無法驗證簽章');
            return false;
        }

        const crypto = require('crypto');
        const hash = crypto
            .createHmac('sha256', this.channelSecret)
            .update(body)
            .digest('base64');

        return hash === signature;
    }
}

module.exports = new LineBotService();

