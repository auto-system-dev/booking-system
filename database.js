// 資料庫模組
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 資料庫檔案路徑
const DB_PATH = path.join(__dirname, 'bookings.db');

// 建立資料庫連線
function getDatabase() {
    return new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('❌ 資料庫連線失敗:', err.message);
        } else {
            console.log('✅ 已連接到 SQLite 資料庫');
        }
    });
}

// 初始化資料庫（建立資料表）
function initDatabase() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        db.serialize(() => {
            // 建立訂房資料表
            db.run(`
                CREATE TABLE IF NOT EXISTS bookings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    booking_id TEXT UNIQUE NOT NULL,
                    check_in_date TEXT NOT NULL,
                    check_out_date TEXT NOT NULL,
                    room_type TEXT NOT NULL,
                    guest_name TEXT NOT NULL,
                    guest_phone TEXT NOT NULL,
                    guest_email TEXT NOT NULL,
                    payment_amount TEXT NOT NULL,
                    payment_method TEXT NOT NULL,
                    price_per_night INTEGER NOT NULL,
                    nights INTEGER NOT NULL,
                    total_amount INTEGER NOT NULL,
                    final_amount INTEGER NOT NULL,
                    booking_date TEXT NOT NULL,
                    email_sent INTEGER DEFAULT 0,
                    payment_status TEXT DEFAULT 'pending',
                    status TEXT DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ 建立資料表失敗:', err.message);
                    db.close();
                    reject(err);
                    return;
                }
                
                console.log('✅ 資料表已準備就緒');
                
                // 檢查並新增欄位（如果不存在）
                // 使用 serialize 確保順序執行
                db.run(`ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'pending'`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.warn('⚠️  新增 payment_status 欄位時發生錯誤:', err.message);
                    }
                    
                    // 第二個 ALTER TABLE
                    db.run(`ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'active'`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.warn('⚠️  新增 status 欄位時發生錯誤:', err.message);
                        } else {
                            console.log('✅ 資料表欄位已更新');
                        }
                        
                        // 建立房型設定表
                        db.run(`
                            CREATE TABLE IF NOT EXISTS room_types (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT UNIQUE NOT NULL,
                                display_name TEXT NOT NULL,
                                price INTEGER NOT NULL,
                                icon TEXT DEFAULT '🏠',
                                display_order INTEGER DEFAULT 0,
                                is_active INTEGER DEFAULT 1,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, (err) => {
                            if (err) {
                                console.warn('⚠️  建立 room_types 表時發生錯誤:', err.message);
                            } else {
                                console.log('✅ 房型設定表已準備就緒');
                                
                                // 初始化預設房型（如果表是空的）
                                db.get('SELECT COUNT(*) as count FROM room_types', [], (err, row) => {
                                    if (!err && row && row.count === 0) {
                                        const defaultRooms = [
                                            ['standard', '標準雙人房', 2000, '🏠', 1],
                                            ['deluxe', '豪華雙人房', 3500, '✨', 2],
                                            ['suite', '尊爵套房', 5000, '👑', 3],
                                            ['family', '家庭四人房', 4500, '👨‍👩‍👧‍👦', 4]
                                        ];
                                        
                                        const stmt = db.prepare('INSERT INTO room_types (name, display_name, price, icon, display_order) VALUES (?, ?, ?, ?, ?)');
                                        defaultRooms.forEach(room => {
                                            stmt.run(room);
                                        });
                                        stmt.finalize();
                                        console.log('✅ 預設房型已初始化');
                                    }
                                });
                            }
                            
                            // 建立系統設定表
                            db.run(`
                                CREATE TABLE IF NOT EXISTS settings (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    key TEXT UNIQUE NOT NULL,
                                    value TEXT NOT NULL,
                                    description TEXT,
                                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                            `, (err) => {
                                if (err) {
                                    console.warn('⚠️  建立 settings 表時發生錯誤:', err.message);
                                } else {
                                    console.log('✅ 系統設定表已準備就緒');
                                    
                                    // 初始化預設設定
                                    const defaultSettings = [
                                        ['deposit_percentage', '30', '訂金百分比（例如：30 表示 30%）'],
                                        ['bank_name', '', '銀行名稱'],
                                        ['bank_branch', '', '分行名稱'],
                                        ['bank_account', '', '匯款帳號'],
                                        ['account_name', '', '帳戶戶名'],
                                        ['enable_transfer', '1', '啟用匯款轉帳（1=啟用，0=停用）'],
                                        ['enable_card', '1', '啟用線上刷卡（1=啟用，0=停用）'],
                                        ['ecpay_merchant_id', '', '綠界商店代號（MerchantID）'],
                                        ['ecpay_hash_key', '', '綠界金鑰（HashKey）'],
                                        ['ecpay_hash_iv', '', '綠界向量（HashIV）']
                                    ];
                                    
                                    // 初始化預設設定
                                    let settingsCount = 0;
                                    defaultSettings.forEach(([key, value, description]) => {
                                        db.get('SELECT COUNT(*) as count FROM settings WHERE key = ?', [key], (err, row) => {
                                            if (!err && row && row.count === 0) {
                                                db.run('INSERT INTO settings (key, value, description) VALUES (?, ?, ?)', 
                                                    [key, value, description], (err) => {
                                                    if (!err) {
                                                        settingsCount++;
                                                        if (settingsCount === defaultSettings.length) {
                                                            console.log('✅ 預設設定已初始化');
                                                            // 所有設定初始化完成後，建立郵件模板表
                                                            createEmailTemplatesTable();
                                                        }
                                                    } else {
                                                        settingsCount++;
                                                        checkSettingsComplete();
                                                    }
                                                });
                                            } else {
                                                settingsCount++;
                                                checkSettingsComplete();
                                            }
                                        });
                                    });
                                    
                                    function checkSettingsComplete() {
                                        if (settingsCount === defaultSettings.length) {
                                            console.log('✅ 預設設定已初始化');
                                            createEmailTemplatesTable();
                                        }
                                    }
                                    
                                    function createEmailTemplatesTable() {
                                        // 建立郵件模板表
                                        db.run(`
                                        CREATE TABLE IF NOT EXISTS email_templates (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            template_key TEXT UNIQUE NOT NULL,
                                            template_name TEXT NOT NULL,
                                            subject TEXT NOT NULL,
                                            content TEXT NOT NULL,
                                            is_enabled INTEGER DEFAULT 1,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `, (err) => {
                                        if (err) {
                                            console.warn('⚠️  建立 email_templates 表時發生錯誤:', err.message);
                                            db.close();
                                            resolve();
                                            return;
                                        }
                                        
                                        console.log('✅ 郵件模板表已準備就緒');
                                            
                                            // 初始化預設郵件模板
                                            const defaultTemplates = [
                                                {
                                                    key: 'payment_reminder',
                                                    name: '匯款提醒',
                                                    subject: '【重要提醒】匯款期限即將到期',
                                                    content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⏰ 匯款期限提醒</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            
            <div class="highlight">
                <h3 style="color: #856404; margin-top: 0;">⚠️ 重要提醒</h3>
                <p style="color: #856404; font-weight: 600; font-size: 18px;">
                    您的訂房匯款期限將於 <strong>今天</strong> 到期！
                </p>
                <p style="color: #856404;">
                    請盡快完成匯款，逾期未匯款將自動取消訂房。
                </p>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>訂房資訊</h3>
                <div class="info-row">
                    <span class="info-label">訂房編號</span>
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">入住日期</span>
                    <span class="info-value">{{checkInDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">退房日期</span>
                    <span class="info-value">{{checkOutDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">應付金額</span>
                    <span class="info-value" style="color: #e74c3c; font-weight: 700; font-size: 18px;">NT$ {{finalAmount}}</span>
                </div>
            </div>
            
            <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #856404; margin-top: 0;">💰 匯款資訊</h3>
                <p style="color: #856404; font-weight: 600; margin: 10px 0;">
                    請於 <strong>今天</strong> 完成匯款
                </p>
                <div style="background: white; padding: 15px; border-radius: 5px; margin-top: 15px;">
                    <p style="margin: 5px 0; color: #333;"><strong>匯款資訊：</strong></p>
                    <p style="margin: 5px 0; color: #333;">銀行：XXX銀行 - XXX分行</p>
                    <p style="margin: 5px 0; color: #333;">帳號：<span style="font-size: 18px; color: #e74c3c; font-weight: 700; letter-spacing: 2px;">1234567890123</span></p>
                    <p style="margin: 5px 0; color: #333;">戶名：XXX</p>
                    <p style="margin: 15px 0 5px 0; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">請在匯款時備註訂房編號後5碼：<strong>{{bookingId}}</strong></p>
                </div>
            </div>
            
            <p>如有任何問題，請隨時與我們聯繫。</p>
            <p>感謝您的配合！</p>
        </div>
    </div>
</body>
</html>`,
                                                    enabled: 1
                                                },
                                                {
                                                    key: 'checkin_reminder',
                                                    name: '入住提醒',
                                                    subject: '【入住提醒】歡迎您明天入住',
                                                    content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #667eea; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .highlight { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 入住提醒</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p>感謝您選擇我們的住宿服務！我們期待您明天的到來。</p>
            
            <div class="info-box">
                <h3>📅 訂房資訊</h3>
                <div class="info-row">
                    <span class="info-label">訂房編號</span>
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">入住日期</span>
                    <span class="info-value">{{checkInDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">退房日期</span>
                    <span class="info-value">{{checkOutDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
            </div>
            
            <div class="info-box">
                <h3>📍 交通路線</h3>
                <p><strong>地址：</strong>台北市信義區信義路五段7號</p>
                <p><strong>大眾運輸：</strong></p>
                <ul>
                    <li>捷運：搭乘板南線至「市政府站」，從2號出口步行約5分鐘</li>
                    <li>公車：搭乘 20、32、46 路公車至「信義行政中心站」</li>
                </ul>
                <p><strong>自行開車：</strong></p>
                <ul>
                    <li>國道一號：下「信義交流道」，沿信義路直行約3公里</li>
                    <li>國道三號：下「木柵交流道」，接信義快速道路</li>
                </ul>
            </div>
            
            <div class="info-box">
                <h3>🅿️ 停車資訊</h3>
                <p><strong>停車場位置：</strong>B1-B3 地下停車場</p>
                <p><strong>停車費用：</strong></p>
                <ul>
                    <li>住宿客人：每日 NT$ 200（可無限次進出）</li>
                    <li>臨時停車：每小時 NT$ 50</li>
                </ul>
                <p><strong>停車場開放時間：</strong>24 小時</p>
                <p><strong>注意事項：</strong>停車位有限，建議提前預約</p>
            </div>
            
            <div class="highlight">
                <h3 style="color: #856404; margin-top: 0;">⚠️ 入住注意事項</h3>
                <ul style="color: #856404;">
                    <li>入住時間：下午 3:00 後</li>
                    <li>退房時間：上午 11:00 前</li>
                    <li>請攜帶身分證件辦理入住手續</li>
                    <li>房間內禁止吸菸，違者將收取清潔費 NT$ 3,000</li>
                    <li>請保持安靜，避免影響其他住客</li>
                    <li>貴重物品請妥善保管，建議使用房間保險箱</li>
                    <li>如需延遲退房，請提前告知櫃檯</li>
                </ul>
            </div>
            
            <div class="info-box">
                <h3>📞 聯絡資訊</h3>
                <p>如有任何問題，歡迎隨時聯繫我們：</p>
                <p><strong>電話：</strong>02-1234-5678</p>
                <p><strong>Email：</strong>service@hotel.com</p>
                <p><strong>服務時間：</strong>24 小時</p>
            </div>
            
            <p>期待您的到來，祝您住宿愉快！</p>
        </div>
    </div>
</body>
</html>`,
                                                    enabled: 1
                                                },
                                                {
                                                    key: 'feedback_request',
                                                    name: '回訪信',
                                                    subject: '【回訪邀請】分享您的住宿體驗',
                                                    content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ddd; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        .btn { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; margin: 10px 5px; }
        .rating { text-align: center; margin: 20px 0; }
        .star { font-size: 40px; color: #ffc107; margin: 0 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⭐ 感謝您的入住</h1>
        </div>
        <div class="content">
            <p>親愛的 {{guestName}} 您好，</p>
            <p>感謝您選擇我們的住宿服務！希望您這次的住宿體驗愉快舒適。</p>
            
            <div class="info-box">
                <h3>📅 住宿資訊</h3>
                <div class="info-row">
                    <span class="info-label">訂房編號</span>
                    <span class="info-value"><strong>{{bookingId}}</strong></span>
                </div>
                <div class="info-row">
                    <span class="info-label">入住日期</span>
                    <span class="info-value">{{checkInDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">退房日期</span>
                    <span class="info-value">{{checkOutDate}}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">房型</span>
                    <span class="info-value">{{roomType}}</span>
                </div>
            </div>
            
            <div class="rating">
                <h3>您的寶貴意見對我們非常重要！</h3>
                <p>請為我們的服務評分：</p>
                <div>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                    <span class="star">⭐</span>
                </div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.google.com/maps/place/your-hotel" class="btn">在 Google 上給我們評價</a>
                <a href="https://www.booking.com/your-hotel" class="btn">在 Booking.com 上評價</a>
            </div>
            
            <div class="info-box">
                <h3>💬 意見回饋</h3>
                <p>如果您有任何建議或意見，歡迎透過以下方式與我們聯繫：</p>
                <p><strong>Email：</strong>feedback@hotel.com</p>
                <p><strong>電話：</strong>02-1234-5678</p>
                <p>您的意見將幫助我們持續改進服務品質！</p>
            </div>
            
            <div class="info-box" style="background: #e8f5e9; border-left: 4px solid #4caf50;">
                <h3 style="color: #2e7d32;">🎁 再次入住優惠</h3>
                <p>感謝您的支持！再次預訂可享有 <strong>9 折優惠</strong>，歡迎隨時與我們聯繫。</p>
            </div>
            
            <p>期待再次為您服務！</p>
            <p>祝您 身體健康，萬事如意</p>
        </div>
    </div>
</body>
</html>`,
                                                    enabled: 1
                                                }
                                            ];
                                            
                                            let templateCount = 0;
                                            defaultTemplates.forEach(template => {
                                                // 先檢查模板是否存在且內容為空
                                                db.get(`SELECT content, template_name FROM email_templates WHERE template_key = ?`, [template.key], (err, row) => {
                                                    if (err) {
                                                        console.warn(`⚠️  查詢郵件模板 ${template.key} 失敗:`, err.message);
                                                    }
                                                    
                                                    // 如果模板不存在、內容為空、或名稱需要更新，則插入或更新
                                                    if (!row || !row.content || row.content.trim() === '' || row.template_name !== template.name) {
                                                        db.run(`INSERT OR REPLACE INTO email_templates (template_key, template_name, subject, content, is_enabled) VALUES (?, ?, ?, ?, ?)`,
                                                            [template.key, template.name, template.subject, template.content, template.enabled], (err) => {
                                                            if (err) {
                                                                console.warn(`⚠️  插入/更新郵件模板 ${template.key} 失敗:`, err.message);
                                                            } else {
                                                                if (row && (!row.content || row.content.trim() === '')) {
                                                                    console.log(`✅ 已更新空的郵件模板 ${template.key}`);
                                                                } else if (row && row.template_name !== template.name) {
                                                                    console.log(`✅ 已更新郵件模板名稱 ${template.key}: ${row.template_name} -> ${template.name}`);
                                                                }
                                                            }
                                                            templateCount++;
                                                            if (templateCount === defaultTemplates.length) {
                                                                console.log('✅ 預設郵件模板已初始化');
                                                                // 所有操作完成後才關閉連接
                                                                db.close();
                                                                resolve();
                                                            }
                                                        });
                                                    } else {
                                                        // 模板已存在且內容不為空，跳過
                                                        templateCount++;
                                                        if (templateCount === defaultTemplates.length) {
                                                            console.log('✅ 預設郵件模板已初始化');
                                                            // 所有操作完成後才關閉連接
                                                            db.close();
                                                            resolve();
                                                        }
                                                    }
                                                });
                                            });
                                            
                                            // 如果沒有模板需要插入，直接關閉連接
                                            if (defaultTemplates.length === 0) {
                                                db.close();
                                                resolve();
                                            }
                                        });
                                    }
                                    
                                    // 如果沒有設定需要初始化，直接建立郵件模板表
                                    if (defaultSettings.length === 0) {
                                        createEmailTemplatesTable();
                                    }
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

// 儲存訂房資料
function saveBooking(bookingData) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const sql = `
            INSERT INTO bookings (
                booking_id, check_in_date, check_out_date, room_type,
                guest_name, guest_phone, guest_email,
                payment_amount, payment_method,
                price_per_night, nights, total_amount, final_amount,
                booking_date, email_sent, payment_status, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [
            bookingData.bookingId,
            bookingData.checkInDate,
            bookingData.checkOutDate,
            bookingData.roomType,
            bookingData.guestName,
            bookingData.guestPhone,
            bookingData.guestEmail,
            bookingData.paymentAmount,
            bookingData.paymentMethod,
            bookingData.pricePerNight,
            bookingData.nights,
            bookingData.totalAmount,
            bookingData.finalAmount,
            bookingData.bookingDate,
            bookingData.emailSent ? 1 : 0,
            bookingData.paymentStatus || 'pending',
            bookingData.status || 'active'
        ];
        
        db.run(sql, values, function(err) {
            if (err) {
                console.error('❌ 儲存訂房資料失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 訂房資料已儲存 (ID: ${this.lastID})`);
                resolve(this.lastID);
            }
        });
        
        db.close();
    });
}

// 更新郵件發送狀態
function updateEmailStatus(bookingId, emailSent) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const sql = `UPDATE bookings SET email_sent = ? WHERE booking_id = ?`;
        
        db.run(sql, [emailSent ? 1 : 0, bookingId], function(err) {
            if (err) {
                console.error('❌ 更新郵件狀態失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 郵件狀態已更新 (影響行數: ${this.changes})`);
                resolve(this.changes);
            }
        });
        
        db.close();
    });
}

// 查詢所有訂房記錄
function getAllBookings() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const sql = `SELECT * FROM bookings ORDER BY created_at DESC`;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('❌ 查詢訂房記錄失敗:', err.message);
                reject(err);
            } else {
                resolve(rows);
            }
        });
        
        db.close();
    });
}

// 根據訂房編號查詢
function getBookingById(bookingId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const sql = `SELECT * FROM bookings WHERE booking_id = ?`;
        
        db.get(sql, [bookingId], (err, row) => {
            if (err) {
                console.error('❌ 查詢訂房記錄失敗:', err.message);
                reject(err);
            } else {
                resolve(row);
            }
        });
        
        db.close();
    });
}

// 根據 Email 查詢訂房記錄
function getBookingsByEmail(email) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const sql = `SELECT * FROM bookings WHERE guest_email = ? ORDER BY created_at DESC`;
        
        db.all(sql, [email], (err, rows) => {
            if (err) {
                console.error('❌ 查詢訂房記錄失敗:', err.message);
                reject(err);
            } else {
                resolve(rows);
            }
        });
        
        db.close();
    });
}

// 更新訂房資料
function updateBooking(bookingId, updateData) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const allowedFields = [
            'guest_name', 'guest_phone', 'guest_email', 'room_type',
            'check_in_date', 'check_out_date', 'payment_status',
            'payment_method', 'payment_amount', 'price_per_night',
            'nights', 'total_amount', 'final_amount'
        ];
        
        const updates = [];
        const values = [];
        
        allowedFields.forEach(field => {
            if (updateData[field] !== undefined && updateData[field] !== null) {
                // 對於數字欄位，允許 0 值
                const isNumericField = ['price_per_night', 'nights', 'total_amount', 'final_amount'].includes(field);
                // 數字欄位：只要不是 undefined 或 null 就更新（允許 0）
                // 非數字欄位：必須不是空字串
                if (isNumericField || (updateData[field] !== '' && String(updateData[field]).trim() !== '')) {
                    updates.push(`${field} = ?`);
                    // 將數字欄位轉換為整數
                    if (isNumericField) {
                        const numValue = parseInt(updateData[field]);
                        values.push(isNaN(numValue) ? 0 : numValue);
                    } else {
                        values.push(updateData[field]);
                    }
                }
            }
        });
        
        if (updates.length === 0) {
            db.close();
            reject(new Error('沒有要更新的欄位'));
            return;
        }
        
        values.push(bookingId);
        const sql = `UPDATE bookings SET ${updates.join(', ')} WHERE booking_id = ?`;
        
        console.log('執行 SQL:', sql);
        console.log('參數值:', values);
        
        db.run(sql, values, function(err) {
            if (err) {
                console.error('❌ 更新訂房記錄失敗:', err.message);
                console.error('SQL 錯誤詳情:', err);
                db.close();
                reject(err);
            } else {
                console.log(`✅ 訂房記錄已更新 (影響行數: ${this.changes})`);
                if (this.changes === 0) {
                    db.close();
                    reject(new Error('找不到該訂房記錄或沒有資料被更新'));
                } else {
                    db.close();
                    resolve(this.changes);
                }
            }
        });
    });
}

// 取消訂房
function cancelBooking(bookingId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        // 先檢查 status 欄位是否存在，如果不存在則新增
        db.get("PRAGMA table_info(bookings)", [], (err, rows) => {
            if (err) {
                console.error('❌ 檢查資料表結構失敗:', err.message);
                reject(err);
                db.close();
                return;
            }
            
            const hasStatusColumn = Array.isArray(rows) && rows.some(row => row.name === 'status');
            
            if (!hasStatusColumn) {
                // 如果沒有 status 欄位，先新增
                console.log('⚠️  資料表缺少 status 欄位，正在新增...');
                db.run(`ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'active'`, (alterErr) => {
                    if (alterErr && !alterErr.message.includes('duplicate column')) {
                        console.error('❌ 新增 status 欄位失敗:', alterErr.message);
                        reject(alterErr);
                        db.close();
                        return;
                    }
                    // 欄位新增成功後，執行取消操作
                    performCancel();
                });
            } else {
                // 欄位已存在，直接執行取消操作
                performCancel();
            }
            
            function performCancel() {
                const sql = `UPDATE bookings SET status = 'cancelled' WHERE booking_id = ?`;
                
                db.run(sql, [bookingId], function(err) {
                    if (err) {
                        console.error('❌ 取消訂房失敗:', err.message);
                        reject(err);
                    } else {
                        console.log(`✅ 訂房已取消 (影響行數: ${this.changes})`);
                        resolve(this.changes);
                    }
                    db.close();
                });
            }
        });
    });
}

// 刪除訂房記錄（可選功能）
function deleteBooking(bookingId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const sql = `DELETE FROM bookings WHERE booking_id = ?`;
        
        db.run(sql, [bookingId], function(err) {
            if (err) {
                console.error('❌ 刪除訂房記錄失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 訂房記錄已刪除 (影響行數: ${this.changes})`);
                resolve(this.changes);
            }
        });
        
        db.close();
    });
}

