import express from "express";
import { Chat } from "../models/Chat.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";

const router = express.Router();
const userSelect = "name email avatarColor";
const maxAttachmentSize = 2 * 1024 * 1024;
const maxAttachments = 4;

function normalizeAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  if (attachments.length > maxAttachments) {
    const error = new Error(`You can attach up to ${maxAttachments} files`);
    error.status = 400;
    throw error;
  }

  return attachments.map((attachment) => {
    const name = attachment?.name?.toString().trim();
    const type = attachment?.type?.toString().trim() || "application/octet-stream";
    const size = Number(attachment?.size);
    const dataUrl = attachment?.dataUrl?.toString();

    if (!name || !Number.isFinite(size) || size <= 0 || size > maxAttachmentSize || !dataUrl?.startsWith("data:")) {
      const error = new Error("Invalid attachment");
      error.status = 400;
      throw error;
    }

    return { name, type, size, dataUrl };
  });
}

async function serializeChat(chat) {
  const populated = await chat.populate([
    { path: "members", select: userSelect },
    { path: "admins", select: userSelect },
    {
      path: "lastMessage",
      populate: { path: "sender", select: userSelect }
    }
  ]);

  return populated;
}

function isChatAdmin(chat, userId) {
  return chat.admins.some((adminId) => adminId.toString() === userId.toString());
}

function emitChatUpdated(req, chat) {
  chat.members.forEach((member) => {
    const memberId = member._id?.toString() || member.toString();
    req.io.to(`user:${memberId}`).emit("chat:updated", chat);
  });
}

async function serializeMessage(message) {
  return message.populate([
    { path: "sender", select: userSelect },
    { path: "replyTo", populate: { path: "sender", select: userSelect } },
    { path: "reactions.user", select: userSelect }
  ]);
}

router.get("/", async (req, res, next) => {
  try {
    const chats = await Chat.find({ members: req.user._id })
      .sort({ updatedAt: -1 })
      .populate("members", userSelect)
      .populate("admins", userSelect)
      .populate({ path: "lastMessage", populate: { path: "sender", select: userSelect } });

    res.json(chats);
  } catch (error) {
    next(error);
  }
});

router.post("/direct", async (req, res, next) => {
  try {
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ message: "memberId is required" });

    const members = [req.user._id.toString(), memberId].sort();
    let chat = await Chat.findOne({ isGroup: false, members: { $all: members, $size: 2 } });

    if (!chat) {
      chat = await Chat.create({ isGroup: false, members });
      const serialized = await serializeChat(chat);
      members.forEach((memberId) => req.io.to(`user:${memberId}`).emit("chat:created", serialized));
      return res.status(201).json(serialized);
    }

    res.status(201).json(await serializeChat(chat));
  } catch (error) {
    next(error);
  }
});

router.post("/groups", async (req, res, next) => {
  try {
    const { name, memberIds = [] } = req.body;
    const uniqueMembers = [...new Set([req.user._id.toString(), ...memberIds])];

    if (!name || uniqueMembers.length < 3) {
      return res.status(400).json({ message: "Group name and at least 3 members are required" });
    }

    const chat = await Chat.create({
      name,
      isGroup: true,
      members: uniqueMembers,
      admins: [req.user._id]
    });

    const serialized = await serializeChat(chat);
    uniqueMembers.forEach((memberId) => req.io.to(`user:${memberId}`).emit("chat:created", serialized));

    res.status(201).json(serialized);
  } catch (error) {
    next(error);
  }
});

router.patch("/:chatId", async (req, res, next) => {
  try {
    const { name } = req.body;
    const chat = await Chat.findOne({ _id: req.params.chatId, isGroup: true, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Group not found" });
    if (!isChatAdmin(chat, req.user._id)) return res.status(403).json({ message: "Only admins can rename this group" });
    if (!name?.trim()) return res.status(400).json({ message: "Group name is required" });

    chat.name = name;
    await chat.save();

    const serialized = await serializeChat(chat);
    emitChatUpdated(req, serialized);
    res.json(serialized);
  } catch (error) {
    next(error);
  }
});

router.post("/:chatId/members", async (req, res, next) => {
  try {
    const { memberIds = [] } = req.body;
    const chat = await Chat.findOne({ _id: req.params.chatId, isGroup: true, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Group not found" });
    if (!isChatAdmin(chat, req.user._id)) return res.status(403).json({ message: "Only admins can add members" });

    const users = await User.find({ _id: { $in: memberIds } }).select("_id");
    const existing = new Set(chat.members.map((memberId) => memberId.toString()));
    users.forEach((user) => {
      if (!existing.has(user._id.toString())) chat.members.push(user._id);
    });
    await chat.save();

    const serialized = await serializeChat(chat);
    users.forEach((user) => req.io.to(`user:${user._id.toString()}`).emit("chat:created", serialized));
    emitChatUpdated(req, serialized);
    res.json(serialized);
  } catch (error) {
    next(error);
  }
});

router.delete("/:chatId/members/:memberId", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, isGroup: true, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Group not found" });
    if (!isChatAdmin(chat, req.user._id)) return res.status(403).json({ message: "Only admins can remove members" });
    if (req.params.memberId === req.user._id.toString()) return res.status(400).json({ message: "Use leave group instead" });

    chat.members = chat.members.filter((memberId) => memberId.toString() !== req.params.memberId);
    chat.admins = chat.admins.filter((adminId) => adminId.toString() !== req.params.memberId);
    await chat.save();

    const serialized = await serializeChat(chat);
    req.io.to(`user:${req.params.memberId}`).emit("chat:removed", { chatId: chat._id.toString() });
    emitChatUpdated(req, serialized);
    res.json(serialized);
  } catch (error) {
    next(error);
  }
});

router.post("/:chatId/admins/:memberId", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, isGroup: true, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Group not found" });
    if (!isChatAdmin(chat, req.user._id)) return res.status(403).json({ message: "Only admins can promote members" });
    if (!chat.members.some((memberId) => memberId.toString() === req.params.memberId)) {
      return res.status(400).json({ message: "User is not a group member" });
    }
    if (!chat.admins.some((adminId) => adminId.toString() === req.params.memberId)) {
      chat.admins.push(req.params.memberId);
      await chat.save();
    }

    const serialized = await serializeChat(chat);
    emitChatUpdated(req, serialized);
    res.json(serialized);
  } catch (error) {
    next(error);
  }
});

