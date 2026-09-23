import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.ts";
import { all, one, run, tx } from "../db.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { inviteCode, newId } from "../ids.ts";
import {
  getChannel,
  memberRole,
  requireAdmin,
  requireMember,
  serializeChannel,
  usersByIds,
  type ChannelRow,
  type Role,
} from "../access.ts";
import {
  closeServerRooms,
  dropVoiceChannel,
  emitToServer,
  emitToUsers,
  joinServerRoom,
  leaveServerRoom,
  voiceStatesForServer,
} from "../realtime.ts";
import { parse } from "../validate.ts";
import { uploadUrl } from "./auth.ts";
import { assertOwnedUpload } from "./uploads.ts";

interface ServerRow {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
}

function serverSummary(serverId: string, userId: string) {
  const s = one<ServerRow>("SELECT * FROM servers WHERE id = ?", serverId);
  if (!s) throw notFound("Сервер не найден");
  const channels = all<ChannelRow>(
    "SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at",
    serverId,
  );
  return {
    id: s.id,
    name: s.name,
    icon: s.icon,
    ownerId: s.owner_id,
    role: memberRole(serverId, userId),
    channels: channels.map(serializeChannel),
    voiceStates: voiceStatesForServer(serverId),
  };
}

function serverMembers(serverId: string) {
  const rows = all<{ user_id: string; role: Role; joined_at: number }>(
    "SELECT user_id, role, joined_at FROM members WHERE server_id = ? ORDER BY joined_at",
    serverId,
  );
  const users = usersByIds(rows.map((r) => r.user_id));
  return rows.map((r) => ({ user: users.get(r.user_id)!, role: r.role, joinedAt: r.joined_at }));
}

function memberPayload(serverId: string, userId: string) {
  return serverMembers(serverId).find((m) => m.user.id === userId);
}

const serverName = z.string().trim().min(1, "Введите название").max(64);

// Текстовые каналы в стиле «мемы-и-приколы»: нижний регистр, дефисы вместо пробелов.
function normalizeChannelName(type: string, name: string) {
  return type === "text" ? name.trim().replace(/\s+/g, "-").toLowerCase() : name.trim();
}

