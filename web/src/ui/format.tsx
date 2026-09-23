import { useState, type ReactNode } from "react";
import { useStore } from "../store";

// Лёгкая разметка в духе Discord: **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~,
// ||спойлер||, `код`, ```блок кода```, > цитата, ссылки и @упоминания.
// Всё собирается из React-элементов, поэтому HTML из сообщений никогда не исполняется.

const inlineRe =
  /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[\s\S]+?~~)|(\|\|[\s\S]+?\|\|)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|(@[a-zA-Z0-9_.]{3,32})/g;

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`spoiler${open ? " open" : ""}`} onClick={() => setOpen(true)}>
      {children}
    </span>
  );
}

function Mention({ username }: { username: string }) {
  const me = useStore((s) => s.me);
  const self = me?.username.toLowerCase() === username.toLowerCase();
  return <span className={`mention${self ? " self" : ""}`}>@{username}</span>;
}

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(inlineRe)) {
    const idx = m.index!;
    if (idx > last) out.push(text.slice(last, idx));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<u key={k}>{inline(t.slice(2, -2), k)}</u>);
    else if (m[4] || m[5]) out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    else if (m[6]) out.push(<s key={k}>{inline(t.slice(2, -2), k)}</s>);
    else if (m[7]) out.push(<Spoiler key={k}>{inline(t.slice(2, -2), k)}</Spoiler>);
    else if (m[8])
      out.push(
        <a key={k} href={t} target="_blank" rel="noopener noreferrer">
          {t}
        </a>,
      );
    else if (m[9]) out.push(<Mention key={k} username={t.slice(1)} />);
    last = idx + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const rows = text.split("\n");
  let quote: string[] = [];
  const flushQuote = (i: number) => {
    if (!quote.length) return;
    out.push(
      <blockquote key={`${key}-q${i}`}>{quote.flatMap((q, j) => (j ? [<br key={j} />, ...inline(q, `${key}-q${i}-${j}`)] : inline(q, `${key}-q${i}-${j}`)))}</blockquote>,
    );
    quote = [];
  };
  rows.forEach((row, i) => {
    if (row.startsWith("> ")) {
      quote.push(row.slice(2));
      return;
    }
    flushQuote(i);
    if (out.length && i > 0) out.push(<br key={`${key}-br${i}`} />);
    out.push(...inline(row, `${key}-${i}`));
  });
  flushQuote(rows.length);
  return out;
}

export function renderContent(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /```(?:([a-zA-Z0-9+#-]{1,16})\n)?([\s\S]*?)```/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out.push(...lines(text.slice(last, idx).replace(/^\n|\n$/g, ""), `t${n}`));
    out.push(
      <pre key={`c${n}`} className="codeblock">
        <code>{m[2].replace(/^\n|\n$/g, "")}</code>
      </pre>,
    );
    last = idx + m[0].length;
    n++;
  }
  if (last < text.length) out.push(...lines(text.slice(last).replace(/^\n/, ""), `t${n}`));
  return out;
}

/** Сообщение только из эмодзи (до 20 штук) показываем крупно. */
export function isEmojiOnly(text: string) {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}
