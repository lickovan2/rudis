import { create } from "zustand";
import { api, setToken } from "./api";
import { connectSocket, disconnectSocket } from "./socket";
import type { DmChannel, Friend, Member, Message, Server, User, VoiceMember, Channel } from "./types";

export interface Route {
  // null — «Главная»: друзья и личные сообщения.
  serverId: string | null;
  channelId: string | null;
}

export type Modal =
  | { kind: "createServer" }
  | { kind: "joinServer"; code?: string }
  | { kind: "createChannel"; serverId: string; type: "text" | "voice" }
  | { kind: "invite"; serverId: string }
  | { kind: "serverSettings"; serverId: string }
  | { kind: "channelSettings"; channelId: string }
  | { kind: "userSettings" }
  | { kind: "profile"; userId: string; serverId?: string }
  | { kind: "image"; url: string; name: string };

interface MessageBucket {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
}

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

interface State {
  me: User | null;
  ready: boolean;
  connected: boolean;
  servers: Server[];
  members: Record<string, Member[]>;
  dms: DmChannel[];
  friends: Friend[];
  messages: Record<string, MessageBucket>;
  typing: Record<string, Record<string, number>>;
  unread: Record<string, number>;
  online: Record<string, boolean>;
  users: Record<string, User>;
  route: Route;
  lastChannel: Record<string, string>;
  modal: Modal | null;
  toasts: Toast[];
  showMembers: boolean;
}

export const useStore = create<State>(() => ({
  me: null,
  ready: false,
  connected: false,
  servers: [],
  members: {},
  dms: [],
  friends: [],
  messages: {},
  typing: {},
  unread: {},
  online: {},
  users: {},
  route: { serverId: null, channelId: null },
  lastChannel: {},
  modal: null,
  toasts: [],
  showMembers: true,
}));

const set = useStore.setState;
const get = useStore.getState;

// --- Пользователи и присутствие ---

function rememberUsers(users: (User | null | undefined)[]) {
  const patchUsers: Record<string, User> = {};
  const patchOnline: Record<string, boolean> = {};
  for (const u of users) {
    if (!u) continue;
    patchUsers[u.id] = u;
    patchOnline[u.id] = u.online;
  }
  set((s) => ({ users: { ...s.users, ...patchUsers }, online: { ...s.online, ...patchOnline } }));
}

/** Актуальный профиль с учётом последних обновлений и онлайна. */
export function useUser(u: User): User;
export function useUser(u: User | null | undefined): User | null;
export function useUser(u: User | null | undefined): User | null {
  const latest = useStore((s) => (u ? s.users[u.id] : undefined));
  const online = useStore((s) => (u ? s.online[u.id] : undefined));
  if (!u) return null;
  const base = latest ?? u;
  return { ...base, online: online ?? base.online };
}

// --- Уведомления ---

let toastSeq = 0;
export function toast(text: string, kind: Toast["kind"] = "error") {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
}

export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast((e as Error).message);
    return undefined;
  }
}

export const openModal = (modal: Modal) => set({ modal });
export const closeModal = () => set({ modal: null });

// --- Навигация ---

function routeToPath(r: Route): string {
  return `/channels/${r.serverId ?? "@me"}${r.channelId ? `/${r.channelId}` : ""}`;
}

export function navigate(serverId: string | null, channelId?: string | null, replace = false) {
  const s = get();
  let target = channelId ?? null;
  if (serverId && !target) {
    const server = s.servers.find((x) => x.id === serverId);
    const remembered = s.lastChannel[serverId];
    target =
      (remembered && server?.channels.some((c) => c.id === remembered) && remembered) ||
      server?.channels.find((c) => c.type === "text")?.id ||
      null;
  }
  const route = { serverId, channelId: target };
  const unread = { ...s.unread };
  if (target) delete unread[target];
  set({
    route,
    unread,
    lastChannel: serverId && target ? { ...s.lastChannel, [serverId]: target } : s.lastChannel,
  });
  const path = routeToPath(route);
  if (location.pathname !== path) history[replace ? "replaceState" : "pushState"](null, "", path);
  if (serverId && !s.members[serverId]) void loadMembers(serverId);
}

