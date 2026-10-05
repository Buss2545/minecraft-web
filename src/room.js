import { DurableObject } from "cloudflare:workers";

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket endpoint", { status: 426 });
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get("player") || crypto.randomUUID();
    const name = url.searchParams.get("name") || "ผู้เล่น";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, name });

    const existing = this.ctx.getWebSockets();
    const players = existing.map((ws) => ws.deserializeAttachment()).filter(Boolean);

    server.send(JSON.stringify({
      type: "welcome",
      playerId,
      players,
    }));

    this.broadcast({
      type: "player:join",
      player: { playerId, name },
    }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const player = ws.deserializeAttachment() || {};

    if (data.type === "state") {
      this.broadcast({
        type: "player:state",
        player: {
          playerId: player.playerId,
          name: player.name || "ผู้เล่น",
          x: Number(data.x) || 0,
          y: Number(data.y) || 0,
          direction: data.direction || "down",
        },
      }, ws);
      return;
    }

    if (data.type === "chat") {
      this.broadcast({
        type: "chat",
        playerId: player.playerId,
        name: player.name || "ผู้เล่น",
        text: String(data.text || "").slice(0, 300),
      });
    }
  }

  webSocketClose(ws) {
    const player = ws.deserializeAttachment();
    if (player?.playerId) {
      this.broadcast({ type: "player:leave", playerId: player.playerId }, ws);
    }
  }

  webSocketError(ws) {
    const player = ws.deserializeAttachment();
    if (player?.playerId) {
      this.broadcast({ type: "player:leave", playerId: player.playerId }, ws);
    }
  }

  broadcast(data, except = null) {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {
        // Ignore sockets that are already closed.
      }
    }
  }
}
