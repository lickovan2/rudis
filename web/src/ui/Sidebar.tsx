import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  attempt,
  canManage,
  currentServer,
  navigate,
  openModal,
  sortChannels,
  useStore,
  useUser,
} from "../store";
import type { Channel, DmChannel, Server, VoiceMember } from "../types";
import { noiseModes } from "../noise";
import { joinVoice, leaveVoice, toggleDeafen, toggleMute, toggleNoise, useVoice } from "../voice";
import { Avatar } from "./Avatar";
import {
  ChevronDown,
  Gear,
  Hash,
  Headphones,
  HeadphonesOff,
  Link,
  LogOut,
  Mic,
  Noise,
  MicOff,
  PhoneOff,
  Plus,
  Speaker,
  Trash,
  Users,
  X,
} from "./icons";

export function Sidebar() {
  const server = useStore((s) => currentServer(s));
  return (
    <aside className="sidebar">
      {server ? <ServerSidebar server={server} /> : <DmSidebar />}
      <VoicePanel />
      <UserPanel />
    </aside>
  );
}

// --- Сервер ---

function ServerMenu({ server, onClose }: { server: Server; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const me = useStore((s) => s.me)!;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div className="dropdown" ref={ref}>
      <button onClick={act(() => openModal({ kind: "invite", serverId: server.id }))} className="accent">
        Пригласить людей <Link size={16} />
      </button>
      {canManage(server) && (
        <>
          <button onClick={act(() => openModal({ kind: "serverSettings", serverId: server.id }))}>
            Настройки сервера <Gear size={16} />
          </button>
          <button onClick={act(() => openModal({ kind: "createChannel", serverId: server.id, type: "text" }))}>
            Создать канал <Plus size={16} />
          </button>
        </>
      )}
      <div className="dropdown-sep" />
      {server.role === "owner" ? (
        <button
          className="danger"
          onClick={act(() => openModal({ kind: "serverSettings", serverId: server.id }))}
        >
          Удалить сервер <Trash size={16} />
        </button>
      ) : (
        <button
          className="danger"
          onClick={act(async () => {
            if (!confirm(`Покинуть сервер «${server.name}»?`)) return;
            const ok = await attempt(() => api("DELETE", `/api/servers/${server.id}/members/${me.id}`));
            if (ok) navigate(null);
          })}
        >
          Покинуть сервер <LogOut size={16} />
        </button>
      )}
    </div>
  );
}

