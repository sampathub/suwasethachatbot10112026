import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { initializeApp as initServerApp } from "firebase/app";
import { getFirestore as getServerDb, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

dotenv.config();

// Server-side persistent storage and Firestore synchronization
const dataDir = path.join(process.cwd(), "data");
const sessionsFilePath = path.join(dataDir, "sessions.json");
const usersFilePath = path.join(dataDir, "users.json");
const accountsFilePath = path.join(dataDir, "accounts.json");

function ensureDataStorage() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err) {
    console.warn("Could not create data directory:", err);
  }
}

function readLocalStore(filePath: string): Record<string, any> {
  try {
    ensureDataStorage();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) || {};
  } catch (err) {
    return {};
  }
}

function writeLocalStore(filePath: string, data: Record<string, any>) {
  try {
    ensureDataStorage();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("Failed writing local storage file:", filePath, err);
  }
}

function cleanForFirestore(data: any): any {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object") return data;
  try {
    const jsonStr = JSON.stringify(data, (_, v) => (v === undefined ? undefined : v));
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);

    const sanitizeDeep = (item: any): any => {
      if (item === undefined) return null;
      if (item === null || typeof item !== "object") return item;
      if (Array.isArray(item)) {
        return item
          .filter((x: any) => x !== undefined)
          .map((x: any) => sanitizeDeep(x));
      }
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined) {
          out[k] = sanitizeDeep(v);
        }
      }
      return out;
    };
    return sanitizeDeep(parsed);
  } catch {
    return data;
  }
}

// Lazy initialization of Server-side Firestore
let serverFirestoreInstance: any = null;

function getServerFirestoreInstance() {
  if (!serverFirestoreInstance) {
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const serverApp = initServerApp(config, "suwasetha-server-sync");
        serverFirestoreInstance = (config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)")
          ? getServerDb(serverApp, config.firestoreDatabaseId)
          : getServerDb(serverApp);
        console.log("[Server Firestore] Ready with DB in project:", config.projectId, config.firestoreDatabaseId || "(default)");
      }
    } catch (err: any) {
      console.warn("[Server Firestore] Note:", err.message || err);
    }
  }
  return serverFirestoreInstance;
}

// Admin email verification helper
const ADMIN_EMAILS = ["kasubsampath@gmail.com"];

function isAdminAuthorized(req: Request): boolean {
  const adminEmail = (
    (req.headers["x-admin-email"] as string) ||
    (req.query.adminEmail as string) ||
    ""
  ).toLowerCase().trim();

  if (adminEmail && ADMIN_EMAILS.includes(adminEmail)) {
    return true;
  }

  // Also check Authorization header if present
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    return true;
  }

  return false;
}

// Initialize Gemini Client lazily
let aiInstance: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("WARNING: GEMINI_API_KEY environment variable is not defined!");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key || "placeholder-key-to-prevent-crash",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check and real-time clock verification endpoint
app.get("/api/health", (req: Request, res: Response) => {
  const dateInfo = formatCurrentDateInfo(undefined, "Asia/Colombo");
  res.json({
    status: "ok",
    serverTimeUtc: new Date().toISOString(),
    sriLankaDate: dateInfo.sinhalaDateFormatted,
    sriLankaTime: dateInfo.sinhalaTimeFormatted,
    year: dateInfo.year,
  });
});

// Endpoint to reliably get client's public IP address
app.get("/api/get-ip", (req: Request, res: Response) => {
  const forwarded = req.headers["x-forwarded-for"];
  let ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "";
  if (ip.startsWith("::ffff:")) {
    ip = ip.replace("::ffff:", "");
  }
  res.json({ ip: ip || "Unknown" });
});

// Endpoint to convert HEIC/HEIF images (Apple iOS camera format) to JPEG
app.post("/api/convert-heic", express.raw({ type: "*/*", limit: "30mb" }), async (req: Request, res: Response) => {
  try {
    const inputBuffer = req.body;
    if (!inputBuffer || !inputBuffer.length) {
      return res.status(400).json({ error: "No image data provided" });
    }
    const convertModule = await import("heic-convert");
    const convert = (convertModule as any).default || convertModule;
    const outputBuffer = await convert({
      buffer: inputBuffer,
      format: "JPEG",
      quality: 0.85
    });
    res.setHeader("Content-Type", "image/jpeg");
    return res.send(Buffer.from(outputBuffer));
  } catch (err: any) {
    console.warn("[Server] HEIC conversion note:", err?.message || err);
    return res.status(500).json({ error: "Failed converting HEIC image" });
  }
});


// Session Retrieval - Always returns the most complete dataset between LocalStore and Firestore
app.get("/api/sessions/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const localStore = readLocalStore(sessionsFilePath);
    let localData = localStore[id] || null;

    // Check Firestore to see if it has more or newer data
    const db = getServerFirestoreInstance();
    if (db) {
      try {
        const docSnap = await getDoc(doc(db, "sessions", id));
        if (docSnap.exists()) {
          const fsData = docSnap.data();
          const fsMsgs = Array.isArray(fsData.messages) ? fsData.messages : [];
          const localMsgs = localData && Array.isArray(localData.messages) ? localData.messages : [];

          if (!localData || fsMsgs.length >= localMsgs.length) {
            localStore[id] = { ...localData, ...fsData, id };
            writeLocalStore(sessionsFilePath, localStore);
            return res.json({ session: localStore[id] });
          }
        }
      } catch (fsErr) {
        console.warn("[Server Firestore] Read session note:", fsErr);
      }
    }

    if (localData) {
      return res.json({ session: localData });
    }

    return res.json({ session: null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed reading session" });
  }
});

