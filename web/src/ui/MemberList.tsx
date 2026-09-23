import { openModal, useStore } from "../store";
import type { Member } from "../types";
import { Avatar } from "./Avatar";
import { Crown } from "./icons";

const EMPTY: Member[] = [];

export function MemberList({ serverId }: { serverId: string }) {
  const members = useStore((s) => s.members[serverId] ?? EMPTY);
  const online = useStore((s) => s.online);
  const users = useStore((s) => s.users);

  const view = members.map((m) => {
    const u = users[m.user.id] ?? m.user;
    return { ...m, user: { ...u, online: online[u.id] ?? u.online } };
  });
  const byName = (a: Member, b: Member) => a.user.displayName.localeCompare(b.user.displayName, "ru");
  const staff = view.filter((m) => m.user.online && m.role !== "member").sort(byName);
  const onlineMembers = view.filter((m) => m.user.online && m.role === "member").sort(byName);
  const offline = view.filter((m) => !m.user.online).sort(byName);

  return (
    <aside className="member-list">
      {staff.length > 0 && <Group title="Администрация" members={staff} serverId={serverId} />}
      {onlineMembers.length > 0 && <Group title="В сети" members={onlineMembers} serverId={serverId} />}
      {offline.length > 0 && <Group title="Не в сети" members={offline} serverId={serverId} faded />}
    </aside>
  );
}

function Group({
  title,
  members,
  serverId,
  faded,
}: {
  title: string;
  members: Member[];
  serverId: string;
  faded?: boolean;
}) {
  return (
    <div className="member-group">
      <div className="section-title">
        <span>
          {title} — {members.length}
        </span>
      </div>
      {members.map((m) => (
        <div
          key={m.user.id}
          className={`member${faded ? " faded" : ""}`}
          onClick={() => openModal({ kind: "profile", userId: m.user.id, serverId })}
        >
          <Avatar user={m.user} size={32} status />
          <span className={`truncate role-${m.role}`}>{m.user.displayName}</span>
          {m.role === "owner" && (
            <span className="crown" data-tip="Владелец сервера">
              <Crown size={14} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
