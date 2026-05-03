import { Chat } from "../models/Chat.js";
import { User } from "../models/User.js";

export async function getUserPair(userAId, userBId) {
  const [userA, userB] = await Promise.all([User.findById(userAId), User.findById(userBId)]);
  return { userA, userB };
}

export function getFriendshipStatus(viewer, target) {
  const targetId = target._id.toString();
  const viewerId = viewer._id.toString();
  const friends = new Set((viewer.friends || []).map((id) => id.toString()));
  const sent = new Set((viewer.sentFriendRequests || []).map((id) => id.toString()));
  const received = new Set((viewer.receivedFriendRequests || []).map((id) => id.toString()));

  if (friends.has(targetId)) return "friends";
  if (sent.has(targetId)) return "outgoing";
  if (received.has(targetId)) return "incoming";
  return "none";
}

export async function getDirectChat(userAId, userBId) {
  return Chat.findOne({
    isGroup: false,
    members: { $all: [userAId, userBId], $size: 2 }
  });
}

export async function syncLegacyDirectChatFriendship(userAId, userBId) {
  const directChat = await getDirectChat(userAId, userBId);
  if (!directChat) return null;

  await Promise.all([
    User.updateOne(
      { _id: userAId },
      {
        $addToSet: { friends: userBId },
        $pull: {
          sentFriendRequests: userBId,
          receivedFriendRequests: userBId
        }
      }
    ),
    User.updateOne(
      { _id: userBId },
      {
        $addToSet: { friends: userAId },
        $pull: {
          sentFriendRequests: userAId,
          receivedFriendRequests: userAId
        }
      }
    )
  ]);

  return directChat;
}

export async function createDirectChatIfMissing(userAId, userBId) {
  let chat = await getDirectChat(userAId, userBId);
  if (chat) return chat;

  chat = await Chat.create({
    isGroup: false,
    members: [userAId, userBId].map((id) => id.toString()).sort()
  });

  return chat;
}

export async function makeFriends(userAId, userBId) {
  await Promise.all([
    User.updateOne(
      { _id: userAId },
      {
        $addToSet: { friends: userBId },
        $pull: {
          sentFriendRequests: userBId,
          receivedFriendRequests: userBId
        }
      }
    ),
    User.updateOne(
      { _id: userBId },
      {
        $addToSet: { friends: userAId },
        $pull: {
          sentFriendRequests: userAId,
          receivedFriendRequests: userAId
        }
      }
    )
  ]);
}

export async function sendFriendRequest(userAId, userBId) {
  await Promise.all([
    User.updateOne(
      { _id: userAId },
      {
        $addToSet: { sentFriendRequests: userBId }
      }
    ),
    User.updateOne(
      { _id: userBId },
      {
        $addToSet: { receivedFriendRequests: userAId }
      }
    )
  ]);
}

export async function removeFriendRequest(userAId, userBId) {
  await Promise.all([
    User.updateOne(
      { _id: userAId },
      {
        $pull: {
          sentFriendRequests: userBId,
          receivedFriendRequests: userBId
        }
      }
    ),
    User.updateOne(
      { _id: userBId },
      {
        $pull: {
          sentFriendRequests: userAId,
          receivedFriendRequests: userAId
        }
      }
    )
  ]);
}