// 統計資料
function getStatistics() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        const queries = {
            total: `SELECT COUNT(*) as count FROM bookings`,
            totalRevenue: `SELECT SUM(final_amount) as total FROM bookings`,
            byRoomType: `SELECT room_type, COUNT(*) as count FROM bookings GROUP BY room_type`,
            recentBookings: `SELECT COUNT(*) as count FROM bookings WHERE created_at >= datetime('now', '-7 days')`
        };
        
        Promise.all([
            new Promise((res, rej) => {
                db.get(queries.total, [], (err, row) => {
                    if (err) rej(err);
                    else res(row.count);
                });
            }),
            new Promise((res, rej) => {
                db.get(queries.totalRevenue, [], (err, row) => {
                    if (err) rej(err);
                    else res(row.total || 0);
                });
            }),
            new Promise((res, rej) => {
                db.all(queries.byRoomType, [], (err, rows) => {
                    if (err) rej(err);
                    else res(rows);
                });
            }),
            new Promise((res, rej) => {
                db.get(queries.recentBookings, [], (err, row) => {
                    if (err) rej(err);
                    else res(row.count);
                });
            })
        ]).then(([total, revenue, byRoomType, recent]) => {
            resolve({
                totalBookings: total,
                totalRevenue: revenue,
                byRoomType: byRoomType,
                recentBookings: recent
            });
        }).catch(reject);
        
        db.close();
    });
}

