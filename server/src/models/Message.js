import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, trim: true, maxlength: 2000, default: "" },
    attachments: [
      {
        name: { type: String, required: true, trim: true, maxlength: 180 },
        type: { type: String, required: true, trim: true, maxlength: 120 },
        size: { type: Number, required: true, max: 2 * 1024 * 1024 },
        dataUrl: { type: String, required: true }
      }
    ],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    editedAt: { type: Date },
    deletedAt: { type: Date },
    reactions: [
      {
        emoji: { type: String, required: true, maxlength: 16 },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
      }
    ],
    kind: { type: String, enum: ["text", "system", "call"], default: "text" },
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { timestamps: true }
);

messageSchema.index({ chat: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
