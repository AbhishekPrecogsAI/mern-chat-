# MERN Chat App

Full-stack chat app with private chats, group chats, realtime messaging, and a call-ready signaling layer for future voice/video calls.

## Stack

- MongoDB, Express, React, Node
- Socket.IO for realtime messages and call signaling
- JWT auth with password hashing
- Vite frontend

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create the server environment file:

```bash
cp server/.env.example server/.env
```

3. Update `server/.env` with your MongoDB URI and JWT secret.

4. Start development servers:

```bash
npm run dev
```

- Client: `http://localhost:5173`
- API: `http://localhost:5000`

## Voice/Video Readiness

The app includes Socket.IO signaling events for WebRTC offers, answers, ICE candidates, call invites, rejections, and call end events. The frontend has a dedicated call service and UI-ready call action entry points, so a WebRTC media layer can be added without rewriting chat transport.

## Realtime Features

- Per-user typing indicators.
- Delivered and read receipts for messages.
- Presence with online state and last seen timestamps.
- Live reactions, edits, deletes, and group updates with cleaner UI feedback.
