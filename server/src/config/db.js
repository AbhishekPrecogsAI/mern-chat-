import mongoose from "mongoose";

export async function connectDb(uri) {
  if (!uri) {
    throw new Error("MONGO_URI is required");
  }

  await mongoose.connect(uri);
  console.log("MongoDB connected");
}