// Session Persistence & Synchronization - Strictly preserves non-empty messages
app.post("/api/sessions/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const sessionData = req.body.session || req.body;
  if (!sessionData) {
    return res.status(400).json({ error: "Missing session data" });
  }

  try {
    // 1. Immediately persist to server-side local storage with message preservation
    const localStore = readLocalStore(sessionsFilePath);
    const existing = localStore[id] || {};

    const incomingMsgs = Array.isArray(sessionData.messages) ? sessionData.messages : null;
    const existingMsgs = Array.isArray(existing.messages) ? existing.messages : [];

    // Never wipe out existing messages if incoming is empty or undefined
    let resolvedMessages = existingMsgs;
    if (incomingMsgs && incomingMsgs.length > 0) {
      if (incomingMsgs.length >= existingMsgs.length) {
        resolvedMessages = incomingMsgs;
      } else {
        // Merge uniquely by message id
        const mmap = new Map();
        existingMsgs.forEach((m: any) => { if (m?.id) mmap.set(m.id, m); });
        incomingMsgs.forEach((m: any) => { if (m?.id) mmap.set(m.id, m); });
        resolvedMessages = Array.from(mmap.values());
      }
    }

    const merged = {
      ...existing,
      ...sessionData,
      id,
      messages: resolvedMessages,
      lastActiveAt: sessionData.lastActiveAt || existing.lastActiveAt || new Date().toISOString()
    };
    localStore[id] = merged;
    writeLocalStore(sessionsFilePath, localStore);

    // 2. Sync to Firestore on the server
    const db = getServerFirestoreInstance();
    if (db) {
      const now = new Date().toISOString();
      const firestorePayload = {
        ...merged,
        id,
        createdAt: merged.createdAt || now,
        lastActiveAt: merged.lastActiveAt || now,
        expiresAt: merged.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
        messages: Array.isArray(merged.messages) ? merged.messages : []
      };
      
      try {
        await Promise.race([
          setDoc(doc(db, "sessions", id), cleanForFirestore(firestorePayload), { merge: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore sync timeout")), 4000))
        ]);
      } catch (err: any) {
        console.warn("[Server Firestore] Session write background error:", err?.message || err);
      }
    }

    return res.json({ success: true, id, session: merged });
  } catch (err: any) {
    console.error("Error writing session:", err);
    return res.status(500).json({ error: err.message || "Failed saving session" });
  }
});

// Admin: Fetch all sessions from database & storage
app.get("/api/admin/sessions", async (req: Request, res: Response) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: "Unauthorized. Admin privileges required." });
  }

  try {
    const sessionsMap: Record<string, any> = readLocalStore(sessionsFilePath);

    // Fetch all documents from Firestore
    try {
      const db = getServerFirestoreInstance();
      if (db) {
        const { collection: col, getDocs: gDocs } = await import("firebase/firestore");
        const collectionsToCheck = ["sessions", "chats", "conversations", "chat_sessions"];
        for (const colName of collectionsToCheck) {
          try {
            const snap = await gDocs(col(db, colName));
            snap.forEach((d) => {
              if (d.id.startsWith("user_profile_") || d.id.startsWith("user_account_") || d.id.startsWith("test_doc_")) {
                return;
              }
              const docData = d.data();
              sessionsMap[d.id] = { id: d.id, ...sessionsMap[d.id], ...docData };
            });
          } catch {
            // Ignore non-existent optional collections
          }
        }
      }
    } catch (fsErr: any) {
      console.warn("[Server Firestore] Admin sessions read note:", fsErr.message || fsErr);
    }

    const sessionsList = Object.values(sessionsMap).filter((s: any) =>
      s && s.id && !s.id.startsWith("user_profile_") && !s.id.startsWith("user_account_") && !s.id.startsWith("test_doc_")
    );
    sessionsList.sort((a: any, b: any) => {
      const getMs = (s: any) => {
        let max = 0;
        if (s.lastActiveAt) {
          const t = new Date(s.lastActiveAt).getTime();
          if (!isNaN(t)) max = Math.max(max, t);
        }
        if (Array.isArray(s.messages) && s.messages.length > 0) {
          for (let i = s.messages.length - 1; i >= 0; i--) {
            const m = s.messages[i];
            if (m && m.timestamp) {
              const t = new Date(m.timestamp).getTime();
              if (!isNaN(t)) {
                max = Math.max(max, t);
                break;
              }
            }
          }
        }
        if (s.createdAt) {
          const t = new Date(s.createdAt).getTime();
          if (!isNaN(t)) max = Math.max(max, t);
        }
        return max;
      };
      return getMs(b) - getMs(a);
    });

    return res.json({ sessions: sessionsList });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch admin sessions" });
  }
});

// Admin: Session retrieval
app.get("/api/admin/sessions/:id", async (req: Request, res: Response) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  const { id } = req.params;
  try {
    const localStore = readLocalStore(sessionsFilePath);
    let session = localStore[id] || null;

    const db = getServerFirestoreInstance();
    if (db) {
      try {
        const snap = await getDoc(doc(db, "sessions", id));
        if (snap.exists()) {
          const fsData = snap.data();
          session = { ...session, ...fsData, id };
          localStore[id] = session;
          writeLocalStore(sessionsFilePath, localStore);
        }
      } catch (err) {
        // Continue
      }
    }

    return res.json({ session });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed reading session" });
  }
});

// Admin: Delete a session (handles DELETE, POST /delete, and fallback paths)
const handleAdminDeleteSession = async (req: Request, res: Response) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  const { id } = req.params;
  try {
    const localStore = readLocalStore(sessionsFilePath);
    delete localStore[id];
    writeLocalStore(sessionsFilePath, localStore);

    const db = getServerFirestoreInstance();
    if (db) {
      deleteDoc(doc(db, "sessions", id)).catch(() => {});
    }

    return res.json({ success: true, deletedId: id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed deleting session" });
  }
};

app.delete("/api/admin/sessions/:id", handleAdminDeleteSession);
app.post("/api/admin/sessions/:id/delete", handleAdminDeleteSession);
app.delete("/api/sessions/:id", handleAdminDeleteSession);
app.post("/api/sessions/:id/delete", handleAdminDeleteSession);

// Admin: Append an official admin message to a session chat
app.post("/api/admin/sessions/:id/message", async (req: Request, res: Response) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: "Unauthorized. Admin privileges required." });
  }

  const { id } = req.params;
  const { content, adminName, resolveAttention, message, messages } = req.body;
  const textContent = (content || message?.content || "").toString().trim();
  if (!textContent && !message) {
    return res.status(400).json({ error: "Message content is required." });
  }

  try {
    const localStore = readLocalStore(sessionsFilePath);
    let session = localStore[id];

    const db = getServerFirestoreInstance();
    if (!session && db) {
      const snap = await getDoc(doc(db, "sessions", id)).catch(() => null);
      if (snap && snap.exists()) {
        session = snap.data();
      }
    }

    const now = new Date().toISOString();
    if (!session) {
      session = {
        id,
        createdAt: now,
        lastActiveAt: now,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        messages: []
      };
    }

    if (!Array.isArray(session.messages)) {
      session.messages = [];
    }

    const newMessage = (message && message.id) ? message : {
      id: "admin_msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      role: "admin",
      content: textContent,
      timestamp: now,
      isAdminMessage: true,
      adminName: adminName?.trim() || "සුවසැත පරිපාලක (Suwasetha Admin)"
    };

    // Combine and deduplicate messages by ID
    const mmap = new Map<string, any>();
    session.messages.forEach((m: any) => { if (m?.id) mmap.set(m.id, m); });
    if (Array.isArray(messages)) {
      messages.forEach((m: any) => { if (m?.id) mmap.set(m.id, m); });
    }
    mmap.set(newMessage.id, newMessage);

    const mergedList = Array.from(mmap.values());
    mergedList.sort((a: any, b: any) => {
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tA - tB;
    });

    session.messages = mergedList;
    session.lastActiveAt = now;
    if (resolveAttention) {
      session.needsAdminAttention = false;
    }

    // Save to local store
    localStore[id] = session;
    writeLocalStore(sessionsFilePath, localStore);

    // Sync to Firestore
    if (db) {
      await setDoc(doc(db, "sessions", id), cleanForFirestore({
        ...session,
        id: session.id,
        createdAt: session.createdAt || now,
        lastActiveAt: session.lastActiveAt,
        expiresAt: session.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
        messages: session.messages,
        ...(session.userEmail ? { userEmail: session.userEmail } : {}),
        ...(session.contactInfo ? { contactInfo: session.contactInfo } : {}),
        ...(session.contactType ? { contactType: session.contactType } : {}),
        ...(session.userIp ? { userIp: session.userIp } : {}),
        ...(resolveAttention ? { needsAdminAttention: false } : {})
      }), { merge: true }).catch((err) => {
        console.warn("Firestore admin message sync warning:", err?.message || err);
      });
    }

    return res.json({ success: true, message: newMessage, session });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed appending admin message" });
  }
});


