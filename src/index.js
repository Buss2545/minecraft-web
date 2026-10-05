import { GameRoom } from "./room.js";

export { GameRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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