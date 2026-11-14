import { GameRoom } from "./room.js";
import { AccountHub, authApi, whoami, getLocks } from "./auth.js";

export { GameRoom, AccountHub };

const UID_OK = /^[A-Za-z0-9_\-]{6,40}$/;
// ส่งต่อคำขอให้ห้อง/DO พร้อมตัวตนที่ "เซิร์ฟเวอร์ตรวจแล้ว" (ลบหัว x-auth-* ที่ผู้ใช้ส่งมาเองทิ้งก่อนเสมอ กันปลอมสิทธิ์)
function withAuth(request, user, dropUid) {
  try {
    let spoof = false;
    for (const k of request.headers.keys()) if (k.toLowerCase().startsWith("x-auth-")) { spoof = true; break; }
    const url = new URL(request.url);
    const hasUid = dropUid && url.searchParams.has("uid");
    if (!user && !spoof && !hasUid) return request; // แขกทั่วไป: ส่งคำขอเดิมตรงๆ (ไม่แตะ WebSocket upgrade)
    if (hasUid) url.searchParams.delete("uid"); // uid นี้เป็นของบัญชีอื่น: ไม่ใช่ตัวตนของคนที่ไม่ได้ล็อกอิน
    const headers = new Headers(request.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-auth-")) headers.delete(k);
    if (user) {
      headers.set("x-auth-uid", user.uid);
      headers.set("x-auth-name", user.username);
      headers.set("x-auth-role", user.role === "admin" ? "admin" : "user");
    }
    return new Request(url.toString(), { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual", duplex: "half" });
  } catch {
    return request;
  }
}

// หน้าเกมที่แอดมินล็อกได้ (farm = บ้านสวนสุขใจ รวมออนไลน์/แยกจอ • life = ลิขิตชีวิต)
const GAME_PAGES = { "/game-core/baan-suan-sukjai-core": "farm", "/game-core/split": "farm", "/game-core/likhit-chiwit": "life" };
const esc = (t) => String(t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function lockedPage(name, msg) {
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)} ปิดชั่วคราว</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#22305a;color:#fff;font:18px/1.6 system-ui,sans-serif;text-align:center;padding:24px}main{max-width:420px}h1{margin:0 0 8px;font-size:1.6rem}p{margin:0 0 18px;opacity:.9}a{display:inline-block;padding:12px 22px;border-radius:12px;background:#e8a317;color:#22305a;font-weight:700;text-decoration:none}</style></head><body><main><h1>🔒 ${esc(name)} ปิดอยู่ชั่วคราว</h1><p>${esc(msg) || "แอดมินล็อกเกมนี้ไว้ก่อน ยังเข้าเล่นไม่ได้ในตอนนี้"}</p><a href="/">กลับหน้าแรก</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "600" } });
}
const GAME_NAME = { farm: "บ้านสวนสุขใจ", life: "ลิขิตชีวิต" };

const ROOM_COUNT = 5; // จำนวนห้องที่เปิดให้เล่น
const ROOM_MAX = 6;
const TUBE_ROOM = "_tube"; // ห้องกลางสำหรับวิดีโอทั่วโลก (mode=tube)
const ROOM_IDS = new Set(Array.from({ length: ROOM_COUNT }, (_, i) => `room-${i + 1}`)); // คนสูงสุดต่อห้อง (แสดงผลก่อน ยังไม่บังคับใช้)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) return authApi(request, env);

    const gp = GAME_PAGES[url.pathname.replace(/\.html$/, "").replace(/\/+$/, "")];
    if (gp && (request.method === "GET" || request.method === "HEAD")) {
      const L = (await getLocks(env))[gp];
      if (L && L.on) {
        const { user } = await whoami(env, request, "");
        if (!user || user.role !== "admin") return lockedPage(GAME_NAME[gp], L.msg);
      }
    } // สมัคร/ล็อกอิน/ออก/กู้รหัส/เปลี่ยนรหัส

    if (url.pathname === "/api/notice" || url.pathname === "/api/admin") {
      const { user } = await whoami(env, request, "");
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName("__admin__"));
      return stub.fetch(withAuth(request, user, false));
    }

    if (url.pathname.startsWith("/api/likhit/") && request.method !== "GET") {
      const LL = (await getLocks(env)).life;
      if (LL && LL.on) {
        const { user: au } = await whoami(env, request, "");
        if (!au || au.role !== "admin") return Response.json({ ok: false, err: "locked", msg: LL.msg }, { status: 503 });
      }
    }
    if (url.pathname.startsWith("/api/likhit/")) { // ลิขิตชีวิต: ออนไลน์ + สถิติรวม
      const { user } = await whoami(env, request, "");
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName("__likhit__"));
      return stub.fetch(withAuth(request, user, false));
    }

    if (url.pathname === "/api/rooms") {
      const rooms = await Promise.all(
        Array.from({ length: ROOM_COUNT }, async (_, i) => {
          const id = `room-${i + 1}`;
          try {
            const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(id));
            const r = await stub.fetch(new Request(`${url.origin}/ws/${id}/status`));
            const j = await r.json();
            return { id, online: (j.seats ?? j.online) | 0, host: !!j.host, hostName: String(j.hostName || "").slice(0, 16) };
          } catch {
            return { id, online: 0, host: false, hostName: "" };
          }
        })
      );
      return Response.json({ rooms, max: ROOM_MAX }, { headers: { "Cache-Control": "no-store" } });
    }

    if (url.pathname.startsWith("/ws/")) {
      const roomId = decodeURIComponent(url.pathname.slice(4)).trim();
      if (!roomId) return new Response("Room ID required", { status: 400 });
      if (!ROOM_IDS.has(roomId) && roomId !== TUBE_ROOM) return new Response("Unknown room", { status: 404 }); // _tube = ห้องกลางของยูแสนสุข (วิดีโอทั่วโลก) ต้องเปิดผ่านเสมอ

      const uidParam = url.searchParams.get("uid") || "";
      const FL = (await getLocks(env)).farm;
      if (FL && FL.on) {
        const { user: au } = await whoami(env, request, "");
        if (!au || au.role !== "admin") return new Response("locked", { status: 503 });
      }
      const guestPane = url.searchParams.get("g") === "1"; // จอที่ 2 ของโหมดแยกจอ: เป็นแขกเสมอ (กันเตะตัวตนบัญชีของจอที่ 1)
      const { user, bound } = guestPane ? { user: null, bound: false } : await whoami(env, request, UID_OK.test(uidParam) ? uidParam : "");
      // ล็อกอินแล้ว = ใช้ uid ของบัญชีเสมอ • ไม่ได้ล็อกอินแต่อ้าง uid ที่บัญชีจองไว้ = ตัด uid ทิ้ง (เล่นเป็นแขก)
      const id = env.GAME_ROOMS.idFromName(roomId);
      const room = env.GAME_ROOMS.get(id);
      return room.fetch(withAuth(request, user, !user && bound));
    }

    return env.ASSETS.fetch(request);
  },
};