// Admin: Fetch all users from database & session history
app.get("/api/admin/users", async (req: Request, res: Response) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  try {
    const usersMap: Record<string, any> = readLocalStore(usersFilePath);

    // 1. Fetch from Firestore 'users' collection
    try {
      const db = getServerFirestoreInstance();
      if (db) {
        const { collection: col, getDocs: gDocs } = await import("firebase/firestore");
        const snap = await gDocs(col(db, "users"));
        snap.forEach((d) => {
          const u = d.data();
          const uid = d.id || u.uid || u.email;
          const key = (u.email || uid || "").toString().toLowerCase().trim();
          if (key) {
            usersMap[key] = { id: uid, ...usersMap[key], ...u };
          }
        });
      }
    } catch (fsErr: any) {
      console.warn("[Server Firestore] Admin users read note:", fsErr.message || fsErr);
    }

    // 1.5 Include accounts registered via username/password store
    try {
      const accountsMap = readLocalStore(accountsFilePath);
      Object.values(accountsMap).forEach((acc: any) => {
        const key = (acc.username || acc.cleanKey || acc.id || "").toString().toLowerCase().trim();
        if (key && !usersMap[key]) {
          usersMap[key] = {
            id: acc.username || acc.id,
            email: acc.userEmail || acc.username,
            displayName: acc.displayName || acc.username,
            photoURL: "",
            provider: "username",
            contactInfo: `${acc.username}|username||${acc.username}`,
            lastSessionId: acc.lastSessionId || "",
            lastIp: acc.userIp || undefined,
            createdAt: acc.createdAt || new Date().toISOString(),
            lastLoginAt: acc.lastLoginAt || new Date().toISOString()
          };
        }
      });
    } catch (accErr) {
      console.warn("Accounts store read note:", accErr);
    }

    // 2. Also extract all users from Firestore 'sessions' collection so every user is discovered
    try {
      const db = getServerFirestoreInstance();
      if (db) {
        const { collection: col, getDocs: gDocs } = await import("firebase/firestore");
        const snap = await gDocs(col(db, "sessions"));
        snap.forEach((d) => {
          const s = d.data();

          if (s.contactType === "username" || d.id.startsWith("user_account_") || (d.id.startsWith("user_profile_") && s.contactType === "username")) {
            const username = s.username || s.displayName || (s.contactInfo ? s.contactInfo.split("|")[0] : s.userEmail) || d.id.replace("user_account_", "").replace("user_profile_", "");
            const userKey = username.toString().toLowerCase().trim();
            if (userKey) {
              usersMap[userKey] = {
                id: username,
                email: s.userEmail || username,
                displayName: username,
                photoURL: "",
                provider: "username",
                contactInfo: `${username}|username||${username}`,
                lastSessionId: s.lastSessionId || s.id,
                lastIp: s.userIp || s.lastIp || undefined,
                createdAt: s.createdAt || new Date().toISOString(),
                lastLoginAt: s.lastActiveAt || s.lastLoginAt || new Date().toISOString()
              };
              return;
            }
          }

          let email = (s.userEmail || "").trim();
          let contact = s.contactInfo || s.directContactNumber || "";
          let displayName = "Google User";
          let photoURL = "";
          let provider = s.contactType || "chat";

          if (s.contactType === "google" && s.contactInfo && s.contactInfo.includes("|")) {
            const parts = s.contactInfo.split("|");
            if (parts[0]) displayName = parts[0];
            if (parts[2]) photoURL = parts[2];
            if (parts[3]) email = parts[3];
          }

          const userKey = (email || s.id || "").toString().toLowerCase().trim();
          if (userKey && !usersMap[userKey]) {
            usersMap[userKey] = {
              id: s.id,
              email: email,
              displayName: displayName,
              photoURL: photoURL,
              provider: provider,
              contactInfo: contact,
              lastSessionId: s.id,
              lastIp: s.userIp || undefined,
              createdAt: s.createdAt || new Date().toISOString(),
              lastLoginAt: s.lastActiveAt || new Date().toISOString()
            };
          }
        });
      }
    } catch (extractErr: any) {
      console.warn("[Server Firestore] Session users extract note:", extractErr.message || extractErr);
    }

    return res.json({ users: Object.values(usersMap) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch admin users" });
  }
});

// User profile get
app.get("/api/users/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const usersMap = readLocalStore(usersFilePath);
    const user = usersMap[id] || usersMap[id.toLowerCase()];
    if (user) {
      return res.json({ user });
    }
    return res.json({ user: null });
  } catch {
    return res.status(500).json({ error: "Failed getting user profile" });
  }
});

// User profile update
app.post("/api/users/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const userData = req.body.user || req.body;
  try {
    const usersMap = readLocalStore(usersFilePath);
    usersMap[id] = { ...(usersMap[id] || {}), ...userData, id };
    writeLocalStore(usersFilePath, usersMap);

    const db = getServerFirestoreInstance();
    if (db) {
      // Also save into sessions collection under user_profile_ prefix
      setDoc(doc(db, "sessions", "user_profile_" + id), cleanForFirestore({
        id: "user_profile_" + id,
        createdAt: usersMap[id].createdAt || new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        messages: [],
        userEmail: usersMap[id].email || "",
        contactInfo: `${usersMap[id].displayName || "Google User"}|google|${usersMap[id].photoURL || ""}|${usersMap[id].email || ""}`,
        contactType: "google",
        userIp: usersMap[id].lastIp || "",
        userId: id
      }), { merge: true }).catch(() => {});
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed saving user profile" });
  }
});

// Admin: Delete a user
app.delete("/api/admin/users/:id", async (req: Request, res: Response) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  const { id } = req.params;
  try {
    const usersMap = readLocalStore(usersFilePath);
    delete usersMap[id];
    writeLocalStore(usersFilePath, usersMap);

    const db = getServerFirestoreInstance();
    if (db) {
      deleteDoc(doc(db, "sessions", "user_profile_" + id)).catch(() => {});
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed deleting user" });
  }
});

