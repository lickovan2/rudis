import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.ts";

// STUN хватает в одной сети и за «простыми» NAT; для остальных нужен свой TURN (coturn):
// TURN_URL=turn:example.ru:3478 TURN_USER=... TURN_PASS=...
function iceServers() {
  const servers: RTCIceServerLike[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  ];
  if (process.env.TURN_URL)
    servers.push({
      urls: process.env.TURN_URL.split(","),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS,
    });
  return servers;
}

interface RTCIceServerLike {
  urls: string[];
  username?: string;
  credential?: string;
}

export default async function voiceRoutes(app: FastifyInstance) {
  app.get("/api/voice/config", { preHandler: requireAuth }, async () => ({
    iceServers: iceServers(),
  }));
}
