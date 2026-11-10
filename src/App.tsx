import { useState, useEffect, useRef, useMemo } from "react";
import { 
  MessageSquare, 
  Send, 
  ShieldCheck, 
  Trash2, 
  Lock, 
  AlertTriangle, 
  Phone, 
  Sparkles, 
  Menu, 
  X, 
  LogOut, 
  HelpCircle, 
  ChevronRight, 
  RefreshCw, 
  Activity, 
  User, 
  CheckCircle2, 
  Clock, 
  CheckSquare,
  Image as ImageIcon,
  Camera,
  AlertCircle,
  Facebook,
  Globe,
  Mail,
  Copy,
  Check,
  Users,
  Search,
  ExternalLink,
  Database,
  Archive,
  FileText,
  MessageSquarePlus,
  ChevronDown,
  ArrowLeft,
  Info,
  Maximize2,
  LogIn,
  KeyRound,
  Eye,
  EyeOff,
  UserPlus
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { auth, googleProvider, facebookProvider, db, sanitizeForFirestore } from "./lib/firebase";
import { registerCustomUser, loginCustomUser, logoutCustomUser, getCurrentCustomUser } from "./lib/authHelpers";
import { doc, getDoc, setDoc, updateDoc, collection, query, orderBy, getDocs, deleteDoc, writeBatch, where, onSnapshot } from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { Message, ChatSession, VerifiedUser } from "./types";
import { AdminFullScreenChat } from "./components/AdminFullScreenChat";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Helper function to compress and resize image on client side (Supports HEIC/HEIF Apple formats)
async function compressAndResizeImage(file: File | Blob, originalFileName = ""): Promise<string> {
  let fileToProcess: Blob | File = file;
  const fileName = ((file as File).name || originalFileName || "").toLowerCase();
  const fileType = (file.type || "").toLowerCase();
  const isHeic = fileType.includes("heic") || fileType.includes("heif") || fileName.endsWith(".heic") || fileName.endsWith(".heif");

  if (isHeic) {
    try {
      // 1. Try client-side conversion via heic2any
      const heic2anyModule = await import("heic2any");
      const heic2any = (heic2anyModule as any).default || heic2anyModule;
      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.8
      });
      fileToProcess = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
    } catch (clientHeicErr) {
      console.warn("Client heic2any conversion note, attempting server-side conversion:", clientHeicErr);
      // 2. Ultra-reliable server-side HEIC conversion fallback
      try {
        const arrayBuf = await file.arrayBuffer();
        const serverRes = await fetch("/api/convert-heic", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: arrayBuf
        });
        if (serverRes.ok) {
          fileToProcess = await serverRes.blob();
        }
      } catch (serverHeicErr) {
        console.warn("Server HEIC fallback note:", serverHeicErr);
      }
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        
        // Optimize to 700px max dimensions for crystal-clear clinical inspection
        const MAX_SIZE = 700;
        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.70);
          resolve(compressedBase64);
        } else {
          resolve(e.target?.result as string);
        }
      };
      img.onerror = () => {
        const resStr = e.target?.result as string;
        if (resStr && resStr.startsWith("data:image/")) {
          resolve(resStr);
        } else {
          reject(new Error("Failed to load image for compression"));
        }
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(fileToProcess);
  });
}


// Helper function to parse Facebook Contact string info
function parseFacebookContact(info?: string) {
  if (!info) return { name: "Facebook User", uid: "", photoURL: "", email: "" };
  if (info.includes("|")) {
    const parts = info.split("|");
    let email = parts[3] || "";
    if (!email) {
      const found = parts.find(p => p.includes("@"));
      if (found) email = found.trim();
    }
    return {
      name: parts[0] || "Facebook User",
      uid: parts[1] || "",
      photoURL: parts[2] || "",
      email: email
    };
  }
  const emailMatch = info.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1] : (info.includes("@") ? info.trim() : "");
  const name = info.replace(/\([^)]+\)/g, "").replace(email, "").trim();
  return { name: name || "Facebook User", uid: "", photoURL: "", email };
}

// Helper function to parse Google Contact string info
function parseGoogleContact(info?: string) {
  if (!info) return { name: "Google User", uid: "", photoURL: "", email: "" };
  if (info.includes("|")) {
    const parts = info.split("|");
    let email = parts[3] || "";
    if (!email) {
      const found = parts.find(p => p.includes("@"));
      if (found) email = found.trim();
    }
    return {
      name: parts[0] || "Google User",
      uid: parts[1] || "",
      photoURL: parts[2] || "",
      email: email
    };
  }
  const emailMatch = info.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1] : (info.includes("@") ? info.trim() : "");
  const name = info.replace(/\([^)]+\)/g, "").replace(email, "").trim();
  return { name: name || "Google User", uid: "", photoURL: "", email };
}

// Global helper to accurately resolve user email from any session object
function getSessionEmail(session: ChatSession | LocalSessionData | null | undefined): string {
  if (!session) return "";
  if (session.userEmail && typeof session.userEmail === "string" && session.userEmail.trim()) {
    return session.userEmail.trim();
  }
  if (session.contactInfo) {
    if (session.contactType === "google") {
      const g = parseGoogleContact(session.contactInfo);
      if (g.email) return g.email;
    }
    if (session.contactType === "facebook") {
      const fb = parseFacebookContact(session.contactInfo);
      if (fb.email) return fb.email;
    }
    const match = session.contactInfo.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (match) return match[1];
  }
  return "";
}

interface LocalSessionData {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  messages: Message[];
  contactInfo?: string;
  contactType?: "telegram" | "whatsapp" | "facebook" | "google" | "username";
  needsAdminAttention?: boolean;
  adminNotifiedAt?: string;
  directContactNumber?: string;
  userIp?: string;
  userEmail?: string;
}

function getLocalSession(id: string): LocalSessionData | null {
  try {
    const raw = localStorage.getItem(`suwasetha_local_session_${id}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Error reading local session from localStorage", e);
  }
  return null;
}

function deleteLocalSession(id: string) {
  try {
    localStorage.removeItem(`suwasetha_local_session_${id}`);
  } catch (e) {
    console.error("Error removing local session from localStorage", e);
  }
}

async function syncSessionToServer(id: string, data: Partial<LocalSessionData>) {
  const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === 'localhost' || window.location.hostname.includes('run.app'));
  if (!isLocalOrDev) return;
  try {
    const payload = {
      ...data,
      id,
      lastActiveAt: data.lastActiveAt || new Date().toISOString()
    };
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: payload })
    });
  } catch {
    // Background sync silent catch
  }
}


function saveLocalSession(id: string, data: Partial<LocalSessionData>) {
  try {
    const existing = getLocalSession(id) || {
      id,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      messages: [],
    };

    // Strictly protect existing messages from being cleared if data.messages is undefined or empty
    let resolvedMessages = existing.messages || [];
    if (Array.isArray(data.messages)) {
      if (data.messages.length > 0) {
        resolvedMessages = data.messages;
      } else if (resolvedMessages.length === 0) {
        resolvedMessages = [];
      }
      // If data.messages is [] but existing has messages, keep resolvedMessages intact
    }

    const updated: LocalSessionData = {
      ...existing,
      ...data,
      id,
      messages: resolvedMessages,
      lastActiveAt: data.lastActiveAt || existing.lastActiveAt || new Date().toISOString()
    };

    try {
      localStorage.setItem(`suwasetha_local_session_${id}`, JSON.stringify(updated));
    } catch (storageErr) {
      console.warn("LocalStorage write warning (possibly quota):", storageErr);
    }

    // Asynchronously synchronize with server and Firestore
    syncSessionToServer(id, updated);
  } catch (e) {
    console.error("Error saving local session to localStorage", e);
  }
}

function getAllLocalSessions(): ChatSession[] {
  const sessions: ChatSession[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("suwasetha_local_session_")) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            sessions.push({
              id: parsed.id,
              createdAt: parsed.createdAt || new Date().toISOString(),
              lastActiveAt: parsed.lastActiveAt || new Date().toISOString(),
              expiresAt: parsed.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              messages: Array.isArray(parsed.messages) ? parsed.messages : [],
              contactInfo: parsed.contactInfo,
              contactType: parsed.contactType,
              needsAdminAttention: Boolean(parsed.needsAdminAttention),
              adminNotifiedAt: parsed.adminNotifiedAt,
              directContactNumber: parsed.directContactNumber,
              userIp: parsed.userIp,
              userEmail: parsed.userEmail,
              sourceCollection: "local",
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn("Error scanning local sessions:", e);
  }
  return sessions;
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 3) {
    return `${name[0]}***@${domain}`;
  }
  return `${name.substring(0, 2)}*******@${domain}`;
}

// Helper to safely parse dates from ISO strings, Firestore Timestamps, epoch numbers, or legacy formats
function parseDateSafely(val: any): Date {
  if (!val) return new Date(0);
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date(0) : val;
  // Firestore Timestamp with toDate()
  if (typeof val?.toDate === "function") {
    try {
      const d = val.toDate();
      if (!isNaN(d.getTime())) return d;
    } catch {
      // ignore
    }
  }
  // Firestore Timestamp object { seconds, nanoseconds }
  if (typeof val === "object" && typeof val.seconds === "number") {
    return new Date(val.seconds * 1000);
  }
  if (typeof val === "number") {
    return new Date(val);
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    const num = Number(val);
    if (!isNaN(num) && num > 1000000000) {
      return new Date(num > 1000000000000 ? num : num * 1000);
    }
  }
  return new Date(0);
}

// Flawlessly merge two message arrays uniquely by message ID and sort chronologically
export function mergeMessages(msgsA: Message[] = [], msgsB: Message[] = []): Message[] {
  const map = new Map<string, Message>();
  if (Array.isArray(msgsA)) {
    msgsA.forEach(m => {
      if (m && m.id) map.set(m.id, m);
    });
  }
  if (Array.isArray(msgsB)) {
    msgsB.forEach(m => {
      if (m && m.id) {
        const existing = map.get(m.id);
        map.set(m.id, existing ? { ...existing, ...m } : m);
      }
    });
  }
  const result = Array.from(map.values());
  result.sort((a, b) => {
    const tA = a.timestamp ? parseDateSafely(a.timestamp).getTime() : 0;
    const tB = b.timestamp ? parseDateSafely(b.timestamp).getTime() : 0;
    return tA - tB;
  });
  return result;
}

// Compute the true latest activity timestamp for a chat session
function getSessionLastActiveMs(session: ChatSession): number {
  let maxTime = 0;
  if (session.lastActiveAt) {
    const d = parseDateSafely(session.lastActiveAt);
    if (!isNaN(d.getTime()) && d.getTime() > 0) {
      maxTime = Math.max(maxTime, d.getTime());
    }
  }
  if (session.messages && Array.isArray(session.messages) && session.messages.length > 0) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      if (msg?.timestamp) {
        const d = parseDateSafely(msg.timestamp);
        if (!isNaN(d.getTime()) && d.getTime() > 0) {
          maxTime = Math.max(maxTime, d.getTime());
          break;
        }
      }
    }
  }
  if (session.createdAt) {
    const d = parseDateSafely(session.createdAt);
    if (!isNaN(d.getTime()) && d.getTime() > 0) {
      maxTime = Math.max(maxTime, d.getTime());
    }
  }
  return maxTime;
}

function toIsoStringSafely(val: any, fallbackNow = false): string {
  try {
    const d = parseDateSafely(val);
    return isNaN(d.getTime()) ? (fallbackNow ? new Date().toISOString() : new Date(0).toISOString()) : d.toISOString();
  } catch {
    return fallbackNow ? new Date().toISOString() : new Date(0).toISOString();
  }
}

// Normalizer for session documents across different versions and collections
function normalizeSessionData(docSnapId: string, raw: any, sourceCollection = "sessions"): ChatSession {
  const data = raw || {};
  const id = String(data.id || data.sessionId || data._id || docSnapId);

  // Determine created & last active timestamps
  const createdAt = toIsoStringSafely(
    data.createdAt || data.created_at || data.timestamp || data.date || data.time,
    true
  );
  const lastActiveAt = toIsoStringSafely(
    data.lastActiveAt || data.last_active_at || data.updatedAt || data.updated_at || data.createdAt || data.timestamp,
    true
  );
  const expiresAt = toIsoStringSafely(
    data.expiresAt || data.expires_at,
    false
  );

  // Determine messages
  let rawMessages = data.messages || data.chat || data.history || data.conversation || [];
  if (!Array.isArray(rawMessages) && typeof rawMessages === "object" && rawMessages !== null) {
    rawMessages = Object.values(rawMessages);
  }
  const messages: Message[] = Array.isArray(rawMessages)
    ? rawMessages.map((m: any, idx: number) => ({
        id: String(m?.id || `msg_${idx}_${Date.now()}`),
        role: (m?.role === "admin" || m?.isAdminMessage || m?.sender === "admin" ? "admin" : (m?.role === "user" || m?.sender === "user" || m?.isUser ? "user" : "model")) as "user" | "model" | "admin",
        content: String(m?.content || m?.text || m?.message || ""),
        timestamp: toIsoStringSafely(m?.timestamp || m?.time || m?.createdAt || m?.date, true),
        imageUrl: m?.imageUrl || m?.image || m?.attachment || undefined,
        deletedByUser: !!m?.deletedByUser,
        isAdminMessage: m?.role === "admin" || !!m?.isAdminMessage || m?.sender === "admin",
        adminName: m?.adminName || (m?.role === "admin" || m?.isAdminMessage ? "සුවසැත පරිපාලක" : undefined)
      }))
    : [];

  const userEmail = String(data.userEmail || data.email || data.user_email || "").trim();
  const contactInfo = String(data.contactInfo || data.contact || data.contact_info || "");
  const contactType = data.contactType || data.contact_type || (userEmail ? "google" : undefined);
  const userIp = String(data.userIp || data.ip || data.clientIp || data.user_ip || "");
  const directContactNumber = String(data.directContactNumber || data.phone || data.phoneNumber || data.whatsappNumber || data.direct_contact_number || "");

  const isExpired = parseDateSafely(expiresAt).getTime() > 0 && parseDateSafely(expiresAt).getTime() < Date.now();
  const isLegacy = sourceCollection !== "sessions" || isExpired || !data.lastActiveAt;

  return {
    id,
    createdAt,
    lastActiveAt,
    expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    messages,
    contactInfo: contactInfo || undefined,
    contactType: contactType as any,
    userEmail: userEmail || undefined,
    userIp: userIp || undefined,
    directContactNumber: directContactNumber || undefined,
    needsAdminAttention: !!(data.needsAdminAttention || data.adminAttention),
    adminNotifiedAt: data.adminNotifiedAt || undefined,
    legacySource: sourceCollection !== "sessions" ? sourceCollection : undefined,
    isLegacyOrExpired: isLegacy,
  };
}

// Persistent user saver for verified Google accounts
async function saveVerifiedUserToDatabase(userObj: {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  provider?: string;
  sessionId?: string;
  ip?: string;
}) {
  if (!userObj.email && !userObj.uid) return;
  try {
    const docId = userObj.uid || userObj.email.replace(/[^a-zA-Z0-9_-]/g, "_");
    const nowStr = new Date().toISOString();
    const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === 'localhost' || window.location.hostname.includes('run.app'));

    const isUsername = userObj.provider === "username";
    const displayName = userObj.displayName || (isUsername ? userObj.email : "Google User");
    const provider = userObj.provider || "google";
    const contactType = isUsername ? "username" : provider;
    const contactInfo = isUsername 
      ? `${displayName}|username||${userObj.email || userObj.uid}`
      : `${displayName}|google|${userObj.photoURL || ""}|${userObj.email || ""}`;

    const payload = {
      id: docId,
      email: userObj.email || "",
      displayName: displayName,
      photoURL: userObj.photoURL || "",
      provider: provider,
      createdAt: nowStr,
      lastLoginAt: nowStr,
      ...(userObj.ip ? { lastIp: userObj.ip } : {}),
      ...(userObj.sessionId ? { lastSessionId: userObj.sessionId } : {})
    };

    // Save to local server store only in dev/localhost
    if (isLocalOrDev) {
      fetch(`/api/users/${encodeURIComponent(docId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: payload })
      }).catch(() => {});
    }

    // Save profile to sessions collection (e.g. user_profile_* document) which has full read/write permissions
    if (db) {
      try {
        const sessionDocRef = doc(db, "sessions", `user_profile_${docId}`);
        await setDoc(sessionDocRef, sanitizeForFirestore({
          id: `user_profile_${docId}`,
          createdAt: nowStr,
          lastActiveAt: nowStr,
          expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
          messages: [],
          userEmail: userObj.email || "",
          displayName: displayName,
          photoURL: userObj.photoURL || "",
          contactInfo: contactInfo,
          contactType: contactType,
          provider: provider,
          ...(userObj.sessionId ? { lastSessionId: userObj.sessionId } : {}),
          ...(userObj.ip ? { userIp: userObj.ip } : {}),
          userId: docId
        }), { merge: true });
      } catch (err) {
        console.warn("User profile session sync note:", err);
      }
    }
    console.log("Verified user profile saved:", userObj.email);
  } catch (err) {
    console.warn("Error saving verified user:", err);
  }
}