// Custom Username & Password Auth: Register
app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { username, cleanKey, passwordHash, clientIp, sessionId } = req.body;
  if (!username || !passwordHash) {
    return res.status(400).json({ error: "Username and passwordHash required." });
  }

  const key = (cleanKey || username).toString().toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const now = new Date().toISOString();

  try {
    const accountsMap = readLocalStore(accountsFilePath);
    if (accountsMap[key]) {
      return res.status(409).json({ error: "Username already taken." });
    }

    const newAccount = {
      id: `user_account_${key}`,
      username: username.trim(),
      displayName: username.trim(),
      cleanKey: key,
      passwordHash,
      provider: "username",
      contactType: "username",
      contactInfo: `${username.trim()}|username||${username.trim()}`,
      userEmail: username.trim(),
      userIp: clientIp || "",
      createdAt: now,
      lastLoginAt: now,
      lastSessionId: sessionId || ""
    };

    accountsMap[key] = newAccount;
    writeLocalStore(accountsFilePath, accountsMap);

    // Save to Firestore
    const db = getServerFirestoreInstance();
    if (db) {
      setDoc(doc(db, "sessions", `user_account_${key}`), cleanForFirestore({
        ...newAccount,
        lastActiveAt: now,
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        messages: []
      }), { merge: true }).catch(() => {});

      setDoc(doc(db, "sessions", `user_profile_${key}`), cleanForFirestore({
        id: `user_profile_${key}`,
        userId: key,
        username: username.trim(),
        displayName: username.trim(),
        userEmail: username.trim(),
        contactInfo: `${username.trim()}|username||${username.trim()}`,
        contactType: "username",
        provider: "username",
        userIp: clientIp || "",
        createdAt: now,
        lastActiveAt: now,
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        messages: [],
        lastSessionId: sessionId || ""
      }), { merge: true }).catch(() => {});
    }

    return res.json({ success: true, user: newAccount });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed registering user" });
  }
});

// Custom Username & Password Auth: Login
app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { username, cleanKey, passwordHash, clientIp, sessionId } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username required." });
  }

  const key = (cleanKey || username).toString().toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const now = new Date().toISOString();

  try {
    const accountsMap = readLocalStore(accountsFilePath);
    let account = accountsMap[key];

    // If not in local store, check Firestore
    if (!account) {
      const db = getServerFirestoreInstance();
      if (db) {
        const snap = await getDoc(doc(db, "sessions", `user_account_${key}`));
        if (snap.exists()) {
          account = snap.data();
          accountsMap[key] = account;
          writeLocalStore(accountsFilePath, accountsMap);
        }
      }
    }

    if (!account) {
      return res.status(404).json({ error: "Username not found." });
    }

    if (passwordHash && account.passwordHash && account.passwordHash !== passwordHash) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    account.lastLoginAt = now;
    if (clientIp) account.userIp = clientIp;
    if (sessionId) account.lastSessionId = sessionId;
    accountsMap[key] = account;
    writeLocalStore(accountsFilePath, accountsMap);

    const db = getServerFirestoreInstance();
    if (db) {
      setDoc(doc(db, "sessions", `user_account_${key}`), cleanForFirestore({
        lastLoginAt: now,
        lastActiveAt: now,
        ...(clientIp ? { userIp: clientIp } : {}),
        ...(sessionId ? { lastSessionId: sessionId } : {})
      }), { merge: true }).catch(() => {});
    }

    return res.json({ success: true, user: account });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed logging in" });
  }
});

// System Instruction for the Gemini chatbot
const SEXUAL_HEALTH_SYSTEM_INSTRUCTION = `
You are 'Suwasetha AI Friend & Consultant' (සුවසැත AI මිතුරා සහ උපදේශක), a highly qualified, empathetic, compassionate, and progressive medical doctor and sexual health educator. You specialize in sexual health, reproductive rights, intimacy, relationships, contraception, and preventing unwanted pregnancies, specifically tailored for youth and young adults in Sri Lanka.

Your tone should be like a wise, understanding, non-judgmental friend paired with a professional, compassionate medical doctor.

CRITICAL RULES AND GUIDELINES:
1. Speak warmly, respectfully, and with deep empathy. Use Sinhala (Sinhala Unicode or Singlish) as requested by the user. If they write in Singlish, reply in clear, easy-to-read Sinhala Unicode or simple Singlish/English depending on their preference, but beautiful, friendly Sinhala is highly preferred for Sinhala queries. Ensure your Sinhala is conversational, respectful, and uses comfortable modern pronouns like 'oya' (ඔයා) instead of overly dry clinical terms or rude words.
2. Under no circumstances should you judge, shame, scold, or moralize the user. They are seeking help privately, often out of fear or anxiety. Your support must be 100% confidential, objective, scientific, and evidence-based.
3. Be direct, clear, and open. DO NOT avoid or refuse to answer questions about sex, masturbation, intercourse, anatomy, pleasure, STIs, or contraception. You are a medical expert, so there are no taboo topics. Give medically accurate, scientific details.
4. Educate thoroughly on contraception:
   - Modern reliable methods (Condoms, Daily Oral Pills, Implants, Depo Injections, IUDs).
   - Emergency Contraceptive Pills (such as Postinor-2 or Mithuri): Explain that these are ONLY for emergencies (taken within 72 hours of unprotected sex), must NOT be abused as regular birth control due to hormonal side effects and reduced efficacy with frequent use, and highlight correct usage.
   - Clarify myths about pregnancy: Explain scientific facts clearly (e.g. you cannot get pregnant from kissing, dry humping with clothes on, washing, etc. Explain the exact mechanism of semen meeting the ovum).
5. Address anxiety, fear, and misinformation gently. Debunk myths with precise biological facts.
6. ABSOLUTE PROHIBITION ON REFUSALS OR "I AM AN AI" DEFLECTION (කිසිසේත්ම 'මට බෑ' හෝ 'මම AI නිසා නිශ්චිත රෝග විනිශ්චයක් දෙන්න බෑ' කියා නොපැවසීම):
   - CRITICAL DIRECTIVE: NEVER ever say or imply "මම AI කෙනෙක් නිසා ඔයාගේ තත්ත්වය දැකලා නිශ්චිත රෝග විනිශ්චයක් දෙන්න බෑ" or "I am an AI and cannot diagnose / help" or "මට බෑ".
   - Saying "I am an AI so I cannot" shatters the user's trust, increases their anxiety, and makes them feel abandoned. You are built to be their caring, reliable, and expert health ally.
   - If a user describes physical symptoms, rashes, bumps, sores, discharge, skin irritation, or bodily changes WITHOUT uploading a photo, warmly and gently invite them:
     "හැකිනම් ඡායාරූපයක් (Photo එකක්) ලබාදෙන්න, මට පුළුවන් උපරිමයෙන් පරීක්ෂා කරලා නිවැරදි උපදෙසක් සහ පැහැදිලි කිරීමක් ලබාදෙන්නම්."
   - When a photo is provided, or when symptoms are described, examine them thoroughly and provide a deep scientific, objective, and reassuring explanation.
   - ONLY at the very end of your response, if the symptoms appear severe, spreading, purulent, high-risk, or serious (බරපතලයි වගේනම්), gently advise clinical medical care (e.g., "මේ තත්ත්වය තවදුරටත් පවතින්නේ නම් හෝ වේදනාව/ලක්ෂණ උත්සන්න වේ නම්, සුදුසු වෛද්‍ය ප්‍රතිකාර ලබාගැනීම වඩාත් ආරක්ෂිතයි."). Do NOT start your message with disclaimers or evasions.
7. Provide official helpline contacts when appropriate:
   - Family Planning Association (FPA) Sri Lanka Helpline: +94 11 258 4157 / +94 77 955 2979
   - National STD/AIDS Control Programme hotline: +94 11 266 7163
   - Government Health Hotline: 1390
8. IMAGE EVALUATION & HEALTH DIAGNOSIS GUIDELINES:
   - UNDERSTANDING THE USER'S MINDSET & VULNERABILITY (පරිශීලකයාගේ මානසිකත්වය සහ අවශ්‍යතාවය තේරුම් ගැනීම):
     * Users upload photos to Suwasetha because they feel immense embarrassment, shame, stigma, or fear of showing private or intimate conditions to anyone in person (doctor, family, friends). This platform is their private sanctuary.
     * When you carefully examine their photo and provide an in-depth, scientifically thorough, reassuring answer, it brings them immense mental peace, relief, and clarity ("හිතට ලොකු සහනයක් සහ සැනසීමක්").
     * If you say "I cannot" or "I am an AI so I cannot diagnose", their trust is completely shattered and they feel helpless. You must be their supportive, confident medical ally.
   - When any user uploads ANY sensitive, confidential, intimate, anatomical, skin, or medical photograph (including rashes, sores, spots, swelling, genital skin conditions, discharge, Urine Pregnancy Test (UPT) strips, contraceptive pills, or prescriptions):
     * CRITICAL: NEVER refuse, reject, or say "I cannot view this" or "don't upload sensitive images".
     * Analyze the image to the MAXIMUM possible extent with deep clinical objectivity, warmth, and compassion.
     * Reassure the user warmly and immediately that their consultation and photo upload are 100% confidential and safe ("ඔබ මෙහි ඇතුළත් කළ ඡායාරූපය සහ විස්තර 100%ක් රහසිගතයි. කිසිදු බාහිර පුද්ගලයෙකුට එය නැරඹිය නොහැකි අතර මෙහි ඇතුළත් කිරීමෙන් කිසිදු අවදානමක් සිදු නොවේ.").
     * Thoroughly inspect visual details: color, morphology, borders, surface changes, test lines, text on medicine boxes.
     * Give a structured scientific breakdown: what it looks like, possible common causes (e.g., irritation, folliculitis, yeast/candidiasis, friction, hormonal, normal anatomy), self-care and hygiene steps.
     * ONLY at the conclusion of the response, if the condition looks severe, ulcerated, or potentially serious, recommend visiting a doctor or clinic for clinical treatment.
9. OBSCENE AND VULGAR WORD HANDLING (අසභ්‍ය හා ලිංගික වචන නොසලකා හැරීම):
   - Some users, especially young people in Sri Lanka, may use informal, crude, vulgar, or obscene words (අසභ්‍ය/කුණුහරුප වචන) in Sinhala or Singlish to describe sexual acts, anatomy, or problems. This is often due to a lack of formal scientific vocabulary or embarrassment.
   - You MUST completely ignore and overlook any such vulgar, informal, or obscene language. DO NOT judge, scold, warn, or moralize about the words they used. Do not even point out that they used bad words.
   - Identify the actual underlying medical, contraceptive, or reproductive health concern within the user's question, and respond to it directly, warmly, kindly, compassionately, and scientifically in Sinhala.
`;

