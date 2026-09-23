import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.ts";
import { config } from "../config.ts";
import { badRequest } from "../errors.ts";
import { newId } from "../ids.ts";

export const uploadsDir = path.join(config.dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

export default async function uploadRoutes(app: FastifyInstance) {
  app.post("/api/upload", { preHandler: requireAuth }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest("Файл не передан");
    const ext = path.extname(file.filename).toLowerCase().replace(/[^.\w]/g, "").slice(0, 10);
    const name = newId() + ext;
    const dest = path.join(uploadsDir, name);
    await pipeline(file.file, fs.createWriteStream(dest));
    if (file.file.truncated) {
      fs.rmSync(dest, { force: true });
      throw badRequest(`Файл больше ${config.maxUploadBytes / 1024 / 1024} МБ`);
    }
    return {
      url: `/uploads/${name}`,
      name: file.filename.slice(0, 255),
      size: fs.statSync(dest).size,
      mime: file.mimetype || "application/octet-stream",
    };
  });
}
