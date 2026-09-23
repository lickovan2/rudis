import { navigate, openModal, useStore } from "../store";
import { ServerIcon } from "./Avatar";
import { Compass, Logo, Plus } from "./icons";

export function ServerRail() {
  const servers = useStore((s) => s.servers);
  const route = useStore((s) => s.route);
  const unread = useStore((s) => s.unread);
  const dms = useStore((s) => s.dms);

  const dmUnread = dms.reduce((n, d) => n + (unread[d.id] ?? 0), 0);

  return (
    <nav className="server-rail">
      <RailItem
        active={route.serverId === null}
        title="Личные сообщения"
        badge={dmUnread}
        onClick={() => navigate(null)}
      >
        <div className="rail-home">
          <Logo size={30} />
        </div>
      </RailItem>
      <div className="rail-sep" />
      {servers.map((s) => {
        const hasUnread = s.channels.some((c) => unread[c.id]);
        return (
          <RailItem
            key={s.id}
            active={route.serverId === s.id}
            unread={hasUnread}
            title={s.name}
            onClick={() => navigate(s.id)}
          >
            <ServerIcon server={s} />
          </RailItem>
        );
      })}
      <RailItem title="Создать сервер" onClick={() => openModal({ kind: "createServer" })} action>
        <div className="rail-action">
          <Plus size={22} />
        </div>
      </RailItem>
      <RailItem title="Присоединиться к серверу" onClick={() => openModal({ kind: "joinServer" })} action>
        <div className="rail-action">
          <Compass size={22} />
        </div>
      </RailItem>
    </nav>
  );
}

function RailItem({
  active,
  unread,
  badge,
  title,
  action,
  onClick,
  children,
}: {
  active?: boolean;
  unread?: boolean;
  badge?: number;
  title: string;
  action?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rail-item${active ? " active" : ""}${unread ? " unread" : ""}${action ? " is-action" : ""}`}>
      <span className="rail-pill" />
      <button className="rail-button" onClick={onClick} data-tip={title} aria-label={title}>
        {children}
      </button>
      {!!badge && <span className="rail-badge">{badge > 99 ? "99+" : badge}</span>}
    </div>
  );
}
