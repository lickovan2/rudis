// Сквозная проверка API и реалтайма: node scripts/smoke.mjs [http://localhost:3001]
import { io } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:3001";
const rnd = Math.random().toString(36).slice(2, 8);
let failed = 0;

function check(cond, label) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
}

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

function next(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`нет события ${event}`)), ms);
    socket.once(event, (d) => {
      clearTimeout(t);
      resolve(d);
    });
  });
}

const a = await call("POST", "/api/auth/register", null, { username: `anya_${rnd}`, password: "secret123", displayName: "Аня" });
const b = await call("POST", "/api/auth/register", null, { username: `boris_${rnd}`, password: "secret123", displayName: "Борис" });
check(a.status === 200 && b.status === 200, "регистрация двух пользователей");
const dup = await call("POST", "/api/auth/register", null, { username: `anya_${rnd}`, password: "secret123" });
check(dup.status === 409, `повторный логин отклонён: «${dup.data.error}»`);
const bad = await call("POST", "/api/auth/login", null, { username: `anya_${rnd}`, password: "nope" });
check(bad.status === 401, "неверный пароль отклонён");
const TA = a.data.token;
const TB = b.data.token;

const sa = await connect(TA);
const sb = await connect(TB);
check(sa.connected && sb.connected, "сокеты подключены");

const srv = await call("POST", "/api/servers", TA, { name: "Тестовый сервер" });
check(srv.status === 200 && srv.data.channels.length === 2, "сервер создан с двумя каналами");
const text = srv.data.channels.find((c) => c.type === "text");
const voice = srv.data.channels.find((c) => c.type === "voice");

const forbidden = await call("GET", `/api/channels/${text.id}/messages`, TB);
check(forbidden.status === 404, "чужой не видит канал");

const inv = await call("POST", `/api/servers/${srv.data.id}/invites`, TA);
const preview = await call("GET", `/api/invites/${inv.data.code}`, TB);
check(preview.data.server?.name === "Тестовый сервер", "превью приглашения");
const memberAdd = next(sa, "member:add");
const joined = await call("POST", `/api/invites/${encodeURIComponent("https://x/invite/" + inv.data.code)}/join`, TB);
check(joined.status === 200, "вступление по ссылке-приглашению");
check((await memberAdd).member.user.displayName === "Борис", "владелец получил member:add");

const gotMsg = next(sb, "message:create");
const typing = next(sb, "typing");
sa.emit("typing", { channelId: text.id });
check((await typing).channelId === text.id, "событие «печатает» дошло");
const sent = await call("POST", `/api/channels/${text.id}/messages`, TA, { content: "Привет, **мир**!" });
check(sent.status === 200, "сообщение отправлено");
check((await gotMsg).content === "Привет, **мир**!", "второй участник получил сообщение в реальном времени");

const reply = await call("POST", `/api/channels/${text.id}/messages`, TB, { content: "Здарова", replyTo: sent.data.id });
check(reply.data.replyTo?.id === sent.data.id, "ответ на сообщение");

const react = next(sa, "message:reactions");
await call("PUT", `/api/messages/${sent.data.id}/reactions/${encodeURIComponent("🔥")}`, TB);
check((await react).reactions[0]?.emoji === "🔥", "реакция пришла");

const editOther = await call("PATCH", `/api/messages/${sent.data.id}`, TB, { content: "взлом" });
check(editOther.status === 403, "чужое сообщение редактировать нельзя");
const edit = await call("PATCH", `/api/messages/${sent.data.id}`, TA, { content: "Привет, мир (изм.)" });
check(edit.data.editedAt > 0, "своё сообщение отредактировано");

const hist = await call("GET", `/api/channels/${text.id}/messages`, TB);
check(hist.data.length === 2 && hist.data[0].id === sent.data.id, "история по порядку");

// Файл
const form = new FormData();
form.append("file", new Blob(["hello"], { type: "text/plain" }), "заметка.txt");
const up = await fetch(BASE + "/api/upload", { method: "POST", headers: { Authorization: `Bearer ${TA}` }, body: form });
const upData = await up.json();
check(up.status === 200 && upData.url?.startsWith("/uploads/"), "загрузка файла");
const dl = await fetch(BASE + upData.url);
check(dl.headers.get("content-disposition") === "attachment", "не-медиа файл отдаётся как скачивание");
const withFile = await call("POST", `/api/channels/${text.id}/messages`, TA, { attachments: [upData] });
check(withFile.data.attachments?.length === 1, "сообщение с вложением");

// Друзья и ЛС
const fr = next(sb, "friends:changed");
await call("POST", "/api/friends", TA, { username: `boris_${rnd}` });
await fr;
const friendsB = await call("GET", "/api/friends", TB);
check(friendsB.data[0]?.status === "incoming", "входящая заявка в друзья");
await call("POST", `/api/friends/${a.data.user.id}/accept`, TB);
const friendsA = await call("GET", "/api/friends", TA);
check(friendsA.data[0]?.status === "accepted", "дружба принята");

const dm = await call("POST", "/api/dms", TA, { userId: b.data.user.id });
const dm2 = await call("POST", "/api/dms", TB, { userId: a.data.user.id });
check(dm.data.id === dm2.data.id, "ЛС-канал один на пару");
const dmMsg = next(sb, "message:create");
await call("POST", `/api/channels/${dm.data.id}/messages`, TA, { content: "лично тебе" });
check((await dmMsg).serverId === null, "личное сообщение доставлено");

// Голос: сигналинг
const stateEv = next(sa, "voice:state");
const joinA = await new Promise((r) => sa.emit("voice:join", { channelId: voice.id }, r));
check(Array.isArray(joinA.peers) && joinA.peers.length === 0, "вход в голосовой канал");
await stateEv;
const joinB = await new Promise((r) => sb.emit("voice:join", { channelId: voice.id }, r));
check(joinB.peers.length === 1 && joinB.peers[0].socketId === sa.id, "второй видит первого в голосе");
const sig = next(sa, "voice:signal");
sb.emit("voice:signal", { to: sa.id, data: { type: "offer", sdp: "x" } });
check((await sig).from === sb.id, "сигнал WebRTC переслан");
const left = next(sa, "voice:peer-left");
sb.emit("voice:leave");
check((await left).socketId === sb.id, "выход из голоса");

// Права
const kickByMember = await call("DELETE", `/api/servers/${srv.data.id}/members/${a.data.user.id}`, TB);
check(kickByMember.status === 403, "участник не может выгнать владельца");
const kicked = next(sb, "server:delete");
await call("DELETE", `/api/servers/${srv.data.id}/members/${b.data.user.id}`, TA);
check((await kicked).kicked === true, "исключение с сервера");
const del = await call("DELETE", `/api/servers/${srv.data.id}`, TA);
check(del.status === 200, "сервер удалён");

sa.close();
sb.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки пройдены");
process.exit(failed ? 1 : 0);
