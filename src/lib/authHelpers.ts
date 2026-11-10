import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, sanitizeForFirestore } from "./firebase";

/**
 * Standard SHA-256 password hashing using Web Crypto API
 * Safe, fast, and does not store plain text passwords in the database.
 */
export async function hashPassword(username: string, password: string): Promise<string> {
  const normalizedUser = username.trim().toLowerCase();
  const saltString = `suwasetha_salt_v1_${normalizedUser}_${password}`;
  
  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
    const enc = new TextEncoder();
    const data = enc.encode(saltString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }
  
  // Deterministic fallback if Web Crypto is unavailable in mock/testing environments
  let hash = 0;
  for (let i = 0; i < saltString.length; i++) {
    const chr = saltString.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return "hash_" + Math.abs(hash).toString(16) + "_" + normalizedUser;
}

export function cleanUsernameKey(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_");
}

export interface CustomAuthResult {
  success: boolean;
  error?: string;
  username?: string;
  displayName?: string;
  lastSessionId?: string;
}

/**
 * Register a new user account with a custom Username & Password
 * Stores credentials safely in Firestore & syncs with backend server.
 */
export async function registerCustomUser(
  username: string,
  password: string,
  clientIp?: string,
  currentSessionId?: string
): Promise<CustomAuthResult> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { success: false, error: "කරුණාකර කැමති Nick Name එකක් ඇතුළත් කරන්න." };
  }
  if (trimmed.length < 3) {
    return { success: false, error: "Nick Name එකට අවම වශයෙන් අකුරු 3ක් තිබිය යුතුය. (At least 3 characters)" };
  }
  if (trimmed.length > 30) {
    return { success: false, error: "Nick Name එක අකුරු 30කට වඩා කෙටි විය යුතුය. (Maximum 30 characters)" };
  }
  if (!password || password.length < 4) {
    return { success: false, error: "රහස් අංකයට / මුරපදයට අවම වශයෙන් අකුරු හෝ ඉලක්කම් 4ක් තිබිය යුතුය. (PIN/Password at least 4 characters)" };
  }

  const cleanKey = cleanUsernameKey(trimmed);
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(trimmed, password);

  // 1. Check if user already exists in Firestore 'sessions' under 'user_account_' prefix
  if (db) {
    try {
      const accountRef = doc(db, "sessions", `user_account_${cleanKey}`);
      const snap = await getDoc(accountRef);
      if (snap.exists()) {
        return {
          success: false,
          error: `"${trimmed}" යන Nick Name එක දැනටමත් භාවිතයේ ඇත. කරුණාකර වෙනත් නමක් ලබා දෙන්න.`
        };
      }
    } catch (e: any) {
      console.warn("Firestore user existence check note:", e);
    }
  }

  // 2. Also check if server is available and has an account endpoint
  const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname.includes("run.app"));
  if (isLocalOrDev) {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: trimmed,
          cleanKey,
          passwordHash,
          clientIp,
          sessionId: currentSessionId
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.error && data.error.includes("already")) {
          return {
            success: false,
            error: `"${trimmed}" යන Nick Name එක දැනටමත් භාවිතයේ ඇත. කරුණාකර වෙනත් නමක් ලබා දෙන්න.`
          };
        }
      }
    } catch {
      // Continue with Firestore direct write
    }
  }

  // 3. Write user account record to Firestore 'sessions' collection
  // (ID: user_account_${cleanKey}) - has full write permissions and does not corrupt chat sessions
  if (db) {
    try {
      const accountRef = doc(db, "sessions", `user_account_${cleanKey}`);
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      await setDoc(accountRef, sanitizeForFirestore({
        id: `user_account_${cleanKey}`,
        username: trimmed,
        displayName: trimmed,
        cleanKey,
        passwordHash,
        provider: "username",
        contactType: "username",
        contactInfo: `${trimmed}|username||${trimmed}`,
        userEmail: trimmed,
        userIp: clientIp || "",
        createdAt: now,
        lastLoginAt: now,
        lastActiveAt: now,
        expiresAt,
        messages: [],
        lastSessionId: currentSessionId || ""
      }), { merge: true });

      // Also create corresponding user_profile_ doc for user directory
      const profileRef = doc(db, "sessions", `user_profile_${cleanKey}`);
      await setDoc(profileRef, sanitizeForFirestore({
        id: `user_profile_${cleanKey}`,
        userId: cleanKey,
        username: trimmed,
        displayName: trimmed,
        userEmail: trimmed,
        contactInfo: `${trimmed}|username||${trimmed}`,
        contactType: "username",
        provider: "username",
        userIp: clientIp || "",
        createdAt: now,
        lastActiveAt: now,
        expiresAt,
        messages: [],
        lastSessionId: currentSessionId || ""
      }), { merge: true });
    } catch (fsErr: any) {
      console.warn("Firestore custom user write error:", fsErr);
    }
  }

  // 4. Update localStorage
  try {
    localStorage.setItem("suwasetha_custom_username", trimmed);
    localStorage.setItem("suwasetha_user_display_name", trimmed);
    localStorage.setItem("suwasetha_user_email", trimmed);
    localStorage.setItem("suwasetha_age_verified", "true");
    localStorage.setItem("suwasetha_contact_saved", "true");
  } catch {}

  return {
    success: true,
    username: trimmed,
    displayName: trimmed,
    lastSessionId: currentSessionId
  };
}

