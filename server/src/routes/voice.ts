import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.ts";

// STUN хватает в одной сети и за «простыми» NAT; для остальных нужен свой TURN (coturn).
// TURN_URL=turn:example.ru:3478 и либо TURN_SECRET (coturn use-auth-secret, временные логины),
// либо постоянные TURN_USER / TURN_PASS.
function iceServers(userId: string) {
  const servers: RTCIceServerLike[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  ];
  const urls = process.env.TURN_URL?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!urls?.length) return servers;
  if (process.env.TURN_SECRET) {
    // TURN REST API: логин живёт сутки, пароль — HMAC-SHA1 от логина.
    const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:${userId}`;
    const credential = createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64");
    servers.push({ urls, username, credential });
  } else {
    servers.push({ urls, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  }
  return servers;
}

interface RTCIceServerLike {
  urls: string[];
  username?: string;
  credential?: string;
}

export default async function voiceRoutes(app: FastifyInstance) {
  app.get("/api/voice/config", { preHandler: requireAuth }, async (req) => ({
    iceServers: iceServers(req.userId),
  }));
}
