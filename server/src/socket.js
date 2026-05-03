import { Chat } from "./models/Chat.js";
import { Message } from "./models/Message.js";
import { User } from "./models/User.js";
import { verifyToken } from "./utils/token.js";

const onlineUsers = new Map();

export function getOnlineUserIds() {
  return [...onlineUsers.keys()];
}

async function markMessagesDelivered(io, chatId, userId) {
  const messages = await Message.find({
    chat: chatId,
    sender: { $ne: userId },
    deliveredTo: { $ne: userId }
  }).select("_id");

  if (messages.length === 0) return;

  const messageIds = messages.map((message) => message._id.toString());
  await Message.updateMany({ _id: { $in: messageIds } }, { $addToSet: { deliveredTo: userId } });
  io.to(chatId.toString()).emit("message:delivered", {
    chatId: chatId.toString(),
    userId,
    messageIds
  });
}

async function markMessagesRead(io, chatId, userId, messageIds = []) {
  const messageFilter = {
    chat: chatId,
    sender: { $ne: userId },
    readBy: { $ne: userId }
  };

  if (messageIds.length > 0) {
    messageFilter._id = { $in: messageIds };
  }

  const messages = await Message.find(messageFilter).select("_id");
  if (messages.length === 0) return;

  const ids = messages.map((message) => message._id.toString());
  await Message.updateMany({ _id: { $in: ids } }, { $addToSet: { readBy: userId, deliveredTo: userId } });
  io.to(chatId.toString()).emit("message:read", {
    chatId: chatId.toString(),
    userId,
    messageIds: ids
  });
}

function relayToTargetOrChat(socket, eventName, chatId, toUserId, payload) {
  if (toUserId) {
    socket.to(`user:${toUserId}`).emit(eventName, payload);
    return;
  }

  socket.to(chatId).emit(eventName, payload);
}

export function registerSocketHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));

      const payload = verifyToken(token);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error("Invalid session"));

      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Invalid session"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user._id.toString();
    const userRoom = `user:${userId}`;

    socket.join(userRoom);
    onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
    socket.emit("presence:online", getOnlineUserIds());
    socket.broadcast.emit("presence:user-online", { userId });

    const chats = await Chat.find({ members: socket.user._id }).select("_id");
    chats.forEach((chat) => socket.join(chat._id.toString()));
    await Promise.all(chats.map((chat) => markMessagesDelivered(io, chat._id, userId)));

    socket.on("chat:join", async (chatId, ack) => {
      const chat = await Chat.findOne({ _id: chatId, members: socket.user._id });
      if (!chat) return ack?.({ ok: false, message: "Chat not found" });
      socket.join(chatId);
      await markMessagesDelivered(io, chatId, userId);
      ack?.({ ok: true });
    });

    socket.on("typing:start", ({ chatId }) => {
      socket.to(chatId).emit("typing:start", { chatId, userId: socket.user._id.toString() });
    });

    socket.on("typing:stop", ({ chatId }) => {
      socket.to(chatId).emit("typing:stop", { chatId, userId: socket.user._id.toString() });
    });

    socket.on("message:read", async ({ chatId, messageIds = [] }) => {
      const chat = await Chat.findOne({ _id: chatId, members: socket.user._id });
      if (!chat) return;
      await markMessagesRead(io, chatId, userId, messageIds);
    });

    socket.on("call:invite", async ({ chatId, mode }) => {
      const chat = await Chat.findOne({ _id: chatId, members: socket.user._id });
      if (!chat || !chat.callEnabled) return;
      await chat.populate("members", "name email avatarColor");

      socket.to(chatId).emit("call:invite", {
        chatId,
        chat,
        mode,
        from: socket.user.toSafeObject()
      });
    });

    socket.on("call:accept", async ({ chatId, mode }) => {
      const chat = await Chat.findOne({ _id: chatId, members: socket.user._id });
      if (!chat || !chat.callEnabled) return;

      socket.to(chatId).emit("call:accept", {
        chatId,
        mode,
        from: socket.user.toSafeObject()
      });
    });

    socket.on("call:reject", ({ chatId }) => {
      socket.to(chatId).emit("call:reject", { chatId, fromUserId: userId });
    });

    socket.on("call:end", ({ chatId }) => {
      socket.to(chatId).emit("call:end", { chatId, fromUserId: userId });
    });

    socket.on("webrtc:offer", ({ chatId, offer, toUserId }) => {
      relayToTargetOrChat(socket, "webrtc:offer", chatId, toUserId, { chatId, offer, fromUserId: userId });
    });

    socket.on("webrtc:answer", ({ chatId, answer, toUserId }) => {
      relayToTargetOrChat(socket, "webrtc:answer", chatId, toUserId, { chatId, answer, fromUserId: userId });
    });

    socket.on("webrtc:ice-candidate", ({ chatId, candidate, toUserId }) => {
      relayToTargetOrChat(socket, "webrtc:ice-candidate", chatId, toUserId, {
        chatId,
        candidate,
        fromUserId: userId
      });
    });

    socket.on("disconnect", () => {
      const nextCount = (onlineUsers.get(userId) || 1) - 1;
      if (nextCount > 0) {
        onlineUsers.set(userId, nextCount);
        return;
      }

      onlineUsers.delete(userId);
      const now = new Date();
      void User.findByIdAndUpdate(userId, { lastSeenAt: now });
      socket.broadcast.emit("presence:user-offline", { userId, lastSeenAt: now.toISOString() });
    });
  });
}
