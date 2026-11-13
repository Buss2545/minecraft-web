import { GameRoom } from "./room.js";
import { AccountHub, authApi, whoami } from "./auth.js";

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

const ROOM_COUNT = 5; // จำนวนห้องที่เปิดให้เล่น
const ROOM_MAX = 6;
const TUBE_ROOM = "_tube"; // ห้องกลางสำหรับวิดีโอทั่วโลก (mode=tube)
const ROOM_IDS = new Set(Array.from({ length: ROOM_COUNT }, (_, i) => `room-${i + 1}`)); // คนสูงสุดต่อห้อง (แสดงผลก่อน ยังไม่บังคับใช้)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) return authApi(request, env); // สมัคร/ล็อกอิน/ออก/กู้รหัส/เปลี่ยนรหัส

    if (url.pathname === "/api/notice" || url.pathname === "/api/admin") {
      const { user } = await whoami(env, request, "");
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName("__admin__"));
      return stub.fetch(withAuth(request, user, false));
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