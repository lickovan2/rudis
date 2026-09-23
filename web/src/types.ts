export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  about: string;
  online: boolean;
}

export type Role = "owner" | "admin" | "member";

export interface Channel {
  id: string;
  serverId: string | null;
  name: string;
  topic: string;
  type: "text" | "voice" | "dm";
  position: number;
  lastMessageAt: number | null;
}

export interface DmChannel extends Channel {
  recipients: User[];
}

export interface VoiceMember {
  socketId: string;
  userId: string;
  muted: boolean;
  deafened: boolean;
}

export interface Server {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  role: Role;
  channels: Channel[];
  voiceStates: Record<string, VoiceMember[]>;
}

export interface Member {
  user: User;
  role: Role;
  joinedAt: number;
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  mime: string;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  channelId: string;
  author: User;
  content: string;
  attachments: Attachment[];
  replyTo: { id: string; author: User | null; content: string | null } | null;
  reactions: Reaction[];
  editedAt: number | null;
  createdAt: number;
}

export interface Friend {
  user: User;
  status: "accepted" | "incoming" | "outgoing";
}
