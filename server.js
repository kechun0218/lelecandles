const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto'); // ★ 新增：用於加密

const app = express();
const PORT = process.env.PORT || 3000;

// ★ 設定：請將此網址改為您 Vercel 前端的網址，付款完成後會導回這裡
const FRONTEND_URL = "https://lelecandles-web.vercel.app/"; 
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
        //接收 lang 參數
        const { orderId, amount, email, itemDesc, lang } = req.body;

        //轉換語言格式 (藍新只接受: 'zh-tw', 'en', 'jp')
        // 預設為 zh-tw
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
            MerchantOrderNo: orderId, // 訂單編號
            Amt: parseInt(amount),    // 金額
            ItemDesc: itemDesc || 'LeLe Candles Products', // 商品描述
            Email: email || '',       // 付款人 Email
            NotifyURL: `${BACKEND_URL}/api/payment/notify`, // 幕後通知 (更新資料庫用)
            ReturnURL: `${BACKEND_URL}/api/payment/return`, // 支付完成返回 (導回前台用)
            
            // 當消費者在藍新頁面點擊「返回商店」或「交易失敗」時，會導向這裡
            ClientBackURL: FRONTEND_URL, 
            
            LoginType: 0,

            OrderComment: 'LeLe Candles',
            LangType: newebLang,


	    MerchantOrderNo: orderId,
    
            // ★★★ 必須加入這幾行來解決收單行錯誤 ★★★
            CREDIT: 1,      // 開啟信用卡
            VACC: 1,        // 開啟 ATM
            CVS: 1,         // 開啟超商代碼
    
            InstFlag: 0,    // ★ 關鍵：關閉分期付款 (解決收單行錯誤)
            UNIONPAY: 0,    // ★ 關鍵：關閉銀聯卡
            CreditRed: 0,   // 關閉紅利
            GOOGLEPAY: 0,   // 關閉 Google Pay
            SAMSUNGPAY: 0,  // 關閉 Samsung Pay
            LINEPAY: 0,     // 關閉 LINE Pay
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
app.post('/api/payment/return', async (req, res) => {
    try {
        const { TradeInfo } = req.body;
        // 解密交易內容
        const data = createMpgAesDecrypt(TradeInfo);
        
        console.log('Return Data:', data); // 建議保留 log 以便除錯

        const orderId = data.Result.MerchantOrderNo;
        
        // ★★★ 關鍵修改：判斷交易狀態 ★★★
        if (data.Status === 'SUCCESS') {
            // 成功：導向成功參數
            res.redirect(`${FRONTEND_URL}?payment=success&order_id=${orderId}`);
        } else {
            // 失敗：導向失敗參數，並將錯誤訊息 (Message) 編碼後帶回
            // data.Message 通常包含 "末三碼格式錯誤" 等具體原因
            const errorMsg = encodeURIComponent(data.Message || '交易失敗');
            res.redirect(`${FRONTEND_URL}?payment=fail&order_id=${orderId}&msg=${errorMsg}`);
        }
        
    } catch (err) {
        console.error('Return Error:', err);
        res.redirect(`${FRONTEND_URL}?payment=error`); // 發生程式錯誤
    }
});


// --- 啟動伺服器 ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('DB Error:', err));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});