// ==================== 房型管理 ====================

// 取得所有房型
function getAllRoomTypes() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `SELECT * FROM room_types WHERE is_active = 1 ORDER BY display_order ASC, id ASC`;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('❌ 查詢房型失敗:', err.message);
                reject(err);
            } else {
                resolve(rows);
            }
            db.close();
        });
    });
}

// 取得單一房型
function getRoomTypeById(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `SELECT * FROM room_types WHERE id = ?`;
        
        db.get(sql, [id], (err, row) => {
            if (err) {
                console.error('❌ 查詢房型失敗:', err.message);
                reject(err);
            } else {
                resolve(row);
            }
            db.close();
        });
    });
}

// 新增房型
function createRoomType(roomData) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `INSERT INTO room_types (name, display_name, price, icon, display_order, is_active) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [
            roomData.name,
            roomData.display_name,
            roomData.price,
            roomData.icon || '🏠',
            roomData.display_order || 0,
            roomData.is_active !== undefined ? roomData.is_active : 1
        ], function(err) {
            if (err) {
                console.error('❌ 新增房型失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 房型已新增 (ID: ${this.lastID})`);
                resolve(this.lastID);
            }
            db.close();
        });
    });
}

// 更新房型
function updateRoomType(id, roomData) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `UPDATE room_types 
                     SET display_name = ?, price = ?, icon = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`;
        
        db.run(sql, [
            roomData.display_name,
            roomData.price,
            roomData.icon || '🏠',
            roomData.display_order || 0,
            roomData.is_active !== undefined ? roomData.is_active : 1,
            id
        ], function(err) {
            if (err) {
                console.error('❌ 更新房型失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 房型已更新 (影響行數: ${this.changes})`);
                resolve(this.changes);
            }
            db.close();
        });
    });
}

