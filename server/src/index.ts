import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.ts";
import { HttpError } from "./errors.ts";
import { setupRealtime } from "./realtime.ts";
import authRoutes from "./routes/auth.ts";
import serverRoutes from "./routes/servers.ts";
import messageRoutes from "./routes/messages.ts";
import socialRoutes from "./routes/social.ts";
import uploadRoutes, { uploadsDir } from "./routes/uploads.ts";
import voiceRoutes from "./routes/voice.ts";

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

// Пользовательские файлы: запрещаем исполнять их как страницу нашего сайта.
const inlineExt = /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|mp3|ogg|oga|wav|m4a|flac)$/i;
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: "/uploads/",
  maxAge: "30d",
  immutable: true,
  setHeaders(res, filePath) {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Content-Security-Policy", "sandbox; default-src 'none'");
    if (!inlineExt.test(filePath)) res.header("Content-Disposition", "attachment");
  },
});

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    prefix: "/",
    decorateReply: false,
  });
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
  app.log.error(err);
  return reply.status(500).send({ error: "Внутренняя ошибка сервера" });
});

app.setNotFoundHandler((req, reply) => {
  const indexHtml = `${config.webDist}/index.html`;
  // Клиентские маршруты (/channels/..., /invite/...) отдаём как SPA; отсутствующие файлы — 404.
  const pathname = req.url.split("?")[0];
  const isAsset = /\.[a-z0-9]+$/i.test(pathname);
  if (req.method === "GET" && !pathname.startsWith("/api/") && !isAsset && fs.existsSync(indexHtml))
    return reply.type("text/html").send(fs.createReadStream(indexHtml));
  return reply.status(404).send({ error: "Не найдено" });
});

await app.register(authRoutes);
await app.register(serverRoutes);
await app.register(messageRoutes);
await app.register(socialRoutes);
await app.register(uploadRoutes);
await app.register(voiceRoutes);

setupRealtime(app.server);

await app.listen({ port: config.port, host: config.host });
