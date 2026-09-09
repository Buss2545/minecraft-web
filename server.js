const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, ROOT = __dirname, DB = path.join(ROOT, 'data.json');
let db = { users: [], orders: [] }; try { db = JSON.parse(fs.readFileSync(DB, 'utf8')) } catch { }
const sessions = new Map();

function save() { fs.writeFileSync(DB, JSON.stringify(db, null, 2)) }
function hash(p, s = crypto.randomBytes(16).toString('hex')) { return { salt: s, hash: crypto.scryptSync(p, s, 64).toString('hex') } }
function verify(p, u) { return crypto.timingSafeEqual(Buffer.from(hash(p, u.salt).hash, 'hex'), Buffer.from(u.passwordHash, 'hex')) }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
function body(req) { return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) req.destroy() }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { reject() } }) }) }
function user(req) { const c = req.headers.cookie || '', m = c.match(/sid=([^;]+)/); return m ? sessions.get(m[1]) : null }
function clean(u) { return u ? { username: u.username, minecraft: u.minecraft || '', createdAt: u.createdAt } : null }
function session(res, u) { const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, u); res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`) }
function esc(s) { return String(s).replace(/[<>]/g, '') }
async function status() { return await new Promise(resolve => { const host = 'api.mcsrvstat.us', p = '/3/' + encodeURIComponent('marijp2006.svmine.com:11206'); const r = http.get({ host, path: p, headers: { 'User-Agent': 'MariJPSMP/1.0' } }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => { try { const d = JSON.parse(s); resolve({ online: !!d.online, players: d.players || {}, version: d.version || '-', motd: d.motd?.clean?.join(' ') || '' }) } catch { resolve({ online: false }) } }) }); r.on('error', () => resolve({ online: false })); r.setTimeout(5000, () => { r.destroy(); resolve({ online: false }) }) }) }

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Credentials': 'true' }); return res.end() }
        if (req.url === '/api/register' && req.method === 'POST') { const b = await body(req), name = esc(b.username || '').trim(), pass = String(b.password || ''); if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) return json(res, 400, { error: 'Username ต้องเป็น A-Z, 0-9 หรือ _ และยาว 3-24 ตัว' }); if (pass.length < 6) return json(res, 400, { error: 'Password ต้องมีอย่างน้อย 6 ตัว' }); if (db.users.some(x => x.username.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'Username นี้ถูกใช้แล้ว' }); const h = hash(pass); const u = { username: name, salt: h.salt, passwordHash: h.hash, minecraft: '', createdAt: new Date().toISOString() }; db.users.push(u); save(); session(res, u); return json(res, 201, { user: clean(u) }) }
        if (req.url === '/api/login' && req.method === 'POST') { const b = await body(req), u = db.users.find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase()); if (!u || !verify(String(b.password || ''), u)) return json(res, 401, { error: 'Username หรือ Password ไม่ถูกต้อง' }); session(res, u); return json(res, 200, { user: clean(u) }) }
        if (req.url === '/api/logout' && req.method === 'POST') { const c = req.headers.cookie || '', m = c.match(/sid=([^;]+)/); if (m) sessions.delete(m[1]); res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true }) }
        if (req.url === '/api/me') { const u = user(req); return json(res, 200, { user: clean(u) }) }
        if (req.url === '/api/status') { return json(res, 200, await status()) }
        if (req.url === '/api/orders' && req.method === 'GET') { const u = user(req); if (!u) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' }); return json(res, 200, { orders: db.orders.filter(x => x.username === u.username).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }) }
        if (req.url === '/api/orders' && req.method === 'POST') { const u = user(req); if (!u) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' }); const b = await body(req), products = { VIP: 50, 'VIP+': 100, MVP: 150, 'MVP+': 200, LEGEND: 500, EMPEROR: 1000 }; const product = String(b.product || ''); const price = Number(b.price); const mc = esc(b.minecraft || '').trim(); if (products[product] !== price) return json(res, 400, { error: 'สินค้าไม่ถูกต้อง' }); if (!/^[A-Za-z0-9_]{3,16}$/.test(mc)) return json(res, 400, { error: 'ชื่อ Minecraft ไม่ถูกต้อง' }); const o = { id: 'MARI-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(), username: u.username, minecraft: mc, product, price, status: 'PENDING', createdAt: new Date().toISOString() }; db.orders.push(o); u.minecraft = mc; save(); return json(res, 201, { order: o }) }
        if (req.url.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

        let file = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
        if (file.includes('..')) return json(res, 400, { error: 'bad path' });
        
        let fp = path.join(ROOT, file);
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(ROOT, 'index.html'); // แก้ไขตรงนี้

        const ext = path.extname(fp), types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        fs.createReadStream(fp).pipe(res)
    } catch (e) { json(res, 500, { error: 'Server error' }) }
});

server.listen(PORT, () => console.log(`Mari JP SMP website: http://localhost:${PORT}`));