// 刪除房型（軟刪除）
function deleteRoomType(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `UPDATE room_types SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        
        db.run(sql, [id], function(err) {
            if (err) {
                console.error('❌ 刪除房型失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 房型已刪除 (影響行數: ${this.changes})`);
                resolve(this.changes);
            }
            db.close();
        });
    });
}

// ==================== 系統設定管理 ====================

// 取得設定值
function getSetting(key) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `SELECT value FROM settings WHERE key = ?`;
        
        db.get(sql, [key], (err, row) => {
            if (err) {
                console.error('❌ 查詢設定失敗:', err.message);
                reject(err);
            } else {
                resolve(row ? row.value : null);
            }
            db.close();
        });
    });
}

// 取得所有設定
function getAllSettings() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const sql = `SELECT * FROM settings ORDER BY key ASC`;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('❌ 查詢設定失敗:', err.message);
                reject(err);
            } else {
                resolve(rows);
            }
            db.close();
        });
    });
}

// 更新設定
function updateSetting(key, value, description = null) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        // 使用 INSERT OR REPLACE 來更新或新增
        const sql = `INSERT OR REPLACE INTO settings (key, value, description, updated_at) 
                     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`;
        
        db.run(sql, [key, value, description], function(err) {
            if (err) {
                console.error('❌ 更新設定失敗:', err.message);
                reject(err);
            } else {
                console.log(`✅ 設定已更新 (key: ${key})`);
                resolve(this.changes);
            }
            db.close();
        });
    });
}

