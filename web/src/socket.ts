import { io, type Socket } from "socket.io-client";
import { API_BASE, getToken } from "./api";

let socket: Socket | null = null;

export function connectSocket(): Socket {
  socket?.disconnect();
  socket = io(API_BASE || undefined, {
    auth: (cb) => cb({ token: getToken() }),
    transports: ["websocket"],
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
