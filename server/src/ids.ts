import { randomBytes } from "node:crypto";

let last = 0;
let seq = 0;

// Сортируемый по времени id: 9 символов времени + счётчик + случайный хвост.
export function newId(): string {
  const now = Date.now();
  seq = now === last ? seq + 1 : 0;
  last = now;
  return (
    now.toString(36).padStart(9, "0") +
    seq.toString(36).padStart(3, "0") +
    randomBytes(4).toString("hex")
  );
}

export function inviteCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
