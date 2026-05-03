import express from "express";
import { Chat } from "../models/Chat.js";
import { User } from "../models/User.js";
import {
  createDirectChatIfMissing,
  getFriendshipStatus,
  makeFriends,
  removeFriendRequest,
  sendFriendRequest,
  syncLegacyDirectChatFriendship
} from "../utils/friends.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const filter = q
      ? {
          _id: { $ne: req.user._id },
          $or: [
            { name: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } }
          ]
        }
      : { _id: { $ne: req.user._id } };

    const users = await User.find(filter).limit(20).sort({ name: 1 });
    res.json(users.map((user) => user.toSafeObject()));
  } catch (error) {
    next(error);
  }
});

router.get("/:userId/profile", async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    await syncLegacyDirectChatFriendship(req.user._id, user._id);
    const [viewer, refreshedUser] = await Promise.all([User.findById(req.user._id), User.findById(user._id)]);

    const sharedGroups = await Chat.find({
      isGroup: true,
      members: { $all: [req.user._id, refreshedUser._id] }
    })
      .select("name members")
      .sort({ updatedAt: -1 });

    res.json({
      user: refreshedUser.toSafeObject(),
      friendship: {
        status: getFriendshipStatus(viewer, refreshedUser)
      },
      sharedGroups: sharedGroups.map((chat) => ({
        id: chat._id.toString(),
        name: chat.name,
        memberCount: chat.members.length
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:userId/friend-request", async (req, res, next) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot add yourself" });
    }

    await syncLegacyDirectChatFriendship(req.user._id, target._id);
    const [viewer, refreshedTarget] = await Promise.all([User.findById(req.user._id), User.findById(target._id)]);
    const status = getFriendshipStatus(viewer, refreshedTarget);

    if (status === "friends") {
      return res.json({ user: refreshedTarget.toSafeObject(), friendship: { status } });
    }

    if (status === "outgoing") {
      return res.status(409).json({ message: "Friend request already sent" });
    }

    if (status === "incoming") {
      await makeFriends(viewer._id, refreshedTarget._id);
      const chat = await createDirectChatIfMissing(viewer._id, refreshedTarget._id);
      const serializedChat = await chat.populate([
        { path: "members", select: "name email avatarColor lastSeenAt" },
        { path: "admins", select: "name email avatarColor lastSeenAt" },
        { path: "lastMessage", populate: { path: "sender", select: "name email avatarColor lastSeenAt" } }
      ]);

      req.io.to(`user:${viewer._id.toString()}`).emit("chat:created", serializedChat);
      req.io.to(`user:${refreshedTarget._id.toString()}`).emit("chat:created", serializedChat);
      req.io.to(`user:${viewer._id.toString()}`).emit("friend:updated", {
        userId: viewer._id.toString(),
        targetUserId: refreshedTarget._id.toString(),
        status: "friends"
      });
      req.io.to(`user:${refreshedTarget._id.toString()}`).emit("friend:updated", {
        userId: viewer._id.toString(),
        targetUserId: refreshedTarget._id.toString(),
        status: "friends"
      });

      return res.json({
        user: refreshedTarget.toSafeObject(),
        friendship: { status: "friends" },
        chat: serializedChat
      });
    }

    await sendFriendRequest(viewer._id, refreshedTarget._id);
    req.io.to(`user:${refreshedTarget._id.toString()}`).emit("friend:request", {
      from: viewer.toSafeObject(),
      userId: viewer._id.toString(),
      targetUserId: refreshedTarget._id.toString()
    });
    req.io.to(`user:${viewer._id.toString()}`).emit("friend:updated", {
      userId: viewer._id.toString(),
      targetUserId: refreshedTarget._id.toString(),
      status: "outgoing"
    });
    req.io.to(`user:${refreshedTarget._id.toString()}`).emit("friend:updated", {
      userId: viewer._id.toString(),
      targetUserId: refreshedTarget._id.toString(),
      status: "incoming"
    });

    res.status(201).json({
      user: refreshedTarget.toSafeObject(),
      friendship: { status: "outgoing" }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:userId/friend-request/accept", async (req, res, next) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot add yourself" });
    }

    const viewer = await User.findById(req.user._id);
    const status = getFriendshipStatus(viewer, target);
    if (status !== "incoming") {
      return res.status(400).json({ message: "No pending friend request" });
    }

    await makeFriends(viewer._id, target._id);
    const chat = await createDirectChatIfMissing(viewer._id, target._id);
    const serializedChat = await chat.populate([
      { path: "members", select: "name email avatarColor lastSeenAt" },
      { path: "admins", select: "name email avatarColor lastSeenAt" },
      { path: "lastMessage", populate: { path: "sender", select: "name email avatarColor lastSeenAt" } }
    ]);

    req.io.to(`user:${viewer._id.toString()}`).emit("chat:created", serializedChat);
    req.io.to(`user:${target._id.toString()}`).emit("chat:created", serializedChat);
    req.io.to(`user:${viewer._id.toString()}`).emit("friend:updated", {
      userId: viewer._id.toString(),
      targetUserId: target._id.toString(),
      status: "friends"
    });
    req.io.to(`user:${target._id.toString()}`).emit("friend:updated", {
      userId: viewer._id.toString(),
      targetUserId: target._id.toString(),
      status: "friends"
    });

    res.json({
      user: target.toSafeObject(),
      friendship: { status: "friends" },
      chat: serializedChat
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:userId/friend-request/reject", async (req, res, next) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot add yourself" });
    }

    await removeFriendRequest(req.user._id, target._id);
    req.io.to(`user:${req.user._id.toString()}`).emit("friend:updated", {
      userId: req.user._id.toString(),
      targetUserId: target._id.toString(),
      status: "none"
    });
    req.io.to(`user:${target._id.toString()}`).emit("friend:updated", {
      userId: req.user._id.toString(),
      targetUserId: target._id.toString(),
      status: "none"
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