function applyLocation() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === "invite" && parts[1]) {
    navigate(null, null, true);
    openModal({ kind: "joinServer", code: parts[1] });
    return;
  }
  if (parts[0] === "channels" && parts[1] && parts[1] !== "@me") {
    const server = get().servers.find((x) => x.id === parts[1]);
    if (server) {
      const channel = server.channels.find((c) => c.id === parts[2]);
      navigate(server.id, channel?.id ?? null, true);
      return;
    }
  }
  if (parts[0] === "channels" && parts[1] === "@me" && parts[2]) {
    if (get().dms.some((d) => d.id === parts[2])) return navigate(null, parts[2], true);
  }
  navigate(null, null, true);
}

window.addEventListener("popstate", applyLocation);

// --- Загрузка данных ---

export async function loadMembers(serverId: string) {
  const members = await api<Member[]>("GET", `/api/servers/${serverId}/members`);
  rememberUsers(members.map((m) => m.user));
  set((s) => ({ members: { ...s.members, [serverId]: members } }));
}

async function loadServers() {
  const servers = await api<Server[]>("GET", "/api/servers");
  set({ servers });
}

export async function loadDms() {
  const dms = await api<DmChannel[]>("GET", "/api/dms");
  rememberUsers(dms.flatMap((d) => d.recipients));
  set({ dms });
}

export async function loadFriends() {
  const friends = await api<Friend[]>("GET", "/api/friends");
  rememberUsers(friends.map((f) => f.user));
  set({ friends });
}

export async function loadMessages(channelId: string, older = false) {
  const bucket = get().messages[channelId];
  if (bucket?.loading || (older && !bucket?.hasMore) || (!older && bucket)) return;
  set((s) => ({
    messages: {
      ...s.messages,
      [channelId]: { items: bucket?.items ?? [], hasMore: bucket?.hasMore ?? true, loading: true },
    },
  }));
  const before = older ? bucket?.items[0]?.id : undefined;
  try {
    const page = await api<Message[]>(
      "GET",
      `/api/channels/${channelId}/messages${before ? `?before=${before}` : ""}`,
    );
    rememberUsers(page.map((m) => m.author));
    set((s) => {
      const current = s.messages[channelId]?.items ?? [];
      const known = new Set(current.map((m) => m.id));
      const fresh = page.filter((m) => !known.has(m.id));
      return {
        messages: {
          ...s.messages,
          [channelId]: { items: [...fresh, ...current], hasMore: page.length >= 50, loading: false },
        },
      };
    });
  } catch (e) {
    set((s) => ({
      messages: { ...s.messages, [channelId]: { items: bucket?.items ?? [], hasMore: false, loading: false } },
    }));
    toast((e as Error).message);
  }
}

// --- Обновление состояния из событий ---

function upsertMessage(m: Message) {
  set((s) => {
    const bucket = s.messages[m.channelId];
    if (!bucket) return {};
    const idx = bucket.items.findIndex((x) => x.id === m.id);
    const items = idx === -1 ? [...bucket.items, m] : bucket.items.map((x, i) => (i === idx ? m : x));
    return { messages: { ...s.messages, [m.channelId]: { ...bucket, items } } };
  });
}

function patchMessage(channelId: string, id: string, patch: (m: Message) => Message | null) {
  set((s) => {
    const bucket = s.messages[channelId];
    if (!bucket) return {};
    const items = bucket.items.flatMap((m) => {
      if (m.id !== id) return [m];
      const next = patch(m);
      return next ? [next] : [];
    });
    return { messages: { ...s.messages, [channelId]: { ...bucket, items } } };
  });
}

