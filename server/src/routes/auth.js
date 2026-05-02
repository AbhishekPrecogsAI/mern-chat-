import express from "express";
import { User } from "../models/User.js";
import { signToken } from "../utils/token.js";

const router = express.Router();
const colors = ["#0f766e", "#2563eb", "#7c3aed", "#be123c", "#ca8a04", "#15803d"];

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const user = await User.create({
      name,
      email,
      password,
      avatarColor: colors[Math.floor(Math.random() * colors.length)]
    });

    res.status(201).json({ user: user.toSafeObject(), token: signToken(user._id.toString()) });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    res.json({ user: user.toSafeObject(), token: signToken(user._id.toString()) });
  } catch (error) {
    next(error);
  }
});

export default router;
