import { fileUrl } from "../api";
import type { User } from "../types";

const palette = ["#e5383b", "#2f6bff", "#f4a259", "#3bb273", "#9b5de5", "#00b4d8", "#ef476f", "#8d99ae"];

export function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return s.toUpperCase();
}

interface Props {
  user: Pick<User, "id" | "displayName" | "avatar"> & { online?: boolean };
  size?: number;
  status?: boolean;
  speaking?: boolean;
}

export function Avatar({ user, size = 40, status = false, speaking = false }: Props) {
  const src = fileUrl(user.avatar);
  return (
    <div
      className={`avatar${speaking ? " speaking" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span className="avatar-fallback" style={{ background: colorFor(user.id) }}>
          {initials(user.displayName)}
        </span>
      )}
      {status && (
        <span
          className={`status-dot ${user.online ? "online" : "offline"}`}
          style={{ width: size * 0.34, height: size * 0.34 }}
          title={user.online ? "В сети" : "Не в сети"}
        />
      )}
    </div>
  );
}

export function ServerIcon({
  server,
  size = 48,
}: {
  server: { id: string; name: string; icon: string | null };
  size?: number;
}) {
  const src = fileUrl(server.icon);
  return (
    <div className="server-icon-img" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span style={{ fontSize: size * 0.34 }}>{initials(server.name)}</span>
      )}
    </div>
  );
}
