import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mediaUserId, requireAuth } from "../auth.ts";
import { config } from "../config.ts";
import { one, run } from "../db.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { rateLimit } from "../rate-limit.ts";

export const uploadsDir = path.join(config.dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
const maxUserStorage = 500 * 1024 * 1024;
const pendingBytes = new Map<string, number>();
let pendingTotalBytes = 0;

export function assertOwnedUpload(userId: string, url: string | null) {
  if (url && !one("SELECT 1 FROM uploads WHERE url = ? AND uploader_id = ?", url, userId))
    throw forbidden("Можно использовать только свои загруженные файлы");
}

export async function authorizeUpload(req: FastifyRequest, reply: FastifyReply) {
  const pathname = req.url.split("?")[0];
  if (!pathname.startsWith("/uploads/")) return;
  reply.header("Cache-Control", "private, no-store");
  reply.header("Vary", "Cookie");
  if (!/^\/uploads\/[\w.-]+$/.test(pathname)) throw notFound();
  const userId = mediaUserId(req);
  if (!userId) throw notFound();
  if (one("SELECT 1 FROM uploads WHERE url = ? AND uploader_id = ?", pathname, userId)) return;
  if (one("SELECT 1 FROM users WHERE avatar = ?", pathname)) return;
  if (one("SELECT 1 FROM servers WHERE icon = ?", pathname)) return;
  if (one(`SELECT 1 FROM message_uploads mu
    JOIN messages m ON m.id = mu.message_id
    JOIN channels c ON c.id = m.channel_id
    WHERE mu.url = ? AND (
      (c.type = 'dm' AND EXISTS (SELECT 1 FROM dm_participants p WHERE p.channel_id = c.id AND p.user_id = ?))
      OR (c.server_id IS NOT NULL AND EXISTS (SELECT 1 FROM members mb WHERE mb.server_id = c.server_id AND mb.user_id = ?))
    ) LIMIT 1`, pathname, userId, userId)) return;
  throw notFound();
}

export default async function uploadRoutes(app: FastifyInstance) {
  app.post("/api/upload", { preHandler: requireAuth }, async (req) => {
    rateLimit(`upload:${req.userId}`, 20, 60_000);
    const used = one<{ bytes: number }>("SELECT COALESCE(SUM(size), 0) bytes FROM uploads WHERE uploader_id = ?", req.userId)!.bytes;
    const pending = pendingBytes.get(req.userId) ?? 0;
    if (used + pending + config.maxUploadBytes > maxUserStorage)
      throw badRequest("Лимит хранения файлов исчерпан (500 МБ)");
    const total = one<{ bytes: number }>("SELECT COALESCE(SUM(size), 0) bytes FROM uploads")!.bytes;
    if (total + pendingTotalBytes + config.maxUploadBytes > config.maxTotalUploadBytes)
      throw badRequest("Общий лимит хранения файлов исчерпан");
    const file = await req.file();
    if (!file) throw badRequest("Файл не передан");
    pendingBytes.set(req.userId, pending + config.maxUploadBytes);
    pendingTotalBytes += config.maxUploadBytes;
    const ext = path.extname(file.filename).toLowerCase().replace(/[^.\w]/g, "").slice(0, 10);
    const name = newId() + ext;
    const dest = path.join(uploadsDir, name);
    try {
      await pipeline(file.file, fs.createWriteStream(dest));
      if (file.file.truncated) throw badRequest(`Файл больше ${config.maxUploadBytes / 1024 / 1024} МБ`);
      const size = fs.statSync(dest).size;
      run("INSERT INTO uploads (url, uploader_id, size, created_at) VALUES (?, ?, ?, ?)", `/uploads/${name}`, req.userId, size, Date.now());
      return {
        url: `/uploads/${name}`,
        name: file.filename.slice(0, 255),
        size,
        mime: file.mimetype || "application/octet-stream",
      };
    } catch (error) {
      fs.rmSync(dest, { force: true });
      throw error;
    } finally {
      pendingTotalBytes -= config.maxUploadBytes;
      const remaining = (pendingBytes.get(req.userId) ?? 0) - config.maxUploadBytes;
      if (remaining > 0) pendingBytes.set(req.userId, remaining);
      else pendingBytes.delete(req.userId);
    }
  });
}
