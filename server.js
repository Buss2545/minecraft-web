/*
=====================================================
.env.example
(ให้ก็อปปี้เนื้อหาส่วนนี้ไปสร้างเป็นไฟล์ชื่อ .env ในเครื่องของคุณ)
=====================================================
PORT=3000
MINECRAFT_SERVER_IP=127.0.0.1
MINECRAFT_RCON_PORT=25575
MINECRAFT_RCON_PASSWORD=your_rcon_password
WEB_TITLE=Minecraft Web Store
DB_HOST=localhost
DB_USER=root
DB_PASS=
DB_NAME=minecraft_web
=====================================================
*/

const express = require('express');
const path = require('path');
const fs = require('fs');

// Load environment variables if dotenv is installed
try {
    require('dotenv').config();
} catch (e) {
    console.log("dotenv package not found, using default environment variables.");
}

const app = express();
// ตั้งค่า Port โดยดึงจากไฟล์ .env ถ้าไม่มีให้ใช้ 3000
const PORT = process.env.PORT || 3000;
// กำหนดที่อยู่ของไฟล์ data.json
const DATA_FILE = path.join(__dirname, 'data.json');

// อนุญาตให้รับส่งข้อมูลแบบ JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ตั้งค่าให้เสิร์ฟไฟล์ Static (เช่น HTML, CSS, JS, รูปภาพ) จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// API สำหรับดึงข้อมูลจาก data.json
app.get('/api/data', (req, res) => {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({ message: "Data file not found, initializing empty data.", data: {} });
        }
    } catch (error) {
        console.error("Error reading data:", error);
        res.status(500).json({ error: "Error reading data file" });
    }
});

// API สำหรับอัปเดตข้อมูลลง data.json (เช่น เซฟการตั้งค่าหรือระบบ Topup)
app.post('/api/data', (req, res) => {
    try {
        const newData = req.body;
        // เขียนไฟล์ทับของเดิม พร้อมจัดรูปแบบให้สวยงาม (indent 2 spaces)
        fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2), 'utf8');
        res.json({ success: true, message: "Data saved successfully" });
    } catch (error) {
        console.error("Error writing data:", error);
        res.status(500).json({ error: "Error writing data file" });
    }
});

// ตั้งค่า Route สำหรับหน้าต่างๆ ในโฟลเดอร์ public เพื่อให้เข้าถึงแบบไม่มีนามสกุล .html ได้
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/topup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'topup.html'));
});

// การจัดการ Error 404 - หากหาหน้าไม่เจอให้เด้งกลับไปหน้าหลัก
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`Minecraft Web Server is successfully running!`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`=========================================`);
    console.log(`[Checklist] Please ensure you have:`);
    console.log(` 1. A 'public' folder with your HTML files.`);
    console.log(` 2. A 'data.json' file in the root folder.`);
    console.log(` 3. A '.env' file with your variables.`);
});