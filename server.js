const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto'); // ★ 新增：用於加密

const app = express();
const PORT = process.env.PORT || 3000;

// ★ 設定：請將此網址改為您 Vercel 前端的網址，付款完成後會導回這裡
const FRONTEND_URL = "https://lele-candles.vercel.app"; 
// ★ 設定：後端網址 (Render 的網址)，用於接收藍新通知
const BACKEND_URL = "https://lelecandles.onrender.com"; 

// --- 藍新金流測試參數 ---
const NEWEB_OPTS = {
    MerchantID: 'MS157637331',
    HashKey: 'H4pFd7PQ2uqpt8IOjLgSoCIBRyI5QLU0',
    HashIV: 'CPx24loDHvldIgkP',
    Version: '2.0',
    RespondType: 'JSON',
    PayGateWay: 'https://ccore.newebpay.com/MPG/mpg_gateway' // 測試環境網址
};

// --- 中介軟體設定 ---
app.use(cors());
app.use(express.json());
// ★ 新增：為了接收藍新回傳的 application/x-www-form-urlencoded 資料
app.use(express.urlencoded({ extended: true }));

// --- 資料庫連線 ---
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
    trackingNumber: { type: String, default: "" }
});

const Order = mongoose.model('Order', orderSchema);

// --- 藍新金流 加密輔助函式 ---
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
    // 去除 Padding 字元
    const result = plainText.replace(/[\x00-\x20]+/g, "");
    return JSON.parse(result);
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

// 3. 更新訂單
app.put('/api/orders/:id', async (req, res) => {
    try {
        const updatedOrder = await Order.findOneAndUpdate(
            { id: req.params.id }, 
            req.body, 
            { new: true }
        );
        res.json(updatedOrder);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// ★ 4. 產生藍新付款參數 (供前端呼叫)
app.post('/api/payment/create', async (req, res) => {
    try {
        const { orderId, amount, email, itemDesc } = req.body;

        // 建立交易參數
        const timeStamp = Math.round(new Date().getTime() / 1000);
        const tradeInfo = {
            MerchantID: NEWEB_OPTS.MerchantID,
            RespondType: 'JSON',
            TimeStamp: timeStamp,
            Version: NEWEB_OPTS.Version,
            MerchantOrderNo: orderId, // 訂單編號
            Amt: parseInt(amount),    // 金額
            ItemDesc: itemDesc || 'LeLe Candles Products', // 商品描述
            Email: email || '',       // 付款人 Email
            NotifyURL: `${BACKEND_URL}/api/payment/notify`, // 幕後通知 (更新資料庫用)
            ReturnURL: `${BACKEND_URL}/api/payment/return`, // 支付完成返回 (導回前台用)
            LoginType: 0, // 不需登入藍新會員
        };

        // 加密
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

// ★ 5. 接收藍新 Notify (幕後 Server-to-Server 通知)
// 藍新會對此網址 POST 資料，我們在此更新資料庫
app.post('/api/payment/notify', async (req, res) => {
    try {
        const { TradeInfo } = req.body;
        if (!TradeInfo) return res.status(400).send('No TradeInfo');

        // 解密交易內容
        const data = createMpgAesDecrypt(TradeInfo);
        console.log('Payment Notify:', data);

        // 確認交易成功
        if (data.Status === 'SUCCESS') {
            const orderId = data.Result.MerchantOrderNo;
            
            // 更新資料庫狀態為已付款
            await Order.findOneAndUpdate(
                { id: orderId },
                { 
                    'status.paid': true,
                    // 也可以選擇性把藍新交易序號存入 remarks 或其他欄位
                    // remarks: `[藍新付款成功] ${data.Result.TradeNo}` 
                }
            );
            console.log(`Order ${orderId} updated to PAID.`);
        }

        // 回應藍新收到通知
        res.status(200).send('OK');
    } catch (err) {
        console.error('Notify Error:', err);
        res.status(500).send('Error');
    }
});

// ★ 6. 接收藍新 Return (使用者瀏覽器導回)
// 使用者付款完會被轉址到這裡，我們再轉回前端頁面
app.post('/api/payment/return', async (req, res) => {
    // 通常這裡也要解密確認狀態，但最重要的是把使用者導回前台
    // 這裡直接導回首頁或感謝頁面
    res.redirect(`${FRONTEND_URL}?payment=success`); 
    // 您可以在前端偵測網址參數 ?payment=success 來跳出「付款成功」的 Alert
});


// --- 啟動伺服器 ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('DB Error:', err));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});