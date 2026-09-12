require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://minecraft-web-hjrm.onrender.com';

// ตั้งค่า CORS (อนุญาตให้หน้าเว็บของคุณเชื่อมต่อได้)
app.use(cors({
    origin: FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

app.use(express.json());

// เช็คสถานะเซิร์ฟเวอร์
app.get('/', (req, res) => {
    res.json({ message: 'Mari JP SMP Backend is running!' });
});

// ระบบ Login (ตัวอย่าง)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // ตัวอย่างการเช็ครหัสผ่าน (ของจริงต้องเช็คจาก Database)
    if (username === 'user' && password === 'password') {
        return res.json({ 
            success: true, 
            message: 'เข้าสู่ระบบสำเร็จ!',
            user: { 
                id: 'MEMBER-001', // <--- นี่คือ ไอดี ที่จะส่งกลับไปให้หน้าเว็บ
                username: username 
            }
        });
    }

    return res.status(401).json({ 
        success: false, 
        message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง!' 
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
