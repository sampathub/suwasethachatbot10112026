import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, 
  X, 
  Mail, 
  Globe, 
  Phone, 
  ShieldCheck, 
  Info, 
  MessageSquarePlus, 
  FileText, 
  Trash2, 
  Check, 
  Copy, 
  ExternalLink, 
  AlertCircle, 
  ChevronDown, 
  Send,
  User
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion } from "motion/react";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";
import { ChatSession, Message } from "../types";
import { mergeMessages } from "../App";

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

interface AdminFullScreenChatProps {
  selectedSession: ChatSession;
  onClose: () => void;
  adminReplyText: string;
  setAdminReplyText: (text: string) => void;
  adminReplySending: boolean;
  adminReplySuccess: string | null;
  handleSendAdminMessage: () => void;
  handleDeleteSession: (sessionId: string) => void;
  fetchAdminSessions: () => void;
  getSessionEmail: (session: ChatSession) => string;
  parseDateSafely: (d: any) => Date;
  db: any;
}

export const AdminFullScreenChat: React.FC<AdminFullScreenChatProps> = ({
  selectedSession,
  onClose,
  adminReplyText,
  setAdminReplyText,
  adminReplySending,
  adminReplySuccess,
  handleSendAdminMessage,
  handleDeleteSession,
  fetchAdminSessions,
  getSessionEmail,
  parseDateSafely,
  db
}) => {
  const [session, setSession] = useState<ChatSession>(selectedSession);

  useEffect(() => {
    setSession(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    if (!db || !selectedSession?.id) return;
    try {
      const unsub = onSnapshot(doc(db, "sessions", selectedSession.id), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const remoteMsgs: Message[] = Array.isArray(data.messages) ? data.messages : [];
          setSession(prev => {
            const currentMsgs = prev?.messages || [];
            const resolvedMsgs = mergeMessages(currentMsgs, remoteMsgs);
            return {
              ...prev,
              ...data,
              id: snap.id,
              messages: resolvedMsgs
            };
          });
        }
      }, (err) => {
        console.warn("Real-time session snapshot note:", err);
      });
      return () => unsub();
    } catch {
      // ignore
    }
  }, [db, selectedSession?.id]);

  const [showAdminComposer, setShowAdminComposer] = useState<boolean>(true);
  const [adminShowUserDetails, setAdminShowUserDetails] = useState<boolean>(!!session.needsAdminAttention);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  const resolvedEmail = getSessionEmail(session);
  const isDirectPhone = session.directContactNumber || 
    (session.contactInfo && session.contactType !== "google" && session.contactType !== "facebook");

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 bg-[#080c16] flex flex-col overflow-hidden text-slate-100" 
      id="admin_full_screen_chat"
    >
      {/* Top Workspace Header */}
      <div className="p-3 sm:p-4 bg-[#0d1322] border-b border-slate-800 flex justify-between items-center shrink-0 gap-2 shadow-xl z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold shrink-0 cursor-pointer flex items-center gap-2 border border-slate-700 transition-all shadow-md active:scale-95"
            title="සැසි ලැයිස්තුවට ආපසු යන්න (Esc)"
          >
            <ArrowLeft className="w-4 h-4 text-rose-400" />
            <span>ආපසු (Close)</span>
            <span className="text-[10px] text-slate-400 font-mono bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-700/60 hidden sm:inline">Esc</span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs sm:text-sm font-mono font-bold text-slate-100 truncate">
                සැසිය: {session.id}
              </h4>
              {resolvedEmail && (
                <span className="bg-pink-950/60 border border-pink-700/60 text-pink-300 text-[11px] px-2.5 py-0.5 rounded-lg font-mono font-bold flex items-center gap-1">
                  <Mail className="w-3 h-3 text-pink-400" />
                  <span className="select-all">{resolvedEmail}</span>
                </span>
              )}
              {session.userIp && (
                <span className="bg-cyan-950/60 border border-cyan-800/50 text-cyan-300 text-[10px] px-2 py-0.5 rounded-lg font-mono hidden md:inline-flex items-center gap-1">
                  <Globe className="w-3 h-3 text-cyan-400" />
                  <span>{session.userIp}</span>
                </span>
              )}
              {isDirectPhone && (
                <span className="bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 text-[10px] px-2 py-0.5 rounded-lg font-mono flex items-center gap-1">
                  <Phone className="w-3 h-3 text-emerald-400" />
                  <span>{session.directContactNumber || session.contactInfo}</span>
                </span>
              )}
              {session.contactType === "google" && (
                <span className="bg-blue-950/60 border border-blue-800/50 text-blue-300 text-[10px] px-2 py-0.5 rounded-lg font-mono flex items-center gap-1">
                  <User className="w-3 h-3 text-blue-400" />
                  <span>Google Auth</span>
                </span>
              )}
              {session.contactType === "username" && (
                <span className="bg-purple-950/60 border border-purple-800/50 text-purple-300 text-[10px] px-2 py-0.5 rounded-lg font-mono flex items-center gap-1">
                  <User className="w-3 h-3 text-purple-400" />
                  <span>Username: {session.userEmail || session.contactInfo?.split("|")[0] || "User"}</span>
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5 truncate font-sans">
              ආරම්භය: {parseDateSafely(session.createdAt).toLocaleString()} • පණිවිඩ: {session.messages?.length || 0}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAdminShowUserDetails(!adminShowUserDetails)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
              adminShowUserDetails 
                ? "bg-indigo-950 text-indigo-300 border-indigo-700 shadow-sm" 
                : "bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700"
            }`}
            title="පරිශීලක විස්තර පෙන්වන්න/සඟවන්න"
          >
            <Info className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{adminShowUserDetails ? "විස්තර සඟවන්න" : "පරිශීලක විස්තර"}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${adminShowUserDetails ? "rotate-180" : ""}`} />
          </button>

          <button
            type="button"
            onClick={() => setShowAdminComposer(!showAdminComposer)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
              showAdminComposer 
                ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-600/30" 
                : "bg-emerald-950/70 hover:bg-emerald-900 border-emerald-700/80 text-emerald-300 hover:text-white"
            }`}
            title={showAdminComposer ? "පණිවිඩය ටයිප් කිරීම සඟවන්න" : "පරිපාලක පණිවිඩයක් ටයිප් කරන්න"}
          >
            <MessageSquarePlus className="w-4 h-4 text-emerald-300" />
            <span className="hidden sm:inline">{showAdminComposer ? "ටයිප් කිරීම සඟවන්න" : "✍️ පණිවිඩයක් ලියන්න"}</span>
            <span className="sm:hidden">{showAdminComposer ? "සඟවන්න" : "ලියන්න"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(selectedSession, null, 2));
              alert("සැසියේ සම්පූර්ණ දත්ත (JSON) සාර්ථකව පිටපත් කරගන්නා ලදී.");
            }}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border border-slate-700/50 cursor-pointer hidden sm:flex"
            title="සැසියේ දත්ත පිටපත් කරන්න"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>JSON</span>
          </button>

          <button
            onClick={() => handleDeleteSession(session.id)}
            className="bg-rose-950/40 hover:bg-rose-600 border border-rose-900/50 hover:border-rose-500 text-rose-300 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            title="මෙම සාකච්ඡාව මකන්න"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">මකන්න</span>
          </button>

          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer border border-transparent hover:border-slate-700"
            title="වසන්න (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Priority Attention Banner (Always visible if attention requested) */}
      {session.needsAdminAttention && (
        <div className="px-4 py-2.5 bg-amber-950/90 border-b border-amber-800/80 text-amber-200 text-xs flex items-center justify-between gap-3 shrink-0 animate-fadeIn z-10 shadow-md">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span className="font-semibold">මෙම සැසිය සඳහා පරිශීලකයා පරිපාලක සහය ඉල්ලා ඇත (User requested live attention).</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (db) {
                try {
                  await updateDoc(doc(db, "sessions", session.id), { needsAdminAttention: false });
                } catch (e) {
                  console.warn("Could not update Firestore:", e);
                }
              }
              fetchAdminSessions();
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0 shadow flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            <span>විසඳන ලදී (Resolved)</span>
          </button>
        </div>
      )}

      {/* Optional Collapsible User Info Drawer */}
      {adminShowUserDetails && (
        <div className="p-4 bg-[#121826] border-b border-slate-800 text-xs space-y-3 shrink-0 max-h-[35vh] overflow-y-auto animate-in slide-in-from-top-2 duration-150">
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* User IP Card */}
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider">පරිශීලක IP ලිපිනය</span>
                    <span className="text-xs font-mono font-bold text-cyan-300 truncate block">
                      {session.userIp || "හඳුනාගෙන නැත"}
                    </span>
                  </div>
                </div>
                {session.userIp && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(session.userIp || "");
                      setCopiedEmail("ip");
                      setTimeout(() => setCopiedEmail(null), 2000);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-cyan-950/40 transition-all shrink-0 cursor-pointer"
                    title="IP එක කොපි කරන්න"
                  >
                    {copiedEmail === "ip" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>

              {/* User Email Card */}
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-pink-950/60 border border-pink-800/50 flex items-center justify-center text-pink-400 shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider">පරිශීලක ඊමේල්</span>
                    <span className="text-xs font-mono font-bold text-pink-300 truncate block select-all">
                      {resolvedEmail || "ලබාදී නැත"}
                    </span>
                  </div>
                </div>
                {resolvedEmail && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(resolvedEmail);
                        setCopiedEmail("email");
                        setTimeout(() => setCopiedEmail(null), 2000);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-pink-300 hover:bg-pink-950/40 transition-all cursor-pointer"
                      title="Email එක කොපි කරන්න"
                    >
                      {copiedEmail === "email" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <a
                      href={`mailto:${resolvedEmail}?subject=${encodeURIComponent("සුවසැත SRH සෞඛ්‍ය උපදේශන සේවාව")}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-all cursor-pointer"
                      title="Email යවන්න"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* User Direct Phone Card */}
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center text-emerald-400 shrink-0">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider">දුරකථන / WhatsApp අංකය</span>
                    <span className="text-xs font-mono font-bold text-emerald-300 truncate block select-all">
                      {session.directContactNumber || session.contactInfo || "ලබාදී නැත"}
                    </span>
                  </div>
                </div>
                {(session.directContactNumber || session.contactInfo) && (
                  <a
                    href={`tel:${session.directContactNumber || session.contactInfo}`}
                    className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/60 transition-all shrink-0 cursor-pointer"
                    title="ඇමතුමක් ලබාගන්න"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Verified Identity Card */}
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-950/60 border border-indigo-800/50 flex items-center justify-center text-indigo-400 shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block tracking-wider">සත්‍යාපිත පරිශීලක අනන්‍යතාව</span>
                    <span className="text-xs font-mono font-semibold text-slate-300 truncate block">
                      {(selectedSession as any).userId ? `UID: ${(selectedSession as any).userId.substring(0, 16)}...` : "නිර්නාමික පිවිසුම (Anonymous)"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Username Account info card */}
            {session.contactType === "username" && (
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-purple-900/40 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-purple-950/70 border border-purple-700/50 flex items-center justify-center text-purple-300 font-bold text-sm shrink-0">
                    {(session.userEmail || session.contactInfo?.split("|")[0] || "U").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] uppercase font-mono font-bold text-purple-400 block tracking-wider">පරිශීලක නාම ගිණුම (Username Account)</span>
                    <span className="text-xs font-bold text-slate-100 truncate block">
                      {session.contactInfo?.split("|")[0] || session.userEmail || "User"}
                    </span>
                    <span className="text-[11px] text-purple-300 font-mono truncate block select-all">
                      @{session.userEmail || session.contactInfo?.split("|")[0]}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Google / Facebook user account info card */}
            {session.contactType === "google" && session.contactInfo && (
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-blue-900/40 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {(() => {
                    const g = parseGoogleContact(session.contactInfo);
                    return (
                      <>
                        {g.photoURL ? (
                          <img src={g.photoURL} alt={g.name} className="w-9 h-9 rounded-xl border border-blue-500/40 object-cover shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-blue-950/70 border border-blue-700/50 flex items-center justify-center text-blue-300 font-bold text-sm shrink-0">
                            {g.name?.charAt(0) || "G"}
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="text-[9px] uppercase font-mono font-bold text-blue-400 block tracking-wider">Google සත්‍යාපිත ගිණුම</span>
                          <span className="text-xs font-bold text-slate-100 truncate block">{g.name}</span>
                          {g.email && <span className="text-[11px] text-blue-300 font-mono truncate block select-all">{g.email}</span>}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {session.contactType === "facebook" && session.contactInfo && (
              <div className="p-3 bg-[#0e131f] rounded-2xl border border-indigo-900/40 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {(() => {
                    const fb = parseFacebookContact(session.contactInfo);
                    return (
                      <>
                        {fb.photoURL ? (
                          <img src={fb.photoURL} alt={fb.name} className="w-9 h-9 rounded-xl border border-indigo-500/40 object-cover shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-indigo-950/70 border border-indigo-700/50 flex items-center justify-center text-indigo-300 font-bold text-sm shrink-0">
                            {fb.name?.charAt(0) || "F"}
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="text-[9px] uppercase font-mono font-bold text-indigo-400 block tracking-wider">Facebook සත්‍යාපිත ගිණුම</span>
                          <span className="text-xs font-bold text-slate-100 truncate block">{fb.name}</span>
                          {fb.email && <span className="text-[11px] text-indigo-300 font-mono truncate block select-all">{fb.email}</span>}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {session.needsAdminAttention && (
              <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>මෙම පරිශීලකයා පරිපාලක අවධානය (Admin Attention) ඉල්ලා ඇත.</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (db) {
                      try {
                        await updateDoc(doc(db, "sessions", session.id), { needsAdminAttention: false });
                      } catch (e) {
                        console.warn("Could not update Firestore:", e);
                      }
                    }
                    fetchAdminSessions();
                  }}
                  className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0"
                >
                  විසඳන ලදී (Mark Resolved)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat Thread Messages Area (Full width & height) */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-4xl w-full mx-auto chat-scroll">
        {session.messages && session.messages.length > 0 ? (
          session.messages.map((msg) => {
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
                <div className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                  isAdminMsg
                    ? "bg-gradient-to-br from-emerald-950/80 via-[#0e2722] to-[#132b26] text-emerald-100 border-2 border-emerald-500/60 rounded-tl-sm shadow-lg w-full"
                    : msg.role === "user" 
                      ? "bg-rose-950/40 border border-rose-900/40 text-rose-100 rounded-tr-sm" 
                      : "bg-[#151c2c] text-slate-100 rounded-tl-sm border border-slate-800"
                }`}>
                  <div className="font-semibold text-[9px] mb-1.5 uppercase tracking-wider font-mono opacity-90 flex flex-wrap items-center justify-between gap-1.5">
                    {isAdminMsg ? (
                      <span className="text-emerald-300 font-bold flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{msg.adminName || "සුවසැත පරිපාලක (Suwasetha Admin)"}</span>
                        <span className="text-[8px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded-full font-mono">නිල උපදේශනය</span>
                      </span>
                    ) : (
                      <span>{msg.role === "user" ? "පරිශීලක (User)" : "සුවසැත AI (Model)"}</span>
                    )}
                    {msg.deletedByUser && (
                      <span className="text-[8px] bg-rose-950/90 text-rose-400 border border-rose-900/60 px-1.5 py-0.5 rounded font-sans font-bold uppercase animate-pulse">
                        🗑️ පරිශීලකයා විසින් මකන ලදී (User Deleted)
                      </span>
                    )}
                  </div>

                  {msg.imageUrl && (
                    <div className="mb-2 max-w-sm overflow-hidden rounded-xl bg-[#090d16]/90 border border-slate-700/40 p-1.5 group/img relative">
                      <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in" title="ලොකුවට බ්‍රවුසරයෙන් බලන්න">
                        <img 
                          src={msg.imageUrl} 
                          alt="Attachment" 
                          className="w-full h-auto object-contain max-h-56 rounded-lg"
                          referrerPolicy="no-referrer"
                        />
                      </a>
                      <a 
                        href={msg.imageUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold underline block mt-1.5 px-1 flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>බ්‍රවුසරයෙන් සම්පූර්ණ ඡායාරූපය බලන්න</span>
                      </a>
                    </div>
                  )}

                  {msg.role === "user" ? (
                    (msg.content.includes("ftypheic") || msg.content.includes("mif1heic") || msg.content.startsWith("\u0000\u0000\u0000") || (msg.content.match(/\uFFFD/g) || []).length > 20) ? (
                      <div className="bg-amber-950/60 border border-amber-600/70 rounded-xl p-3 text-amber-200 space-y-1.5 animate-fadeIn">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>iPhone HEIC ඡායාරූපයක් Text ලෙස Paste කර ඇති බව හඳුනාගැනිණි</span>
                        </div>
                        <p className="text-[11px] text-amber-200/90 leading-relaxed font-sans">
                          මෙම පරිශීලකයා Apple iPhone එකකින් ලබාගත් HEIC/HEIF ඡායාරූප ගොනුවක් කෙලින්ම text input පෙට්ටියට paste කර ඇති නිසා එහි raw binary අකුරු ({msg.content.length.toLocaleString()} characters) මෙහි සටහන්ව ඇත. ඡායාරූපය සාමාන්‍ය upload බොත්තම හරහා එකතු කර නොමැත.
                        </p>
                        <div className="text-[10px] font-mono text-amber-400/80 bg-amber-950/90 p-1.5 rounded-lg overflow-x-auto truncate">
                          Header: {msg.content.slice(0, 70).replace(/[^\x20-\x7E]/g, ".")}
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap font-sans text-slate-100">{msg.content}</p>
                    )
                  ) : (
                    <div className="prose prose-invert prose-sm max-w-none text-slate-100">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}


                  <span className={`text-[9px] block mt-1.5 text-right font-mono ${
                    isAdminMsg ? "text-emerald-400/70" : "text-slate-500"
                  }`}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-16 text-slate-500 text-xs">
            <p>මෙම සාකච්ඡාවේ පණිවිඩ හමු නොවීය.</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Admin Message Composer (Spacious, Never-Cut-Off, Full-Width typing station) */}
      {showAdminComposer ? (
        <div className="shrink-0 bg-[#0d1322] border-t-2 border-emerald-500/70 p-3.5 sm:p-4 shadow-2xl animate-in slide-in-from-bottom-2 duration-150">
          <div className="max-w-4xl w-full mx-auto flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-emerald-950 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-emerald-300 font-display flex items-center gap-1.5">
                    <span>නිල පරිපාලක පණිවිඩය (Official Admin Response)</span>
                    <span className="text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded-full hidden sm:inline">සජීවීව පරිශීලක තිරයට යැවේ</span>
                  </span>
                  <p className="text-[10px] text-slate-400">මෙම පණිවිඩය පරිශීලකයාගේ සාකච්ඡා තිරයේ නිල පරිපාලක සටහනක් ලෙස ක්ෂණිකව සටහන් වේ.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminComposer(false)}
                className="text-slate-400 hover:text-slate-200 text-xs p-1 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                title="ටයිප් කිරීමේ පෙට්ටිය සඟවන්න"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Response Templates */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] font-semibold text-slate-400 mr-1">ක්ෂණික අච්චු:</span>
              <button
                type="button"
                onClick={() => setAdminReplyText("ඔබගේ ගැටලුව සම්බන්ධයෙන් වෛද්‍ය උපදෙස් ලබා ගැනීමට 1948 සුවසැරිය හෝ ළඟම ඇති සෞඛ්‍ය වෛද්‍ය නිලධාරී (MOH) කාර්යාලය අමතන්න.")}
                className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 hover:border-slate-600 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
              >
                🏥 1948/MOH යොමු කිරීම
              </button>
              <button
                type="button"
                onClick={() => setAdminReplyText("ඔබ එවා ඇති ඡායාරූපය අප විසින් පරීක්ෂා කරන ලදී. වැඩිදුර රෝග විනිශ්චය සඳහා චර්ම රෝග හෝ ලිංගාශ්‍රිත රෝග (STD) සායනයකට යොමු වීම වඩාත් සුදුසුය.")}
                className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 hover:border-slate-600 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
              >
                🔍 ඡායාරූපය පරීක්ෂා කළ බව
              </button>
              <button
                type="button"
                onClick={() => setAdminReplyText("ඔබ දක්වා ඇති රෝග ලක්ෂණ අනුව වහාම විශේෂඥ වෛද්‍යවරයකු හමුවී අවශ්‍ය ප්‍රතිකාර ලබාගන්නා ලෙස කාරුණිකව උපදෙස් දෙමු.")}
                className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 hover:border-slate-600 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
              >
                👨‍⚕️ විශේෂඥ වෛද්‍ය අවධානය
              </button>
              <button
                type="button"
                onClick={() => setAdminReplyText("හදිසි උපත් පාලන පෙති (ECP) අනාරක්ෂිත ලිංගික එක්වීමකින් පැය 72ක් (දින 3ක්) ඇතුළත ලබාගත යුතු අතර, නිතර භාවිතා කිරීම නිර්දේශ නොකෙරේ.")}
                className="text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 hover:border-slate-600 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
              >
                💊 හදිසි උපත් පාලන පෙති (ECP) උපදෙස්
              </button>
            </div>

            {/* Multi-Line Textarea with Spacious Typing Room */}
            <div className="relative">
              <textarea
                value={adminReplyText}
                onChange={(e) => setAdminReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleSendAdminMessage();
                  }
                }}
                rows={4}
                placeholder="මෙම පරිශීලකයාට යැවීමට නිල පරිපාලක උපදේශනය මෙහි ටයිප් කරන්න... (Press Ctrl + Enter to send)"
                className="w-full min-h-[110px] bg-[#080c14] border-2 border-emerald-500/50 hover:border-emerald-500/80 focus:border-emerald-400 rounded-xl p-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-sans resize-y leading-relaxed shadow-inner"
              />
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-slate-400">
                  {adminReplyText.length} අකුරු
                </span>
                <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                  (Ctrl + Enter යැවීම සඳහා)
                </span>
                {adminReplySuccess && (
                  <span className="text-xs font-semibold text-emerald-300 animate-fadeIn flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{adminReplySuccess}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {adminReplyText && (
                  <button
                    type="button"
                    onClick={() => setAdminReplyText("")}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    මකන්න (Clear)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAdminComposer(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
                >
                  සඟවන්න
                </button>
                <button
                  type="button"
                  onClick={handleSendAdminMessage}
                  disabled={!adminReplyText.trim() || adminReplySending}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/60 transition-all cursor-pointer active:scale-95"
                >
                  {adminReplySending ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>පණිවිඩය යවමින්...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>පණිවිඩය යවන්න (Send Admin Message)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="shrink-0 p-3 bg-[#0d1322] border-t-2 border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="truncate">පරිශීලකයාගේ සාකච්ඡාවට නිල පරිපාලක පණිවිඩයක් ටයිප් කිරීමට අවශ්‍යද?</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAdminComposer(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-md shadow-emerald-900/30 transition-all cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span>✍️ පණිවිඩය ටයිප් කරන්න</span>
          </button>
        </div>
      )}
    </motion.div>
  );
};