function ServerSidebar({ server }: { server: Server }) {
  const [menu, setMenu] = useState(false);
  const route = useStore((s) => s.route);
  const unread = useStore((s) => s.unread);
  const channels = sortChannels(server.channels);
  const text = channels.filter((c) => c.type === "text");
  const voice = channels.filter((c) => c.type === "voice");
  const admin = canManage(server);

  return (
    <>
      <header className="sidebar-header server-header" onClick={() => setMenu((v) => !v)}>
        <span className="truncate">{server.name}</span>
        {menu ? <X size={18} /> : <ChevronDown size={18} />}
      </header>
      {menu && <ServerMenu server={server} onClose={() => setMenu(false)} />}
      <div className="sidebar-scroll">
        <Section
          title="Текстовые каналы"
          onAdd={admin ? () => openModal({ kind: "createChannel", serverId: server.id, type: "text" }) : undefined}
        >
          {text.map((c) => (
            <ChannelItem
              key={c.id}
              channel={c}
              active={route.channelId === c.id}
              unread={!!unread[c.id]}
              admin={admin}
              onClick={() => navigate(server.id, c.id)}
            />
          ))}
        </Section>
        <Section
          title="Голосовые каналы"
          onAdd={admin ? () => openModal({ kind: "createChannel", serverId: server.id, type: "voice" }) : undefined}
        >
          {voice.map((c) => (
            <div key={c.id}>
              <ChannelItem
                channel={c}
                active={route.channelId === c.id}
                admin={admin}
                onClick={() => {
                  navigate(server.id, c.id);
                  void joinVoice(c.id, server.id);
                }}
              />
              <VoiceMembers members={server.voiceStates[c.id] ?? []} serverId={server.id} />
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="channel-section">
      <div className="section-title">
        <span>{title}</span>
        {onAdd && (
          <button className="icon-btn small" onClick={onAdd} data-tip="Создать канал" aria-label="Создать канал">
            <Plus size={16} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ChannelItem({
  channel,
  active,
  unread,
  admin,
  onClick,
}: {
  channel: Channel;
  active: boolean;
  unread?: boolean;
  admin: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`channel-item${active ? " active" : ""}${unread ? " unread" : ""}`} onClick={onClick}>
      {channel.type === "voice" ? <Speaker size={18} /> : <Hash size={18} />}
      <span className="truncate">{channel.name}</span>
      {admin && (
        <button
          className="icon-btn small hover-only"
          aria-label="Настроить канал"
          onClick={(e) => {
            e.stopPropagation();
            openModal({ kind: "channelSettings", channelId: channel.id });
          }}
        >
          <Gear size={14} />
        </button>
      )}
    </div>
  );
}

function VoiceMembers({ members, serverId }: { members: VoiceMember[]; serverId: string }) {
  if (!members.length) return null;
  return (
    <div className="voice-members">
      {members.map((m) => (
        <VoiceMemberRow key={m.socketId} member={m} serverId={serverId} />
      ))}
    </div>
  );
}

function VoiceMemberRow({ member, serverId }: { member: VoiceMember; serverId: string }) {
  const me = useStore((s) => s.me);
  const cached = useStore((s) => s.users[member.userId]);
  const user = useUser(cached);
  const speaking = useVoice((s) => {
    const key = member.userId === me?.id ? "me" : member.userId;
    return s.channelId ? !!s.speaking[key] : false;
  });
  if (!user) return null;
  return (
    <div className="voice-member" onClick={() => openModal({ kind: "profile", userId: user.id, serverId })}>
      <Avatar user={user} size={22} speaking={speaking && !member.muted} />
      <span className="truncate">{user.displayName}</span>
      <span className="voice-flags">
        {member.muted && <MicOff size={14} />}
        {member.deafened && <HeadphonesOff size={14} />}
      </span>
    </div>
  );
}

// --- Личные сообщения ---

function DmSidebar() {
  const dms = useStore((s) => s.dms);
  const route = useStore((s) => s.route);
  const pending = useStore((s) => s.friends.filter((f) => f.status === "incoming").length);

  return (
    <>
      <header className="sidebar-header">
        <span className="muted">Личные сообщения</span>
      </header>
      <div className="sidebar-scroll">
        <div
          className={`channel-item big${route.serverId === null && !route.channelId ? " active" : ""}`}
          onClick={() => navigate(null, null)}
        >
          <Users size={20} />
          <span>Друзья</span>
          {pending > 0 && <span className="count-badge">{pending}</span>}
        </div>
        <div className="section-title">
          <span>Личные сообщения</span>
        </div>
        {dms.length === 0 && <p className="sidebar-empty">Здесь появятся ваши переписки.</p>}
        {dms.map((d) => (
          <DmItem key={d.id} dm={d} active={route.channelId === d.id} />
        ))}
      </div>
    </>
  );
}

function DmItem({ dm, active }: { dm: DmChannel; active: boolean }) {
  const user = useUser(dm.recipients[0]);
  const unread = useStore((s) => s.unread[dm.id] ?? 0);
  if (!user) return null;
  return (
    <div className={`channel-item dm${active ? " active" : ""}${unread ? " unread" : ""}`} onClick={() => navigate(null, dm.id)}>
      <Avatar user={user} size={32} status />
      <span className="truncate">{user.displayName}</span>
      {unread > 0 && <span className="count-badge">{unread}</span>}
    </div>
  );
}

// --- Нижние панели ---

export function NoiseButton({ className = "icon-btn", size = 20 }: { className?: string; size?: number }) {
  const noiseMode = useVoice((s) => s.noiseMode);
  const on = noiseMode !== "off";
  const label = noiseModes.find((m) => m.value === noiseMode)?.label ?? "";
  return (
    <button
      className={`${className}${on ? " on" : ""} noise-btn`}
      onClick={toggleNoise}
      data-tip={on ? `Шумоподавление: ${label}` : "Шумоподавление выключено"}
      aria-label="Шумоподавление"
      aria-pressed={on}
    >
      <Noise size={size} off={!on} />
    </button>
  );
}

function VoicePanel() {
  const channelId = useVoice((s) => s.channelId);
  const serverId = useVoice((s) => s.serverId);
  const status = useVoice((s) => s.status);
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!channelId || !server) return null;
  return (
    <div className="voice-panel">
      <div className="voice-panel-info" onClick={() => navigate(server.id, channelId)}>
        <span className={`voice-status ${status}`}>
          {status === "connected" ? "Голос подключён" : "Подключение…"}
        </span>
        <span className="truncate muted small">
          {channel?.name} / {server.name}
        </span>
      </div>
      <NoiseButton />
      <button className="icon-btn" onClick={() => leaveVoice()} data-tip="Отключиться" aria-label="Отключиться">
        <PhoneOff size={20} />
      </button>
    </div>
  );
}

function UserPanel() {
  const me = useUser(useStore((s) => s.me));
  const connected = useStore((s) => s.connected);
  const { muted, deafened } = useVoice();
  if (!me) return null;
  return (
    <div className="user-panel">
      <div className="user-panel-me" onClick={() => openModal({ kind: "userSettings" })}>
        <Avatar user={{ ...me, online: connected }} size={32} status />
        <div className="user-panel-names">
          <span className="truncate">{me.displayName}</span>
          <span className="truncate muted small">{connected ? `@${me.username}` : "Нет соединения…"}</span>
        </div>
      </div>
      <button
        className={`icon-btn${muted || deafened ? " danger" : ""}`}
        onClick={toggleMute}
        data-tip={muted ? "Включить микрофон" : "Выключить микрофон"}
        aria-label="Микрофон"
      >
        {muted || deafened ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        className={`icon-btn${deafened ? " danger" : ""}`}
        onClick={toggleDeafen}
        data-tip={deafened ? "Включить звук" : "Выключить звук"}
        aria-label="Звук"
      >
        {deafened ? <HeadphonesOff size={18} /> : <Headphones size={18} />}
      </button>
      <button className="icon-btn" onClick={() => openModal({ kind: "userSettings" })} data-tip="Настройки" aria-label="Настройки">
        <Gear size={18} />
      </button>
    </div>
  );
}
