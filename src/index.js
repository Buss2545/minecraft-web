import { GameRoom } from "./room.js";

export { GameRoom };

const ADMIN_ID = "buss2545";
const ADMIN_PASSWORD_SHA256 = "f01c09ef0bd0e30074c29fc531c87056b5dc6ee806c1ffa52547f80f66d4c5f8";
const SESSION_TTL = 24 * 60 * 60 * 1000;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(text) {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function unb64url(text) {
  const s = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return decodeURIComponent(escape(atob(s)));
}

async function makeToken(role, userId, roomId) {
  const payload = b64url(JSON.stringify({
    role, userId, roomId: roomId || "", exp: Date.now() + SESSION_TTL,
  }));
  const sig = await sha256(ADMIN_PASSWORD_SHA256 + "." + payload);
  return payload + "." + sig;
}

async function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let data;
  try { data = JSON.parse(unb64url(payload)); } catch { return null; }
  if (!data?.role || !data?.userId || !data?.exp || Date.now() > data.exp) return null;
  const expected = await sha256(ADMIN_PASSWORD_SHA256 + "." + payload);
  if (sig !== expected) return null;
  return data;
}

function cookieToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\\s*)bsj_auth=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function validId(v) {
  return /^[A-Za-z0-9_-]{3,32}$/.test(String(v || "").trim());
}
function validRoom(v) {
  return /^[A-Za-z0-9_-]{2,32}$/.test(String(v || "").trim());
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await readJson(request);
      const id = String(body.id || "").trim();
      const room = String(body.room || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (id.toLowerCase() === ADMIN_ID) {
        if (await sha256(password) !== ADMIN_PASSWORD_SHA256) {
          return json({ ok: false, error: "รหัส Admin ไม่ถูกต้อง" }, 401);
        }
        const token = await makeToken("admin", ADMIN_ID, "");
        return json({ ok: true, role: "admin", userId: ADMIN_ID }, 200, {
          "Set-Cookie": `bsj_auth=${encodeURIComponent(token)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
        });
      }

      if (!validId(id)) return json({ ok: false, error: "ID ผู้ใช้ต้องมี 3-32 ตัวอักษร" }, 400);
      if (!validRoom(room)) return json({ ok: false, error: "รหัสห้องไม่ถูกต้อง" }, 400);

      const token = await makeToken("user", id, room);
      return json({ ok: true, role: "user", userId: id, room }, 200, {
        "Set-Cookie": `bsj_auth=${encodeURIComponent(token)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
      });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return json({ ok: true }, 200, {
        "Set-Cookie": "bsj_auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      });
    }

    const token = cookieToken(request);
    const auth = await verifyToken(token);

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return auth
        ? json({ ok: true, role: auth.role, userId: auth.userId, room: auth.roomId || "" })
        : json({ ok: false }, 401);
    }

    if (url.pathname.startsWith("/api/admin/") && request.method === "POST") {
      if (!auth || auth.role !== "admin") return json({ ok: false, error: "ต้องเป็น Admin" }, 403);

      const body = await readJson(request);
      const roomId = String(body.room || "").trim().toLowerCase();
      if (!validRoom(roomId)) return json({ ok: false, error: "รหัสห้องไม่ถูกต้อง" }, 400);

      const id = env.GAME_ROOMS.idFromName(roomId);
      const room = env.GAME_ROOMS.get(id);
      const internal = new Request(new URL("/admin", request.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BSJ-Admin-Verified": "1",
          "X-BSJ-Admin-Id": ADMIN_ID,
        },
        body: JSON.stringify(body),
      });
      return room.fetch(internal);
    }

    if (url.pathname.startsWith("/ws/")) {
      if (!auth) return new Response("Login required", { status: 401 });
      const roomId = decodeURIComponent(url.pathname.slice(4)).trim().toLowerCase();
      if (!roomId) return new Response("Room ID required", { status: 400 });

      if (auth.role === "user" && auth.roomId !== roomId) {
        return new Response("Room does not match login", { status: 403 });
      }

      const id = env.GAME_ROOMS.idFromName(roomId);
      const room = env.GAME_ROOMS.get(id);
      const nextUrl = new URL(request.url);
      nextUrl.searchParams.set("user", auth.userId);
      nextUrl.searchParams.set("role", auth.role);
      const forwarded = new Request(nextUrl, request);
      forwarded.headers.set("X-BSJ-Auth-Verified", "1");
      return room.fetch(forwarded);
    }

    return env.ASSETS.fetch(request);
  },
};