// ==================== 郵件模板相關函數 ====================

function getAllEmailTemplates() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        db.all('SELECT * FROM email_templates ORDER BY template_key', [], (err, rows) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(rows || []);
            }
        });
    });
}

function getEmailTemplateByKey(templateKey) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        db.get('SELECT * FROM email_templates WHERE template_key = ?', [templateKey], (err, row) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(row);
            }
        });
    });
}

function updateEmailTemplate(templateKey, data) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const { template_name, subject, content, is_enabled } = data;
        db.run(
            'UPDATE email_templates SET template_name = ?, subject = ?, content = ?, is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE template_key = ?',
            [template_name, subject, content, is_enabled ? 1 : 0, templateKey],
            function(err) {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            }
        );
    });
}

// 取得需要發送匯款提醒的訂房（匯款期限最後一天）
function getBookingsForPaymentReminder() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        // 計算3天前的日期（假設訂房後3天內要匯款）
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];
        
        // 查詢：付款方式為匯款轉帳、付款狀態為待付款、訂房日期為3天前、狀態為active
        db.all(`
            SELECT * FROM bookings 
            WHERE payment_method LIKE '%匯款%' 
            AND payment_status = 'pending' 
            AND status = 'active'
            AND DATE(created_at) = DATE(?)
            AND email_sent = 1
        `, [threeDaysAgoStr], (err, rows) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(rows || []);
            }
        });
    });
}