/**
 * Log in an existing user with their Username & Password
 * Validates against Firestore and/or backend server.
 */
export async function loginCustomUser(
  username: string,
  password: string,
  clientIp?: string,
  currentSessionId?: string
): Promise<CustomAuthResult> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { success: false, error: "කරුණාකර ඔබගේ Nick Name එක ඇතුළත් කරන්න." };
  }
  if (!password) {
    return { success: false, error: "කරුණාකර රහස් අංකය / මුරපදය ඇතුළත් කරන්න." };
  }

  const cleanKey = cleanUsernameKey(trimmed);
  const passwordHash = await hashPassword(trimmed, password);
  let foundAccount: any = null;

  // 1. Check direct Firestore 'sessions' collection for 'user_account_' doc
  if (db) {
    try {
      const accountRef = doc(db, "sessions", `user_account_${cleanKey}`);
      const snap = await getDoc(accountRef);
      if (snap.exists()) {
        foundAccount = snap.data();
      }
    } catch (e: any) {
      console.warn("Firestore custom login check note:", e);
    }
  }

  // 2. If not found in Firestore or if running locally, try server endpoint
  if (!foundAccount) {
    const isLocalOrDev = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname.includes("run.app"));
    if (isLocalOrDev) {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: trimmed,
            cleanKey,
            passwordHash,
            clientIp,
            sessionId: currentSessionId
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.user) {
            foundAccount = data.user;
          }
        }
      } catch {
        // Ignore network errors
      }
    }
  }

  if (!foundAccount) {
    return {
      success: false,
      error: `"${trimmed}" යන Nick Name එක සොයාගත නොහැකි විය. කරුණාකර අලුතින් Nick Name එකක් ලබා දී අරඹන්න.`
    };
  }

  // 3. Verify password hash
  if (foundAccount.passwordHash && foundAccount.passwordHash !== passwordHash) {
    return {
      success: false,
      error: "ඇතුළත් කළ රහස් අංකය / මුරපදය වැරදියි. කරුණාකර නැවත උත්සාහ කරන්න."
    };
  }

  // 4. Update last login metadata in Firestore
  const now = new Date().toISOString();
  if (db) {
    try {
      const accountRef = doc(db, "sessions", `user_account_${cleanKey}`);
      await setDoc(accountRef, sanitizeForFirestore({
        lastLoginAt: now,
        lastActiveAt: now,
        ...(clientIp ? { userIp: clientIp } : {}),
        ...(currentSessionId ? { lastSessionId: currentSessionId } : {})
      }), { merge: true });

      const profileRef = doc(db, "sessions", `user_profile_${cleanKey}`);
      await setDoc(profileRef, sanitizeForFirestore({
        lastActiveAt: now,
        ...(clientIp ? { userIp: clientIp } : {}),
        ...(currentSessionId ? { lastSessionId: currentSessionId } : {})
      }), { merge: true });
    } catch (fsErr) {
      console.warn("Could not update custom user lastLoginAt in Firestore:", fsErr);
    }
  }

  // 5. Update localStorage
  try {
    localStorage.setItem("suwasetha_custom_username", foundAccount.username || trimmed);
    localStorage.setItem("suwasetha_user_display_name", foundAccount.displayName || trimmed);
    localStorage.setItem("suwasetha_user_email", foundAccount.username || trimmed);
    localStorage.setItem("suwasetha_age_verified", "true");
    localStorage.setItem("suwasetha_contact_saved", "true");
  } catch {}

  return {
    success: true,
    username: foundAccount.username || trimmed,
    displayName: foundAccount.displayName || trimmed,
    lastSessionId: foundAccount.lastSessionId || undefined
  };
}

/**
 * Log out a custom username user
 */
export function logoutCustomUser() {
  try {
    localStorage.removeItem("suwasetha_custom_username");
    localStorage.removeItem("suwasetha_user_display_name");
    localStorage.removeItem("suwasetha_user_email");
  } catch {}
}

/**
 * Retrieve current active custom username from localStorage
 */
export function getCurrentCustomUser(): { username: string; displayName: string } | null {
  try {
    const username = localStorage.getItem("suwasetha_custom_username");
    if (!username) return null;
    const displayName = localStorage.getItem("suwasetha_user_display_name") || username;
    return { username, displayName };
  } catch {
    return null;
  }
}
