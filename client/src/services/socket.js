import { io } from "socket.io-client";
import { getApiUrl } from "./api";

let socket;

export function connectSocket(token) {
  if (socket?.connected) return socket;

  socket = io(getApiUrl(), {
    auth: { token },
    autoConnect: true
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function joinChat(chatId) {
  socket?.emit("chat:join", chatId);
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = undefined;
}
