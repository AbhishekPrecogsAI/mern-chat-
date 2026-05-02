import { getSocket } from "./socket";

export function inviteCall(chatId, mode) {
  getSocket()?.emit("call:invite", { chatId, mode });
}

export function rejectCall(chatId) {
  getSocket()?.emit("call:reject", { chatId });
}

export function acceptCall(chatId, mode) {
  getSocket()?.emit("call:accept", { chatId, mode });
}

export function endCall(chatId) {
  getSocket()?.emit("call:end", { chatId });
}

export function sendOffer(chatId, offer, toUserId) {
  getSocket()?.emit("webrtc:offer", { chatId, offer, toUserId });
}

export function sendAnswer(chatId, answer, toUserId) {
  getSocket()?.emit("webrtc:answer", { chatId, answer, toUserId });
}

export function sendIceCandidate(chatId, candidate, toUserId) {
  getSocket()?.emit("webrtc:ice-candidate", { chatId, candidate, toUserId });
}