// 取得需要發送入住提醒的訂房（入住前一天）
function getBookingsForCheckinReminder() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        
        db.all(`
            SELECT * FROM bookings 
            WHERE check_in_date = ?
            AND status = 'active'
            AND payment_status = 'paid'
        `, [tomorrowStr], (err, rows) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(rows || []);
            }
        });
    });
}

// 取得需要發送回訪信的訂房（退房後隔天）
function getBookingsForFeedbackRequest() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        db.all(`
            SELECT * FROM bookings 
            WHERE check_out_date = ?
            AND status = 'active'
        `, [yesterdayStr], (err, rows) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(rows || []);
            }
        });
    });
}

// 檢查房間可用性（檢查指定日期範圍內是否有有效或保留的訂房）
function getRoomAvailability(checkInDate, checkOutDate) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        // 查詢在指定日期範圍內有重疊的有效或保留訂房
        // 訂房日期範圍與查詢日期範圍有重疊的條件：
        // 1. 訂房的入住日期 < 查詢的退房日期
        // 2. 訂房的退房日期 > 查詢的入住日期
        // 3. 訂房狀態為 'active' 或 'reserved'
        // 注意：bookings.room_type 儲存的是 display_name，需要轉換為 room_types.name
        db.all(`
            SELECT DISTINCT rt.name
            FROM bookings b
            INNER JOIN room_types rt ON b.room_type = rt.display_name
            WHERE (
                b.check_in_date < ? 
                AND b.check_out_date > ?
                AND b.status IN ('active', 'reserved')
            )
        `, [checkOutDate, checkInDate], (err, rows) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                // 返回已滿房的房型 name 列表（前端使用 name 來比較）
                const unavailableRooms = rows.map(row => row.name);
                resolve(unavailableRooms || []);
            }
        });
    });
}

