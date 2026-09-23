import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { verifyToken } from "./auth.ts";
import { all } from "./db.ts";
import { addSocket, removeSocket } from "./presence.ts";
import { dmParticipants, getChannel, memberRole, type ChannelRow } from "./access.ts";

let io: Server;

interface VoiceMember {
  socketId: string;
  userId: string;
  muted: boolean;
  deafened: boolean;
}

// channelId -> (socketId -> участник)
const voice = new Map<string, Map<string, VoiceMember>>();
const socketVoice = new Map<string, string>();

export function emitToServer(serverId: string, event: string, data: unknown) {
  io.to(`server:${serverId}`).emit(event, data);
}

export function emitToUsers(userIds: string[], event: string, data: unknown) {
  if (userIds.length) io.to(userIds.map((id) => `user:${id}`)).emit(event, data);
}

export function emitToChannel(c: ChannelRow, event: string, data: unknown) {
  if (c.type === "dm") emitToUsers(dmParticipants(c.id), event, data);
  else if (c.server_id) emitToServer(c.server_id, event, data);
}

export function joinServerRoom(userId: string, serverId: string) {
  io.in(`user:${userId}`).socketsJoin(`server:${serverId}`);
}

export function leaveServerRoom(userId: string, serverId: string) {
  io.in(`user:${userId}`).socketsLeave(`server:${serverId}`);
  // Выкинуть из голосовых каналов этого сервера.
  for (const [channelId, members] of voice) {
    for (const m of members.values()) {
      if (m.userId !== userId) continue;
      const c = getChannelSafe(channelId);
      if (c?.server_id === serverId) {
        io.to(m.socketId).emit("voice:kicked", { channelId });
        leaveVoice(m.socketId);
      }
    }
  }
}

export function closeServerRooms(serverId: string) {
  io.in(`server:${serverId}`).socketsLeave(`server:${serverId}`);
}

function getChannelSafe(id: string): ChannelRow | null {
  try {
    return getChannel(id);
  } catch {
    return null;
  }
}

function voiceList(channelId: string) {
  return [...(voice.get(channelId)?.values() ?? [])];
}

export function voiceStatesForServer(serverId: string): Record<string, VoiceMember[]> {
  const out: Record<string, VoiceMember[]> = {};
  for (const [channelId, members] of voice) {
    if (!members.size) continue;
    if (getChannelSafe(channelId)?.server_id === serverId) out[channelId] = [...members.values()];
  }
  return out;
}

function broadcastVoice(channelId: string) {
  const c = getChannelSafe(channelId);
  if (c?.server_id)
    emitToServer(c.server_id, "voice:state", { channelId, members: voiceList(channelId) });
}

function leaveVoice(socketId: string) {
  const channelId = socketVoice.get(socketId);
  if (!channelId) return;
  socketVoice.delete(socketId);
  const members = voice.get(channelId);
  members?.delete(socketId);
  if (members && !members.size) voice.delete(channelId);
  io.in(socketId).socketsLeave(`voice:${channelId}`);
  io.to(`voice:${channelId}`).emit("voice:peer-left", { socketId });
  broadcastVoice(channelId);
}

export function dropVoiceChannel(channelId: string) {
  for (const socketId of [...(voice.get(channelId)?.keys() ?? [])]) {
    io.to(socketId).emit("voice:kicked", { channelId });
    leaveVoice(socketId);
  }
}

function presenceAudience(userId: string): { rooms: string[] } {
  const servers = all<{ server_id: string }>(
    "SELECT server_id FROM members WHERE user_id = ?",
    userId,
  ).map((r) => `server:${r.server_id}`);
  const friends = all<{ id: string }>(
    `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
     FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`,
    userId,
    userId,
    userId,
  ).map((r) => `user:${r.id}`);
  const dms = all<{ user_id: string }>(
    `SELECT DISTINCT p2.user_id FROM dm_participants p1
     JOIN dm_participants p2 ON p1.channel_id = p2.channel_id
     WHERE p1.user_id = ? AND p2.user_id != ?`,
    userId,
    userId,
  ).map((r) => `user:${r.user_id}`);
  return { rooms: [...new Set([...servers, ...friends, ...dms])] };
}

function broadcastPresence(userId: string, online: boolean) {
  const { rooms } = presenceAudience(userId);
  if (rooms.length) io.to(rooms).emit("presence", { userId, online });
}

// Все, кому важен профиль пользователя: общие серверы, друзья, собеседники в ЛС и он сам.
export function emitToAudience(userId: string, event: string, data: unknown) {
  const { rooms } = presenceAudience(userId);
  io.to([...rooms, `user:${userId}`]).emit(event, data);
}

export function setupRealtime(http: HttpServer) {
  io = new Server(http, { cors: { origin: true }, maxHttpBufferSize: 1e6 });

  io.use((socket, next) => {
    const userId = verifyToken(String(socket.handshake.auth?.token ?? ""));
    if (!userId) return next(new Error("unauthorized"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
    for (const { server_id } of all<{ server_id: string }>(
      "SELECT server_id FROM members WHERE user_id = ?",
      userId,
    ))
      socket.join(`server:${server_id}`);

    if (addSocket(userId)) broadcastPresence(userId, true);

    socket.on("typing", ({ channelId }: { channelId: string }) => {
      const c = getChannelSafe(String(channelId));
      if (!c) return;
      const allowed =
        c.type === "dm"
          ? dmParticipants(c.id).includes(userId)
          : !!c.server_id && !!memberRole(c.server_id, userId);
      if (!allowed) return;
      const payload = { channelId: c.id, userId };
      if (c.type === "dm")
        socket.to(dmParticipants(c.id).map((id) => `user:${id}`)).emit("typing", payload);
      else socket.to(`server:${c.server_id}`).emit("typing", payload);
    });

    socket.on("voice:join", ({ channelId }: { channelId: string }, ack?: Function) => {
      const c = getChannelSafe(String(channelId));
      if (!c || c.type !== "voice" || !c.server_id || !memberRole(c.server_id, userId)) {
        ack?.({ error: "Нет доступа к каналу" });
        return;
      }
      leaveVoice(socket.id);
      const peers = voiceList(c.id);
      const members = voice.get(c.id) ?? new Map<string, VoiceMember>();
      members.set(socket.id, { socketId: socket.id, userId, muted: false, deafened: false });
      voice.set(c.id, members);
      socketVoice.set(socket.id, c.id);
      socket.join(`voice:${c.id}`);
      ack?.({ selfSocketId: socket.id, peers });
      broadcastVoice(c.id);
    });

    socket.on("voice:leave", () => leaveVoice(socket.id));

    socket.on("voice:update", (state: { muted?: boolean; deafened?: boolean }) => {
      const channelId = socketVoice.get(socket.id);
      const me = channelId && voice.get(channelId)?.get(socket.id);
      if (!me) return;
      me.muted = !!state.muted;
      me.deafened = !!state.deafened;
      broadcastVoice(channelId);
    });

    // Пересылка SDP/ICE между участниками одного голосового канала.
    socket.on("voice:signal", ({ to, data }: { to: string; data: unknown }) => {
      const channelId = socketVoice.get(socket.id);
      if (!channelId || socketVoice.get(String(to)) !== channelId) return;
      io.to(String(to)).emit("voice:signal", { from: socket.id, userId, data });
    });

    socket.on("disconnect", () => {
      leaveVoice(socket.id);
      if (removeSocket(userId)) broadcastPresence(userId, false);
    });
  });
}
