import { GameRoom } from "./room.js";

export { GameRoom };

const ROOM_COUNT = 5; // จำนวนห้องที่เปิดให้เล่น
const ROOM_MAX = 6; // คนสูงสุดต่อห้อง (แสดงผลก่อน ยังไม่บังคับใช้)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms") {
      const rooms = await Promise.all(
        Array.from({ length: ROOM_COUNT }, async (_, i) => {
          const id = `room-${i + 1}`;
          try {
            const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(id));
            const r = await stub.fetch(new Request(`${url.origin}/ws/${id}/status`));
            const j = await r.json();
            return { id, online: j.online | 0 };
          } catch {
            return { id, online: 0 };
          }
        })
      );
      return Response.json({ rooms, max: ROOM_MAX }, { headers: { "Cache-Control": "no-store" } });
    }

    if (url.pathname.startsWith("/ws/")) {
      const roomId = decodeURIComponent(url.pathname.slice(4)).trim();
      if (!roomId) return new Response("Room ID required", { status: 400 });

      const id = env.GAME_ROOMS.idFromName(roomId);
      const room = env.GAME_ROOMS.get(id);
      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};