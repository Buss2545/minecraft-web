require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
// ใช้ Port จาก Environment Variable ของ Render ถ้าไม่มีให้ใช้ 3000
const PORT = process.env.PORT || 3000;

// กำหนด URL ของหน้าเว็บ (Frontend) ที่อนุญาตให้เชื่อมต่อ API ได้
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://minecraft-web-hjrm.onrender.com';

// 1. ตั้งค่า CORS (อนุญาตให้ Frontend ดึงข้อมูลได้)
app.use(cors({
    origin: FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true // อนุญาตให้ส่ง Cookie/Token (ถ้ามี)
}));

// 2. ตั้งค่าให้อ่านข้อมูลที่ส่งมาเป็น JSON ได้
app.use(express.json());

// ==========================================
// ส่วนของการตั้งค่า API Routes (เส้นทางของเว็บ)
// ==========================================

// Route พื้นฐาน สำหรับเช็คว่า Server ทำงานอยู่ไหม
app.get('/', (req, res) => {
    res.json({ message: 'Mari JP SMP Backend is running!' });
});

// ตัวอย่าง Route สำหรับ Login (ตรงกับที่แนะนำไปใน index.html)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // TODO: ตรงนี้คุณต้องไปเชื่อมต่อกับ Database จริงๆ (เช่น MySQL, MongoDB)
    // อันนี้เป็นเพียงข้อมูลจำลองสำหรับทดสอบ
    if (username === 'user' && password === 'password') {
        return res.json({ 
            success: true, 
            message: 'เข้าสู่ระบบสำเร็จ!',
            user: { username: username }
        });
    }

    // กรณีรหัสผิด
    return res.status(401).json({ 
        success: false, 
        message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง!' 
    });
});

// ==========================================
// สั่งให้ Server เริ่มทำงาน
// ==========================================
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
    console.log(`✅ CORS is allowed for: ${FRONTEND_URL}`);
});
