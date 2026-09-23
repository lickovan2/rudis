import { useState, type FormEvent } from "react";
import { api } from "../api";
import { addDm, attempt, openModal, toast, useStore, useUser } from "../store";
import type { DmChannel, Friend } from "../types";
import { Avatar } from "./Avatar";
import { Check, MessageIcon, Users, X } from "./icons";

type Tab = "online" | "all" | "pending" | "add";

export async function openDm(userId: string) {
  const dm = await attempt(() => api<DmChannel>("POST", "/api/dms", { userId }));
  if (dm) addDm(dm);
}

export function Friends() {
  const friends = useStore((s) => s.friends);
  const online = useStore((s) => s.online);
  const [tab, setTab] = useState<Tab>("online");
  const incoming = friends.filter((f) => f.status === "incoming").length;

  const accepted = friends.filter((f) => f.status === "accepted");
  const list =
    tab === "online"
      ? accepted.filter((f) => online[f.user.id] ?? f.user.online)
      : tab === "all"
        ? accepted
        : friends.filter((f) => f.status !== "accepted");

  const titles: Record<Exclude<Tab, "add">, string> = {
    online: "В сети",
    all: "Все друзья",
    pending: "Ожидание",
  };

  return (
    <section className="chat friends">
      <header className="chat-header">
        <Users size={22} className="muted" />
        <span className="chat-title">Друзья</span>
        <span className="header-sep" />
        {(["online", "all", "pending"] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {titles[t]}
            {t === "pending" && incoming > 0 && <span className="count-badge">{incoming}</span>}
          </button>
        ))}
        <button className={`tab add${tab === "add" ? " active" : ""}`} onClick={() => setTab("add")}>
          Добавить в друзья
        </button>
      </header>
      <div className="friends-body">
        {tab === "add" ? (
          <AddFriend />
        ) : (
          <>
            <div className="section-title">
              <span>
                {titles[tab]} — {list.length}
              </span>
            </div>
            {list.length === 0 && (
              <div className="empty-state">
                <p className="muted">
                  {tab === "pending"
                    ? "Нет заявок в друзья."
                    : tab === "online"
                      ? "Никого из друзей нет в сети."
                      : "Пока нет друзей. Добавьте кого-нибудь по логину!"}
                </p>
              </div>
            )}
            {list.map((f) => (
              <FriendRow key={f.user.id} friend={f} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function FriendRow({ friend }: { friend: Friend }) {
  const user = useUser(friend.user);
  const status =
    friend.status === "incoming"
      ? "Входящая заявка"
      : friend.status === "outgoing"
        ? "Исходящая заявка"
        : user.online
          ? "В сети"
          : "Не в сети";

  return (
    <div className="friend-row" onClick={() => openModal({ kind: "profile", userId: user.id })}>
      <Avatar user={user} size={36} status />
      <div className="friend-names">
        <span>
          <b>{user.displayName}</b> <span className="muted small">@{user.username}</span>
        </span>
        <span className="muted small">{status}</span>
      </div>
      <div className="friend-actions" onClick={(e) => e.stopPropagation()}>
        {friend.status === "accepted" && (
          <button className="round-btn" onClick={() => void openDm(user.id)} data-tip="Написать" aria-label="Написать">
            <MessageIcon size={18} />
          </button>
        )}
        {friend.status === "incoming" && (
          <button
            className="round-btn ok"
            onClick={() => void attempt(() => api("POST", `/api/friends/${user.id}/accept`))}
            data-tip="Принять"
            aria-label="Принять"
          >
            <Check size={18} />
          </button>
        )}
        <button
          className="round-btn bad"
          onClick={() => {
            if (friend.status === "accepted" && !confirm(`Удалить ${user.displayName} из друзей?`)) return;
            void attempt(() => api("DELETE", `/api/friends/${user.id}`));
          }}
          data-tip={friend.status === "accepted" ? "Удалить из друзей" : "Отклонить"}
          aria-label="Удалить"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => api("POST", "/api/friends", { username: username.replace(/^@/, "") }));
    setBusy(false);
    if (ok) {
      toast(`Заявка для @${username.replace(/^@/, "")} отправлена`, "info");
      setUsername("");
    }
  }

  return (
    <div className="add-friend">
      <h3>Добавить в друзья</h3>
      <p className="muted">Добавьте друга по его логину в RUdis.</p>
      <form className="add-friend-form" onSubmit={submit}>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Введите логин, например ivan_petrov"
          autoFocus
        />
        <button className="btn primary" disabled={!username.trim() || busy}>
          Отправить заявку
        </button>
      </form>
    </div>
  );
}
