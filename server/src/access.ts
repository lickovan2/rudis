import { all, one } from "./db.ts";
import { forbidden, notFound } from "./errors.ts";
import { isOnline } from "./presence.ts";

export type Role = "owner" | "admin" | "member";

export interface ChannelRow {
  id: string;
  server_id: string | null;
  name: string;
  topic: string;
  type: "text" | "voice" | "dm";
  position: number;
  last_message_at: number | null;
  created_at: number;
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  about: string;
  created_at: number;
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    about: u.about,
    online: isOnline(u.id),
  };
}

export function usersByIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, ReturnType<typeof publicUser>>();
  const rows = all<UserRow>(
    `SELECT * FROM users WHERE id IN (${unique.map(() => "?").join(",")})`,
    ...unique,
  );
  return new Map(rows.map((r) => [r.id, publicUser(r)]));
}

export function getUser(id: string) {
  const u = one<UserRow>("SELECT * FROM users WHERE id = ?", id);
  if (!u) throw notFound("Пользователь не найден");
  return publicUser(u);
}

export function memberRole(serverId: string, userId: string): Role | null {
  const m = one<{ role: Role }>(
    "SELECT role FROM members WHERE server_id = ? AND user_id = ?",
    serverId,
    userId,
  );
  return m?.role ?? null;
}

export function requireMember(serverId: string, userId: string): Role {
  const role = memberRole(serverId, userId);
  if (!role) throw notFound("Сервер не найден");
  return role;
}

export function requireAdmin(serverId: string, userId: string): Role {
  const role = requireMember(serverId, userId);
  if (role === "member") throw forbidden();
  return role;
}

export function getChannel(id: string): ChannelRow {
  const c = one<ChannelRow>("SELECT * FROM channels WHERE id = ?", id);
  if (!c) throw notFound("Канал не найден");
  return c;
}

export function dmParticipants(channelId: string): string[] {
  return all<{ user_id: string }>(
    "SELECT user_id FROM dm_participants WHERE channel_id = ?",
    channelId,
  ).map((r) => r.user_id);
}

export function canViewChannel(userId: string, c: ChannelRow): boolean {
  if (c.type === "dm") return dmParticipants(c.id).includes(userId);
  return !!c.server_id && !!memberRole(c.server_id, userId);
}

export function requireChannel(id: string, userId: string): ChannelRow {
  const c = getChannel(id);
  if (!canViewChannel(userId, c)) throw notFound("Канал не найден");
  return c;
}

export function serializeChannel(c: ChannelRow) {
  return {
    id: c.id,
    serverId: c.server_id,
    name: c.name,
    topic: c.topic,
    type: c.type,
    position: c.position,
    lastMessageAt: c.last_message_at,
  };
}

export function serializeDm(c: ChannelRow, viewerId: string) {
  const ids = dmParticipants(c.id);
  const users = usersByIds(ids);
  return {
    ...serializeChannel(c),
    recipients: ids.filter((id) => id !== viewerId).map((id) => users.get(id)!),
  };
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  attachments: string;
  reply_to: string | null;
  edited_at: number | null;
  created_at: number;
}

export function serializeMessages(rows: MessageRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = rows.map((r) => r.reply_to).filter((x): x is string => !!x);
  const replies = replyIds.length
    ? all<MessageRow>(
        `SELECT * FROM messages WHERE id IN (${replyIds.map(() => "?").join(",")})`,
        ...replyIds,
      )
    : [];
  const replyMap = new Map(replies.map((r) => [r.id, r]));
  const users = usersByIds([...rows, ...replies].map((r) => r.author_id));

  const reactionRows = all<{ message_id: string; user_id: string; emoji: string }>(
    `SELECT * FROM reactions WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY rowid`,
    ...ids,
  );
  const reactions = new Map<string, Map<string, string[]>>();
  for (const r of reactionRows) {
    const byEmoji = reactions.get(r.message_id) ?? new Map<string, string[]>();
    byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.user_id]);
    reactions.set(r.message_id, byEmoji);
  }

  return rows.map((r) => {
    const reply = r.reply_to ? replyMap.get(r.reply_to) : undefined;
    return {
      id: r.id,
      channelId: r.channel_id,
      author: users.get(r.author_id)!,
      content: r.content,
      attachments: JSON.parse(r.attachments) as Attachment[],
      replyTo: reply
        ? { id: reply.id, author: users.get(reply.author_id)!, content: reply.content }
        : r.reply_to
          ? { id: r.reply_to, author: null, content: null }
          : null,
      reactions: [...(reactions.get(r.id) ?? new Map()).entries()].map(([emoji, userIds]) => ({
        emoji,
        userIds,
      })),
      editedAt: r.edited_at,
      createdAt: r.created_at,
    };
  });
}

export function loadMessage(id: string) {
  const row = one<MessageRow>("SELECT * FROM messages WHERE id = ?", id);
  if (!row) throw notFound("Сообщение не найдено");
  return { row, message: serializeMessages([row])[0] };
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  mime: string;
  width?: number;
  height?: number;
}
