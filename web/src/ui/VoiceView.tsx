import { openModal, useStore, useUser } from "../store";
import type { Channel, Server, VoiceMember } from "../types";
import { joinVoice, leaveVoice, toggleDeafen, toggleMute, useVoice } from "../voice";
import { Avatar } from "./Avatar";
import { NoiseButton } from "./Sidebar";
import { Headphones, HeadphonesOff, Mic, MicOff, PhoneOff, Speaker } from "./icons";

export function VoiceView({ channel, server }: { channel: Channel; server: Server }) {
  const voice = useVoice();
  const members = server.voiceStates[channel.id] ?? [];
  const inHere = voice.channelId === channel.id;

  return (
    <section className="chat voice-view">
      <header className="chat-header">
        <Speaker size={22} className="muted" />
        <span className="chat-title">{channel.name}</span>
      </header>
      <div className="voice-stage">
        {members.length === 0 ? (
          <div className="voice-empty">
            <Speaker size={48} />
            <h2>{channel.name}</h2>
            <p className="muted">В канале пока никого нет.</p>
          </div>
        ) : (
          <div className="voice-grid">
            {members.map((m) => (
              <VoiceTile key={m.socketId} member={m} serverId={server.id} />
            ))}
          </div>
        )}
      </div>
      <div className="voice-controls">
        {inHere ? (
          <>
            <button
              className={`round-btn big${voice.muted || voice.deafened ? " bad" : ""}`}
              onClick={toggleMute}
              data-tip={voice.muted ? "Включить микрофон" : "Выключить микрофон"}
              aria-label="Микрофон"
            >
              {voice.muted || voice.deafened ? <MicOff /> : <Mic />}
            </button>
            <button
              className={`round-btn big${voice.deafened ? " bad" : ""}`}
              onClick={toggleDeafen}
              data-tip={voice.deafened ? "Включить звук" : "Выключить звук"}
              aria-label="Звук"
            >
              {voice.deafened ? <HeadphonesOff /> : <Headphones />}
            </button>
            <NoiseButton className="round-btn big" size={24} />
            <button className="round-btn big hangup" onClick={() => leaveVoice()} data-tip="Отключиться" aria-label="Отключиться">
              <PhoneOff />
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => void joinVoice(channel.id, server.id)}>
            Присоединиться к голосовому каналу
          </button>
        )}
      </div>
    </section>
  );
}

function VoiceTile({ member, serverId }: { member: VoiceMember; serverId: string }) {
  const me = useStore((s) => s.me);
  const user = useUser(useStore((s) => s.users[member.userId]));
  const speaking = useVoice((s) => !!s.speaking[member.userId === me?.id ? "me" : member.userId]);
  const link = useVoice((s) => (s.channelId ? s.links[member.socketId] : undefined));
  if (!user) return null;
  const talking = speaking && !member.muted;
  const linkLabel =
    link === "failed" || link === "disconnected"
      ? "Нет соединения"
      : link === "new" || link === "connecting"
        ? "Соединение…"
        : null;
  return (
    <div
      className={`voice-tile${talking ? " talking" : ""}`}
      data-link={link ?? "self"}
      onClick={() => openModal({ kind: "profile", userId: user.id, serverId })}
    >
      {linkLabel && <span className="voice-link">{linkLabel}</span>}
      <Avatar user={user} size={88} />
      <div className="voice-tile-name">
        <span className="truncate">{user.displayName}</span>
        {member.muted && <MicOff size={16} />}
        {member.deafened && <HeadphonesOff size={16} />}
      </div>
    </div>
  );
}
