import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, fileUrl, uploadFile } from "../api";
import {
  addServer,
  attempt,
  closeModal,
  logout,
  navigate,
  toast,
  useStore,
  useUser,
  type Modal,
} from "../store";
import type { Channel, Member, Server, User } from "../types";
import {
  listDevices,
  setInputDevice,
  setOutputDevice,
  setUserVolume,
  useVoice,
} from "../voice";
import { Avatar, ServerIcon } from "./Avatar";
import { openDm } from "./Friends";
import { Crown, Download, Hash, Speaker, X } from "./icons";

export function ModalRoot() {
  const modal = useStore((s) => s.modal);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  if (!modal) return null;
  return <ModalSwitch modal={modal} />;
}

function ModalSwitch({ modal }: { modal: Modal }) {
  switch (modal.kind) {
    case "createServer":
      return <CreateServer />;
    case "joinServer":
      return <JoinServer code={modal.code} />;
    case "createChannel":
      return <CreateChannel serverId={modal.serverId} initialType={modal.type} />;
    case "invite":
      return <Invite serverId={modal.serverId} />;
    case "serverSettings":
      return <ServerSettings serverId={modal.serverId} />;
    case "channelSettings":
      return <ChannelSettings channelId={modal.channelId} />;
    case "userSettings":
      return <UserSettings />;
    case "profile":
      return <Profile userId={modal.userId} serverId={modal.serverId} />;
    case "image":
      return <ImageViewer url={modal.url} name={modal.name} />;
  }
}

function Shell({
  title,
  subtitle,
  children,
  footer,
  className = "",
  onSubmit,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  onSubmit?: (e: FormEvent) => void;
}) {
  const body = (
    <>
      <button type="button" className="modal-close icon-btn" onClick={closeModal} aria-label="Закрыть">
        <X size={22} />
      </button>
      {title && (
        <div className="modal-head">
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      )}
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </>
  );
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      {onSubmit ? (
        <form className={`modal ${className}`} onSubmit={onSubmit}>
          {body}
        </form>
      ) : (
        <div className={`modal ${className}`}>{body}</div>
      )}
    </div>
  );
}

/** Круглая кнопка загрузки картинки (иконка сервера, аватар). */
function ImageUpload({
  value,
  onChange,
  fallback,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  fallback: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="image-upload">
      <button type="button" className="image-upload-btn" onClick={() => input.current?.click()} disabled={busy}>
        {value ? <img src={fileUrl(value)} alt="" /> : fallback}
        <span className="image-upload-hint">{busy ? "…" : "Изменить"}</span>
      </button>
      {value && (
        <button type="button" className="link small" onClick={() => onChange(null)}>
          Убрать
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          const res = await attempt(() => uploadFile(file));
          setBusy(false);
          if (res) onChange(res.url);
        }}
      />
    </div>
  );
}

// --- Серверы ---

function CreateServer() {
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState(`Сервер ${me.displayName}`);
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const server = await attempt(() => api<Server>("POST", "/api/servers", { name, icon }));
    setBusy(false);
    if (!server) return;
    addServer(server);
    closeModal();
    navigate(server.id);
  }

  return (
    <Shell
      title="Создайте свой сервер"
      subtitle="Сервер — место, где вы общаетесь с друзьями. Создайте свой и начните разговор."
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="link" onClick={() => useStore.setState({ modal: { kind: "joinServer" } })}>
            Есть приглашение?
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Создать
          </button>
        </>
      }
    >
      <ImageUpload value={icon} onChange={setIcon} fallback={<span className="upload-plus">＋</span>} />
      <label>
        <span>Название сервера</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
      </label>
    </Shell>
  );
}

interface InvitePreview {
  code: string;
  server: { id: string; name: string; icon: string | null; memberCount: number };
  joined: boolean;
}

