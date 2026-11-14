import { GameRoom } from "./room.js";
import { AccountHub, authApi, whoami, getLocks, profileOf, guestLeft, gidOf } from "./auth.js";

export { GameRoom, AccountHub };

const UID_OK = /^[A-Za-z0-9_\-]{6,40}$/;
// ส่งต่อคำขอให้ห้อง/DO พร้อมตัวตนที่ "เซิร์ฟเวอร์ตรวจแล้ว" (ลบหัว x-auth-* ที่ผู้ใช้ส่งมาเองทิ้งก่อนเสมอ กันปลอมสิทธิ์)
function withAuth(request, user, dropUid, prof) {
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
      if (user.mu) headers.set("x-auth-mute", String(user.mu));
      if (prof) {
        headers.set("x-auth-nick", encodeURIComponent(prof.nick || ""));
        headers.set("x-auth-emoji", encodeURIComponent(prof.emoji || ""));
        headers.set("x-auth-color", prof.color || "");
        headers.set("x-auth-pic", prof.pic ? "1" : "");
      }
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
function guestEndPage(name) {
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>หมดเวลาทดลองเล่น</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1c2340;color:#f4ead0;font:17px/1.7 Pridi,Tahoma,sans-serif;text-align:center;padding:24px}main{max-width:420px}h1{font-size:26px;margin:0 0 10px}a{display:inline-block;margin-top:14px;background:#e8b84a;color:#2b1d12;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700}</style></head><body><main><h1>หมดเวลาทดลองเล่น ${esc(name)}</h1><p>ผู้ที่ยังไม่มีบัญชีเล่นได้ชั่วคราวเท่านั้น สมัครสมาชิกฟรีเพื่อเล่นต่อ และเก็บเซฟไว้ออนไลน์ได้ด้วย (เซฟในเครื่องนี้ไม่หาย)</p><a href="/">ไปสมัครสมาชิก</a></main></body></html>`;
  return new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
const GAME_NAME = { farm: "บ้านสวนสุขใจ", life: "ลิขิตชีวิต" };

const ROOM_COUNT = 5; // จำนวนห้องที่เปิดให้เล่น
const ROOM_MAX = 6;
const TUBE_ROOM = "_tube"; // ห้องกลางสำหรับวิดีโอทั่วโลก (mode=tube)
const ROOM_IDS = new Set(Array.from({ length: ROOM_COUNT }, (_, i) => `room-${i + 1}`)); // คนสูงสุดต่อห้อง (แสดงผลก่อน ยังไม่บังคับใช้)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/avatar/")) { // รูปโปรไฟล์สาธารณะของ uid (uid เป็นข้อมูลที่คนในห้องเห็นกันอยู่แล้ว)
      const pf = await profileOf(env, decodeURIComponent(url.pathname.slice(12)));
      const m = pf && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(pf.pic || "");
      if (!m) return new Response("no avatar", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
      const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }
    if (url.pathname === "/api/auth/admin-lock" && request.method === "POST") { // ล็อกบ้านสวนสุขใจ = เตะผู้เล่นที่ไม่ใช่แอดมินออกจากทุกห้องทันที
      const body = await request.clone().json().catch(() => ({}));
      const res = await authApi(request, env);
      if (res.ok && body && body.game === "farm" && body.on) {
        await Promise.all([...ROOM_IDS, TUBE_ROOM].map(async (rid) => {
          try { await env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(rid)).fetch(new Request(`${url.origin}/__kick`, { method: "POST" })); } catch {}
        }));
      }
      return res;
    }
    if (url.pathname === "/api/auth/admin-mute" && request.method === "POST") { // ปิดเสียง: บันทึกที่ AccountHub แล้วส่งต่อให้ห้องออนไลน์ที่เปิดอยู่
      const body = await request.clone().json().catch(() => ({}));
      const res = await authApi(request, env);
      if (res.ok) {
        const j = await res.clone().json().catch(() => ({}));
        const targets = j.uid ? [...ROOM_IDS, TUBE_ROOM] : ROOM_IDS.has(String(body.room || "")) ? [String(body.room)] : [];
        await Promise.all(targets.map(async (rid) => {
          try { await env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(rid)).fetch(new Request(`${url.origin}/__mute`, { method: "POST", body: JSON.stringify({ uid: j.uid || "", pid: j.pid || "", until: j.until || 0 }) })); } catch {}
        }));
      }
      return res;
    }
    if (url.pathname.startsWith("/api/auth/")) return authApi(request, env);

    const gp = GAME_PAGES[url.pathname.replace(/\.html$/, "").replace(/\/+$/, "")];
    if (gp && (request.method === "GET" || request.method === "HEAD")) {
      const L = (await getLocks(env))[gp];
      if (L && L.on) {
        const { user } = await whoami(env, request, "");
        if (!user || user.role !== "admin") return lockedPage(GAME_NAME[gp], L.msg);
      }
    }
    if (gp && (request.method === "GET" || request.method === "HEAD")) { // หมดเวลาทดลองเล่นของผู้ที่ไม่ล็อกอิน → ต้องสมัครก่อน
      const { user } = await whoami(env, request, "");
      if (!user && (await guestLeft(env, gidOf(request))) <= 0) return guestEndPage(GAME_NAME[gp]);
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
      const member = user || (guestPane ? (await whoami(env, request, "")).user : null);
      if (!member && (await guestLeft(env, gidOf(request))) <= 0) return new Response("guest-limit", { status: 403 });
      // ล็อกอินแล้ว = ใช้ uid ของบัญชีเสมอ • ไม่ได้ล็อกอินแต่อ้าง uid ที่บัญชีจองไว้ = ตัด uid ทิ้ง (เล่นเป็นแขก)
      const id = env.GAME_ROOMS.idFromName(roomId);
      const room = env.GAME_ROOMS.get(id);
      const prof = user ? await profileOf(env, user.uid) : null;
      return room.fetch(withAuth(request, user, !user && bound, prof));
    }

    return env.ASSETS.fetch(request);
  },
};