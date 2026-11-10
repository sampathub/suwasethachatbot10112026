export interface Message {
  id: string;
  role: 'user' | 'model' | 'admin';
  content: string;
  timestamp: string;
  imageUrl?: string;
  deletedByUser?: boolean;
  isAdminMessage?: boolean;
  adminName?: string;
}

export interface ChatSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  messages: Message[];
  contactInfo?: string;
  contactType?: 'telegram' | 'whatsapp' | 'facebook' | 'google' | 'username';
  needsAdminAttention?: boolean;
  adminNotifiedAt?: string;
  directContactNumber?: string;
  userIp?: string;
  userEmail?: string;
  legacySource?: string;
  isLegacyOrExpired?: boolean;
  sourceCollection?: string;
}

export interface VerifiedUser {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  provider?: string;
  createdAt: string;
  lastLoginAt: string;
  lastIp?: string;
  lastSessionId?: string;
}

