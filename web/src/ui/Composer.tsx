import { useEffect, useRef, useState } from "react";
import { api, uploadFile } from "../api";
import { getSocket } from "../socket";
import { toast, useUser } from "../store";
import type { Attachment, Message } from "../types";
import { EmojiPicker } from "./EmojiPicker";
import { File as FileIcon, Paperclip, Smile, X } from "./icons";
import { formatSize } from "./MessageItem";

interface Pending {
  id: number;
  file: File;
  progress: number;
  preview?: string;
  result?: Attachment;
  failed?: boolean;
}

const drafts = new Map<string, string>();
let pendingSeq = 0;

export function Composer({
  channelId,
  placeholder,
  replyTo,
  onCancelReply,
  onEditLast,
}: {
  channelId: string;
  placeholder: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onEditLast: () => void;
}) {
  const [text, setText] = useState(() => drafts.get(channelId) ?? "");
  const [files, setFiles] = useState<Pending[]>([]);
  const [picker, setPicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const replyAuthor = useUser(replyTo?.author);

  useEffect(() => {
    setText(drafts.get(channelId) ?? "");
    setFiles([]);
    ref.current?.focus();
  }, [channelId]);

  useEffect(() => {
    drafts.set(channelId, text);
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
    }
  }, [text, channelId]);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).slice(0, 10 - files.length);
    for (const file of incoming) {
      if (file.size > 25 * 1024 * 1024) {
        toast(`«${file.name}» больше 25 МБ`);
        continue;
      }
      const id = ++pendingSeq;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setFiles((f) => [...f, { id, file, progress: 0, preview }]);
      uploadFile(file, (p) => setFiles((f) => f.map((x) => (x.id === id ? { ...x, progress: p } : x))))
        .then((result) => setFiles((f) => f.map((x) => (x.id === id ? { ...x, result, progress: 1 } : x))))
        .catch((e) => {
          toast((e as Error).message);
          setFiles((f) => f.map((x) => (x.id === id ? { ...x, failed: true } : x)));
        });
    }
  }

  // Перетаскивание файлов в любое место окна.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  function removeFile(id: number) {
    setFiles((f) => {
      const x = f.find((p) => p.id === id);
      if (x?.preview) URL.revokeObjectURL(x.preview);
      return f.filter((p) => p.id !== id);
    });
  }

  const uploading = files.some((f) => !f.result && !f.failed);

  async function send() {
    const content = text.trim();
    const attachments = files.filter((f) => f.result).map((f) => f.result!);
    if ((!content && !attachments.length) || uploading || sending) return;
    if (content.length > 4000) return toast("Сообщение длиннее 4000 символов");
    setSending(true);
    try {
      await api("POST", `/api/channels/${channelId}/messages`, {
        content,
        attachments,
        replyTo: replyTo?.id ?? null,
      });
      setText("");
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
      onCancelReply();
      lastTyping.current = 0;
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  }

  function onType(value: string) {
    setText(value);
    const now = Date.now();
    if (value && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      getSocket()?.emit("typing", { channelId });
    }
  }

  function insert(s: string) {
    const el = ref.current;
    if (!el) return setText((t) => t + s);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + s.length, start + s.length);
    });
  }

  return (
    <div className="composer-wrap">
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Paperclip size={40} />
            <p>Отпустите, чтобы прикрепить файлы</p>
          </div>
        </div>
      )}
      {replyTo && (
        <div className="reply-banner">
          <span>
            Ответ пользователю <b>{replyAuthor?.displayName}</b>
          </span>
          <button className="icon-btn small" onClick={onCancelReply} aria-label="Отменить ответ">
            <X size={16} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((f) => (
            <div key={f.id} className={`pending-file${f.failed ? " failed" : ""}`}>
              {f.preview ? <img src={f.preview} alt="" /> : <FileIcon size={36} />}
              <span className="truncate small">{f.file.name}</span>
              <span className="muted small">{f.failed ? "Ошибка" : formatSize(f.file.size)}</span>
              {!f.result && !f.failed && (
                <div className="progress">
                  <i style={{ width: `${Math.round(f.progress * 100)}%` }} />
                </div>
              )}
              <button className="remove" onClick={() => removeFile(f.id)} aria-label="Убрать файл">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={`composer${replyTo || files.length ? " attached" : ""}`}>
        <button className="icon-btn" onClick={() => fileInput.current?.click()} data-tip="Прикрепить файл" aria-label="Прикрепить файл">
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          maxLength={4000}
          onChange={(e) => onType(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            } else if (e.key === "ArrowUp" && !text) {
              e.preventDefault();
              onEditLast();
            } else if (e.key === "Escape" && replyTo) {
              onCancelReply();
            }
          }}
        />
        <div className="picker-anchor">
          <button className="icon-btn" onClick={() => setPicker((v) => !v)} data-tip="Эмодзи" aria-label="Эмодзи">
            <Smile size={22} />
          </button>
          {picker && (
            <EmojiPicker
              className="composer-picker"
              onClose={() => setPicker(false)}
              onPick={(e) => insert(e)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