// 取得已過期保留期限的訂房（需要自動取消）
function getBookingsExpiredReservation() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        // 取得匯款提醒模板的保留天數（預設3天）
        // 查詢：付款方式為匯款轉帳、狀態為保留、付款狀態為待付款、創建日期超過保留天數
        // 由於 SQLite 不支援動態查詢模板設定，我們先查詢所有保留狀態的訂房，然後在應用層過濾
        db.all(`
            SELECT * FROM bookings 
            WHERE payment_method LIKE '%匯款%' 
            AND status = 'reserved' 
            AND payment_status = 'pending'
        `, [], (err, rows) => {
            if (err) {
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(rows || []);
            }
        });
    });
}

module.exports = {
    initDatabase,
    saveBooking,
    updateEmailStatus,
    getAllBookings,
    getBookingById,
    getBookingsByEmail,
    updateBooking,
    cancelBooking,
    deleteBooking,
    getStatistics,
    // 房型管理
    getAllRoomTypes,
    getRoomTypeById,
    createRoomType,
    updateRoomType,
    deleteRoomType,
    // 系統設定
    getSetting,
    getAllSettings,
    updateSetting,
    // 郵件模板
    getAllEmailTemplates,
    getEmailTemplateByKey,
    updateEmailTemplate,
    // 自動郵件查詢
    getBookingsForPaymentReminder,
    getBookingsForCheckinReminder,
    getBookingsForFeedbackRequest,
    // 房間可用性
    getRoomAvailability,
    // 過期保留訂房
    getBookingsExpiredReservation
};

