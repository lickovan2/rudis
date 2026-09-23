// Сколько активных сокетов у пользователя (вкладки, десктоп и т.д.).
const sockets = new Map<string, number>();

export function addSocket(userId: string): boolean {
  const n = (sockets.get(userId) ?? 0) + 1;
  sockets.set(userId, n);
  return n === 1;
}

export function removeSocket(userId: string): boolean {
  const n = (sockets.get(userId) ?? 1) - 1;
  if (n <= 0) {
    sockets.delete(userId);
    return true;
  }
  sockets.set(userId, n);
  return false;
}

export function isOnline(userId: string): boolean {
  return sockets.has(userId);
}