router.delete("/:chatId/leave", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, isGroup: true, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Group not found" });

    const leavingUserId = req.user._id.toString();
    chat.members = chat.members.filter((memberId) => memberId.toString() !== leavingUserId);
    chat.admins = chat.admins.filter((adminId) => adminId.toString() !== leavingUserId);
    if (chat.members.length > 0 && chat.admins.length === 0) {
      chat.admins = [chat.members[0]];
    }
    await chat.save();

    req.io.to(`user:${leavingUserId}`).emit("chat:removed", { chatId: chat._id.toString() });
    if (chat.members.length > 0) {
      const serialized = await serializeChat(chat);
      emitChatUpdated(req, serialized);
    }

    res.json({ ok: true, chatId: chat._id.toString() });
  } catch (error) {
    next(error);
  }
});

router.get("/:chatId/messages", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    const messages = await Message.find({ chat: chat._id })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate("sender", userSelect)
      .populate({ path: "replyTo", populate: { path: "sender", select: userSelect } })
      .populate("reactions.user", userSelect);

    res.json(messages);
  } catch (error) {
    next(error);
  }
});

router.post("/:chatId/messages", async (req, res, next) => {
  try {
    const { body = "", attachments = [], replyTo } = req.body;
    const normalizedAttachments = normalizeAttachments(attachments);
    const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user._id });

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!body?.trim() && normalizedAttachments.length === 0) {
      return res.status(400).json({ message: "Message body or attachment is required" });
    }

    if (replyTo) {
      const parentMessage = await Message.findOne({ _id: replyTo, chat: chat._id });
      if (!parentMessage) return res.status(400).json({ message: "Reply target not found" });
    }

    const message = await Message.create({
      chat: chat._id,
      sender: req.user._id,
      body,
      attachments: normalizedAttachments,
      replyTo: replyTo || undefined,
      readBy: [req.user._id]
    });

    chat.lastMessage = message._id;
    await chat.save();

    const populated = await serializeMessage(message);
    req.io.to(chat._id.toString()).emit("message:new", populated);
    req.io.to(chat._id.toString()).emit("chat:updated", await serializeChat(chat));

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
});

router.patch("/:chatId/messages/:messageId", async (req, res, next) => {
  try {
    const { body = "" } = req.body;
    const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    const message = await Message.findOne({ _id: req.params.messageId, chat: chat._id, sender: req.user._id });
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (message.deletedAt) return res.status(400).json({ message: "Deleted messages cannot be edited" });
    if (!body.trim()) return res.status(400).json({ message: "Message body is required" });

    message.body = body;
    message.editedAt = new Date();
    await message.save();

    const populated = await serializeMessage(message);
    req.io.to(chat._id.toString()).emit("message:updated", populated);
    res.json(populated);
  } catch (error) {
    next(error);
  }
});

router.delete("/:chatId/messages/:messageId", async (req, res, next) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    const message = await Message.findOne({ _id: req.params.messageId, chat: chat._id, sender: req.user._id });
    if (!message) return res.status(404).json({ message: "Message not found" });

    message.body = "";
    message.attachments = [];
    message.deletedAt = new Date();
    await message.save();

    const populated = await serializeMessage(message);
    req.io.to(chat._id.toString()).emit("message:updated", populated);
    res.json(populated);
  } catch (error) {
    next(error);
  }
});

router.post("/:chatId/messages/:messageId/reactions", async (req, res, next) => {
  try {
    const { emoji } = req.body;
    const allowedEmoji = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
    const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user._id });
    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!allowedEmoji.includes(emoji)) return res.status(400).json({ message: "Invalid reaction" });

    const message = await Message.findOne({ _id: req.params.messageId, chat: chat._id });
    if (!message) return res.status(404).json({ message: "Message not found" });

    const userId = req.user._id.toString();
    const existing = message.reactions.find((reaction) => reaction.user.toString() === userId && reaction.emoji === emoji);
    message.reactions = existing
      ? message.reactions.filter((reaction) => !(reaction.user.toString() === userId && reaction.emoji === emoji))
      : [...message.reactions.filter((reaction) => reaction.user.toString() !== userId), { emoji, user: req.user._id }];
    await message.save();

    const populated = await serializeMessage(message);
    req.io.to(chat._id.toString()).emit("message:updated", populated);
    res.json(populated);
  } catch (error) {
    next(error);
  }
});

export default router;
