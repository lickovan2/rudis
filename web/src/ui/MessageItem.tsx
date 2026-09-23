import { memo, useEffect, useRef, useState } from "react";
import { api, fileUrl } from "../api";
import { attempt, openModal, useStore, useUser } from "../store";
import type { Attachment, Message } from "../types";
import { Avatar } from "./Avatar";
import { EmojiPicker } from "./EmojiPicker";
import { isEmojiOnly, renderContent } from "./format";
import { Download, File, Pencil, Reply, Smile, Trash } from "./icons";
import { quickReactions } from "./emoji";

function time(ts: number) {
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fullTime(ts: number) {
  return new Date(ts).toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stamp(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Сегодня в ${time(ts)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Вчера в ${time(ts)}`;
  return `${d.toLocaleDateString("ru-RU")} ${time(ts)}`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function toggleReaction(m: Message, emoji: string, meId: string) {
  const has = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId);
  void attempt(() =>
    api(has ? "DELETE" : "PUT", `/api/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`),
  );
}

interface Props {
  message: Message;
  grouped: boolean;
  mine: boolean;
  canDelete: boolean;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onReply: () => void;
  onDelete: () => void;
  onAuthorClick: () => void;
}

export const MessageItem = memo(function MessageItem(p: Props) {
  const m = p.message;
  const author = useUser(m.author);
  const meId = useStore((s) => s.me!.id);
  const mentionsMe = useStore((s) => !!s.me && m.content.includes(`@${s.me.username}`));
  const [picker, setPicker] = useState(false);

  return (
    <div
      className={`message${p.grouped ? " grouped" : ""}${mentionsMe ? " mentioned" : ""}${picker ? " hovered" : ""}`}
      id={`msg-${m.id}`}
    >
      {m.replyTo && <ReplyPreview reply={m.replyTo} />}
      <div className="message-row">
        <div className="message-gutter">
          {p.grouped ? (
            <span className="hover-time" title={fullTime(m.createdAt)}>
              {time(m.createdAt)}
            </span>
          ) : (
            <button className="avatar-btn" onClick={p.onAuthorClick}>
              <Avatar user={author} size={40} />
            </button>
          )}
        </div>
        <div className="message-body">
          {!p.grouped && (
            <div className="message-head">
              <button className="author" onClick={p.onAuthorClick}>
                {author.displayName}
              </button>
              <span className="timestamp" title={fullTime(m.createdAt)}>
                {stamp(m.createdAt)}
              </span>
            </div>
          )}
          {p.editing ? (
            <EditBox message={m} onDone={p.onEditDone} />
          ) : (
            m.content && (
              <div className={`message-content${isEmojiOnly(m.content) ? " jumbo" : ""}`}>
                {renderContent(m.content)}
                {m.editedAt && (
                  <span className="edited" title={fullTime(m.editedAt)}>
                    {" "}
                    (изменено)
                  </span>
                )}
              </div>
            )
          )}
          {m.attachments.length > 0 && (
            <div className="attachments">
              {m.attachments.map((a) => (
                <AttachmentView key={a.url} a={a} />
              ))}
            </div>
          )}
          {m.reactions.length > 0 && (
            <div className="reactions">
              {m.reactions.map((r) => (
                <ReactionChip key={r.emoji} emoji={r.emoji} userIds={r.userIds} meId={meId} onClick={() => toggleReaction(m, r.emoji, meId)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="message-toolbar">
        {quickReactions.slice(0, 3).map((e) => (
          <button key={e} onClick={() => toggleReaction(m, e, meId)} aria-label={`Реакция ${e}`}>
            {e}
          </button>
        ))}
        <button onClick={() => setPicker(true)} data-tip="Добавить реакцию" aria-label="Добавить реакцию">
          <Smile size={18} />
        </button>
        <button onClick={p.onReply} data-tip="Ответить" aria-label="Ответить">
          <Reply size={18} />
        </button>
        {p.mine && (
          <button onClick={p.onEdit} data-tip="Изменить" aria-label="Изменить">
            <Pencil size={18} />
          </button>
        )}
        {p.canDelete && (
          <button className="danger" onClick={p.onDelete} data-tip="Удалить" aria-label="Удалить">
            <Trash size={18} />
          </button>
        )}
        {picker && (
          <EmojiPicker
            className="toolbar-picker"
            onClose={() => setPicker(false)}
            onPick={(e) => {
              setPicker(false);
              toggleReaction(m, e, meId);
            }}
          />
        )}
      </div>
    </div>
  );
});

function ReactionChip({
  emoji,
  userIds,
  meId,
  onClick,
}: {
  emoji: string;
  userIds: string[];
  meId: string;
  onClick: () => void;
}) {
  const users = useStore((s) => s.users);
  const names = userIds.map((id) => users[id]?.displayName ?? "…");
  const tip =
    names.length > 5 ? `${names.slice(0, 5).join(", ")} и ещё ${names.length - 5}` : names.join(", ");
  return (
    <button className={`reaction${userIds.includes(meId) ? " mine" : ""}`} onClick={onClick} data-tip={tip}>
      <span>{emoji}</span>
      <b>{userIds.length}</b>
    </button>
  );
}

function ReplyPreview({ reply }: { reply: NonNullable<Message["replyTo"]> }) {
  const author = useUser(reply.author);
  const jump = () => {
    const el = document.getElementById(`msg-${reply.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1500);
  };
  return (
    <div className="reply-preview" onClick={jump}>
      <span className="reply-spine" />
      {author ? (
        <>
          <Avatar user={author} size={16} />
          <b>{author.displayName}</b>
          <span className="truncate">{reply.content || "Вложение"}</span>
        </>
      ) : (
        <span className="muted">Исходное сообщение удалено</span>
      )}
    </div>
  );
}

function AttachmentView({ a }: { a: Attachment }) {
  const url = fileUrl(a.url)!;
  if (a.mime.startsWith("image/") && !a.mime.includes("svg"))
    return (
      <img
        className="attachment-image"
        src={url}
        alt={a.name}
        loading="lazy"
        onClick={() => openModal({ kind: "image", url, name: a.name })}
      />
    );
  if (a.mime.startsWith("video/"))
    return <video className="attachment-video" src={url} controls preload="metadata" />;
  if (a.mime.startsWith("audio/"))
    return (
      <div className="attachment-file">
        <div className="file-meta">
          <span className="truncate">{a.name}</span>
          <span className="muted small">{formatSize(a.size)}</span>
        </div>
        <audio src={url} controls preload="none" />
      </div>
    );
  return (
    <div className="attachment-file">
      <File size={30} className="file-icon" />
      <div className="file-meta">
        <a href={url} download={a.name} className="truncate">
          {a.name}
        </a>
        <span className="muted small">{formatSize(a.size)}</span>
      </div>
      <a href={url} download={a.name} className="icon-btn" aria-label="Скачать">
        <Download size={20} />
      </a>
    </div>
  );
}

function EditBox({ message, onDone }: { message: Message; onDone: () => void }) {
  const [value, setValue] = useState(message.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  async function save() {
    const content = value.trim();
    if (!content) return;
    if (content !== message.content)
      await attempt(() => api("PATCH", `/api/messages/${message.id}`, { content }));
    onDone();
  }

  return (
    <div className="edit-box">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="edit-hint">
        Esc — <button className="link" onClick={onDone}>отмена</button> • Enter —{" "}
        <button className="link" onClick={() => void save()}>сохранить</button>
      </div>
    </div>
  );
}
