import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { attempt, canManage, currentServer, loadMessages, openModal, useStore, useUser } from "../store";
import type { Channel, Message, User } from "../types";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { Hash, Users } from "./icons";

const EMPTY: Message[] = [];

function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function dayLabel(ts: number) {
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function ChatHeader({ channel, dmUser }: { channel: Channel; dmUser?: User | null }) {
  const showMembers = useStore((s) => s.showMembers);
  const user = useUser(dmUser);
  return (
    <header className="chat-header">
      {user ? (
        <>
          <Avatar user={user} size={26} status />
          <span className="chat-title">{user.displayName}</span>
          <span className="muted small">@{user.username}</span>
        </>
      ) : (
        <>
          <Hash size={22} className="muted" />
          <span className="chat-title">{channel.name}</span>
          {channel.topic && <span className="chat-topic truncate">{channel.topic}</span>}
          <span className="spacer" />
          <button
            className={`icon-btn${showMembers ? " on" : ""}`}
            onClick={() => useStore.setState({ showMembers: !showMembers })}
            data-tip={showMembers ? "Скрыть участников" : "Показать участников"}
            aria-label="Участники"
          >
            <Users size={20} />
          </button>
        </>
      )}
    </header>
  );
}

export function Chat({ channel, dmUser }: { channel: Channel; dmUser?: User | null }) {
  const bucket = useStore((s) => s.messages[channel.id]);
  const items = bucket?.items ?? EMPTY;
  const me = useStore((s) => s.me)!;
  const server = useStore((s) => currentServer(s));
  const isAdmin = canManage(server);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | undefined>(undefined);

  useEffect(() => {
    void loadMessages(channel.id);
    setReplyTo(null);
    setEditing(null);
    stick.current = true;
  }, [channel.id]);

  // Держим низ при новых сообщениях и сохраняем позицию при подгрузке старых.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = items[0]?.id;
    if (prevFirst.current && first !== prevFirst.current && !stick.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first;
    prevHeight.current = el.scrollHeight;
  }, [items]);

  // Картинки догружаются позже — если были внизу, остаёмся внизу.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [items]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200) void loadMessages(channel.id, true);
  }, [channel.id]);

  const typers = useTypers(channel.id, me.id);
  const title = dmUser ? dmUser.displayName : `#${channel.name}`;

  return (
    <section className="chat">
      <ChatHeader channel={channel} dmUser={dmUser} />
      <div className="messages" ref={scroller} onScroll={onScroll}>
        <div className="messages-inner">
          {bucket && !bucket.hasMore && (
            <div className="chat-intro">
              {dmUser ? (
                <>
                  <DmIntroAvatar user={dmUser} />
                  <h2>{dmUser.displayName}</h2>
                  <p className="muted">Это начало вашей переписки с @{dmUser.username}.</p>
                </>
              ) : (
                <>
                  <div className="intro-icon">
                    <Hash size={40} />
                  </div>
                  <h2>Добро пожаловать в #{channel.name}!</h2>
                  <p className="muted">Это самое начало канала.</p>
                </>
              )}
            </div>
          )}
          {bucket?.loading && <div className="loading-row">Загрузка…</div>}
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const grouped =
              !!prev &&
              !newDay &&
              !m.replyTo &&
              prev.author.id === m.author.id &&
              m.createdAt - prev.createdAt < 7 * 60 * 1000;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="day-divider">
                    <span>{dayLabel(m.createdAt)}</span>
                  </div>
                )}
                <MessageItem
                  message={m}
                  grouped={grouped}
                  mine={m.author.id === me.id}
                  canDelete={m.author.id === me.id || isAdmin}
                  editing={editing === m.id}
                  onEdit={() => setEditing(m.id)}
                  onEditDone={() => setEditing(null)}
                  onReply={() => setReplyTo(m)}
                  onDelete={() => {
                    if (confirm("Удалить сообщение?"))
                      void attempt(() => api("DELETE", `/api/messages/${m.id}`));
                  }}
                  onAuthorClick={() =>
                    openModal({ kind: "profile", userId: m.author.id, serverId: server?.id })
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      <Composer
        channelId={channel.id}
        placeholder={`Написать ${dmUser ? "@" + dmUser.displayName : "в " + title}`}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onEditLast={() => {
          const last = [...items].reverse().find((m) => m.author.id === me.id);
          if (last) setEditing(last.id);
        }}
      />
      <div className="typing-row">{typers}</div>
    </section>
  );
}

function DmIntroAvatar({ user }: { user: User }) {
  const u = useUser(user);
  return <Avatar user={u} size={80} />;
}

function useTypers(channelId: string, meId: string) {
  const typing = useStore((s) => s.typing[channelId]);
  const users = useStore((s) => s.users);
  const ids = Object.keys(typing ?? {}).filter((id) => id !== meId);
  if (!ids.length) return null;
  const names = ids.map((id) => users[id]?.displayName ?? "Кто-то");
  const text =
    names.length === 1
      ? `${names[0]} печатает…`
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} и ${names.at(-1)} печатают…`
        : "Несколько человек печатают…";
  return (
    <>
      <span className="typing-dots">
        <i />
        <i />
        <i />
      </span>
      {text}
    </>
  );
}