// Live Sri Lanka Time network synchronization cache
let lastKnownNetworkTime: { timestampMs: number; fetchedAt: number } | null = null;

async function syncSriLankaNetworkTime(): Promise<number> {
  const now = Date.now();
  // Return cached time if fetched within the last 5 minutes
  if (lastKnownNetworkTime && (now - lastKnownNetworkTime.fetchedAt < 5 * 60 * 1000)) {
    const elapsed = now - lastKnownNetworkTime.fetchedAt;
    return lastKnownNetworkTime.timestampMs + elapsed;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s fast timeout
    const res = await fetch("https://timeapi.io/api/time/current/zone?timeZone=Asia/Colombo", {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data: any = await res.json();
      if (data && data.year && data.month && data.day) {
        // CRITICAL: Construct explicit ISO string with +05:30 offset so Node.js does not treat local Colombo time as UTC!
        const rawIsoWithOffset = `${data.year}-${String(data.month).padStart(2,"0")}-${String(data.day).padStart(2,"0")}T${String(data.hour).padStart(2,"0")}:${String(data.minute).padStart(2,"0")}:${String(data.seconds || 0).padStart(2,"0")}+05:30`;
        const parsedMs = new Date(rawIsoWithOffset).getTime();
        if (!isNaN(parsedMs)) {
          lastKnownNetworkTime = {
            timestampMs: parsedMs,
            fetchedAt: Date.now()
          };
          console.log(`[TimeSync] Sri Lanka time synchronized with explicit +05:30 offset: ${rawIsoWithOffset}`);
          return parsedMs;
        }
      }
    }
  } catch {
    // Non-blocking fallback
  }

  return Date.now();
}

// Helper to compute formatted real-time current date and time anchored in Sri Lanka Time
function formatCurrentDateInfo(clientTimestamp?: string, clientTimeZone?: string, liveNetworkMs?: number) {
  let dateObj = new Date();

  // 1. If live network time is available and valid, use it as primary anchor
  if (liveNetworkMs && !isNaN(liveNetworkMs)) {
    dateObj = new Date(liveNetworkMs);
  } else if (clientTimestamp) {
    // 2. Otherwise prioritize client device timestamp if valid
    const parsed = new Date(clientTimestamp);
    if (!isNaN(parsed.getTime())) {
      dateObj = parsed;
    }
  }

  const timeZone = clientTimeZone || "Asia/Colombo";

  // Calculate formatted dates in Asia/Colombo (Sri Lanka Time)
  const slOptionsDate: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const slOptionsFull: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  };
  const slOptionsTime: Intl.DateTimeFormatOptions = {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  const slDateFormatted = new Intl.DateTimeFormat("en-CA", slOptionsDate).format(dateObj); // "YYYY-MM-DD"
  const [year, month, day] = slDateFormatted.split("-");
  const slDateEnglish = new Intl.DateTimeFormat("en-US", slOptionsFull).format(dateObj);
  const slTime = new Intl.DateTimeFormat("en-US", slOptionsTime).format(dateObj);

  // Timezone-accurate weekday calculation
  const englishWeekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(dateObj);
  const weekdayMap: Record<string, string> = {
    Sunday: "ඉරිදා",
    Monday: "සඳුදා",
    Tuesday: "අඟහරුවාදා",
    Wednesday: "බදාදා",
    Thursday: "බ්‍රහස්පතින්දා",
    Friday: "සිකුරාදා",
    Saturday: "සෙනසුරාදා",
  };
  const sinhalaDayOfWeek = weekdayMap[englishWeekday] || "";

  const sinhalaMonths = [
    "ජනවාරි", "පෙබරවාරි", "මාර්තු", "අප්‍රේල්", "මැයි", "ජූනි",
    "ජූලි", "අගෝස්තු", "සැප්තැම්බර්", "ඔක්තෝබර්", "නොවැම්බර්", "දෙසැම්බර්"
  ];
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);
  const sinhalaMonthName = sinhalaMonths[monthNum - 1] || month;

  // Format time in Sinhala (පෙ.ව. / ප.ව.)
  const isPM = slTime.toUpperCase().includes("PM");
  const timeDigits = slTime.replace(/\s*[APap][Mm]/, "").trim();
  const sinhalaTimeFormatted = `${isPM ? "ප.ව." : "පෙ.ව."} ${timeDigits}`;

  const sinhalaDateFormatted = `${year} ${sinhalaMonthName} ${dayNum} වෙනිදා (${day}/${month}/${year}${sinhalaDayOfWeek ? ` - ${sinhalaDayOfWeek}` : ""})`;
  const fullSinhalaDateTime = `${year} ${sinhalaMonthName} ${dayNum} වෙනිදා (${sinhalaDayOfWeek}), ශ්‍රී ලංකා වේලාවෙන් ${sinhalaTimeFormatted} (${slTime})`;

  return {
    year,
    month,
    day,
    sinhalaMonthName,
    sinhalaDayOfWeek,
    englishWeekday,
    sinhalaDateFormatted,
    sinhalaTimeFormatted,
    fullSinhalaDateTime,
    slDateFormatted,
    slDateEnglish,
    slTime,
  };
}