export default async function serverRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/servers", async (req) => {
    const ids = all<{ server_id: string }>(
      "SELECT server_id FROM members WHERE user_id = ? ORDER BY joined_at",
      req.userId,
    );
    return ids.map((r) => serverSummary(r.server_id, req.userId));
  });

  app.post("/api/servers", async (req) => {
    const body = parse(
      z.object({ name: serverName, icon: uploadUrl.nullable().optional() }),
      req.body,
    );
    if (body.icon) assertOwnedUpload(req.userId, body.icon);
    const id = newId();
    const now = Date.now();
    tx(() => {
      run(
        "INSERT INTO servers (id, name, icon, owner_id, created_at) VALUES (?, ?, ?, ?, ?)",
        id,
        body.name,
        body.icon ?? null,
        req.userId,
        now,
      );
      run(
        "INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
        id,
        req.userId,
        "owner",
        now,
      );
      const insertChannel =
        "INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)";
      run(insertChannel, newId(), id, "общий", "text", 0, now);
      run(insertChannel, newId(), id, "Общий", "voice", 1, now);
    });
    joinServerRoom(req.userId, id);
    return serverSummary(id, req.userId);
  });

  app.get<{ Params: { id: string } }>("/api/servers/:id/members", async (req) => {
    requireMember(req.params.id, req.userId);
    return serverMembers(req.params.id);
  });

  app.patch<{ Params: { id: string } }>("/api/servers/:id", async (req) => {
    requireAdmin(req.params.id, req.userId);
    const body = parse(
      z.object({ name: serverName.optional(), icon: uploadUrl.nullable().optional() }),
      req.body,
    );
    const currentIcon = one<{ icon: string | null }>("SELECT icon FROM servers WHERE id = ?", req.params.id)?.icon;
    if (body.icon && body.icon !== currentIcon) assertOwnedUpload(req.userId, body.icon);
    if (body.name !== undefined)
      run("UPDATE servers SET name = ? WHERE id = ?", body.name, req.params.id);
    if (body.icon !== undefined)
      run("UPDATE servers SET icon = ? WHERE id = ?", body.icon, req.params.id);
    const s = one<ServerRow>("SELECT * FROM servers WHERE id = ?", req.params.id)!;
    const payload = { id: s.id, name: s.name, icon: s.icon };
    emitToServer(s.id, "server:update", payload);
    return payload;
  });

  app.delete<{ Params: { id: string } }>("/api/servers/:id", async (req) => {
    if (requireMember(req.params.id, req.userId) !== "owner")
      throw forbidden("Удалить сервер может только владелец");
    for (const c of all<{ id: string }>(
      "SELECT id FROM channels WHERE server_id = ? AND type = 'voice'",
      req.params.id,
    ))
      dropVoiceChannel(c.id);
    emitToServer(req.params.id, "server:delete", { id: req.params.id });
    closeServerRooms(req.params.id);
    run("DELETE FROM servers WHERE id = ?", req.params.id);
    return { ok: true };
  });

  // --- Каналы ---

  app.post<{ Params: { id: string } }>("/api/servers/:id/channels", async (req) => {
    requireAdmin(req.params.id, req.userId);
    const body = parse(
      z.object({
        name: z.string().trim().min(1, "Введите название канала").max(48),
        type: z.enum(["text", "voice"]),
      }),
      req.body,
    );
    const pos = one<{ p: number | null }>(
      "SELECT MAX(position) p FROM channels WHERE server_id = ?",
      req.params.id,
    )!.p;
    const id = newId();
    run(
      "INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      req.params.id,
      normalizeChannelName(body.type, body.name),
      body.type,
      (pos ?? -1) + 1,
      Date.now(),
    );
    const channel = serializeChannel(getChannel(id));
    emitToServer(req.params.id, "channel:create", channel);
    return channel;
  });

  app.patch<{ Params: { id: string } }>("/api/channels/:id", async (req) => {
    const c = getChannel(req.params.id);
    if (!c.server_id) throw badRequest("Нельзя изменить этот канал");
    requireAdmin(c.server_id, req.userId);
    const body = parse(
      z.object({
        name: z.string().trim().min(1, "Введите название канала").max(48).optional(),
        topic: z.string().max(256).optional(),
      }),
      req.body,
    );
    if (body.name !== undefined)
      run("UPDATE channels SET name = ? WHERE id = ?", normalizeChannelName(c.type, body.name), c.id);
    if (body.topic !== undefined)
      run("UPDATE channels SET topic = ? WHERE id = ?", body.topic, c.id);
    const channel = serializeChannel(getChannel(c.id));
    emitToServer(c.server_id, "channel:update", channel);
    return channel;
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id", async (req) => {
    const c = getChannel(req.params.id);
    if (!c.server_id) throw badRequest("Нельзя удалить этот канал");
    requireAdmin(c.server_id, req.userId);
    if (c.type === "voice") dropVoiceChannel(c.id);
    run("DELETE FROM channels WHERE id = ?", c.id);
    emitToServer(c.server_id, "channel:delete", { id: c.id, serverId: c.server_id });
    return { ok: true };
  });

  // --- Приглашения ---

  app.post<{ Params: { id: string } }>("/api/servers/:id/invites", async (req) => {
    requireMember(req.params.id, req.userId);
    const code = inviteCode();
    run(
      "INSERT INTO invites (code, server_id, creator_id, created_at) VALUES (?, ?, ?, ?)",
      code,
      req.params.id,
      req.userId,
      Date.now(),
    );
    return { code };
  });

  // Принимает и голый код, и ссылку вида https://.../invite/<код>.
  function findInvite(code: string) {
    const inv = one<{ code: string; server_id: string }>(
      "SELECT * FROM invites WHERE code = ?",
      code.trim().replace(/^.*\//, ""),
    );
    if (!inv) throw notFound("Приглашение недействительно");
    return inv;
  }

  app.get<{ Params: { code: string } }>("/api/invites/:code", async (req) => {
    const inv = findInvite(req.params.code);
    const s = one<ServerRow>("SELECT * FROM servers WHERE id = ?", inv.server_id)!;
    const count = one<{ n: number }>(
      "SELECT COUNT(*) n FROM members WHERE server_id = ?",
      s.id,
    )!.n;
    return {
      code: inv.code,
      server: { id: s.id, name: s.name, icon: s.icon, memberCount: count },
      joined: !!memberRole(s.id, req.userId),
    };
  });

  app.post<{ Params: { code: string } }>("/api/invites/:code/join", async (req) => {
    const inv = findInvite(req.params.code);
    if (!memberRole(inv.server_id, req.userId)) {
      run(
        "INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
        inv.server_id,
        req.userId,
        "member",
        Date.now(),
      );
      run("UPDATE invites SET uses = uses + 1 WHERE code = ?", inv.code);
      emitToServer(inv.server_id, "member:add", {
        serverId: inv.server_id,
        member: memberPayload(inv.server_id, req.userId),
      });
      joinServerRoom(req.userId, inv.server_id);
    }
    return serverSummary(inv.server_id, req.userId);
  });

  // --- Участники ---

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/servers/:id/members/:userId",
    async (req) => {
      const { id: serverId, userId: target } = req.params;
      const myRole = requireMember(serverId, req.userId);
      const targetRole = memberRole(serverId, target);
      if (!targetRole) throw notFound("Участник не найден");
      if (target === req.userId) {
        if (myRole === "owner")
          throw badRequest("Владелец не может покинуть сервер — удалите его");
      } else if (
        myRole === "member" ||
        targetRole === "owner" ||
        (myRole === "admin" && targetRole === "admin")
      ) {
        throw forbidden();
      }
      run("DELETE FROM members WHERE server_id = ? AND user_id = ?", serverId, target);
      leaveServerRoom(target, serverId);
      emitToServer(serverId, "member:remove", { serverId, userId: target });
      emitToUsers([target], "server:delete", { id: serverId, kicked: target !== req.userId });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string; userId: string } }>(
    "/api/servers/:id/members/:userId",
    async (req) => {
      const { id: serverId, userId: target } = req.params;
      if (requireMember(serverId, req.userId) !== "owner")
        throw forbidden("Роли назначает только владелец");
      const body = parse(z.object({ role: z.enum(["admin", "member"]) }), req.body);
      const targetRole = memberRole(serverId, target);
      if (!targetRole) throw notFound("Участник не найден");
      if (targetRole === "owner") throw badRequest("Нельзя изменить роль владельца");
      run(
        "UPDATE members SET role = ? WHERE server_id = ? AND user_id = ?",
        body.role,
        serverId,
        target,
      );
      const member = memberPayload(serverId, target);
      emitToServer(serverId, "member:update", { serverId, member });
      return member;
    },
  );
}
