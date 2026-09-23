import { useEffect, useRef, useState } from "react";
import { emojiCategories, recentEmoji, rememberEmoji } from "./emoji";

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}

export function EmojiPicker({ onPick, onClose, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [recent] = useState(recentEmoji);
  const [tab, setTab] = useState(recent.length ? -1 : 0);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Откладываем, чтобы клик, открывший пикер, его же не закрыл.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items = tab === -1 ? recent : emojiCategories[tab].items;
  const title = tab === -1 ? "Недавние" : emojiCategories[tab].name;

  return (
    <div className={`emoji-picker ${className}`} ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      <div className="emoji-tabs">
        {recent.length > 0 && (
          <button className={tab === -1 ? "active" : ""} onClick={() => setTab(-1)} title="Недавние">
            🕘
          </button>
        )}
        {emojiCategories.map((c, i) => (
          <button key={c.name} className={tab === i ? "active" : ""} onClick={() => setTab(i)} title={c.name}>
            {c.icon}
          </button>
        ))}
      </div>
      <div className="emoji-title">{title}</div>
      <div className="emoji-grid">
        {items.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => {
              rememberEmoji(e);
              onPick(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