export default function App() {
  // State for user session - Synchronously initialized from localStorage to eliminate any blank state on refresh
  const [sessionId, setSessionId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("suwasetha_session_id");
      if (stored) return stored;
      const newId = `session_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem("suwasetha_session_id", newId);
      return newId;
    } catch {
      return `session_${Math.random().toString(36).substring(2, 15)}`;
    }
  });

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const id = localStorage.getItem("suwasetha_session_id");
      if (id) {
        const local = getLocalSession(id);
        if (local && Array.isArray(local.messages) && local.messages.length > 0) {
          return local.messages;
        }
      }
    } catch {}
    return [];
  });
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>("සුවසැත සිතමින් පවතී...");
  const [ageVerified, setAgeVerified] = useState<boolean>(false);
  const [showMobileHelpline, setShowMobileHelpline] = useState<boolean>(false);
  const [clientIp, setClientIp] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // User contact details states (Required starting from 2nd user query)
  const [contactInfo, setContactInfo] = useState<string>("");
  const [contactType, setContactType] = useState<"telegram" | "whatsapp" | "facebook" | "google" | "username">("google");
  const [contactSaved, setContactSaved] = useState<boolean>(false);
  const [facebookSubmitting, setFacebookSubmitting] = useState<boolean>(false);
  const [googleSubmitting, setGoogleSubmitting] = useState<boolean>(false);

  // Custom Username & Password Auth state
  const [customUsername, setCustomUsername] = useState<string>(() => {
    try {
      return localStorage.getItem("suwasetha_custom_username") || "";
    } catch {
      return "";
    }
  });
  const [customDisplayName, setCustomDisplayName] = useState<string>(() => {
    try {
      return localStorage.getItem("suwasetha_user_display_name") || "";
    } catch {
      return "";
    }
  });
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalTab, setAuthModalTab] = useState<"username" | "google">("username");
  const [usernameMode, setUsernameMode] = useState<"login" | "register">("register");
  const [authUsernameInput, setAuthUsernameInput] = useState<string>("");
  const [authPasswordInput, setAuthPasswordInput] = useState<string>("");
  const [authConfirmPasswordInput, setAuthConfirmPasswordInput] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [usernameAuthLoading, setUsernameAuthLoading] = useState<boolean>(false);
  const [usernameAuthError, setUsernameAuthError] = useState<string | null>(null);
  const [usernameAuthSuccess, setUsernameAuthSuccess] = useState<string | null>(null);

  // Temporary contact inputs during filling
  const [tempContactInfo, setTempContactInfo] = useState<string>("");
  const [tempContactType, setTempContactType] = useState<"telegram" | "whatsapp" | "facebook" | "google">("whatsapp");
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSubmitting, setContactSubmitting] = useState<boolean>(false);

  // Image Upload Support
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [compressing, setCompressing] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Admin Alert / Personal Help states
  const [notifiedAdmin, setNotifiedAdmin] = useState<boolean>(false);
  const [showContactPromptForAdminAlert, setShowContactPromptForAdminAlert] = useState<boolean>(false);
  const [adminNotificationLoading, setAdminNotificationLoading] = useState<boolean>(false);
  const [showDirectContactModal, setShowDirectContactModal] = useState<boolean>(false);
  const [directContactNumberInput, setDirectContactNumberInput] = useState<string>("");
  const [directContactNumber, setDirectContactNumber] = useState<string>("");
  const [newAdminAlert, setNewAdminAlert] = useState<string | null>(null);


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    const isImage = type.startsWith("image/") || 
      name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || 
      name.endsWith(".webp") || name.endsWith(".heic") || name.endsWith(".heif") || 
      name.endsWith(".bmp") || name.endsWith(".gif");
    
    if (!isImage) {
      alert("කරුණාකර පින්තූර ගොනුවක් පමණක් තෝරන්න. (Please select an image file only.)");
      return;
    }
    
    setCompressing(true);
    try {
      const compressedDataUrl = await compressAndResizeImage(file);
      setSelectedImage(compressedDataUrl);
    } catch (err) {
      console.error("Error processing image:", err);
      alert("පින්තූරය සැකසීමට නොහැකි වුණා. කරුණාකර වෙනත් ඡායාරූපයක් හෝ JPEG/PNG ආකෘතියෙන් උත්සාහ කරන්න.");
    } finally {
      setCompressing(false);
      if (e.target) {
        e.target.value = "";
      }
    }
  };

  // Clipboard paste handler: intercepts pasted images and blocks corrupted binary HEIC strings
  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Check if an image file was pasted directly
    const items = clipboardData.items;
    let imageFile: File | null = null;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          imageFile = items[i].getAsFile();
          break;
        }
      }
    }

    if (imageFile) {
      e.preventDefault();
      setCompressing(true);
      try {
        const compressed = await compressAndResizeImage(imageFile);
        setSelectedImage(compressed);
      } catch (err) {
        console.error("Pasted image processing error:", err);
        alert("පින්තූරය ඇතුළත් කිරීමට නොහැකි විය. කරුණාකර කැමරා බොත්තම භාවිතා කර upload කරන්න.");
      } finally {
        setCompressing(false);
      }
      return;
    }

    // 2. Safeguard: Block pasting raw binary file text (like Apple HEIC binary bytes)
    const pastedText = clipboardData.getData("text");
    if (
      pastedText && 
      (pastedText.includes("ftypheic") || 
       pastedText.includes("mif1heic") || 
       pastedText.startsWith("\u0000") || 
       (pastedText.match(/\uFFFD/g) || []).length > 20)
    ) {
      e.preventDefault();
      alert("ඔබ paste කිරීමට උත්සාහ කළේ ඡායාරූපයක කියවිය නොහැකි අකුරු (binary file text) වේ. කරුණාකර පහළ ඇති කැමරා අයිකනය (Camera button) ඔබා ඡායාරූපය කෙලින්ම upload කරන්න.");
      return;
    }
  };


  // Admin section states
  const [adminUser, setAdminUser] = useState<FirebaseUser | null>(null);
  const isAuthorizedAdmin = Boolean(
    adminUser && adminUser.email && adminUser.email.toLowerCase().trim() === "kasubsampath@gmail.com"
  );
  const [adminToken, setAdminToken] = useState<string>("");
  const [adminMode, setAdminMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("suwasetha_admin_mode") === "true";
    } catch {
      return false;
    }
  });

  // Admin panel is ONLY accessible when explicitly authenticated as kasubsampath@gmail.com
  const showAdminPanel = Boolean(adminMode && isAuthorizedAdmin);
  const [adminSessions, setAdminSessions] = useState<ChatSession[]>([]);
  const [adminUsersList, setAdminUsersList] = useState<VerifiedUser[]>([]);
  const [adminActiveTab, setAdminActiveTab] = useState<"sessions" | "users">("sessions");
  const [userSearchQuery, setUserSearchQuery] = useState<string>("");
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [adminLoading, setAdminLoading] = useState<boolean>(false);
  const [adminMessage, setAdminMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [adminSearchTerm, setAdminSearchTerm] = useState<string>("");
  const [adminSessionFilter, setAdminSessionFilter] = useState<"all" | "active" | "old" | "with_email" | "attention">("all");
  const [showAdminComposer, setShowAdminComposer] = useState<boolean>(true);
  const [adminReplyText, setAdminReplyText] = useState<string>("");
  const [adminReplySending, setAdminReplySending] = useState<boolean>(false);
  const [adminReplySuccess, setAdminReplySuccess] = useState<string | null>(null);
  const [adminShowUserDetails, setAdminShowUserDetails] = useState<boolean>(false);

  // Close full display admin chat on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedSession) {
        setSelectedSession(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSession]);

  const filteredAdminSessions = useMemo(() => {
    return adminSessions.filter((session) => {
      const isExpired = parseDateSafely(session.expiresAt).getTime() > 0 && parseDateSafely(session.expiresAt).getTime() < Date.now();
      const hasEmail = !!getSessionEmail(session);

      if (adminSessionFilter === "active" && isExpired) return false;
      if (adminSessionFilter === "old" && !isExpired && !session.isLegacyOrExpired) return false;
      if (adminSessionFilter === "with_email" && !hasEmail) return false;
      if (adminSessionFilter === "attention" && !session.needsAdminAttention) return false;

      if (adminSearchTerm.trim()) {
        const q = adminSearchTerm.toLowerCase().trim();
        const email = getSessionEmail(session).toLowerCase();
        const idMatch = session.id.toLowerCase().includes(q);
        const emailMatch = email.includes(q);
        const ipMatch = (session.userIp || "").toLowerCase().includes(q);
        const phoneMatch = (session.directContactNumber || "").toLowerCase().includes(q) || 
                           (session.contactInfo || "").toLowerCase().includes(q);
        const msgMatch = session.messages?.some(m => (m.content || "").toLowerCase().includes(q));
        return idMatch || emailMatch || ipMatch || phoneMatch || msgMatch;
      }
      return true;
    });
  }, [adminSessions, adminSessionFilter, adminSearchTerm]);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load / Initialize local session ID & age verification state
  useEffect(() => {
    // Session initialization
    let localSessionId = localStorage.getItem("suwasetha_session_id");
    if (!localSessionId) {
      localSessionId = `session_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem("suwasetha_session_id", localSessionId);
    }
    setSessionId(localSessionId);

    // Age verification, custom username & email cache check
    const verified = localStorage.getItem("suwasetha_age_verified");
    const cachedEmail = localStorage.getItem("suwasetha_user_email");
    const cachedUsername = localStorage.getItem("suwasetha_custom_username");
    if (cachedEmail) {
      setUserEmail(cachedEmail);
    }
    if (cachedUsername) {
      setCustomUsername(cachedUsername);
      setContactType("username");
      setContactInfo(`${cachedUsername}|username||${cachedUsername}`);
      setContactSaved(true);
    }
    // Automatically skip age modal if age verified AND (email or username) are present
    if (verified === "true" && (cachedEmail || cachedUsername)) {
      setAgeVerified(true);
    }

    // Reliably detect client's IP address
    const detectClientIp = async () => {
      let detected = "";
      try {
        const res = await fetch("/api/get-ip");
        if (res.ok) {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await res.json();
            if (data?.ip && data.ip !== "Unknown") {
              detected = data.ip;
            }
          }
        }
      } catch (e) {
        console.warn("Could not fetch IP from /api/get-ip:", e);
      }
      if (!detected) {
        try {
          const res = await fetch("https://api.ipify.org?format=json");
          if (res.ok) {
            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              const data = await res.json();
              if (data?.ip) {
                detected = data.ip;
              }
            }
          }
        } catch (e) {
          console.warn("Could not fetch IP from ipify:", e);
        }
      }
      if (detected) {
        setClientIp(detected);
        if (localSessionId) {
          saveLocalSession(localSessionId, { userIp: detected });
          // If session document already exists on Firestore, sync IP
          if (db) {
            try {
              const docRef = doc(db, "sessions", localSessionId);
              const snap = await getDoc(docRef);
              if (snap.exists()) {
                await updateDoc(docRef, { userIp: detected });
              }
            } catch (e) {
              console.warn("Could not sync IP to Firestore doc:", e);
            }
          }
        }
      }
    };
    detectClientIp();

    // Try fetching existing session history if there is any
    fetchSessionHistory(localSessionId);

    // Auth listener for user and administrator login
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Automatically fetch auth token for Admin API calls
        const token = await user.getIdToken();
        const email = user.email || "";
        const displayName = user.displayName || "Google User";
        const photoURL = user.photoURL || "";
        const uid = user.uid;

        // Persist verified user profile to 'users' collection in Firestore
        if (email || uid) {
          saveVerifiedUserToDatabase({
            uid,
            email,
            displayName,
            photoURL,
            provider: "google",
            sessionId: localSessionId,
            ip: clientIp
          });
        }

        if (email) {
          setUserEmail(email);
          localStorage.setItem("suwasetha_user_email", email);
        }
        
        // If they are indeed the specific admin email, we let them access administrative panels
        if (user.email && user.email.toLowerCase().trim() === "kasubsampath@gmail.com") {
          setAdminUser(user);
          setAdminToken(token);
          setAgeVerified(true);
          setAdminMode(true);
          try {
            localStorage.setItem("suwasetha_admin_mode", "true");
          } catch {}
          localStorage.setItem("suwasetha_age_verified", "true");
          console.log("Logged in as Admin:", maskEmail(user.email));
          fetchAdminSessions(token);
        } else {
          // Normal user signed in with Google
          const contactVal = `${displayName}|${uid}|${photoURL}|${email}`;
          
          setContactInfo(contactVal);
          setContactType("google");
          setContactSaved(true);
          setAgeVerified(true);
          localStorage.setItem("suwasetha_age_verified", "true");

          // Restore previous conversation if user already has records in database
          try {
            let prevSessionId = "";
            if (db) {
              const uDoc = await getDoc(doc(db, "sessions", `user_profile_${uid}`)).catch(() => null);
              if (uDoc && uDoc.exists()) {
                prevSessionId = uDoc.data().lastSessionId || "";
              }
            }
            if (prevSessionId && prevSessionId !== localSessionId && db) {
              const currentLocal = getLocalSession(localSessionId);
              const currentHasMessages = currentLocal && Array.isArray(currentLocal.messages) && currentLocal.messages.length > 0;
              if (!currentHasMessages) {
                const prevSnap = await getDoc(doc(db, "sessions", prevSessionId));
                if (prevSnap.exists()) {
                  const pData = prevSnap.data();
                  const pMsgs = pData.messages || pData.chat || [];
                  if (Array.isArray(pMsgs) && pMsgs.length > 0) {
                    console.log("Restoring existing session for returning user:", prevSessionId);
                    localSessionId = prevSessionId;
                    setSessionId(prevSessionId);
                    localStorage.setItem("suwasetha_session_id", prevSessionId);
                    fetchSessionHistory(prevSessionId);
                  }
                }
              }
            }
          } catch (eRest) {
            console.warn("Could not check previous user session:", eRest);
          }

          // Sync with local session & Firestore session
          if (localSessionId) {
            saveLocalSession(localSessionId, {
              contactInfo: contactVal,
              contactType: "google",
              ...(email ? { userEmail: email } : {})
            });
            if (db) {
              try {
                const localData = getLocalSession(localSessionId);
                const currentMsgs = (localData?.messages && localData.messages.length > 0)
                  ? localData.messages
                  : (messages.length > 0 ? messages : undefined);

                // Only create/update in Firestore if there are actual messages or an existing session doc
                if (currentMsgs && currentMsgs.length > 0) {
                  const docRef = doc(db, "sessions", localSessionId);
                  const expiresAt = new Date();
                  expiresAt.setDate(expiresAt.getDate() + 30);
                  await setDoc(docRef, sanitizeForFirestore({
                    id: localSessionId,
                    lastActiveAt: new Date().toISOString(),
                    expiresAt: expiresAt.toISOString(),
                    contactInfo: contactVal,
                    contactType: "google",
                    messages: currentMsgs,
                    ...(clientIp ? { userIp: clientIp } : {}),
                    ...(email ? { userEmail: email } : {})
                  }), { merge: true });
                }
              } catch (e) {
                console.warn("Could not sync Google user to Firestore doc:", e);
              }
            }
          }
        }

      } else {
        setAdminUser(null);
        setAdminToken("");
        setAdminSessions([]);
        setAdminUsersList([]);
        setSelectedSession(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // Fetch individual session messages (including past or archived database records)
  const fetchSessionHistory = async (id: string) => {
    if (!id) return;
    try {
      // 1. Immediately read local storage so there is ZERO delay or screen flicker on refresh
      const localData = getLocalSession(id);
      let localMsgs: Message[] = [];
      if (localData && Array.isArray(localData.messages) && localData.messages.length > 0) {
        localMsgs = localData.messages;
        setMessages(localMsgs);
        if (localData.userIp) setClientIp(localData.userIp);
        if (localData.userEmail) setUserEmail(localData.userEmail);
        if (localData.contactInfo) {
          setContactInfo(localData.contactInfo);
          setContactType(localData.contactType || "whatsapp");
          setContactSaved(true);
        }
        if (localData.directContactNumber) {
          setDirectContactNumber(localData.directContactNumber);
          setDirectContactNumberInput(localData.directContactNumber);
        }
        setNotifiedAdmin(!!localData.needsAdminAttention);
      }

      // 2. Concurrently fetch Server (dev/localhost only) and Firestore to ensure we have the absolute latest state
      let serverData: any = null;
      let firestoreData: any = null;

      const fetchPromises: Promise<void>[] = [];
      const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === 'localhost' || window.location.hostname.includes('run.app'));

      if (isLocalOrDev) {
        fetchPromises.push(
          fetch(`/api/sessions/${encodeURIComponent(id)}`)
            .then(async (res) => {
              const contentType = res.headers.get("content-type") || "";
              if (res.ok && contentType.includes("application/json")) {
                const json = await res.json();
                if (json?.session) serverData = json.session;
              }
            })
            .catch(() => {})
        );
      }

      if (db) {
        fetchPromises.push(
          getDoc(doc(db, "sessions", id))
            .then((snap) => {
              if (snap.exists()) firestoreData = snap.data();
            })
            .catch(() => {})
        );
      }

      await Promise.all(fetchPromises);

      // 3. Unify candidate messages from all sources by ID
      const serverMsgs = Array.isArray(serverData?.messages) ? serverData.messages : [];
      const fsMsgs = Array.isArray(firestoreData?.messages) ? firestoreData.messages : [];

      const msgMap = new Map<string, any>();
      // Put local messages first
      localMsgs.forEach(m => { if (m?.id) msgMap.set(m.id, m); });
      // Overlay server messages
      serverMsgs.forEach((m: any) => { if (m?.id) msgMap.set(m.id, m); });
      // Overlay firestore messages (authoritative for live database)
      fsMsgs.forEach((m: any) => { if (m?.id) msgMap.set(m.id, m); });

      const allMergedRaw = Array.from(msgMap.values());

      if (allMergedRaw.length > 0) {
        const normalizedMsgs: Message[] = allMergedRaw.map((m: any, idx: number) => ({
          id: String(m?.id || `msg_${idx}_${Date.now()}`),
          role: (m?.role === "admin" || m?.isAdminMessage || m?.sender === "admin" ? "admin" : (m?.role === "user" || m?.sender === "user" || m?.isUser ? "user" : "model")) as "user" | "model" | "admin",
          content: String(m?.content || m?.text || m?.message || ""),
          timestamp: toIsoStringSafely(m?.timestamp || m?.time || m?.createdAt || m?.date, true),
          imageUrl: m?.imageUrl || m?.image || m?.attachment || undefined,
          deletedByUser: !!m?.deletedByUser,
          isAdminMessage: m?.role === "admin" || !!m?.isAdminMessage || m?.sender === "admin",
          adminName: m?.adminName || (m?.role === "admin" || m?.isAdminMessage ? "සුවසැත පරිපාලක" : undefined)
        }));

        setMessages(normalizedMsgs);

        const bestMeta = firestoreData || serverData || localData || {};
        if (bestMeta.needsAdminAttention !== undefined) setNotifiedAdmin(!!bestMeta.needsAdminAttention);
        if (bestMeta.userIp) setClientIp(bestMeta.userIp);
        if (bestMeta.userEmail) setUserEmail(bestMeta.userEmail);
        if (bestMeta.contactInfo) {
          setContactInfo(bestMeta.contactInfo);
          setContactType(bestMeta.contactType || "whatsapp");
          setContactSaved(true);
        }
        if (bestMeta.directContactNumber) {
          setDirectContactNumber(bestMeta.directContactNumber);
          setDirectContactNumberInput(bestMeta.directContactNumber);
        }

        // Cache unified session back to LocalStorage
        saveLocalSession(id, {
          ...bestMeta,
          id,
          messages: normalizedMsgs
        });
      }
    } catch (err) {
      console.error("Error fetching session history:", err);
    }
  };

  // Real-time listener for current user's session (e.g. to receive admin responses instantly)
  useEffect(() => {
    if (!sessionId || !db) return;

    let isMounted = true;
    const docRef = doc(db, "sessions", sessionId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (!isMounted || !docSnap.exists()) return;
      const data = docSnap.data();
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        const mappedMsgs: Message[] = data.messages.map((m: any, idx: number) => ({
          id: String(m?.id || `msg_${idx}`),
          role: (m?.role === "admin" || m?.isAdminMessage || m?.sender === "admin" ? "admin" : (m?.role === "user" || m?.sender === "user" || m?.isUser ? "user" : "model")) as "user" | "model" | "admin",
          content: String(m?.content || m?.text || m?.message || ""),
          timestamp: toIsoStringSafely(m?.timestamp, true),
          imageUrl: m?.imageUrl,
          deletedByUser: !!m?.deletedByUser,
          isAdminMessage: m?.role === "admin" || !!m?.isAdminMessage || m?.sender === "admin",
          adminName: m?.adminName || (m?.role === "admin" || m?.isAdminMessage ? "සුවසැත පරිපාලක" : undefined)
        }));

        setMessages((prev) => {
          const prevAdminCount = prev.filter(m => m.role === "admin" || m.isAdminMessage).length;
          const merged = mergeMessages(prev, mappedMsgs);
          const newAdminCount = merged.filter(m => m.role === "admin" || m.isAdminMessage).length;

          // If new admin message arrived, trigger smooth scroll and visual alert
          if (newAdminCount > prevAdminCount) {
            setNewAdminAlert("සුවසැත සෞඛ්‍ය උපදේශකවරයා ඔබගේ ප්‍රශ්නයට සෘජු නිල පිළිතුරක් ලබා දී ඇත!");
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 100);
            setTimeout(() => {
              setNewAdminAlert(null);
            }, 10000);
          }

          // Persist to local storage synchronously
          saveLocalSession(sessionId, { messages: merged });
          return merged;
        });
      }
      if (data.needsAdminAttention !== undefined) {
        setNotifiedAdmin(!!data.needsAdminAttention);
      }
    }, (err) => {
      console.warn("Session real-time listener notice:", err?.message || err);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [sessionId, db]);


  // Save user's contact information (Required starting from 2nd user query)
  const handleSaveContactInfo = async (info: string, type: "telegram" | "whatsapp" | "facebook" | "google" | "username", explicitEmail?: string) => {
    const cleaned = info.trim();
    if (!cleaned) return "කරුණාකර තොරතුරු ඇතුළත් කරන්න. (Please enter the contact details.)";

    if (type === "whatsapp") {
      const cleanPhone = cleaned.replace(/[\s-]/g, "");
      const isSriLankanPhone = /^(?:\+94|94)?(?:0)?7\d{8}$/.test(cleanPhone);
      if (!isSriLankanPhone) {
        return "කරුණාකර නිවැරදි ශ්‍රී ලාංකික WhatsApp අංකයක් ඇතුළත් කරන්න. (e.g. 0771234567)";
      }
    } else if (type === "telegram") {
      if (cleaned.length < 3) {
        return "කරුණාකර නිවැරදි Telegram ID එකක් ඇතුළත් කරන්න. (e.g. @username)";
      }
    }

    const now = new Date();
    const emailToSave = explicitEmail || (type === "google" ? parseGoogleContact(cleaned).email : (type === "facebook" ? parseFacebookContact(cleaned).email : userEmail));
    if (emailToSave) {
      setUserEmail(emailToSave);
    }

    // 1. Always persist to LocalStorage and server session store
    if (sessionId) {
      saveLocalSession(sessionId, {
        contactInfo: cleaned,
        contactType: type,
        lastActiveAt: now.toISOString(),
        ...(clientIp ? { userIp: clientIp } : {}),
        ...(emailToSave ? { userEmail: emailToSave } : {})
      });
    }

    // 2. Persist to Firestore if online
    if (db && sessionId) {
      try {
        const docRef = doc(db, "sessions", sessionId);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        const localSess = getLocalSession(sessionId);
        const resolvedMsgs = (messages && messages.length > 0) ? messages : (localSess?.messages || []);

        await setDoc(docRef, sanitizeForFirestore({
          id: sessionId,
          lastActiveAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          contactInfo: cleaned,
          contactType: type,
          ...(resolvedMsgs.length > 0 ? { messages: resolvedMsgs } : {}),
          ...(clientIp ? { userIp: clientIp } : {}),
          ...(emailToSave ? { userEmail: emailToSave } : {})
        }), { merge: true });
      } catch (err: any) {
        console.warn("Firestore contact sync note:", err);
      }
    }

    setContactInfo(cleaned);
    setContactType(type);
    setContactSaved(true);
    return null;
  };

  // Submit contact handler
  const handleContactSubmit = async () => {
    setContactError(null);
    setContactSubmitting(true);
    const err = await handleSaveContactInfo(tempContactInfo, tempContactType);
    setContactSubmitting(false);
    if (err) {
      setContactError(err);
    }
  };

  // Google Login & Age Verification Handler
  const handleVerifyAgeWithGoogle = async () => {
    setGoogleSubmitting(true);
    setContactError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      const displayName = user.displayName || "Google User";
      const email = user.email || "";
      const photoURL = user.photoURL || "";
      const uid = user.uid;
      const contactVal = `${displayName}|${uid}|${photoURL}|${email}`;
      
      if (email) {
        setUserEmail(email);
        localStorage.setItem("suwasetha_user_email", email);
      }

      // Persist verified user profile to 'users' collection in Firestore
      if (email || uid) {
        await saveVerifiedUserToDatabase({
          uid,
          email,
          displayName,
          photoURL,
          provider: "google",
          sessionId,
          ip: clientIp
        });
      }

      const err = await handleSaveContactInfo(contactVal, "google", email);
      if (err) {
        setContactError(err);
        return;
      }

      localStorage.setItem("suwasetha_age_verified", "true");
      setAgeVerified(true);
      setContactSaved(true);

      // If the email is kasubsampath@gmail.com, we recognize them as admin, fetch admin sessions
      if (user.email && user.email.toLowerCase().trim() === "kasubsampath@gmail.com") {
        const token = await user.getIdToken();
        setAdminUser(user);
        setAdminToken(token);
        fetchAdminSessions(token);
      }
    } catch (err: any) {
      const errCode = err?.code || "";
      const errMsg = err?.message || "";
      const isPopupClosed = errCode === "auth/popup-closed-by-user" || errMsg.includes("popup-closed-by-user");
      const isCancelled = errCode === "auth/cancelled-popup-request" || errMsg.includes("cancelled-popup-request");
      const isPopupBlocked = errCode === "auth/popup-blocked" || errMsg.includes("popup-blocked");

      if (isPopupClosed || isCancelled) {
        console.info("Google Sign-In popup closed by user or cancelled.");
        setContactError(
          "Google පිවිසුම් කවුළුව වසා දමන ලදී. අවශ්‍ය නම් නැවත උත්සාහ කරන්න. (Google Sign-In popup was closed. Please try again if needed.)"
        );
      } else if (isPopupBlocked) {
        console.warn("Google Sign-In popup blocked by browser:", err);
        setContactError(
          "ඔබගේ බ්‍රවුසරය මඟින් Google පිවිසුම් කවුළුව (Popup) අවහිර කර ඇත. කරුණාකර Popups වලට අවසර ලබා දී (Allow Popups) නැවත උත්සාහ කරන්න."
        );
      } else {
        console.error("Google Login Error:", err);
        setContactError("Google හරහා සම්බන්ධ වීමේදී දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න. (Google Login Error: " + (err.message || err) + ")");
      }
    } finally {
      setGoogleSubmitting(false);
    }

  };

  // Custom Username & Password Login Handler
  const handleLoginWithUsername = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setUsernameAuthError(null);
    setUsernameAuthSuccess(null);
    setUsernameAuthLoading(true);

    try {
      const res = await loginCustomUser(authUsernameInput, authPasswordInput, clientIp, sessionId);
      if (!res.success) {
        setUsernameAuthError(res.error || "පිවිසීමට නොහැකි විය.");
        return;
      }

      const uname = res.username || authUsernameInput.trim();
      const dname = res.displayName || uname;
      setCustomUsername(uname);
      setCustomDisplayName(dname);
      setUserEmail(uname);
      setContactType("username");
      const contactVal = `${uname}|username||${uname}`;
      setContactInfo(contactVal);
      setContactSaved(true);
      setAgeVerified(true);
      localStorage.setItem("suwasetha_age_verified", "true");

      await handleSaveContactInfo(contactVal, "username", uname);

      // Save user profile to database
      await saveVerifiedUserToDatabase({
        uid: uname,
        email: uname,
        displayName: dname,
        photoURL: "",
        provider: "username",
        sessionId,
        ip: clientIp
      });

      // Restore previous chat session for this returning username user if current chat is empty
      if (res.lastSessionId && res.lastSessionId !== sessionId && db) {
        try {
          const currentLocal = getLocalSession(sessionId);
          const hasCurrentMsgs = currentLocal && Array.isArray(currentLocal.messages) && currentLocal.messages.length > 0;
          if (!hasCurrentMsgs && messages.length === 0) {
            const prevSnap = await getDoc(doc(db, "sessions", res.lastSessionId));
            if (prevSnap.exists()) {
              const pData = prevSnap.data();
              const pMsgs = pData.messages || pData.chat || [];
              if (Array.isArray(pMsgs) && pMsgs.length > 0) {
                setSessionId(res.lastSessionId);
                localStorage.setItem("suwasetha_session_id", res.lastSessionId);
                setMessages(pMsgs);
                fetchSessionHistory(res.lastSessionId);
              }
            }
          }
        } catch (restErr) {
          console.warn("Could not restore custom user session:", restErr);
        }
      }

      setUsernameAuthSuccess(`සාදරයෙන් පිළිගනිමු, @${uname}!`);
      setTimeout(() => {
        setAuthModalOpen(false);
        setUsernameAuthSuccess(null);
        setAuthUsernameInput("");
        setAuthPasswordInput("");
      }, 600);
    } catch (err: any) {
      setUsernameAuthError("දෝෂයක් සිදු විය: " + (err.message || err));
    } finally {
      setUsernameAuthLoading(false);
    }
  };

  // Custom Username & Password Register Handler
  const handleRegisterWithUsername = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setUsernameAuthError(null);
    setUsernameAuthSuccess(null);

    if (authConfirmPasswordInput && authPasswordInput !== authConfirmPasswordInput) {
      setUsernameAuthError("රහස් අංක / මුරපද දෙක එකිනෙකට නොගැළපේ. කරුණාකර නැවත පරීක්ෂා කරන්න.");
      return;
    }

    setUsernameAuthLoading(true);

    try {
      const res = await registerCustomUser(authUsernameInput, authPasswordInput, clientIp, sessionId);
      if (!res.success) {
        setUsernameAuthError(res.error || "ඇතුළු වීමට නොහැකි විය. වෙනත් Nick Name එකක් උත්සාහ කරන්න.");
        return;
      }

      const uname = res.username || authUsernameInput.trim();
      const dname = res.displayName || uname;
      setCustomUsername(uname);
      setCustomDisplayName(dname);
      setUserEmail(uname);
      setContactType("username");
      const contactVal = `${uname}|username||${uname}`;
      setContactInfo(contactVal);
      setContactSaved(true);
      setAgeVerified(true);
      localStorage.setItem("suwasetha_age_verified", "true");

      await handleSaveContactInfo(contactVal, "username", uname);

      // Save user profile to database
      await saveVerifiedUserToDatabase({
        uid: uname,
        email: uname,
        displayName: dname,
        photoURL: "",
        provider: "username",
        sessionId,
        ip: clientIp
      });

      setUsernameAuthSuccess(`සාදරයෙන් පිළිගනිමු! @${uname} ලෙස 100% නිර්නාමිකව ප්‍රශ්න ඇසීම ආරම්භ කළ හැක.`);
      setTimeout(() => {
        setAuthModalOpen(false);
        setUsernameAuthSuccess(null);
        setAuthUsernameInput("");
        setAuthPasswordInput("");
        setAuthConfirmPasswordInput("");
      }, 600);
    } catch (err: any) {
      setUsernameAuthError("දෝෂයක් සිදු විය: " + (err.message || err));
    } finally {
      setUsernameAuthLoading(false);
    }
  };

  // Log out user
  const handleUserLogout = async () => {
    if (customUsername) {
      logoutCustomUser();
      setCustomUsername("");
      setCustomDisplayName("");
    }
    if (auth.currentUser) {
      try {
        await signOut(auth);
      } catch {}
    }
    setUserEmail("");
    setContactInfo("");
    setContactType("google");
    setContactSaved(false);
    localStorage.removeItem("suwasetha_user_email");
    localStorage.removeItem("suwasetha_custom_username");
    localStorage.removeItem("suwasetha_user_display_name");
  };

  // Handle notifying the admin
  const handleNotifyAdminClick = () => {
    setShowDirectContactModal(true);
  };

  // Submit direct contact number and notify admin
  const handleSendDirectContactNumber = async () => {
    const cleaned = directContactNumberInput.trim();
    if (!cleaned) {
      alert("කරුණාකර ඔබව සම්බන්ධ කරගත හැකි දුරකථන අංකයක් හෝ WhatsApp අංකයක් ලබාදෙන්න.");
      return;
    }

    setAdminNotificationLoading(true);
    const nowStr = new Date().toISOString();
    try {
      if (sessionId) {
        saveLocalSession(sessionId, {
          needsAdminAttention: true,
          adminNotifiedAt: nowStr,
          directContactNumber: cleaned
        });
      }

      if (db && sessionId) {
        try {
          const docRef = doc(db, "sessions", sessionId);
          await setDoc(docRef, sanitizeForFirestore({
            id: sessionId,
            needsAdminAttention: true,
            adminNotifiedAt: nowStr,
            directContactNumber: cleaned,
            lastActiveAt: nowStr
          }), { merge: true });
        } catch (err) {
          console.warn("Failed to update direct contact number on Firestore.", err);
        }
      }

      setNotifiedAdmin(true);
      setDirectContactNumber(cleaned);
      setShowDirectContactModal(false);

      alert("උපදේශකවරයා දැනුවත් කිරීම සාර්ථකයි!\n\nසුවසැත සෞඛ්‍ය උපදේශකවරයා සාර්ථකව දැනුවත් කර ඇත. ඔබ ලබා දී ඇති දුරකථන/WhatsApp අංකය ඔස්සේ අපගේ උපදේශකවරයා හැකි ඉක්මනින් ඔබව සම්බන්ධ කරගනු ඇත. කරුණාකර රැඳී සිටින්න.");
    } catch (err: any) {
      console.error("Error notifying counselor:", err);
      alert("උපදේශකවරයා දැනුවත් කිරීමේදී දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න.");
    } finally {
      setAdminNotificationLoading(false);
    }
  };

  // Trigger admin notification immediately after saving from the alert modal prompt
  const handleNotifyAdminClickDirectlyAfterSaving = async () => {
    // Open direct contact modal directly so they can enter their number
    setShowDirectContactModal(true);
  };

  // User hides/deletes a message from their own view (preserves it in Firestore, hides from UI)
  const handleUserDeleteMessage = async (messageId: string) => {
    if (!confirm("මෙම පණිවිඩය ඔබගේ තිරයෙන් පමණක් මැකීමට ඔබට අවශ්‍යද? (මෙය සේවාදායකයේ සුරක්ෂිතව පවතිනු ඇත)")) {
      return;
    }
    
    // Update local state by marking the message as deletedByUser
    const updatedMessages = messages.map(msg => 
      msg.id === messageId ? { ...msg, deletedByUser: true } : msg
    );
    setMessages(updatedMessages);
    
    // Write back to Firestore and LocalStorage
    if (sessionId) {
      if (db) {
        try {
          const docRef = doc(db, "sessions", sessionId);
          await setDoc(docRef, sanitizeForFirestore({
            id: sessionId,
            messages: updatedMessages,
            lastActiveAt: new Date().toISOString()
          }), { merge: true });
        } catch (err) {
          console.warn("Failed to update Firestore on user delete. Saving locally.", err);
        }
      }
      saveLocalSession(sessionId, {
        messages: updatedMessages
      });
    }
  };

  // Scroll to bottom helper
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Handle message sending
  const handleSend = async (textToSend?: string) => {
    const prompt = textToSend || input;
    if (!prompt.trim() && !selectedImage) return;

    // Safeguard: Check if the user accidentally pasted raw binary file bytes (like HEIC text)
    if (
      prompt.includes("ftypheic") || 
      prompt.includes("mif1heic") || 
      prompt.startsWith("\u0000") || 
      (prompt.match(/\uFFFD/g) || []).length > 20
    ) {
      alert("ඔබ ඇතුළත් කළ පණිවිඩයෙහි කියවිය නොහැකි ඡායාරූප දත්ත (binary file text) අඩංගුයි. කරුණාකර පහළ ඇති කැමරා අයිකනය (Camera button) ඔබා ඡායාරූපය කෙලින්ම upload කරන්න.");
      return;
    }

    if (!textToSend) {
      setInput("");
    }


    const imageToSend = selectedImage;
    setSelectedImage(null);
    setLoading(true);
    setLoadingText("සුවසැත සිතමින් පවතී...");

    const messageId = `msg_${Math.random().toString(36).substring(2, 11)}`;
    const userMsg: Message = {
      id: messageId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
      ...(imageToSend ? { imageUrl: imageToSend } : {})
    };
    
    // Create new list of messages to send
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    const effectiveSessionId = sessionId || localStorage.getItem("suwasetha_session_id") || `session_${Math.random().toString(36).substring(2, 15)}`;
    if (!sessionId) {
      setSessionId(effectiveSessionId);
      localStorage.setItem("suwasetha_session_id", effectiveSessionId);
    }

    const now = new Date();
    const emailToPersist = customUsername
      || userEmail 
      || auth.currentUser?.email 
      || localStorage.getItem("suwasetha_custom_username")
      || localStorage.getItem("suwasetha_user_email")
      || (contactSaved && contactInfo ? (contactType === "username" ? customUsername || contactInfo.split("|")[0] : (contactType === "google" ? parseGoogleContact(contactInfo).email : (contactType === "facebook" ? parseFacebookContact(contactInfo).email : ""))) : "");

    if (emailToPersist && !userEmail) {
      setUserEmail(emailToPersist);
    }

    const effectiveContactType = customUsername ? "username" : (contactType || (emailToPersist ? "google" : undefined));
    const effectiveContactInfo = customUsername ? `${customDisplayName || customUsername}|username||${customUsername}` : (contactInfo || undefined);

    // 1. Immediately save user message to LocalStorage & sync to backend
    saveLocalSession(effectiveSessionId, {
      messages: updatedMessages,
      lastActiveAt: now.toISOString(),
      ...(effectiveContactType ? { contactType: effectiveContactType } : {}),
      ...(effectiveContactInfo ? { contactInfo: effectiveContactInfo } : {}),
      ...(clientIp ? { userIp: clientIp } : {}),
      ...(emailToPersist ? { userEmail: emailToPersist } : {})
    });

    // 2. Immediately persist user message to Firestore
    if (db && effectiveSessionId) {
      try {
        const docRef = doc(db, "sessions", effectiveSessionId);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        setDoc(docRef, sanitizeForFirestore({
          id: effectiveSessionId,
          createdAt: now.toISOString(),
          lastActiveAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          messages: updatedMessages,
          ...(effectiveContactType ? { contactType: effectiveContactType } : {}),
          ...(effectiveContactInfo ? { contactInfo: effectiveContactInfo } : {}),
          ...(customUsername ? { displayName: customDisplayName || customUsername, userId: customUsername } : {}),
          ...(clientIp ? { userIp: clientIp } : {}),
          ...(emailToPersist ? { userEmail: emailToPersist } : {})
        }), { merge: true }).catch((err) => {
          console.warn("Firestore immediate user message write warning:", err);
        });
      } catch (fsErr) {
        console.warn("Firestore sync in handleSend note:", fsErr);
      }
    }

    try {
      let res: Response | null = null;
      let lastError: any = null;
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: effectiveSessionId,
              userEmail: emailToPersist,
              clientIp: clientIp,
              messages: messages, // Send history before optimistic update
              newMessage: prompt,
              newImage: imageToSend || undefined,
              clientTimestamp: new Date().toISOString(),
              clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Colombo",
              clientLocalDate: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
            })
          });

          if (res.ok) {
            break; // Success! Exit the loop
          } else {
            throw new Error(`Server status: ${res.status}`);
          }
        } catch (err: any) {
          lastError = err;
          console.warn(`Chat API attempt ${attempt} failed:`, err);
          
          if (attempt < maxAttempts) {
            // Update loading message based on attempt number to inform user
            if (attempt === 1) {
              setLoadingText("සේවාදායකය කාර්යබහුලයි. නැවත උත්සාහ කරමින් පවතී... (උත්සාහය 2/3)");
            } else if (attempt === 2) {
              setLoadingText("සේවාදායකය තවමත් කාර්යබහුලයි. අවසන් වරට උත්සාහ කරමින් පවතී... (උත්සාහය 3/3)");
            }
            // Delay 3 seconds before next retry
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }

      if (!res || !res.ok) {
        throw lastError || new Error("සන්නිවේදන දෝෂයක් සිදු විය.");
      }

      const data = await res.json();
      const aiResponseText = data.text;

      const modelMsg: Message = {
        id: `msg_${Math.random().toString(36).substring(2, 11)}`,
        role: "model",
        content: aiResponseText,
        timestamp: new Date().toISOString()
      };

      const finalMessages = [...updatedMessages, modelMsg];
      setMessages(finalMessages);

      const effectiveSessionIdFinal = sessionId || effectiveSessionId;

      const now = new Date();

      const emailToPersistFinal = customUsername
        || userEmail 
        || auth.currentUser?.email 
        || localStorage.getItem("suwasetha_custom_username")
        || localStorage.getItem("suwasetha_user_email")
        || (contactSaved && contactInfo ? (contactType === "username" ? customUsername || contactInfo.split("|")[0] : (contactType === "google" ? parseGoogleContact(contactInfo).email : (contactType === "facebook" ? parseFacebookContact(contactInfo).email : ""))) : "");

      if (emailToPersistFinal && !userEmail) {
        setUserEmail(emailToPersistFinal);
      }

      const effectiveContactTypeFinal = customUsername ? "username" : (contactType || (emailToPersistFinal ? "google" : undefined));
      const effectiveContactInfoFinal = customUsername ? `${customDisplayName || customUsername}|username||${customUsername}` : (contactInfo || undefined);

      // Always save to LocalStorage & sync to server API first
      saveLocalSession(effectiveSessionIdFinal, {
        messages: finalMessages,
        lastActiveAt: now.toISOString(),
        ...(effectiveContactTypeFinal ? { contactType: effectiveContactTypeFinal } : {}),
        ...(effectiveContactInfoFinal ? { contactInfo: effectiveContactInfoFinal } : {}),
        ...(clientIp ? { userIp: clientIp } : {}),
        ...(emailToPersistFinal ? { userEmail: emailToPersistFinal } : {})
      });

      // Persist directly to Firestore on the client side with merge: true for instantaneous real-time sync
      if (db && effectiveSessionIdFinal) {
        try {
          const docRef = doc(db, "sessions", effectiveSessionIdFinal);
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 30);
          await setDoc(docRef, sanitizeForFirestore({
            id: effectiveSessionIdFinal,
            createdAt: now.toISOString(),
            lastActiveAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            messages: finalMessages,
            ...(effectiveContactTypeFinal ? { contactType: effectiveContactTypeFinal } : {}),
            ...(effectiveContactInfoFinal ? { contactInfo: effectiveContactInfoFinal } : {}),
            ...(customUsername ? { displayName: customDisplayName || customUsername, userId: customUsername } : {}),
            ...(clientIp ? { userIp: clientIp } : {}),
            ...(emailToPersistFinal ? { userEmail: emailToPersistFinal } : {})
          }), { merge: true });
        } catch (fsErr) {
          console.warn("Firestore realtime sync in handleSend note:", fsErr);
        }
      }

      // Keep user profile in 'users' collection / sessions up-to-date with latest activity and session ID
      if (customUsername) {
        saveVerifiedUserToDatabase({
          uid: customUsername,
          email: customUsername,
          displayName: customDisplayName || customUsername,
          photoURL: "",
          provider: "username",
          sessionId: effectiveSessionIdFinal,
          ip: clientIp
        });
      } else if (emailToPersistFinal || auth.currentUser?.uid) {
        saveVerifiedUserToDatabase({
          uid: auth.currentUser?.uid || "",
          email: emailToPersistFinal || auth.currentUser?.email || "",
          displayName: auth.currentUser?.displayName || "Google User",
          photoURL: auth.currentUser?.photoURL || "",
          provider: "google",
          sessionId: effectiveSessionIdFinal,
          ip: clientIp
        });
      }
    } catch (err: any) {
      console.error("Error sending message:", err);
      // Fallback message
      setMessages(prev => [
        ...prev,
        {
          id: `msg_error_${Date.now()}`,
          role: "model",
          content: "කණගාටුයි, සේවාදායකය සමඟ සම්බන්ධ වීමේ ගැටලුවක් මතු විය. කරුණාකර ඔබගේ අන්තර්ජාල සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න. ඔබට අවශ්‍ය නම් ඉහළින්ම ඇති **'උපදේශක සහාය'** බොත්තම මඟින් අපගේ සෞඛ්‍ය උපදේශකවරයා දැනුවත් කර සෘජු උපදෙස් ලබාගත හැක.",
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
      setLoadingText("සුවසැත සිතමින් පවතී...");
    }
  };

  // Age verification accept handler
  const handleVerifyAge = () => {
    localStorage.setItem("suwasetha_age_verified", "true");
    setAgeVerified(true);
  };

  // Admin Google Sign In
  const handleAdminLogin = async () => {
    setAdminLoading(true);
    setAdminMessage(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const token = await result.user.getIdToken();
      
      if (result.user.email?.toLowerCase().trim() !== "kasubsampath@gmail.com") {
        setAdminMessage({
          text: `ඔබ ඇතුළත් වූයේ ${maskEmail(result.user.email)} ගිණුමෙනි. මෙම ගිණුමට පරිපාලන (Admin) අවසර නොමැත. (Unauthorized: ${maskEmail(result.user.email)})`,
          type: "error"
        });
        await signOut(auth);
        return;
      }

      setAdminUser(result.user);
      setAdminToken(token);
      setAdminMode(true);
      try {
        localStorage.setItem("suwasetha_admin_mode", "true");
      } catch {}
      setAdminMessage({ text: "සාර්ථකව පරිපාලක ලෙස ඇතුළු විය! (Admin log-in successful)", type: "success" });
      fetchAdminSessions(token);
    } catch (err: any) {
      const errCode = err?.code || "";
      const errMsg = err?.message || "";
      const isPopupClosed = errCode === "auth/popup-closed-by-user" || errMsg.includes("popup-closed-by-user");
      const isCancelled = errCode === "auth/cancelled-popup-request" || errMsg.includes("cancelled-popup-request");
      const isPopupBlocked = errCode === "auth/popup-blocked" || errMsg.includes("popup-blocked");

      if (isPopupClosed || isCancelled) {
        console.info("Admin Google Sign-In popup closed by user or cancelled.");
        setAdminMessage({
          text: "Google පිවිසුම් කවුළුව වසා දමන ලදී. අවශ්‍ය නම් නැවත උත්සාහ කරන්න. (Admin Sign-In popup was closed. Please try again if needed.)",
          type: "info" as any
        });
      } else if (isPopupBlocked) {
        console.warn("Admin Sign-In popup blocked by browser:", err);
        setAdminMessage({
          text: "ඔබගේ බ්‍රවුසරය මඟින් Google පිවිසුම් කවුළුව (Popup) අවහිර කර ඇත. කරුණාකර Popups වලට අවසර ලබා දී නැවත උත්සාහ කරන්න.",
          type: "error"
        });
      } else {
        console.error("Admin Login Error:", err);
        setAdminMessage({ text: "පිවිසීමේදී දෝෂයක් සිදු විය: " + (err.message || err), type: "error" });
      }
    } finally {
      setAdminLoading(false);
    }

  };

  // Admin Log out
  const handleAdminLogout = async () => {
    try {
      await signOut(auth);
      setAdminUser(null);
      setAdminToken("");
      setAdminMode(false);
      try {
        localStorage.setItem("suwasetha_admin_mode", "false");
      } catch {}
      setAdminSessions([]);
      setSelectedSession(null);
      setAdminMessage({ text: "සාර්ථකව නික්ම ගියා. (Signed out successfully)", type: "success" });
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  // Admin fetch all sessions (active, past, legacy)
  const fetchAdminSessions = async (tokenOverride?: string) => {
    const activeToken = tokenOverride || adminToken;
    if (!activeToken) return;

    setAdminLoading(true);
    try {
      const sessionsMap = new Map<string, ChatSession>();

      // 0. Primary Server Storage Bridge: Fetch from backend /api/admin/sessions if available
      try {
        const adminEmailParam = adminUser?.email || "kasubsampath@gmail.com";
        const res = await fetch(`/api/admin/sessions?adminEmail=${encodeURIComponent(adminEmailParam)}`, {
          headers: {
            "Authorization": `Bearer ${activeToken}`,
            "x-admin-email": adminEmailParam
          }
        });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && contentType.includes("application/json")) {
          const data = await res.json();
          if (Array.isArray(data?.sessions)) {
            data.sessions.forEach((s: any) => {
              if (s && s.id && !s.id.startsWith("user_profile_") && !s.id.startsWith("user_account_") && !s.id.startsWith("test_doc_")) {
                const session = normalizeSessionData(s.id, s, "server");
                const existing = sessionsMap.get(session.id);
                if (existing) {
                  session.messages = mergeMessages(existing.messages, session.messages);
                }
                sessionsMap.set(session.id, session);
              }
            });
          }
        }
      } catch (err) {
        // Server API optional; direct Firestore provides live data
      }

      // 1. Authoritative: Fetch all documents directly from Firestore "sessions" collection
      try {
        if (db) {
          const querySnapshot = await getDocs(collection(db, "sessions"));
          querySnapshot.forEach((docSnap) => {
            if (docSnap.id.startsWith("user_profile_") || docSnap.id.startsWith("user_account_") || docSnap.id.startsWith("test_doc_")) return;
            const session = normalizeSessionData(docSnap.id, docSnap.data(), "sessions");
            const existing = sessionsMap.get(session.id);
            if (existing) {
              session.messages = mergeMessages(existing.messages, session.messages);
            }
            sessionsMap.set(session.id, session);
          });
        }
      } catch (err) {
        console.warn("Error reading from sessions collection:", err);
      }

      // 2. Complementary/Fallback: Merge local sessions so admin always sees all records
      const localSessions = getAllLocalSessions();
      localSessions.forEach((ls) => {
        if (!sessionsMap.has(ls.id)) {
          sessionsMap.set(ls.id, ls);
        } else {
          const s = sessionsMap.get(ls.id)!;
          s.messages = mergeMessages(ls.messages, s.messages);
        }
      });

      const sessions = Array.from(sessionsMap.values());

      // Sort sessions: strictly by latest activity / user interaction descending
      // The user who used the chat most recently is at the very top ("awasanayata chat bawita karapu userde chat admin panal eke igalinma")
      sessions.sort((a, b) => {
        const timeA = getSessionLastActiveMs(a);
        const timeB = getSessionLastActiveMs(b);
        return timeB - timeA;
      });

      setAdminSessions(sessions);
      // Fetch verified users list in parallel
      fetchAdminUsers(activeToken, sessions);
    } catch (err: any) {
      console.error("Error fetching sessions for admin:", err);
      setAdminMessage({ text: "සැසි ලබා ගැනීමට අපොහොසත් විය: " + (err.message || err), type: "error" });
    } finally {
      setAdminLoading(false);
    }
  };

  // Real-time Firestore synchronization for Admin Panel
  // Keeps all sessions live-synced in realtime and moves active chats to the top
  useEffect(() => {
    const isAuthorizedAdmin = adminUser?.email?.toLowerCase().trim() === "kasubsampath@gmail.com";
    if ((!adminMode && !isAuthorizedAdmin) || !db) return;

    let isSubscribed = true;
    const sessionsCol = collection(db, "sessions");
    
    const unsubscribe = onSnapshot(sessionsCol, (snapshot) => {
      if (!isSubscribed) return;

      const localSessions = getAllLocalSessions();

      setAdminSessions((prevAdminSessions) => {
        const sessionsMap = new Map<string, ChatSession>();

        // 1. Existing sessions in state (from server API /api/admin/sessions)
        prevAdminSessions.forEach((s) => {
          if (s && s.id && !s.id.startsWith("user_profile_") && !s.id.startsWith("user_account_")) {
            sessionsMap.set(s.id, s);
          }
        });

        // 2. Read local client items
        localSessions.forEach((ls) => {
          if (ls && ls.id && !ls.id.startsWith("user_profile_") && !ls.id.startsWith("user_account_")) {
            const existing = sessionsMap.get(ls.id);
            if (existing) {
              existing.messages = mergeMessages(existing.messages, ls.messages);
            } else {
              sessionsMap.set(ls.id, ls);
            }
          }
        });

        // 3. Authoritative Firestore snapshot in real-time
        snapshot.forEach((docSnap) => {
          if (docSnap.id.startsWith("user_profile_") || docSnap.id.startsWith("user_account_")) return;
          const session = normalizeSessionData(docSnap.id, docSnap.data(), "sessions-realtime");
          const existing = sessionsMap.get(session.id);
          if (existing && existing.messages) {
            session.messages = mergeMessages(existing.messages, session.messages);
          }
          sessionsMap.set(session.id, session);
        });

        const updatedSessions = Array.from(sessionsMap.values());
        // Sort strictly by latest activity / user interaction descending
        // The user who used the chat most recently is at the very top
        updatedSessions.sort((a, b) => {
          const timeA = getSessionLastActiveMs(a);
          const timeB = getSessionLastActiveMs(b);
          return timeB - timeA;
        });

        // Keep the active full-screen chat synchronized live if open
        setSelectedSession((prev) => {
          if (!prev) return null;
          const matching = sessionsMap.get(prev.id);
          if (!matching) return prev;
          return {
            ...matching,
            messages: mergeMessages(prev.messages, matching.messages)
          };
        });

        return updatedSessions;
      });

    }, (err) => {
      console.warn("Real-time admin sessions listener notice:", err);
    });

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, [adminMode, adminUser?.email, db]);

  // Admin fetch all verified users from 'users' collection & active sessions
  const fetchAdminUsers = async (tokenOverride?: string, sessionsList?: ChatSession[]) => {
    const activeToken = tokenOverride || adminToken;
    if (!activeToken) return;

    try {
      const usersMap = new Map<string, VerifiedUser>();

      // 0. Primary Server Storage Bridge: Fetch from /api/admin/users if running in dev/localhost
      const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === 'localhost' || window.location.hostname.includes('run.app'));
      if (isLocalOrDev) {
        try {
          const adminEmailParam = adminUser?.email || "kasubsampath@gmail.com";
          const res = await fetch(`/api/admin/users?adminEmail=${encodeURIComponent(adminEmailParam)}`, {
            headers: {
              "Authorization": `Bearer ${activeToken}`,
              "x-admin-email": adminEmailParam
            }
          });
          const contentType = res.headers.get("content-type") || "";
          if (res.ok && contentType.includes("application/json")) {
            const data = await res.json();
            if (Array.isArray(data?.users)) {
              data.users.forEach((u: any) => {
                if (u) {
                  const uid = u.id || u.uid || u.email;
                  const email = (u.email || "").trim();
                  const key = (email || uid).toLowerCase();
                  if (key) {
                    usersMap.set(key, {
                      id: uid,
                      email: email,
                      displayName: u.displayName || "Google User",
                      photoURL: u.photoURL || "",
                      provider: u.provider || "google",
                      createdAt: toIsoStringSafely(u.createdAt, false),
                      lastLoginAt: toIsoStringSafely(u.lastLoginAt, true),
                      lastIp: u.lastIp || undefined,
                      lastSessionId: u.lastSessionId || undefined
                    });
                  }
                }
              });
            }
          }
        } catch (err) {
          // Fallback to Firestore
        }
      }


      // 2. Discover user profiles stored in sessions collection (e.g. user_profile_* documents)
      const currentSessions = sessionsList || adminSessions;
      currentSessions.forEach((s) => {
        if (s.id.startsWith("user_profile_") && s.contactInfo) {
          if (s.contactType === "username") {
            const username = s.userEmail || s.contactInfo.split("|")[0] || s.id.replace("user_profile_", "");
            const key = username.toLowerCase();
            if (key) {
              usersMap.set(key, {
                id: username,
                email: username,
                displayName: (s as any).displayName || username,
                photoURL: "",
                provider: "username",
                createdAt: toIsoStringSafely(s.createdAt, false),
                lastLoginAt: toIsoStringSafely(s.lastActiveAt, true),
                lastIp: s.userIp || undefined,
                lastSessionId: s.id
              });
            }
          } else {
            const g = parseGoogleContact(s.contactInfo);
            const email = s.userEmail || g.email || "";
            const uid = (s as any).userId || g.uid || s.id.replace("user_profile_", "");
            const key = (email || uid).toLowerCase();
            if (key) {
              usersMap.set(key, {
                id: uid,
                email: email,
                displayName: g.name || "Google User",
                photoURL: g.photoURL || "",
                provider: "google",
                createdAt: toIsoStringSafely(s.createdAt, false),
                lastLoginAt: toIsoStringSafely(s.lastActiveAt, true),
                lastIp: s.userIp || undefined,
                lastSessionId: s.id
              });
            }
          }
        }
      });

      // 3. Scan all regular chat sessions for Google & Username users
      currentSessions.forEach((s) => {
        if (s.contactType === "username") {
          const username = s.userEmail || (s.contactInfo ? s.contactInfo.split("|")[0] : s.id);
          const key = username.toLowerCase();
          if (!usersMap.has(key)) {
            usersMap.set(key, {
              id: username,
              email: username,
              displayName: (s as any).displayName || username,
              photoURL: "",
              provider: "username",
              createdAt: s.createdAt,
              lastLoginAt: s.lastActiveAt,
              lastIp: s.userIp,
              lastSessionId: s.id
            });
          }
        } else {
          const email = getSessionEmail(s);
          if (email) {
            const key = email.toLowerCase();
            if (!usersMap.has(key)) {
              let name = "Google User";
              let photo = "";
              let uid = "";
              if (s.contactType === "google" && s.contactInfo) {
                const g = parseGoogleContact(s.contactInfo);
                if (g.name) name = g.name;
                if (g.photoURL) photo = g.photoURL;
                if (g.uid) uid = g.uid;
              } else if (s.contactType === "facebook" && s.contactInfo) {
                const fb = parseFacebookContact(s.contactInfo);
                if (fb.name) name = fb.name;
                if (fb.photoURL) photo = fb.photoURL;
                if (fb.uid) uid = fb.uid;
              }
              usersMap.set(key, {
                id: uid || key.replace(/[^a-zA-Z0-9_-]/g, "_"),
                email: email,
                displayName: name,
                photoURL: photo,
                provider: s.contactType || "google",
                createdAt: s.createdAt,
                lastLoginAt: s.lastActiveAt,
                lastIp: s.userIp,
                lastSessionId: s.id
              });
            }
          }
        }
      });

      // 4. Also scan Firestore for user_account_ documents
      if (db) {
        try {
          const qSnap = await getDocs(collection(db, "sessions"));
          qSnap.forEach((docSnap) => {
            if (docSnap.id.startsWith("user_account_")) {
              const acc = docSnap.data();
              const username = acc.username || acc.displayName || docSnap.id.replace("user_account_", "");
              const key = username.toLowerCase();
              if (key && !usersMap.has(key)) {
                usersMap.set(key, {
                  id: username,
                  email: username,
                  displayName: acc.displayName || username,
                  photoURL: "",
                  provider: "username",
                  createdAt: toIsoStringSafely(acc.createdAt, false),
                  lastLoginAt: toIsoStringSafely(acc.lastLoginAt, true),
                  lastIp: acc.userIp || undefined,
                  lastSessionId: acc.lastSessionId || undefined
                });
              }
            }
          });
        } catch (accFsErr) {
          console.warn("User accounts Firestore read note:", accFsErr);
        }
      }

      const list = Array.from(usersMap.values());
      list.sort((a, b) => parseDateSafely(b.lastLoginAt).getTime() - parseDateSafely(a.lastLoginAt).getTime());
      setAdminUsersList(list);
    } catch (err: any) {
      console.error("Error fetching verified users for admin:", err);
    }
  };

  // Delete individual user record (for admin)
  const handleDeleteUser = async (userId: string, userEmailStr: string) => {
    if (!adminToken) return;
    if (!confirm(`මෙම පරිශීලකයා (${userEmailStr || userId}) දත්ත ගබඩාවෙන් මකා දැමීමට ඔබට අවශ්‍යද?`)) return;

    try {
      // 1. Delete on server storage
      try {
        const adminEmailParam = adminUser?.email || "kasubsampath@gmail.com";
        await fetch(`/api/admin/users/${encodeURIComponent(userId)}?adminEmail=${encodeURIComponent(adminEmailParam)}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${adminToken}`,
            "x-admin-email": adminEmailParam
          }
        });
      } catch {
        // Continue
      }

      // 2. Delete user profile session document on Firestore if online
      if (db) {
        try {
          const docRef = doc(db, "sessions", `user_profile_${userId}`);
          await deleteDoc(docRef);
        } catch {
          // Continue
        }
      }

      setAdminUsersList(prev => prev.filter(u => u.id !== userId && u.email !== userEmailStr));
      setAdminMessage({ text: `පරිශීලක (${userEmailStr || userId}) සාර්ථකව මකා දමන ලදී.`, type: "success" });
    } catch (err: any) {
      console.error("Error deleting user:", err);
      setAdminMessage({ text: "මකා දැමීමට නොහැකි විය: " + (err.message || err), type: "error" });
    }
  };

  // Delete individual session (for admin)
  const handleDeleteSession = async (sid: string) => {
    if (!adminToken) return;
    if (!confirm(`මෙම සාකච්ඡාව (${sid}) ස්ථිරවම මකා දැමීමට ඔබට අවශ්‍යද?`)) return;

    try {
      // 1. Delete on server storage with POST /delete fallback for proxies
      try {
        const adminEmailParam = adminUser?.email || "kasubsampath@gmail.com";
        const delRes = await fetch(`/api/admin/sessions/${encodeURIComponent(sid)}?adminEmail=${encodeURIComponent(adminEmailParam)}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${adminToken}`,
            "x-admin-email": adminEmailParam
          }
        }).catch(() => null);

        if (!delRes || !delRes.ok) {
          await fetch(`/api/admin/sessions/${encodeURIComponent(sid)}/delete?adminEmail=${encodeURIComponent(adminEmailParam)}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${adminToken}`,
              "x-admin-email": adminEmailParam
            }
          }).catch(() => {});
        }
      } catch {
        // Continue
      }

      // 2. Delete on Firestore if online
      if (db) {
        try {
          const docRef = doc(db, "sessions", sid);
          await deleteDoc(docRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `sessions/${sid}`);
        }
      }

      // 3. Delete from local storage
      deleteLocalSession(sid);

      setAdminMessage({ text: `සාකච්ඡා සැසිය (${sid}) සාර්ථකව මකා දමන ලදී.`, type: "success" });
      if (selectedSession?.id === sid) {
        setSelectedSession(null);
      }
      // Refresh session list
      fetchAdminSessions();
    } catch (err: any) {
      console.error("Error deleting session:", err);
      setAdminMessage({ text: "මකා දැමීමට නොහැකි විය: " + (err.message || err), type: "error" });
    }
  };

  // Cleanup expired sessions (for admin)
  const handleCleanupSessions = async () => {
    if (!adminToken) return;
    if (!confirm("අවවාදයයි: කල් ඉකුත් වූ සියලුම පැරණි සාකච්ඡා දත්ත ගබඩාවෙන් ස්ථිරවම මකා දැමීමට ඔබට අවශ්‍යද? පැරණි දත්ත තබා ගැනීමට අවශ්‍ය නම් 'Cancel' ඔබන්න.")) {
      return;
    }
    setAdminLoading(true);
    try {
      const nowStr = new Date().toISOString();
      const q = query(collection(db, "sessions"), where("expiresAt", "<", nowStr));
      let querySnapshot;
      try {
        querySnapshot = await getDocs(q);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "sessions");
        return;
      }

      if (querySnapshot.empty) {
        setAdminMessage({ text: "පවිත්‍ර කිරීමට කල් ඉකුත් වූ සැසි හමු නොවීය. (No expired sessions found to clean up.)", type: "success" });
        return;
      }

      const batch = writeBatch(db);
      let count = 0;
      querySnapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
        count++;
      });

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "sessions (batch cleanup)");
      }
      setAdminMessage({ text: `${count} කල් ඉකුත් වූ සාකච්ඡා සාර්ථකව මකා දමන ලදී. (${count} expired sessions permanently cleaned up.)`, type: "success" });
      fetchAdminSessions();
    } catch (err: any) {
      console.error("Error cleaning up sessions:", err);
      setAdminMessage({ text: "පවිත්‍ර කිරීම අසාර්ථක විය: " + (err.message || err), type: "error" });
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin: Send an official admin message to the selected user's chat session
  const handleSendAdminMessage = async () => {
    if (!selectedSession || !adminReplyText.trim() || adminReplySending) return;
    const textToSend = adminReplyText.trim();
    const sid = selectedSession.id;
    setAdminReplySending(true);

    const now = new Date().toISOString();
    const newMsg: Message = {
      id: `admin_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      role: "admin",
      content: textToSend,
      timestamp: now,
      isAdminMessage: true,
      adminName: "සුවසැත පරිපාලක (Suwasetha Admin)"
    };

    // 1. Fetch latest messages from Firestore to ensure no messages are overwritten
    let baseMsgs = selectedSession.messages || [];
    if (db) {
      try {
        const snap = await getDoc(doc(db, "sessions", sid));
        if (snap.exists()) {
          const snapData = snap.data();
          if (Array.isArray(snapData.messages) && snapData.messages.length > 0) {
            baseMsgs = mergeMessages(baseMsgs, snapData.messages);
          }
        }
      } catch (e) {
        console.warn("Could not pre-fetch latest Firestore messages:", e);
      }
    }

    const updatedMessages = mergeMessages(baseMsgs, [newMsg]);

    // 2. Optimistic update of currently selected session with guaranteed message retention
    setSelectedSession(prev => prev && prev.id === sid ? {
      ...prev,
      messages: updatedMessages,
      lastActiveAt: now,
      hasAdminReplied: true,
      needsAdminAttention: false
    } : prev);

    // 3. Update in adminSessions list
    setAdminSessions(prev => prev.map(s => s.id === sid ? {
      ...s,
      messages: updatedMessages,
      lastActiveAt: now,
      hasAdminReplied: true,
      needsAdminAttention: false
    } : s));

    // 4. If currently in this session locally, update messages
    if (sessionId === sid) {
      setMessages(updatedMessages);
    }
    try {
      saveLocalSession(sid, {
        messages: updatedMessages,
        lastActiveAt: now,
        needsAdminAttention: false
      });
    } catch {
      // Continue
    }

    try {
      // 5. Update Firestore directly as primary authoritative store (triggers user onSnapshot in real-time)
      if (db) {
        try {
          const docRef = doc(db, "sessions", sid);
          await setDoc(docRef, sanitizeForFirestore({
            id: sid,
            messages: updatedMessages,
            lastActiveAt: now,
            hasAdminReplied: true,
            lastAdminMessageAt: now,
            needsAdminAttention: false
          }), { merge: true });
        } catch (eFs) {
          console.warn("Firestore direct update note:", eFs);
        }
      }

      // 6. Post to backend API bridge only if running locally or on dev server
      const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === 'localhost' || window.location.hostname.includes('run.app'));
      if (isLocalOrDev) {
        try {
          const adminEmailParam = adminUser?.email || "kasubsampath@gmail.com";
          await fetch(`/api/admin/sessions/${encodeURIComponent(sid)}/message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${adminToken}`,
              "x-admin-email": adminEmailParam
            },
            body: JSON.stringify({
              content: textToSend,
              message: newMsg,
              messages: updatedMessages,
              adminName: "සුවසැත පරිපාලක"
            })
          });
        } catch (apiErr) {
          console.warn("Server admin message bridge note:", apiErr);
        }
      }

      setAdminReplyText("");
      setAdminReplySuccess("පරිපාලක පණිවිඩය සාර්ථකව පරිශීලකයාගේ සාකච්ඡාවට එක් කරන ලදී!");
      setTimeout(() => setAdminReplySuccess(null), 4000);
    } catch (err: any) {
      console.error("Error sending admin message:", err);
      alert("පණිවිඩය යැවීමේදී දෝෂයක් සිදු විය: " + (err.message || err));
    } finally {
      setAdminReplySending(false);
    }
  };


  const userMsgCount = messages.filter((m) => m.role === "user").length;

  return (
    <div className="min-h-screen bg-[#0e131f] text-slate-100 flex flex-col antialiased selection:bg-rose-950 selection:text-rose-100" id="app_root">
      
      {/* Dynamic Age and Agreement Modal */}
      {!ageVerified && (
        <div className="fixed inset-0 bg-[#090d16]/95 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain" id="age_modal">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#151c2c] rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 max-w-lg w-full shadow-2xl border border-slate-800 relative flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[92dvh] my-auto overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 sm:h-2 bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500 shrink-0"></div>
            
            <div className="shrink-0 mb-2.5 sm:mb-4 text-center">
              <div className="w-10 h-10 sm:w-14 sm:h-14 bg-rose-950/40 rounded-2xl border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto mb-2 shadow-inner">
                <ShieldCheck className="w-5 h-5 sm:w-8 sm:h-8" />
              </div>
              <h2 className="text-base sm:text-xl md:text-2xl font-bold text-slate-100 font-display leading-snug">
                සුවසැත (Suwasetha) ලිංගික හා ප්‍රජනක සෞඛ්‍ය උපදේශනය
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1 font-mono">
                Sexual & Reproductive Health Advisory Guide
              </p>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 space-y-2.5 sm:space-y-3.5 text-xs sm:text-sm text-slate-300 mb-3 bg-[#0e131f] p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-800 chat-scroll">
              <div className="flex gap-2.5 items-start">
                <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">මෙම යෙදුම ලිංගිකත්වය, ප්‍රජනක සෞඛ්‍යය, උපත් පාලනය සහ අනවශ්‍ය ගැබ් ගැනීම් වළක්වා ගැනීම පිළිබඳ නිවැරදි, විද්‍යාත්මක සහ වෛද්‍ය තොරතුරු සපයයි.</p>
              </div>
              <div className="flex gap-2.5 items-start">
                <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed"><strong>100% නිර්නාමිකභාවය (Anonymous) :</strong> ඔබගේ අනන්‍යතාවය කිසිසේත්ම අනාවරණය නොවේ. කිසිදු පෞද්ගලික තොරතුරක් ගබඩා නොකෙරේ.</p>
              </div>
              <div className="flex gap-2.5 items-start">
                <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed"><strong>30-දින ස්වයංක්‍රීය මැකී යාම :</strong> සාකච්ඡා ඉතිහාසය දින 30 කට පසුව පද්ධතියෙන් ස්වයංක්‍රීයවම මැකී යයි.</p>
              </div>
              <div className="flex gap-2.5 items-start bg-amber-950/20 border border-amber-900/30 p-2 sm:p-2.5 rounded-lg">
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-slate-200 font-semibold leading-relaxed">මෙම තොරතුරු පරිශීලනය කිරීම සඳහා ඔබ වයස අවුරුදු 18 හෝ ඊට වැඩි විය යුතුය.</p>
              </div>
            </div>

            {/* Auth Method Selector */}
            <div className="flex bg-[#0b0f19] p-1 rounded-xl border border-slate-800 mb-3 shrink-0">
              <button
                type="button"
                onClick={() => setAuthModalTab("username")}
                className={`flex-1 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  authModalTab === "username"
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Nick Name එකකින් අසන්න</span>
              </button>
              <button
                type="button"
                onClick={() => setAuthModalTab("google")}
                className={`flex-1 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  authModalTab === "google"
                    ? "bg-rose-600 text-white shadow-md shadow-rose-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Google ගිණුම</span>
              </button>
            </div>

            {authModalTab === "username" ? (
              <div className="shrink-0 space-y-2.5 mb-2">
                <div className="flex bg-[#070b13] p-1 rounded-xl border border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => { setUsernameMode("register"); setUsernameAuthError(null); }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      usernameMode === "register"
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    අලුතින් අරඹන්න (New Chat)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUsernameMode("login"); setUsernameAuthError(null); }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      usernameMode === "login"
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    පෙර පැමිණි අයෙක් (Sign In)
                  </button>
                </div>

                <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-2.5 text-[11px] text-purple-200 flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                  <span>සැබෑ නම අවශ්‍ය නොවේ! කැමති ඕනෑම Nick Name එකක් සහ රහස් අංකයක් දී 100% නිර්නාමිකව ප්‍රශ්න අසන්න.</span>
                </div>

                <form onSubmit={usernameMode === "login" ? handleLoginWithUsername : handleRegisterWithUsername} className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      {usernameMode === "login" ? "ඔබගේ Nick Name එක" : "ඔබ කැමති Nick Name එක (කැමති ඕනෑම නමක්)"}
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={authUsernameInput}
                        onChange={(e) => setAuthUsernameInput(e.target.value)}
                        placeholder="උදා: saman, kasun, friend_99"
                        autoCapitalize="none"
                        autoCorrect="off"
                        required
                        className="w-full bg-[#0b0f19] border border-slate-700/80 focus:border-purple-500 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      රහස් අංකය / මුරපදය (PIN / Password)
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={authPasswordInput}
                        onChange={(e) => setAuthPasswordInput(e.target.value)}
                        placeholder="ඔබට මතක හිටින අංකයක් (උදා: 1234)"
                        required
                        className="w-full bg-[#0b0f19] border border-slate-700/80 focus:border-purple-500 rounded-xl pl-9 pr-9 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {usernameMode === "register" && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        රහස් අංකය නැවත තහවුරු කරන්න (Confirm PIN)
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type={showPassword ? "text" : "password"}
                          value={authConfirmPasswordInput}
                          onChange={(e) => setAuthConfirmPasswordInput(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-[#0b0f19] border border-slate-700/80 focus:border-purple-500 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {usernameAuthError && (
                    <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{usernameAuthError}</span>
                    </div>
                  )}

                  {usernameAuthSuccess && (
                    <div className="bg-emerald-950/40 border border-emerald-900/50 rounded-xl p-2.5 text-xs text-emerald-300 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{usernameAuthSuccess}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row gap-2">
                    <button
                      type="submit"
                      disabled={usernameAuthLoading}
                      className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white py-3 px-4 rounded-xl font-semibold shadow-lg shadow-purple-600/20 text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {usernameAuthLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      ) : usernameMode === "login" ? (
                        <LogIn className="w-4 h-4 shrink-0" />
                      ) : (
                        <MessageSquare className="w-4 h-4 shrink-0" />
                      )}
                      <span>
                        {usernameMode === "login" ? "පිවිසී ප්‍රශ්න අසන්න" : "නිර්නාමිකව ප්‍රශ්නය අසන්න"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => window.location.href = "https://www.google.com"}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 sm:py-3 px-4 rounded-xl text-xs font-medium cursor-pointer"
                    >
                      නැත (Exit)
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="shrink-0 space-y-3 mb-2">
                {googleSubmitting && (
                  <div className="text-xs text-center text-rose-400 animate-pulse flex items-center justify-center gap-2 bg-rose-950/20 py-2 px-3 rounded-xl border border-rose-900/30">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400 shrink-0" />
                    <span>Google හරහා ඇතුළු වෙමින් පවතී, කරුණාකර රැඳී සිටින්න...</span>
                  </div>
                )}

                {contactError && (
                  <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5 sm:p-3 text-xs text-rose-300 leading-relaxed flex items-start gap-2 animate-fadeIn">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{contactError}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <button 
                    onClick={handleVerifyAgeWithGoogle}
                    disabled={googleSubmitting}
                    className="flex-1 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white py-3 sm:py-3.5 px-4 sm:px-5 rounded-xl sm:rounded-2xl font-semibold shadow-lg shadow-rose-500/20 hover:shadow-rose-500/30 transition-all text-center flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer text-xs sm:text-sm active:scale-[0.98]"
                    id="btn_accept_age"
                  >
                    {googleSubmitting ? (
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                    )}
                    <span>Google මඟින් වයස 18+ තහවුරු කරන්න</span>
                  </button>
                  <button 
                    onClick={() => window.location.href = "https://www.google.com"}
                    disabled={googleSubmitting}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 sm:py-3.5 px-4 sm:px-6 rounded-xl sm:rounded-2xl font-medium transition-all text-center disabled:opacity-50 cursor-pointer text-xs sm:text-sm shrink-0"
                    id="btn_decline_age"
                  >
                    නැත (Exit)
                  </button>
                </div>
              </div>
            )}

          </motion.div>
        </div>
      )}

      {/* Standalone User Authentication Modal */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-[#121826] border border-slate-700/80 rounded-2xl sm:rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl relative flex flex-col my-auto overflow-hidden animate-fadeIn"
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 shrink-0"></div>
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-950/60 border border-purple-700/50 flex items-center justify-center text-purple-300">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-100 font-display">
                    සුවසැත නිර්නාමික පිවිසුම
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono">100% Anonymous • Ask with a Nick Name</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthModalOpen(false);
                  setUsernameAuthError(null);
                  setUsernameAuthSuccess(null);
                }}
                className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
                title="වසන්න (Close)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Auth Method Selector */}
            <div className="flex bg-[#0b0f19] p-1 rounded-xl border border-slate-800 mb-3 shrink-0">
              <button
                type="button"
                onClick={() => setAuthModalTab("username")}
                className={`flex-1 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  authModalTab === "username"
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Nick Name එකකින් අසන්න</span>
              </button>
              <button
                type="button"
                onClick={() => setAuthModalTab("google")}
                className={`flex-1 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  authModalTab === "google"
                    ? "bg-rose-600 text-white shadow-md shadow-rose-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Google ගිණුම</span>
              </button>
            </div>

            {authModalTab === "username" ? (
              <div className="space-y-2.5">
                <div className="flex bg-[#070b13] p-1 rounded-xl border border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => { setUsernameMode("register"); setUsernameAuthError(null); }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      usernameMode === "register"
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    අලුතින් අරඹන්න (New Chat)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUsernameMode("login"); setUsernameAuthError(null); }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      usernameMode === "login"
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    පෙර පැමිණි අයෙක් (Sign In)
                  </button>
                </div>

                <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-2.5 text-[11px] text-purple-200 flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                  <span>සැබෑ නම අනවශ්‍යයි! කැමති ඕනෑම Nick Name එකක් සහ රහස් අංකයක් දී 100% නිර්නාමිකව ප්‍රශ්න අසන්න.</span>
                </div>

                <form onSubmit={usernameMode === "login" ? handleLoginWithUsername : handleRegisterWithUsername} className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      {usernameMode === "login" ? "ඔබගේ Nick Name එක" : "ඔබ කැමති Nick Name එක (කැමති ඕනෑම නමක්)"}
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={authUsernameInput}
                        onChange={(e) => setAuthUsernameInput(e.target.value)}
                        placeholder="උදා: saman, kasun, friend_99"
                        autoCapitalize="none"
                        autoCorrect="off"
                        required
                        className="w-full bg-[#0b0f19] border border-slate-700/80 focus:border-purple-500 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      රහස් අංකය / මුරපදය (PIN / Password)
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={authPasswordInput}
                        onChange={(e) => setAuthPasswordInput(e.target.value)}
                        placeholder="ඔබට මතක හිටින අංකයක් (උදා: 1234)"
                        required
                        className="w-full bg-[#0b0f19] border border-slate-700/80 focus:border-purple-500 rounded-xl pl-9 pr-9 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {usernameMode === "register" && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        රහස් අංකය නැවත තහවුරු කරන්න (Confirm PIN)
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type={showPassword ? "text" : "password"}
                          value={authConfirmPasswordInput}
                          onChange={(e) => setAuthConfirmPasswordInput(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-[#0b0f19] border border-slate-700/80 focus:border-purple-500 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {usernameAuthError && (
                    <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{usernameAuthError}</span>
                    </div>
                  )}

                  {usernameAuthSuccess && (
                    <div className="bg-emerald-950/40 border border-emerald-900/50 rounded-xl p-2.5 text-xs text-emerald-300 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{usernameAuthSuccess}</span>
                    </div>
                  )}

                  <div className="pt-2 flex gap-2">
                    <button
                      type="submit"
                      disabled={usernameAuthLoading}
                      className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white py-2.5 sm:py-3 px-4 rounded-xl font-semibold shadow-lg shadow-purple-600/20 text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {usernameAuthLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      ) : usernameMode === "login" ? (
                        <LogIn className="w-4 h-4 shrink-0" />
                      ) : (
                        <MessageSquare className="w-4 h-4 shrink-0" />
                      )}
                      <span>
                        {usernameMode === "login" ? "පිවිසී ප්‍රශ්න අසන්න" : "නිර්නාමිකව ප්‍රශ්නය අසන්න"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthModalOpen(false)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 sm:py-3 px-4 rounded-xl text-xs font-medium cursor-pointer"
                    >
                      අවලංගුයි
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="space-y-3">
                {googleSubmitting && (
                  <div className="text-xs text-center text-rose-400 animate-pulse flex items-center justify-center gap-2 bg-rose-950/20 py-2 px-3 rounded-xl border border-rose-900/30">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400 shrink-0" />
                    <span>Google හරහා ඇතුළු වෙමින් පවතී, කරුණාකර රැඳී සිටින්න...</span>
                  </div>
                )}

                {contactError && (
                  <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5 sm:p-3 text-xs text-rose-300 leading-relaxed flex items-start gap-2 animate-fadeIn">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{contactError}</span>
                  </div>
                )}

                <div className="pt-2 flex flex-col sm:flex-row gap-2">
                  <button 
                    onClick={async () => {
                      await handleVerifyAgeWithGoogle();
                      setAuthModalOpen(false);
                    }}
                    disabled={googleSubmitting}
                    className="flex-1 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white py-3 px-4 rounded-xl font-semibold shadow-lg shadow-rose-500/20 transition-all text-center flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer text-xs sm:text-sm active:scale-[0.98]"
                  >
                    {googleSubmitting ? (
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                    )}
                    <span>Google හරහා ඇතුළු වන්න (Sign in with Google)</span>
                  </button>
                  <button 
                    onClick={() => setAuthModalOpen(false)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 px-4 rounded-xl font-medium text-xs cursor-pointer"
                  >
                    වසන්න
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Main App Layout */}
      <header className="bg-[#151c2c] border-b border-slate-800 sticky top-0 z-40" id="header">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
          
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-tr from-rose-500 to-pink-500 rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-md shadow-rose-500/10 shrink-0">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-bold text-slate-100 font-display tracking-tight flex items-center gap-1 sm:gap-1.5 leading-none">
                සුවසැත <span className="text-[9px] sm:text-xs bg-rose-950 text-rose-400 border border-rose-900/40 px-1.5 py-0.5 rounded-full font-sans">18+ SRH</span>
              </h1>
              <p className="text-[8px] sm:text-[10px] text-slate-500 mt-0.5 sm:mt-1 font-mono tracking-wider truncate">SUWASETHA ADVISOR</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {!showAdminPanel && (
              <button
                onClick={() => setShowMobileHelpline(true)}
                className="md:hidden flex items-center gap-1 px-2 py-1.5 rounded-xl bg-[#0e131f] text-slate-300 border border-slate-800 hover:bg-slate-800 text-[11px] font-medium transition-all cursor-pointer shrink-0"
                title="ශ්‍රී ලංකා හදිසි උපකාරක සේවාවන්"
              >
                <Phone className="w-3 h-3 text-rose-400 shrink-0" />
                <span className="hidden xs:inline">උපකාරක</span><span>සේවා</span>
              </button>
            )}

            {/* User Account / Auth status button in Header */}
            {!showAdminPanel && (
              customUsername ? (
                <div className="flex items-center gap-1.5 sm:gap-2 bg-[#0e131f] border border-purple-900/50 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-lg bg-purple-950 border border-purple-700/60 flex items-center justify-center text-purple-300 font-bold text-[10px] sm:text-xs shrink-0">
                    {customUsername.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[11px] sm:text-xs text-purple-200 font-medium truncate max-w-[80px] sm:max-w-[130px]">
                    @{customUsername}
                  </span>
                  <button
                    type="button"
                    onClick={handleUserLogout}
                    className="text-slate-400 hover:text-rose-400 p-1 rounded-lg transition-colors cursor-pointer"
                    title="ඉවත් වන්න (Log Out)"
                  >
                    <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                </div>
              ) : auth.currentUser && userEmail ? (
                <div className="flex items-center gap-1.5 sm:gap-2 bg-[#0e131f] border border-blue-900/50 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl">
                  {auth.currentUser.photoURL ? (
                    <img src={auth.currentUser.photoURL} alt="User" className="w-5 h-5 sm:w-6 sm:h-6 rounded-lg object-cover border border-blue-500/40" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-lg bg-blue-950 border border-blue-700/60 flex items-center justify-center text-blue-300 font-bold text-[10px] sm:text-xs shrink-0">
                      {(auth.currentUser.displayName || "G").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-[11px] sm:text-xs text-blue-200 font-medium truncate max-w-[80px] sm:max-w-[130px]">
                    {auth.currentUser.displayName || userEmail}
                  </span>
                  <button
                    type="button"
                    onClick={handleUserLogout}
                    className="text-slate-400 hover:text-rose-400 p-1 rounded-lg transition-colors cursor-pointer"
                    title="ඉවත් වන්න (Log Out)"
                  >
                    <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalTab("username");
                    setAuthModalOpen(true);
                  }}
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/50 text-purple-300 hover:text-white hover:bg-purple-900/60 text-[11px] sm:text-xs font-semibold transition-all cursor-pointer shrink-0"
                  title="Nick Name එකකින් හෝ Google මඟින් නිර්නාමිකව ප්‍රශ්න අසන්න"
                >
                  <MessageSquare className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-purple-400" />
                  <span>Nick Name / පිවිසෙන්න</span>
                </button>
              )
            )}
            {isAuthorizedAdmin && (
              <button
                onClick={() => {
                  const nextMode = !adminMode;
                  setAdminMode(nextMode);
                  try {
                    localStorage.setItem("suwasetha_admin_mode", nextMode ? "true" : "false");
                  } catch {}
                }}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border text-[11px] sm:text-xs font-medium transition-all cursor-pointer ${
                  adminMode 
                    ? "bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20" 
                    : "bg-[#0e131f] text-slate-300 border-slate-800 hover:bg-slate-800"
                }`}
                id="btn_toggle_admin_mode"
              >
                <Lock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-rose-400" />
                <span>{adminMode ? "පරිශීලක Chat එක" : "Admin Panel"}</span>
              </button>
            )}
          </div>

        </div>
      </header>

      {/* Admin Quick Switch Navigation Banner (Only visible to verified admin) */}
      {isAuthorizedAdmin && !adminMode && (
        <div className="bg-rose-950/90 border-b border-rose-800 text-rose-100 py-2.5 sm:py-3 px-3 sm:px-4 animate-fadeIn" id="admin_quick_switch_banner">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center gap-2 text-center sm:text-left">
              <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0" />
              <p className="text-xs font-medium">
                පරිපාලක ඔබ දැනට සාමාන්‍ය පරිශීලක Chat එකේ සිටී.
              </p>
            </div>
            <button
              onClick={() => {
                setAdminMode(true);
                try {
                  localStorage.setItem("suwasetha_admin_mode", "true");
                } catch {}
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-rose-950/40 shrink-0"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>පාලක පුවරුවට පිවිසෙන්න (Admin Panel)</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-2.5 md:p-4 flex flex-col md:flex-row gap-4 relative overflow-hidden" id="main_content">
        
        {/* Toggleable Left Column: Educational Corner & Helpline Support */}
        <AnimatePresence>
          {!showAdminPanel && (
            <div className="hidden md:flex w-full md:w-80 shrink-0 flex flex-col gap-4" id="educational_panel">
              
              {/* Privacy Shield Info */}
              <div className="bg-[#151c2c] rounded-3xl p-5 border border-slate-800 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 bottom-0 text-[#1b2439] translate-x-3 translate-y-3 pointer-events-none">
                  <ShieldCheck className="w-32 h-32" />
                </div>
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm mb-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>100% රහස්‍යයි & සුරක්ෂිතයි</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed relative z-10">
                  ඔබගේ තොරතුරු සහ කතාබස් 100%ක් රහසිගත හා සුරක්ෂිත වන අතර කිසිදු තෙවන පාර්ශවයකට ලබා නොදේ. පෞද්ගලික සෞඛ්‍ය උපදෙස් සඳහා පමණක් අපගේ සෞඛ්‍ය උපදේශක මණ්ඩලය අවශ්‍යතාවය මත සහය දක්වයි.
                </p>
              </div>

              {/* Sri Lankan Helpline Info */}
              <div className="bg-[#151c2c] rounded-3xl p-5 border border-slate-800 shadow-sm">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-rose-400" />
                  <span>ශ්‍රී ලංකාවේ උපකාරක සේවාවන්</span>
                </h3>
                <div className="space-y-3">
                  <div className="p-3 bg-rose-950/20 rounded-2xl border border-rose-900/30">
                    <p className="text-xs font-bold text-rose-100 font-display">FPA ශ්‍රී ලංකා උපකාරක සේවය</p>
                    <p className="text-xs text-slate-400 mt-1">සඳුදා - සෙනසුරාදා (පෙ.ව. 8.30 - ප.ව. 4.30)</p>
                    <p className="text-xs font-semibold text-rose-400 mt-1 font-mono">+94 11 258 4157</p>
                    <p className="text-xs font-semibold text-rose-400 font-mono">+94 77 955 2979</p>
                  </div>

                  <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800">
                    <p className="text-xs font-bold text-slate-200 font-display">ජාතික ලිංගාශ්‍රිත රෝග පාලන ඒකකය</p>
                    <p className="text-xs text-slate-400 mt-1 font-mono">+94 11 266 7163</p>
                  </div>

                  <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800">
                    <p className="text-xs font-bold text-slate-200 font-display">රජයේ සෞඛ්‍ය තොරතුරු සේවය</p>
                    <p className="text-xs font-semibold text-slate-300 font-mono">හදිසි අංකය: 1390</p>
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="bg-amber-950/20 rounded-2xl p-4 border border-amber-900/30 text-xs text-amber-300">
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>වෛද්‍ය උපදෙස්:</strong> මෙම AI උපදේශකවරයා විද්‍යාත්මක තොරතුරු ලබා දීමට සකසා ඇත. කිසියම් බරපතල ශාරීරික ගැටලුවකදී වහාම සුදුසුකම් ලත් වෛද්‍යවරයෙකු හමුවන්න.
                  </p>
                </div>
              </div>

              {/* Footer Links */}
              <div className="text-center md:text-left text-[11px] text-slate-500 space-y-1 px-1">
                <p>© 2026 Suwasetha. All Rights Reserved.</p>
                <div className="flex gap-2 justify-center md:justify-start">
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-rose-400/80 hover:text-rose-400 hover:underline">
                    රහස්‍යතා ප්‍රකාශනය (Privacy Policy)
                  </a>
                </div>
              </div>

            </div>
          )}
        </AnimatePresence>

        {/* Dynamic Center Work Area: User Chat vs. Admin Panel */}
        <div className="flex-1 flex flex-col bg-[#151c2c] rounded-2xl sm:rounded-3xl border border-slate-800 shadow-sm overflow-hidden h-[calc(100dvh-4.5rem)] md:h-[calc(100vh-5.5rem)]" id="work_area">
          
          {!showAdminPanel ? (
            // ==========================================
            // USER CHAT INTERFACE
            // ==========================================
            <div className="flex-1 flex flex-col h-full overflow-hidden" id="user_chat_interface">
              
              {/* Chat Header Status */}
              <div className="px-5 py-3.5 border-b border-slate-800 bg-[#151c2c]/80 flex justify-between items-center shrink-0 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-semibold text-slate-300 font-display">සුවසැත AI සහයකාරිය ක්‍රියාකාරීයි</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {notifiedAdmin ? (
                    <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-900/50 px-2 sm:px-2.5 py-1 rounded-xl flex items-center gap-1 sm:gap-1.5 font-semibold animate-pulse">
                      <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                      <span>උපදේශක දැනුවත් කර ඇත</span>
                    </span>
                  ) : (
                    <button
                      onClick={handleNotifyAdminClick}
                      disabled={adminNotificationLoading}
                      className="text-[10px] bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 px-2 sm:px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all duration-200 font-semibold cursor-pointer disabled:opacity-50"
                      title="පෞද්ගලික සෞඛ්‍ය උපදේශක සහාය ලබාගන්න"
                    >
                      <Send className="w-3 h-3" />
                      <span>{adminNotificationLoading ? "දැනුවත් කෙරේ..." : "උපදේශක සහාය"}</span>
                    </button>
                  )}
                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1 bg-[#0e131f] border border-slate-800 px-2 py-1 rounded-lg">
                    <Clock className="w-3 h-3 text-rose-400" />
                    <span>දින 30ක රැකවරණය</span>
                  </div>
                </div>
              </div>

              {/* Message Display Panel */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-[#0e131f] chat-scroll">
                
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center space-y-6 py-8" id="empty_state">
                    <div className="w-16 h-16 bg-rose-950/40 border border-rose-900/30 rounded-3xl flex items-center justify-center text-rose-400 shadow-inner">
                      <MessageSquare className="w-8 h-8" />
                    </div>
                    
                    <div>
                      <h3 className="text-xl font-bold text-slate-100 font-display">සුවසැත SRH උපදේශනය වෙත සාදරයෙන් පිළිගනිමු</h3>
                      <p className="text-sm text-slate-300 mt-2 leading-relaxed px-4">
                        ලිංගික ජීවිතය, උපත් පාලනය, අනවශ්‍ය ගැබ් ගැනීම් වළක්වා ගැනීම, සහ අනෙකුත් ලිංගික සෞඛ්‍ය ගැටලු ගැන බියෙන් හෝ ලැජ්ජාවෙන් තොරව මිතුරෙකුගෙන් අසනවාක් මෙන් විද්‍යාත්මක කරුණු මෙතැනින් විමසන්න.
                      </p>
                    </div>

                    <div className="w-full bg-[#151c2c] border border-slate-800 rounded-3xl p-6 text-left space-y-4 shadow-md">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-rose-950/50 border border-rose-900/40 rounded-2xl flex items-center justify-center text-rose-400 shrink-0">
                          <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-slate-100 font-display">ඔබගේ ගැටලුව මෙතැනින් විමසන්න</h4>
                          <p className="text-xs text-slate-400">පහත පණිවිඩ තීරුව (Chat Bar) මඟින් ඔබගේ ගැටලුව කෙලින්ම යොමු කරන්න.</p>
                        </div>
                      </div>

                      <div className="p-3.5 bg-[#0e131f] rounded-2xl border border-slate-800/80 flex items-start gap-3">
                        <Camera className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-slate-300 leading-relaxed">
                          <span className="font-semibold text-slate-100 block mb-0.5">ඡායාරූප මඟින් විමසීමේ පහසුකම (Photo Upload):</span>
                          ගර්භණී පරීක්ෂණ තීරු (UPT Strips), ඖෂධ පැකට්, හෝ වෛද්‍ය වාර්තා වල ඡායාරූප පහත කැමරා බොත්තම (<Camera className="w-3.5 h-3.5 inline text-rose-400" />) ඔබා ඇතුළත් කර විමසිය හැක.
                        </div>
                      </div>

                      <div className="p-3.5 bg-rose-950/20 rounded-2xl border border-rose-900/30 text-xs text-rose-200 flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <span className="font-bold text-rose-300 block">100% සුරක්ෂිතයි & නිර්නාමිකයි</span>
                          <p className="leading-relaxed text-slate-300 text-[11px]">
                            ඔබ අසන කිසිදු ප්‍රශ්නයක් ඔබ කවුදැයි හඳුනාගත හැකි පරිදි ගබඩා නොකෙරේ. ඔබගේ browser එක මගින් සාකච්ඡාව නැවත කියවිය හැකි අතර, දින 30 කට පසු සාකච්ඡා සියල්ල ස්වයංක්‍රීයවම මැකී යයි.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.filter(msg => !msg.deletedByUser).map((msg) => {
                      const isAdminMsg = msg.role === "admin" || msg.isAdminMessage;
                      return (
                      <div 
                        key={msg.id}
                        className={`flex ${
                          isAdminMsg 
                            ? "justify-start w-full" 
                            : msg.role === "user" 
                              ? "justify-end" 
                              : "justify-start"
                        }`}
                      >
                        <div className={`max-w-[85%] md:max-w-[75%] rounded-3xl p-4 md:p-5 group/msg relative ${
                          isAdminMsg
                            ? "bg-gradient-to-br from-[#0c2420] via-[#102a24] to-[#0f172a] text-emerald-50 rounded-tl-sm border-2 border-emerald-500/70 shadow-xl shadow-emerald-950/40 w-full"
                            : msg.role === "user" 
                              ? "bg-rose-600 text-white rounded-tr-sm shadow-md shadow-rose-600/10" 
                              : "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700/50"
                        }`}>
                          {isAdminMsg && (
                            <div className="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b border-emerald-500/30">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shrink-0">
                                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div>
                                  <span className="font-bold text-xs text-emerald-300 block">
                                    {msg.adminName || "සුවසැත පරිපාලක (Suwasetha Admin)"}
                                  </span>
                                  <span className="text-[9px] text-emerald-400/80 font-mono">
                                    සෘජු උපදේශක පණිවිඩය (Direct Personal Advisory)
                                  </span>
                                </div>
                              </div>
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-sans font-bold flex items-center gap-1 shrink-0">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>තහවුරු කළ නිල පණිවිඩය</span>
                              </span>
                            </div>
                          )}

                          {msg.imageUrl && (
                            <div className="mb-3 overflow-hidden rounded-xl bg-[#090d16]/90 border border-slate-700/30">
                              <img 
                                src={msg.imageUrl} 
                                alt="Attachment" 
                                className="w-full max-h-60 object-contain rounded-xl"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          )}
                          {msg.role === "user" ? (
                            (msg.content.includes("ftypheic") || msg.content.includes("mif1heic") || msg.content.startsWith("\u0000\u0000\u0000") || (msg.content.match(/\uFFFD/g) || []).length > 20) ? (
                              <div className="bg-amber-950/50 border border-amber-500/50 rounded-xl p-3 text-amber-200 space-y-1 my-1">
                                <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                                  <span>iPhone HEIC ඡායාරූපයක් Text ලෙස ඇතුළත් වී ඇත</span>
                                </div>
                                <p className="text-xs text-amber-200/90 leading-relaxed font-sans">
                                  මෙම පණිවිඩයේ කියවිය නොහැකි ඡායාරූප ගොනු දත්ත (HEIC binary) අඩංගුයි. කරුණාකර කැමරා අයිකනය (Camera button) භාවිතයෙන් ඡායාරූපය කෙලින්ම upload කරන්න.
                                </p>
                              </div>
                            ) : (
                              <p className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{msg.content}</p>
                            )
                          ) : (

                            <div className="prose prose-invert prose-sm max-w-none leading-relaxed text-sm font-sans">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          )}
                          
                          <div className="flex items-center justify-between gap-4 mt-2 pt-1 border-t border-slate-700/30">
                            <span className={`text-[9px] font-mono ${
                              isAdminMsg ? "text-emerald-400/80" : msg.role === "user" ? "text-rose-200/80" : "text-slate-400"
                            }`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            
                            <button
                              onClick={() => handleUserDeleteMessage(msg.id)}
                              className={`p-1 rounded-lg opacity-40 md:opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-all duration-200 cursor-pointer ${
                                isAdminMsg
                                  ? "hover:bg-emerald-900/50 text-emerald-400"
                                  : msg.role === "user" 
                                    ? "hover:bg-rose-700 text-rose-200" 
                                    : "hover:bg-slate-700 text-slate-400"
                              }`}
                              title="තිරයෙන් මකන්න (Delete from my view)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 border border-slate-700/50 rounded-3xl p-4 rounded-tl-sm max-w-[80%] flex items-center gap-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                      </div>
                      <span className="text-xs text-slate-300 font-medium">{loadingText}</span>
                    </div>
                  </div>
                )}
                
                {newAdminAlert && (
                  <div className="p-3.5 bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 border-2 border-emerald-500 rounded-2xl shadow-xl shadow-emerald-950/60 flex items-center justify-between gap-3 animate-fadeIn my-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-5 h-5 text-emerald-400 animate-pulse" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <span>සුවසැත සෞඛ්‍ය උපදේශකවරයාගේ සෘජු පිළිතුරක් ලැබිණි</span>
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded-full font-mono">LIVE</span>
                        </p>
                        <p className="text-[11px] text-emerald-100/90 mt-0.5 leading-relaxed">
                          {newAdminAlert}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewAdminAlert(null)}
                      className="p-1.5 text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/40 rounded-lg transition-all shrink-0 cursor-pointer"
                      title="වසන්න"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>


              {/* Chat Inputs & Suggestions */}
              {userMsgCount >= 1 && !contactSaved ? (
                <div className="p-5 border-t border-slate-800 bg-[#151c2c] shrink-0 space-y-4 animate-fadeIn" id="contact_requirement_panel">
                  <div className="bg-rose-950/20 border border-rose-900/30 rounded-2xl p-4">
                    <div className="flex gap-2.5 items-start">
                      <ShieldCheck className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-100 font-display">
                          සංවාදය දිගටම කරගෙන යාමට (To Continue the Chat)
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          සුවසැත හරහා සාකච්ඡාව දිගටම කරගෙන යාමට, කරුණාකර Google ගිණුමෙන් හෝ ඔබගේ පරිශීලක නාමය (Username) මඟින් ඇතුළු වන්න. දත්ත කිසිදු තෙවන පාර්ශවයකට ලබා නොදෙන අතර රහස්‍යභාවය සම්පූර්ණයෙන්ම සුරක්ෂිත වේ.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={handleVerifyAgeWithGoogle}
                      disabled={googleSubmitting}
                      className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-3 px-4 rounded-2xl flex items-center justify-center gap-2.5 shadow-lg shadow-rose-500/10 disabled:opacity-50 disabled:shadow-none transition-all text-sm cursor-pointer"
                    >
                      {googleSubmitting ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      <span>Google හරහා ඇතුළු වන්න (Sign in with Google)</span>
                    </button>

                    <div className="flex items-center gap-2 my-1">
                      <div className="h-px bg-slate-800 flex-1" />
                      <span className="text-[11px] text-slate-500 font-mono">හෝ (OR)</span>
                      <div className="h-px bg-slate-800 flex-1" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAuthModalTab("username");
                        setAuthModalOpen(true);
                      }}
                      className="w-full bg-purple-950/40 hover:bg-purple-900/60 text-purple-200 border border-purple-800/50 font-semibold py-3 px-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all text-sm cursor-pointer"
                    >
                      <User className="w-4 h-4 text-purple-400" />
                      <span>Nick Name එකකින් නිර්නාමිකව ප්‍රශ්න අසන්න</span>
                    </button>

                    {contactError && (
                      <p className="text-xs text-rose-400 font-medium flex items-center gap-1 animate-fadeIn">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{contactError}</span>
                      </p>
                    )}

                    <p className="text-[11px] text-slate-400 text-center mt-2.5">
                      ඇතුළු වීමෙන් ඔබ අපගේ <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-rose-400 hover:underline font-semibold">රහස්‍යතා ප්‍රකාශනයට (Privacy Policy)</a> එකඟ වේ.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 sm:p-4 border-t border-slate-800 bg-[#151c2c] shrink-0 w-full max-w-full overflow-hidden">
                  
                  {messages.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 pt-0.5 scrollbar-none w-full max-w-full" id="horizontal_quick_suggestions">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] font-medium py-1.5 px-3 rounded-full border border-rose-900/50 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 shrink-0 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>ඡායාරූපයක් එක් කරන්න (Add Photo)</span>
                      </button>
                    </div>
                  )}

                  {/* Selected image preview panel */}
                  {selectedImage && (
                    <div className="mb-3 p-3 bg-slate-800/80 rounded-2xl border border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative animate-fadeIn">
                      <div className="flex items-center gap-3">
                        <img
                          src={selectedImage}
                          alt="Selected Upload"
                          className="w-16 h-16 object-cover rounded-xl border border-slate-600 bg-[#0e131f]"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                            <span>ඡායාරූපය සාර්ථකව එක් කරන ලදී (100% රහසිගතයි & සුරක්ෂිතයි)</span>
                          </p>
                          <p className="text-[10px] text-slate-300 mt-0.5 leading-relaxed max-w-md">
                            ඔබ මෙහි ඇතුළත් කරන ඡායාරූප සහ සියලු තොරතුරු 100%ක් රහසිගත වන අතර කිසිදු බාහිර පුද්ගලයෙකුට එය නැරඹිය නොහැක. කිසිදු බියකින් තොරව ඔබේ සෞඛ්‍ය ගැටලුවට අදාළ ඕනෑම සංවේදී හෝ රහස්‍ය ඡායාරූපයක් (සමේ ආසාදන, ලිංගික හෝ ශරීර ලක්ෂණ, UPT පරීක්ෂණ තීරු, ඖෂධ) මෙහි ඇතුළත් කර විමසිය හැක. AI මිතුරා උපරිමයෙන් එය විශ්ලේෂණය කර සහනදායී වෛද්‍ය පිළිතුරක් ලබා දෙනු ඇත.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedImage(null)}
                        className="absolute top-2 right-2 sm:static p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-full transition-all shrink-0"
                        title="පින්තූරය ඉවත් කරන්න"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2 w-full max-w-full items-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp"
                      className="hidden"
                    />
                    
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading || compressing}
                      className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all border border-slate-700 shrink-0 cursor-pointer"
                      title="පින්තූරයක් එකතු කරන්න (Add an Image)"
                    >
                      {compressing ? (
                        <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-rose-400" />
                      ) : (
                        <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
                      )}
                    </button>

                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onPaste={handlePaste}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSend();
                      }}
                      placeholder="ඔබේ ගැටලුව මෙතැන ලියන්න (සිංහල හෝ Singlish)..."
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 rounded-xl sm:rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-base sm:text-sm focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all font-sans"
                      disabled={loading}
                      id="chat_input_field"
                    />
                    
                    <button
                      onClick={() => handleSend()}
                      disabled={loading || compressing || (!input.trim() && !selectedImage)}
                      className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shadow-rose-500/20 disabled:opacity-50 disabled:shadow-none transition-all shrink-0 cursor-pointer"
                      id="btn_send_message"
                    >
                      <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                  
                  <p className="text-[10px] text-center text-slate-500 mt-2 font-display">
                    confidential • peer-to-peer advisor • medical facts only
                  </p>
                </div>
              )}

            </div>
          ) : (
            // ==========================================
            // SECURE ADMIN CONTROL PANEL
            // ==========================================
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#151c2c]" id="admin_control_interface">
              
              {/* Admin Panel Header */}
              <div className="p-3 sm:p-5 border-b border-slate-800 bg-[#0e131f] text-white flex flex-wrap gap-2.5 justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 animate-pulse shrink-0" />
                  <div>
                    <h2 className="text-xs sm:text-sm font-bold font-display leading-none">සුවසැත පරිපාලන පාලකය</h2>
                    <p className="text-[8px] sm:text-[9px] text-slate-500 mt-1 font-mono">ADMIN CONTROL CENTRE • SECURED</p>
                  </div>
                </div>

                {adminUser ? (
                  <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap">
                    <span className="text-xs font-mono text-slate-400 hidden xl:inline mr-1">{maskEmail(adminUser.email)}</span>
                    <button
                      onClick={() => setAdminMode(false)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      title="සාමාන්‍ය පරිශීලක මෙනුව වෙත පිවිසෙන්න"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>සාමාන්‍ය Chat <span className="hidden sm:inline">(User View)</span></span>
                    </button>
                    <button
                      onClick={handleAdminLogout}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                      id="btn_admin_logout"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">නික්මෙන්න</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-rose-400 uppercase tracking-widest font-mono">RESTRICTED</span>
                )}
              </div>

              {/* Status Message Alerts */}
              {adminMessage && (
                <div className={`p-3.5 text-xs text-center border-b flex justify-between items-center ${
                  adminMessage.type === "success" 
                    ? "bg-emerald-950/20 text-emerald-300 border-emerald-900/30" 
                    : "bg-rose-950/20 text-rose-300 border-rose-900/30"
                }`}>
                  <span className="font-medium">{adminMessage.text}</span>
                  <button onClick={() => setAdminMessage(null)} className="opacity-60 hover:opacity-100">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Authenticated Admin Dashboard Layout */}
              <div className="flex-1 flex flex-col overflow-hidden" id="admin_dashboard_authenticated">
                  
                  {/* Admin Tab Switcher */}
                  <div className="flex border-b border-slate-800 bg-[#0e131f] px-3 pt-2.5 gap-2 shrink-0 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setAdminActiveTab("sessions")}
                      className={`pb-2.5 px-2.5 sm:px-3.5 text-xs font-bold font-display flex items-center gap-1.5 sm:gap-2 border-b-2 transition-all cursor-pointer shrink-0 ${
                        adminActiveTab === "sessions"
                          ? "border-rose-500 text-rose-400"
                          : "border-transparent text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>සාකච්ඡා සැසි <span className="hidden sm:inline">(Sessions)</span></span>
                      <span className="bg-slate-800 text-slate-300 text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-mono">
                        {adminSessions.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAdminActiveTab("users");
                        fetchAdminUsers();
                      }}
                      className={`pb-2.5 px-2.5 sm:px-3.5 text-xs font-bold font-display flex items-center gap-1.5 sm:gap-2 border-b-2 transition-all cursor-pointer shrink-0 ${
                        adminActiveTab === "users"
                          ? "border-pink-500 text-pink-400"
                          : "border-transparent text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>පරිශීලක නාමාවලිය <span className="hidden sm:inline">(Verified Users)</span></span>
                      <span className="bg-pink-950/60 border border-pink-800/50 text-pink-300 text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-mono font-bold">
                        {adminUsersList.length || adminSessions.filter(s => getSessionEmail(s)).length}
                      </span>
                    </button>
                  </div>

                  {adminActiveTab === "sessions" ? (
                    // Tab 1: Full-Width Sessions Management View
                    <div className="flex-1 flex flex-col h-full overflow-hidden" id="admin_sessions_container">
                      
                      {/* Full-Width Session Records Table */}
                      <div className="w-full flex-col h-full overflow-hidden flex" id="admin_sessions_list">
                        
                        {/* Search, Filter and Actions Toolbar */}
                        <div className="p-3 bg-[#0b0f19] border-b border-slate-800 flex flex-col gap-2 shrink-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-300 font-display flex items-center gap-1.5">
                              <Database className="w-3.5 h-3.5 text-rose-400" />
                              <span>
                                දත්ත ගබඩාවේ සැසි ({filteredAdminSessions.length === adminSessions.length ? `මුළු සැසි ${adminSessions.length}` : `පෙන්වන්නේ ${filteredAdminSessions.length} / මුළු ${adminSessions.length}`})
                              </span>
                            </span>

                            
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={handleCleanupSessions}
                                disabled={adminLoading}
                                className="bg-amber-950/40 hover:bg-amber-900/40 text-amber-300 border border-amber-900/30 px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                                title="කල් ඉකුත් වූ සැසි පවිත්‍රණය (Clean up)"
                              >
                                <Trash2 className="w-3 h-3 text-amber-400" />
                                <span className="hidden sm:inline">පවිත්‍රණය</span>
                              </button>
                              <button
                                onClick={() => {
                                  fetchAdminSessions(adminToken);
                                  fetchAdminUsers(adminToken);
                                }}
                                disabled={adminLoading}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg text-xs transition-all border border-slate-700/50 cursor-pointer"
                                title="යාවත්කාලීන කරන්න"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${adminLoading ? "animate-spin" : ""}`} />
                              </button>
                            </div>
                          </div>

                          {/* Search Input */}
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={adminSearchTerm}
                              onChange={(e) => setAdminSearchTerm(e.target.value)}
                              placeholder="සැසි ID, ඊමේල්, IP, දුරකථන හෝ පණිවිඩ සොයන්න..."
                              className="w-full bg-[#151c2c] border border-slate-800 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono"
                            />
                            {adminSearchTerm && (
                              <button
                                type="button"
                                onClick={() => setAdminSearchTerm("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {/* Filter Chips */}
                          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[10px] font-sans scrollbar-none">
                            <button
                              type="button"
                              onClick={() => setAdminSessionFilter("all")}
                              className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                                adminSessionFilter === "all"
                                  ? "bg-rose-600 text-white shadow-sm"
                                  : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              සියල්ල ({adminSessions.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdminSessionFilter("active")}
                              className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                                adminSessionFilter === "active"
                                  ? "bg-emerald-600 text-white shadow-sm"
                                  : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              සක්‍රීය ({adminSessions.filter(s => parseDateSafely(s.expiresAt).getTime() >= Date.now()).length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdminSessionFilter("old")}
                              className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
                                adminSessionFilter === "old"
                                  ? "bg-amber-600 text-white shadow-sm"
                                  : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              <Archive className="w-2.5 h-2.5" />
                              <span>පැරණි දත්ත ({adminSessions.filter(s => parseDateSafely(s.expiresAt).getTime() < Date.now() || s.isLegacyOrExpired).length})</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdminSessionFilter("with_email")}
                              className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                                adminSessionFilter === "with_email"
                                  ? "bg-pink-600 text-white shadow-sm"
                                  : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              ඊමේල් සහිත ({adminSessions.filter(s => getSessionEmail(s)).length})
                            </button>
                            {adminSessions.some(s => s.needsAdminAttention) && (
                              <button
                                type="button"
                                onClick={() => setAdminSessionFilter("attention")}
                                className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                                  adminSessionFilter === "attention"
                                    ? "bg-amber-500 text-slate-950 font-extrabold shadow-sm"
                                    : "bg-amber-950/50 text-amber-300 border border-amber-800/50"
                                }`}
                              >
                                සහය අවශ්‍යයි ({adminSessions.filter(s => s.needsAdminAttention).length})
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Table / List Body */}
                        <div className="flex-1 overflow-y-auto divide-y divide-slate-800 chat-scroll">
                          {filteredAdminSessions.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-xs">
                              {adminSearchTerm || adminSessionFilter !== "all"
                                ? "සෙවුමට ගැළපෙන කිසිදු සාකච්ඡාවක් හමු නොවීය."
                                : "කිසිදු සාකච්ඡා සැසියක් දත්ත ගබඩාවේ හමු නොවීය."}
                            </div>
                          ) : (
                            filteredAdminSessions.map((session) => {
                              const isSelected = selectedSession?.id === session.id;
                              const createdDate = parseDateSafely(session.createdAt);
                              const lastActive = parseDateSafely(session.lastActiveAt);
                              const expired = parseDateSafely(session.expiresAt).getTime() < Date.now() || session.isLegacyOrExpired;

                              return (
                                <div 
                                  key={session.id}
                                  className={`p-3.5 hover:bg-[#151c2c] transition-all cursor-pointer flex items-start justify-between gap-2 ${
                                    isSelected ? "bg-rose-950/20 border-l-2 border-rose-500" : ""
                                  }`}
                                  onClick={() => {
                                    setSelectedSession(session);
                                    setShowAdminComposer(true);
                                    if (session.needsAdminAttention) {
                                      setAdminShowUserDetails(true);
                                    }
                                  }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs font-mono font-bold text-slate-200 truncate block">
                                        {session.id}
                                      </span>
                                      {session.needsAdminAttention && (
                                        <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded-full font-sans font-bold flex items-center gap-1 animate-pulse shrink-0">
                                          <AlertCircle className="w-2.5 h-2.5 text-amber-400" />
                                          <span>සෘජු සහය අවශ්‍යයි</span>
                                        </span>
                                      )}
                                      {session.legacySource ? (
                                        <span className="text-[9px] bg-indigo-950 text-indigo-300 border border-indigo-800/50 px-1.5 py-0.5 rounded font-mono shrink-0">
                                          පැරණි {session.legacySource}
                                        </span>
                                      ) : expired ? (
                                        <span className="text-[9px] bg-amber-950/80 text-amber-300 border border-amber-800/60 px-1.5 py-0.5 rounded font-medium flex items-center gap-1 shrink-0">
                                          <Archive className="w-2.5 h-2.5 text-amber-400" />
                                          <span>පැරණි දත්ත</span>
                                        </span>
                                      ) : (
                                        <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-900/50 px-1 py-0.5 rounded shrink-0">
                                          සක්‍රීය
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400 space-y-1">
                                      <p className="flex items-center gap-1">
                                        <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                                        <span>අවසාන සන්නිවේදනය: {lastActive.toLocaleDateString()} {lastActive.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                      </p>
                                      <p>පණිවිඩ ගණන: <strong className="text-slate-300">{session.messages ? session.messages.length : 0}</strong></p>
                                      
                                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                                        {session.userIp && (
                                          <span className="text-cyan-300 font-mono text-[9px] bg-cyan-950/40 py-0.5 px-1.5 rounded border border-cyan-800/40 flex items-center gap-1">
                                            <Globe className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                                            <span>IP: {session.userIp}</span>
                                          </span>
                                        )}

                                        {(() => {
                                          const email = getSessionEmail(session);
                                          if (!email) return null;
                                          return (
                                            <span className="text-pink-300 font-mono text-[9px] bg-pink-950/40 py-0.5 px-1.5 rounded border border-pink-800/40 flex items-center gap-1 font-semibold">
                                              <Mail className="w-2.5 h-2.5 text-pink-400 shrink-0" />
                                              <span className="truncate max-w-[150px]">{email}</span>
                                            </span>
                                          );
                                        })()}
                                      </div>

                                      {session.contactInfo && (
                                        <p className="text-rose-300 font-medium flex items-center gap-1 mt-1 font-mono text-[9px] bg-rose-950/20 py-0.5 px-1.5 rounded border border-rose-900/30 w-fit">
                                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                          <span>
                                            {session.contactType === "google" 
                                              ? `Google: ${parseGoogleContact(session.contactInfo).name}` 
                                              : session.contactType === "facebook" 
                                                ? `Facebook: ${parseFacebookContact(session.contactInfo).name}` 
                                                : `${session.contactType === "whatsapp" ? "WhatsApp" : "Telegram"}: ${session.contactInfo}`}
                                          </span>
                                        </p>
                                      )}
                                      {session.directContactNumber && (
                                        <p className="text-emerald-300 font-medium flex items-center gap-1 mt-1 font-mono text-[9px] bg-emerald-950/20 py-0.5 px-1.5 rounded border border-emerald-900/30 w-fit">
                                          <Phone className="w-3 h-3 text-emerald-400 shrink-0" />
                                          <span>දුරකථන: {session.directContactNumber}</span>
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 self-center">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedSession(session);
                                      }}
                                      className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                                      title="මෙම සාකච්ඡාව සම්පූර්ණ තිරයෙන් බලන්න"
                                    >
                                      <Maximize2 className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">සම්පූර්ණ තිරයෙන් බලන්න</span>
                                      <span className="sm:hidden">බලන්න</span>
                                    </button>

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSession(session.id);
                                      }}
                                      className="text-slate-400 hover:text-rose-400 p-2 rounded-xl hover:bg-slate-800 transition-all shrink-0 cursor-pointer"
                                      title="මෙම සැසිය මකන්න"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                      </div>

                    </div>
                  ) : (
                    // Tab 2: Verified Users & Email Directory View
                    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0c101b]" id="admin_users_directory">
                      
                      {/* Top Metrics Cards Bar */}
                      <div className="p-3 sm:p-4 border-b border-slate-800 bg-[#0e131f] shrink-0">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                          
                          <div className="p-2.5 sm:p-3 bg-[#151c2c] rounded-2xl border border-slate-800 flex items-center gap-2.5 sm:gap-3">
                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-pink-950/60 border border-pink-800/50 flex items-center justify-center text-pink-400 shrink-0">
                              <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider truncate">මුළු පරිශීලකයින්</span>
                              <span className="text-base sm:text-lg font-bold text-slate-100 font-display">
                                {adminUsersList.length}
                              </span>
                            </div>
                          </div>

                          <div className="p-2.5 sm:p-3 bg-[#151c2c] rounded-2xl border border-slate-800 flex items-center gap-2.5 sm:gap-3">
                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-rose-950/60 border border-rose-800/50 flex items-center justify-center text-rose-400 shrink-0">
                              <Mail className="w-4 h-4 sm:w-5 sm:h-5" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider truncate">Google ඊමේල්</span>
                              <span className="text-base sm:text-lg font-bold text-pink-400 font-display">
                                {adminUsersList.filter(u => u.email).length}
                              </span>
                            </div>
                          </div>

                          <div className="p-2.5 sm:p-3 bg-[#151c2c] rounded-2xl border border-slate-800 flex items-center gap-2.5 sm:gap-3">
                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0">
                              <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider truncate">හඳුනාගත් IP</span>
                              <span className="text-base sm:text-lg font-bold text-cyan-300 font-display">
                                {new Set(adminUsersList.filter(u => u.lastIp).map(u => u.lastIp)).size}
                              </span>
                            </div>
                          </div>

                          <div className="p-2.5 sm:p-3 bg-[#151c2c] rounded-2xl border border-slate-800 flex items-center gap-2.5 sm:gap-3">
                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center text-emerald-400 shrink-0">
                              <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider truncate">සක්‍රීය සැසි</span>
                              <span className="text-base sm:text-lg font-bold text-emerald-400 font-display">
                                {adminSessions.length}
                              </span>
                            </div>
                          </div>

                        </div>

                        {/* Search and Refresh Bar */}
                        <div className="mt-3.5 flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={userSearchQuery}
                              onChange={(e) => setUserSearchQuery(e.target.value)}
                              placeholder="ඊමේල්, නම, IP හෝ UID මඟින් සොයන්න (Search by Email, Name, IP, UID)..."
                              className="w-full bg-[#151c2c] border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
                            />
                            {userSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setUserSearchQuery("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => fetchAdminUsers()}
                            disabled={adminLoading}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border border-slate-700/50 cursor-pointer shrink-0"
                            title="පරිශීලක ලැයිස්තුව යාවත්කාලීන කරන්න"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${adminLoading ? "animate-spin" : ""}`} />
                            <span className="hidden sm:inline">යාවත්කාලීන</span>
                          </button>
                        </div>
                      </div>

                      {/* User Records List / Grid */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 chat-scroll">
                        {(() => {
                          const query = userSearchQuery.trim().toLowerCase();
                          const filtered = adminUsersList.filter(u => {
                            if (!query) return true;
                            return (
                              (u.email && u.email.toLowerCase().includes(query)) ||
                              (u.displayName && u.displayName.toLowerCase().includes(query)) ||
                              (u.lastIp && u.lastIp.toLowerCase().includes(query)) ||
                              (u.id && u.id.toLowerCase().includes(query))
                            );
                          });

                          if (filtered.length === 0) {
                            return (
                              <div className="p-12 text-center text-slate-500 text-xs bg-[#0e131f] rounded-2xl border border-slate-800/60 my-6">
                                <Users className="w-10 h-10 mx-auto mb-3 opacity-30 text-rose-400" />
                                <p className="font-semibold text-slate-400">කිසිදු පරිශීලකයෙකු හමු නොවීය.</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                  {userSearchQuery ? "සෙවුම් පදයට ගැළපෙන දත්ත නොමැත." : "තවමත් පරිශීලකයින් එකතු වී නොමැත."}
                                </p>
                              </div>
                            );
                          }

                          return filtered.map((u) => {
                            const isSelectedSessionAvailable = u.lastSessionId && adminSessions.some(s => s.id === u.lastSessionId);
                            const mailtoUrl = u.email ? `mailto:${u.email}?subject=${encodeURIComponent("සුවසැත SRH සෞඛ්‍ය උපදේශනය - පරිපාලක පණිවිඩය (Suwasetha Support)")}&body=${encodeURIComponent(`ආයුබෝවන් ${u.displayName || ""},\n\nසුවසැත (Suwasetha) ලිංගික හා ප්‍රජනක සෞඛ්‍ය උපදේශන සේවාව හා සම්බන්ධ වීම පිළිබඳව ස්තූතියි.\n\nඔබගේ ගැටලුව හෝ විමසීම සම්බන්ධයෙන් අපට ඔබට කෙසේ උපකාර කළ හැකිද?\n\nස්තූතියි,\nසුවසැත පරිපාලක කණ්ඩායම`)}` : "";

                            return (
                              <div
                                key={u.id || u.email}
                                className="p-4 bg-[#121826] hover:bg-[#151c2c] transition-all rounded-2xl border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4"
                              >
                                {/* Left Info: Avatar, Name, Email, Meta */}
                                <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                                  {u.photoURL ? (
                                    <img
                                      src={u.photoURL}
                                      alt={u.displayName || "User"}
                                      className="w-12 h-12 rounded-2xl border-2 border-rose-500/40 object-cover shrink-0 shadow-md shadow-rose-500/10"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-950 to-slate-900 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold text-base shrink-0 shadow-md">
                                      {u.displayName ? u.displayName.charAt(0).toUpperCase() : <User className="w-6 h-6" />}
                                    </div>
                                  )}

                                  <div className="min-w-0 flex-1 space-y-1.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="text-sm font-bold text-slate-100 font-display">
                                        {u.displayName || "Google User"}
                                      </h4>
                                      <span className="text-[9px] bg-rose-950/60 text-rose-300 border border-rose-800/50 px-2 py-0.5 rounded-full font-mono font-semibold uppercase">
                                        {u.provider || "Google Auth"}
                                      </span>
                                    </div>

                                    {/* Prominent Email Address Badge */}
                                    <div className="flex flex-wrap items-center gap-2">
                                      {u.email ? (
                                        <div className="inline-flex items-center gap-1.5 bg-pink-950/40 border border-pink-700/50 text-pink-200 px-2.5 py-1 rounded-xl font-mono text-xs font-bold shadow-inner max-w-full">
                                          <Mail className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                                          <span className="select-all break-all">{u.email}</span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-500 text-xs italic">ඊමේල් ලිපිනය නොමැත</span>
                                      )}

                                      {u.lastIp && (
                                        <span className="inline-flex items-center gap-1 text-cyan-300 font-mono text-[10px] bg-cyan-950/40 py-0.5 px-2 rounded-lg border border-cyan-800/40">
                                          <Globe className="w-3 h-3 text-cyan-400 shrink-0" />
                                          <span>IP: {u.lastIp}</span>
                                        </span>
                                      )}
                                    </div>

                                    {/* Dates & UID */}
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 font-mono pt-0.5">
                                      {u.createdAt && (
                                        <span>පළමු පිවිසුම: <strong className="text-slate-300">{new Date(u.createdAt).toLocaleDateString()}</strong></span>
                                      )}
                                      {u.lastLoginAt && (
                                        <span>අවසන් ක්‍රියාකාරීත්වය: <strong className="text-slate-300">{new Date(u.lastLoginAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</strong></span>
                                      )}
                                      {u.id && (
                                        <span className="text-slate-500 truncate max-w-[180px]">UID: {u.id}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Right Actions: Send Email, Copy Email, View Session, Delete User */}
                                <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
                                  {u.email && (
                                    <>
                                      <a
                                        href={mailtoUrl}
                                        className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm font-semibold text-xs cursor-pointer"
                                        title="පරිශීලකයාට ඊමේල් පණිවිඩයක් යවන්න (Send Email)"
                                      >
                                        <Mail className="w-3.5 h-3.5" />
                                        <span>Email යවන්න</span>
                                      </a>

                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(u.email);
                                          setCopiedEmail(`user_${u.id}`);
                                          setTimeout(() => setCopiedEmail(null), 2000);
                                        }}
                                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 text-xs border border-slate-700/60 cursor-pointer"
                                        title="Email ලිපිනය කොපි කරන්න"
                                      >
                                        {copiedEmail === `user_${u.id}` ? (
                                          <>
                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                            <span className="text-emerald-400">කොපි විය</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                                            <span>කොපි</span>
                                          </>
                                        )}
                                      </button>
                                    </>
                                  )}

                                  {u.lastSessionId && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        let target = adminSessions.find(s => s.id === u.lastSessionId);
                                        if (!target && db) {
                                          try {
                                            const snap = await getDoc(doc(db, "sessions", u.lastSessionId!));
                                            if (snap.exists()) {
                                              target = normalizeSessionData(snap.id, snap.data(), "sessions");
                                            }
                                          } catch (e) {
                                            console.warn("Could not fetch session from Firestore:", e);
                                          }
                                        }
                                        if (!target) {
                                          target = {
                                            id: u.lastSessionId!,
                                            createdAt: u.createdAt,
                                            lastActiveAt: u.lastLoginAt,
                                            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                                            messages: [],
                                            userEmail: u.email,
                                            userIp: u.lastIp
                                          };
                                        }
                                        setSelectedSession(target);
                                        setAdminActiveTab("sessions");
                                      }}
                                      className="bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/50 px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 text-xs cursor-pointer"
                                      title="මෙම පරිශීලකයාගේ සාකච්ඡා සැසිය බලන්න"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5" />
                                      <span>සැසිය</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteUser(u.id, u.email)}
                                    className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-xl transition-all border border-transparent hover:border-rose-900/40 cursor-pointer"
                                    title="පරිශීලක තොරතුරු මකන්න"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                              </div>
                            );
                          });
                        })()}
                      </div>

                    </div>
                  )}
                  {/* Full Display Admin Live Chat Workspace */}
                  <AnimatePresence>
                    {selectedSession && (
                      <AdminFullScreenChat
                        selectedSession={selectedSession}
                        onClose={() => setSelectedSession(null)}
                        adminReplyText={adminReplyText}
                        setAdminReplyText={setAdminReplyText}
                        adminReplySending={adminReplySending}
                        adminReplySuccess={adminReplySuccess}
                        handleSendAdminMessage={handleSendAdminMessage}
                        handleDeleteSession={handleDeleteSession}
                        fetchAdminSessions={() => fetchAdminSessions(adminToken)}
                        getSessionEmail={getSessionEmail}
                        parseDateSafely={parseDateSafely}
                        db={db}
                      />
                    )}
                  </AnimatePresence>


                </div>
              </div>
            )}

        </div>

      </main>

      {/* Admin Contact Alert Prompt Modal */}
      {showContactPromptForAdminAlert && (
        <div className="fixed inset-0 bg-[#090d16]/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#151c2c] rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-slate-800 relative"
          >
            <button 
              onClick={() => setShowContactPromptForAdminAlert(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 p-1.5 rounded-full hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-bold text-slate-100 font-display mb-2 flex items-center gap-2">
              <Phone className="w-5 h-5 text-rose-500" />
              <span>සම්බන්ධතා තොරතුරු ඇතුළත් කරන්න</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              අපගේ සෞඛ්‍ය උපදේශකවරයා හට ඔබව සම්බන්ධ කරගෙන සෘජුව සහය වීමට හැකි වන පරිදි කරුණාකර ඔබගේ **WhatsApp අංකය** හෝ **Telegram ID** එක ඇතුළත් කරන්න. මෙම තොරතුරු 100% රහසිගතව සුරැකෙනු ඇත.
            </p>

            <div className="space-y-4">
              {/* Selector tabs */}
              <div className="flex gap-2 p-1 bg-[#0e131f] rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setTempContactType("whatsapp");
                    setContactError(null);
                  }}
                  className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
                    tempContactType === "whatsapp"
                      ? "bg-rose-600 text-white shadow-md"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Phone className="w-4 h-4" />
                  <span>WhatsApp අංකය</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTempContactType("telegram");
                    setContactError(null);
                  }}
                  className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
                    tempContactType === "telegram"
                      ? "bg-rose-600 text-white shadow-md"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>Telegram ID</span>
                </button>
              </div>

              {/* Input row */}
              <div className="relative">
                <input
                  type="text"
                  value={tempContactInfo}
                  onChange={(e) => {
                    setTempContactInfo(e.target.value);
                    if (contactError) setContactError(null);
                  }}
                  placeholder={
                    tempContactType === "whatsapp"
                      ? "උදා: 0771234567"
                      : "උදා: @username"
                  }
                  className="w-full bg-[#0e131f] border border-slate-800 text-slate-100 placeholder-slate-600 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all font-sans"
                  disabled={contactSubmitting}
                />
              </div>

              {contactError && (
                <p className="text-xs text-rose-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{contactError}</span>
                </p>
              )}

              <button
                type="button"
                onClick={async () => {
                  setContactError(null);
                  setContactSubmitting(true);
                  const err = await handleSaveContactInfo(tempContactInfo, tempContactType);
                  setContactSubmitting(false);
                  if (err) {
                    setContactError(err);
                  } else {
                    // Contact saved successfully! Now close modal and trigger admin alert
                    setShowContactPromptForAdminAlert(false);
                    // Trigger the notification with a small delay so state registers
                    setTimeout(() => {
                      handleNotifyAdminClickDirectlyAfterSaving();
                    }, 100);
                  }
                }}
                disabled={contactSubmitting || !tempContactInfo.trim()}
                className="w-full bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-rose-500/10 disabled:opacity-50 disabled:shadow-none transition-all text-xs cursor-pointer"
              >
                {contactSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <span>සුරැකීම සහ දැනුවත් කිරීම (Submit & Alert)</span>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Direct Contact Phone Number collection popup */}
      {showDirectContactModal && (
        <div className="fixed inset-0 bg-[#090d16]/90 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#151c2c] rounded-2xl sm:rounded-3xl p-5 sm:p-6 md:p-8 max-w-md w-full shadow-2xl border border-slate-800 relative my-auto max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
          >
            <button 
              onClick={() => setShowDirectContactModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 p-1.5 rounded-full hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base sm:text-lg font-bold text-slate-100 font-display mb-2 flex items-center gap-2 shrink-0">
              <Phone className="w-5 h-5 text-emerald-500" />
              <span>දුරකථන / WhatsApp අංකය</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-4 shrink-0">
              අපගේ සෞඛ්‍ය උපදේශකවරයාට ඔබව සෘජුව සම්බන්ධ කරගත හැකි වන පරිදි, කරුණාකර ඔබගේ දුරකථන අංකයක් හෝ WhatsApp අංකයක් මෙහි ඇතුළත් කරන්න. මෙම තොරතුරු 100% රහසිගතව සුරැකෙන අතර, වෛද්‍ය උපදේශක මණ්ඩලයට පමණක් සෘජුව සහය වීමට භාවිත වේ.
            </p>

            <div className="space-y-4 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  value={directContactNumberInput}
                  onChange={(e) => {
                    setDirectContactNumberInput(e.target.value);
                  }}
                  placeholder="උදා: 0771234567"
                  className="w-full bg-[#0e131f] border border-slate-800 text-slate-100 placeholder-slate-600 rounded-xl sm:rounded-2xl px-4 py-3 text-base sm:text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-sans"
                  disabled={adminNotificationLoading}
                />
              </div>

              <div className="flex gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowDirectContactModal(false)}
                  disabled={adminNotificationLoading}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl sm:rounded-2xl font-semibold transition-all text-xs cursor-pointer"
                >
                  අවලංගු කරන්න
                </button>
                <button
                  type="button"
                  onClick={handleSendDirectContactNumber}
                  disabled={adminNotificationLoading || !directContactNumberInput.trim()}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold py-3 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 disabled:opacity-50 disabled:shadow-none transition-all text-xs cursor-pointer"
                >
                  {adminNotificationLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>යවන්න (Send)</span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Mobile Helpline Modal */}
      {showMobileHelpline && (
        <div className="fixed inset-0 bg-[#090d16]/90 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain" id="mobile_helpline_modal">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#151c2c] rounded-2xl sm:rounded-3xl p-4 sm:p-6 max-w-lg w-full shadow-2xl border border-slate-800 relative max-h-[calc(100dvh-2rem)] flex flex-col my-auto overflow-hidden"
          >
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-100 font-display">ශ්‍රී ලංකාවේ උපකාරක සේවා සහ තොරතුරු</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMobileHelpline(false)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-full transition-all cursor-pointer"
                title="වසන්න"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 overflow-y-auto flex-1 min-h-0 chat-scroll pr-1">
              {/* Privacy Shield Info */}
              <div className="bg-rose-950/10 rounded-2xl p-3.5 border border-rose-900/20 relative overflow-hidden">
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs mb-1.5">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>100% රහස්‍යයි & සුරක්ෂිතයි</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  ඔබගේ අනන්‍යතාවය Google Login මඟින් තහවුරු වන අතර ඊමේල් ලිපිනය පමණක් ලබාගැනේ. දත්ත කිසිදු තෙවන පාර්ශවයකට ලබා නොදෙන අතර, තාක්ෂණික නඩත්තුවට හෝ පෞද්ගලික වෛද්‍ය සහයට පරිපාලක (Admin) හට පමණක් අවශ්‍යතාවය මත පරිශීලනය කළ හැක.
                </p>
              </div>

              {/* Sri Lankan Helpline Info */}
              <div className="space-y-2">
                <div className="p-3 bg-rose-950/20 rounded-2xl border border-rose-900/30">
                  <p className="text-xs font-bold text-rose-100 font-display">FPA ශ්‍රී ලංකා උපකාරක සේවය</p>
                  <p className="text-xs text-slate-400 mt-1">සඳුදා - සෙනසුරාදා (පෙ.ව. 8.30 - ප.ව. 4.30)</p>
                  <p className="text-xs font-semibold text-rose-400 mt-1 font-mono">+94 11 258 4157</p>
                  <p className="text-xs font-semibold text-rose-400 font-mono">+94 77 955 2979</p>
                </div>

                <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800">
                  <p className="text-xs font-bold text-slate-200 font-display">ජාතික ලිංගාශ්‍රිත රෝග පාලන ඒකකය</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">+94 11 266 7163</p>
                </div>

                <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800">
                  <p className="text-xs font-bold text-slate-200 font-display">රජයේ සෞඛ්‍ය තොරතුරු සේවය</p>
                  <p className="text-xs font-semibold text-slate-300 font-mono">හදිසි අංකය: 1390</p>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="bg-amber-950/20 rounded-xl p-3 border border-amber-900/30 text-xs text-amber-300">
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>වෛද්‍ය උපදෙස්:</strong> මෙම AI උපදේශකවරයා විද්‍යාත්මක තොරතුරු ලබා දීමට සකසා ඇත. කිසියම් බරපතල ශාරීරික ගැටලුවකදී වහාම වෛද්‍යවරයෙකු හමුවන්න.
                  </p>
                </div>
              </div>

              {/* Footer Links for Mobile */}
              <div className="text-center text-[11px] text-slate-500 space-y-1 pt-1">
                <p>© 2026 Suwasetha. All Rights Reserved.</p>
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-rose-400/80 hover:text-rose-400 hover:underline inline-block">
                  රහස්‍යතා ප්‍රකාශනය (Privacy Policy)
                </a>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 shrink-0">
              <button
                onClick={() => setShowMobileHelpline(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl transition-all text-xs cursor-pointer"
              >
                නැවත සාකච්ඡාවට යන්න (Go Back to Chat)
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