function JoinServer({ code: initial }: { code?: string }) {
  const [code, setCode] = useState(initial ?? "");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(value: string) {
    setError("");
    setPreview(null);
    const clean = value.trim().replace(/^.*\//, "");
    if (!clean) return;
    try {
      setPreview(await api<InvitePreview>("GET", `/api/invites/${encodeURIComponent(clean)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (initial) void check(initial);
  }, [initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview) return check(code);
    setBusy(true);
    const server = await attempt(() => api<Server>("POST", `/api/invites/${preview.code}/join`));
    setBusy(false);
    if (!server) return;
    addServer(server);
    closeModal();
    navigate(server.id);
  }

  return (
    <Shell
      title="Присоединиться к серверу"
      subtitle="Введите приглашение, чтобы вступить на существующий сервер."
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="link" onClick={() => useStore.setState({ modal: { kind: "createServer" } })}>
            Создать свой сервер
          </button>
          <button className="btn primary" disabled={busy || !code.trim()}>
            {preview ? (preview.joined ? "Перейти" : "Вступить") : "Проверить"}
          </button>
        </>
      }
    >
      <label>
        <span>Ссылка-приглашение</span>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setPreview(null);
          }}
          onBlur={() => code && !preview && void check(code)}
          placeholder="https://…/invite/hTKzmak или hTKzmak"
          autoFocus
        />
      </label>
      {error && <div className="form-error">{error}</div>}
      {preview && (
        <div className="invite-preview">
          <ServerIcon server={preview.server} size={56} />
          <div>
            <b>{preview.server.name}</b>
            <p className="muted small">
              Участников: {preview.server.memberCount}
              {preview.joined && " • вы уже здесь"}
            </p>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Invite({ serverId }: { serverId: string }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void attempt(() => api<{ code: string }>("POST", `/api/servers/${serverId}/invites`)).then(
      (r) => r && setCode(r.code),
    );
  }, [serverId]);

  const link = code ? `${location.origin}/invite/${code}` : "Создаём приглашение…";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Не удалось скопировать — выделите ссылку вручную");
    }
  }

  return (
    <Shell title={`Пригласить друзей на «${server?.name ?? ""}»`}>
      <label>
        <span>Отправьте другу ссылку-приглашение</span>
        <div className="copy-row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className={`btn ${copied ? "success" : "primary"}`} onClick={copy} disabled={!code}>
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      </label>
      <p className="muted small">Приглашение бессрочное. Код можно ввести и вручную: {code}</p>
    </Shell>
  );
}

function ServerSettings({ serverId }: { serverId: string }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const [name, setName] = useState(server?.name ?? "");
  const [icon, setIcon] = useState<string | null>(server?.icon ?? null);
  const [busy, setBusy] = useState(false);
  if (!server) return null;
  const isOwner = server.role === "owner";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => api("PATCH", `/api/servers/${serverId}`, { name, icon }));
    setBusy(false);
    if (ok) closeModal();
  }

  async function remove() {
    const typed = prompt(`Это нельзя отменить. Введите название сервера «${server!.name}», чтобы удалить его:`);
    if (typed === null) return;
    if (typed.trim() !== server!.name) return toast("Название не совпадает");
    const ok = await attempt(() => api("DELETE", `/api/servers/${serverId}`));
    if (ok) {
      closeModal();
      navigate(null);
    }
  }

  return (
    <Shell
      title="Настройки сервера"
      onSubmit={save}
      footer={
        <>
          {isOwner ? (
            <button type="button" className="btn danger-outline" onClick={remove}>
              Удалить сервер
            </button>
          ) : (
            <span />
          )}
          <button className="btn primary" disabled={busy || !name.trim()}>
            Сохранить
          </button>
        </>
      }
    >
      <ImageUpload value={icon} onChange={setIcon} fallback={<ServerIcon server={{ ...server, icon: null }} size={80} />} />
      <label>
        <span>Название сервера</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </label>
    </Shell>
  );
}

// --- Каналы ---

function CreateChannel({ serverId, initialType }: { serverId: string; initialType: "text" | "voice" }) {
  const [type, setType] = useState(initialType);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ch = await attempt(() => api<Channel>("POST", `/api/servers/${serverId}/channels`, { name, type }));
    setBusy(false);
    if (!ch) return;
    closeModal();
    if (ch.type === "text") navigate(serverId, ch.id);
  }

  return (
    <Shell
      title="Создать канал"
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="link" onClick={closeModal}>
            Отмена
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Создать канал
          </button>
        </>
      }
    >
      <div className="type-picker">
        <button type="button" className={type === "text" ? "active" : ""} onClick={() => setType("text")}>
          <Hash size={24} />
          <div>
            <b>Текстовый</b>
            <span className="muted small">Сообщения, картинки, эмодзи и мнения</span>
          </div>
        </button>
        <button type="button" className={type === "voice" ? "active" : ""} onClick={() => setType("voice")}>
          <Speaker size={24} />
          <div>
            <b>Голосовой</b>
            <span className="muted small">Общайтесь голосом</span>
          </div>
        </button>
      </div>
      <label>
        <span>Название канала</span>
        <input
          value={name}
          onChange={(e) => setName(type === "text" ? e.target.value.replace(/\s/g, "-").toLowerCase() : e.target.value)}
          placeholder={type === "text" ? "новый-канал" : "Болталка"}
          maxLength={48}
          autoFocus
        />
      </label>
    </Shell>
  );
}

function ChannelSettings({ channelId }: { channelId: string }) {
  const channel = useStore((s) =>
    s.servers.flatMap((x) => x.channels).find((c) => c.id === channelId),
  );
  const [name, setName] = useState(channel?.name ?? "");
  const [topic, setTopic] = useState(channel?.topic ?? "");
  if (!channel) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const ok = await attempt(() =>
      api("PATCH", `/api/channels/${channelId}`, channel!.type === "text" ? { name, topic } : { name }),
    );
    if (ok) closeModal();
  }

  async function remove() {
    if (!confirm(`Удалить канал «${channel!.name}»? Все сообщения в нём пропадут.`)) return;
    const ok = await attempt(() => api("DELETE", `/api/channels/${channelId}`));
    if (ok) closeModal();
  }

  return (
    <Shell
      title="Настройки канала"
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn danger-outline" onClick={remove}>
            Удалить канал
          </button>
          <button className="btn primary" disabled={!name.trim()}>
            Сохранить
          </button>
        </>
      }
    >
      <label>
        <span>Название канала</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus />
      </label>
      {channel.type === "text" && (
        <label>
          <span>Тема канала</span>
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={256} rows={3} placeholder="О чём этот канал" />
        </label>
      )}
    </Shell>
  );
}

// --- Пользователь ---

function UserSettings() {
  const me = useStore((s) => s.me)!;
  const [displayName, setDisplayName] = useState(me.displayName);
  const [about, setAbout] = useState(me.about);
  const [avatar, setAvatar] = useState<string | null>(me.avatar);
  const [busy, setBusy] = useState(false);
  const { inputDeviceId, outputDeviceId } = useVoice();
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  });
  const [notif, setNotif] = useState(
    "Notification" in window ? Notification.permission : ("denied" as NotificationPermission),
  );

  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const user = await attempt(() => api<User>("PATCH", "/api/me", { displayName, about, avatar }));
    setBusy(false);
    if (user) {
      useStore.setState({ me: user });
      closeModal();
    }
  }

  const label = (d: MediaDeviceInfo, i: number) =>
    d.label || (d.deviceId === "default" ? "По умолчанию" : `Устройство ${i + 1}`);

  return (
    <Shell
      title="Мой профиль"
      className="wide"
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn danger-outline" onClick={logout}>
            Выйти из аккаунта
          </button>
          <button className="btn primary" disabled={busy || !displayName.trim()}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <div>
          <ImageUpload value={avatar} onChange={setAvatar} fallback={<Avatar user={{ ...me, avatar: null }} size={80} />} />
          <p className="muted small center">@{me.username}</p>
        </div>
        <div className="settings-fields">
          <label>
            <span>Отображаемое имя</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} />
          </label>
          <label>
            <span>Обо мне</span>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={190} rows={3} placeholder="Пара слов о себе" />
          </label>
        </div>
      </div>

      <h3 className="settings-section">Голос</h3>
      {devices.inputs.length === 0 && (
        <p className="muted small">Список устройств появится после первого подключения к голосовому каналу.</p>
      )}
      <div className="settings-row">
        <label>
          <span>Микрофон</span>
          <select value={inputDeviceId} onChange={(e) => void setInputDevice(e.target.value)}>
            <option value="default">По умолчанию</option>
            {devices.inputs
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {label(d, i)}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>Динамики</span>
          <select value={outputDeviceId} onChange={(e) => setOutputDevice(e.target.value)}>
            <option value="default">По умолчанию</option>
            {devices.outputs
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {label(d, i)}
                </option>
              ))}
          </select>
        </label>
      </div>

      <h3 className="settings-section">Уведомления</h3>
      {notif === "granted" ? (
        <p className="muted small">Уведомления о личных сообщениях и упоминаниях включены.</p>
      ) : notif === "denied" ? (
        <p className="muted small">Уведомления запрещены в настройках браузера.</p>
      ) : (
        <button
          type="button"
          className="btn secondary"
          onClick={() => void Notification.requestPermission().then(setNotif)}
        >
          Включить уведомления
        </button>
      )}
    </Shell>
  );
}

const EMPTY_MEMBERS: Member[] = [];

function Profile({ userId, serverId }: { userId: string; serverId?: string }) {
  const me = useStore((s) => s.me)!;
  const cached = useStore((s) => s.users[userId]);
  const [fetched, setFetched] = useState<User | null>(null);
  const user = useUser(cached ?? fetched);
  const friend = useStore((s) => s.friends.find((f) => f.user.id === userId));
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const members = useStore((s) => (serverId ? s.members[serverId] ?? EMPTY_MEMBERS : EMPTY_MEMBERS));
  const member = members.find((m) => m.user.id === userId);
  const inVoiceWithMe = useVoice((s) => {
    if (!s.channelId || !server) return false;
    return (server.voiceStates[s.channelId] ?? []).some((v) => v.userId === userId);
  });
  const volume = useVoice((s) => s.volume[userId] ?? 1);

  useEffect(() => {
    if (!cached) void attempt(() => api<User>("GET", `/api/users/${userId}`)).then((u) => u && setFetched(u));
  }, [userId, cached]);

  if (!user) return null;
  const isMe = user.id === me.id;
  const myRole = server?.role;
  const canKick =
    !!member &&
    !isMe &&
    member.role !== "owner" &&
    (myRole === "owner" || (myRole === "admin" && member.role === "member"));

  return (
    <Shell className="profile-modal">
      <div className="profile-banner" />
      <div className="profile-avatar">
        <Avatar user={user} size={92} status />
      </div>
      <div className="profile-card">
        <h2>
          {user.displayName}
          {member?.role === "owner" && (
            <span className="crown" data-tip="Владелец сервера">
              {" "}
              <Crown size={16} />
            </span>
          )}
        </h2>
        <p className="muted">@{user.username}</p>
        {member && member.role !== "member" && (
          <span className="role-chip">{member.role === "owner" ? "Владелец" : "Администратор"}</span>
        )}
        {user.about && (
          <>
            <h4>Обо мне</h4>
            <p className="profile-about">{user.about}</p>
          </>
        )}
        {member && (
          <>
            <h4>На сервере с</h4>
            <p className="muted small">{new Date(member.joinedAt).toLocaleDateString("ru-RU")}</p>
          </>
        )}
        {inVoiceWithMe && !isMe && (
          <>
            <h4>Громкость</h4>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={volume}
              onChange={(e) => setUserVolume(userId, Number(e.target.value))}
            />
          </>
        )}
        <div className="profile-actions">
          {!isMe && (
            <button className="btn primary" onClick={() => void openDm(user.id)}>
              Написать сообщение
            </button>
          )}
          {!isMe && !friend && (
            <button
              className="btn secondary"
              onClick={async () => {
                const ok = await attempt(() => api("POST", "/api/friends", { username: user.username }));
                if (ok) toast("Заявка в друзья отправлена", "info");
              }}
            >
              Добавить в друзья
            </button>
          )}
          {friend?.status === "incoming" && (
            <button
              className="btn secondary"
              onClick={() => void attempt(() => api("POST", `/api/friends/${user.id}/accept`))}
            >
              Принять заявку
            </button>
          )}
          {isMe && (
            <button className="btn secondary" onClick={() => useStore.setState({ modal: { kind: "userSettings" } })}>
              Редактировать профиль
            </button>
          )}
        </div>
        {server && member && !isMe && (myRole === "owner" || canKick) && (
          <div className="profile-admin">
            {myRole === "owner" && member.role !== "owner" && (
              <button
                className="btn secondary small"
                onClick={() =>
                  void attempt(() =>
                    api("PATCH", `/api/servers/${server.id}/members/${user.id}`, {
                      role: member.role === "admin" ? "member" : "admin",
                    }),
                  )
                }
              >
                {member.role === "admin" ? "Снять администратора" : "Сделать администратором"}
              </button>
            )}
            {canKick && (
              <button
                className="btn danger-outline small"
                onClick={async () => {
                  if (!confirm(`Исключить ${user.displayName} с сервера?`)) return;
                  const ok = await attempt(() => api("DELETE", `/api/servers/${server.id}/members/${user.id}`));
                  if (ok) closeModal();
                }}
              >
                Исключить с сервера
              </button>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

function ImageViewer({ url, name }: { url: string; name: string }) {
  return (
    <div className="modal-overlay image-viewer" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <img src={url} alt={name} />
      <div className="image-viewer-bar">
        <span className="truncate">{name}</span>
        <a href={url} download={name} className="icon-btn" aria-label="Скачать">
          <Download size={20} />
        </a>
        <button className="icon-btn" onClick={closeModal} aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