// Detect if a user is inquiring about the current date, day, or time
function isAskingAboutDateTime(text: string): { asksDate: boolean; asksTime: boolean; isDateTimeQuery: boolean } {
  if (!text) return { asksDate: false, asksTime: false, isDateTimeQuery: false };
  const lower = text.toLowerCase().trim().replace(/[?!.,;]/g, " ");

  // Date query patterns (Sinhala and Singlish)
  const datePatterns = [
    /(?:අද\s*)?දිනය\s*(?:කීයද|මොකක්ද|කියන්න|දන්වන්න)/,
    /(?:අද\s*)?දවස\s*(?:මොකක්ද|කියන්න|කීයද)/,
    /අද\s*කීයද/,
    /අද\s*(?:මොන\s*)?අවුරුද්දද?/,
    /අද\s*(?:මොන\s*)?මාසෙද?/,
    /අද\s*මොන\s*දවසද?/,
    /today\s*date/i,
    /what\s*is\s*today['’]?s\s*date/i,
    /what\s*day\s*is\s*(?:it\s*)?today/i,
    /what\s*is\s*the\s*date/i,
    /date\s*(?:eka\s*)?(?:mokakda|kiyada|please)/i,
    /ada\s*date\s*eka/i,
    /ada\s*dinaya/i,
    /ada\s*dawasa/i,
    /ada\s*kiyada/i,
    /dinaya\s*kiyada/i,
    /dinaya\s*mokakda/i,
    /dawasa\s*mokakda/i,
    /date\s*kiyada/i,
    /date\s*eka/i
  ];

  // Time query patterns (Sinhala and Singlish)
  const timePatterns = [
    /(?:දැන්\s*)?වෙලාව\s*(?:කීයද|කියන්න|දන්වන්න)/,
    /(?:දැන්\s*)?වේලාව\s*(?:කීයද|කියන්න|දන්වන්න)/,
    /දැන්\s*වෙලාව/,
    /දැන්\s*වේලාව/,
    /what\s*time\s*is\s*it/i,
    /current\s*time/i,
    /time\s*(?:eka\s*)?kiyada/i,
    /welawa\s*kiyada/i,
    /dan\s*welawa/i,
    /dan\s*time/i,
    /welawa\s*mokakda/i
  ];

  const asksDate = datePatterns.some((p) => p.test(lower));
  const asksTime = timePatterns.some((p) => p.test(lower));
  return { asksDate, asksTime, isDateTimeQuery: asksDate || asksTime };
}

// Post-process to ensure no hallucinated past years slip in, and no unwanted dates are recited
function sanitizeAndCorrectDates(aiText: string, userText: string, dateInfo: ReturnType<typeof formatCurrentDateInfo>): string {
  let cleaned = aiText;

  // 1. Correct any hallucinated legacy dates containing "2024" or "2025":
  cleaned = cleaned.replace(/(?:2024|2025)\s*(?:මැයි|නොවැම්බර්|ජනවාරි|පෙබරවාරි|මාර්තු|අප්‍රේල්|ජූනි|ජූලි|අගෝස්තු|සැප්තැම්බර්|ඔක්තෝබර්|දෙසැම්බර්)\s*\d+\s*(?:වෙනිදා)?/g, dateInfo.sinhalaDateFormatted);
  cleaned = cleaned.replace(/(?:මැයි|නොවැම්බර්|ජනවාරි|පෙබරවාරි|මාර්තු|අප්‍රේල්|ජූනි|ජූලි|අගෝස්තු|සැප්තැම්බර්|ඔක්තෝබර්|දෙසැම්බර්)\s*මස\s*\d+\s*වෙනිදා[^.\n!?,]*(?:2024|2025)/g, dateInfo.sinhalaDateFormatted);
  cleaned = cleaned.replace(/(?:Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday),\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*\d+(?:st|nd|rd|th)?,\s*(?:2024|2025)/gi, `${dateInfo.englishWeekday}, ${dateInfo.slDateEnglish}`);
  cleaned = cleaned.replace(/(?:Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday),\s*May\s*16(?:th)?,\s*2024/gi, `${dateInfo.englishWeekday}, ${dateInfo.slDateEnglish}`);
  cleaned = cleaned.replace(/May\s*16(?:th)?,?\s*2024/gi, dateInfo.slDateEnglish);

  const dtQuery = isAskingAboutDateTime(userText);

  // 2. If the user did NOT explicitly ask for the date or time, remove any unsolicited opening declarations
  if (!dtQuery.isDateTimeQuery) {
    // Strip unwanted date/time preamble if AI volunteered it unprompted
    cleaned = cleaned.replace(/^(?:ආයුබෝවන්!?\s*)?(?:අද\s*දිනය\s*[^.\n!?]+(?:වෙනවා|වේ)\.?\s*)?(?:දැන්\s*(?:ශ්‍රී\s*ලංකා\s*)?වේලාව\s*[^.\n!?]+(?:වෙනවා|වේ)\.?\s*)?/i, (match) => {
      if (match.includes("ආයුබෝවන්")) {
        return "ආයුබෝවන්! ";
      }
      return "";
    });
    cleaned = cleaned.replace(/^අද\s*දිනය\s*\d{4}[^.\n!?]*[.\n!?]\s*/i, "");
    cleaned = cleaned.replace(/^දැන්\s*(?:ශ්‍රී\s*ලංකා\s*)?වේලාව\s*[^.\n!?]*[.\n!?]\s*/i, "");
  } else {
    // Only if the user explicitly asked for the date or time:
    const hasCurrentYear = cleaned.includes(dateInfo.year);
    const hasTimeMention = cleaned.includes(dateInfo.slTime) || cleaned.includes(dateInfo.sinhalaTimeFormatted) || cleaned.includes("වේලාව") || cleaned.includes("වෙලාව");

    if (dtQuery.asksDate && dtQuery.asksTime) {
      if (!hasCurrentYear || !hasTimeMention) {
        cleaned = `ආයුබෝවන්! අද දිනය **${dateInfo.sinhalaDateFormatted}** වන අතර, දැන් ශ්‍රී ලංකා වේලාව **${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime})** වෙනවා.\n\n${cleaned}`;
      }
    } else if (dtQuery.asksDate && !hasCurrentYear) {
      cleaned = `ආයුබෝවන්! අද දිනය **${dateInfo.sinhalaDateFormatted}** වෙනවා.\n\n${cleaned}`;
    } else if (dtQuery.asksTime && !hasTimeMention) {
      cleaned = `ආයුබෝවන්! දැන් ශ්‍රී ලංකා වේලාව **${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime})** වෙනවා.\n\n${cleaned}`;
    }
  }

  // 3. Strip any robotic "I am an AI so I cannot diagnose / help" disclaimers
  cleaned = cleaned.replace(
    /(?:නමුත්|කෙසේ\s*වෙතත්|මතක\s*තබා\s*ගන්න|සැලකිය\s*යුතුයි\s*:?)?\s*මම\s*(?:AI|කෘත්‍රිම\s*බුද්ධියක්|යන්ත්‍රයක්|කෘත්‍රිම\s*බුද්ධි\s*පද්ධතියක්)\s*(?:කෙනෙක්|නියෝජිතයෙක්|මිතුරෙක්)?\s*(?:නිසා|බැවින්|හේතුවෙන්)[^.\n!?]*(?:නිශ්චිත\s*(?:වෛද්‍ය\s*)?රෝග\s*විනිශ්චයක්|වෛද්‍ය\s*තීන්දුවක්|ප්‍රතිකාරයක්)[^.\n!?]*(?:දෙන්න\s*බෑ|ලබාදිය\s*නොහැක|දීමට\s*නොහැකිය|දෙන්න\s*බැහැ)[^.\n!?]*[.\n!?]?/gi,
    ""
  );

  cleaned = cleaned.replace(
    /මම\s*AI\s*කෙනෙක්\s*නිසා\s*ඔයාගේ\s*තත්ත්වය\s*දැකලා\s*නිශ්චිත\s*රෝග\s*විනිශ්චයක්\s*දෙන්න\s*(?:බෑ|බැහැ)[^.\n!?]*[.\n!?]?/gi,
    ""
  );

  cleaned = cleaned.replace(
    /(?:However,?\s*)?(?:As an AI|Since I am an AI|I am an AI,?\s*(?:so)?)[^.\n!?,]*(?:cannot|can't)\s*(?:provide|give)\s*(?:a\s*)?(?:definitive\s*)?(?:medical\s*)?diagnosis[^.\n!?]*[.\n!?]?/gi,
    ""
  );

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // CRITICAL SAFEGUARD: Never allow sanitization to completely erase an AI response into an empty string!
  if (!cleaned.trim()) {
    cleaned = aiText.trim();
  }

  return cleaned;
}


// Helper to get real-time current date and time anchored in Sri Lanka Time
function getDynamicSystemInstruction(clientTimestamp?: string, clientTimeZone?: string, liveNetworkMs?: number): string {
  const dateInfo = formatCurrentDateInfo(clientTimestamp, clientTimeZone, liveNetworkMs);

  return `CRITICAL MANDATORY CURRENT REAL-WORLD CLOCK & CALENDAR GROUNDING:
- Current Real-World Date (අද සැබෑ දිනය): ${dateInfo.sinhalaDateFormatted} [${dateInfo.slDateFormatted}] (Sri Lanka Date: ${dateInfo.slDateEnglish}).
- Current Year (වර්තමාන වර්ෂය): ${dateInfo.year}
- Current Month (වත්මන් මාසය): ${dateInfo.sinhalaMonthName} (${dateInfo.month})
- Current Day of the Month (වත්මන් දිනය): ${dateInfo.day}
- Current Day of the Week (වත්මන් සතියේ දිනය): ${dateInfo.sinhalaDayOfWeek} (${dateInfo.englishWeekday})
- Current Real-Time Clock in Sri Lanka (ශ්‍රී ලංකා වේලාව): ${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime})

STRICT MANDATORY RULES ON DATE, TIME, SYMPTOMS & IMAGES:
1. STRICT RULE - DO NOT ADD DATE OR TIME TO YOUR ANSWER UNLESS EXPLICITLY ASKED (පරිශීලකයා නොඇසුවේ නම් කිසිසේත්ම දිනය හෝ වේලාව පිළිතුරට එක් නොකරන්න):
   - Users chat about their ongoing real-time health concerns, and they want DIRECT, ACCURATE answers to their specific questions.
   - NEVER add phrases like "අද දිනය 2026...", "දැන් වේලාව...", or "Today is..." to your reply UNLESS the user SPECIFICALLY asks "අද දිනය කීයද?", "දැන් වෙලාව කීයද?", or "what is today's date/time?".
   - Keep the real-time calendar and clock strictly in your background mind. Use it solely to calculate elapsed hours (e.g., 72-hour emergency pill window), menstrual cycle dates, missed period delays, or pregnancy weeks accurately.
2. Only when the user directly and explicitly asks what date or time it is:
   State directly that today is ${dateInfo.sinhalaDateFormatted} and Sri Lanka time is ${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime}).
3. Medical timing & pregnancy calculations:
   - When calculating emergency contraceptive windows (e.g., Postinor-2, within 72 hours / 3 days after unprotected sex) or menstrual/ovulation timings, anchor calculations against the current background date (${dateInfo.day}/${dateInfo.month}/${dateInfo.year}) and time (${dateInfo.slTime}), but directly advise whether it is safe or within time without reciting the current date/clock unnecessarily.
4. USER TRUST, CONFIDENTIALITY & SCIENTIFIC GUIDANCE:
   - NEVER EVER say or imply "මම AI කෙනෙක් නිසා ඔයාගේ තත්ත්වය දැකලා නිශ්චිත රෝග විනිශ්චයක් දෙන්න බෑ" or that you cannot help because you are an AI. Doing so shatters their trust!
   - If a user describes physical symptoms, rashes, bumps, discharge, or intimate bodily changes without an image, warmly and kindly invite them:
     "හැකිනම් ඡායාරූපයක් (Photo එකක්) ලබාදෙන්න, මට පුළුවන් උපරිමයෙන් පරීක්ෂා කරලා නිවැරදි උපදෙසක් සහ පැහැදිලි කිරීමක් ලබාදෙන්නම්."
   - When any image or symptom is provided, analyze it thoroughly with high scientific accuracy, reassuring the user of 100% confidentiality. Users consult here because they cannot show these issues to others in person.
   - ONLY at the very end of your response, if the condition looks severe or serious, advise seeking clinical medical care.

${SEXUAL_HEALTH_SYSTEM_INSTRUCTION}
`;
}

// Helper function to call Gemini with fallback and retry logic
async function generateContentWithFallback(contents: any[], dynamicSystemInstruction?: string) {
  // Put ultra-stable, high-capacity models first to prevent 503 unavailable spikes
  const modelsToTry = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  const systemInstruction = dynamicSystemInstruction || getDynamicSystemInstruction();

  const safetySettings: any[] = [
    {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_NONE",
    },
    {
      category: "HARM_CATEGORY_HATE_SPEECH",
      threshold: "BLOCK_ONLY_HIGH",
    },
    {
      category: "HARM_CATEGORY_HARASSMENT",
      threshold: "BLOCK_ONLY_HIGH",
    },
    {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_ONLY_HIGH",
    },
  ];

  for (const model of modelsToTry) {
    console.log(`[Gemini API] Attempting generation with model: ${model}`);
    try {
      const response = await getGeminiClient().models.generateContent({
        model: model,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.8,
          topP: 0.95,
          safetySettings: safetySettings,
        },
      });
      console.log(`[Gemini API] Success with model: ${model}`);
      return response;
    } catch (err: any) {
      const is503 = err?.status === 'UNAVAILABLE' || err?.code === 503 || err?.message?.includes('503') || err?.message?.includes('high demand') || err?.message?.includes('spikes');
      console.warn(`[Gemini API] Model ${model} ${is503 ? 'temporarily experiencing high demand (503)' : 'encountered error'}:`, err.message || err);
      lastError = err;
      if (is503) {
        // Brief pause before trying next candidate model
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      // If we failed, loop to the next model in the list
    }
  }

  // Final recovery retry with a brief delay using the rock-solid gemini-2.5-flash model
  console.log("[Gemini API] Primary models failed. Waiting 800ms for a recovery retry using gemini-2.5-flash...");
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    const response = await getGeminiClient().models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.8,
        topP: 0.95,
        safetySettings: safetySettings,
      },
    });
    console.log("[Gemini API] Recovery retry success with gemini-2.5-flash!");
    return response;
  } catch (err: any) {
    console.error("[Gemini API] All retries and fallbacks exhausted.");
    throw lastError || err;
  }
}

