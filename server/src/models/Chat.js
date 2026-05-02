import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120 },
    isGroup: { type: Boolean, default: false },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    callEnabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);

chatSchema.index({ members: 1 });

export const Chat = mongoose.model("Chat", chatSchema);
