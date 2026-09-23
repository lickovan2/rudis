import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkPassword, clearMediaCookie, hashPassword, requireAuth, setMediaCookie, signToken } from "../auth.ts";
import { one, run, usernameKey } from "../db.ts";
import { HttpError } from "../errors.ts";
import { newId } from "../ids.ts";
import { getUser, publicUser, type UserRow } from "../access.ts";
import { emitToAudience } from "../realtime.ts";
import { parse } from "../validate.ts";
import { rateLimit } from "../rate-limit.ts";
import { assertOwnedUpload } from "./uploads.ts";

export const uploadUrl = z.string().regex(/^\/uploads\/[\w.-]+$/, "Неверная ссылка на файл");

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Логин — минимум 3 символа")
    .max(32, "Логин — максимум 32 символа")
    .regex(/^[a-zA-Zа-яА-ЯёЁ0-9_.]+$/, "Логин: буквы (русские или латинские), цифры, _ и . — без пробелов"),
  password: z.string().min(6, "Пароль — минимум 6 символов").max(128),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req, reply) => {
    rateLimit(`register:${req.ip}`, 10, 60 * 60_000);
    const body = parse(
      credentials.extend({ displayName: z.string().trim().max(32).optional() }),
      req.body,
    );
    if (one("SELECT 1 FROM users WHERE username_key = ?", usernameKey(body.username)))
      throw new HttpError(409, "Такой логин уже занят");
    const id = newId();
    run(
      "INSERT INTO users (id, username, username_key, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      body.username,
      usernameKey(body.username),
      body.displayName || body.username,
      await hashPassword(body.password),
      Date.now(),
    );
    const token = signToken(id);
    setMediaCookie(req, reply, token);
    return { token, user: getUser(id) };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = parse(z.object({ username: z.string().min(1).max(33), password: z.string().min(1).max(128) }), req.body);
    rateLimit(`login:ip:${req.ip}`, 60, 60_000);
    rateLimit(`login:name:${usernameKey(body.username.replace(/^@/, ""))}`, 10, 60_000);
    const u = one<UserRow & { password_hash: string }>(
      "SELECT * FROM users WHERE username_key = ?",
      usernameKey(body.username.replace(/^@/, "")),
    );
    if (!u || !(await checkPassword(body.password, u.password_hash)))
      throw new HttpError(401, "Неверный логин или пароль");
    const token = signToken(u.id);
    setMediaCookie(req, reply, token);
    return { token, user: publicUser(u) };
  });

  app.get("/api/me", { preHandler: requireAuth }, async (req, reply) => {
    setMediaCookie(req, reply, req.headers.authorization!.slice(7));
    return getUser(req.userId);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    clearMediaCookie(req, reply);
    return { ok: true };
  });

  app.patch("/api/me", { preHandler: requireAuth }, async (req) => {
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1, "Имя не может быть пустым").max(32).optional(),
        avatar: uploadUrl.nullable().optional(),
        about: z.string().max(190).optional(),
      }),
      req.body,
    );
    if (body.displayName !== undefined)
      run("UPDATE users SET display_name = ? WHERE id = ?", body.displayName, req.userId);
    // Проверяем только новую картинку: текущую аватарку клиент присылает как есть.
    const currentAvatar = one<{ avatar: string | null }>("SELECT avatar FROM users WHERE id = ?", req.userId)?.avatar;
    if (body.avatar !== undefined && body.avatar !== currentAvatar)
      assertOwnedUpload(req.userId, body.avatar);
    if (body.avatar !== undefined)
      run("UPDATE users SET avatar = ? WHERE id = ?", body.avatar, req.userId);
    if (body.about !== undefined)
      run("UPDATE users SET about = ? WHERE id = ?", body.about, req.userId);
    const user = getUser(req.userId);
    emitToAudience(req.userId, "user:update", user);
    return user;
  });

  app.get<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: requireAuth },
    async (req) => getUser(req.params.id),
  );
}