function patchServer(serverId: string, fn: (s: Server) => Server) {
  set((st) => ({ servers: st.servers.map((s) => (s.id === serverId ? fn(s) : s)) }));
}

export function addServer(server: Server) {
  set((s) => ({
    servers: s.servers.some((x) => x.id === server.id) ? s.servers : [...s.servers, server],
  }));
}

export function addDm(dm: DmChannel) {
  rememberUsers(dm.recipients);
  set((s) => ({ dms: s.dms.some((d) => d.id === dm.id) ? s.dms : [dm, ...s.dms], modal: null }));
  navigate(null, dm.id);
}

export function sortChannels(channels: Channel[]) {
  return [...channels].sort((a, b) => a.position - b.position);
}

function notify(title: string, body: string) {
  if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, silent: false });
  } catch {
    /* не поддерживается */
  }
}

function bindSocket() {
  const socket = connectSocket();
  let firstConnect = true;

  socket.on("connect", () => {
    set({ connected: true });
    if (firstConnect) {
      firstConnect = false;
      return;
    }
    // После обрыва — перечитываем всё, что могло устареть.
    set({ messages: {}, members: {} });
    void Promise.all([loadServers(), loadDms(), loadFriends()]).then(() => {
      const { route } = get();
      if (route.serverId) void loadMembers(route.serverId);
    });
  });
  socket.on("disconnect", () => set({ connected: false }));
  socket.on("connect_error", (err) => {
    if (err.message === "unauthorized") logout();
  });

  socket.on("message:create", (m: Message & { serverId: string | null }) => {
    const s = get();
    rememberUsers([m.author]);
    upsertMessage(m);
    const typing = s.typing[m.channelId];
    if (typing?.[m.author.id]) {
      const { [m.author.id]: _, ...rest } = typing;
      set((st) => ({ typing: { ...st.typing, [m.channelId]: rest } }));
    }
    if (m.serverId) {
      patchServer(m.serverId, (srv) => ({
        ...srv,
        channels: srv.channels.map((c) => (c.id === m.channelId ? { ...c, lastMessageAt: m.createdAt } : c)),
      }));
    } else {
      const dm = s.dms.find((d) => d.id === m.channelId);
      if (!dm) void loadDms();
      else
        set((st) => ({
          dms: [{ ...dm, lastMessageAt: m.createdAt }, ...st.dms.filter((d) => d.id !== dm.id)],
        }));
    }
    const mine = m.author.id === s.me?.id;
    const active = s.route.channelId === m.channelId && !document.hidden;
    if (!mine && !active) {
      set((st) => ({ unread: { ...st.unread, [m.channelId]: (st.unread[m.channelId] ?? 0) + 1 } }));
      const mentioned = s.me && m.content.includes(`@${s.me.username}`);
      if (!m.serverId || mentioned)
        notify(m.author.displayName, m.content || (m.attachments.length ? "📎 Вложение" : ""));
    }
  });

  socket.on("message:update", (m: Message) => upsertMessage(m));
  socket.on("message:delete", ({ id, channelId }: { id: string; channelId: string }) =>
    patchMessage(channelId, id, () => null),
  );
  socket.on("message:reactions", ({ id, channelId, reactions }) =>
    patchMessage(channelId, id, (m) => ({ ...m, reactions })),
  );

  socket.on("typing", ({ channelId, userId }: { channelId: string; userId: string }) => {
    set((s) => ({
      typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: Date.now() + 6000 } },
    }));
  });

  socket.on("presence", ({ userId, online }: { userId: string; online: boolean }) =>
    set((s) => ({ online: { ...s.online, [userId]: online } })),
  );

  socket.on("user:update", (u: User) => {
    rememberUsers([u]);
    if (u.id === get().me?.id) set({ me: u });
  });

  socket.on("server:update", (p: { id: string; name: string; icon: string | null }) =>
    patchServer(p.id, (s) => ({ ...s, name: p.name, icon: p.icon })),
  );

  socket.on("server:delete", ({ id, kicked }: { id: string; kicked?: boolean }) => {
    const s = get();
    const server = s.servers.find((x) => x.id === id);
    set({ servers: s.servers.filter((x) => x.id !== id) });
    if (kicked && server) toast(`Вас исключили с сервера «${server.name}»`, "info");
    if (s.route.serverId === id) navigate(null, null, true);
  });

  socket.on("channel:create", (c: Channel) =>
    patchServer(c.serverId!, (s) =>
      s.channels.some((x) => x.id === c.id) ? s : { ...s, channels: sortChannels([...s.channels, c]) },
    ),
  );
  socket.on("channel:update", (c: Channel) =>
    patchServer(c.serverId!, (s) => ({ ...s, channels: s.channels.map((x) => (x.id === c.id ? c : x)) })),
  );
  socket.on("channel:delete", ({ id, serverId }: { id: string; serverId: string }) => {
    patchServer(serverId, (s) => ({ ...s, channels: s.channels.filter((x) => x.id !== id) }));
    if (get().route.channelId === id) navigate(serverId, null, true);
  });

  socket.on("member:add", ({ serverId, member }: { serverId: string; member: Member }) => {
    rememberUsers([member.user]);
    set((s) =>
      s.members[serverId]
        ? { members: { ...s.members, [serverId]: [...s.members[serverId].filter((m) => m.user.id !== member.user.id), member] } }
        : {},
    );
  });
  socket.on("member:update", ({ serverId, member }: { serverId: string; member: Member }) => {
    set((s) =>
      s.members[serverId]
        ? { members: { ...s.members, [serverId]: s.members[serverId].map((m) => (m.user.id === member.user.id ? member : m)) } }
        : {},
    );
    if (member.user.id === get().me?.id) patchServer(serverId, (s) => ({ ...s, role: member.role }));
  });
  socket.on("member:remove", ({ serverId, userId }: { serverId: string; userId: string }) =>
    set((s) =>
      s.members[serverId]
        ? { members: { ...s.members, [serverId]: s.members[serverId].filter((m) => m.user.id !== userId) } }
        : {},
    ),
  );

  socket.on("voice:state", ({ channelId, members }: { channelId: string; members: VoiceMember[] }) => {
    const server = get().servers.find((s) => s.channels.some((c) => c.id === channelId));
    if (server)
      patchServer(server.id, (s) => ({ ...s, voiceStates: { ...s.voiceStates, [channelId]: members } }));
  });

  socket.on("friends:changed", () => void loadFriends());
}

