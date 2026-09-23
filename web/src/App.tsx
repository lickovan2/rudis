import { useEffect } from "react";
import { bootstrap, currentServer, useStore } from "./store";
import { Auth } from "./ui/Auth";
import { Chat } from "./ui/Chat";
import { Friends } from "./ui/Friends";
import { MemberList } from "./ui/MemberList";
import { ModalRoot } from "./ui/Modals";
import { ServerRail } from "./ui/ServerRail";
import { Sidebar } from "./ui/Sidebar";
import { VoiceView } from "./ui/VoiceView";
import { Logo } from "./ui/icons";
import { getToken } from "./api";

export function App() {
  const me = useStore((s) => s.me);
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    if (getToken()) void bootstrap();
    else useStore.setState({ ready: true });
  }, []);

  if (!ready)
    return (
      <div className="splash">
        <Logo size={64} />
        <p className="muted">Загружаем RUdis…</p>
      </div>
    );

  return (
    <>
      {me ? <Main /> : <Auth />}
      <ModalRoot />
      <Toasts />
    </>
  );
}

function Main() {
  const connected = useStore((s) => s.connected);
  return (
    <div className="app">
      {!connected && <div className="offline-bar">Соединение потеряно — переподключаемся…</div>}
      <div className="layout">
        <ServerRail />
        <Sidebar />
        <Content />
      </div>
    </div>
  );
}

function Content() {
  const route = useStore((s) => s.route);
  const server = useStore((s) => currentServer(s));
  const dm = useStore((s) => (route.serverId ? null : s.dms.find((d) => d.id === route.channelId)));
  const showMembers = useStore((s) => s.showMembers);

  useEffect(() => {
    const unread = Object.values(useStore.getState().unread).reduce((a, b) => a + b, 0);
    const where = server
      ? `${server.channels.find((c) => c.id === route.channelId)?.name ?? ""} — ${server.name}`
      : dm
        ? dm.recipients[0]?.displayName
        : "Друзья";
    document.title = `${unread ? `(${unread}) ` : ""}${where} | RUdis`;
  });

  if (!server) {
    if (dm) return <Chat channel={dm} dmUser={dm.recipients[0]} />;
    return <Friends />;
  }

  const channel = server.channels.find((c) => c.id === route.channelId);
  if (!channel)
    return (
      <section className="chat empty-chat">
        <div className="empty-state">
          <h2>Нет текстовых каналов</h2>
          <p className="muted">Выберите канал слева или создайте новый.</p>
        </div>
      </section>
    );

  if (channel.type === "voice") return <VoiceView channel={channel} server={server} />;

  return (
    <>
      <Chat channel={channel} />
      {showMembers && <MemberList serverId={server.id} />}
    </>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
