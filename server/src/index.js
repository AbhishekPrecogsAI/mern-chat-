import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { connectDb } from "./config/db.js";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chats.js";
import userRoutes from "./routes/users.js";
import { registerSocketHandlers } from "./socket.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_ORIGIN || "https://mern-chat-client-one.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  return (
    !origin ||
    allowedOrigins.includes(origin) ||
    /^http:\/\/localhost:517\d$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1:517\d$/.test(origin)
  );
}

function corsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin ${origin} is not allowed by CORS`));
}

const corsOptions = {
  origin: corsOrigin,
  credentials: true
};

const io = new Server(server, {
  cors: corsOptions
});

app.use(cors(corsOptions));
app.use(express.json({ limit: "12mb" }));
app.use((req, _res, next) => {
  req.io = io;
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/chats", requireAuth, chatRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

registerSocketHandlers(io);

const port = process.env.PORT || 5000;

connectDb(process.env.MONGO_URI)
  .then(() => {
    server.listen(port, () => console.log(`Server running on http://localhost:${port}`));
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
