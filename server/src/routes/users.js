import express from "express";
import { Chat } from "../models/Chat.js";
import { User } from "../models/User.js";

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

    const sharedGroups = await Chat.find({
      isGroup: true,
      members: { $all: [req.user._id, user._id] }
    })
      .select("name members")
      .sort({ updatedAt: -1 });

    res.json({
      user: user.toSafeObject(),
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

export default router;
