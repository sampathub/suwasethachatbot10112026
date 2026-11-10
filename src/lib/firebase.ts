import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, setLogLevel } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth";
import firebaseAppletConfig from "@/firebase-applet-config.json";

// Silence verbose internal Firestore WebChannel retry logs in the browser console
try {
  setLogLevel("silent");
} catch {
  // Ignore if not supported
}

const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey || "AIzaSyDsFAT8qQH4H9Ah9M7t5X38OTus7NMMGac",
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain || "aichatbot-4cf01.firebaseapp.com",
  databaseURL: (import.meta as any).env?.VITE_FIREBASE_DATABASE_URL || (firebaseAppletConfig as any).databaseURL || "https://aichatbot-4cf01-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId || "aichatbot-4cf01",
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || firebaseAppletConfig.storageBucket || "aichatbot-4cf01.firebasestorage.app",
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseAppletConfig.messagingSenderId || "828801121189",
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId || "1:828801121189:web:b68ef64245d5217b4c064c",
  measurementId: (import.meta as any).env?.VITE_FIREBASE_MEASUREMENT_ID || firebaseAppletConfig.measurementId || "G-F2024EF3LF"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore using the configured database ID
const activeDbId = (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID || firebaseAppletConfig.firestoreDatabaseId;

let firestoreInstance: any = null;
try {
  firestoreInstance = (activeDbId && activeDbId !== "(default)") ? getFirestore(app, activeDbId) : getFirestore(app);
} catch (err) {
  console.warn("Client-side Firestore initialization note:", err);
  try {
    firestoreInstance = getFirestore(app);
  } catch (err2) {
    console.error("Client-side fallback Firestore initialization note:", err2);
    firestoreInstance = null;
  }
}

export const db = firestoreInstance;

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const facebookProvider = new FacebookAuthProvider();

/**
 * Recursively cleans any object or array to ensure NO `undefined` values exist,
 * preventing Firestore "Function setDoc() called with invalid data. Unsupported field value: undefined".
 */
export function sanitizeForFirestore<T>(input: T): T {
  if (input === undefined) return null as any;
  if (input === null || typeof input !== "object") return input;

  try {
    const jsonStr = JSON.stringify(input, (_, val) => (val === undefined ? undefined : val));
    if (!jsonStr) return null as any;
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
    return sanitizeDeep(parsed) as any;
  } catch {
    return input;
  }
}


