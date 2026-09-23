import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.ts";
import { all, one, run, tx } from "../db.ts";
import { badRequest, forbidden } from "../errors.ts";
import { newId } from "../ids.ts";
import {
  getChannel,
  loadMessage,
  memberRole,
  requireChannel,
  serializeMessages,
} from "../access.ts";
import { emitToChannel } from "../realtime.ts";
import { parse } from "../validate.ts";
import { config } from "../config.ts";
import { assertOwnedUpload } from "./uploads.ts";

const attachment = z.object({
  url: z.string().regex(/^\/uploads\/[\w.-]+$/),
  name: z.string().max(255),
  size: z.number().int().nonnegative(),
  mime: z.string().max(128),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const emoji = z.string().min(1).max(32);

export default async function messageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    "/api/channels/:id/messages",
    async (req) => {
      const c = requireChannel(req.params.id, req.userId);
      const requested = req.query.limit === undefined ? config.messagePageSize : Number(req.query.limit);
      if (!Number.isInteger(requested) || requested < 1 || requested > 100)
        throw badRequest("Лимит должен быть целым числом от 1 до 100");
      const limit = requested;
      const rows = req.query.before
        ? all(
            "SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
            c.id,
            req.query.before,
            limit,
          )
        : all("SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?", c.id, limit);
      return serializeMessages(rows.reverse() as any);
    },
  );

  app.post<{ Params: { id: string } }>("/api/channels/:id/messages", async (req) => {
    const c = requireChannel(req.params.id, req.userId);
    if (c.type === "voice") throw badRequest("В голосовой канал нельзя писать");
    const body = parse(
      z.object({
        content: z.string().max(4000, "Сообщение слишком длинное (максимум 4000 символов)").default(""),
        attachments: z.array(attachment).max(10).default([]),
        replyTo: z.string().nullable().optional(),
      }),
      req.body,
    );
    const content = body.content.trim();
    if (!content && !body.attachments.length) throw badRequest("Пустое сообщение");
    for (const file of body.attachments) assertOwnedUpload(req.userId, file.url);
    const replyTo =
      body.replyTo &&
      one("SELECT id FROM messages WHERE id = ? AND channel_id = ?", body.replyTo, c.id)
        ? body.replyTo
        : null;

    const id = newId();
    const now = Date.now();
    tx(() => {
      run(
        "INSERT INTO messages (id, channel_id, author_id, content, attachments, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id, c.id, req.userId, content, JSON.stringify(body.attachments), replyTo, now,
      );
      for (const file of body.attachments)
        run("INSERT OR IGNORE INTO message_uploads (message_id, url) VALUES (?, ?)", id, file.url);
      run("UPDATE channels SET last_message_at = ? WHERE id = ?", now, c.id);
    });
    const { message } = loadMessage(id);
    emitToChannel(c, "message:create", { ...message, serverId: c.server_id });
    return message;
  });

  app.patch<{ Params: { id: string } }>("/api/messages/:id", async (req) => {
    const { row } = loadMessage(req.params.id);
    const c = requireChannel(row.channel_id, req.userId);
    if (row.author_id !== req.userId) throw forbidden("Можно редактировать только свои сообщения");
    const body = parse(
      z.object({ content: z.string().trim().min(1, "Пустое сообщение").max(4000) }),
      req.body,
    );
    run(
      "UPDATE messages SET content = ?, edited_at = ? WHERE id = ?",
      body.content,
      Date.now(),
      row.id,
    );
    const { message } = loadMessage(row.id);
    emitToChannel(c, "message:update", message);
    return message;
  });

  app.delete<{ Params: { id: string } }>("/api/messages/:id", async (req) => {
    const { row } = loadMessage(req.params.id);
    const c = requireChannel(row.channel_id, req.userId);
    const isAdmin =
      !!c.server_id && ["owner", "admin"].includes(memberRole(c.server_id, req.userId) ?? "");
    if (row.author_id !== req.userId && !isAdmin) throw forbidden();
    run("DELETE FROM messages WHERE id = ?", row.id);
    emitToChannel(c, "message:delete", { id: row.id, channelId: c.id });
    return { ok: true };
  });

  async function react(messageId: string, userId: string, rawEmoji: string, add: boolean) {
    const e = parse(emoji, rawEmoji);
    const { row } = loadMessage(messageId);
    const c = requireChannel(row.channel_id, userId);
    if (add) {
      const distinct = one<{ n: number }>(
        "SELECT COUNT(DISTINCT emoji) n FROM reactions WHERE message_id = ?",
        row.id,
      )!.n;
      if (distinct >= 20) throw badRequest("Слишком много разных реакций");
      run("INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)", row.id, userId, e);
    } else {
      run("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?", row.id, userId, e);
    }
    const { message } = loadMessage(row.id);
    emitToChannel(getChannel(c.id), "message:reactions", {
      id: row.id,
      channelId: c.id,
      reactions: message.reactions,
    });
    return { ok: true };
  }

  app.put<{ Params: { id: string; emoji: string } }>(
    "/api/messages/:id/reactions/:emoji",
    async (req) => react(req.params.id, req.userId, req.params.emoji, true),
  );

  app.delete<{ Params: { id: string; emoji: string } }>(
    "/api/messages/:id/reactions/:emoji",
    async (req) => react(req.params.id, req.userId, req.params.emoji, false),
  );
}