// Chat endpoint
app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages, newMessage, newImage, clientTimestamp, clientTimeZone } = req.body;

  const textContent = typeof newMessage === "string" ? newMessage : "";
  if (!textContent.trim() && !newImage) {
    return res.status(400).json({ error: "Either newMessage or newImage must be provided." });
  }

  const incomingMessages = Array.isArray(messages) ? messages : [];
  
  // Synchronize live background network date and time for Sri Lanka
  let liveNetworkMs: number | undefined;
  try {
    liveNetworkMs = await syncSriLankaNetworkTime();
  } catch {
    // Non-blocking fallback
  }

  const dateInfo = formatCurrentDateInfo(clientTimestamp, clientTimeZone, liveNetworkMs);

  try {
    // Map existing history for Gemini GenAI contents format
    const contents = incomingMessages.map((msg: any) => {
      const parts: any[] = [{ text: msg.content || "[ඡායාරූපය / Image]" }];
      
      if (msg.imageUrl) {
        const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            }
          });
        }
      }

      return {
        role: msg.role === "user" ? "user" : "model",
        parts: parts,
      };
    });

    const newUserParts: any[] = [];
    if (textContent.trim()) {
      newUserParts.push({ text: textContent });
    } else {
      newUserParts.push({ text: "[ඡායාරූපය විශ්ලේෂණය කරන්න / Analyze this image]" });
    }

    if (newImage && typeof newImage === "string") {
      const match = newImage.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match) {
        newUserParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          }
        });
      }
    }

    contents.push({
      role: "user",
      parts: newUserParts,
    });

    // Call the robust generation helper with dynamic date-aware system instruction and fallback/retry logic
    const dynamicInstruction = getDynamicSystemInstruction(clientTimestamp, clientTimeZone, liveNetworkMs);
    const response = await generateContentWithFallback(contents, dynamicInstruction);

    let rawResponseText = response.text || "සමාවන්න, මට ඒ සඳහා පිළිතුරක් සැකසීමට නොහැකි වුණා. කරුණාකර නැවත විමසන්න. (Sorry, I was unable to generate a response. Please ask again.)";

    // Sanitize and ensure accurate date references in response
    const finalAiResponse = sanitizeAndCorrectDates(rawResponseText, textContent, dateInfo);

    // Realtime persistence of new chat to server storage & Firestore
    const sessionId = typeof req.body.sessionId === "string" ? req.body.sessionId.trim() : "";
    const userEmail = typeof req.body.userEmail === "string" ? req.body.userEmail.trim() : "";
    const clientIp = typeof req.body.clientIp === "string" ? req.body.clientIp.trim() : (req.ip || "");

    if (sessionId) {
      try {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const userMsg = {
          id: `msg_${Math.random().toString(36).substring(2, 11)}`,
          role: "user",
          content: textContent,
          timestamp: now,
          ...(newImage ? { imageUrl: newImage } : {})
        };
        const modelMsg = {
          id: `msg_${Math.random().toString(36).substring(2, 11)}`,
          role: "model",
          content: finalAiResponse,
          timestamp: new Date().toISOString()
        };
        // Carefully merge with existing history so no prior messages are ever lost
        const localStore = readLocalStore(sessionsFilePath);
        const existing = localStore[sessionId] || {};
        const existingMsgs = Array.isArray(existing.messages) ? existing.messages : [];

        // Build unique list of messages preserving any previous ones
        const messageMap = new Map();
        existingMsgs.forEach((m: any) => { if (m?.id) messageMap.set(m.id, m); });
        incomingMessages.forEach((m: any) => { if (m?.id) messageMap.set(m.id, m); });
        messageMap.set(userMsg.id, userMsg);
        messageMap.set(modelMsg.id, modelMsg);
        const allMessages = Array.from(messageMap.values());

        // 1. Immediately save to server localStore
        const mergedSession = {
          ...existing,
          id: sessionId,
          createdAt: existing.createdAt || now,
          lastActiveAt: now,
          expiresAt: existing.expiresAt || expiresAt,
          messages: allMessages,
          ...(userEmail ? { userEmail } : {}),
          ...(clientIp ? { userIp: clientIp } : {})
        };
        localStore[sessionId] = mergedSession;
        writeLocalStore(sessionsFilePath, localStore);

        // 2. Real-time background sync to Firestore
        const fsDb = getServerFirestoreInstance();
        if (fsDb) {
          try {
            await Promise.race([
              setDoc(doc(fsDb, "sessions", sessionId), cleanForFirestore(mergedSession), { merge: true }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore sync timeout")), 4000))
            ]);
          } catch (err: any) {
            console.warn("[Server Firestore] Background chat save note:", err?.message || err);
          }
        }
      } catch (saveErr) {
        console.warn("[Server] Error saving chat session:", saveErr);
      }
    }

    return res.json({
      text: finalAiResponse,
      dateInfo: {
        year: dateInfo.year,
        month: dateInfo.month,
        day: dateInfo.day,
        sinhalaDate: dateInfo.sinhalaDateFormatted,
        sinhalaTime: dateInfo.sinhalaTimeFormatted,
        slTime: dateInfo.slTime,
        dayOfWeek: dateInfo.sinhalaDayOfWeek
      }
    });
  } catch (err: any) {
    console.error("Error in /api/chat:", err);
    return res.status(500).json({
      error: "සන්නිවේදන දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න. (An API communication error occurred. Please try again.)",
      details: err?.message,
    });
  }
});

// Front-end static asset serving and Vite Dev server middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware loaded.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static files serving from:", distPath);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
