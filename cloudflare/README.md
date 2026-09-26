# Mari JP SMP — Cloudflare version

โฟลเดอร์นี้เป็นเวอร์ชันแยกสำหรับ Cloudflare โดยไม่แก้ระบบเดิมที่รันด้วย Node/Express + MongoDB

## โครงสร้าง

- `cloudflare/src/worker.js` — Cloudflare Worker สำหรับเสิร์ฟเว็บและ proxy `/api/*`
- `cloudflare/wrangler.toml` — ค่า deploy สำหรับ Cloudflare Workers + Static Assets

## แนวคิด

ระบบเดิมยังอยู่เหมือนเดิม (`server.js` + `public/`) และใช้เป็น backend หลักต่อไปได้

Cloudflare Worker ตัวใหม่จะ:

1. เสิร์ฟไฟล์ใน `public/` ผ่าน Cloudflare edge
2. ส่ง `/api/*` ไปยัง backend เดิมผ่าน `BACKEND_URL`
3. ไม่เก็บ MongoDB credentials หรือ TikTok/RCON/Pterodactyl secrets ใน frontend
4. ถ้าไม่ได้ตั้ง `BACKEND_URL` จะตอบ JSON 503 สำหรับ API แทนการทำให้เว็บล่มทั้งหน้า

## Deploy

ตั้งค่า `BACKEND_URL` เป็น URL ของ backend เดิม เช่น `https://your-backend.example.com`
แล้ว deploy ด้วย Wrangler

> ห้ามใส่ `MONGODB_URI`, `ADMIN_KEY`, `RCON_PASSWORD` หรือ secret อื่นลงในไฟล์ที่ถูกเสิร์ฟให้ browser
