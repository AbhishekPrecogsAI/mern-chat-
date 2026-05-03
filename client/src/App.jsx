import {
  Bell,
  Check,
  CheckCheck,
  Copy,
  Edit3,
  FileText,
  Image,
  Clock3,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Minus,
  Minimize2,
  Phone,
  PhoneOff,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import { acceptCall, endCall, inviteCall, rejectCall, sendAnswer, sendIceCandidate, sendOffer } from "./services/calls";
import { connectSocket, disconnectSocket, getSocket, joinChat } from "./services/socket";

function getChatTitle(chat, currentUser) {
  if (!chat) return "";
  if (chat.isGroup) return chat.name;
  return chat.members.find((member) => member._id !== currentUser.id)?.name || "Direct chat";
}

function getInitials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getUserId(user) {
  return user?.id || user?._id;
}

function canNotify() {
  return "Notification" in window && Notification.permission === "granted" && (document.hidden || !document.hasFocus());
}

function showBrowserNotification(title, options = {}) {
  if (!canNotify()) return;

  const notification = new Notification(title, {
    icon: "/vite.svg",
    badge: "/vite.svg",
    ...options
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

const maxAttachmentSize = 2 * 1024 * 1024;
const maxAttachments = 4;
const reactionOptions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function getMessagePreview(message) {
  if (!message) return "";
  if (message.deletedAt) return "Deleted message";
  if (message.body) return message.body;
  if (message.attachments?.length) return "Attachment";
  return "Message";
}

function groupReactions(reactions = []) {
  return reactions.reduce((groups, reaction) => {
    const existing = groups.find((item) => item.emoji === reaction.emoji);
    if (existing) {
      existing.count += 1;
      return groups;
    }

    return [...groups, { emoji: reaction.emoji, count: 1 }];
  }, []);
}

function formatRelativeTime(value) {
  if (!value) return "just now";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  const diff = date.getTime() - Date.now();
  const absoluteSeconds = Math.max(1, Math.round(Math.abs(diff) / 1000));
  const units = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60]
  ];

  for (const [unit, seconds] of units) {
    if (absoluteSeconds >= seconds) {
      const valueInUnits = Math.round(absoluteSeconds / seconds);
      const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
      return formatter.format(diff < 0 ? -valueInUnits : valueInUnits, unit);
    }
  }

  return diff < 0 ? "just now" : "in a moment";
}

function getLastSeenLabel(user) {
  if (!user?.lastSeenAt) return "Offline";
  return `Last seen ${formatRelativeTime(user.lastSeenAt)}`;
}

function getReceiptUserIds(values = []) {
  return values
    .map((value) => getUserId(value))
    .filter(Boolean);
}

function getMessageReceipt(message, chat, currentUser) {
  if (!message || getUserId(message.sender) !== currentUser.id) return null;

  const otherMemberIds = (chat?.members || []).map((member) => member._id).filter((memberId) => memberId !== currentUser.id);
  const readBy = new Set(getReceiptUserIds(message.readBy));
  const deliveredTo = new Set(getReceiptUserIds(message.deliveredTo));
  const readCount = otherMemberIds.filter((memberId) => readBy.has(memberId)).length;
  const deliveredCount = otherMemberIds.filter((memberId) => deliveredTo.has(memberId)).length;

  if (readCount > 0) {
    return {
      icon: CheckCheck,
      label: chat?.isGroup && readCount < otherMemberIds.length ? `Read by ${readCount}` : "Read",
      tone: "read"
    };
  }

  if (deliveredCount > 0) {
    return {
      icon: Check,
      label: chat?.isGroup && deliveredCount < otherMemberIds.length ? `Delivered to ${deliveredCount}` : "Delivered",
      tone: "delivered"
    };
  }

  return {
    icon: Clock3,
    label: "Sent",
    tone: "sent"
  };
}

function getTypingLabel(chat, currentUser, typingUsers = []) {
  const names = typingUsers.filter((user) => getUserId(user) !== currentUser.id).map((user) => user.name).filter(Boolean);
  if (names.length === 0) return "";
  if (!chat?.isGroup) return `${names[0]} is typing...`;
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing...`;
}

function getStoredCallSession() {
  try {
    const raw = localStorage.getItem("chat_call_session");
    if (!raw) return null;

    const session = JSON.parse(raw);
    if (!session?.chatId || !session?.mode || !session?.userId) return null;
    return session;
  } catch {
    return null;
  }
}

function AuthView({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");

    try {
      const payload =
        mode === "register"
          ? { name: form.name, email: form.email, password: form.password }
          : { email: form.email, password: form.password };
      const data = await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      localStorage.setItem("chat_token", data.token);
      localStorage.setItem("chat_user", JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="authShell">
      <section className="authPanel">
        <div className="brandMark">
          <MessageCircle size={28} />
        </div>
        <h1>MERN Chat</h1>
        <p>Realtime private and group conversations with a call-ready foundation.</p>

        <div className="segmented" role="tablist">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Login
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Register
          </button>
        </div>

        <form onSubmit={submit} className="authForm">
          {mode === "register" && (
            <label>
              Name
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Avery Stone"
              />
            </label>
          )}
          <label>
            Email
            <input
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="avery@example.com"
              type="email"
            />
          </label>
          <label>
            Password
            <input
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="Minimum 6 characters"
              type="password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primaryButton" type="submit">
            {mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Avatar({ user, title }) {
  return (
    <span className="avatar" style={{ background: user?.avatarColor || "#475569" }}>
      {getInitials(user?.name || title)}
    </span>
  );
}

function MessageAttachments({ attachments = [] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="attachments">
      {attachments.map((attachment, index) => {
        const isImage = attachment.type?.startsWith("image/");
        const key = `${attachment.name}-${attachment.size}-${index}`;

        return isImage ? (
          <a className="imageAttachment" href={attachment.dataUrl} target="_blank" rel="noreferrer" key={key}>
            <img src={attachment.dataUrl} alt={attachment.name} />
            <span>{attachment.name}</span>
          </a>
        ) : (
          <a className="fileAttachment" href={attachment.dataUrl} download={attachment.name} key={key}>
            <FileText size={20} />
            <span>
              <strong>{attachment.name}</strong>
              <small>{formatFileSize(attachment.size)}</small>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function CreateGroupModal({ currentUser, onClose, onCreateGroup }) {
  const [groupName, setGroupName] = useState("");
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadPeople() {
      try {
        const users = await api("/api/users");
        if (active) setPeople(users);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPeople();

    return () => {
      active = false;
    };
  }, []);

  const filteredPeople = people.filter((person) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return person.name.toLowerCase().includes(term) || person.email.toLowerCase().includes(term);
  });

  function togglePerson(person) {
    const selected = selectedPeople.some((item) => item.id === person.id);
    setSelectedPeople(selected ? selectedPeople.filter((item) => item.id !== person.id) : [...selectedPeople, person]);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!groupName.trim()) {
      setError("Enter a group name.");
      return;
    }
    if (selectedPeople.length < 2) {
      setError("Select at least 2 people.");
      return;
    }

    try {
      await onCreateGroup(groupName, selectedPeople.map((person) => person.id));
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel" role="dialog" aria-modal="true" aria-labelledby="create-group-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2 id="create-group-title">Create group</h2>
            <p>{selectedPeople.length + 1} members selected</p>
          </div>
          <button className="iconButton" type="button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <form className="groupForm" onSubmit={submit}>
          <label>
            Group name
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Project team" autoFocus />
          </label>

          <div className="searchBox modalSearch">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" />
          </div>

          <div className="memberList">
            <label className="memberOption selected">
              <input type="checkbox" checked readOnly />
              <Avatar user={currentUser} />
              <span>
                <strong>{currentUser.name}</strong>
                <small>{currentUser.email}</small>
              </span>
            </label>

            {loading ? (
              <p className="muted">Loading people...</p>
            ) : (
              filteredPeople.map((person) => {
                const selected = selectedPeople.some((item) => item.id === person.id);
                return (
                  <label key={person.id} className={selected ? "memberOption selected" : "memberOption"}>
                    <input type="checkbox" checked={selected} onChange={() => togglePerson(person)} />
                    <Avatar user={person} />
                    <span>
                      <strong>{person.name}</strong>
                      <small>{person.email}</small>
                    </span>
                  </label>
                );
              })
            )}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="modalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primaryButton" type="submit">
              Create group
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UserProfileModal({ currentUser, onlineUserIds, user, onClose, onCreateDirect, onStartCall }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const data = await api(`/api/users/${getUserId(user)}/profile`);
        if (active) setProfile(data);
      } catch (err) {
        if (active) setError(err.message);
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [user]);

  const profileUser = profile?.user || user;
  const online = onlineUserIds.has(getUserId(profileUser));

  async function startDirect(mode) {
    const chat = await onCreateDirect(getUserId(profileUser));
    onStartCall(chat, mode);
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel profileModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div className="profileHero">
            <Avatar user={profileUser} />
            <div>
              <h2>{profileUser.name}</h2>
              <p>{online ? "Online" : getLastSeenLabel(profileUser)}</p>
            </div>
          </div>
          <button className="iconButton" type="button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="modalBody">
          {error && <p className="error">{error}</p>}
          <div className="profileField">
            <span>Email</span>
            <strong>{profileUser.email}</strong>
          </div>
          <div className="profileActions">
            <button className="secondaryButton" type="button" onClick={() => onCreateDirect(getUserId(profileUser)).then(onClose)}>
              Message
            </button>
            <button className="secondaryButton" type="button" onClick={() => startDirect("voice")}>
              <Phone size={16} />
              Voice
            </button>
            <button className="secondaryButton" type="button" onClick={() => startDirect("video")}>
              <Video size={16} />
              Video
            </button>
          </div>
          <section className="sharedGroups">
            <h3>Shared groups</h3>
            {(profile?.sharedGroups || []).length === 0 ? (
              <p className="muted">No shared groups.</p>
            ) : (
              profile.sharedGroups.map((group) => (
                <div className="sharedGroup" key={group.id}>
                  <strong>{group.name}</strong>
                  <span>{group.memberCount} members</span>
                </div>
              ))
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function GroupSettingsModal({ chat, currentUser, onAddMembers, onClose, onLeave, onPromote, onRemoveMember, onRename }) {
  const [name, setName] = useState(chat.name || "");
  const [people, setPeople] = useState([]);
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [error, setError] = useState("");
  const currentUserId = currentUser.id;
  const isAdmin = chat.admins?.some((admin) => admin._id === currentUserId);
  const memberIds = new Set(chat.members.map((member) => member._id));
  const memberKey = chat.members.map((member) => member._id).join(",");

  useEffect(() => {
    let active = true;

    async function loadPeople() {
      try {
        const users = await api("/api/users");
        if (active) setPeople(users.filter((user) => !memberIds.has(user.id)));
      } catch (err) {
        if (active) setError(err.message);
      }
    }

    loadPeople();

    return () => {
      active = false;
    };
  }, [chat._id, memberKey]);

  async function rename(event) {
    event.preventDefault();
    setError("");
    try {
      await onRename(chat._id, name);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addMembers() {
    if (selectedPeople.length === 0) return;
    setError("");
    try {
      await onAddMembers(chat._id, selectedPeople.map((person) => person.id));
      setSelectedPeople([]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel groupSettingsModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h2>Group settings</h2>
            <p>{chat.members.length} members</p>
          </div>
          <button className="iconButton" type="button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="modalBody">
          {error && <p className="error">{error}</p>}
          <form className="renameGroupForm" onSubmit={rename}>
            <input value={name} onChange={(event) => setName(event.target.value)} disabled={!isAdmin} />
            {isAdmin && <button className="secondaryButton" type="submit">Rename</button>}
          </form>

          {isAdmin && (
            <section>
              <h3>Add people</h3>
              <div className="groupMemberActions">
                {people.map((person) => {
                  const selected = selectedPeople.some((item) => item.id === person.id);
                  return (
                    <button
                      className={selected ? "selected" : ""}
                      key={person.id}
                      type="button"
                      onClick={() => setSelectedPeople(selected ? selectedPeople.filter((item) => item.id !== person.id) : [...selectedPeople, person])}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
              <button className="secondaryButton notifyButton" type="button" onClick={addMembers}>
                <UserPlus size={16} />
                Add selected
              </button>
            </section>
          )}

          <section>
            <h3>Members</h3>
            <div className="settingsMemberList">
              {chat.members.map((member) => {
                const memberIsAdmin = chat.admins?.some((admin) => admin._id === member._id);
                return (
                  <div className="settingsMember" key={member._id}>
                    <Avatar user={member} />
                    <span>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </span>
                    {memberIsAdmin && <Shield size={16} />}
                    {isAdmin && member._id !== currentUserId && (
                      <div className="memberAdminActions">
                        {!memberIsAdmin && (
                          <button type="button" onClick={() => onPromote(chat._id, member._id)}>
                            Promote
                          </button>
                        )}
                        <button type="button" onClick={() => onRemoveMember(chat._id, member._id)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <button className="dangerButton" type="button" onClick={() => onLeave(chat._id)}>
            Leave group
          </button>
        </div>
      </section>
    </div>
  );
}

function Sidebar({ chats, selectedChat, currentUser, onlineUserIds, onSelect, onCreateDirect, onCreateGroup }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setPeople([]);
        return;
      }
      const users = await api(`/api/users?q=${encodeURIComponent(query)}`);
      setPeople(users);
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <aside className="sidebar">
      <div className="sidebarHeader">
        <div>
          <span className="eyebrow">Workspace</span>
          <h2>Chats</h2>
        </div>
        <button className="iconButton" title="New group" onClick={() => setShowCreateGroup(true)}>
          <Plus size={18} />
        </button>
      </div>

      <div className="searchBox">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find people" />
      </div>

      {people.length > 0 && (
        <div className="peopleResults">
          {people.map((person) => (
            <button key={person.id} onClick={() => onCreateDirect(person.id)}>
              <Avatar user={person} />
              <span>{person.name}</span>
            </button>
          ))}
        </div>
      )}

      <nav className="chatList">
        {chats.map((chat) => {
          const title = getChatTitle(chat, currentUser);
          const other = chat.members.find((member) => member._id !== currentUser.id);
          const onlineCount = chat.members.filter((member) => onlineUserIds.has(member._id)).length;
          const isOnline = chat.isGroup ? onlineCount > 1 : onlineUserIds.has(other?._id);
          const statusText = chat.isGroup
            ? `${onlineCount} online`
            : isOnline
              ? "Online"
              : getLastSeenLabel(other);

          return (
            <button
              key={chat._id}
              className={selectedChat?._id === chat._id ? "chatItem active" : "chatItem"}
              onClick={() => onSelect(chat)}
            >
              <Avatar user={chat.isGroup ? null : other} title={title} />
              <span>
                <strong>{title}</strong>
                <small>
                  {statusText} ·{" "}
                  {chat.lastMessage?.body || (chat.lastMessage?.attachments?.length ? "Attachment" : `${chat.members.length} member${chat.members.length === 1 ? "" : "s"}`)}
                </small>
              </span>
              {chat.isGroup && <Users size={15} />}
            </button>
          );
        })}
      </nav>

      {showCreateGroup && (
        <CreateGroupModal
          currentUser={currentUser}
          onClose={() => setShowCreateGroup(false)}
          onCreateGroup={onCreateGroup}
        />
      )}
    </aside>
  );
}

function ChatWindow({
  chat,
  currentUser,
  messages,
  onlineUserIds,
  typingUsers,
  onDeleteMessage,
  onEditMessage,
  onOpenGroupSettings,
  onOpenProfile,
  onReactMessage,
  onSend,
  onTypingChange,
  onStartCall
}) {
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [editingMessage, setEditingMessage] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingActiveRef = useRef(false);
  const title = getChatTitle(chat, currentUser);
  const typingLabel = getTypingLabel(chat, currentUser, typingUsers);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function stopTyping() {
    clearTimeout(typingTimerRef.current);
    if (!chat || !typingActiveRef.current) return;
    typingActiveRef.current = false;
    onTypingChange(chat._id, false);
  }

  useEffect(() => () => stopTyping(), [chat?._id]);

  if (!chat) {
    return (
      <section className="emptyState">
        <MessageCircle size={42} />
        <h2>Select a chat</h2>
        <p>Search for people, open a conversation, or create a group.</p>
      </section>
    );
  }

  async function addAttachments(files) {
    setAttachmentError("");
    const selectedFiles = [...files];
    const nextFiles = selectedFiles.slice(0, maxAttachments - attachments.length);

    if (selectedFiles.length + attachments.length > maxAttachments) {
      setAttachmentError(`You can attach up to ${maxAttachments} files.`);
    }

    const tooLarge = nextFiles.find((file) => file.size > maxAttachmentSize);
    if (tooLarge) {
      setAttachmentError(`${tooLarge.name} is larger than ${formatFileSize(maxAttachmentSize)}.`);
      return;
    }

    try {
      const nextAttachments = await Promise.all(nextFiles.map(fileToAttachment));
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (err) {
      setAttachmentError(err.message);
    }
  }

  function removeAttachment(index) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handleBodyChange(event) {
    const nextValue = event.target.value;
    setBody(nextValue);

    if (!chat) return;

    clearTimeout(typingTimerRef.current);
    if (!nextValue.trim()) {
      stopTyping();
      return;
    }

    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      onTypingChange(chat._id, true);
    }

    typingTimerRef.current = setTimeout(() => {
      stopTyping();
    }, 1400);
  }

  async function submit(event) {
    event.preventDefault();
    if (!body.trim() && attachments.length === 0) return;

    setSending(true);
    try {
      stopTyping();
      await onSend(body, attachments, replyTo?._id);
      setBody("");
      setAttachments([]);
      setAttachmentError("");
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editingMessage || !editBody.trim()) return;
    await onEditMessage(editingMessage._id, editBody);
    setEditingMessage(null);
    setEditBody("");
  }

  function startEdit(message) {
    setEditingMessage(message);
    setEditBody(message.body || "");
  }

  async function copyMessage(message) {
    await navigator.clipboard?.writeText(getMessagePreview(message));
  }

  const other = chat.members.find((member) => member._id !== currentUser.id);
  const onlineCount = chat.members.filter((member) => onlineUserIds.has(member._id)).length;
  const statusText = chat.isGroup
    ? `${onlineCount} online · ${chat.members.length} members`
    : onlineUserIds.has(other?._id)
      ? "Online"
      : "Offline";

  return (
    <section className="chatWindow">
      <header className="chatHeader">
        <div>
          <button
            className="chatTitleButton"
            type="button"
            onClick={() => (chat.isGroup ? onOpenGroupSettings(chat) : other && onOpenProfile(other))}
          >
            <h2>{title}</h2>
          </button>
          <p>{statusText}</p>
          {typingLabel && <p className="typingIndicator">{typingLabel}</p>}
        </div>
        <div className="callActions">
          {chat.isGroup && (
            <button className="iconButton" title="Group settings" onClick={() => onOpenGroupSettings(chat)}>
              <Settings size={18} />
            </button>
          )}
          <button className="iconButton" title="Start voice call" onClick={() => onStartCall(chat, "voice")}>
            <Phone size={18} />
          </button>
          <button className="iconButton" title="Start video call" onClick={() => onStartCall(chat, "video")}>
            <Video size={18} />
          </button>
        </div>
      </header>

      <div className="messages">
        {messages.map((message) => {
          const mine = message.sender._id === currentUser.id;
          const deleted = Boolean(message.deletedAt);
          return (
            <article key={message._id} className={mine ? "message mine" : "message"}>
              {!mine && (
                <button className="avatarButton" type="button" onClick={() => onOpenProfile(message.sender)}>
                  <Avatar user={message.sender} />
                </button>
              )}
              <div className="messageContent">
                {!mine && (
                  <button className="senderNameButton" type="button" onClick={() => onOpenProfile(message.sender)}>
                    {message.sender.name}
                  </button>
                )}
                {message.replyTo && (
                  <button className="replyReference" type="button">
                    <strong>{message.replyTo.sender?.name || "Reply"}</strong>
                    <span>{getMessagePreview(message.replyTo)}</span>
                  </button>
                )}
                {editingMessage?._id === message._id ? (
                  <form className="editMessageForm" onSubmit={saveEdit}>
                    <input value={editBody} onChange={(event) => setEditBody(event.target.value)} autoFocus />
                    <button className="secondaryButton" type="button" onClick={() => setEditingMessage(null)}>
                      Cancel
                    </button>
                    <button className="primaryButton" type="submit">
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    {deleted ? <p className="deletedMessage">Message deleted</p> : message.body && <p>{message.body}</p>}
                    {!deleted && <MessageAttachments attachments={message.attachments} />}
                    {message.editedAt && !deleted && <small className="editedLabel">Edited</small>}
                  </>
                )}
                {message.reactions?.length > 0 && (
                  <div className="reactionSummary">
                    {groupReactions(message.reactions).map((reaction) => (
                      <button key={reaction.emoji} type="button" onClick={() => onReactMessage(message._id, reaction.emoji)}>
                        {reaction.emoji} {reaction.count}
                      </button>
                    ))}
                  </div>
                )}
                {mine && !deleted && (
                  <div className="messageReceipt">
                    {(() => {
                      const receipt = getMessageReceipt(message, chat, currentUser);
                      if (!receipt) return null;
                      const Icon = receipt.icon;

                      return (
                        <span className={`receiptChip ${receipt.tone}`}>
                          <Icon size={12} />
                          {receipt.label}
                        </span>
                      );
                    })()}
                  </div>
                )}
                {!deleted && (
                  <div className="messageActions">
                    {reactionOptions.map((emoji) => (
                      <button key={emoji} type="button" title={`React ${emoji}`} onClick={() => onReactMessage(message._id, emoji)}>
                        {emoji}
                      </button>
                    ))}
                    <button type="button" title="Reply" onClick={() => setReplyTo(message)}>
                      <Reply size={14} />
                    </button>
                    <button type="button" title="Copy" onClick={() => copyMessage(message)}>
                      <Copy size={14} />
                    </button>
                    {mine && message.body && (
                      <button type="button" title="Edit" onClick={() => startEdit(message)}>
                        <Edit3 size={14} />
                      </button>
                    )}
                    {mine && (
                      <button type="button" title="Delete" onClick={() => onDeleteMessage(message._id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        <span ref={scrollRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        {replyTo && (
          <div className="replyComposer">
            <span>
              Replying to <strong>{replyTo.sender?.name || "message"}</strong>: {getMessagePreview(replyTo)}
            </span>
            <button type="button" title="Cancel reply" onClick={() => setReplyTo(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachmentPreviewBar">
            {attachments.map((attachment, index) => (
              <div className="attachmentPreview" key={`${attachment.name}-${index}`}>
                {attachment.type.startsWith("image/") ? <img src={attachment.dataUrl} alt={attachment.name} /> : <FileText size={18} />}
                <span>{attachment.name}</span>
                <button type="button" title="Remove attachment" onClick={() => removeAttachment(index)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && <p className="attachmentError">{attachmentError}</p>}
        <input
          ref={fileInputRef}
          className="fileInput"
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          onChange={(event) => {
            addAttachments(event.target.files);
            event.target.value = "";
          }}
        />
        <button className="iconButton" title="Attach files" type="button" onClick={() => fileInputRef.current?.click()}>
          <Image size={18} />
        </button>
        <input value={body} onChange={handleBodyChange} placeholder={`Message ${title}`} />
        <button className="iconButton sendButton" title="Send message" type="submit" disabled={sending}>
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function StreamPlayer({ stream, muted = false, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function CallPanel({ call, onEnd }) {
  const remoteStreams = call.remoteStreams || [];
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 720px)").matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const handleChange = (event) => setIsMobile(event.matches);

    mediaQuery.addEventListener("change", handleChange);
    setIsMobile(mediaQuery.matches);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setMaximized(true);
    }
  }, [isMobile]);

  function toggleMute() {
    const nextMuted = !muted;
    call.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }

  function toggleCamera() {
    const nextCameraOff = !cameraOff;
    call.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    setCameraOff(nextCameraOff);
  }

  function minimizeCall() {
    setMaximized(false);
    setMinimized(true);
  }

  function toggleMaximized() {
    setMinimized(false);
    setMaximized((current) => !current);
  }

  const panelClass = [
    "callPanel",
    minimized ? "minimized" : "",
    maximized ? "maximized" : "",
    isMobile ? "mobile" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={panelClass}>
      <header className="callPanelHeader">
        <div>
          <strong>{getChatTitle(call.chat, call.currentUser)}</strong>
          <span>{call.mode === "video" ? "Video call" : "Voice call"} · {call.status}</span>
        </div>
        <div className="callWindowActions">
          {minimized ? (
            <button
              className="callIconButton"
              type="button"
              title="Restore call"
              onClick={() => {
                setMinimized(false);
                if (isMobile) setMaximized(true);
              }}
            >
              <Maximize2 size={16} />
            </button>
          ) : (
            <>
              <button className="callIconButton" type="button" title="Minimize call" onClick={minimizeCall}>
                <Minus size={16} />
              </button>
              <button className="callIconButton" type="button" title={maximized ? "Restore size" : "Maximize call"} onClick={toggleMaximized}>
                {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </>
          )}
          <button className="callIconButton danger" type="button" title="End call" onClick={onEnd}>
            <PhoneOff size={16} />
          </button>
        </div>
      </header>

      {!minimized && (
        <div className="callPanelBody">
          <div className={call.mode === "video" ? "videoGrid" : "voiceCallBody"}>
            {call.mode === "video" && call.localStream && (
              <div className={cameraOff ? "videoTile localVideo cameraDisabled" : "videoTile localVideo"}>
                <StreamPlayer stream={call.localStream} muted />
                {cameraOff && <VideoOff size={34} />}
                <span>You {muted ? "· muted" : ""}</span>
              </div>
            )}

            {remoteStreams.map((item) => (
              <div className="videoTile" key={item.userId}>
                {call.mode === "video" ? (
                  <StreamPlayer stream={item.stream} />
                ) : (
                  <>
                    <StreamPlayer stream={item.stream} className="audioStream" />
                    <Phone size={30} />
                  </>
                )}
                <span>{item.name || "Participant"}</span>
              </div>
            ))}

            {remoteStreams.length === 0 && (
              <div className="waitingCall">
                <Phone size={32} />
                <span>Waiting for someone to join...</span>
              </div>
            )}
          </div>

          <div className="callControls">
            <button className={muted ? "callControl active" : "callControl"} type="button" title={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>
            {call.mode === "video" && (
              <button
                className={cameraOff ? "callControl active" : "callControl"}
                type="button"
                title={cameraOff ? "Turn camera on" : "Turn camera off"}
                onClick={toggleCamera}
              >
                {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
                <span>{cameraOff ? "Camera on" : "Camera off"}</span>
              </button>
            )}
            <button className="callControl danger" type="button" title="End call" onClick={onEnd}>
              <PhoneOff size={18} />
              <span>End</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatApp({ currentUser, token, onLogout }) {
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [resumeCallSession, setResumeCallSession] = useState(() => {
    const session = getStoredCallSession();
    return session?.userId === currentUser.id ? session : null;
  });
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsersByChat, setTypingUsersByChat] = useState({});
  const [profileUser, setProfileUser] = useState(null);
  const [groupSettingsChat, setGroupSettingsChat] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const activeCallRef = useRef(null);
  const hasSyncedCallSessionRef = useRef(false);
  const chatsRef = useRef([]);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const selectedChatRef = useRef(null);

  const messages = useMemo(() => messagesByChat[selectedChat?._id] || [], [messagesByChat, selectedChat]);
  const onlineUserIds = useMemo(() => new Set(onlineUsers), [onlineUsers]);
  const resumeCallChat = useMemo(
    () => (resumeCallSession ? chats.find((item) => item._id === resumeCallSession.chatId) : null),
    [chats, resumeCallSession]
  );

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  useEffect(() => {
    if (resumeCallSession && chats.length > 0 && !resumeCallChat) {
      setResumeCallSession(null);
      localStorage.removeItem("chat_call_session");
    }
  }, [chats.length, resumeCallChat, resumeCallSession]);

  useEffect(() => {
    if (!hasSyncedCallSessionRef.current) {
      hasSyncedCallSessionRef.current = true;
      return;
    }

    if (activeCall?.chat?._id) {
      localStorage.setItem(
        "chat_call_session",
        JSON.stringify({
          chatId: activeCall.chat._id,
          chatName: getChatTitle(activeCall.chat, currentUser),
          mode: activeCall.mode,
          userId: currentUser.id
        })
      );
      return;
    }

    localStorage.removeItem("chat_call_session");
  }, [activeCall, currentUser]);

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  function replaceMessage(message) {
    setMessagesByChat((current) => ({
      ...current,
      [message.chat]: (current[message.chat] || []).map((item) => (item._id === message._id ? message : item))
    }));
  }

  function updateMessagesByIds(chatId, messageIds, updater) {
    const ids = new Set(messageIds);
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: (current[chatId] || []).map((message) => (ids.has(message._id) ? updater(message) : message))
    }));
  }

  function updateReceiptList(list = [], userId) {
    const next = getReceiptUserIds(list);
    if (!next.includes(userId)) next.push(userId);
    return next;
  }

  function handleMessageDelivered({ chatId, userId, messageIds = [] }) {
    updateMessagesByIds(chatId, messageIds, (message) => ({
      ...message,
      deliveredTo: updateReceiptList(message.deliveredTo, userId)
    }));
  }

  function handleMessageRead({ chatId, userId, messageIds = [] }) {
    updateMessagesByIds(chatId, messageIds, (message) => ({
      ...message,
      deliveredTo: updateReceiptList(message.deliveredTo, userId),
      readBy: updateReceiptList(message.readBy, userId)
    }));
  }

  function handleTypingEvent(chatId, userId, isTyping) {
    setTypingUsersByChat((current) => {
      const existing = current[chatId] || [];
      const member =
        chatsRef.current.flatMap((chat) => chat.members || []).find((item) => getUserId(item) === userId) || { _id: userId };
      const nextUsers = isTyping
        ? existing.some((item) => getUserId(item) === userId)
          ? existing
          : [...existing, member]
        : existing.filter((item) => getUserId(item) !== userId);

      if (nextUsers.length === 0) {
        const next = { ...current };
        delete next[chatId];
        return next;
      }

      return {
        ...current,
        [chatId]: nextUsers
      };
    });
  }

  function emitTyping(chatId, isTyping) {
    getSocket()?.emit(isTyping ? "typing:start" : "typing:stop", { chatId });
  }

  async function connectToCall(chat, mode) {
    closeCall(false);
    const stream = await getCallStream(mode);
    localStreamRef.current = stream;
    const nextCall = { chat, currentUser, mode, status: "connecting", localStream: stream, remoteStreams: [] };
    setSelectedChat(chat);
    activeCallRef.current = nextCall;
    setActiveCall(nextCall);
    return nextCall;
  }

  async function joinCallSession(session) {
    const chat = chats.find((item) => item._id === session.chatId);
    if (!chat) {
      alert("Saved call session could not be found.");
      setResumeCallSession(null);
      return;
    }

    try {
      await connectToCall(chat, session.mode);
      acceptCall(chat._id, session.mode);
      setResumeCallSession(null);
    } catch (err) {
      alert(err.message || "Could not rejoin call");
      closeCall(false);
    }
  }

  function updateRemoteStream(userId, stream) {
    const chat = activeCallRef.current?.chat || selectedChat;
    const member = chat?.members.find((item) => item._id === userId);

    setActiveCall((current) => {
      if (!current) return current;
      const remoteStreams = current.remoteStreams || [];
      const exists = remoteStreams.some((item) => item.userId === userId);
      const nextStream = { userId, name: member?.name, stream };

      return {
        ...current,
        status: "connected",
        remoteStreams: exists
          ? remoteStreams.map((item) => (item.userId === userId ? nextStream : item))
          : [...remoteStreams, nextStream]
      };
    });
  }

  function createPeerConnection(userId, chatId) {
    const existing = peerConnectionsRef.current.get(userId);
    if (existing && !["closed", "failed", "disconnected"].includes(existing.connectionState)) return existing;
    if (existing) {
      existing.close();
      peerConnectionsRef.current.delete(userId);
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    localStreamRef.current?.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStreamRef.current);
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) sendIceCandidate(chatId, event.candidate, userId);
    };

    peerConnection.ontrack = (event) => {
      updateRemoteStream(userId, event.streams[0]);
    };

    peerConnection.onconnectionstatechange = () => {
      if (["closed", "failed", "disconnected"].includes(peerConnection.connectionState)) {
        peerConnectionsRef.current.delete(userId);
      }
    };

    peerConnectionsRef.current.set(userId, peerConnection);
    return peerConnection;
  }

  async function getCallStream(mode) {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video"
    });
  }

  function closeCall(shouldNotify = true) {
    const call = activeCallRef.current;
    if (shouldNotify && call?.chat?._id) endCall(call.chat._id);

    peerConnectionsRef.current.forEach((peerConnection) => peerConnection.close());
    peerConnectionsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    activeCallRef.current = null;
    setActiveCall(null);
    setIncomingCall(null);
  }

  async function startCall(chat, mode) {
    try {
      const nextCall = await connectToCall(chat, mode);
      setActiveCall({ ...nextCall, status: "calling" });
      activeCallRef.current = { ...nextCall, status: "calling" };
      inviteCall(chat._id, mode);
    } catch (err) {
      alert(err.message || "Could not start call");
    }
  }

  async function acceptIncomingCall() {
    if (!incomingCall) return;

    const chat = incomingCall.chat || chats.find((item) => item._id === incomingCall.chatId) || selectedChat;
    try {
      await connectToCall(chat, incomingCall.mode);
      acceptCall(incomingCall.chatId, incomingCall.mode);
      setIncomingCall(null);
    } catch (err) {
      alert(err.message || "Could not answer call");
    }
  }

  function rejectIncomingCall() {
    if (incomingCall) rejectCall(incomingCall.chatId);
    setIncomingCall(null);
  }

  useEffect(() => {
    async function loadChats() {
      const data = await api("/api/chats");
      setChats(data);
      setSelectedChat(data[0] || null);
    }

    loadChats();
  }, []);

  useEffect(() => {
    const socket = connectSocket(token);

    socket.on("message:new", (message) => {
      const senderId = message.sender?._id || message.sender?.id;
      const activeChat = selectedChatRef.current;
      const chat = chatsRef.current.find((item) => item._id === message.chat);

      if (senderId !== currentUser.id && (!activeChat || activeChat._id !== message.chat || document.hidden || !document.hasFocus())) {
        showBrowserNotification(message.sender?.name || "New message", {
          body: `${chat ? `${getChatTitle(chat, currentUser)}: ` : ""}${message.body || "Sent an attachment"}`,
          tag: `message:${message.chat}`
        });
      }

      setMessagesByChat((current) => ({
        ...current,
        [message.chat]: (current[message.chat] || []).some((item) => item._id === message._id)
          ? current[message.chat]
          : [...(current[message.chat] || []), message]
      }));
    });
    socket.on("message:updated", replaceMessage);
    socket.on("message:delivered", handleMessageDelivered);
    socket.on("message:read", handleMessageRead);

    socket.on("typing:start", ({ chatId, userId }) => {
      handleTypingEvent(chatId, userId, true);
    });
    socket.on("typing:stop", ({ chatId, userId }) => {
      handleTypingEvent(chatId, userId, false);
    });

    socket.on("chat:created", (chat) => {
      joinChat(chat._id);
      setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    });

    socket.on("chat:updated", (chat) => {
      setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
      setSelectedChat((current) => (current?._id === chat._id ? chat : current));
      setGroupSettingsChat((current) => (current?._id === chat._id ? chat : current));
    });
    socket.on("chat:removed", ({ chatId }) => {
      setChats((current) => current.filter((item) => item._id !== chatId));
      setSelectedChat((current) => (current?._id === chatId ? null : current));
      setGroupSettingsChat((current) => (current?._id === chatId ? null : current));
    });

    socket.on("presence:online", (userIds) => setOnlineUsers(userIds));
    socket.on("presence:user-online", ({ userId }) => {
      setOnlineUsers((current) => (current.includes(userId) ? current : [...current, userId]));
    });
    socket.on("presence:user-offline", ({ userId, lastSeenAt }) => {
      setOnlineUsers((current) => current.filter((item) => item !== userId));
      setChats((current) =>
        current.map((chat) => ({
          ...chat,
          members: chat.members.map((member) =>
            getUserId(member) === userId ? { ...member, lastSeenAt } : member
          )
        }))
      );
      setSelectedChat((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                getUserId(member) === userId ? { ...member, lastSeenAt } : member
              )
            }
          : current
      );
      setGroupSettingsChat((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                getUserId(member) === userId ? { ...member, lastSeenAt } : member
              )
            }
          : current
      );
      setProfileUser((current) => (current && getUserId(current) === userId ? { ...current, lastSeenAt } : current));
    });

    socket.on("call:invite", (event) => {
      if (event.chat) {
        setChats((current) => [event.chat, ...current.filter((item) => item._id !== event.chat._id)]);
      }
      showBrowserNotification(`Incoming ${event.mode} call`, {
        body: `${event.from.name} · ${event.chat?.name || "Direct chat"}`,
        requireInteraction: true,
        tag: `call:${event.chatId}`
      });
      if (!activeCallRef.current) setIncomingCall(event);
    });
    socket.on("call:accept", async (event) => {
      const call = activeCallRef.current;
      const fromUserId = getUserId(event.from);
      if (!call || call.chat._id !== event.chatId || !fromUserId) return;

      const peerConnection = createPeerConnection(fromUserId, event.chatId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      sendOffer(event.chatId, offer, fromUserId);
    });
    socket.on("call:end", () => closeCall(false));
    socket.on("call:reject", () => setIncomingCall(null));
    socket.on("webrtc:offer", async ({ chatId, offer, fromUserId }) => {
      const call = activeCallRef.current;
      if (!call || call.chat._id !== chatId || !fromUserId) return;

      const peerConnection = createPeerConnection(fromUserId, chatId);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      sendAnswer(chatId, answer, fromUserId);
    });
    socket.on("webrtc:answer", async ({ chatId, answer, fromUserId }) => {
      const call = activeCallRef.current;
      const peerConnection = peerConnectionsRef.current.get(fromUserId);
      if (!call || call.chat._id !== chatId || !peerConnection) return;

      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on("webrtc:ice-candidate", async ({ chatId, candidate, fromUserId }) => {
      const call = activeCallRef.current;
      const peerConnection = peerConnectionsRef.current.get(fromUserId);
      if (!call || call.chat._id !== chatId || !peerConnection || !candidate) return;

      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });

    return () => {
      socket.off("message:new");
      socket.off("message:updated");
      socket.off("message:delivered");
      socket.off("message:read");
      socket.off("typing:start");
      socket.off("typing:stop");
      socket.off("chat:created");
      socket.off("chat:updated");
      socket.off("chat:removed");
      socket.off("presence:online");
      socket.off("presence:user-online");
      socket.off("presence:user-offline");
      socket.off("call:invite");
      socket.off("call:accept");
      socket.off("call:end");
      socket.off("call:reject");
      socket.off("webrtc:offer");
      socket.off("webrtc:answer");
      socket.off("webrtc:ice-candidate");
    };
  }, [token]);

  useEffect(() => {
    if (!selectedChat || messagesByChat[selectedChat._id]) return;

    async function loadMessages() {
      const data = await api(`/api/chats/${selectedChat._id}/messages`);
      setMessagesByChat((current) => ({ ...current, [selectedChat._id]: data }));
    }

    loadMessages();
  }, [selectedChat, messagesByChat]);

  useEffect(() => {
    function syncReadReceipts() {
      if (!selectedChat || document.hidden || !document.hasFocus()) return;

      const unreadMessageIds = messages
        .filter((message) => getUserId(message.sender) !== currentUser.id)
        .filter((message) => !getReceiptUserIds(message.readBy).includes(currentUser.id))
        .map((message) => message._id);

      if (unreadMessageIds.length === 0) return;
      getSocket()?.emit("message:read", { chatId: selectedChat._id, messageIds: unreadMessageIds });
    }

    syncReadReceipts();
    window.addEventListener("focus", syncReadReceipts);
    document.addEventListener("visibilitychange", syncReadReceipts);

    return () => {
      window.removeEventListener("focus", syncReadReceipts);
      document.removeEventListener("visibilitychange", syncReadReceipts);
    };
  }, [selectedChat, messages, currentUser.id]);

  async function createDirect(memberId) {
    const chat = await api("/api/chats/direct", {
      method: "POST",
      body: JSON.stringify({ memberId })
    });
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    joinChat(chat._id);
    setSelectedChat(chat);
    return chat;
  }

  async function createGroup(name, memberIds) {
    const chat = await api("/api/chats/groups", {
      method: "POST",
      body: JSON.stringify({ name, memberIds })
    });
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    joinChat(chat._id);
    setSelectedChat(chat);
  }

  async function renameGroup(chatId, name) {
    const chat = await api(`/api/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    setSelectedChat((current) => (current?._id === chat._id ? chat : current));
    setGroupSettingsChat(chat);
  }

  async function addGroupMembers(chatId, memberIds) {
    const chat = await api(`/api/chats/${chatId}/members`, {
      method: "POST",
      body: JSON.stringify({ memberIds })
    });
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    setSelectedChat((current) => (current?._id === chat._id ? chat : current));
    setGroupSettingsChat(chat);
  }

  async function removeGroupMember(chatId, memberId) {
    const chat = await api(`/api/chats/${chatId}/members/${memberId}`, {
      method: "DELETE"
    });
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    setSelectedChat((current) => (current?._id === chat._id ? chat : current));
    setGroupSettingsChat(chat);
  }

  async function promoteGroupMember(chatId, memberId) {
    const chat = await api(`/api/chats/${chatId}/admins/${memberId}`, {
      method: "POST"
    });
    setChats((current) => [chat, ...current.filter((item) => item._id !== chat._id)]);
    setSelectedChat((current) => (current?._id === chat._id ? chat : current));
    setGroupSettingsChat(chat);
  }

  async function leaveGroup(chatId) {
    await api(`/api/chats/${chatId}/leave`, {
      method: "DELETE"
    });
    setChats((current) => current.filter((item) => item._id !== chatId));
    setSelectedChat((current) => (current?._id === chatId ? null : current));
    setGroupSettingsChat(null);
  }

  async function editMessage(messageId, body) {
    const message = await api(`/api/chats/${selectedChat._id}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
    replaceMessage(message);
  }

  async function deleteMessage(messageId) {
    const message = await api(`/api/chats/${selectedChat._id}/messages/${messageId}`, {
      method: "DELETE"
    });
    replaceMessage(message);
  }

  async function reactMessage(messageId, emoji) {
    const message = await api(`/api/chats/${selectedChat._id}/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji })
    });
    replaceMessage(message);
  }

  async function sendMessage(body, attachments = [], replyTo) {
    const message = await api(`/api/chats/${selectedChat._id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, attachments, replyTo })
    });
    setMessagesByChat((current) => {
      const currentMessages = current[selectedChat._id] || [];
      if (currentMessages.some((item) => item._id === message._id)) return current;

      return {
        ...current,
        [selectedChat._id]: [...currentMessages, message]
      };
    });
  }

  function logout() {
    closeCall();
    localStorage.removeItem("chat_token");
    localStorage.removeItem("chat_user");
    disconnectSocket();
    onLogout();
  }

  return (
    <main className="appShell">
      <Sidebar
        chats={chats}
        currentUser={currentUser}
        selectedChat={selectedChat}
        onlineUserIds={onlineUserIds}
        onSelect={setSelectedChat}
        onCreateDirect={createDirect}
        onCreateGroup={createGroup}
      />
      <ChatWindow
        chat={selectedChat}
        currentUser={currentUser}
        messages={messages}
        onlineUserIds={onlineUserIds}
        typingUsers={typingUsersByChat[selectedChat?._id] || []}
        onDeleteMessage={deleteMessage}
        onEditMessage={editMessage}
        onOpenGroupSettings={setGroupSettingsChat}
        onOpenProfile={setProfileUser}
        onReactMessage={reactMessage}
        onSend={sendMessage}
        onTypingChange={emitTyping}
        onStartCall={startCall}
      />
      <aside className="detailsPanel">
        <div className="profileLine">
          <Avatar user={currentUser} />
          <div>
            <strong>{currentUser.name}</strong>
            <small>{currentUser.email}</small>
          </div>
        </div>
        <button className="secondaryButton" onClick={logout}>
          Logout
        </button>

        <section>
          <h3>Presence</h3>
          <p>{onlineUsers.length} user{onlineUsers.length === 1 ? "" : "s"} online now.</p>
        </section>

        <section>
          <h3>Notifications</h3>
          <p>
            {notificationPermission === "granted"
              ? "Browser notifications are on."
              : notificationPermission === "denied"
                ? "Notifications are blocked in this browser."
                : notificationPermission === "unsupported"
                  ? "Notifications are not supported here."
                  : "Enable alerts for messages and calls."}
          </p>
          {notificationPermission === "default" && (
            <button className="secondaryButton notifyButton" type="button" onClick={enableNotifications}>
              <Bell size={16} />
              Enable
            </button>
          )}
        </section>
      </aside>

      {activeCall && <CallPanel call={activeCall} onEnd={() => closeCall()} />}

      {profileUser && (
        <UserProfileModal
          currentUser={currentUser}
          onlineUserIds={onlineUserIds}
          user={profileUser}
          onClose={() => setProfileUser(null)}
          onCreateDirect={createDirect}
          onStartCall={startCall}
        />
      )}

      {groupSettingsChat && (
        <GroupSettingsModal
          chat={groupSettingsChat}
          currentUser={currentUser}
          onAddMembers={addGroupMembers}
          onClose={() => setGroupSettingsChat(null)}
          onLeave={leaveGroup}
          onPromote={promoteGroupMember}
          onRemoveMember={removeGroupMember}
          onRename={renameGroup}
        />
      )}

      {incomingCall && (
        <div className="callToast">
          <div className="incomingCallHeader">
            <Avatar user={incomingCall.from} />
            <div>
              <strong>{incomingCall.from.name}</strong>
              <span>Incoming {incomingCall.mode} call · {incomingCall.chat?.name || "Direct chat"}</span>
            </div>
          </div>
          <div className="callToastActions">
            <button className="primaryButton" type="button" onClick={acceptIncomingCall}>
              Accept
            </button>
            <button className="secondaryButton" type="button" onClick={rejectIncomingCall}>
              Reject
            </button>
          </div>
        </div>
      )}

      {resumeCallSession && !activeCall && !incomingCall && (
        <div className="callToast">
          <div className="incomingCallHeader">
            <div className="resumeCallIcon">
              <Phone size={18} />
            </div>
            <div>
              <strong>Rejoin call</strong>
              <span>{resumeCallSession.chatName || "Previous call"} · {resumeCallSession.mode} call</span>
            </div>
          </div>
          <p className="resumeCallText">Your last call session is still recoverable after refresh.</p>
          <div className="callToastActions">
            <button className="primaryButton" type="button" disabled={!resumeCallChat} onClick={() => joinCallSession(resumeCallSession)}>
              Rejoin
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={() => {
                setResumeCallSession(null);
                localStorage.removeItem("chat_call_session");
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export function App() {
  const savedUser = localStorage.getItem("chat_user");
  const savedToken = localStorage.getItem("chat_token");
  const [session, setSession] = useState(() =>
    savedUser && savedToken ? { user: JSON.parse(savedUser), token: savedToken } : null
  );

  if (!session) {
    return <AuthView onAuth={(user, token) => setSession({ user, token })} />;
  }

  return <ChatApp currentUser={session.user} token={session.token} onLogout={() => setSession(null)} />;
}
