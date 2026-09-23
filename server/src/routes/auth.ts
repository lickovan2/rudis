import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkPassword, hashPassword, requireAuth, signToken } from "../auth.ts";
import { one, run } from "../db.ts";
import { HttpError } from "../errors.ts";
import { newId } from "../ids.ts";
import { getUser, publicUser, type UserRow } from "../access.ts";
import { emitToAudience } from "../realtime.ts";
import { parse } from "../validate.ts";

export const uploadUrl = z.string().regex(/^\/uploads\/[\w.-]+$/, "Неверная ссылка на файл");

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Логин — минимум 3 символа")
    .max(32, "Логин — максимум 32 символа")
    .regex(/^[a-zA-Z0-9_.]+$/, "Логин: только латиница, цифры, _ и ."),
  password: z.string().min(6, "Пароль — минимум 6 символов").max(128),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req) => {
    const body = parse(
      credentials.extend({ displayName: z.string().trim().max(32).optional() }),
      req.body,
    );
    if (one("SELECT 1 FROM users WHERE username = ?", body.username))
      throw new HttpError(409, "Такой логин уже занят");
    const id = newId();
    run(
      "INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      body.username,
      body.displayName || body.username,
      await hashPassword(body.password),
      Date.now(),
    );
    return { token: signToken(id), user: getUser(id) };
  });

  app.post("/api/auth/login", async (req) => {
    const body = parse(z.object({ username: z.string(), password: z.string() }), req.body);
    const u = one<UserRow & { password_hash: string }>(
      "SELECT * FROM users WHERE username = ?",
      body.username.trim(),
    );
    if (!u || !(await checkPassword(body.password, u.password_hash)))
      throw new HttpError(401, "Неверный логин или пароль");
    return { token: signToken(u.id), user: publicUser(u) };
  });

  app.get("/api/me", { preHandler: requireAuth }, async (req) => getUser(req.userId));

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
