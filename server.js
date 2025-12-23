const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
// ★ 1. 引入 nodemailer
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = "https://lelecandles-web.vercel.app/"; 
const BACKEND_URL = "https://lelecandles.onrender.com"; 

// --- ★ 2. 郵件設定 (請填入您的資訊) ---
const EMAIL_USER = 'chiulele614@gmail.com'; 
const EMAIL_PASS = 'krhopumeudshilrm'; // 請去 Google 帳戶 > 安全性 > 應用程式密碼 申請

// 建立發信器
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Port 587 必須設為 false (會在連線後自動升級加密)
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false // 忽略憑證問題
    },
    family: 4, // 強制使用 IPv4 (解決 Render 常見的 DNS 問題)
    logger: true, // 保持 Log 開啟以便除錯
    debug: true
});

// --- 藍新金流測試參數 ---
const NEWEB_OPTS = {
    MerchantID: 'MS157637331',
    HashKey: 'H4pFd7PQ2uqpt8IOjLgSoCIBRyI5QLU0',
    HashIV: 'CPx24loDHvldIgkP',
    Version: '2.0',
    RespondType: 'JSON',
    PayGateWay: 'https://ccore.newebpay.com/MPG/mpg_gateway'
};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MONGO_URI = 'mongodb+srv://kechunlin50_db_user:1oTBMgKskurDQxSL@lele-server.l67p3cy.mongodb.net/?appName=lele-server';

const orderSchema = new mongoose.Schema({
    id: String,
    date: String,
    customer: {
        name: String,
        phone: String,
        address: String,
        email: String
    },
    items: Array,
    total: String,
    remarks: String,
    status: {
        paid: { type: Boolean, default: false },
        produced: { type: Boolean, default: false },
        shipped: { type: Boolean, default: false }
    },
    trackingNumber: { type: String, default: "" },
    lang: { type: String, default: "zh" } // ★ 新增：儲存訂單語言 (預設中文)
});

const Order = mongoose.model('Order', orderSchema);

// --- 藍新金流 加密輔助函式 (保持不變) ---
function genDataChain(TradeInfo) {
    let results = [];
    for (let kv of Object.entries(TradeInfo)) {
        results.push(`${kv[0]}=${kv[1]}`);
    }
    return results.join("&");
}

function createMpgAesEncrypt(TradeInfo) {
    const encrypt = crypto.createCipheriv("aes-256-cbc", NEWEB_OPTS.HashKey, NEWEB_OPTS.HashIV);
    const encrypted = encrypt.update(genDataChain(TradeInfo), "utf8", "hex");
    return encrypted + encrypt.final("hex");
}

function createMpgShaEncrypt(aesEncrypt) {
    const sha = crypto.createHash("sha256");
    const plainText = `HashKey=${NEWEB_OPTS.HashKey}&${aesEncrypt}&HashIV=${NEWEB_OPTS.HashIV}`;
    return sha.update(plainText).digest("hex").toUpperCase();
}

function createMpgAesDecrypt(TradeInfo) {
    const decrypt = crypto.createDecipheriv("aes-256-cbc", NEWEB_OPTS.HashKey, NEWEB_OPTS.HashIV);
    decrypt.setAutoPadding(false);
    const text = decrypt.update(TradeInfo, "hex", "utf8");
    const plainText = text + decrypt.final("utf8");
    const result = plainText.replace(/[\x00-\x20]+/g, "");
    return JSON.parse(result);
}


const EMAIL_TEMPLATES = {
    zh: {
        PAID_SUBJECT: "[LeLe Candles] 訂單 {id} 付款確認通知",
        PAID_TEXT: "親愛的顧客您好，\n\n我們已收到您的訂單款項 ({id})。\n我們將盡快為您製作並安排出貨。\n\n感謝您的支持！",
        SHIPPED_SUBJECT: "[LeLe Candles] 訂單 {id} 出貨通知",
        SHIPPED_TEXT: "親愛的顧客您好，\n\n您的訂單 ({id}) 已經出貨了！\n物流追蹤單號：{tracking}\n\n期待香氛能溫暖您的生活。"
    },
    en: {
        PAID_SUBJECT: "[LeLe Candles] Payment Confirmed: Order {id}",
        PAID_TEXT: "Dear Customer,\n\nWe have received your payment for order ({id}).\nWe will proceed with production and shipment as soon as possible.\n\nThank you for your support!",
        SHIPPED_SUBJECT: "[LeLe Candles] Order Shipped: {id}",
        SHIPPED_TEXT: "Dear Customer,\n\nYour order ({id}) has been shipped!\nTracking Number: {tracking}\n\nWe hope our scents bring warmth to your life."
    }
};



// --- ★ 3. 發信輔助函式 ---
async function sendStatusEmail(toEmail, orderId, type, trackingNum = "", lang = "zh") {
    if (!toEmail || !toEmail.includes('@')) return;

    // 確保語言代碼有效，否則預設為 zh
    const safeLang = (lang === 'en') ? 'en' : 'zh';
    const templates = EMAIL_TEMPLATES[safeLang];

    let subject = "";
    let text = "";

    if (type === 'PAID') {
        subject = templates.PAID_SUBJECT.replace('{id}', orderId);
        text = templates.PAID_TEXT.replace('{id}', orderId);
    } else if (type === 'SHIPPED') {
        subject = templates.SHIPPED_SUBJECT.replace('{id}', orderId);
        text = templates.SHIPPED_TEXT.replace('{id}', orderId).replace('{tracking}', trackingNum);
    }

    try {
        await transporter.sendMail({
            from: `"LeLe Candles" <${EMAIL_USER}>`,
            to: toEmail,
            subject: subject,
            text: text
        });
        console.log(`Email sent to ${toEmail} (${type}) in ${safeLang}`);
    } catch (err) {
        console.error("Email send failed:", err);
    }
}

