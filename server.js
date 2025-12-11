const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 中介軟體設定 ---
app.use(cors()); // 允許跨域請求 (讓前台可以連到後端)
app.use(express.json()); // 允許解析 JSON 格式的請求

// --- 資料庫連線 (請換成您自己的 MongoDB 連線字串) ---
// 註：這是一個測試用的連線字串，正式上線請申請自己的 MongoDB Atlas 帳號
const MONGO_URI = 'mongodb+srv://kechunlin50_db_user:1oTBMgKskurDQxSL@lele-server.l67p3cy.mongodb.net/?appName=lele-server';
// 若您尚未申請，這行程式碼可能會連線失敗。稍後會說明如何申請。
// 為了教學方便，我們先假設連線成功，或者您可以先略過資料庫，改用記憶體變數測試。

// 這裡我們先定義 Schema，稍後連接真實資料庫
const orderSchema = new mongoose.Schema({
    id: String,
    date: String,
    customer: {
        name: String,
        phone: String,
        address: String,
        email: String // ★ 新增 Email
    },
    items: Array,
    total: String,
    remarks: String, // ★ 新增 備註
    status: {
        paid: { type: Boolean, default: false },
        produced: { type: Boolean, default: false },
        shipped: { type: Boolean, default: false }
    },
    trackingNumber: { type: String, default: "" }
});

const Order = mongoose.model('Order', orderSchema);

// --- API 路由 ---

// 1. 獲取所有訂單 (供後台使用)
app.get('/api/orders', async (req, res) => {
    try {
        // 從資料庫撈取所有訂單，並依時間倒序排列
        const orders = await Order.find().sort({ _id: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 2. 新增訂單 (供前台使用)
app.post('/api/orders', async (req, res) => {
    const newOrder = new Order(req.body);
    try {
        const savedOrder = await newOrder.save();
        res.status(201).json(savedOrder);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 3. 更新訂單 (供後台修改狀態或資料)
app.put('/api/orders/:id', async (req, res) => {
    try {
        // 根據自訂的 id (如 ORD-123456) 來更新
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

// --- 啟動伺服器 ---
// 在連線資料庫前，我們暫時註解掉連線檢查，直接啟動
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('DB Error:', err));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});