// Чистим протухшие «печатает…».
setInterval(() => {
  const now = Date.now();
  const { typing } = get();
  let changed = false;
  const next: State["typing"] = {};
  for (const [ch, users] of Object.entries(typing)) {
    const alive = Object.fromEntries(Object.entries(users).filter(([, until]) => until > now));
    if (Object.keys(alive).length !== Object.keys(users).length) changed = true;
    next[ch] = alive;
  }
  if (changed) set({ typing: next });
}, 1000);

// --- Сессия ---

export async function bootstrap() {
  try {
    const me = await api<User>("GET", "/api/me");
    set({ me });
    rememberUsers([me]);
    await Promise.all([loadServers(), loadDms(), loadFriends()]);
    bindSocket();
    set({ ready: true });
    applyLocation();
  } catch {
    logout();
  }
}

export async function login(token: string) {
  setToken(token);
  await bootstrap();
}

export function logout() {
  setToken(null);
  disconnectSocket();
  set({
    me: null,
    ready: true,
    servers: [],
    members: {},
    dms: [],
    friends: [],
    messages: {},
    unread: {},
    modal: null,
  });
}

export function currentServer(s: State = get()) {
  return s.servers.find((x) => x.id === s.route.serverId) ?? null;
}

export function canManage(server: Server | null | undefined) {
  return !!server && (server.role === "owner" || server.role === "admin");
}