// --- API 路由 ---

// 1. 獲取所有訂單
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ _id: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 2. 新增訂單
app.post('/api/orders', async (req, res) => {
    const newOrder = new Order(req.body);
    try {
        const savedOrder = await newOrder.save();
        res.status(201).json(savedOrder);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 3. 更新訂單 (★ 修改處：加入發信判斷邏輯)
app.put('/api/orders/:id', async (req, res) => {
    try {
        const oldOrder = await Order.findOne({ id: req.params.id });
        if (!oldOrder) return res.status(404).json({ message: "Order not found" });

        const updatedOrder = await Order.findOneAndUpdate(
            { id: req.params.id }, 
            req.body, 
            { new: true }
        );

        const email = updatedOrder.customer.email;
        const newStatus = updatedOrder.status;
        const orderLang = updatedOrder.lang || 'zh'; // ★ 取得該訂單的語言設定

        // 狀態變化判斷
        if (!oldOrder.status.paid && newStatus.paid) {
            // ★ 傳入 orderLang
            sendStatusEmail(email, updatedOrder.id, 'PAID', "", orderLang);
        }

        if (!oldOrder.status.shipped && newStatus.shipped) {
            // ★ 傳入 orderLang
            sendStatusEmail(email, updatedOrder.id, 'SHIPPED', updatedOrder.trackingNumber, orderLang);
        }

        res.json(updatedOrder);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 4. 產生藍新付款參數
app.post('/api/payment/create', async (req, res) => {
    try {
        const { orderId, amount, email, itemDesc, lang } = req.body;

        let newebLang = 'zh-tw'; 
        if (lang === 'en') {
            newebLang = 'en';
        }

        const timeStamp = Math.round(new Date().getTime() / 1000);
        const tradeInfo = {
            MerchantID: NEWEB_OPTS.MerchantID,
            RespondType: 'JSON',
            TimeStamp: timeStamp,
            Version: NEWEB_OPTS.Version,
            MerchantOrderNo: orderId,
            Amt: parseInt(amount),
            ItemDesc: itemDesc || 'LeLe Candles Products',
            Email: email || '',
            NotifyURL: `${BACKEND_URL}/api/payment/notify`,
            ReturnURL: `${BACKEND_URL}/api/payment/return`,
            ClientBackURL: FRONTEND_URL,
            LoginType: 0,
            OrderComment: 'LeLe Candles',
            LangType: newebLang,
    
            // ★ 保留您之前設定的參數，避免報錯
            CREDIT: 1, VACC: 1, CVS: 1,
            InstFlag: 0, UNIONPAY: 0, CreditRed: 0, GOOGLEPAY: 0, SAMSUNGPAY: 0, LINEPAY: 0,
        };

        const aesEncrypt = createMpgAesEncrypt(tradeInfo);
        const shaEncrypt = createMpgShaEncrypt(aesEncrypt);

        res.json({
            status: true,
            data: {
                MerchantID: NEWEB_OPTS.MerchantID,
                TradeInfo: aesEncrypt,
                TradeSha: shaEncrypt,
                Version: NEWEB_OPTS.Version,
                PayGateWay: NEWEB_OPTS.PayGateWay
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Payment generation failed" });
    }
});

// 5. 接收藍新 Notify (★ 修改處：藍新付款成功時也發信)
app.post('/api/payment/notify', async (req, res) => {
    try {
        const { TradeInfo } = req.body;
        if (!TradeInfo) return res.status(400).send('No TradeInfo');

        const data = createMpgAesDecrypt(TradeInfo);
        console.log('Payment Notify:', data);

        if (data.Status === 'SUCCESS') {
            const orderId = data.Result.MerchantOrderNo;
            const order = await Order.findOne({ id: orderId });
            
            if (order && !order.status.paid) {
                await Order.findOneAndUpdate({ id: orderId }, { 'status.paid': true });
                
                const orderLang = order.lang || 'zh';
                
                // ★★★ 這裡一定要加 await，並包在 try-catch 中避免發信失敗導致當機 ★★★
                try {
                    console.log('Attempting to send email...');
                    await sendStatusEmail(order.customer.email, orderId, 'PAID', "", orderLang);
                    console.log(`Email sent successfully to ${order.customer.email}`);
                } catch (emailErr) {
                    console.error('Failed to send email but order updated:', emailErr);
                }
                
                console.log(`Order ${orderId} updated to PAID.`);
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error('Notify Error:', err);
        res.status(500).send('Error');
    }
});

// 6. 接收藍新 Return
app.post('/api/payment/return', async (req, res) => {
    try {
        const { TradeInfo } = req.body;
        const data = createMpgAesDecrypt(TradeInfo);
        
        console.log('Return Data:', data);

        const orderId = data.Result.MerchantOrderNo;
        
        if (data.Status === 'SUCCESS') {
            res.redirect(`${FRONTEND_URL}?payment=success&order_id=${orderId}`);
        } else {
            const errorMsg = encodeURIComponent(data.Message || '交易失敗');
            res.redirect(`${FRONTEND_URL}?payment=fail&order_id=${orderId}&msg=${errorMsg}`);
        }
        
    } catch (err) {
        console.error('Return Error:', err);
        res.redirect(`${FRONTEND_URL}?payment=error`);
    }
});


// --- 啟動伺服器 ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('DB Error:', err));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});