import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.ts";
import { all, one, run, tx } from "../db.ts";
import { badRequest, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { getChannel, serializeDm, usersByIds, type ChannelRow } from "../access.ts";
import { emitToUsers } from "../realtime.ts";
import { parse } from "../validate.ts";

interface FriendRow {
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
}

function relation(a: string, b: string) {
  return one<FriendRow>(
    `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    a,
    b,
    b,
    a,
  );
}

export default async function socialRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // --- Друзья ---

  app.get("/api/friends", async (req) => {
    const rows = all<FriendRow>(
      "SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ?",
      req.userId,
      req.userId,
    );
    const otherId = (r: FriendRow) => (r.requester_id === req.userId ? r.addressee_id : r.requester_id);
    const users = usersByIds(rows.map(otherId));
    return rows.map((r) => ({
      user: users.get(otherId(r))!,
      status:
        r.status === "accepted" ? "accepted" : r.requester_id === req.userId ? "outgoing" : "incoming",
    }));
  });

  app.post("/api/friends", async (req) => {
    const body = parse(z.object({ username: z.string().trim().min(1, "Введите логин") }), req.body);
    const target = one<{ id: string }>("SELECT id FROM users WHERE username = ?", body.username);
    if (!target) throw notFound("Пользователь с таким логином не найден");
    if (target.id === req.userId) throw badRequest("Нельзя добавить в друзья самого себя");
    const existing = relation(req.userId, target.id);
    if (existing?.status === "accepted") throw badRequest("Вы уже друзья");
    if (existing?.requester_id === req.userId) throw badRequest("Заявка уже отправлена");
    if (existing) {
      // Встречная заявка — сразу принимаем.
      run(
        "UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?",
        target.id,
        req.userId,
      );
    } else {
      run(
        "INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
        req.userId,
        target.id,
        Date.now(),
      );
    }
    emitToUsers([req.userId, target.id], "friends:changed", {});
    return { ok: true };
  });

  app.post<{ Params: { userId: string } }>("/api/friends/:userId/accept", async (req) => {
    const r = relation(req.userId, req.params.userId);
    if (!r || r.status !== "pending" || r.addressee_id !== req.userId)
      throw notFound("Заявка не найдена");
    run(
      "UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?",
      r.requester_id,
      r.addressee_id,
    );
    emitToUsers([req.userId, req.params.userId], "friends:changed", {});
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>("/api/friends/:userId", async (req) => {
    const r = relation(req.userId, req.params.userId);
    if (!r) throw notFound("Не найдено");
    run(
      "DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?",
      r.requester_id,
      r.addressee_id,
    );
    emitToUsers([req.userId, req.params.userId], "friends:changed", {});
    return { ok: true };
  });

  // --- Личные сообщения ---

  app.get("/api/dms", async (req) => {
    const rows = all<ChannelRow>(
      `SELECT c.* FROM channels c JOIN dm_participants p ON p.channel_id = c.id
       WHERE p.user_id = ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      req.userId,
    );
    return rows.map((c) => serializeDm(c, req.userId));
  });

  app.post("/api/dms", async (req) => {
    const body = parse(z.object({ userId: z.string() }), req.body);
    if (body.userId === req.userId) throw badRequest("Нельзя написать самому себе");
    if (!one("SELECT 1 FROM users WHERE id = ?", body.userId))
      throw notFound("Пользователь не найден");
    const existing = one<{ channel_id: string }>(
      `SELECT p1.channel_id FROM dm_participants p1
       JOIN dm_participants p2 ON p1.channel_id = p2.channel_id
       WHERE p1.user_id = ? AND p2.user_id = ?`,
      req.userId,
      body.userId,
    );
    if (existing) return serializeDm(getChannel(existing.channel_id), req.userId);
    const id = newId();
    tx(() => {
      run("INSERT INTO channels (id, type, created_at) VALUES (?, 'dm', ?)", id, Date.now());
      run("INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)", id, req.userId);
      run("INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)", id, body.userId);
    });
    return serializeDm(getChannel(id), req.userId);
  });
}
