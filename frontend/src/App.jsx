import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, saveToken, clearToken, hasToken } from "./api.js";

// ─── RECURRING SESSION ENGINE ──────────────────────────────────────────────────
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];


// ─── GLOBAL DEEP CLEAN ──────────────────────────────────────────────────────
// Converts ANY value (Mongoose doc, ObjectId, Date, nested object) to safe primitives
const deepClean = (obj) => {
  if (!obj) return {};
  // If it's a Mongoose document, convert to plain JS object first
  const raw = (typeof obj.toObject === 'function') ? obj.toObject() : obj;
  const result = {};
  // Use JSON parse/stringify to flatten everything, then fix IDs
  try {
    const jsonStr = JSON.stringify(raw, (key, val) => {
      if (val === null || val === undefined) return val;
      // Mongoose ObjectId: has _bsontype property
      if (val && val._bsontype === 'ObjectId') return val.toString();
      // Date objects
      if (val instanceof Date) return val.toISOString().split('T')[0];
      // Plain objects that look like ObjectIds (have toString returning hex)
      if (val && typeof val === 'object' && typeof val.toString === 'function') {
        const s = val.toString();
        if (/^[0-9a-f]{24}$/.test(s)) return s;
      }
      return val;
    });
    const flat = JSON.parse(jsonStr);
    // Normalize _id → id
    if (flat._id) { flat.id = flat._id; delete flat._id; }
    return flat;
  } catch(e) {
    // Fallback: manual extraction of known user fields
    return {
      id:               raw._id?.toString() || raw.id || '',
      name:             String(raw.name || ''),
      email:            String(raw.email || ''),
      role:             String(raw.role || 'student'),
      phone:            String(raw.phone || ''),
      age:              String(raw.age || ''),
      city:             String(raw.city || ''),
      level:            String(raw.level || ''),
      avatar:           String(raw.avatar || ''),
      groupId:          String(raw.groupId || ''),
      registrationDate: String(raw.registrationDate || ''),
    };
  }
};


function generateRecurringSessions(config, existingStudents) {
  const { title, groupId, teacherId, startTime, endTime, duration, recurringDays, endType, endDate, repeatWeeks, seriesId } = config;
  const sessions = [];
  const start = new Date(config.startDate);
  let current = new Date(start);
  let limit;

  if (endType === "date") limit = new Date(endDate);
  else if (endType === "weeks") limit = new Date(start.getTime() + repeatWeeks * 7 * 24 * 60 * 60 * 1000);
  else if (endType === "academic_year") limit = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  else limit = new Date(start.getTime() + 52 * 7 * 24 * 60 * 60 * 1000); // max 1 year for "indefinite"

  const attendance = {};
  existingStudents.forEach(sid => { attendance[sid] = null; });

  let safeCount = 0;
  while (current <= limit && safeCount < 500) {
    const dayOfWeek = current.getDay();
    if (recurringDays.includes(dayOfWeek)) {
      const dateStr = current.toISOString().split("T")[0];
      sessions.push({
        id: Date.now() + Math.random(),
        seriesId,
        title,
        groupId,
        teacherId,
        date: dateStr,
        startTime: startTime,
        time: startTime,
        endTime,
        duration: Number(duration),
        status: "upcoming",
        notes: "",
        attendance: { ...attendance },
        isCancelled: false,
        isException: false,
        recurringDays,
        endType,
        endDate: limit.toISOString().split("T")[0],
      });
    }
    current.setDate(current.getDate() + 1);
    safeCount++;
  }
  return sessions;
}

// ─── INITIAL DATA ──────────────────────────────────────────────────────────────
const SERIES_A = "series-" + 1001;
const SERIES_B = "series-" + 1002;
const SERIES_C = "series-" + 1003;

function buildInitialSessions() {
  const s1 = generateRecurringSessions({
    title: "Grammar & Speaking", groupId: 1, teacherId: 2,
    startDate: "2025-02-03", startTime: "09:00", endTime: "10:30", duration: 90,
    recurringDays: [1, 3, 5], endType: "date", endDate: "2025-06-30", seriesId: SERIES_A
  }, [4, 6]);

  const s2 = generateRecurringSessions({
    title: "A2 Evening Class", groupId: 2, teacherId: 2,
    startDate: "2025-02-04", startTime: "18:00", endTime: "19:30", duration: 90,
    recurringDays: [2, 4], endType: "date", endDate: "2025-06-30", seriesId: SERIES_B
  }, [5]);

  const s3 = generateRecurringSessions({
    title: "C1 Advanced Workshop", groupId: 3, teacherId: 3,
    startDate: "2025-02-03", startTime: "11:00", endTime: "12:30", duration: 90,
    recurringDays: [1, 3], endType: "date", endDate: "2025-06-30", seriesId: SERIES_C
  }, [7]);

  // Mark some past sessions as completed with attendance
  const today = "2025-02-26";
  const allSessions = [...s1, ...s2, ...s3].map(s => {
    if (s.date < today) {
      const att = { ...s.attendance };
      Object.keys(att).forEach(k => { att[k] = Math.random() > 0.2; });
      return { ...s, status: "completed", attendance: att };
    }
    return s;
  });

  return allSessions;
}

// ─── SIMULATED FILE STORE ──────────────────────────────────────────────────────
// In a real SaaS this would be S3/Cloudflare R2. Here we store base64 data URLs
// or placeholder references so the UI is fully functional without a backend.

// ─── UTILS ─────────────────────────────────────────────────────────────────────
const fmt$ = (n) => `${(n ?? 0).toLocaleString()} MAD`;
const getInitials = (name) => name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() ?? "??";
const statusColor = { paid: "#22c55e", pending: "#f59e0b", overdue: "#ef4444", upcoming: "#f97316", completed: "#22c55e", cancelled: "#6b7280", active: "#22c55e", unpaid: "#ef4444", paused: "#f59e0b" };
const avatarPalette = ["#f97316","#8b5cf6","#ec4899","#f59e0b","#22c55e","#3b82f6","#ef4444","#06b6d4"];
const getAvatarColor = (s) => avatarPalette[(s?.charCodeAt(0) ?? 0) % avatarPalette.length];

// ─── MEETING LINK UTILS ────────────────────────────────────────────────────────
const detectPlatform = (url) => {
  if (!url) return null;
  if (url.includes("meet.google.com")) return { name: "Google Meet", icon: "🟢", color: "#22c55e" };
  if (url.includes("zoom.us")) return { name: "Zoom", icon: "🔵", color: "#2D8CFF" };
  if (url.includes("teams.microsoft.com")) return { name: "MS Teams", icon: "🟣", color: "#6264A7" };
  if (url.includes("webex.com")) return { name: "Webex", icon: "🟠", color: "#f59e0b" };
  return { name: "Meeting Link", icon: "🔗", color: "#f97316" };
};
const isValidUrl = (url) => {
  try { new URL(url); return url.startsWith("http"); } catch { return false; }
};
// Returns the effective meeting link for a session (session-level overrides series)
const getMeetingLink = (session, seriesList) => {
  if (session.meetingLink) return session.meetingLink;
  if (session.seriesId) {
    const series = seriesList?.find(s => s.id === session.seriesId);
    return series?.meetingLink ?? null;
  }
  return null;
};
// Minutes until session starts (negative = already started/passed)
const minutesUntilSession = (dateStr, timeStr) => {
  const now = new Date();
  const sessionStart = new Date(`${dateStr}T${timeStr}:00`);
  return Math.floor((sessionStart - now) / 60000);
};

// ─── TOAST SYSTEM ──────────────────────────────────────────────────────────────
let _toastFn = null;
const toast = (msg, type = "success") => _toastFn?.(msg, type);
function useToasts() {
  const [toasts, setToasts] = useState([]);
  _toastFn = useCallback((msg, type) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return toasts;
}

// ─── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#09090f;--bg2:#111218;--bg3:#16181f;--bg4:#1c1f2a;--bg5:#222636;
  --border:#1e2130;--border2:#272d40;--border3:#313852;
  --text:#eceef5;--text2:#9aa3c0;--text3:#5c6480;
  --accent:#f97316;--accent2:#fb923c;--accent3:#fdba74;--glow:rgba(249,115,22,.15);
  --green:#22c55e;--amber:#f59e0b;--red:#ef4444;--blue:#3b82f6;--cyan:#06b6d4;
  --font:'Sora',sans-serif;--mono:'JetBrains Mono',monospace;
  --r:10px;--r2:14px;--r3:18px;
  --sh:0 2px 16px rgba(0,0,0,.5);--sh2:0 8px 40px rgba(0,0,0,.7);
}
html{scroll-behavior:smooth}body{font-family:var(--font);background:var(--bg);color:var(--text);overflow-x:hidden}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:var(--bg2)}
::-webkit-scrollbar-thumb{background:var(--border3);border-radius:99px}

/* ── APP SHELL ── */
.app{display:flex;min-height:100vh}

/* ── SIDEBAR ── */
.sidebar{width:232px;min-width:232px;background:var(--bg2);border-right:1px solid var(--border);
  display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:200;
  transition:transform .25s cubic-bezier(.4,0,.2,1);overflow-y:auto;overflow-x:hidden}
.sidebar::-webkit-scrollbar{width:3px}
.sidebar::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}
.sidebar::-webkit-scrollbar-track{background:transparent}
.sidebar-logo{padding:18px 16px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
.logo-box{width:32px;height:32px;background:var(--accent);border-radius:9px;
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;
  color:#fff;letter-spacing:-1px;box-shadow:0 0 24px var(--glow);flex-shrink:0}
.logo-name{font-size:14px;font-weight:700;letter-spacing:-.3px}
.logo-ver{font-size:10px;color:var(--text3);margin-top:1px}
.nav-section{padding:10px 10px 2px}
.nav-section-label{font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;
  letter-spacing:1px;padding:2px 8px 6px}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;
  cursor:pointer;font-size:13px;font-weight:500;color:var(--text2);
  transition:all .13s;margin-bottom:1px;border:1px solid transparent;user-select:none}
.nav-item:hover{background:var(--bg3);color:var(--text)}
.nav-item.active{background:rgba(249,115,22,.12);color:var(--accent2);border-color:rgba(249,115,22,.2)}
.nav-icon{font-size:14px;width:17px;text-align:center;flex-shrink:0}
.sidebar-bottom{padding:10px;border-top:1px solid var(--border);position:sticky;bottom:0;background:var(--bg2)}
.user-row{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px}
.contact-section{margin:8px 10px 4px;padding:10px;background:var(--bg3);border:1px solid var(--border);border-radius:10px}
.contact-title{font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
.contact-btn{display:flex;align-items:center;gap:7px;width:100%;padding:7px 9px;border-radius:7px;border:none;font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;text-decoration:none;transition:all .15s;margin-bottom:5px}
.contact-btn:last-child{margin-bottom:0}
.contact-btn-wa{background:rgba(37,211,102,.12);color:#25d366;border:1px solid rgba(37,211,102,.2)}
.contact-btn-wa:hover{background:rgba(37,211,102,.22);transform:translateY(-1px)}
.contact-btn-call{background:rgba(59,130,246,.1);color:#3b82f6;border:1px solid rgba(59,130,246,.2)}
.contact-btn-call:hover{background:rgba(59,130,246,.2);transform:translateY(-1px)}
.contact-btn-mail{background:rgba(249,115,22,.1);color:var(--accent2);border:1px solid rgba(249,115,22,.2)}
.contact-btn-mail:hover{background:rgba(249,115,22,.18);transform:translateY(-1px)}
.user-name{font-size:13px;font-weight:600}
.user-role{font-size:11px;color:var(--text3);text-transform:capitalize}

/* ── AVATAR ── */
.av{border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-weight:700;color:#fff;flex-shrink:0;border:1px solid transparent}
.av-sm{width:28px;height:28px;font-size:10px;border-radius:7px}
.av-md{width:34px;height:34px;font-size:12px}
.av-lg{width:44px;height:44px;font-size:15px;border-radius:12px}
.av-xl{width:60px;height:60px;font-size:20px;border-radius:16px}

/* ── MAIN ── */
.main{margin-left:232px;flex:1;min-height:100vh;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:100;height:56px;
  background:rgba(9,9,15,.88);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--border);padding:0 24px;
  display:flex;align-items:center;justify-content:space-between}
.topbar-title{font-size:15px;font-weight:700;letter-spacing:-.2px}
.topbar-right{display:flex;align-items:center;gap:8px}
.topbar-chip{display:flex;align-items:center;gap:6px;padding:5px 12px;
  border-radius:99px;font-size:12px;font-weight:500;border:1px solid var(--border);
  background:var(--bg2);cursor:pointer;transition:all .13s;color:var(--text2)}
.topbar-chip:hover{border-color:var(--accent);color:var(--accent2)}
.content{padding:24px;flex:1}

/* ── CARDS ── */
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);padding:18px;
  transition:border-color .13s}
.card:hover{border-color:var(--border2)}
.card-sm{padding:14px}
.card-accent{border-color:rgba(249,115,22,.25);background:rgba(249,115,22,.04)}

/* ── GRID ── */
.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.g-auto{display:grid;gap:14px}

/* ── STAT CARD ── */
.stat{position:relative;overflow:hidden}
.stat-glow{position:absolute;top:-24px;right:-24px;width:80px;height:80px;border-radius:50%;opacity:.12}
.stat-icon{font-size:20px;margin-bottom:10px}
.stat-label{font-size:12px;color:var(--text2);margin-bottom:6px;font-weight:500}
.stat-val{font-size:26px;font-weight:800;letter-spacing:-1px;line-height:1}
.stat-sub{font-size:11px;color:var(--text3);margin-top:5px}

/* ── BADGE ── */
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
  border-radius:99px;font-size:11px;font-weight:600}
.bdot{width:5px;height:5px;border-radius:50%}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;
  border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;
  transition:all .13s;font-family:var(--font);white-space:nowrap}
.btn-pr{background:var(--accent);color:#fff;box-shadow:0 0 20px var(--glow)}
.btn-pr:hover{background:#4f52e8;transform:translateY(-1px)}
.btn-se{background:var(--bg3);color:var(--text2);border:1px solid var(--border)}
.btn-se:hover{border-color:var(--accent);color:var(--accent2)}
.btn-da{background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2)}
.btn-da:hover{background:rgba(239,68,68,.2)}
.btn-wa{background:rgba(245,158,11,.1);color:var(--amber);border:1px solid rgba(245,158,11,.2)}
.btn-wa:hover{background:rgba(245,158,11,.2)}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:7px}
.btn-xs{padding:3px 8px;font-size:11px;border-radius:6px}
.btn-icon{padding:6px;border-radius:7px;background:var(--bg3);border:1px solid var(--border);
  color:var(--text2);cursor:pointer;font-size:14px;transition:all .13s}
.btn-icon:hover{border-color:var(--accent);color:var(--accent2)}

/* ── FORMS ── */
.fg{margin-bottom:14px}
label{display:block;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:5px}
input,select,textarea{width:100%;background:var(--bg3);border:1px solid var(--border2);
  border-radius:8px;padding:9px 12px;font-size:13px;color:var(--text);
  font-family:var(--font);transition:all .13s;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--glow)}
input::placeholder{color:var(--text3)}
select option{background:var(--bg3)}
textarea{resize:vertical;min-height:72px}
.input-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}

/* ── DAY CHECKBOX ── */
.day-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.day-pill{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;
  cursor:pointer;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);
  transition:all .13s;user-select:none}
.day-pill.sel{background:rgba(249,115,22,.15);border-color:var(--accent);color:var(--accent2)}

/* ── MODAL ── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(5px);
  z-index:1000;display:flex;align-items:center;justify-content:center;
  animation:fadeIn .18s ease}
.modal{background:var(--bg2);border:1px solid var(--border3);border-radius:var(--r3);
  padding:24px;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;
  animation:slideUp .22s ease;box-shadow:var(--sh2)}
.modal-lg{max-width:700px}
.modal-xl{max-width:860px}
.mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.mtitle{font-size:17px;font-weight:800;letter-spacing:-.3px}
.mclose{width:30px;height:30px;border-radius:7px;background:var(--bg3);
  border:1px solid var(--border);color:var(--text2);cursor:pointer;font-size:15px;
  display:flex;align-items:center;justify-content:center;transition:all .13s}
.mclose:hover{color:var(--text);border-color:var(--border2)}

/* ── TABLE ── */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:9px 12px;color:var(--text3);font-weight:600;font-size:11px;
  text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
td{padding:11px 12px;border-bottom:1px solid var(--border);color:var(--text2);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.018)}

/* ── TABS ── */
.tabs{display:flex;gap:3px;background:var(--bg3);border-radius:9px;padding:3px;
  border:1px solid var(--border);margin-bottom:18px}
.tab{flex:1;text-align:center;padding:7px 14px;border-radius:7px;font-size:13px;
  font-weight:500;cursor:pointer;color:var(--text2);transition:all .13s}
.tab.active{background:var(--bg2);color:var(--text);box-shadow:0 1px 6px rgba(0,0,0,.4)}

/* ── PAGE HEADER ── */
.ph{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px;gap:12px}
.ph-title{font-size:21px;font-weight:800;letter-spacing:-.5px}
.ph-sub{font-size:13px;color:var(--text3);margin-top:3px}
.ph-right{display:flex;align-items:center;gap:8px;flex-shrink:0}

/* ── SECTION HEADER ── */
.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.sh-title{font-size:14px;font-weight:700;letter-spacing:-.2px}

/* ── PROGRESS ── */
.prog{height:5px;background:var(--bg4);border-radius:99px;overflow:hidden}
.prog-fill{height:100%;border-radius:99px;transition:width .5s ease}

/* ── LIST ITEM ── */
.li{display:flex;align-items:center;gap:10px;padding:10px 0;
  border-bottom:1px solid var(--border)}
.li:last-child{border-bottom:none}

/* ── CALENDAR ── */
.cal-wrap{overflow:hidden}
.cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.cal-month{font-size:15px;font-weight:700}

/* ── MONTH VIEW ── */
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border)}
.cal-hdr{font-size:10px;font-weight:700;color:var(--text3);text-align:center;
  padding:8px 4px;background:var(--bg2);text-transform:uppercase;letter-spacing:.6px}
.cal-day{min-height:90px;padding:6px;cursor:pointer;background:var(--bg2);
  transition:background .12s;display:flex;flex-direction:column}
.cal-day:hover{background:var(--bg3)}
.cal-day.today{background:rgba(249,115,22,.07)}
.cal-day.empty{cursor:default;background:var(--bg1);opacity:.4}
.cal-day.other-month{opacity:.45}
.cal-day-num{font-size:12px;font-weight:600;width:24px;height:24px;
  display:flex;align-items:center;justify-content:center;border-radius:50%;margin-bottom:3px;flex-shrink:0}
.today .cal-day-num{background:var(--accent);color:#fff}
.cal-evt{width:100%;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;
  margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;
  border-left:2px solid currentColor}
.cal-evt:hover{filter:brightness(1.2)}
.cal-more{font-size:10px;color:var(--text3);margin-top:3px;padding:0 4px;font-weight:600}

/* ── WEEK VIEW ── */
.week-grid{display:grid;grid-template-columns:52px repeat(7,1fr);gap:0;position:relative;
  background:var(--border);overflow:hidden}
.week-hdr-row{display:grid;grid-template-columns:52px repeat(7,1fr);gap:0;background:var(--border);
  position:sticky;top:0;z-index:10}
.week-hdr-spacer{background:var(--bg2);border-bottom:1px solid var(--border3)}
.week-hdr-day{background:var(--bg2);padding:8px 4px;text-align:center;border-bottom:1px solid var(--border3)}
.week-hdr-day.today{background:rgba(249,115,22,.08)}
.week-hdr-dayname{font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px}
.week-hdr-daynum{font-size:18px;font-weight:800;color:var(--text);margin-top:2px}
.week-hdr-day.today .week-hdr-daynum{color:var(--accent)}
.week-time-col{background:var(--bg2);display:flex;flex-direction:column}
.week-time-slot{height:56px;padding:0 6px;display:flex;align-items:flex-start;
  padding-top:4px;border-right:1px solid var(--border3)}
.week-time-label{font-size:9px;font-weight:600;color:var(--text3);font-family:var(--mono);white-space:nowrap}
.week-day-col{background:var(--bg2);position:relative;border-right:1px solid var(--border)}
.week-day-col.today{background:rgba(249,115,22,.03)}
.week-hour-line{position:absolute;left:0;right:0;border-top:1px solid var(--border);pointer-events:none}
.week-evt{position:absolute;left:2px;right:2px;border-radius:6px;padding:3px 6px;
  cursor:pointer;overflow:hidden;font-size:10px;font-weight:700;transition:filter .12s;
  border-left:3px solid currentColor;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.week-evt:hover{filter:brightness(1.15);z-index:20}
.week-evt-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;font-weight:700}
.week-evt-time{font-size:9px;opacity:.75;font-family:var(--mono);margin-top:1px}
.week-scroll{overflow-y:auto;max-height:calc(100vh - 280px);min-height:400px}
.week-now-line{position:absolute;left:0;right:0;z-index:15;pointer-events:none}
.week-now-dot{width:8px;height:8px;border-radius:50%;background:var(--red);
  position:absolute;left:-4px;top:-4px}
.week-now-bar{position:absolute;left:4px;right:0;height:2px;background:var(--red);top:-1px}

/* ── AGENDA/LIST VIEW ── */
.agenda-date-hdr{font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;
  letter-spacing:.6px;padding:10px 0 6px;border-bottom:1px solid var(--border);margin-bottom:8px;margin-top:16px}
.agenda-date-hdr:first-child{margin-top:0}
.agenda-evt{display:flex;gap:12px;padding:10px 14px;border-radius:10px;background:var(--bg3);
  border:1px solid var(--border);margin-bottom:6px;cursor:pointer;transition:all .13s;align-items:flex-start}
.agenda-evt:hover{border-color:var(--accent);background:rgba(249,115,22,.05)}
.agenda-evt.cancelled{opacity:.45}
.agenda-evt-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;margin-top:3px}
.agenda-evt-time{font-family:var(--mono);font-size:11px;color:var(--accent2);font-weight:700;
  white-space:nowrap;flex-shrink:0;min-width:76px}
.agenda-evt-body{flex:1;min-width:0}
.agenda-evt-title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agenda-evt-meta{font-size:11px;color:var(--text3);margin-top:2px}

/* ── GROUP COLOR PILLS ── */
.group-color-legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.group-color-chip{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
  padding:3px 8px;border-radius:99px;background:var(--bg3);border:1px solid var(--border)}

/* ── SESSION CARD ── */
.sess-card{border-radius:10px;padding:12px 14px;background:var(--bg3);
  border:1px solid var(--border);margin-bottom:6px;cursor:pointer;transition:all .13s}
.sess-card:hover{border-color:var(--accent);background:rgba(249,115,22,.04)}
.sess-card.cancelled{opacity:.5}
.sess-time{font-family:var(--mono);font-size:11px;color:var(--accent2)}
.series-badge{font-size:10px;padding:2px 7px;border-radius:99px;
  background:rgba(249,115,22,.12);color:var(--accent2);border:1px solid rgba(249,115,22,.2);
  font-weight:600;white-space:nowrap}

/* ── RECURRING CONFIG BOX ── */
.rec-box{background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.2);
  border-radius:12px;padding:16px;margin-top:6px}
.rec-section{margin-bottom:14px}
.rec-section:last-child{margin-bottom:0}
.rec-label{font-size:11px;font-weight:700;color:var(--accent2);text-transform:uppercase;
  letter-spacing:.8px;margin-bottom:8px}

/* ── EDIT SCOPE MODAL ── */
.scope-option{display:flex;align-items:flex-start;gap:12px;padding:14px;
  border-radius:10px;border:1px solid var(--border2);background:var(--bg3);
  cursor:pointer;transition:all .13s;margin-bottom:8px}
.scope-option:hover{border-color:var(--accent)}
.scope-option.sel{border-color:var(--accent);background:rgba(249,115,22,.08)}
.scope-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--border3);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.scope-radio.sel{border-color:var(--accent);background:var(--accent)}
.scope-radio.sel::after{content:'';width:6px;height:6px;border-radius:50%;background:#fff}

/* ── TOAST ── */
.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:3000;display:flex;flex-direction:column;gap:7px}
.toast{background:var(--bg3);border:1px solid var(--border3);border-radius:9px;
  padding:11px 15px;font-size:13px;font-weight:500;box-shadow:var(--sh);
  display:flex;align-items:center;gap:9px;max-width:300px;
  animation:slideInR .22s ease}
.t-success{border-left:3px solid var(--green)}
.t-error{border-left:3px solid var(--red)}
.t-info{border-left:3px solid var(--blue)}
.t-warn{border-left:3px solid var(--amber)}

/* ── CHART ── */
.bar-chart{display:flex;align-items:flex-end;gap:6px;padding:0 2px}
.bc-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.bc-bar{width:100%;border-radius:5px 5px 0 0;min-height:3px;transition:height .5s ease;cursor:pointer}
.bc-bar:hover{filter:brightness(1.2)}
.bc-label{font-size:10px;color:var(--text3);text-align:center}

/* ── MISC ── */
.divider{height:1px;background:var(--border);margin:16px 0}
.mono{font-family:var(--mono)}
.muted{color:var(--text3)}
.text-sm{font-size:12px}
.text-xs{font-size:11px}
.fw7{font-weight:700}
.fw8{font-weight:800}
.flex{display:flex}
.fc{flex-direction:column}
.ac{align-items:center}
.jb{justify-content:space-between}
.wrap{flex-wrap:wrap}
.gap4{gap:4px}
.gap8{gap:8px}
.gap12{gap:12px}
.gap16{gap:16px}
.mt4{margin-top:4px}
.mt8{margin-top:8px}
.mt12{margin-top:12px}
.mt16{margin-top:16px}
.mt20{margin-top:20px}
.mt2{margin-top:2px}
.mr8{margin-right:8px}
.gap14{gap:14px}
.gap6{gap:6px}
.mb4{margin-bottom:4px}
.mb8{margin-bottom:8px}
.mb12{margin-bottom:12px}
.mb16{margin-bottom:16px}
.w100{width:100%}
.jc{justify-content:center}
.tac{text-align:center}
.ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── LOGIN ── */
.login-page{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:var(--bg);position:relative;overflow:hidden}
.login-bg{position:absolute;inset:0;
  background:radial-gradient(ellipse 60% 50% at 30% 20%,rgba(249,115,22,.1) 0%,transparent 70%),
             radial-gradient(ellipse 40% 40% at 75% 75%,rgba(129,140,248,.06) 0%,transparent 70%)}
.login-card{width:100%;max-width:400px;position:relative;z-index:1}
.login-logo{text-align:center;margin-bottom:28px}
.login-title{font-size:22px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px}
.login-sub{color:var(--text3);font-size:13px;margin-bottom:28px}
.role-switch{display:flex;gap:3px;background:var(--bg3);border-radius:9px;padding:3px;
  border:1px solid var(--border);margin-bottom:18px}
.role-tab{flex:1;text-align:center;padding:7px;border-radius:7px;font-size:12px;
  font-weight:600;cursor:pointer;color:var(--text2);transition:all .13s}
.role-tab.active{background:var(--accent);color:#fff}

/* ── EMPTY STATE ── */
.empty{text-align:center;padding:40px 20px;color:var(--text3)}
.empty-icon{font-size:36px;margin-bottom:10px;opacity:.5}
.empty-title{font-size:14px;font-weight:600;color:var(--text2);margin-bottom:4px}

/* ── ANIMATIONS ── */
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideInR{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}

/* ── ONLINE SESSION ── */
.mode-toggle{display:flex;gap:6px;margin-top:4px}
.mode-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;
  padding:10px 14px;border-radius:9px;border:1px solid var(--border2);
  background:var(--bg3);cursor:pointer;transition:all .15s;font-size:13px;font-weight:600;color:var(--text2)}
.mode-btn:hover{border-color:var(--border3);color:var(--text)}
.mode-btn.sel-offline{border-color:#f59e0b;background:rgba(245,158,11,.08);color:#f59e0b}
.mode-btn.sel-online{border-color:#22c55e;background:rgba(34,197,94,.08);color:#22c55e}
.online-box{background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.2);
  border-radius:12px;padding:16px;margin-top:8px}
.link-input-wrap{position:relative;display:flex;align-items:center;gap:0}
.link-input-wrap input{padding-right:90px}
.link-input-actions{position:absolute;right:8px;display:flex;gap:4px}
.link-action-btn{background:var(--bg4);border:1px solid var(--border2);border-radius:6px;
  padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;color:var(--text2);
  transition:all .13s;white-space:nowrap}
.link-action-btn:hover{border-color:var(--accent);color:var(--accent2)}
.platform-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
  border-radius:99px;font-size:11px;font-weight:600;margin-top:6px}
/* Join button styles */
.join-btn{display:flex;align-items:center;justify-content:center;gap:10px;
  width:100%;padding:14px 20px;border-radius:12px;font-size:15px;font-weight:700;
  border:none;cursor:pointer;font-family:var(--font);transition:all .2s;
  background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;
  box-shadow:0 4px 20px rgba(34,197,94,.3)}
.join-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(34,197,94,.4)}
.join-btn:disabled{background:var(--bg4);color:var(--text3);cursor:not-allowed;
  transform:none;box-shadow:none}
.join-btn-wrap{border:1px solid rgba(34,197,94,.2);border-radius:14px;
  padding:16px;background:rgba(34,197,94,.04);margin-bottom:12px}
.countdown-row{text-align:center;font-size:12px;color:var(--text3);margin-top:8px}
.countdown-num{font-family:var(--mono);color:var(--amber);font-weight:700}
.mode-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
  border-radius:99px;font-size:11px;font-weight:600}
.mode-pill-online{background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.2)}
.mode-pill-offline{background:rgba(245,158,11,.1);color:var(--amber);border:1px solid rgba(245,158,11,.2)}
.override-link-btn{font-size:11px;color:var(--accent2);background:none;border:none;
  cursor:pointer;text-decoration:underline;font-family:var(--font);padding:0}
.override-link-btn:hover{color:var(--accent3)}

/* ── BOOKS & LESSONS ── */
.book-card{border-radius:var(--r2);overflow:hidden;cursor:pointer;transition:all .15s;border:1px solid var(--border)}
.book-card:hover{border-color:var(--border2);transform:translateY(-2px);box-shadow:var(--sh)}
.book-cover{height:120px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.book-cover-icon{font-size:40px;opacity:.9}
.book-cover-shine{position:absolute;top:0;left:-60%;width:40%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);
  transform:skewX(-15deg);transition:left .5s}
.book-card:hover .book-cover-shine{left:120%}
.book-meta{padding:14px;background:var(--bg2)}
.book-title{font-size:14px;font-weight:700;letter-spacing:-.2px;margin-bottom:3px}
.book-author{font-size:11px;color:var(--text3);margin-bottom:8px}
.chapter-row{display:flex;align-items:center;gap:9px;padding:9px 0;
  border-bottom:1px solid var(--border);cursor:pointer;transition:all .13s}
.chapter-row:last-child{border-bottom:none}
.chapter-row:hover{padding-left:4px}
.chapter-num{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;
  justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
/* Lesson content box */
.lesson-box{border-radius:12px;border:1px solid rgba(249,115,22,.2);
  background:rgba(249,115,22,.04);padding:16px;margin-bottom:12px}
.lesson-box-title{font-size:11px;font-weight:700;color:var(--accent2);
  text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.hw-box{border-radius:12px;border:1px solid rgba(245,158,11,.2);
  background:rgba(245,158,11,.04);padding:16px;margin-bottom:12px}
.hw-box-title{font-size:11px;font-weight:700;color:var(--amber);
  text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px}
/* File row */
.file-row{display:flex;align-items:center;gap:10px;padding:10px 12px;
  border-radius:9px;background:var(--bg3);border:1px solid var(--border);
  margin-bottom:6px;transition:all .13s}
.file-row:hover{border-color:var(--border2)}
.file-icon{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;
  justify-content:center;font-size:16px;flex-shrink:0}
.file-name{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-size{font-size:11px;color:var(--text3);font-family:var(--mono)}
/* PDF Viewer */
.pdf-viewer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:2000;
  display:flex;flex-direction:column;animation:fadeIn .2s}
.pdf-viewer-bar{height:52px;background:var(--bg2);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;padding:0 20px;flex-shrink:0}
.pdf-viewer-body{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px}
.pdf-placeholder{background:var(--bg2);border-radius:12px;padding:48px;text-align:center;
  max-width:600px;width:100%;border:1px solid var(--border)}
/* Next lesson preview card */
.next-lesson-card{border-radius:14px;border:1px solid rgba(249,115,22,.25);
  background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(99,102,241,.02));
  padding:18px;transition:all .15s}
.next-lesson-card:hover{border-color:var(--accent2);transform:translateY(-1px)}
.next-lesson-label{font-size:10px;font-weight:700;color:var(--accent2);
  text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;
  display:flex;align-items:center;gap:5px}
/* Tab badge */
.tab-badge{display:inline-flex;align-items:center;justify-content:center;
  min-width:18px;height:18px;border-radius:99px;background:rgba(249,115,22,.15);
  color:var(--accent2);font-size:10px;font-weight:700;padding:0 5px;margin-left:5px}
/* Materials lesson card */
.mat-lesson-card{background:var(--bg2);border-radius:12px;border:1px solid var(--border);
  overflow:hidden;transition:border-color .15s}
.mat-lesson-card:hover{border-color:var(--border2)}
.mat-lesson-header{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;
  cursor:pointer;user-select:none}
.mat-lesson-header:hover{background:rgba(255,255,255,.02)}
.mat-lesson-icon{width:42px;height:42px;border-radius:11px;display:flex;
  align-items:center;justify-content:center;font-size:19px;flex-shrink:0}
.mat-chevron{font-size:16px;color:var(--text3);margin-top:2px;transition:transform .2s;flex-shrink:0}
.mat-lesson-body{padding:0 16px 16px;border-top:1px solid var(--border)}
/* Material pills */
.mat-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;
  font-size:10px;font-weight:600;background:var(--bg4);color:var(--text2);border:1px solid var(--border)}
.mat-pill-hw{background:rgba(245,158,11,.08);color:var(--amber);border-color:rgba(245,158,11,.2)}
/* Status badges */
.mat-badge-next{font-size:9px;font-weight:700;padding:2px 7px;border-radius:99px;
  background:var(--glow);color:var(--accent2);border:1px solid rgba(249,115,22,.2)}
.mat-badge-done{font-size:9px;font-weight:700;padding:2px 7px;border-radius:99px;
  background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.2)}
/* Material section inside expanded card */
.mat-section{margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
.mat-section:first-child{border-top:none;padding-top:0;margin-top:14px}
.mat-section-label{font-size:10px;font-weight:700;color:var(--accent2);
  text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;
  display:flex;align-items:center;gap:5px}
.mat-section-text{font-size:13px;color:var(--text2);line-height:1.7;
  white-space:pre-wrap}
/* Material file card */
.mat-file-card{display:flex;align-items:center;gap:12px;padding:11px 14px;
  border-radius:10px;border:1px solid var(--border);margin-bottom:8px;transition:all .13s}
.mat-file-card:hover{border-color:var(--border2);transform:translateX(2px)}
.mat-file-icon{width:38px;height:38px;border-radius:9px;display:flex;align-items:center;
  justify-content:center;font-size:18px;flex-shrink:0}
.mat-file-info{flex:1;min-width:0}
.mat-file-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.mat-file-type{font-size:11px;color:var(--text3);margin-top:2px}
/* Homework box */
.hw-box{border-radius:10px;background:rgba(245,158,11,.05);
  border:1px solid rgba(245,158,11,.18);padding:14px;margin-top:14px}
.hw-box-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.hw-due{font-size:11px;font-weight:600}
.hw-instructions{font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:12px}
/* Homework upload zone */
.hw-upload-zone{border:2px dashed rgba(245,158,11,.3);border-radius:10px;
  padding:24px 16px;text-align:center;cursor:pointer;transition:all .15s;
  background:rgba(245,158,11,.03)}
.hw-upload-zone:hover,.hw-upload-zone.drag-active{border-color:var(--amber);
  background:rgba(245,158,11,.07);transform:scale(1.01)}
.hw-uploading{text-align:center;padding:8px 0}
.hw-progress-bar{height:6px;background:var(--bg4);border-radius:99px;overflow:hidden;
  margin:0 auto;max-width:200px}
.hw-progress-fill{height:100%;background:var(--amber);border-radius:99px;
  animation:hw-prog 1.5s ease-in-out infinite}
@keyframes hw-prog{0%{width:10%}50%{width:80%}100%{width:95%}}
.hw-submitted{display:flex;align-items:center;gap:12px;padding:12px 14px;
  background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);
  border-radius:9px;margin-top:4px}
/* Updated PDF viewer */
.pdf-viewer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:2000;
  display:flex;flex-direction:column;animation:fadeIn .2s}
.pdf-viewer-bar{height:56px;background:var(--bg2);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;padding:0 16px;
  flex-shrink:0;gap:12px}
.pdf-viewer-body{flex:1;overflow:auto;display:flex;align-items:flex-start;
  justify-content:center;padding:16px}
/* Upload zone */
.upload-zone{border:1px dashed var(--border2);border-radius:9px;padding:16px;
  text-align:center;cursor:pointer;transition:all .13s;background:var(--bg3)}
.upload-zone:hover{border-color:var(--accent);background:rgba(249,115,22,.04)}
.upload-zone input[type=file]{display:none}

/* ── CREDENTIAL CARD ── */
.cred-card{border-radius:12px;border:1px solid rgba(249,115,22,.25);
  background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(249,115,22,.03));
  padding:16px;margin-bottom:12px}
.cred-card-title{font-size:11px;font-weight:700;color:var(--accent2);
  text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;
  display:flex;align-items:center;gap:6px}
.cred-row{display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px}
.cred-label{font-size:11px;color:var(--text3);font-weight:600;width:56px;flex-shrink:0}
.cred-value{flex:1;font-family:var(--mono);font-size:13px;font-weight:600;
  color:var(--text);letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis}
.cred-value.masked{letter-spacing:2px;color:var(--text2)}
.pw-strength{height:3px;border-radius:99px;transition:all .3s;margin-top:4px}
.pw-hint{font-size:10px;margin-top:4px;font-weight:600}
.reset-pw-btn{font-size:11px;font-weight:600;color:var(--amber);background:none;
  border:none;cursor:pointer;padding:0;font-family:var(--font);text-decoration:underline}
.reset-pw-btn:hover{color:var(--accent2)}

/* ── HAMBURGER ── */
.hamburger{display:none;align-items:center;justify-content:center;
  width:38px;height:38px;border-radius:9px;border:1px solid var(--border);
  background:var(--bg3);color:var(--text2);font-size:17px;cursor:pointer;
  transition:all .13s;flex-shrink:0}
.hamburger:hover{border-color:var(--accent);color:var(--accent2)}

/* overlay behind sidebar on mobile */
.sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);
  z-index:150;backdrop-filter:blur(3px);opacity:0;pointer-events:none;
  transition:opacity .25s}
.sidebar-overlay.open{opacity:1;pointer-events:all}

/* ── HIDE HELPERS ── */
.hide-mobile{} /* visible by default, hidden below 640 */

/* ══════════════════════════════════════════════════
   TABLET  ≤ 1024px
══════════════════════════════════════════════════ */
@media(max-width:1024px){
  /* Sidebar becomes a drawer */
  .sidebar{transform:translateX(-100%);position:fixed;z-index:200}
  .sidebar.open{transform:translateX(0);box-shadow:12px 0 48px rgba(0,0,0,.7)}
  .main{margin-left:0}
  .hamburger{display:flex}

  /* Grids */
  .g4{grid-template-columns:repeat(2,1fr)}

  /* Content & modals */
  .content{padding:18px 16px}
  .modal{margin:16px;max-width:calc(100vw - 32px)}

  /* Calendar */
  .week-scroll{max-height:calc(100vh - 210px)}

  /* Hide date chip to save topbar space */
  .topbar-date{display:none}
}

/* ══════════════════════════════════════════════════
   MOBILE  ≤ 640px
══════════════════════════════════════════════════ */
@media(max-width:640px){
  /* Grids collapse to 1 col */
  .g2,.g3,.g4{grid-template-columns:1fr}
  .input-row{grid-template-columns:1fr}

  /* Spacing */
  .content{padding:12px 10px}
  .card{padding:14px 12px}
  .card-sm{padding:10px}
  .mb16{margin-bottom:12px}

  /* Page header */
  .ph{flex-direction:column;align-items:flex-start;gap:10px;margin-bottom:16px}
  .ph-right{width:100%;justify-content:flex-end;flex-wrap:wrap}
  .ph-title{font-size:18px}
  .ph-sub{font-size:12px}

  /* Topbar */
  .topbar{padding:0 10px;height:50px}
  .topbar-title{font-size:13px;max-width:150px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .topbar-chip{padding:4px 8px;font-size:11px;gap:4px}

  /* Modals → bottom sheet */
  .overlay{align-items:flex-end}
  .modal{margin:0;border-radius:20px 20px 0 0;position:fixed;
    bottom:0;left:0;right:0;max-width:100vw;
    max-height:88vh;border-bottom:none;
    box-shadow:0 -8px 40px rgba(0,0,0,.5)}

  /* Typography */
  .stat-val{font-size:22px}
  .sh-title{font-size:13px}
  .btn{font-size:12px;padding:7px 12px}
  .btn-sm{padding:4px 9px;font-size:11px}
  .btn-xs{padding:3px 7px;font-size:10px}

  /* Tabs → horizontal scroll */
  .tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;
    flex-wrap:nowrap;scrollbar-width:none}
  .tabs::-webkit-scrollbar{display:none}
  .tab{white-space:nowrap;flex:none;padding:7px 12px;font-size:12px}

  /* Tables → horizontal scroll */
  .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;
    border-radius:var(--r2)}
  table{min-width:500px}
  .hide-mobile{display:none!important}

  /* Calendar — month view */
  .cal-grid{gap:0}
  .cal-day{min-height:48px;padding:3px}
  .cal-evt{font-size:9px;padding:1px 4px}
  .cal-more{font-size:9px}
  .cal-day-num{font-size:11px;width:20px;height:20px}

  /* Calendar — week view */
  .week-grid{grid-template-columns:34px repeat(7,1fr)}
  .week-hdr-row{grid-template-columns:34px repeat(7,1fr)}
  .week-hdr-dayname{font-size:9px}
  .week-hdr-daynum{font-size:14px}
  .week-time-slot{height:44px}
  .week-time-label{font-size:8px}
  .week-scroll{max-height:calc(100vh - 150px);min-height:300px}
  .week-evt-title{font-size:9px}
  .week-evt-time{display:none}

  /* Agenda */
  .agenda-evt{padding:8px 10px;gap:8px}
  .agenda-evt-time{min-width:54px;font-size:10px}
  .agenda-evt-title{font-size:12px}
  .agenda-evt-meta{font-size:10px}

  /* Toast */
  .toast-wrap{left:8px;right:8px;bottom:10px}
  .toast{max-width:100%;font-size:12px}

  /* Section header */
  .sh{flex-wrap:wrap;gap:6px}

  /* Books grid → 2 cols */
  .book-cover{height:90px}
  .book-title{font-size:13px}

  /* Stat card */
  .stat{padding:14px 12px}
  .stat-icon{font-size:18px;margin-bottom:7px}
  .stat-label{font-size:11px}
}

/* ══════════════════════════════════════════════════
   SMALL PHONE  ≤ 400px
══════════════════════════════════════════════════ */
@media(max-width:400px){
  .content{padding:8px}
  .card{padding:12px 10px}
  .topbar{padding:0 8px;height:48px}
  .topbar-title{font-size:12px}
  .ph-title{font-size:16px}
  .stat-val{font-size:20px}
  .hamburger{width:34px;height:34px;font-size:15px}
  .modal{max-height:92vh}
  .btn{font-size:11px;padding:6px 10px}
  .g4{grid-template-columns:1fr 1fr}
  .cal-day{min-height:38px}
  .lp-stats{gap:12px}
  .lp-stat-val{font-size:20px}
}

/* ── AUTH PAGES ── */
@keyframes authFadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes floatOrb{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-18px) scale(1.04)}}
@keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
@keyframes pulseDot{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
@keyframes checkPop{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}

/* ── LANDING PAGE ── */
.lp{min-height:100vh;display:flex;flex-direction:column;background:#0a0a0a;position:relative;overflow-x:hidden;color:#fff}
.lp-orb1{position:absolute;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(249,115,22,.2) 0%,transparent 65%);top:-250px;left:-200px;animation:floatOrb 9s ease-in-out infinite;pointer-events:none}
.lp-orb2{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(249,115,22,.1) 0%,transparent 65%);bottom:-100px;right:-100px;animation:floatOrb 11s ease-in-out infinite reverse;pointer-events:none}
.lp-orb3{position:absolute;width:350px;height:350px;border-radius:50%;background:radial-gradient(circle,rgba(249,115,22,.07) 0%,transparent 65%);top:40%;left:55%;animation:floatOrb 13s ease-in-out infinite;pointer-events:none}
.lp-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(249,115,22,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(249,115,22,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none}
.lp-nav{display:flex;align-items:center;justify-content:space-between;padding:20px 5%;position:sticky;top:0;z-index:100;background:rgba(10,10,10,.85);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.06)}
.lp-nav-links{display:flex;gap:28px;list-style:none;margin:0;padding:0}
.lp-nav-links a{font-size:13px;font-weight:600;color:rgba(255,255,255,.6);text-decoration:none;transition:color .2s}
.lp-nav-links a:hover{color:#f97316}
.lp-logo-box{display:flex;align-items:center;gap:12px}
.lp-logo-badge{width:44px;height:44px;border-radius:12px;background:transparent;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 0 32px rgba(249,115,22,.3)}
.lp-logo-text{font-size:20px;font-weight:900;letter-spacing:-.4px}
.lp-logo-sub{font-size:10px;color:rgba(255,255,255,.4);letter-spacing:.5px;text-transform:uppercase;margin-top:1px}
.lp-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:100px 24px 80px;position:relative;z-index:10;min-height:90vh}
.lp-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 18px;border-radius:99px;border:1px solid rgba(249,115,22,.35);background:rgba(249,115,22,.1);font-size:11px;font-weight:700;color:#f97316;letter-spacing:.8px;text-transform:uppercase;margin-bottom:32px;animation:authFadeUp .6s .1s both}
.lp-badge-dot{width:6px;height:6px;border-radius:50%;background:#f97316;animation:pulseDot 1.5s ease-in-out infinite}
.lp-headline{font-size:clamp(40px,7vw,80px);font-weight:900;letter-spacing:-2.5px;line-height:1.02;margin-bottom:12px;animation:authFadeUp .6s .2s both}
.lp-gradient-text{background:linear-gradient(135deg,#f97316 0%,#fb923c 50%,#fde68a 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 4s linear infinite;background-size:200%}
.lp-tagline{font-size:clamp(16px,2.2vw,21px);color:rgba(255,255,255,.55);font-weight:400;max-width:540px;line-height:1.65;margin-bottom:52px;animation:authFadeUp .6s .3s both}
.lp-cta-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;animation:authFadeUp .6s .4s both;margin-bottom:72px}
.lp-btn-login{display:inline-flex;align-items:center;gap:10px;padding:15px 34px;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;background:transparent;border:1.5px solid rgba(255,255,255,.2);color:#fff;transition:all .2s;font-family:var(--font)}
.lp-btn-login:hover{border-color:#f97316;color:#f97316;background:rgba(249,115,22,.08);transform:translateY(-2px)}
.lp-btn-signup{display:inline-flex;align-items:center;gap:10px;padding:15px 34px;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#f97316,#e05c00);color:#fff;border:none;box-shadow:0 6px 36px rgba(249,115,22,.45);transition:all .25s;font-family:var(--font)}
.lp-btn-signup:hover{transform:translateY(-3px);box-shadow:0 10px 48px rgba(249,115,22,.6)}
.lp-stats{display:flex;align-items:center;gap:40px;padding:36px 48px;border-radius:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);animation:authFadeUp .6s .5s both;flex-wrap:wrap;justify-content:center}
.lp-stat{text-align:center;min-width:80px}
.lp-stat-val{font-size:30px;font-weight:900;letter-spacing:-1px;background:linear-gradient(135deg,#f97316,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.lp-stat-label{font-size:11px;color:rgba(255,255,255,.4);font-weight:500;margin-top:3px;letter-spacing:.3px}
.lp-stat-div{width:1px;height:44px;background:rgba(255,255,255,.1)}
.lp-sec{padding:100px 5%;max-width:1160px;margin:0 auto;width:100%}
.lp-sec-label{font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#f97316;margin-bottom:14px}
.lp-sec-title{font-size:clamp(24px,3.5vw,42px);font-weight:900;line-height:1.15;color:#fff;margin-bottom:0}
.lp-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:28px 24px;transition:all .25s;cursor:default}
.lp-card:hover{transform:translateY(-5px);border-color:rgba(249,115,22,.3);box-shadow:0 16px 48px rgba(249,115,22,.1)}
.lp-divider{width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);margin:0}
.lp-footer{padding:60px 5% 32px;background:#050505;border-top:1px solid rgba(255,255,255,.06);position:relative;z-index:10}
.lp-faq-item{border-bottom:1px solid rgba(255,255,255,.07);padding:20px 0;cursor:pointer}
.lp-faq-q{display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:700;color:#fff;gap:16px}
.lp-faq-a{font-size:13px;color:rgba(255,255,255,.5);line-height:1.75;padding-top:12px;display:none}
.lp-faq-a.open{display:block}
.lp-price-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:36px 28px;transition:all .25s;position:relative;overflow:hidden}
.lp-price-card:hover{transform:translateY(-6px);box-shadow:0 20px 60px rgba(249,115,22,.12)}
.lp-price-card.featured{border-color:rgba(249,115,22,.4);background:rgba(249,115,22,.06);box-shadow:0 0 0 1px rgba(249,115,22,.2),0 24px 64px rgba(249,115,22,.15)}

/* ── SIGN UP PAGE ── */
.su-wrap{min-height:100vh;background:var(--bg);position:relative;overflow:hidden;display:flex;flex-direction:column}
.su-orb1{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(249,115,22,.12) 0%,transparent 70%);top:-150px;right:-100px;pointer-events:none;animation:floatOrb 9s ease-in-out infinite}
.su-orb2{position:absolute;width:350px;height:350px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,.08) 0%,transparent 70%);bottom:-100px;left:-100px;pointer-events:none;animation:floatOrb 11s ease-in-out infinite reverse}
.su-nav{display:flex;align-items:center;justify-content:space-between;padding:20px 40px;border-bottom:1px solid var(--border);position:relative;z-index:10}
.su-body{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:40px 24px 60px;position:relative;z-index:10}
.su-card{width:100%;max-width:600px;background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:40px;box-shadow:0 24px 80px rgba(0,0,0,.4)}
.su-step-bar{display:flex;align-items:center;margin-bottom:36px;padding-bottom:28px}
.su-step-circle{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;transition:all .3s;z-index:1}
.su-step-circle.done{background:var(--accent);color:#fff;box-shadow:0 0 16px rgba(249,115,22,.4)}
.su-step-circle.active{background:var(--accent);color:#fff;box-shadow:0 0 0 4px rgba(249,115,22,.2),0 0 20px rgba(249,115,22,.4)}
.su-step-circle.idle{background:var(--bg3);color:var(--text3);border:2px solid var(--border2)}
.su-section-title{font-size:11px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.su-section-title::after{content:'';flex:1;height:1px;background:var(--border)}
.su-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.su-level-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:4px}
.su-level-btn{padding:8px 4px;border-radius:8px;border:2px solid var(--border2);background:var(--bg3);color:var(--text3);font-size:12px;font-weight:700;cursor:pointer;text-align:center;transition:all .15s;font-family:var(--font)}
.su-level-btn:hover{border-color:var(--accent);color:var(--accent2)}
.su-level-btn.sel{background:rgba(249,115,22,.15);border-color:var(--accent);color:var(--accent2)}
.su-success{text-align:center;padding:20px 0}
.su-success-icon{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,rgba(34,197,94,.2),rgba(34,197,94,.05));border:2px solid rgba(34,197,94,.3);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:36px;animation:checkPop .5s cubic-bezier(.34,1.56,.64,1)}
.su-success-creds{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:16px;margin:20px 0;text-align:left}
.su-back-btn{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text3);cursor:pointer;padding:6px 0;background:none;border:none;font-family:var(--font);transition:color .13s}
.su-back-btn:hover{color:var(--text2)}

@media(max-width:900px){
  .lp-nav{padding:16px 20px}
  .lp-stats{flex-wrap:wrap;gap:20px;justify-content:center}
  .su-nav{padding:16px 20px}
  .su-card{padding:24px 16px}
  .su-field-grid{grid-template-columns:1fr}
  .su-level-grid{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:500px){
  .lp-nav{padding:12px 16px}
  .lp-hero{padding:24px 16px}
  .lp-headline{font-size:32px;letter-spacing:-1px}
  .lp-tagline{font-size:14px;margin-bottom:32px}
  .lp-cta-row{flex-direction:column;width:100%;gap:10px}
  .lp-btn-login,.lp-btn-signup{width:100%;justify-content:center;padding:14px 20px}
  .lp-stats{gap:16px;margin-top:36px;padding-top:28px}
  .lp-stat-val{font-size:22px}
  .lp-footer{padding:16px}
  .su-nav{padding:12px 16px}
  .su-body{padding:20px 12px 40px}
  .su-card{padding:20px 14px;border-radius:14px}
  .su-level-grid{grid-template-columns:repeat(3,1fr)}
}

  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;

// ─── TINY COMPONENTS ──────────────────────────────────────────────────────────
function Av({ name, sz = "av-md", color }) {
  const c = color ?? getAvatarColor(name);
  return <div className={`av ${sz}`} style={{ background: `${c}28`, color: c, borderColor: `${c}35` }}>{getInitials(name)}</div>;
}

function Badge({ status, label }) {
  const c = statusColor[status] ?? "#6b7280";
  return <span className="badge" style={{ background: `${c}18`, color: c }}><span className="bdot" style={{ background: c }} />{label ?? status}</span>;
}

function Modal({ open, onClose, title, children, lg, xl }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${lg ? "modal-lg" : ""} ${xl ? "modal-xl" : ""}`}>
        <div className="mhead">
          <div className="mtitle">{title}</div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BarChart({ data, h = 110 }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <div className="bar-chart" style={{ height: h, alignItems: "flex-end" }}>
      {data.map((d, i) => (
        <div key={i} className="bc-item">
          <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 600 }}>
            {d.v > 999 ? `${(d.v / 1000).toFixed(1)}k MAD` : d.v || ""}
          </div>
          <div className="bc-bar" style={{ height: `${Math.max(4, (d.v / max) * (h - 24))}px`, background: d.c ?? "var(--accent)" }} />
          <div className="bc-label">{d.l}</div>
        </div>
      ))}
    </div>
  );
}

// ─── MEETING LINK COMPONENTS ──────────────────────────────────────────────────
function MeetingLinkInput({ value, onChange, label = "Meeting Link" }) {
  const [urlError, setUrlError] = useState("");
  const platform = detectPlatform(value);

  const handleChange = (v) => {
    onChange(v);
    if (v && !isValidUrl(v)) setUrlError("Please enter a valid URL (https://…)");
    else setUrlError("");
  };

  const copyLink = () => {
    navigator.clipboard.writeText(value).then(() => toast("Link copied!")).catch(() => toast("Copy failed", "error"));
  };

  return (
    <div className="online-box">
      <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 10 }}>🔗 {label}</div>
      <div className="link-input-wrap">
        <input
          value={value}
          onChange={e => handleChange(e.target.value)}
          placeholder="https://meet.google.com/abc-defg-hij"
          style={{ paddingRight: value ? 88 : 12 }}
        />
        {value && isValidUrl(value) && (
          <div className="link-input-actions">
            <button className="link-action-btn" onClick={copyLink} title="Copy link">📋</button>
            <button className="link-action-btn" onClick={() => window.open(value, "_blank")} title="Open link">↗</button>
          </div>
        )}
      </div>
      {urlError && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>{urlError}</div>}
      {platform && isValidUrl(value) && (
        <div className="platform-chip" style={{ background: `${platform.color}15`, color: platform.color, border: `1px solid ${platform.color}30` }}>
          {platform.icon} {platform.name} detected
        </div>
      )}
    </div>
  );
}

function JoinButton({ session, seriesList, userRole, userId }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const link = getMeetingLink(session, seriesList);
  if (!link || !isValidUrl(link)) return null;

  // Visibility: only teacher of this session, students in the group, or admin
  const isTeacher = userRole === "teacher" && session.teacherId === userId;
  const isStudent = userRole === "student";
  const isAdmin = userRole === "admin";
  if (!isTeacher && !isStudent && !isAdmin) return null;

  const platform = detectPlatform(link);
  const minsUntil = minutesUntilSession(session.date, session.time);
  const sessionStarted = minsUntil <= 0;
  const sessionEnded = session.status === "completed" || session.isCancelled;
  // Students: button enabled 30 min before, teachers/admin: always enabled
  const canJoin = isTeacher || isAdmin || minsUntil <= 30;

  return (
    <div className="join-btn-wrap">
      <div className="flex ac jb mb8">
        <div className="flex ac gap8">
          {platform && <span style={{ fontSize: 13 }}>{platform.icon}</span>}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{platform?.name ?? "Virtual Class"}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>
              {sessionEnded ? "Session ended" : sessionStarted ? "Session in progress" : minsUntil < 60 ? `Starts in ${minsUntil} min` : `Starts at ${session.time}`}
            </div>
          </div>
        </div>
        <div className="flex gap6">
          <button className="link-action-btn" onClick={() => { navigator.clipboard.writeText(link); toast("Link copied!"); }}>📋 Copy</button>
        </div>
      </div>

      <button
        className="join-btn"
        disabled={sessionEnded || !canJoin}
        onClick={() => window.open(link, "_blank")}
        style={!canJoin ? {} : { background: sessionStarted ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#22c55e,#16a34a)" }}
      >
        {sessionEnded ? "🔒 Session Ended" : sessionStarted ? "🎥 Join Live Class" : "🎥 Join Class"}
      </button>

      {isStudent && !canJoin && minsUntil > 0 && (
        <div className="countdown-row">
          Link available <span className="countdown-num">{minsUntil > 60 ? `${Math.floor(minsUntil / 60)}h ${minsUntil % 60}m` : `${minsUntil}m`}</span> before class starts
        </div>
      )}
    </div>
  );
}

// ─── RECURRING SESSION CREATOR ────────────────────────────────────────────────
function RecurringSessionForm({ groups, teachers, onSave, onClose, defaultTeacherId }) {
  const [type, setType] = useState("recurring");
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState(groups.length === 1 ? String(groups[0].id) : "");
  const [teacherId, setTeacherId] = useState(defaultTeacherId ? String(defaultTeacherId) : (teachers.length === 1 ? String(teachers[0].id) : ""));
  const [startDate, setStartDate] = useState("2025-02-27");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:30");
  const [duration, setDuration] = useState(90);
  const [selectedDays, setSelectedDays] = useState([]);
  const [endType, setEndType] = useState("date");
  const [endDate, setEndDate] = useState("2025-06-30");
  const [repeatWeeks, setRepeatWeeks] = useState(12);
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState(null);
  const [sessionMode, setSessionMode] = useState("offline"); // offline | online
  const [meetingLink, setMeetingLink] = useState("");
  const [linkError, setLinkError] = useState("");

  const toggleDay = (d) => setSelectedDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  const calcPreview = () => {
    if (!startDate || selectedDays.length === 0) return;
    const config = { title: title || "Session", groupId: groupId, teacherId: teacherId, startDate, startTime, endTime, duration, recurringDays: selectedDays, endType, endDate, repeatWeeks, seriesId: "preview" };
    const sess = generateRecurringSessions(config, []);
    setPreview(sess);
  };

  const handleSave = () => {
    if (!title) { toast("Session title required", "error"); return; }
    if (!groupId) { toast("Please select a group", "error"); return; }
    if (!teacherId) { toast("Please select a teacher", "error"); return; }
    if (type === "recurring" && selectedDays.length === 0) { toast("Select at least one recurring day", "error"); return; }
    if (!startDate) { toast("Start date required", "error"); return; }
    if (sessionMode === "online" && meetingLink && !isValidUrl(meetingLink)) { toast("Please enter a valid meeting URL", "error"); return; }

    const modeFields = { sessionMode, mode: sessionMode, meetingLink: sessionMode === "online" ? meetingLink : null };

    if (type === "one-time") {
      onSave([{ id: Date.now() + Math.random(), title, groupId: groupId, teacherId: teacherId, date: startDate, startTime: startTime, endTime, duration, status: "upcoming", notes, attendance: {}, isCancelled: false, seriesId: null, ...modeFields }], null);
    } else {
      const seriesId = "series-" + Date.now();
      const config = { title, groupId: groupId, teacherId: teacherId, startDate, startTime, endTime, duration, recurringDays: selectedDays, endType, endDate, repeatWeeks, seriesId };
      const group = groups.find(g => g.id === groupId);
      const generated = generateRecurringSessions(config, []).map(s => ({ ...s, ...modeFields }));
      const seriesMeta = { id: seriesId, title, groupId: groupId, teacherId: teacherId, startDate, startTime, endTime, duration, recurringDays: selectedDays, endType, endDate, repeatWeeks, paused: false, notes, ...modeFields };
      onSave(generated, seriesMeta);
    }
  };

  return (
    <div>
      {/* Session Type */}
      <div className="fg">
        <label>Session Type</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["one-time", "recurring"].map(t => (
            <button key={t} className={`btn btn-sm ${type === t ? "btn-pr" : "btn-se"}`} onClick={() => setType(t)}>
              {t === "one-time" ? "🗓 One-time" : "🔁 Recurring"}
            </button>
          ))}
        </div>
      </div>

      {/* Session Mode */}
      <div className="fg">
        <label>Session Mode</label>
        <div className="mode-toggle">
          <div className={`mode-btn ${sessionMode === "offline" ? "sel-offline" : ""}`} onClick={() => setSessionMode("offline")}>
            🏫 <span>Offline</span>
          </div>
          <div className={`mode-btn ${sessionMode === "online" ? "sel-online" : ""}`} onClick={() => setSessionMode("online")}>
            💻 <span>Online</span>
          </div>
        </div>
      </div>

      {/* Meeting Link (online only) */}
      {sessionMode === "online" && (
        <MeetingLinkInput value={meetingLink} onChange={setMeetingLink} label="Meeting Link (Google Meet / Zoom / Teams)" />
      )}

      <div className="fg">
        <label>Session Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Grammar & Speaking" />
      </div>

      <div className="input-row">
        <div className="fg">
          <label>Group *</label>
          <select value={groupId} onChange={e => {
            setGroupId(e.target.value);
            const g = groups.find(g => g.id === e.target.value);
            if (g) setTeacherId(String(g.teacherId));
          }}>
            <option value="">Select group…</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="fg">
          <label>Teacher *</label>
          {defaultTeacherId
            ? <div style={{ padding: "9px 12px", background: "var(--bg3)", borderRadius: 9, fontSize: 13, color: "var(--text2)", border: "1px solid var(--border)" }}>
                👨‍🏫 {teachers[0]?.name ?? "You"} <span style={{ fontSize: 11, color: "var(--text3)" }}>(auto-assigned)</span>
              </div>
            : <select value={teacherId} onChange={e => setTeacherId(e.target.value)}>
                <option value="">Select teacher…</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
          }
        </div>
      </div>

      <div className="input-row">
        <div className="fg">
          <label>Start Date *</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="fg">
          <label>Duration (min)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)} />
        </div>
      </div>

      <div className="input-row">
        <div className="fg">
          <label>Start Time</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
        <div className="fg">
          <label>End Time</label>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
      </div>

      {type === "recurring" && (
        <div className="rec-box">
          {/* Days */}
          <div className="rec-section">
            <div className="rec-label">🗓 Recurring Days</div>
            <div className="day-grid">
              {DAYS.map((day, i) => (
                <div key={i} className={`day-pill ${selectedDays.includes(i) ? "sel" : ""}`} onClick={() => toggleDay(i)}>
                  {DAY_SHORT[i]}
                </div>
              ))}
            </div>
            {selectedDays.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
                ✓ {selectedDays.sort().map(d => DAYS[d]).join(" · ")}
              </div>
            )}
          </div>

          {/* End condition */}
          <div className="rec-section">
            <div className="rec-label">📆 Repeat Until</div>
            <select value={endType} onChange={e => setEndType(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="date">Specific End Date</option>
              <option value="weeks">Number of Weeks</option>
              <option value="academic_year">Full Academic Year</option>
              <option value="indefinite">Indefinitely (1 year max)</option>
            </select>

            {endType === "date" && (
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            )}
            {endType === "weeks" && (
              <div className="flex ac gap8">
                <input type="number" min="1" max="52" value={repeatWeeks} onChange={e => setRepeatWeeks(e.target.value)} style={{ width: 80 }} />
                <span style={{ fontSize: 13, color: "var(--text2)" }}>weeks</span>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="flex ac gap8">
            <button className="btn btn-se btn-sm" onClick={calcPreview}>👁 Preview Sessions</button>
            {preview && (
              <span style={{ fontSize: 12, color: "var(--accent2)", fontWeight: 600 }}>
                → {preview.length} sessions will be created
              </span>
            )}
          </div>

          {preview && preview.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 140, overflowY: "auto", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
              {preview.slice(0, 8).map((s, i) => (
                <div key={i} style={{ padding: "6px 12px", fontSize: 11, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", color: "var(--text2)" }}>
                  <span>{DAYS[new Date(s.date).getDay()].slice(0,3)}, {s.date}</span>
                  <span>{s.time} – {endTime}</span>
                </div>
              ))}
              {preview.length > 8 && (
                <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--text3)", textAlign: "center" }}>
                  +{preview.length - 8} more sessions…
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="fg mt12">
        <label>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Session agenda, materials needed…" />
      </div>

      <div className="flex gap8 mt12">
        <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={onClose}>Cancel</button>
        <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={handleSave}>
          {type === "recurring" ? "🔁 Create Recurring Series" : "📅 Schedule Session"}
        </button>
      </div>
    </div>
  );
}

// ─── EDIT SCOPE PICKER ────────────────────────────────────────────────────────
function EditScopePicker({ open, onClose, onSelect, isSeries }) {
  const [scope, setScope] = useState("this");
  if (!open) return null;
  const options = [
    { id: "this", title: "This session only", desc: "Only changes this single occurrence" },
    { id: "future", title: "This and future sessions", desc: "Updates this session and all following sessions in the series" },
    { id: "all", title: "All sessions in series", desc: "Updates every session in this recurring series" },
  ];
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="mhead">
          <div className="mtitle">Edit Recurring Session</div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>This is a recurring session. How would you like to edit it?</p>
        {options.map(o => (
          <div key={o.id} className={`scope-option ${scope === o.id ? "sel" : ""}`} onClick={() => setScope(o.id)}>
            <div className={`scope-radio ${scope === o.id ? "sel" : ""}`} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{o.title}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{o.desc}</div>
            </div>
          </div>
        ))}
        <div className="flex gap8 mt16">
          <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={onClose}>Cancel</button>
          <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={() => onSelect(scope)}>Continue</button>
        </div>
      </div>
    </div>
  );
}

// ─── SERIES MANAGEMENT PAGE ───────────────────────────────────────────────────
function SeriesManager({ data, setData, filteredSeries }) {
  const [showEdit, setShowEdit] = useState(null);
  const seriesToShow = filteredSeries ?? data.series;

  const pauseSeries = (seriesId) => {
    setData(d => ({
      ...d,
      series: d.series.map(s => s.id === seriesId ? { ...s, paused: !s.paused } : s),
      sessions: d.sessions.map(s => {
        if (s.seriesId !== seriesId) return s;
        const today = new Date().toISOString().split("T")[0];
        if (s.date <= today || s.status !== "upcoming") return s;
        const ser = d.series.find(x => x.id === seriesId);
        return { ...s, status: ser?.paused ? "upcoming" : "cancelled", isCancelled: !ser?.paused };
      })
    }));
    toast("Series updated");
  };

  const deleteSeries = async (seriesId, scope, fromDate) => {
    try {
      if (scope === "all") await api.series.delete(seriesId);
      // Delete affected sessions from DB
      const affectedSessions = data.sessions.filter(s => {
        if (s.seriesId !== seriesId) return false;
        if (scope === "all") return true;
        if (scope === "future" && fromDate) return s.date >= fromDate;
        return false;
      });
      await Promise.all(affectedSessions.map(s => api.sessions.delete(s.id).catch(()=>{})));
    } catch(e) { console.error("deleteSeries API error", e); }
    setData(d => ({
      ...d,
      series: scope === "all" ? d.series.filter(s => s.id !== seriesId) : d.series,
      sessions: d.sessions.filter(s => {
        if (s.seriesId !== seriesId) return true;
        if (scope === "all") return false;
        if (scope === "future" && fromDate) return s.date < fromDate;
        return true;
      })
    }));
    toast("Series deleted");
  };

  return (
    <div>
      <div className="sh mb8"><div className="sh-title">Recurring Series ({seriesToShow.length}{filteredSeries && filteredSeries.length !== data.series.length ? ` of ${data.series.length}` : ""})</div></div>
      {seriesToShow.map(ser => {
        const sessions = data.sessions.filter(s => s.seriesId === ser.id);
        const completed = sessions.filter(s => s.status === "completed").length;
        const upcoming = sessions.filter(s => s.status === "upcoming").length;
        const group = data.groups.find(g => g.id === ser.groupId);
        const teacher = data.users.find(u => u.id === ser.teacherId);

        return (
          <div key={ser.id} className="card mb8" style={{ borderLeft: `3px solid ${ser.paused ? "var(--amber)" : "var(--accent)"}` }}>
            <div className="flex ac jb gap8" style={{ flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div className="flex ac gap8 mb4">
                  <span className="fw7" style={{ fontSize: 14 }}>{ser.title}</span>
                  {ser.paused && <Badge status="paused" label="⏸ Paused" />}
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  {group?.name} · {teacher?.name} · {ser.recurringDays?.map(d => DAY_SHORT[d]).join("/")} · {ser.startTime}–{ser.endTime}
                  {ser.sessionMode === "online" && <span style={{ marginLeft: 6, color: "#22c55e" }}>· 💻 Online</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "var(--mono)" }}>
                  {ser.startDate} → {ser.endDate ?? "ongoing"} · {sessions.length} sessions · {completed} done · {upcoming} upcoming
                  {ser.meetingLink && isValidUrl(ser.meetingLink) && <span style={{ marginLeft: 6, color: "#22c55e" }}>· {detectPlatform(ser.meetingLink)?.name ?? "Meeting link set"}</span>}
                </div>
              </div>
              <div className="flex gap8">
                <button className={`btn btn-sm ${ser.paused ? "btn-pr" : "btn-wa"}`} onClick={() => pauseSeries(ser.id)}>
                  {ser.paused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button className="btn btn-da btn-sm" onClick={() => deleteSeries(ser.id, "all")}>🗑 Delete</button>
              </div>
            </div>
            <div className="prog mt8">
              <div className="prog-fill" style={{ width: `${sessions.length ? (completed / sessions.length) * 100 : 0}%`, background: "var(--green)" }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
              Progress: {completed}/{sessions.length} sessions completed
            </div>
          </div>
        );
      })}
      {data.series.length === 0 && (
        <div className="empty"><div className="empty-icon">🔁</div><div className="empty-title">No recurring series yet</div></div>
      )}
    </div>
  );
}

// ─── PDF VIEWER ───────────────────────────────────────────────────────────────
function PdfViewer({ file, onClose }) {
  const [zoom,         setZoom]         = useState(100);
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [pdfDoc,       setPdfDoc]       = useState(null);
  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);
  const renderRef  = useRef(null); // track ongoing render task

  if (!file) return null;

  const url  = file.dataUrl || '';
  const name = file.name || 'file';
  const isPdf = file.type === 'application/pdf'
    || url.toLowerCase().includes('.pdf')
    || url.includes('/raw/upload/');
  const isImage = file.type?.startsWith('image/')
    || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);

  // Build best fetch URL for Cloudinary PDFs
  // Switch resource_type raw -> image so Cloudinary serves with correct MIME
  const buildFetchUrl = (rawUrl) => {
    if (!rawUrl) return rawUrl;
    if (rawUrl.includes('res.cloudinary.com')) {
      // raw/upload → image/upload so browser gets content-type: application/pdf
      let u = rawUrl.replace('/raw/upload/', '/image/upload/');
      // Add fl_attachment:false so it doesn't force download
      u = u.replace('/image/upload/', '/image/upload/fl_attachment:false/');
      return u;
    }
    return rawUrl;
  };
  const fetchUrl = buildFetchUrl(url);

  // ── PDF.js rendering via CDN ───────────────────────────────────────────────
  useEffect(() => {
    if (!isPdf || !url) return;
    setLoading(true); setError(null); setPdfDoc(null); setPage(1); setTotalPages(null);

    const loadPdf = async () => {
      try {
        // Load PDF.js from CDN if not already loaded
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Fetch PDF as ArrayBuffer to bypass CORS on Cloudinary raw URLs
        const resp = await fetch(fetchUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error(`Failed to load PDF (${resp.status})`);
        const buffer = await resp.arrayBuffer();

        const doc = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setLoading(false);
      } catch(e) {
        console.error('PDF load error:', e);
        setError(e.message);
        setLoading(false);
      }
    };
    loadPdf();
  }, [url]);

  // ── Render current page onto canvas ───────────────────────────────────────
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !isPdf) return;
    const renderPage = async () => {
      try {
        // Cancel previous render
        if (renderRef.current) { try { renderRef.current.cancel(); } catch(_){} }
        const pg    = await pdfDoc.getPage(page);
        const scale = zoom / 100 * window.devicePixelRatio;
        const vp    = pg.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.height = vp.height;
        canvas.width  = vp.width;
        canvas.style.width  = (vp.width  / window.devicePixelRatio) + 'px';
        canvas.style.height = (vp.height / window.devicePixelRatio) + 'px';
        const ctx = canvas.getContext('2d');
        const task = pg.render({ canvasContext: ctx, viewport: vp });
        renderRef.current = task;
        await task.promise;
      } catch(e) {
        if (e?.name !== 'RenderingCancelledException') console.error('Render error:', e);
      }
    };
    renderPage();
  }, [pdfDoc, page, zoom]);

  const toggleFullscreen = () => {
    const el = overlayRef.current;
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && page < totalPages) setPage(p => p + 1);
      if (e.key === 'ArrowLeft'  && page > 1)          setPage(p => p - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, totalPages]);

  return (
    <div ref={overlayRef} className="pdf-viewer-overlay" onClick={e => e.target === e.currentTarget && onClose()}
      style={{ display:'flex', flexDirection:'column' }}>

      {/* ── Top bar ── */}
      <div className="pdf-viewer-bar" style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px',
        background:'var(--bg1)', borderBottom:'1px solid var(--border)', flexShrink:0, flexWrap:'wrap' }}>

        {/* File info */}
        <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
          <div style={{ width:34, height:34, borderRadius:8, flexShrink:0,
            background: isPdf ? 'rgba(239,68,68,.15)' : 'rgba(99,102,241,.15)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>
            {isPdf ? '📄' : isImage ? '🖼' : '📎'}
          </div>
          <div style={{ minWidth:0 }}>
            <div className="fw7" style={{ fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:280 }}>{name}</div>
            <div className="text-xs muted">{isPdf ? `PDF · ${totalPages ? totalPages+' pages' : 'Loading...'}` : isImage ? 'Image' : 'Document'}</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          {/* Page nav */}
          {isPdf && totalPages && (
            <div style={{ display:'flex', alignItems:'center', gap:4, background:'var(--bg3)', borderRadius:8, padding:'4px 8px' }}>
              <button className="btn btn-se btn-xs" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page<=1}>◀</button>
              <span className="text-xs mono" style={{ color:'var(--text2)', minWidth:56, textAlign:'center' }}>{page} / {totalPages}</span>
              <button className="btn btn-se btn-xs" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page>=totalPages}>▶</button>
            </div>
          )}
          {/* Zoom */}
          {isPdf && (
            <div style={{ display:'flex', alignItems:'center', gap:4, background:'var(--bg3)', borderRadius:8, padding:'4px 8px' }}>
              <button className="btn btn-se btn-xs" onClick={() => setZoom(z => Math.max(50, z-25))}>−</button>
              <span className="text-xs mono" style={{ color:'var(--text2)', minWidth:38, textAlign:'center' }}>{zoom}%</span>
              <button className="btn btn-se btn-xs" onClick={() => setZoom(z => Math.min(250, z+25))}>+</button>
              <button className="btn btn-se btn-xs" onClick={() => setZoom(100)} style={{ fontSize:9 }}>FIT</button>
            </div>
          )}
          <button className="btn btn-se btn-sm" onClick={toggleFullscreen} title="Fullscreen">{isFullscreen ? '⊡' : '⛶'}</button>
          {url && (
            <button className="btn btn-pr btn-sm" onClick={() => downloadFile(url, name)}>📥 Download</button>
          )}
          <button className="btn btn-se btn-sm" onClick={onClose} style={{ fontWeight:700 }}>✕ Close</button>
        </div>
      </div>

      {/* ── Content area ── */}
      <div style={{ flex:1, overflow:'auto', display:'flex', alignItems:'flex-start', justifyContent:'center',
        padding:'20px', background:'var(--bg0, #111)' }}>

        {/* Loading */}
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            gap:12, marginTop:80, color:'var(--text3)' }}>
            <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--accent)',
              borderRadius:'50%', animation:'spin 1s linear infinite' }} />
            <div className="text-sm">Loading PDF…</div>
          </div>
        )}

        {/* Error state with Google Docs fallback */}
        {!loading && error && isPdf && (
          <div style={{ width:'100%', maxWidth:700, display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ padding:'14px 16px', borderRadius:10, background:'rgba(239,68,68,.08)',
              border:'1px solid rgba(239,68,68,.2)', color:'var(--red)', fontSize:13 }}>
              ⚠ Could not render PDF directly. Using fallback viewer.
            </div>
            <iframe
              src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
              style={{ width:'100%', height:'70vh', border:'none', borderRadius:10 }}
              title={name}
            />
          </div>
        )}

        {/* PDF Canvas */}
        {!loading && !error && isPdf && (
          <div style={{ boxShadow:'0 8px 40px rgba(0,0,0,.6)', borderRadius:4, background:'white', lineHeight:0 }}>
            <canvas ref={canvasRef} style={{ display:'block', borderRadius:4 }} />
          </div>
        )}

        {/* Image */}
        {isImage && (
          <img src={url} alt={name} style={{
            maxWidth:'100%', maxHeight:'85vh', borderRadius:8, objectFit:'contain',
            transform:`scale(${zoom/100})`, transformOrigin:'top center', transition:'transform .2s',
            boxShadow:'0 8px 40px rgba(0,0,0,.5)',
          }} />
        )}
      </div>
    </div>
  );
}

// Uploads a file to the backend and returns the Cloudinary URL/publicId
async function storeFile(file, bookId, lessonId) {
  if (bookId) {
    const result = await api.books.uploadPDF(bookId, file);
    return result.fileId || result.fileUrl || result.publicId || '';
  }
  if (lessonId) {
    const result = await api.lessons.uploadFile(lessonId, file);
    return result.fileId || result.fileUrl || result.publicId || '';
  }
  throw new Error('No bookId or lessonId provided');
}

function FileUploadWidget({ label, onFileStored, accept = ".pdf,.doc,.docx,.ppt,.pptx,.jpg,.png", bookId, lessonId }) {
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true); setPct(0);
    const timer = setInterval(() => setPct(p => Math.min(p+8, 88)), 600);
    try {
      const id = await storeFile(file, bookId, lessonId);
      clearInterval(timer); setPct(100);
      if (id) { onFileStored(id, file.name, file); toast(`📎 "${file.name}" uploaded`); }
    } catch(e) {
      clearInterval(timer); toast("Upload failed","error");
    } finally { setUploading(false); setPct(0); }
  };

  return (
    <label className="upload-zone" style={{ display: "block" }}>
      <input type="file" accept={accept} onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} />
      {uploading
        ? <div style={{textAlign:"center",padding:"12px 0"}}>
            <div style={{fontSize:13,color:"var(--text2)",marginBottom:8}}>Uploading… {pct}%</div>
            <div style={{background:"var(--bg3)",borderRadius:99,height:6,overflow:"hidden"}}>
              <div style={{background:"var(--accent)",height:"100%",width:`${pct}%`,transition:"width 0.4s ease",borderRadius:99}}/>
            </div>
          </div>
        : <div>
            <div style={{ fontSize: 22, marginBottom: 6 }}>📎</div>
            <div className="text-sm fw7" style={{ color: "var(--accent2)" }}>{label ?? "Click to upload file"}</div>
            <div className="text-xs muted mt4">PDF, Word, PowerPoint, Images</div>
          </div>
      }
    </label>
  );
}

// ─── GET FILE HELPER ─────────────────────────────────────────────────────────
// Returns a file-like object for display. fileId can be a Cloudinary public_id or URL.
function getFile(fileId) {
  if (!fileId) return null;
  const isUrl = typeof fileId === 'string' && (fileId.startsWith('http') || fileId.startsWith('blob'));
  const cloud = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'eloc-international';
  const rawUrl = isUrl ? fileId : `https://res.cloudinary.com/${cloud}/raw/upload/${fileId}`;
  const name = typeof fileId === 'string' ? fileId.split('/').pop()?.split('?')[0] || 'file' : 'file';
  const ext = name.split('.').pop()?.toLowerCase();
  const isPdf = ext === 'pdf' || rawUrl.toLowerCase().includes('.pdf');
  // For PDFs served from Cloudinary, use the backend proxy so correct Content-Type is returned
  const BASE_API = import.meta.env?.VITE_API_URL || 'https://eloc-backend.onrender.com/api';
  const dataUrl = isPdf && rawUrl.includes('cloudinary.com')
    ? `${BASE_API}/api/lessons/proxy?url=${encodeURIComponent(rawUrl)}`
    : rawUrl;
  return { id: fileId, dataUrl, name, type: isPdf ? 'application/pdf' : undefined, rawUrl };
}

// Cross-origin safe download: route through backend proxy for Cloudinary, or direct fetch

async function downloadFile(url, filename) {
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
  } catch(e) {
    window.open(url, '_blank');
  }
}
// ─── FILE ROW COMPONENT ───────────────────────────────────────────────────────
function FileRow({ fileId, label, onPreview, onRemove, canRemove }) {
  const file = getFile(fileId);
  const name = file?.name ?? label ?? "Attached file";
  const ext = name.split(".").pop()?.toLowerCase();
  const iconMap = { pdf: "📄", doc: "📝", docx: "📝", ppt: "📊", pptx: "📊", jpg: "🖼", jpeg: "🖼", png: "🖼" };
  const icon = iconMap[ext] ?? "📎";

  return (
    <div className="file-row">
      <div className="file-icon" style={{ background: "var(--glow)", color: "var(--accent2)" }}>{icon}</div>
      <div className="file-name">{name}</div>
      {file?.size && <div className="file-size">{(file.size / 1024).toFixed(0)} KB</div>}
      <div className="flex gap6">
        {file && <button className="btn btn-se btn-xs" onClick={() => onPreview(file)}>👁 Preview</button>}
        {file
          ? (
            <button className="btn btn-pr btn-xs" onClick={() => downloadFile(file.dataUrl, name)}>📥 Download</button>
          ) : (
            <span style={{ fontSize:11, color:"var(--text3)", fontStyle:"italic" }}>Not uploaded yet</span>
          )
        }
        {canRemove && onRemove && <button className="btn btn-da btn-xs" onClick={onRemove}>✕</button>}
      </div>
    </div>
  );
}

// ─── LESSON CONTENT PANEL ─────────────────────────────────────────────────────
// Used inside session detail – teacher & admin can edit, students can only view
function LessonPanel({ session, data, setData, userRole, userId }) {
  const [editing, setEditing] = useState(false);
  const [pdfViewer, setPdfViewer] = useState(null);

  // Find lesson: first look for session-specific, then series-level
  const lesson = data.lessons.find(l => l.sessionId === session.id)
    ?? (session.seriesId ? data.lessons.find(l => l.seriesId === session.seriesId && !l.sessionId) : null);

  const isTeacher = userRole === "teacher" && session.teacherId === userId;
  const canEdit = userRole === "admin" || isTeacher;

  const [form, setForm] = useState({
    bookId: lesson?.bookId ?? "",
    chapterId: lesson?.chapterId ?? "",
    title: lesson?.title ?? "",
    description: lesson?.description ?? "",
    fileId: lesson?.fileId ?? null,
    extraFiles: lesson?.extraFiles ?? [],
    homework: lesson?.homework ?? "",
    homeworkDue: lesson?.homeworkDue ?? "",
    teacherNotes: lesson?.teacherNotes ?? "",
  });

  const book = data.books.find(b => b.id === form.bookId || b.id === String(form.bookId));
  const chapter = book?.chapters.find(c => c.id === form.chapterId || c.id === String(form.chapterId));

  const saveLesson = async () => {
    const lessonData = {
      sessionId: session.id,
      seriesId: lesson?.sessionId ? null : session.seriesId,
      bookId: form.bookId || null,
      chapterId: form.chapterId || null,
      title: form.title,
      description: form.description,
      fileId: form.fileId,
      extraFiles: form.extraFiles,
      homework: form.homework,
      homeworkDue: form.homeworkDue,
      teacherNotes: form.teacherNotes,
      createdBy: userId,
    };
    try {
      if (lesson?.id) {
        const updated = await api.lessons.update(lesson.id, lessonData);
        const clean = deepClean(updated);
        setData(d => ({ ...d, lessons: d.lessons.map(l => l.id === lesson.id ? clean : l) }));
      } else {
        // For new lessons: skip blob fileId (can't upload without lesson ID yet)
        const dataToCreate = { ...lessonData };
        const pendingFile = form._pendingFile; // raw File object if any
        if (form.fileId && form.fileId.startsWith('blob:')) delete dataToCreate.fileId;
        const created = await api.lessons.create(dataToCreate);
        const clean = deepClean(created);
        setData(d => ({ ...d, lessons: [...d.lessons, clean] }));
        // If there's a pending file, upload it now that we have the lesson ID
        if (pendingFile) {
          try {
            const r = await api.lessons.uploadFile(clean.id, pendingFile);
            const url = r?.fileId || r?.fileUrl || '';
            if (url) {
              await api.lessons.update(clean.id, { fileId: url });
              setData(d => ({ ...d, lessons: d.lessons.map(l => l.id === clean.id ? { ...l, fileId: url } : l) }));
            }
          } catch(e) { toast('Lesson saved but file upload failed - try uploading again', 'warn'); }
        }
      }
      toast("Lesson content saved ✓");
      setEditing(false);
    } catch(e) { toast(e.message || "Failed to save lesson", "error"); }
  };

  const handleMainFile = async (fileId, name, rawFile) => setForm(p => ({ ...p, fileId, _pendingFile: rawFile || p._pendingFile }));
  const handleExtraFile = async (fileId, name) => setForm(p => ({ ...p, extraFiles: [...p.extraFiles, fileId] }));
  const removeExtraFile = (fid) => setForm(p => ({ ...p, extraFiles: p.extraFiles.filter(x => x !== fid) }));

  // Read-only view (students or non-editing)
  if (!editing || !canEdit) {
    if (!lesson && !canEdit) return (
      <div className="empty" style={{ padding: "20px 0" }}>
        <div className="empty-icon" style={{ fontSize: 28 }}>📚</div>
        <div className="empty-title">No lesson content yet</div>
      </div>
    );

    return (
      <div>
        {canEdit && !lesson && (
          <button className="btn btn-pr btn-sm mb12" onClick={() => setEditing(true)}>+ Add Lesson Content</button>
        )}
        {lesson && (
          <>
            {/* Book & Chapter */}
            {(lesson.bookId || lesson.title) && (
              <div className="lesson-box">
                <div className="lesson-box-title">📚 Lesson Content</div>
                {lesson.title && <div className="fw7 mb4" style={{ fontSize: 15 }}>{lesson.title}</div>}
                {lesson.description && <div className="text-sm muted mb10">{lesson.description}</div>}
                {book && (
                  <div className="flex ac gap10 mb10" style={{ background: "var(--bg3)", borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: (book.coverColor && book.coverColor !== "") ? book.coverColor : "#f97316", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>📖</div>
                    <div>
                      <div className="fw7 text-sm">{book.title}</div>
                      <div className="text-xs muted">{chapter ? chapter.title : `Level ${book.level}`}</div>
                    </div>
                    <Badge status="active" label={book.level} />
                  </div>
                )}
                {lesson.fileId && (
                  <FileRow fileId={lesson.fileId} label="Lesson PDF" onPreview={f => setPdfViewer(f)} canRemove={false} />
                )}
                {lesson.extraFiles?.length > 0 && (
                  <div className="mt8">
                    <div className="text-xs muted mb6">Additional Materials</div>
                    {lesson.extraFiles.map(fid => (
                      <FileRow key={fid} fileId={fid} onPreview={f => setPdfViewer(f)} canRemove={false} />
                    ))}
                  </div>
                )}
                {canEdit && (
                  <button className="btn btn-se btn-sm mt12" onClick={() => setEditing(true)}>✏️ Edit Lesson</button>
                )}
              </div>
            )}

            {/* Homework */}
            {lesson.homework && (
              <div className="hw-box">
                <div className="hw-box-title">📝 Homework</div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>{lesson.homework}</div>
                {lesson.homeworkDue && (
                  <div className="flex ac gap6">
                    <span className="text-xs muted">Due:</span>
                    <span className="mono fw7 text-xs" style={{ color: "var(--amber)" }}>{lesson.homeworkDue}</span>
                  </div>
                )}
              </div>
            )}

            {/* Teacher notes (only for teacher/admin) */}
            {canEdit && lesson.teacherNotes && (
              <div style={{ borderRadius: 10, border: "1px solid var(--border)", padding: 12, background: "var(--bg3)" }}>
                <div className="text-xs muted mb4">🔒 Teacher Notes (private)</div>
                <div style={{ fontSize: 13 }}>{lesson.teacherNotes}</div>
              </div>
            )}
          </>
        )}
        {pdfViewer && <PdfViewer file={pdfViewer} onClose={() => setPdfViewer(null)} />}
      </div>
    );
  }

  // Edit form
  return (
    <div>
      <div className="lesson-box">
        <div className="lesson-box-title">📚 Edit Lesson Content</div>

        <div className="fg">
          <label>Lesson Title</label>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Unit 3 – Reading & Discussion" />
        </div>
        <div className="fg">
          <label>Description</label>
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What will students learn today?" />
        </div>

        <div className="input-row">
          <div className="fg">
            <label>Book</label>
            <select value={form.bookId} onChange={e => setForm(p => ({ ...p, bookId: e.target.value, chapterId: "" }))}>
              <option value="">No book selected</option>
              {data.books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </div>
          <div className="fg">
            <label>Chapter</label>
            <select value={form.chapterId} onChange={e => setForm(p => ({ ...p, chapterId: e.target.value }))} disabled={!form.bookId}>
              <option value="">Select chapter…</option>
              {book?.chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        </div>

        <div className="fg">
          <label>Lesson PDF / Main Material</label>
          {form.fileId
            ? <FileRow fileId={form.fileId} label="Lesson File" onPreview={f => setPdfViewer(f)} canRemove={true} onRemove={() => setForm(p => ({ ...p, fileId: null }))} />
            : <FileUploadWidget label="Upload lesson PDF or slides" onFileStored={handleMainFile} lessonId={lesson?.id} />
          }
        </div>

        <div className="fg">
          <label>Extra Materials</label>
          <FileUploadWidget label="Upload additional resources" onFileStored={handleExtraFile} lessonId={lesson?.id} />
          {form.extraFiles.length > 0 && (
            <div className="mt8">
              {form.extraFiles.map(fid => (
                <FileRow key={fid} fileId={fid} onPreview={f => setPdfViewer(f)} canRemove={true} onRemove={() => removeExtraFile(fid)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="hw-box">
        <div className="hw-box-title">📝 Homework</div>
        <div className="fg">
          <label>Homework Instructions</label>
          <textarea value={form.homework} onChange={e => setForm(p => ({ ...p, homework: e.target.value }))} placeholder="Write homework instructions here…" />
        </div>
        <div className="fg">
          <label>Due Date</label>
          <input type="date" value={form.homeworkDue} onChange={e => setForm(p => ({ ...p, homeworkDue: e.target.value }))} />
        </div>
      </div>

      <div className="fg">
        <label>🔒 Teacher Notes (private, not visible to students)</label>
        <textarea value={form.teacherNotes} onChange={e => setForm(p => ({ ...p, teacherNotes: e.target.value }))} placeholder="Reminders, tips, things to focus on…" />
      </div>

      <div className="flex gap8">
        <button className="btn btn-se" style={{ flex: 1, justifyContent: "center" }} onClick={() => setEditing(false)}>Cancel</button>
        <button className="btn btn-pr" style={{ flex: 1, justifyContent: "center" }} onClick={saveLesson}>💾 Save Lesson</button>
      </div>

      {pdfViewer && <PdfViewer file={pdfViewer} onClose={() => setPdfViewer(null)} />}
    </div>
  );
}

// ─── NEXT LESSON PREVIEW CARD ─────────────────────────────────────────────────
function NextLessonCard({ data, user, onViewSession }) {
  const mySessions = data.sessions
    .filter(s => s.groupId === user.groupId && s.status === "upcoming" && !s.isCancelled)
    .sort((a, b) => a.date.localeCompare(b.date));

  const nextSession = mySessions[0];
  if (!nextSession) return null;

  const lesson = data.lessons.find(l => l.sessionId === nextSession.id)
    ?? (nextSession.seriesId ? data.lessons.find(l => l.seriesId === nextSession.seriesId && !l.sessionId) : null);
  if (!lesson) return null;

  const book = data.books.find(b => b.id === lesson.bookId);
  const chapter = book?.chapters.find(c => c.id === lesson.chapterId);
  const file = lesson.fileId ? getFile(lesson.fileId) : null;

  return (
    <div className="next-lesson-card" onClick={() => onViewSession && onViewSession(nextSession)}>
      <div className="next-lesson-label">📌 Next Lesson Preview</div>
      <div className="fw7 mb4" style={{ fontSize: 14 }}>{lesson.title || nextSession.title}</div>
      <div className="text-xs muted mb8">{nextSession.date} · {nextSession.time} {book ? `· ${book.title}` : ""}{chapter ? ` · ${chapter.title}` : ""}</div>
      {lesson.description && <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>{lesson.description}</div>}
      <div className="flex ac gap8">
        {file && <button className="btn btn-se btn-xs" onClick={e => { e.stopPropagation(); }}>📄 Preview PDF</button>}
        <span style={{ fontSize: 11, color: "var(--accent2)", fontWeight: 600 }}>Click to open session →</span>
      </div>
    </div>
  );
}

// ─── BOOKS PAGE ───────────────────────────────────────────────────────────────
function BooksPage({ data, setData }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const [showAdd, setShowAdd] = useState(false);
  const [viewBook, setViewBook] = useState(null);
  const [addChapter, setAddChapter] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [pdfViewer, setPdfViewer] = useState(null);
  const [form, setForm] = useState({ title: "", level: "A2", author: "", description: "", coverColor: "#f97316", assignedGroups: [] });

  const COVER_COLORS = ["#f97316","#22c55e","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899","#06b6d4"];

  const addBook = async () => {
    if (!form.title) { toast("Book title required", "error"); return; }
    try {
      const newBook = await api.books.create({ ...form, chapters: [], fileId: null });
      const flat = { ...newBook, id: newBook._id?.toString() || newBook.id, chapters: newBook.chapters || [], coverColor: newBook.coverColor || form.coverColor || '#f97316' };
      setData(d => ({ ...d, books: [...d.books, flat] }));
      toast("📚 Book created");
      setShowAdd(false);
      setForm({ title: "", level: "A2", author: "", description: "", coverColor: "#f97316", assignedGroups: [] });
    } catch(e) { toast(e.message || "Failed to create book", "error"); }
  };

  const addChapterToBook = (bookId) => {
    if (!chapterTitle) { toast("Chapter title required", "error"); return; }
    setData(d => ({
      ...d,
      books: d.books.map(b => {
        if (b.id !== bookId) return b;
        const newChapter = { id: Date.now(), title: chapterTitle, order: b.chapters.length + 1 };
        return { ...b, chapters: [...b.chapters, newChapter] };
      })
    }));
    toast("Chapter added");
    setChapterTitle("");
    setAddChapter(false);
  };

  const deleteBook = async (bookId) => {
    try {
      await api.books.delete(bookId);
      setData(d => ({ ...d, books: d.books.filter(b => b.id !== bookId) }));
      toast("Book deleted");
      setViewBook(null);
    } catch(e) { toast(e.message || "Failed to delete book", "error"); }
  };

  const handleBookFile = async (fileId, name) => {
    setData(d => ({ ...d, books: d.books.map(b => b.id === viewBook.id ? { ...b, fileId, fileName: name } : b) }));
    setViewBook(v => v ? { ...v, fileId, fileName: name } : v);
    toast("Book PDF uploaded ✅");
  };

  return (
    <div>
      <div className="ph">
        <div><div className="ph-title">Books & Curriculum</div><div className="ph-sub">{data.books.length} books · {data.books.reduce((s, b) => s + b.chapters.length, 0)} chapters</div></div>
        <button className="btn btn-pr" onClick={() => setShowAdd(true)}>+ Add Book</button>
      </div>

      <div className="g3">
        {data.books.map(book => {
          const assignedGroups = data.groups.filter(g => book.assignedGroups?.includes(g.id));
          const usedInLessons = data.lessons.filter(l => l.bookId === book.id).length;
          return (
            <div key={book.id} className="book-card" onClick={() => setViewBook(book)}>
              <div className="book-cover" style={{ background: `linear-gradient(135deg, ${book.coverColor||"#f97316"}, ${(book.coverColor||"#f97316")}99)` }}>
                <div className="book-cover-shine" />
                <div className="book-cover-icon">📖</div>
                <div style={{ position: "absolute", top: 10, right: 10 }}>
                  <span style={{ background: "rgba(0,0,0,.3)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 99 }}>{book.level}</span>
                </div>
              </div>
              <div className="book-meta">
                <div className="book-title">{book.title}</div>
                <div className="book-author">{book.author || "Unknown author"}</div>
                <div className="flex ac gap6" style={{ flexWrap: "wrap" }}>
                  <span className="text-xs muted">{book.chapters.length} chapters</span>
                  {usedInLessons > 0 && <span style={{ fontSize: 11, color: "var(--accent2)", background: "var(--glow)", padding: "2px 7px", borderRadius: 99 }}>{usedInLessons} lessons</span>}
                  {assignedGroups.map(g => <Badge key={g.id} status="active" label={g.name} />)}
                </div>
              </div>
            </div>
          );
        })}

        {/* Add book placeholder */}
        <div className="book-card" style={{ cursor: "pointer", borderStyle: "dashed", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }} onClick={() => setShowAdd(true)}>
          <div style={{ textAlign: "center", color: "var(--text3)" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>+</div>
            <div className="text-sm fw7">Add New Book</div>
          </div>
        </div>
      </div>

      {/* Add Book Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Book">
        <div className="fg"><label>Book Title *</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="English File B2" /></div>
        <div className="input-row">
          <div className="fg"><label>Level</label><select value={form.level} onChange={e => setForm(p => ({ ...p, level: e.target.value }))}>{["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}</select></div>
          <div className="fg"><label>Author / Publisher</label><input value={form.author} onChange={e => setForm(p => ({ ...p, author: e.target.value }))} placeholder="Oxford University Press" /></div>
        </div>
        <div className="fg"><label>Description</label><textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief description…" /></div>
        <div className="fg">
          <label>Cover Color</label>
          <div className="flex gap8 mt4">
            {COVER_COLORS.map(c => (
              <div key={c} onClick={() => setForm(p => ({ ...p, coverColor: c }))}
                style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: "pointer", border: form.coverColor === c ? "3px solid white" : "3px solid transparent", transition: "all .13s" }} />
            ))}
          </div>
        </div>
        <div className="fg">
          <label>Assign to Groups</label>
          <div className="flex gap6" style={{ flexWrap: "wrap", marginTop: 4 }}>
            {data.groups.map(g => (
              <div key={g.id}
                className={`day-pill ${form.assignedGroups.includes(g.id) ? "sel" : ""}`}
                onClick={() => setForm(p => ({ ...p, assignedGroups: p.assignedGroups.includes(g.id) ? p.assignedGroups.filter(x => x !== g.id) : [...p.assignedGroups, g.id] }))}>
                {g.name}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap8 mt12">
          <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setShowAdd(false)}>Cancel</button>
          <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={addBook}>Create Book</button>
        </div>
      </Modal>

      {/* View Book Modal */}
      {viewBook && (() => {
        const freshBook = data.books.find(b => b.id === viewBook.id) ?? viewBook;
        return (
          <Modal open={!!viewBook} onClose={() => setViewBook(null)} title="Book Details" xl>
            <div className="flex ac gap16 mb20">
              <div style={{ width: 80, height: 100, borderRadius: 12, background: `linear-gradient(135deg,${freshBook.coverColor},${freshBook.coverColor}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0 }}>📖</div>
              <div style={{ flex: 1 }}>
                <div className="fw8" style={{ fontSize: 20 }}>{freshBook.title}</div>
                <div className="text-sm muted mt4">{freshBook.author}</div>
                <div className="flex gap8 mt8 ac">
                  <Badge status="active" label={freshBook.level} />
                  <span className="text-xs muted">{freshBook.chapters.length} chapters</span>
                </div>
                {freshBook.description && <div className="text-sm muted mt6">{freshBook.description}</div>}
              </div>
              <button className="btn btn-da btn-sm" onClick={() => deleteBook(freshBook.id)}>🗑 Delete</button>
            </div>

            {/* Book PDF */}
            <div className="mb16">
              <div className="sh-title mb8">Book PDF</div>
              {freshBook.fileId
                ? <FileRow fileId={freshBook.fileId} label="Book PDF" onPreview={f => setPdfViewer(f)} canRemove={true}
                    onRemove={() => { setData(d => ({ ...d, books: d.books.map(b => b.id === freshBook.id ? { ...b, fileId: null } : b) })); setViewBook(v => ({ ...v, fileId: null })); }} />
                : <FileUploadWidget label="Upload book PDF" onFileStored={handleBookFile} bookId={viewBook?.id} />
              }
            </div>

            <div className="divider" />

            {/* Chapters */}
            <div className="sh mb8">
              <div className="sh-title">Chapters ({freshBook.chapters.length})</div>
              <button className="btn btn-se btn-sm" onClick={() => setAddChapter(true)}>+ Add Chapter</button>
            </div>

            {addChapter && (
              <div className="flex gap8 mb12">
                <input value={chapterTitle} onChange={e => setChapterTitle(e.target.value)} placeholder="Unit 7 – Future Tenses" style={{ flex: 1 }} onKeyDown={e => e.key === "Enter" && addChapterToBook(freshBook.id)} />
                <button className="btn btn-pr btn-sm" onClick={() => addChapterToBook(freshBook.id)}>Add</button>
                <button className="btn btn-se btn-sm" onClick={() => setAddChapter(false)}>Cancel</button>
              </div>
            )}

            {freshBook.chapters.length === 0
              ? <div className="empty" style={{ padding: "16px 0" }}><div className="empty-icon" style={{ fontSize: 26 }}>📑</div><div className="empty-title">No chapters yet</div></div>
              : freshBook.chapters.map((ch, i) => (
                <div key={ch.id} className="chapter-row">
                  <div className="chapter-num" style={{ background: `${freshBook.coverColor}25`, color: freshBook.coverColor }}>{ch.order}</div>
                  <div style={{ flex: 1 }}><div className="fw7 text-sm">{ch.title}</div></div>
                  <span className="text-xs muted">
                    {data.lessons.filter(l => l.bookId === freshBook.id && l.chapterId === ch.id).length} lessons
                  </span>
                </div>
              ))
            }
          </Modal>
        );
      })()}

      {pdfViewer && <PdfViewer file={pdfViewer} onClose={() => setPdfViewer(null)} />}
    </div>
  );
}

// ─── MATERIALS PAGE (Teacher) ─────────────────────────────────────────────────
function MaterialsPage({ user, data, setData }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const [tab,       setTab]       = useState("books");
  const [pdfViewer, setPdfViewer] = useState(null);
  const [search,    setSearch]    = useState("");
  const [groupF,    setGroupF]    = useState("all");

  // ── data ──────────────────────────────────────────────────────────────────────
  const myGroups = data.groups.filter(g => g.teacherId === user.id);
  const myGroupIds = new Set(myGroups.map(g => g.id));

  // All sessions that belong to my groups
  const mySessions = data.sessions.filter(s => myGroupIds.has(s.groupId));

  // Books assigned to ANY of my groups
  const myBooks = data.books.filter(b =>
    b.assignedGroups?.some(gid => myGroupIds.has(gid))
  );

  // Lessons: created by me OR linked to sessions in my groups
  const myLessons = data.lessons.filter(l => {
    if (l.createdBy === user.id) return true;
    if (l.sessionId) {
      const s = mySessions.find(x => x.id === l.sessionId);
      return !!s;
    }
    if (l.seriesId) {
      const s = mySessions.find(x => x.seriesId === l.seriesId);
      return !!s;
    }
    return false;
  });

  // Enrich each lesson with its session & group context
  const enrichedLessons = myLessons.map(lesson => {
    const session = lesson.sessionId
      ? mySessions.find(s => s.id === lesson.sessionId)
      : mySessions.find(s => s.seriesId === lesson.seriesId);
    const group   = session ? data.groups.find(g => g.id === session.groupId) : null;
    const book    = data.books.find(b => b.id === lesson.bookId);
    const chapter = book?.chapters.find(c => c.id === lesson.chapterId);
    const files   = [
      lesson.fileId ? getFile(lesson.fileId) : null,
      ...(lesson.extraFiles ?? []).map(fid => getFile(fid))
    ].filter(Boolean);
    return { lesson, session, group, book, chapter, files };
  }).sort((a, b) => (b.session?.date ?? "").localeCompare(a.session?.date ?? ""));

  // Pending homework (lessons that have homework set)
  const homeworkList = enrichedLessons.filter(x => x.lesson.homework);

  // Upcoming sessions with no lesson content yet
  const sessionsWithoutLesson = mySessions
    .filter(s => s.status === "upcoming")
    .filter(s => !data.lessons.find(l => l.sessionId === s.id || (l.seriesId && l.seriesId === s.seriesId)))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── filter helpers ────────────────────────────────────────────────────────────
  const filteredLessons = enrichedLessons
    .filter(x => groupF === "all" || String(x.group?.id) === groupF)
    .filter(x => !search ||
      x.lesson.title?.toLowerCase().includes(search.toLowerCase()) ||
      x.book?.title?.toLowerCase().includes(search.toLowerCase()) ||
      x.chapter?.title?.toLowerCase().includes(search.toLowerCase())
    );

  const filteredBooks = myBooks
    .filter(b => groupF === "all" || b.assignedGroups?.some(gid => String(gid) === groupF))
    .filter(b => !search ||
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.author?.toLowerCase().includes(search.toLowerCase())
    );

  // ── quick stats ───────────────────────────────────────────────────────────────
  const totalFiles = myLessons.reduce((n, l) =>
    n + (l.fileId ? 1 : 0) + (l.extraFiles?.length ?? 0), 0
  );
  const booksWithPdf = myBooks.filter(b => b.fileId && getFile(b.fileId)).length;

  // ── helpers ───────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];

  return (
    <div>
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">📚 My Materials</div>
          <div className="ph-sub">
            {myBooks.length} books · {myLessons.length} lessons · {totalFiles} file{totalFiles !== 1 ? "s" : ""} uploaded
          </div>
        </div>
      </div>

      {/* ── Alert: sessions missing lesson content ── */}
      {sessionsWithoutLesson.length > 0 && (
        <div style={{
          marginBottom: 16, padding: "12px 16px", borderRadius: 12,
          background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.25)",
          display: "flex", alignItems: "center", gap: 12
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>
              {sessionsWithoutLesson.length} upcoming session{sessionsWithoutLesson.length > 1 ? "s" : ""} have no lesson content yet
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
              {sessionsWithoutLesson.slice(0, 3).map(s => s.title).join(" · ")}
              {sessionsWithoutLesson.length > 3 ? ` +${sessionsWithoutLesson.length - 3} more` : ""}
            </div>
          </div>
          <button className="btn btn-se btn-xs" onClick={() => setTab("todo")}>View →</button>
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="g4 mb16">
        {[
          { icon: "📚", label: "Books",          val: myBooks.length,      sub: `${booksWithPdf} with PDF`,            c: "#f97316" },
          { icon: "📖", label: "Lessons",         val: myLessons.length,    sub: `${homeworkList.length} with homework`, c: "#6366f1" },
          { icon: "📎", label: "Files Uploaded",  val: totalFiles,          sub: "PDFs & resources",                    c: "#22c55e" },
          { icon: "⚠️", label: "Missing Content", val: sessionsWithoutLesson.length, sub: "sessions need prep",        c: sessionsWithoutLesson.length > 0 ? "#f59e0b" : "#22c55e" },
        ].map((k, i) => (
          <div key={i} className="card stat" style={{ borderColor: k.c + "33" }}>
            <div className="stat-glow" style={{ background: k.c }} />
            <div className="stat-icon">{k.icon}</div>
            <div className="stat-label">{k.label}</div>
            <div className="stat-val" style={{ color: k.c }}>{k.val}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="tabs mb12" style={{ maxWidth: 500 }}>
        {[
          ["books",   `📚 Books (${myBooks.length})`],
          ["lessons", `📖 Lessons (${myLessons.length})`],
          ["homework",`📝 Homework (${homeworkList.length})`],
          ["todo",    `⚠️ To-Do (${sessionsWithoutLesson.length})`],
        ].map(([v, l]) => (
          <div key={v} className={`tab ${tab === v ? "active" : ""}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {/* ── Search + Group filter ── */}
      <div className="card mb14" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 160, position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)" }}>🔍</span>
            <input style={{ paddingLeft: 32 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select style={{ minWidth: 140 }} value={groupF} onChange={e => setGroupF(e.target.value)}>
            <option value="all">All My Groups</option>
            {myGroups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
          {(search || groupF !== "all") && (
            <button className="btn btn-da btn-xs" onClick={() => { setSearch(""); setGroupF("all"); }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* ════════════════════ BOOKS TAB ════════════════════ */}
      {tab === "books" && (
        <div>
          {filteredBooks.length === 0 ? (
            <div className="empty" style={{ marginTop: 32 }}>
              <div className="empty-icon">📚</div>
              <div className="empty-title">No books assigned to your groups</div>
              <div className="text-sm muted">Ask your admin to assign books to your groups</div>
            </div>
          ) : filteredBooks.map(book => {
            const file = book.fileId ? getFile(book.fileId) : null;
            const assignedToMyGroups = myGroups.filter(g => book.assignedGroups?.includes(g.id));
            const coveredChapters = new Set(
              data.lessons.filter(l => l.bookId === book.id).map(l => l.chapterId)
            );
            const chapPct = book.chapters.length
              ? Math.round(coveredChapters.size / book.chapters.length * 100) : 0;
            const lessonsUsingBook = myLessons.filter(l => l.bookId === book.id).length;

            return (
              <div key={book.id} className="card mb14">
                {/* Book header */}
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
                  {/* Book spine visual */}
                  <div style={{
                    width: 64, height: 90, borderRadius: 10, flexShrink: 0,
                    background: `linear-gradient(160deg, ${book.coverColor||"#f97316"}, ${(book.coverColor||"#f97316")}88)`,
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 4, boxShadow: `0 4px 16px ${book.coverColor}44`
                  }}>
                    <span style={{ fontSize: 26 }}>📖</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", letterSpacing: 1, textTransform: "uppercase" }}>{book.level}</span>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 3 }}>{book.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{book.author || "Unknown author"}</div>

                    {/* Assigned groups */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {assignedToMyGroups.map(g => (
                        <span key={g.id} style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 99,
                          background: "var(--glow)", color: "var(--accent2)", border: "1px solid rgba(249,115,22,.2)"
                        }}>{g.name}</span>
                      ))}
                    </div>

                    {/* Mini stats */}
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {[
                        { l: "Chapters", v: book.chapters.length },
                        { l: "Covered",  v: coveredChapters.size, c: coveredChapters.size > 0 ? "#22c55e" : "var(--text3)" },
                        { l: "Lessons",  v: lessonsUsingBook, c: lessonsUsingBook > 0 ? "#6366f1" : "var(--text3)" },
                      ].map((x, i) => (
                        <div key={i} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: x.c || "var(--text)" }}>{x.v}</div>
                          <div style={{ fontSize: 10, color: "var(--text3)" }}>{x.l}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                    {file ? (
                      <>
                        <button className="btn btn-se btn-sm" onClick={() => setPdfViewer(file)}>👁 Preview</button>
                        <a href={file.dataUrl} download={file.name} style={{ textDecoration: "none" }}>
                          <button className="btn btn-pr btn-sm" style={{ width: "100%" }}>📥 Download</button>
                        </a>
                      </>
                    ) : (
                      <div style={{
                        fontSize: 11, color: "var(--text3)", textAlign: "center",
                        padding: "8px 10px", borderRadius: 8, border: "1px dashed var(--border2)",
                        background: "var(--bg3)"
                      }}>
                        📄 No PDF<br/>
                        <span style={{ fontSize: 10 }}>Ask admin to upload</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Chapter progress bar */}
                {book.chapters.length > 0 && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text3)", marginBottom: 5 }}>
                      <span>Chapter Coverage</span>
                      <span style={{ fontWeight: 700, color: chapPct >= 80 ? "#22c55e" : chapPct >= 40 ? "#f59e0b" : "var(--text3)" }}>
                        {coveredChapters.size}/{book.chapters.length} ({chapPct}%)
                      </span>
                    </div>
                    <div style={{ height: 5, background: "var(--bg4)", borderRadius: 99, overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ height: "100%", width: chapPct + "%", borderRadius: 99, transition: "width .5s",
                        background: chapPct >= 80 ? "#22c55e" : "var(--accent)" }} />
                    </div>

                    {/* Chapter list */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 6 }}>
                      {book.chapters.map(ch => {
                        const done = coveredChapters.has(ch.id);
                        const lessonCount = myLessons.filter(l => l.bookId === book.id && l.chapterId === ch.id).length;
                        return (
                          <div key={ch.id} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                            borderRadius: 8,
                            background: done ? "rgba(34,197,94,.06)" : "var(--bg3)",
                            border: `1px solid ${done ? "rgba(34,197,94,.2)" : "var(--border)"}`
                          }}>
                            <span style={{ fontSize: 13, flexShrink: 0 }}>{done ? "✅" : "⭕"}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: done ? 700 : 400,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ch.title}
                              </div>
                              {lessonCount > 0 && (
                                <div style={{ fontSize: 10, color: "#6366f1" }}>{lessonCount} lesson{lessonCount > 1 ? "s" : ""}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════ LESSONS TAB ════════════════════ */}
      {tab === "lessons" && (
        <div>
          {filteredLessons.length === 0 ? (
            <div className="empty" style={{ marginTop: 32 }}>
              <div className="empty-icon">📖</div>
              <div className="empty-title">No lessons yet</div>
              <div className="text-sm muted">Open a session and add lesson content from the Materials tab</div>
            </div>
          ) : filteredLessons.map(({ lesson, session, group, book, chapter, files }) => {
            const isPast    = session?.status === "completed";
            const isUpcoming = session?.status === "upcoming";
            const hwOverdue = lesson.homeworkDue && lesson.homeworkDue < today;
            const accentColor = isPast ? "#22c55e" : isUpcoming ? "var(--accent2)" : "var(--border2)";

            return (
              <div key={lesson.id} className="card mb10" style={{ borderLeft: `3px solid ${accentColor}` }}>
                {/* Lesson header */}
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  {/* Book colour badge */}
                  <div style={{
                    width: 44, height: 52, borderRadius: 9, flexShrink: 0,
                    background: book ? `linear-gradient(135deg,${book.coverColor},${book.coverColor}88)` : "var(--glow)",
                    color: book ? "#fff" : "var(--accent2)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                    boxShadow: book ? `0 2px 8px ${book.coverColor}44` : "none"
                  }}>📖</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 3 }}>{lesson.title || "Untitled Lesson"}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                      {session?.date && <span>{session.date} · {session.time}</span>}
                      {book && <span> · {book.title}</span>}
                      {chapter && <span> · {chapter.title}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {group && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                          background: "var(--glow)", color: "var(--accent2)", border: "1px solid rgba(249,115,22,.2)" }}>
                          👥 {group.name}
                        </span>
                      )}
                      {isPast   && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: "rgba(34,197,94,.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,.2)" }}>✅ Done</span>}
                      {isUpcoming && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: "var(--glow)", color: "var(--accent2)", border: "1px solid rgba(249,115,22,.2)" }}>📅 Upcoming</span>}
                      {files.length > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: "rgba(99,102,241,.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,.2)" }}>
                          📎 {files.length} file{files.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {lesson.description && (
                  <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12, lineHeight: 1.6 }}>
                    {lesson.description}
                  </div>
                )}

                {/* Files */}
                {(lesson.fileId || lesson.extraFiles?.length > 0) && (
                  <div style={{ marginBottom: 12 }}>
                    {lesson.fileId && (
                      <FileRow fileId={lesson.fileId} label="Lesson PDF"
                        onPreview={f => setPdfViewer(f)} canRemove={false} />
                    )}
                    {lesson.extraFiles?.map(fid => (
                      <FileRow key={fid} fileId={fid}
                        onPreview={f => setPdfViewer(f)} canRemove={false} />
                    ))}
                  </div>
                )}

                {/* No files notice */}
                {!lesson.fileId && !lesson.extraFiles?.length && (
                  <div style={{
                    fontSize: 11, color: "var(--text3)", padding: "8px 12px",
                    borderRadius: 8, background: "var(--bg3)",
                    border: "1px dashed var(--border2)", marginBottom: 10
                  }}>
                    📄 No files attached to this lesson yet — open the session to upload materials
                  </div>
                )}

                {/* Homework */}
                {lesson.homework && (
                  <div style={{
                    borderRadius: 8, padding: "10px 12px",
                    background: hwOverdue ? "rgba(239,68,68,.06)" : "rgba(245,158,11,.06)",
                    border: `1px solid ${hwOverdue ? "rgba(239,68,68,.2)" : "rgba(245,158,11,.2)"}`
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: hwOverdue ? "#ef4444" : "#f59e0b",
                        textTransform: "uppercase", letterSpacing: .5 }}>📝 Homework</span>
                      {lesson.homeworkDue && (
                        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--mono)",
                          color: hwOverdue ? "#ef4444" : "#f59e0b" }}>
                          Due: {lesson.homeworkDue} {hwOverdue ? "⚠ Overdue" : ""}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>{lesson.homework}</div>
                  </div>
                )}

                {/* Teacher notes (private) */}
                {lesson.teacherNotes && (
                  <div style={{
                    marginTop: 10, fontSize: 12, color: "var(--text3)",
                    padding: "8px 10px", borderRadius: 8, background: "var(--bg3)",
                    border: "1px solid var(--border)", borderLeft: "3px solid #6366f1"
                  }}>
                    🔒 <strong style={{ color: "#818cf8" }}>Private note:</strong> {lesson.teacherNotes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════ HOMEWORK TAB ════════════════════ */}
      {tab === "homework" && (
        <div>
          {homeworkList.length === 0 ? (
            <div className="empty" style={{ marginTop: 32 }}>
              <div className="empty-icon">📝</div>
              <div className="empty-title">No homework assigned yet</div>
            </div>
          ) : (
            <>
              {/* Summary row */}
              <div className="g3 mb16">
                {[
                  { l: "Total Assigned",  v: homeworkList.length,                                                              c: "#6366f1" },
                  { l: "Overdue",         v: homeworkList.filter(x => x.lesson.homeworkDue && x.lesson.homeworkDue < today).length, c: "#ef4444" },
                  { l: "Upcoming",        v: homeworkList.filter(x => x.lesson.homeworkDue && x.lesson.homeworkDue >= today).length, c: "#22c55e" },
                ].map((k, i) => (
                  <div key={i} className="card tac">
                    <div style={{ fontSize: 24, fontWeight: 900, color: k.c }}>{k.v}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{k.l}</div>
                  </div>
                ))}
              </div>

              {homeworkList
                .sort((a, b) => (a.lesson.homeworkDue ?? "9999").localeCompare(b.lesson.homeworkDue ?? "9999"))
                .map(({ lesson, session, group }) => {
                  const isOverdue  = lesson.homeworkDue && lesson.homeworkDue < today;
                  const isDueSoon  = lesson.homeworkDue && lesson.homeworkDue >= today &&
                    lesson.homeworkDue <= new Date(Date.now() + 3*86400000).toISOString().split("T")[0];

                  return (
                    <div key={lesson.id} className="card mb8"
                      style={{ borderLeft: `3px solid ${isOverdue ? "#ef4444" : isDueSoon ? "#f59e0b" : "var(--border)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{lesson.title || session?.title}</div>
                          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                            {group?.name ?? "—"} · Session: {session?.date ?? "—"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                          {isOverdue  && <Badge status="overdue"  label="⚠ Overdue" />}
                          {isDueSoon && !isOverdue && <Badge status="pending" label="Due Soon" />}
                          {lesson.homeworkDue && (
                            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--mono)",
                              color: isOverdue ? "#ef4444" : "#f59e0b", marginTop: 4 }}>
                              Due {lesson.homeworkDue}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6,
                        background: "var(--bg3)", borderRadius: 8, padding: "8px 12px" }}>
                        {lesson.homework}
                      </div>
                    </div>
                  );
                })
              }
            </>
          )}
        </div>
      )}

      {/* ════════════════════ TO-DO TAB ════════════════════ */}
      {tab === "todo" && (
        <div>
          {sessionsWithoutLesson.length === 0 ? (
            <div className="empty" style={{ marginTop: 32 }}>
              <div className="empty-icon">🎉</div>
              <div className="empty-title">All sessions have lesson content!</div>
              <div className="text-sm muted">You're fully prepared</div>
            </div>
          ) : (
            <>
              <div style={{
                marginBottom: 16, padding: "12px 16px", borderRadius: 12,
                background: "rgba(245,158,11,.07)", border: "1px solid rgba(245,158,11,.2)",
                fontSize: 13, color: "var(--text2)"
              }}>
                💡 These upcoming sessions don't have lesson content yet. Open a session and click the <strong>📚 Materials</strong> tab to add content, upload files and set homework.
              </div>

              {sessionsWithoutLesson.map(s => {
                const group   = data.groups.find(g => g.id === s.groupId);
                const teacher = data.users.find(u => u.id === s.teacherId);
                const daysAway = Math.ceil((new Date(s.date) - new Date(today)) / 86400000);

                return (
                  <div key={s.id} className="card mb8"
                    style={{ borderLeft: `3px solid ${daysAway <= 1 ? "#ef4444" : daysAway <= 3 ? "#f59e0b" : "var(--border2)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                        background: daysAway <= 1 ? "rgba(239,68,68,.1)" : "rgba(245,158,11,.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20
                      }}>
                        {daysAway <= 1 ? "🔴" : daysAway <= 3 ? "🟡" : "📅"}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                          {group?.name ?? "—"} · {s.date} at {s.time}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 800,
                          color: daysAway <= 1 ? "#ef4444" : daysAway <= 3 ? "#f59e0b" : "var(--text3)"
                        }}>
                          {daysAway <= 0 ? "Today!" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>No content yet</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {pdfViewer && <PdfViewer file={pdfViewer} onClose={() => setPdfViewer(null)} />}
    </div>
  );
}

// ─── SESSION DETAIL MODAL (proper component to allow hooks) ──────────────────
function SessionDetailModal({ sessionId, data, setData, onClose, userRole, userId, onComplete, onCancel, onSkip, onMarkAttendance, onScopePick }) {
  const [sessTab, setSessTab] = useState("info");
  const s = data.sessions.find(x => x.id === sessionId);
  if (!s) return null;

  const group = data.groups.find(g => g.id === s.groupId);
  const teacher = data.users.find(u => u.id === s.teacherId);
  const series = s.seriesId ? data.series.find(sr => sr.id === s.seriesId) : null;
  const groupStudents = data.users.filter(u => u.role === "student" && u.groupId === s.groupId);
  const presentCount = groupStudents.filter(st => s.attendance[st.id] === true).length;
  const canEdit = userRole === "admin" || (userRole === "teacher" && s.teacherId === userId);
  const effectiveLink = getMeetingLink(s, data.series);
  const isAuthorized = userRole === "admin" || (userRole === "teacher" && s.teacherId === userId) || userRole === "student";

  const [editForm, setEditForm] = useState({
    title: s.title || "",
    date: s.date || "",
    startTime: s.startTime || "",
    endTime: s.endTime || "",
    duration: s.duration || 90,
    groupId: String(s.groupId || ""),
    teacherId: String(s.teacherId || ""),
    sessionMode: s.sessionMode || s.mode || "offline",
    notes: s.notes || "",
  });

  const saveSessionEdit = async () => {
    if (!editForm.title || !editForm.date || !editForm.startTime) { toast("Title, date and time required", "error"); return; }
    try {
      const updated = await api.sessions.update(s.id, { ...editForm, startTime: editForm.startTime, groupId: editForm.groupId, teacherId: editForm.teacherId, duration: Number(editForm.duration), mode: editForm.sessionMode || editForm.mode || "offline", sessionMode: editForm.sessionMode || editForm.mode || "offline" });
      const clean = deepClean(updated);
      setData(d => ({ ...d, sessions: d.sessions.map(x => x.id === s.id ? { ...x, ...clean } : x) }));
      toast("✅ Session updated");
    } catch(e) { toast(e.message || "Failed to update session", "error"); }
    setEditMode(false);
  };

  return (
    <Modal open={true} onClose={onClose} title="Session Detail" xl>
      {/* Header */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: `${statusColor[s.status]}18`, color: statusColor[s.status], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
          {s.status === "completed" ? "✅" : s.isCancelled ? "🚫" : "📝"}
        </div>
        <div style={{ flex: 1 }}>
          <div className="fw8" style={{ fontSize: 17 }}>{s.title}</div>
          <div className="text-sm muted mt4">{group?.name}{teacher ? ` · ${teacher.name}` : ""}</div>
          <div className="flex gap6 ac mt8" style={{ flexWrap: "wrap" }}>
            <Badge status={s.status} />
            {series && <span className="series-badge">🔁 {series.title}</span>}
            {s.isException && <Badge status="pending" label="📌 Exception" />}
            {s.sessionMode === "online"
              ? <span className="mode-pill mode-pill-online">💻 Online</span>
              : <span className="mode-pill mode-pill-offline">🏫 Offline</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <div className={`tab ${sessTab === "info" ? "active" : ""}`} onClick={() => setSessTab("info")}>ℹ️ Info</div>
        {canEdit && <div className={`tab ${sessTab === "edit" ? "active" : ""}`} onClick={() => setSessTab("edit")}>✏️ Edit</div>}
        <div className={`tab ${sessTab === "materials" ? "active" : ""}`} onClick={() => setSessTab("materials")}>📚 Materials</div>
        <div className={`tab ${sessTab === "attendance" ? "active" : ""}`} onClick={() => setSessTab("attendance")}>✅ Attendance</div>
      </div>

      {/* EDIT TAB */}
      {sessTab === "edit" && canEdit && (
        <div style={{ paddingTop: 8 }}>
          <div className="input-row">
            <div className="fg" style={{ gridColumn: "1/-1" }}><label>Session Title *</label><input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div className="fg"><label>Date *</label><input type="date" value={editForm.date} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div className="fg"><label>Start Time *</label><input type="time" value={editForm.startTime} onChange={e => setEditForm(p => ({ ...p, startTime: e.target.value }))} /></div>
            <div className="fg"><label>End Time</label><input type="time" value={editForm.endTime} onChange={e => setEditForm(p => ({ ...p, endTime: e.target.value }))} /></div>
            <div className="fg"><label>Duration (min)</label><input type="number" value={editForm.duration} onChange={e => setEditForm(p => ({ ...p, duration: e.target.value }))} /></div>
            {userRole === "admin" && <>
              <div className="fg"><label>Group</label>
                <select value={editForm.groupId} onChange={e => setEditForm(p => ({ ...p, groupId: e.target.value }))}>
                  {data.groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                </select>
              </div>
              <div className="fg"><label>Teacher</label>
                <select value={editForm.teacherId} onChange={e => setEditForm(p => ({ ...p, teacherId: e.target.value }))}>
                  {data.users.filter(u => u.role === "teacher").map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
                </select>
              </div>
            </>}
            <div className="fg"><label>Mode</label>
              <select value={editForm.sessionMode} onChange={e => setEditForm(p => ({ ...p, sessionMode: e.target.value }))}>
                <option value="offline">🏫 In Person</option>
                <option value="online">💻 Online</option>
              </select>
            </div>
            <div className="fg" style={{ gridColumn: "1/-1" }}><label>Notes</label><textarea value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} rows={3} /></div>
          </div>
          <div className="flex gap8 mt12">
            <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setSessTab("info")}>Cancel</button>
            <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={saveSessionEdit}>💾 Save Changes</button>
          </div>
        </div>
      )}

      {/* INFO TAB */}
      {sessTab === "info" && (
        <>
          {isAuthorized && (s.sessionMode === "online" || effectiveLink) && (
            <JoinButton session={s} seriesList={data.series} userRole={userRole} userId={userId} />
          )}
          {userRole === "admin" && s.sessionMode === "online" && (
            <AdminLinkOverride session={s} series={data.series} setData={setData} />
          )}
          <div className="g3 mb16">
            {[
              { l: "Date", v: s.date, mono: true },
              { l: "Time", v: `${s.time} – ${s.endTime || ""}`, mono: true },
              { l: "Duration", v: `${s.duration} min`, mono: true },
            ].map((item, i) => (
              <div key={i} className="card card-sm" style={{ padding: 12 }}>
                <div className="text-xs muted">{item.l}</div>
                <div className={`fw7 mt4 ${item.mono ? "mono" : ""}`} style={{ fontSize: 13, color: "var(--accent2)" }}>{item.v}</div>
              </div>
            ))}
          </div>
          {s.notes && (
            <div className="card card-sm mt12">
              <div className="text-xs muted mb4">Session Notes</div>
              <div style={{ fontSize: 13 }}>{s.notes}</div>
            </div>
          )}
          {canEdit && !s.isCancelled && (
            <div className="flex gap8 mt16" style={{ flexWrap: "wrap" }}>
              {s.status === "upcoming" && (
                <button className="btn btn-pr" style={{ flex: 1, justifyContent: "center" }} onClick={() => onComplete(s)}>
                  ✓ Mark Completed
                </button>
              )}
              {s.seriesId ? (
                <button className="btn btn-wa" style={{ flex: 1, justifyContent: "center" }} onClick={() => onScopePick({ action: "cancel", session: s })}>
                  🚫 Cancel Session
                </button>
              ) : (
                <button className="btn btn-da" style={{ flex: 1, justifyContent: "center" }} onClick={() => onCancel("this", s)}>
                  🚫 Cancel
                </button>
              )}
              <button className="btn btn-se" style={{ flex: 1, justifyContent: "center" }} onClick={() => onSkip(s)}>
                📌 Skip (Holiday)
              </button>
            </div>
          )}
        </>
      )}

      {/* MATERIALS TAB */}
      {sessTab === "materials" && (
        <LessonPanel session={s} data={data} setData={setData} userRole={userRole} userId={userId} />
      )}

      {/* ATTENDANCE TAB */}
      {sessTab === "attendance" && (
        <div>
          {groupStudents.length === 0
            ? <div className="empty"><div className="empty-icon">👥</div><div className="empty-title">No students in this group</div></div>
            : <>
              <div className="sh">
                <div className="sh-title">Attendance — {presentCount}/{groupStudents.length} present</div>
              </div>
              <div className="prog mb12">
                <div className="prog-fill" style={{ width: `${groupStudents.length ? (presentCount / groupStudents.length) * 100 : 0}%`, background: "var(--green)" }} />
              </div>
              {groupStudents.map(st => (
                <div key={st.id} className="li">
                  <Av name={st.name} />
                  <div style={{ flex: 1 }}><div className="fw7 text-sm">{st.name}</div></div>
                  {canEdit && s.status !== "completed" && !s.isCancelled ? (
                    <div className="flex gap6">
                      <button className={`btn btn-xs ${s.attendance[st.id] === true ? "btn-pr" : "btn-se"}`}
                        onClick={() => onMarkAttendance(s, st.id, true)}>✓ Present</button>
                      <button className={`btn btn-xs ${s.attendance[st.id] === false ? "btn-da" : "btn-se"}`}
                        onClick={() => onMarkAttendance(s, st.id, false)}>✗ Absent</button>
                    </div>
                  ) : (
                    <Badge status={s.attendance[st.id] === true ? "paid" : s.attendance[st.id] === false ? "overdue" : "pending"}
                      label={s.attendance[st.id] === true ? "Present" : s.attendance[st.id] === false ? "Absent" : "—"} />
                  )}
                </div>
              ))}
            </>
          }
        </div>
      )}
    </Modal>
  );
}

// ─── ADMIN LINK OVERRIDE ─────────────────────────────────────────────────────
function AdminLinkOverride({ session, series, setData }) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideLink, setOverrideLink] = useState(session.meetingLink || "");

  return (
    <div style={{ marginBottom: 12 }}>
      {!showOverride
        ? <button className="override-link-btn" onClick={() => setShowOverride(true)}>
            {session.seriesId ? "🔗 Override link for this session only" : "✏️ Edit meeting link"}
          </button>
        : <div className="online-box">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", marginBottom: 8 }}>
              {session.seriesId ? "🔗 Override Link (this session only)" : "✏️ Edit Meeting Link"}
            </div>
            <MeetingLinkInput value={overrideLink} onChange={setOverrideLink} label="Meeting URL" />
            <div className="flex gap8 mt8">
              <button className="btn btn-se btn-sm" onClick={() => setShowOverride(false)}>Cancel</button>
              <button className="btn btn-pr btn-sm" onClick={() => {
                if (overrideLink && !isValidUrl(overrideLink)) { toast("Invalid URL", "error"); return; }
                setData(d => ({ ...d, sessions: d.sessions.map(x => x.id === session.id ? { ...x, meetingLink: overrideLink || null } : x) }));
                toast(session.seriesId ? "Link overridden for this session ✓" : "Link updated ✓");
                setShowOverride(false);
              }}>Save Link</button>
            </div>
          </div>
      }
    </div>
  );
}

// ─── GROUP COLOR PALETTE ──────────────────────────────────────────────────────
const GROUP_COLORS = ["#f97316","#22c55e","#f59e0b","#3b82f6","#ec4899","#14b8a6","#f97316","#8b5cf6","#ef4444","#06b6d4"];
const getGroupColor = (groupId, groups) => {
  const idx = groups.findIndex(g => g.id === groupId);
  return GROUP_COLORS[idx % GROUP_COLORS.length] ?? "#f97316";
};

// ─── SESSIONS PAGE ────────────────────────────────────────────────────────────
function SessionsPage({ data, setData, userRole, userId }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const [view, setView] = useState("week");
  const [calDate, setCalDate] = useState(() => {
    const t = new Date(); t.setHours(0,0,0,0); return t;
  });
  const [showCreate, setShowCreate] = useState(false);
  const [viewSess, setViewSess] = useState(null);
  const [scopePicker, setScopePicker] = useState(null);
  const [dayDetail, setDayDetail] = useState(null);
  const [filterTeacher, setFilterTeacher] = useState("all");
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const myId = userId;

  // ── SCOPED SESSIONS: teacher sees only their own ──
  const myTeacherGroups = userRole === "teacher"
    ? data.groups.filter(g => g.teacherId === myId)
    : data.groups;

  const visibleSessions = userRole === "teacher"
    ? data.sessions.filter(s => s.teacherId === myId)
    : userRole === "student"
      ? data.sessions.filter(s => { const u = data.users.find(x => x.id === myId); return s.groupId === u?.groupId; })
      : data.sessions;

  // Admin filters (applied on top of role-scoping)
  const filteredSessions = visibleSessions
    .filter(s => filterTeacher === "all" || String(s.teacherId) === filterTeacher)
    .filter(s => filterGroup === "all" || String(s.groupId) === filterGroup)
    .filter(s => filterStatus === "all" || s.status === filterStatus);

  const hasFilters = filterTeacher !== "all" || filterGroup !== "all" || filterStatus !== "all";

  const todayStr = new Date().toISOString().split("T")[0];
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // ── HANDLERS ──
  const handleCreateSession = async (sessions, seriesMeta) => {
    try {
      // Strip temp frontend ID before sending to backend
      const cleaned = sessions.map(sess => {
        const { id, _id, ...rest } = sess; // remove temp id
        return rest;
      });
      const created = await Promise.all(cleaned.map(sess => api.sessions.create(sess)));
      const norm = created.map(s => {
        const clean = deepClean(s);
        // Ensure mode/sessionMode compatibility
        if (!clean.sessionMode && clean.mode) clean.sessionMode = clean.mode;
        if (!clean.mode && clean.sessionMode) clean.mode = clean.sessionMode;
        return clean;
      });
      setData(d => ({ ...d,
        sessions: [...d.sessions, ...norm],
        series: seriesMeta ? [...d.series, seriesMeta] : d.series
      }));
      toast(sessions.length > 1 ? `✅ ${sessions.length} sessions created!` : "✅ Session scheduled");
    } catch(e) {
      console.error("Session create error:", e);
      toast(e.message || "Failed to create session", "error");
    }
    setShowCreate(false);
  };

  const markAttendance = async (sess, studentId, present) => {
    // Mark attendance and auto-complete session so it appears in attendance overview
    setData(d => ({ ...d, sessions: d.sessions.map(s =>
      s.id === sess.id
        ? { ...s, attendance: { ...s.attendance, [studentId]: present }, status: "completed" }
        : s
    )}));
    try {
      await api.sessions.markStudent(sess.id, studentId, present);
      // Also ensure session is marked completed so attendance page can find it
      if (sess.status !== "completed") {
        await api.sessions.update(sess.id, { status: "completed" });
      }
    } catch(e) {
      console.error('Attendance save error', e);
      toast('Failed to save attendance - please try again', 'error');
    }
  };
  const completeSession = async (sess) => {
    setData(d => ({ ...d, sessions: d.sessions.map(s => s.id === sess.id ? { ...s, status: "completed" } : s) }));
    setViewSess(s => s ? { ...s, status: "completed" } : s);
    try {
      await api.sessions.update(sess.id, { status: "completed" });
      toast("Session completed ✅");
    } catch(e) {
      toast("Completed locally. Sync error: " + (e.message || ""), "warn");
    }
  };
  const cancelSession = async (scope, sess) => {
    // Optimistic local update first
    setData(d => ({ ...d, sessions: d.sessions.map(s => {
      if (scope === "this" && s.id === sess.id) return { ...s, status: "cancelled", isCancelled: true };
      if (scope === "future" && s.seriesId === sess.seriesId && s.date >= sess.date) return { ...s, status: "cancelled", isCancelled: true };
      if (scope === "all" && s.seriesId === sess.seriesId) return { ...s, status: "cancelled", isCancelled: true };
      return s;
    })}));
    setViewSess(null); setScopePicker(null);
    // Persist to backend - find all affected sessions and update each
    try {
      const allSessions = (() => {
        // Get current sessions from the data ref at time of call
        return [sess]; // will be rebuilt below using data
      })();
      // Build the list of IDs to cancel based on scope
      const toCancel = [];
      if (scope === "this") {
        toCancel.push(sess.id);
      } else {
        // For "future" and "all" we need to update multiple sessions
        // We'll do this by sending a batch update
      }
      if (scope === "this" || !sess.seriesId) {
        await api.sessions.update(sess.id, { status: "cancelled", isCancelled: true });
      } else {
        // For series cancellations, we iterate and call update for each
        // Use setData's functional updater to get current sessions list
        setData(d => {
          const affected = d.sessions.filter(s =>
            scope === "future"
              ? (s.seriesId === sess.seriesId && s.date >= sess.date)
              : (s.seriesId === sess.seriesId)
          );
          // Fire API calls for each (don't await - fire and forget, data already updated)
          affected.forEach(s => api.sessions.update(s.id, { status: "cancelled", isCancelled: true }).catch(console.error));
          return d; // no state change needed here, already done above
        });
      }
      toast("Session(s) cancelled ✅");
    } catch(e) {
      toast("Cancel saved locally. Sync error: " + (e.message || ""), "warn");
    }
  };
  const skipDate = async (sess) => {
    setData(d => ({ ...d, sessions: d.sessions.map(s => s.id === sess.id ? { ...s, status: "cancelled", isCancelled: true, isException: true } : s) }));
    setViewSess(null);
    try {
      await api.sessions.update(sess.id, { status: "cancelled", isCancelled: true, isException: true });
      toast("Session skipped ✅");
    } catch(e) {
      toast("Skipped locally. Sync error: " + (e.message || ""), "warn");
    }
  };

  // ── WEEK VIEW HELPERS ──
  const getWeekStart = (date) => {
    const d = new Date(date); d.setHours(0,0,0,0);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  };
  const weekStart = getWeekStart(calDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
  });
  const toDateStr = (d) => d.toISOString().split("T")[0];
  const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am–11pm
  const HOUR_H = 56; // px per hour
  const timeToY = (timeStr) => {
    const [h, m] = timeStr.split(":").map(Number);
    return (h - 6) * HOUR_H + (m / 60) * HOUR_H;
  };
  const now = new Date();
  const nowY = timeToY(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`);

  // ── MONTH VIEW HELPERS ──
  const year = calDate.getFullYear(), month = calDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startPad = firstDay.getDay();
  const calCells = [];
  for (let i = 0; i < startPad; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);
  const getDateStrM = (d) => d ? `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

  // ── NAVIGATION ──
  const prev = () => {
    if (view === "week") { const d = new Date(calDate); d.setDate(d.getDate() - 7); setCalDate(d); }
    else { setCalDate(new Date(year, month - 1, 1)); }
  };
  const next = () => {
    if (view === "week") { const d = new Date(calDate); d.setDate(d.getDate() + 7); setCalDate(d); }
    else { setCalDate(new Date(year, month + 1, 1)); }
  };
  const goToday = () => setCalDate(new Date());

  const navLabel = view === "week"
    ? `${weekDays[0].toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${weekDays[6].toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`
    : `${monthNames[month]} ${year}`;

  // agenda list
  const agendaSessions = filteredSessions
    .filter(s => !s.isCancelled)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  // series filtered
  const filteredSeries = data.series
    .filter(s => filterTeacher === "all" || String(s.teacherId) === filterTeacher)
    .filter(s => filterGroup === "all" || String(s.groupId) === filterGroup);

  // groups for legend (teacher sees only their groups)
  const legendGroups = userRole === "teacher" ? myTeacherGroups : data.groups;

  return (
    <div>
      {/* ── HEADER ── */}
      <div className="ph">
        <div>
          <div className="ph-title">{userRole === "student" ? "My Calendar" : userRole === "teacher" ? "My Schedule" : "Sessions"}</div>
          <div className="ph-sub">
            {filteredSessions.filter(s => s.status === "upcoming" && !s.isCancelled).length} upcoming ·{" "}
            {filteredSessions.filter(s => s.status === "completed").length} completed
            {hasFilters ? ` (filtered)` : ""}
          </div>
        </div>
        <div className="ph-right">
          {(userRole === "admin" || userRole === "teacher") && (
            <button className="btn btn-pr" onClick={() => setShowCreate(true)}>+ New Session</button>
          )}
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex ac gap8 mb12" style={{ flexWrap: "wrap" }}>
        <div className="tabs" style={{ margin: 0, flex: "none" }}>
          <div className={`tab ${view === "week" ? "active" : ""}`} onClick={() => setView("week")}>Week</div>
          <div className={`tab ${view === "month" ? "active" : ""}`} onClick={() => setView("month")}>Month</div>
          <div className={`tab ${view === "agenda" ? "active" : ""}`} onClick={() => setView("agenda")}>Agenda</div>
          {userRole === "admin" && <div className={`tab ${view === "series" ? "active" : ""}`} onClick={() => setView("series")}>🔁 Series</div>}
        </div>
        <div className="flex ac gap8" style={{ marginLeft: "auto" }}>
          <button className="btn btn-se btn-sm" onClick={goToday}>Today</button>
          <button className="btn-icon" onClick={prev}>←</button>
          <span style={{ fontWeight: 700, fontSize: 13, minWidth: 180, textAlign: "center", fontFamily: "var(--mono)" }}>{navLabel}</span>
          <button className="btn-icon" onClick={next}>→</button>
        </div>
      </div>

      {/* ── GROUP COLOR LEGEND ── */}
      {legendGroups.length > 0 && view !== "series" && (
        <div className="group-color-legend mb8">
          {legendGroups.map(g => (
            <div key={g.id} className="group-color-chip">
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: getGroupColor(g.id, data.groups) }} />
              {g.name}
            </div>
          ))}
        </div>
      )}

      {/* ── ADMIN FILTERS (agenda + series views) ── */}
      {userRole === "admin" && (view === "agenda" || view === "series") && (
        <div className="card mb12" style={{ padding: "10px 14px" }}>
          <div className="flex ac gap8" style={{ flexWrap: "wrap" }}>
            <select style={{ flex: 1, minWidth: 150 }} value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)}>
              <option value="all">👨‍🏫 All Teachers</option>
              {data.users.filter(u => u.role === "teacher").map(t => (
                <option key={t.id} value={String(t.id)}>{t.name}</option>
              ))}
            </select>
            <select style={{ flex: 1, minWidth: 150 }} value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
              <option value="all">👥 All Groups</option>
              {data.groups.map(g => (
                <option key={g.id} value={String(g.id)}>{g.name}</option>
              ))}
            </select>
            {view === "agenda" && (
              <select style={{ width: 140 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">All Status</option>
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            )}
            {hasFilters && (
              <button className="btn btn-se btn-sm" onClick={() => { setFilterTeacher("all"); setFilterGroup("all"); setFilterStatus("all"); }}>
                ✕ Clear
              </button>
            )}
            {hasFilters && (
              <span className="text-xs muted" style={{ marginLeft: 4 }}>
                {view === "agenda" ? `${agendaSessions.length} sessions` : `${filteredSeries.length} series`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          WEEK VIEW
      ══════════════════════════════════════════════ */}
      {view === "week" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {/* Day headers */}
          <div className="week-hdr-row">
            <div className="week-hdr-spacer" />
            {weekDays.map((d, i) => {
              const ds = toDateStr(d);
              const isToday = ds === todayStr;
              const daySessions = filteredSessions.filter(s => s.date === ds && !s.isCancelled);
              return (
                <div key={i} className={`week-hdr-day ${isToday ? "today" : ""}`}>
                  <div className="week-hdr-dayname">{DAY_SHORT[d.getDay()]}</div>
                  <div className="week-hdr-daynum">{d.getDate()}</div>
                  {daySessions.length > 0 && (
                    <div style={{ fontSize: 9, color: "var(--accent2)", fontWeight: 700 }}>{daySessions.length} session{daySessions.length > 1 ? "s" : ""}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Scrollable time grid */}
          <div className="week-scroll">
            <div style={{ display: "flex", position: "relative" }}>
              {/* Time labels */}
              <div className="week-time-col">
                {HOURS.map(h => (
                  <div key={h} className="week-time-slot">
                    <span className="week-time-label">{h === 12 ? "12pm" : h > 12 ? `${h-12}pm` : `${h}am`}</span>
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((d, di) => {
                const ds = toDateStr(d);
                const isToday = ds === todayStr;
                const daySessions = filteredSessions
                  .filter(s => s.date === ds && !s.isCancelled)
                  .sort((a, b) => a.time.localeCompare(b.time));

                return (
                  <div key={di} className={`week-day-col ${isToday ? "today" : ""}`} style={{ flex: 1, height: HOURS.length * HOUR_H, position: "relative" }}>
                    {/* Hour lines */}
                    {HOURS.map((h, hi) => (
                      <div key={h} className="week-hour-line" style={{ top: hi * HOUR_H }} />
                    ))}
                    {/* Half-hour lines */}
                    {HOURS.map((h, hi) => (
                      <div key={`h${h}`} style={{ position: "absolute", left: 0, right: 0, top: hi * HOUR_H + HOUR_H/2, borderTop: "1px dashed var(--border)", opacity: .4, pointerEvents: "none" }} />
                    ))}

                    {/* Now indicator */}
                    {isToday && nowY >= 0 && nowY <= HOURS.length * HOUR_H && (
                      <div className="week-now-line" style={{ top: nowY }}>
                        <div className="week-now-dot" />
                        <div className="week-now-bar" />
                      </div>
                    )}

                    {/* Session events */}
                    {daySessions.map((s, si) => {
                      const color = getGroupColor(s.groupId, data.groups);
                      const top = Math.max(0, timeToY(s.time || "09:00"));
                      const endT = s.endTime || `${parseInt(s.time)+1}:00`;
                      const bot = timeToY(endT);
                      const height = Math.max(22, bot - top);
                      const group = data.groups.find(g => g.id === s.groupId);
                      // simple column offset for overlapping events
                      const prevOverlap = daySessions.slice(0, si).filter(ps => {
                        const pt = timeToY(ps.time || "09:00");
                        const pe = timeToY(ps.endTime || `${parseInt(ps.time)+1}:00`);
                        return pt < bot && pe > top;
                      }).length;
                      const colW = prevOverlap > 0 ? "48%" : "96%";
                      const colL = prevOverlap > 0 ? "49%" : "2%";

                      return (
                        <div key={s.id} className="week-evt"
                          style={{
                            top, height: height - 2,
                            left: colL, width: colW,
                            background: `${color}20`,
                            color,
                            opacity: s.status === "cancelled" ? .4 : 1,
                          }}
                          onClick={() => setViewSess(s)}>
                          <div className="week-evt-title">{s.sessionMode === "online" ? "💻 " : ""}{s.title}</div>
                          {height > 32 && <div className="week-evt-time">{s.time}–{s.endTime || ""}</div>}
                          {height > 46 && group && <div style={{ fontSize: 9, opacity: .7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MONTH VIEW
      ══════════════════════════════════════════════ */}
      {view === "month" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="cal-grid" style={{ gap: 0 }}>
            {DAY_SHORT.map(d => <div key={d} className="cal-hdr">{d}</div>)}
            {calCells.map((day, i) => {
              const ds = getDateStrM(day);
              const daySessions = ds ? filteredSessions.filter(s => s.date === ds && !s.isCancelled) : [];
              const isToday = ds === todayStr;
              return (
                <div key={i} className={`cal-day ${!day ? "empty" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => day && (daySessions.length > 0 ? setDayDetail({ day, date: ds, sessions: daySessions }) : null)}>
                  {day && (
                    <>
                      <div className="cal-day-num">{day}</div>
                      {daySessions.slice(0, 3).map((s, si) => {
                        const color = getGroupColor(s.groupId, data.groups);
                        return (
                          <div key={si} className="cal-evt"
                            style={{ background: `${color}20`, color, borderLeftColor: color }}
                            onClick={e => { e.stopPropagation(); setViewSess(s); }}>
                            {s.sessionMode === "online" ? "💻 " : ""}{s.time} {s.title}
                          </div>
                        );
                      })}
                      {daySessions.length > 3 && <div className="cal-more">+{daySessions.length - 3} more</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          AGENDA VIEW
      ══════════════════════════════════════════════ */}
      {view === "agenda" && (
        <div>
          {agendaSessions.length === 0
            ? <div className="empty"><div className="empty-icon">📅</div><div className="empty-title">No sessions scheduled</div></div>
            : (() => {
              const grouped = {};
              agendaSessions.forEach(s => { if (!grouped[s.date]) grouped[s.date] = []; grouped[s.date].push(s); });
              return Object.entries(grouped).map(([date, sessions]) => {
                const d = new Date(date + "T12:00:00");
                const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
                const isToday = date === todayStr;
                return (
                  <div key={date}>
                    <div className="agenda-date-hdr">
                      <span style={{ color: isToday ? "var(--accent2)" : "inherit" }}>{isToday ? "📍 Today — " : ""}{label}</span>
                    </div>
                    {sessions.map(s => {
                      const color = getGroupColor(s.groupId, data.groups);
                      const group = data.groups.find(g => g.id === s.groupId);
                      const teacher = data.users.find(u => u.id === s.teacherId);
                      return (
                        <div key={s.id} className={`agenda-evt ${s.isCancelled ? "cancelled" : ""}`} onClick={() => setViewSess(s)}>
                          <div className="agenda-evt-dot" style={{ background: color }} />
                          <div className="agenda-evt-time">{s.time}{s.endTime ? ` – ${s.endTime}` : ""}</div>
                          <div className="agenda-evt-body">
                            <div className="agenda-evt-title">{s.sessionMode === "online" ? "💻 " : "🏫 "}{s.title}</div>
                            <div className="agenda-evt-meta">
                              {group?.name}
                              {userRole !== "teacher" && teacher ? ` · ${teacher.name.split(" ")[0]}` : ""}
                              {` · ${s.duration}min`}
                              {s.seriesId ? " · 🔁 Recurring" : ""}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            <Badge status={s.status} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()
          }
        </div>
      )}

      {view === "series" && userRole === "admin" && (
        <SeriesManager data={data} setData={setData} filteredSeries={filteredSeries} />
      )}

      {/* Day detail modal (month view click) */}
      {dayDetail && (
        <Modal open={!!dayDetail} onClose={() => setDayDetail(null)} title={`${new Date(dayDetail.date + "T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}`}>
          {dayDetail.sessions.map(s => {
            const color = getGroupColor(s.groupId, data.groups);
            const group = data.groups.find(g => g.id === s.groupId);
            return (
              <div key={s.id} className="agenda-evt" onClick={() => { setDayDetail(null); setViewSess(s); }}>
                <div className="agenda-evt-dot" style={{ background: color }} />
                <div className="agenda-evt-time">{s.time}{s.endTime ? `–${s.endTime}` : ""}</div>
                <div className="agenda-evt-body">
                  <div className="agenda-evt-title">{s.title}</div>
                  <div className="agenda-evt-meta">{group?.name} · {s.duration}min{s.seriesId ? " · 🔁" : ""}</div>
                </div>
                <Badge status={s.status} />
              </div>
            );
          })}
        </Modal>
      )}

      {/* Session detail */}
      {viewSess && (
        <SessionDetailModal
          sessionId={viewSess.id}
          data={data} setData={setData}
          onClose={() => setViewSess(null)}
          userRole={userRole} userId={myId}
          onComplete={completeSession} onCancel={cancelSession}
          onSkip={skipDate} onMarkAttendance={markAttendance}
          onScopePick={setScopePicker}
        />
      )}

      {scopePicker && (
        <EditScopePicker open={!!scopePicker} onClose={() => setScopePicker(null)}
          isSeries={!!scopePicker.session?.seriesId}
          onSelect={(scope) => { if (scopePicker.action === "cancel") cancelSession(scope, scopePicker.session); setScopePicker(null); }} />
      )}

      {/* Create session modal — teacher only sees their own groups, pre-filled as teacher */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Schedule Session" lg>
        <RecurringSessionForm
          groups={userRole === "teacher" ? myTeacherGroups : data.groups}
          teachers={userRole === "teacher"
            ? data.users.filter(u => u.id === myId)
            : data.users.filter(u => u.role === "teacher")}
          defaultTeacherId={userRole === "teacher" ? myId : null}
          onSave={handleCreateSession}
          onClose={() => setShowCreate(false)} />
      </Modal>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function LandingPage({ onGoLogin, onGoSignup }) {
  const [faqOpen,     setFaqOpen]     = useState(null);
  const [activeTesti, setActiveTesti] = useState(0);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  useEffect(() => {
    const handle = () => setVw(window.innerWidth);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);
  const mob = vw < 640;
  const tab = vw < 1024;

  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAAAILUlEQVR42u2Za4xcZRnH/8/znjP37c52u0u77dbtjd7ZNi1Ea4nByKWlYKRgscWUqiGBBDVWQ1Q+iImX6BdDYqQKCikgUUHwhoR4IaDdQoXSVsrF3Q3usoXddndnZ2bPmXPO+zx+ONNSlQ92duy2ybyfZuadzDy/930u/+c5pF98H87nxTjPVwOgAdAAaAA0ABoA5/VyzsJ/iEIUgALEBKbzBEABETCBXWLnpNWhSqR1ZHD+T6ZbgWNg0gzB6yPhvrcq/YWoJcUfuzAzv8VooFQnBqq7GrUCY4AkF8vy2Ove3r8Xnx3wA6vxbmvaefKG9vUdCQ3rcw9OfX0dgMnwRFn2HJj4wUvF/vEg3jIMAhymE170jb8WHt/WLqGeWy5kBcYlMO09WL7rufHe8QCAoSqYFdDJt81JBkEVOHduIBJ10mZgzN7+9Ikn3igDcBiiiB2HCYYQCSpWZ2edOz/YXC//qQOAKpTgZMwvX/Fufer4O+XIMFQRxUfOUK2m0azL1y3N3rUxv6DFaHBuAIiCDYj5jqfHv7N/LPZ1K2CCw4gEVgDQirbUjpXZG5dlFrYaRCrBuZFGRcEOFUPd/sTwb3rLhhAXK6b4yCmTMFd3uTuXJ6+Y77hpAxtZn4gNk53+QqYKMpgI9apHhvcNeQkDUbJxGgKvmOVuXyg3rsgtWjgP+Q6YpjAMuTjMo/8kv4B0M4ihMq0AADF94vGRfUNe2iEvUkCThrYsnbFrMS5flEtccjW6t0Zz16KpzRBcQENPj72qz/+M9u0lBZxEXRicmnIOnDQ/+FLpd31lAF6kTQnesTJ3+8UtK3IldK3XLV+PFlzC8a+LhQhA5KZp/lrMXyvdm/GTW8gvwnGhOm0xMOxJPmUW592PLsnctDLT1Z5G4Xi4+uO0/XtOIuWIhSqMAzaAOXlxArG85FLZuQf3bCO40yklFDjhyayMQZJg2RZGdf11Zte9FJ86MYg09HX/T/Hmi0hmsHEXz14GFYiocfSBW/jAo8jkIXZ6boCAWVmGaOQRhyXqXMU77iZVQGPrZXwI9+6k3h5yk/CL0v833f17IgMCqerqTXjh59NcB9SCCA5DSfX6b1MiA7FgAxUVwUO3c99+5OdAFYkMBWWogglKIKL8HDjJqcfAlDoyIoANvIKu3kSLN1StFwtife3PdPRPmHEBogDEKJ3Q7i1k3KrDqCLwp+g89WspifCBT8Z17GR0gP6xj4jjQo3xIbviI3T556ECZqiASAdehg1BPJ0uBCKEvs5aQIvfDxD4XWvUSVL5BKBqXNl4M2/9JiWzUIG1MK5Wyuh5GMks1E4vACP0de5KSmShUj1OMgDo0k9JHOnLPsxd60gFEoEdGFa/qHtv45FepJun7kVTVKMEsWhbSHGOrwIQAMq10qYv/RsqsU6O65Gn8Mfv87HX6mJ9nfqBdPN7ZSgBsQIoHteRXgweRv/z1H+ARwdABBBsCDKAngMAUeW9tB7L0T/gmR/R0CtUHKHAAzFSTTCuNrXpvJXUf4ACD+xMkWGKAAoiFN4+WdlOO/vBw9izg22ERBpuGskc2EFpROYsx2fu57ZF8pcH6JEvTGclrp60k8BbR1SFTiVEVRA09Cn0kW0BCCoIKvAmZMHFuOVBzndALLV2ngOjRRUkMjR4RAcOIZZAQFyJuWudXrVbQRoFCkjLXNl8B332V5zvQFQBG335t5Do9LifprkQG0yOy5pr6NP3k41gzOnDBi0cw8QwElnMnEduCgBsCOPKsaP44U1cKaM8imQWgQfj1hYP5msb8lP1okQGA4ck18oL1kMkjuD4fig1g5pnU24mGQc2hAqMK5NjuPtaXXstjKNsqDwqc5aTRIj8Gq6iHllIhFJN/OhXrQ34stuqJogFFHFXQAQ2MC4AeesIHv4cv/2anRiWNdfARsJGbaAvPmH6ehAXxLM+F1IQUSJjHrtTXn1GL7uVFm8gJ/EfzYOO9GnPQ/zsjymsINWMVA6T4xT6sBGcJBXeBrs1uFBNMUCEU3O10/UwO/AKIJY5S9HZjbaFlMlDrI4PYfAQvXmQyieQmhFHOQBEAZJZlMeQa4UNapPWZw5AVFXIqiDATUGkKhaiCtiADUIfUQUiIHrXhdxUtQFQqfp63P0YF4EHsXCSNdwAn7H1ga+zL7Q777HbvqvNszE2hEoJlRKKI5pIR1u+Yi++AX4JThJuCiaBZBaA5mZFV+7WKEBpBIEHr4DyKKIKQh+jAzK/217/LQSTZyWImRD4aJkH2y/dW3TdVh7pg5PQfAcNHkZnt77+rN24EyB4BbQvolef0VVXYuAgRb52XiQXbabDT2r7Ys3PMQd/rW0LdWYn/CIFk1AL4jMV2GeaRgkAmHHRZr5vF7rWY2YnmmdjfjeCSSz9EPX1sEnoxpsxMYyO5dq5BpGH7i3wi5TvwKor8M4buuZamtFOlZKu3oSWebAB8h1UOk79L9TQZJ65C9lAW+ZqMgsbaipHffv5F19GMIlEBiP9ANEbz6FSxtgg+SXyi5jRTqMDyLVCBb09uGAJ9fbAK2CygEoZBG3r0txMbemsxtVZyUKsxqEoUCdBqgh9dVMwLvkTmsyRV9B0M0kEhboJmixorhVeASZJQUmb2qk4osksQAh9OO6pMSPZsIZHBrVJCa2WW5VqJykCKMhALdiBjUAEAkQQ12B2oArmWEpALEDVHHUqJdekiGorZATi6vynKj8JoOonKuCTnUrVbrcqvOPXp7RG1egpzdq59ur7P+3qf325Po/G6jpWmdbVAGgANAAaAA2ABkADoAEwhfUv3I/mqu8bt5UAAAAASUVORK5CYII=";

  const whatsapp = "https://wa.me/+212604007232";
  const phone    = "+212 6 04 00 72 32";

  const faqs = [
    { q:"How do I register?",                                     a:"Simply click 'Register Now' above. A member of our team will contact you via WhatsApp or email to schedule your free trial session on Google Meet." },
    { q:"How do I attend classes?",                               a:"After confirming your registration, we will send you a schedule and a Google Meet link via WhatsApp or email before each session." },
    { q:"How many sessions per month?",                           a:"We offer three sessions per week — approximately 12 per month. Sessions run Mon / Wed / Fri or Tue / Thu / Sat depending on your chosen time slot." },
    { q:"How long is the program and do I get a certificate?",    a:"Yes! You receive a certificate upon completing the 6-month program. Progress is tracked every step of the way." },
    { q:"Can I change my teacher?",                               a:"Absolutely. There is no obligation to stay with the same teacher. You can switch whenever you feel it is right for you." },
  ];

  const testimonials = [
    { name:"Marie Petit",      role:"IT Director, Paris",  rating:5, text:"Every lesson my English level improves. By the end of each class I feel more confident — I never thought I would learn this language. Thank you so much for your efforts and every minute dedicated to explanation. ❤️" },
    { name:"Bouchera Lkhlage", role:"Pharmacist",           rating:5, text:"One of the best English teachers I've known — a high level and an elegant, enjoyable teaching method. I wish you great success, dear teacher." },
    { name:"Tarik Brahmi",     role:"Engineer",             rating:5, text:"Truly one of the best English teachers. A real educator with a refined and elegant style in explanation and communication, without equal. Thanks to him I have made great progress." },
  ];

  const WHY = [
    { icon:"🎯", title:"Your Perfect Tutor",       desc:"30+ professional, certified teachers who love their craft — they'll guide you through English with varied, stimulating methods." },
    { icon:"🔄", title:"Switch Any Time",           desc:"You're never locked in. Change your teacher whenever you feel ready — zero obligation, zero hassle." },
    { icon:"💻", title:"All-in-One Platform",       desc:"A realistic, immersive online English learning environment — everything you need in one place." },
    { icon:"📈", title:"Track Your Progress",       desc:"See exactly how far you've come and the pace at which you're advancing through each CEFR level." },
    { icon:"📝", title:"Lesson Notes",              desc:"Your teacher takes notes during every lesson. Never lose an important point — review them any time." },
    { icon:"📖", title:"Personal Vocabulary List",  desc:"Build your own glossary of words to remember. Your teacher adds to it too — a living record of your growth." },
  ];

  const STEPS = [
    { n:"1", icon:"📋", title:"Register on our platform",         desc:"Fill out a quick form. A team member will get in touch to confirm your free trial." },
    { n:"2", icon:"🎓", title:"Discover your level — free trial", desc:"Join a free trial session on Google Meet. Meet your teacher and experience the method." },
    { n:"3", icon:"🚀", title:"Join your online sessions",         desc:"Get your personalised schedule and start your journey toward fluent English." },
  ];

  const SERVICES = [
    { icon:"👨‍🏫", title:"Professional Teachers",     desc:"Highly qualified tutors experienced in distance learning — innovative methods that make every lesson stimulating and effective." },
    { icon:"📅",  title:"Three Sessions per Week",    desc:"3 sessions / week, ~12 per month. Mon / Wed / Fri or Tue / Thu / Sat — you choose the slot that fits your life." },
    { icon:"🗣️", title:"Communication Sessions",      desc:"A dedicated weekly communication session — diverse topics, natural flow, real confidence." },
    { icon:"🎯",  title:"Personalised Support",        desc:"Ask anything about your courses — grammar, vocabulary, exam prep. Direct, tailored guidance every step of the way." },
  ];

  const TEAM = [
    { initials:"OL", name:"Oualid Lamti",    role:"Expert Manager",    color:"#f97316" },
    { initials:"JL", name:"Jessica Lahr",    role:"Teacher Coach",     color:"#6366f1" },
    { initials:"NM", name:"Nouhaila Moussia",role:"Expert Consultant",  color:"#22c55e" },
  ];

  const PLANS = [
    { name:"Individual",   price:"600 DH", period:"/month",    featured:false, features:["3 sessions per week","1-on-1 with your teacher","Extra sessions available","24/7 Premium support"] },
    { name:"Group",        price:"650 DH", period:"/3 months", featured:true,  features:["Up to 5 students","3 sessions per week","Communication sessions","Cambridge courses"] },
    { name:"Professional", price:"850 DH", period:"/month",    featured:false, features:["3 sessions per week","Business English","Professional communication","Practical sessions"] },
  ];

  // ── responsive style helpers ───────────────────────────────────────────────
  const sec  = { padding: mob ? "60px 20px" : tab ? "72px 5%" : "96px 5%", width:"100%", boxSizing:"border-box" };
  const wrap = { maxWidth:1140, margin:"0 auto" };
  const lbl  = { fontSize:11, fontWeight:800, letterSpacing:3, textTransform:"uppercase", color:"#f97316", marginBottom:12, display:"block" };
  const h2   = { fontSize: mob ? 26 : tab ? 32 : 42, fontWeight:900, lineHeight:1.15, color:"#fff", marginBottom:0 };
  const mut  = { color:"rgba(255,255,255,.45)", fontSize:14, lineHeight:1.75 };
  const grid2 = { display:"grid", gridTemplateColumns: tab ? "1fr" : "1fr 1fr", gap: mob ? 32 : 48, alignItems:"center" };
  const grid3 = { display:"grid", gridTemplateColumns: mob ? "1fr" : tab ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: mob ? 16 : 24 };
  const gridWhy = { display:"grid", gridTemplateColumns: mob ? "1fr" : tab ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: mob ? 16 : 20 };

  return (
    <div className="lp">
      <div className="lp-orb1"/><div className="lp-orb2"/><div className="lp-orb3"/>
      <div className="lp-grid"/>

      {/* ━━━ NAV ━━━ */}
      <nav className="lp-nav" style={{ padding: mob ? "14px 20px" : "18px 5%" }}>
        <div className="lp-logo-box">
          <div className="lp-logo-badge">
            <img src={LOGO} alt="ELOC" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          </div>
          <div>
            <div className="lp-logo-text">ELOC</div>
            <div className="lp-logo-sub">International</div>
          </div>
        </div>

        {/* Desktop nav links */}
        {!tab && (
          <ul className="lp-nav-links">
            {["About","Services","Team","Pricing","FAQ"].map(l=>(
              <li key={l}><a href={"#lp-"+l.toLowerCase()}>{l}</a></li>
            ))}
          </ul>
        )}

        {/* Desktop action buttons */}
        {!mob && (
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {!tab && (
              <a href={`tel:${phone}`} style={{display:"flex",alignItems:"center",gap:7,color:"rgba(255,255,255,.6)",textDecoration:"none",fontSize:12,fontWeight:600}}>
                📞 {phone}
              </a>
            )}
            <button className="lp-btn-signup" onClick={onGoSignup} style={{padding:"9px 18px",fontSize:13}}>Register Free</button>
            <button className="lp-btn-login"  onClick={onGoLogin}  style={{padding:"9px 18px",fontSize:13}}>Sign In</button>
          </div>
        )}

        {/* Mobile hamburger */}
        {mob && (
          <button onClick={()=>setMenuOpen(o=>!o)} style={{background:"none",border:"1px solid rgba(255,255,255,.2)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:18,cursor:"pointer",lineHeight:1}}>
            {menuOpen ? "✕" : "☰"}
          </button>
        )}
      </nav>

      {/* Mobile dropdown menu */}
      {mob && menuOpen && (
        <div style={{background:"rgba(10,10,10,.97)",borderBottom:"1px solid rgba(255,255,255,.08)",padding:"20px",display:"flex",flexDirection:"column",gap:14,position:"sticky",top:52,zIndex:99}}>
          {["About","Services","Team","Pricing","FAQ"].map(l=>(
            <a key={l} href={"#lp-"+l.toLowerCase()} onClick={()=>setMenuOpen(false)}
              style={{color:"rgba(255,255,255,.7)",textDecoration:"none",fontSize:15,fontWeight:600,padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
              {l}
            </a>
          ))}
          <div style={{display:"flex",gap:10,marginTop:6}}>
            <button className="lp-btn-signup" onClick={()=>{setMenuOpen(false);onGoSignup();}} style={{flex:1,justifyContent:"center",padding:"11px 0",fontSize:14}}>Register Free</button>
            <button className="lp-btn-login"  onClick={()=>{setMenuOpen(false);onGoLogin();}}  style={{flex:1,justifyContent:"center",padding:"11px 0",fontSize:14}}>Sign In</button>
          </div>
        </div>
      )}

      {/* ━━━ HERO ━━━ */}
      <div className="lp-hero" id="lp-about" style={{padding: mob ? "72px 20px 60px" : "100px 24px 80px", minHeight: mob ? "auto" : "90vh"}}>
        <div className="lp-badge"><span className="lp-badge-dot"/>English Language Online Center</div>
        <h1 className="lp-headline" style={{fontSize: mob ? 36 : tab ? 52 : undefined, letterSpacing: mob ? -1 : undefined}}>
          Find the Best English<br/><span className="lp-gradient-text">Program for You</span>
        </h1>
        <p className="lp-tagline" style={{fontSize: mob ? 15 : undefined}}>
          Professional tutors · Flexible schedules · Real results from A1 to C2 — all from the comfort of your home.
        </p>

        <div className="lp-cta-row" style={{flexDirection: mob ? "column" : "row", width: mob ? "100%" : undefined}}>
          <button className="lp-btn-signup" onClick={onGoSignup} style={{fontSize:16, padding: mob ? "15px 0" : "17px 42px", width: mob ? "100%" : undefined, justifyContent:"center"}}>🎓 Register Now</button>
          <button className="lp-btn-login"  onClick={onGoLogin}  style={{fontSize:16, padding: mob ? "15px 0" : "17px 42px", width: mob ? "100%" : undefined, justifyContent:"center"}}>🔐 Login to Dashboard</button>
        </div>

        {/* Rating badges */}
        <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:48}}>
          {[{e:"⭐",l:"Google",s:"4.9 / 5"},{e:"✅",l:"Trustpilot",s:"Excellent"},{e:"👍",l:"Facebook",s:"Recommended"}].map((r,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding: mob ? "8px 14px" : "10px 18px"}}>
              <span style={{fontSize:18}}>{r.e}</span>
              <div>
                <div style={{fontSize:10,color:"rgba(255,255,255,.4)",letterSpacing:.5}}>{r.l}</div>
                <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{r.s}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="lp-stats" style={{
          padding: mob ? "24px 20px" : "36px 48px",
          gap: mob ? 16 : 40,
          borderRadius: mob ? 16 : 24
        }}>
          {[{val:"500+",label:"Students Enrolled"},{val:"30+",label:"Expert Teachers"},{val:"A1–C2",label:"All CEFR Levels"},{val:"4.9★",label:"Average Rating"}].map((s,i)=>(
            <div key={i} style={{display:"contents"}}>
              {i>0&&<div className="lp-stat-div" style={{height: mob ? 28 : 44}}/>}
              <div className="lp-stat">
                <div className="lp-stat-val" style={{fontSize: mob ? 20 : 30}}>{s.val}</div>
                <div className="lp-stat-label">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ WHY ELOC ━━━ */}
      <div style={sec} id="lp-services">
        <div style={wrap}>
          <div style={{textAlign:"center",marginBottom: mob ? 36 : 56}}>
            <span style={lbl}>Why Choose ELOC</span>
            <h2 style={h2}>Everything you need to master English</h2>
          </div>
          <div style={gridWhy}>
            {WHY.map((w,i)=>(
              <div key={i} className="lp-card">
                <div style={{fontSize:32,marginBottom:14}}>{w.icon}</div>
                <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:10}}>{w.title}</div>
                <div style={mut}>{w.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ HOW IT WORKS ━━━ */}
      <div style={{...sec,background:"rgba(255,255,255,.015)"}}>
        <div style={wrap}>
          <div style={{textAlign:"center",marginBottom: mob ? 36 : 56}}>
            <span style={lbl}>How ELOC Works</span>
            <h2 style={h2}>3 steps to join your online sessions</h2>
          </div>
          <div style={grid3}>
            {STEPS.map((s,i)=>(
              <div key={i} style={{textAlign:"center",padding: mob ? "24px 16px" : "8px"}}>
                <div style={{width:64,height:64,borderRadius:99,background:"linear-gradient(135deg,#f97316,#e05c00)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:24,fontWeight:900,color:"#fff",boxShadow:"0 8px 32px rgba(249,115,22,.4)"}}>
                  {s.n}
                </div>
                <div style={{fontSize:24,marginBottom:12}}>{s.icon}</div>
                <div style={{fontSize:16,fontWeight:800,color:"#fff",marginBottom:10}}>{s.title}</div>
                <div style={{...mut,maxWidth:260,margin:"0 auto"}}>{s.desc}</div>
              </div>
            ))}
          </div>
          <div style={{textAlign:"center",marginTop:48}}>
            <button className="lp-btn-signup" onClick={onGoSignup} style={{fontSize:15,padding:"13px 36px"}}>🎓 Start for Free</button>
          </div>
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ SERVICES — responsive 3-col / stacked ━━━ */}
      <div style={sec}>
        <div style={wrap}>
          <div style={{textAlign:"center",marginBottom: mob ? 36 : 56}}>
            <span style={lbl}>Best Teaching Methods</span>
            <h2 style={h2}>Online lessons with a dedicated tutor to boost your language &amp; communication skills</h2>
          </div>

          {tab ? (
            /* Mobile/Tablet: simple 2-col or 1-col cards */
            <div style={{display:"grid",gridTemplateColumns: mob ? "1fr" : "repeat(2,1fr)",gap:20}}>
              {SERVICES.map((sv,i)=>(
                <div key={i} className="lp-card" style={{display:"flex",gap:16,alignItems:"flex-start"}}>
                  <div style={{width:52,height:52,borderRadius:14,background:["rgba(249,115,22,.12)","rgba(99,102,241,.1)","rgba(34,197,94,.1)","rgba(245,158,11,.1)"][i],display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>
                    {sv.icon}
                  </div>
                  <div>
                    <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:8}}>{sv.title}</div>
                    <div style={{...mut,fontSize:13}}>{sv.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop: 3-col with center visual */
            <div style={{display:"grid",gridTemplateColumns:"1fr 260px 1fr",gap:32,alignItems:"center"}}>
              {/* LEFT */}
              <div style={{display:"flex",flexDirection:"column",gap:36}}>
                {SERVICES.slice(0,2).map((sv,i)=>(
                  <div key={i} style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                    <div style={{width:56,height:56,borderRadius:16,background:i===0?"rgba(249,115,22,.12)":"rgba(99,102,241,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,boxShadow:i===0?"0 0 20px rgba(249,115,22,.2)":"0 0 20px rgba(99,102,241,.15)"}}>
                      {sv.icon}
                    </div>
                    <div>
                      <div style={{fontSize:16,fontWeight:800,color:"#fff",marginBottom:8}}>{sv.title}</div>
                      <div style={{...mut,fontSize:13}}>{sv.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* CENTER visual */}
              <div style={{borderRadius:24,overflow:"hidden",boxShadow:"0 32px 80px rgba(0,0,0,.7)",border:"1px solid rgba(255,255,255,.08)"}}>
                <div style={{background:"linear-gradient(160deg,#0e1f32,#1a3350)",minHeight:380,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:"36px 24px",textAlign:"center"}}>
                  <div style={{fontSize:60,filter:"drop-shadow(0 4px 16px rgba(0,0,0,.6))"}}>🇬🇧</div>
                  <div style={{fontSize:44,marginTop:-12}}>📚</div>
                  <div style={{background:"linear-gradient(135deg,#f97316,#e05c00)",borderRadius:16,padding:"14px 22px",marginTop:8,boxShadow:"0 6px 28px rgba(249,115,22,.5)"}}>
                    <div style={{fontSize:10,fontWeight:900,letterSpacing:2.5,textTransform:"uppercase",color:"#fff",lineHeight:1.7}}>NOW OPEN<br/>FOR ENROLLMENT</div>
                  </div>
                  <div style={{background:"rgba(255,255,255,.07)",borderRadius:99,padding:"9px 22px",fontSize:13,fontWeight:700,color:"#fff",border:"1px solid rgba(255,255,255,.13)"}}>
                    🎓 Free Trial Session
                  </div>
                </div>
              </div>
              {/* RIGHT */}
              <div style={{display:"flex",flexDirection:"column",gap:36}}>
                {SERVICES.slice(2,4).map((sv,i)=>(
                  <div key={i} style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                    <div style={{width:56,height:56,borderRadius:16,background:i===0?"rgba(34,197,94,.1)":"rgba(245,158,11,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>
                      {sv.icon}
                    </div>
                    <div>
                      <div style={{fontSize:16,fontWeight:800,color:"#fff",marginBottom:8}}>{sv.title}</div>
                      <div style={{...mut,fontSize:13}}>{sv.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ TEAM + TESTIMONIALS ━━━ */}
      <div style={{...sec,background:"rgba(255,255,255,.015)"}} id="lp-team">
        <div style={wrap}>
          <div style={{textAlign:"center",marginBottom: mob ? 36 : 52}}>
            <span style={lbl}>Expert Teachers</span>
            <h2 style={h2}>Meet our team of experts</h2>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,marginTop:14}}>
              {"★★★★★".split("").map((s,i)=><span key={i} style={{color:"#f59e0b",fontSize:18}}>{s}</span>)}
              <span style={{fontSize:13,color:"rgba(255,255,255,.5)",marginLeft:8}}>4.9 out of 5</span>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns: mob ? "1fr" : "repeat(3,1fr)",gap: mob ? 16 : 24,marginBottom: mob ? 40 : 64}}>
            {TEAM.map((t,i)=>(
              <div key={i} className="lp-card" style={{textAlign:"center",padding: mob ? "28px 16px" : "40px 24px"}}>
                <div style={{width:76,height:76,borderRadius:99,background:`linear-gradient(135deg,${t.color},${t.color}88)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:900,color:"#fff",margin:"0 auto 18px",boxShadow:`0 8px 28px ${t.color}44`}}>
                  {t.initials}
                </div>
                <div style={{fontSize:10,color:t.color,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>{t.role}</div>
                <div style={{fontSize:17,fontWeight:900,color:"#fff"}}>{t.name}</div>
              </div>
            ))}
          </div>

          {/* Testimonials */}
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,.45)"}}>Why people trust ELOC</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns: mob ? "1fr" : tab ? "repeat(2,1fr)" : "repeat(3,1fr)",gap: mob ? 16 : 20}}>
            {testimonials.map((t,i)=>(
              <div key={i} className="lp-card" style={{cursor:"pointer",borderColor:activeTesti===i?"rgba(249,115,22,.4)":"",boxShadow:activeTesti===i?"0 12px 40px rgba(249,115,22,.15)":"",transform:activeTesti===i?"translateY(-4px)":""}}
                onClick={()=>setActiveTesti(i)}>
                <div style={{fontSize:32,color:"rgba(249,115,22,.4)",lineHeight:1,marginBottom:12}}>"</div>
                <div style={{...mut,fontStyle:"italic",marginBottom:18,fontSize:13,lineHeight:1.8}}>{t.text}</div>
                <div style={{display:"flex",gap:3,marginBottom:12}}>
                  {"★★★★★".split("").map((_,j)=><span key={j} style={{color:"#f59e0b",fontSize:13}}>★</span>)}
                </div>
                <div style={{borderTop:"1px solid rgba(255,255,255,.07)",paddingTop:14,display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:36,height:36,borderRadius:99,background:"linear-gradient(135deg,#f97316,#e05c00)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:"#fff",flexShrink:0}}>
                    {t.name[0]}
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{t.name}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ PRICING ━━━ */}
      <div style={sec} id="lp-pricing">
        <div style={wrap}>
          <div style={{textAlign:"center",marginBottom:16}}>
            <span style={lbl}>Plans &amp; Pricing</span>
            <h2 style={h2}>Best possible rates.</h2>
            <p style={{...mut,marginTop:12,textAlign:"center"}}>No credit card required to start.</p>
          </div>

          {/* 40% off banner */}
          <div style={{background:"linear-gradient(135deg,rgba(249,115,22,.18),rgba(249,115,22,.06))",border:"1px solid rgba(249,115,22,.3)",borderRadius:16,padding: mob ? "18px 20px" : "18px 28px",display:"flex",flexDirection: mob ? "column" : "row",alignItems: mob ? "flex-start" : "center",justifyContent:"space-between",gap:12,margin: "28px 0 40px"}}>
            <div style={{fontSize: mob ? 14 : 16,fontWeight:800,color:"#fff"}}>🎉 Register now and get <span style={{color:"#f97316"}}>40% OFF</span> your first month!</div>
            <button className="lp-btn-signup" onClick={onGoSignup} style={{padding:"11px 24px",fontSize:13,flexShrink:0}}>Claim Offer →</button>
          </div>

          <div style={grid3}>
            {PLANS.map((p,i)=>(
              <div key={i} className={`lp-price-card${p.featured?" featured":""}`}>
                {p.featured&&(
                  <div style={{position:"absolute",top:16,right:16,background:"#f97316",color:"#fff",fontSize:9,fontWeight:900,letterSpacing:1.5,textTransform:"uppercase",padding:"4px 10px",borderRadius:99}}>Most Popular</div>
                )}
                <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.5)",letterSpacing:1,textTransform:"uppercase",marginBottom:16}}>{p.name}</div>
                <div style={{marginBottom:20}}>
                  <span style={{fontSize: mob ? 32 : 40,fontWeight:900,color:"#fff",letterSpacing:-2}}>{p.price}</span>
                  <span style={{fontSize:13,color:"rgba(255,255,255,.4)",marginLeft:6}}>{p.period}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:28}}>
                  {p.features.map((f,j)=>(
                    <div key={j} style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:"rgba(255,255,255,.7)"}}>
                      <span style={{color:"#22c55e",fontWeight:800,flexShrink:0}}>✓</span>{f}
                    </div>
                  ))}
                </div>
                <button className={p.featured?"lp-btn-signup":"lp-btn-login"} onClick={onGoSignup}
                  style={{width:"100%",justifyContent:"center",padding:"12px 0",fontSize:13}}>
                  Book Your Sessions
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ FAQ ━━━ */}
      <div style={{...sec,background:"rgba(255,255,255,.015)"}} id="lp-faq">
        <div style={{...wrap,maxWidth:760}}>
          <div style={{textAlign:"center",marginBottom: mob ? 36 : 52}}>
            <span style={lbl}>FAQ</span>
            <h2 style={h2}>Find answers instantly</h2>
          </div>
          {faqs.map((f,i)=>(
            <div key={i} className="lp-faq-item" onClick={()=>setFaqOpen(faqOpen===i?null:i)}>
              <div className="lp-faq-q" style={{fontSize: mob ? 14 : 15}}>
                <span>{f.q}</span>
                <span style={{fontSize:22,color:"#f97316",flexShrink:0,transition:"transform .25s",display:"inline-block",transform:faqOpen===i?"rotate(45deg)":""}}>+</span>
              </div>
              {faqOpen===i&&<div className="lp-faq-a open">{f.a}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="lp-divider"/>

      {/* ━━━ CONTACT ━━━ */}
      <div style={sec}>
        <div style={wrap}>
          <div style={grid2}>
            {/* Left */}
            <div>
              <span style={lbl}>Contact Us</span>
              <h2 style={h2}>We'll focus on your goals, background &amp; needs.</h2>
              <p style={{...mut,marginTop:16,marginBottom:32}}>Our team is ready to help you choose the right programme and get started with a free trial session — no commitment, no payment required.</p>
              <button className="lp-btn-signup" onClick={onGoSignup} style={{fontSize:15,padding:"14px 36px",marginBottom:28,width: mob ? "100%" : undefined,justifyContent:"center"}}>
                🎓 Book Your Free Session
              </button>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <a href={whatsapp} target="_blank" rel="noreferrer"
                  style={{display:"flex",alignItems:"center",gap:9,background:"rgba(37,211,102,.1)",border:"1px solid rgba(37,211,102,.25)",borderRadius:12,padding:"11px 18px",textDecoration:"none",color:"#fff",fontSize:13,fontWeight:700}}>
                  <span style={{fontSize:18}}>💬</span> WhatsApp Us
                </a>
                <a href={`tel:${phone}`}
                  style={{display:"flex",alignItems:"center",gap:9,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"11px 18px",textDecoration:"none",color:"#fff",fontSize:13,fontWeight:700}}>
                  <span style={{fontSize:18}}>📞</span> {phone}
                </a>
              </div>
            </div>

            {/* Right */}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {[
                { icon:"📍", title:"Address", lines:["Bureau 19 Jawhara","Dcheira El Jihadia 80000"] },
                { icon:"📞", title:"Phone",   lines:["Home: 06 04 00 72 32","Office: 06 20 47 63 55"] },
                { icon:"✉️", title:"Email",   lines:["contact@elocinternational.com","support@elocinternational.com"] },
              ].map((ct,i)=>(
                <div key={i} style={{display:"flex",gap:16,alignItems:"flex-start",padding:"18px 20px",background:"rgba(255,255,255,.03)",borderRadius:14,border:"1px solid rgba(255,255,255,.07)"}}>
                  <div style={{fontSize:24,flexShrink:0}}>{ct.icon}</div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:"#f97316",textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>{ct.title}</div>
                    {ct.lines.map((l,j)=><div key={j} style={{fontSize:13,color:"rgba(255,255,255,.55)",lineHeight:1.75}}>{l}</div>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ━━━ FOOTER ━━━ */}
      <footer className="lp-footer">
        <div style={{...wrap,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
          <div className="lp-logo-box">
            <div className="lp-logo-badge" style={{width:32,height:32}}>
              <img src={LOGO} alt="ELOC" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            </div>
            <div style={{fontSize:13,fontWeight:900,color:"#fff"}}>ELOC International</div>
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>2025 © Eloc International · Excellence in Language &amp; Online Courses</div>
          <div style={{display:"flex",gap:16}}>
            <a href={whatsapp} target="_blank" rel="noreferrer" style={{fontSize:12,color:"rgba(255,255,255,.4)",textDecoration:"none"}}>WhatsApp</a>
            <a href="mailto:contact@elocinternational.com" style={{fontSize:12,color:"rgba(255,255,255,.4)",textDecoration:"none"}}>Email</a>
            <a href="https://www.elocinternational.com" target="_blank" rel="noreferrer" style={{fontSize:12,color:"rgba(255,255,255,.4)",textDecoration:"none"}}>Website</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── STUDENT SIGN UP PAGE ──────────────────────────────────────────────────────
function StudentSignupPage({ onBack, onSuccess, data, setData }) {
  const [step, setStep]   = useState(1);
  const [form, setForm]   = useState({ firstName:"", lastName:"", email:"", phone:"", age:"", city:"", level:"A2", password:"", confirmPassword:"" });
  const [err,    setErr]  = useState("")
  const [fieldErr, setFieldErr] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [done,   setDone] = useState(null);

  const set = (k, v) => { setForm(f => ({ ...f, [k]:v })); setFieldErr(e => ({ ...e, [k]:"" })); };

  const pwStrength = (pw) => {
    if (!pw) return { score:0, label:"", color:"" };
    let s = 0;
    if (pw.length >= 6)           s++;
    if (pw.length >= 8)           s++;
    if (/[A-Z]/.test(pw))         s++;
    if (/[0-9]/.test(pw))         s++;
    if (/[^A-Za-z0-9]/.test(pw))  s++;
    const map = ["","Weak","Fair","Good","Strong","Very Strong"];
    const col = s <= 1 ? "#ef4444" : s <= 2 ? "#f59e0b" : "#22c55e";
    return { score:s, label:map[s]||"", color:col };
  };

  const validate = (s) => {
    const e = {};
    if (s === 1) {
      if (!form.firstName.trim()) e.firstName = "Required";
      if (!form.lastName.trim())  e.lastName  = "Required";
      if (!form.phone.trim())     e.phone     = "Required";
      if (!form.age || isNaN(form.age) || +form.age < 5 || +form.age > 99) e.age = "Enter a valid age";
      if (!form.city.trim())      e.city      = "Required";
    }
    if (s === 2) {
      if (!form.email.trim())     e.email = "Required";
      else if (!/^[^@]+@[^@]+[.][^@]+$/.test(form.email)) e.email = "Invalid email";
      else if (data.users.find(u => u.email.toLowerCase() === form.email.toLowerCase())) e.email = "Email already registered";
      if (form.password.length < 6)                  e.password = "Minimum 6 characters";
      if (form.password !== form.confirmPassword)    e.confirmPassword = "Passwords do not match";
    }
    setFieldErr(e);
    return Object.keys(e).length === 0;
  };

  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setErr(''); if (!validate(2)) return;
    setSubmitting(true);
    try {
      const { token, user } = await api.auth.register({
        name: (form.firstName.trim() + " " + form.lastName.trim()),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        age: +form.age,
        city: form.city.trim(),
        level: form.level,
      });
      saveToken(token);
      // Build done with ONLY safe string fields - no object spreading that could leak
      const fullName = form.firstName.trim() + " " + form.lastName.trim();
      setDone({
        id:               user?.id || user?._id?.toString() || '',
        name:             String(user?.name || fullName),
        email:            String(user?.email || form.email),
        role:             'student',
        level:            String(user?.level || form.level),
        registrationDate: String(user?.registrationDate || new Date().toISOString().split('T')[0]),
        avatar:           String(user?.avatar || ''),
        password:         form.password,
      });
      setStep(3);
    } catch (e) {
      setErr(e.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const FErr = ({ k }) => fieldErr[k] ? <div style={{ fontSize:11, color:"var(--red)", marginTop:4, fontWeight:600 }}>⚠ {fieldErr[k]}</div> : null;

  const StepBar = () => {
    const labels = ["Personal Info","Account Setup","Done"];
    return (
      <div className="su-step-bar">
        {labels.map((label, i) => {
          const n = i+1; const state = n < step ? "done" : n === step ? "active" : "idle";
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", flex: i < labels.length-1 ? 1 : "none" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", position:"relative" }}>
                <div className={"su-step-circle "+state}>{state==="done"?"✓":n}</div>
                <div style={{ position:"absolute", top:38, left:"50%", transform:"translateX(-50%)", fontSize:10, fontWeight:600, whiteSpace:"nowrap", color:state==="active"?"var(--accent2)":"var(--text3)" }}>{label}</div>
              </div>
              {i < labels.length-1 && <div style={{ flex:1, height:2, margin:"0 8px", background:n < step?"var(--accent)":"var(--border2)", transition:"background .3s" }} />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="su-wrap">
      <div className="su-orb1" /><div className="su-orb2" />
      <div className="su-nav">
        <div className="lp-logo-box">
          <div className="lp-logo-badge"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAAAILUlEQVR42u2Za4xcZRnH/8/znjP37c52u0u77dbtjd7ZNi1Ea4nByKWlYKRgscWUqiGBBDVWQ1Q+iImX6BdDYqQKCikgUUHwhoR4IaDdQoXSVsrF3Q3usoXddndnZ2bPmXPO+zx+ONNSlQ92duy2ybyfZuadzDy/930u/+c5pF98H87nxTjPVwOgAdAAaAA0ABoA5/VyzsJ/iEIUgALEBKbzBEABETCBXWLnpNWhSqR1ZHD+T6ZbgWNg0gzB6yPhvrcq/YWoJcUfuzAzv8VooFQnBqq7GrUCY4AkF8vy2Ove3r8Xnx3wA6vxbmvaefKG9vUdCQ3rcw9OfX0dgMnwRFn2HJj4wUvF/vEg3jIMAhymE170jb8WHt/WLqGeWy5kBcYlMO09WL7rufHe8QCAoSqYFdDJt81JBkEVOHduIBJ10mZgzN7+9Ikn3igDcBiiiB2HCYYQCSpWZ2edOz/YXC//qQOAKpTgZMwvX/Fufer4O+XIMFQRxUfOUK2m0azL1y3N3rUxv6DFaHBuAIiCDYj5jqfHv7N/LPZ1K2CCw4gEVgDQirbUjpXZG5dlFrYaRCrBuZFGRcEOFUPd/sTwb3rLhhAXK6b4yCmTMFd3uTuXJ6+Y77hpAxtZn4gNk53+QqYKMpgI9apHhvcNeQkDUbJxGgKvmOVuXyg3rsgtWjgP+Q6YpjAMuTjMo/8kv4B0M4ihMq0AADF94vGRfUNe2iEvUkCThrYsnbFrMS5flEtccjW6t0Zz16KpzRBcQENPj72qz/+M9u0lBZxEXRicmnIOnDQ/+FLpd31lAF6kTQnesTJ3+8UtK3IldK3XLV+PFlzC8a+LhQhA5KZp/lrMXyvdm/GTW8gvwnGhOm0xMOxJPmUW592PLsnctDLT1Z5G4Xi4+uO0/XtOIuWIhSqMAzaAOXlxArG85FLZuQf3bCO40yklFDjhyayMQZJg2RZGdf11Zte9FJ86MYg09HX/T/Hmi0hmsHEXz14GFYiocfSBW/jAo8jkIXZ6boCAWVmGaOQRhyXqXMU77iZVQGPrZXwI9+6k3h5yk/CL0v833f17IgMCqerqTXjh59NcB9SCCA5DSfX6b1MiA7FgAxUVwUO3c99+5OdAFYkMBWWogglKIKL8HDjJqcfAlDoyIoANvIKu3kSLN1StFwtife3PdPRPmHEBogDEKJ3Q7i1k3KrDqCLwp+g89WspifCBT8Z17GR0gP6xj4jjQo3xIbviI3T556ECZqiASAdehg1BPJ0uBCKEvs5aQIvfDxD4XWvUSVL5BKBqXNl4M2/9JiWzUIG1MK5Wyuh5GMks1E4vACP0de5KSmShUj1OMgDo0k9JHOnLPsxd60gFEoEdGFa/qHtv45FepJun7kVTVKMEsWhbSHGOrwIQAMq10qYv/RsqsU6O65Gn8Mfv87HX6mJ9nfqBdPN7ZSgBsQIoHteRXgweRv/z1H+ARwdABBBsCDKAngMAUeW9tB7L0T/gmR/R0CtUHKHAAzFSTTCuNrXpvJXUf4ACD+xMkWGKAAoiFN4+WdlOO/vBw9izg22ERBpuGskc2EFpROYsx2fu57ZF8pcH6JEvTGclrp60k8BbR1SFTiVEVRA09Cn0kW0BCCoIKvAmZMHFuOVBzndALLV2ngOjRRUkMjR4RAcOIZZAQFyJuWudXrVbQRoFCkjLXNl8B332V5zvQFQBG335t5Do9LifprkQG0yOy5pr6NP3k41gzOnDBi0cw8QwElnMnEduCgBsCOPKsaP44U1cKaM8imQWgQfj1hYP5msb8lP1okQGA4ck18oL1kMkjuD4fig1g5pnU24mGQc2hAqMK5NjuPtaXXstjKNsqDwqc5aTRIj8Gq6iHllIhFJN/OhXrQ34stuqJogFFHFXQAQ2MC4AeesIHv4cv/2anRiWNdfARsJGbaAvPmH6ehAXxLM+F1IQUSJjHrtTXn1GL7uVFm8gJ/EfzYOO9GnPQ/zsjymsINWMVA6T4xT6sBGcJBXeBrs1uFBNMUCEU3O10/UwO/AKIJY5S9HZjbaFlMlDrI4PYfAQvXmQyieQmhFHOQBEAZJZlMeQa4UNapPWZw5AVFXIqiDATUGkKhaiCtiADUIfUQUiIHrXhdxUtQFQqfp63P0YF4EHsXCSNdwAn7H1ga+zL7Q777HbvqvNszE2hEoJlRKKI5pIR1u+Yi++AX4JThJuCiaBZBaA5mZFV+7WKEBpBIEHr4DyKKIKQh+jAzK/217/LQSTZyWImRD4aJkH2y/dW3TdVh7pg5PQfAcNHkZnt77+rN24EyB4BbQvolef0VVXYuAgRb52XiQXbabDT2r7Ys3PMQd/rW0LdWYn/CIFk1AL4jMV2GeaRgkAmHHRZr5vF7rWY2YnmmdjfjeCSSz9EPX1sEnoxpsxMYyO5dq5BpGH7i3wi5TvwKor8M4buuZamtFOlZKu3oSWebAB8h1UOk79L9TQZJ65C9lAW+ZqMgsbaipHffv5F19GMIlEBiP9ANEbz6FSxtgg+SXyi5jRTqMDyLVCBb09uGAJ9fbAK2CygEoZBG3r0txMbemsxtVZyUKsxqEoUCdBqgh9dVMwLvkTmsyRV9B0M0kEhboJmixorhVeASZJQUmb2qk4osksQAh9OO6pMSPZsIZHBrVJCa2WW5VqJykCKMhALdiBjUAEAkQQ12B2oArmWEpALEDVHHUqJdekiGorZATi6vynKj8JoOonKuCTnUrVbrcqvOPXp7RG1egpzdq59ur7P+3qf325Po/G6jpWmdbVAGgANAAaAA2ABkADoAEwhfUv3I/mqu8bt5UAAAAASUVORK5CYII=" alt="ELOC" style={{width:"100%",height:"100%",objectFit:"contain"}} alt="ELOC" style={{width:"100%",height:"100%",objectFit:"contain"}} alt="ELOC" style={{ width:"100%", height:"100%", objectFit:"cover" }} /></div>
          <div><div className="lp-logo-text">ELOC</div><div className="lp-logo-sub">International</div></div>
        </div>
        {step < 3 && <button className="su-back-btn" onClick={onBack}>← Back to home</button>}
      </div>
      <div className="su-body">
        <div className="su-card" style={{ animation:"authFadeUp .5s both" }}>
          {step === 3 && done && (
            <div className="su-success">
              <div className="su-success-icon">🎓</div>
              <h2 style={{ fontSize:22, fontWeight:900, letterSpacing:"-.4px", marginBottom:8 }}>Welcome to ELOC, {done.name.split(" ")[0]}!</h2>
              <p style={{ fontSize:13, color:"var(--text3)", lineHeight:1.7, marginBottom:20 }}>Your account is created. An admin will assign you to a group and confirm your schedule. Save your login details below.</p>
              <div className="su-success-creds">
                <div style={{ fontSize:11, fontWeight:700, color:"var(--accent2)", textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>🔑 Your Login Details</div>
                {[["Name",done.name],["Email",done.email],["Password",done.password],["Level",done.level],["Joined",done.registrationDate]].map(([l,v],i)=>(
                  <div key={i} style={{ display:"flex", gap:12, padding:"7px 0", borderBottom:i<4?"1px solid var(--border)":"none" }}>
                    <span style={{ fontSize:12, color:"var(--text3)", width:72, flexShrink:0 }}>{l}</span>
                    <span style={{ fontSize:13, fontWeight:600, fontFamily:"var(--mono)" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button className="btn btn-se w100" style={{ justifyContent:"center" }} onClick={onBack}>Back to Home</button>
                <button className="btn btn-pr w100" style={{ justifyContent:"center" }} onClick={() => onSuccess && onSuccess(done)}>Go to Dashboard →</button>
              </div>
            </div>
          )}
          {step < 3 && (
            <>
              <div style={{ textAlign:"center", marginBottom:28 }}>
                <div style={{ fontSize:22, fontWeight:900, letterSpacing:"-.5px", marginBottom:4 }}>Student Registration</div>
                <div style={{ fontSize:13, color:"var(--text3)" }}>Create your ELOC account — Step {step} of 2</div>
              </div>
              <StepBar />
              {step === 1 && (
                <div style={{ animation:"authFadeUp .3s" }}>
                  <div className="su-section-title">👤 Personal Information</div>
                  <div className="su-field-grid">
                    <div className="fg"><label>First Name *</label><input value={form.firstName} onChange={e=>set("firstName",e.target.value)} placeholder="Mohamed" /><FErr k="firstName"/></div>
                    <div className="fg"><label>Last Name *</label><input value={form.lastName} onChange={e=>set("lastName",e.target.value)} placeholder="Alami" /><FErr k="lastName"/></div>
                    <div className="fg"><label>Phone / WhatsApp *</label><input value={form.phone} onChange={e=>set("phone",e.target.value)} placeholder="+212 6 00 00 00 00" /><FErr k="phone"/></div>
                    <div className="fg"><label>Age *</label><input type="number" min="5" max="99" value={form.age} onChange={e=>set("age",e.target.value)} placeholder="25" /><FErr k="age"/></div>
                    <div className="fg" style={{ gridColumn:"1 / -1" }}><label>City *</label><input value={form.city} onChange={e=>set("city",e.target.value)} placeholder="Agadir" /><FErr k="city"/></div>
                  </div>
                  <div className="su-section-title" style={{ marginTop:4 }}>📚 English Level</div>
                  <div className="su-level-grid" style={{ marginBottom:6 }}>
                    {["A1","A2","B1","B2","C1","C2"].map(l=>(
                      <button key={l} className={"su-level-btn "+(form.level===l?"sel":"")} onClick={()=>set("level",l)}>{l}</button>
                    ))}
                  </div>
                  <div style={{ fontSize:11, color:"var(--text3)" }}>Not sure? Choose your closest estimate — your teacher will confirm.</div>
                </div>
              )}
              {step === 2 && (
                <div style={{ animation:"authFadeUp .3s" }}>
                  <div className="su-section-title">📧 Login Information</div>
                  <div className="fg"><label>Email Address *</label><input type="email" value={form.email} onChange={e=>set("email",e.target.value)} placeholder="you@email.com" /><FErr k="email"/></div>
                  <div className="fg" style={{ position:"relative" }}>
                    <label>Password * <span style={{ fontSize:10, color:"var(--text3)" }}>(min 6 chars)</span></label>
                    <input type={showPw?"text":"password"} value={form.password} onChange={e=>set("password",e.target.value)} placeholder="Create a strong password" />
                    <button onClick={()=>setShowPw(s=>!s)} style={{ position:"absolute", right:10, top:34, background:"none", border:"none", cursor:"pointer", fontSize:16, color:"var(--text3)" }}>{showPw?"🙈":"👁"}</button>
                    {form.password && (()=>{ const s=pwStrength(form.password); return <div style={{ marginTop:6 }}><div style={{ height:3, borderRadius:99, width:(s.score/5*100)+"%", background:s.color, transition:"all .3s", marginBottom:4 }}/><div style={{ fontSize:10, fontWeight:600, color:s.color }}>{s.label}</div></div>; })()}
                    <FErr k="password"/>
                  </div>
                  <div className="fg"><label>Confirm Password *</label><input type={showPw?"text":"password"} value={form.confirmPassword} onChange={e=>set("confirmPassword",e.target.value)} placeholder="Repeat your password" /><FErr k="confirmPassword"/></div>
                  <div className="su-section-title" style={{ marginTop:8 }}>📋 Summary</div>
                  <div style={{ background:"var(--bg3)", borderRadius:12, padding:16, border:"1px solid var(--border)" }}>
                    {[["Name",form.firstName+" "+form.lastName],["Phone",form.phone],["Age",form.age],["City",form.city],["Level",form.level]].map(([l,v],i)=>(
                      <div key={i} style={{ display:"flex", gap:12, padding:"6px 0", borderBottom:i<4?"1px solid var(--border)":"none", fontSize:13 }}>
                        <span style={{ color:"var(--text3)", width:60, flexShrink:0 }}>{l}</span>
                        <span style={{ fontWeight:600 }}>{v||"—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display:"flex", gap:10, marginTop:24 }}>
                {err && (
                <div style={{
                  width:"100%", background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.4)",
                  borderRadius:10, padding:"10px 14px", marginBottom:4,
                  color:"#f87171", fontSize:13, fontWeight:600,
                  display:"flex", alignItems:"center", gap:8
                }}>
                  <span>⚠️</span> {err}
                </div>
              )}
              {step > 1 && <button className="btn btn-se" style={{ minWidth:100, justifyContent:"center" }} onClick={()=>setStep(s=>s-1)}>← Back</button>}
                {step === 1
                  ? <button className="btn btn-pr" style={{ flex:1, justifyContent:"center" }} onClick={()=>{ if(validate(1)) { setFieldErr({}); setErr(''); setStep(2); } }}>Continue →</button>
                  : <button className="btn btn-pr" style={{ flex:1, justifyContent:"center", opacity: submitting ? 0.7 : 1 }} onClick={submit} disabled={submitting}>
                  {submitting ? <span style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}><span style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTop:"2px solid #fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}} />Creating account...</span> : "🎓 Create My Account"}
                </button>
                }
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function LoginPage({ onLogin, users, onBack }) {
  const [role, setRole] = useState("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const pick = (r) => { setRole(r); setEmail(""); setPassword(""); setErr(""); };
  const [loginLoading, setLoginLoading] = useState(false);
  const login = async () => {
    setErr(""); setLoginLoading(true);
    try {
      const { token, user } = await api.auth.login(email.trim(), password);
      onLogin(token, deepClean(user));
    } catch (e) {
      setErr(e.message || "Invalid credentials.");
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card">
        <div className="card" style={{ padding: 36 }}>
          <div className="login-logo">
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAAAILUlEQVR42u2Za4xcZRnH/8/znjP37c52u0u77dbtjd7ZNi1Ea4nByKWlYKRgscWUqiGBBDVWQ1Q+iImX6BdDYqQKCikgUUHwhoR4IaDdQoXSVsrF3Q3usoXddndnZ2bPmXPO+zx+ONNSlQ92duy2ybyfZuadzDy/930u/+c5pF98H87nxTjPVwOgAdAAaAA0ABoA5/VyzsJ/iEIUgALEBKbzBEABETCBXWLnpNWhSqR1ZHD+T6ZbgWNg0gzB6yPhvrcq/YWoJcUfuzAzv8VooFQnBqq7GrUCY4AkF8vy2Ove3r8Xnx3wA6vxbmvaefKG9vUdCQ3rcw9OfX0dgMnwRFn2HJj4wUvF/vEg3jIMAhymE170jb8WHt/WLqGeWy5kBcYlMO09WL7rufHe8QCAoSqYFdDJt81JBkEVOHduIBJ10mZgzN7+9Ikn3igDcBiiiB2HCYYQCSpWZ2edOz/YXC//qQOAKpTgZMwvX/Fufer4O+XIMFQRxUfOUK2m0azL1y3N3rUxv6DFaHBuAIiCDYj5jqfHv7N/LPZ1K2CCw4gEVgDQirbUjpXZG5dlFrYaRCrBuZFGRcEOFUPd/sTwb3rLhhAXK6b4yCmTMFd3uTuXJ6+Y77hpAxtZn4gNk53+QqYKMpgI9apHhvcNeQkDUbJxGgKvmOVuXyg3rsgtWjgP+Q6YpjAMuTjMo/8kv4B0M4ihMq0AADF94vGRfUNe2iEvUkCThrYsnbFrMS5flEtccjW6t0Zz16KpzRBcQENPj72qz/+M9u0lBZxEXRicmnIOnDQ/+FLpd31lAF6kTQnesTJ3+8UtK3IldK3XLV+PFlzC8a+LhQhA5KZp/lrMXyvdm/GTW8gvwnGhOm0xMOxJPmUW592PLsnctDLT1Z5G4Xi4+uO0/XtOIuWIhSqMAzaAOXlxArG85FLZuQf3bCO40yklFDjhyayMQZJg2RZGdf11Zte9FJ86MYg09HX/T/Hmi0hmsHEXz14GFYiocfSBW/jAo8jkIXZ6boCAWVmGaOQRhyXqXMU77iZVQGPrZXwI9+6k3h5yk/CL0v833f17IgMCqerqTXjh59NcB9SCCA5DSfX6b1MiA7FgAxUVwUO3c99+5OdAFYkMBWWogglKIKL8HDjJqcfAlDoyIoANvIKu3kSLN1StFwtife3PdPRPmHEBogDEKJ3Q7i1k3KrDqCLwp+g89WspifCBT8Z17GR0gP6xj4jjQo3xIbviI3T556ECZqiASAdehg1BPJ0uBCKEvs5aQIvfDxD4XWvUSVL5BKBqXNl4M2/9JiWzUIG1MK5Wyuh5GMks1E4vACP0de5KSmShUj1OMgDo0k9JHOnLPsxd60gFEoEdGFa/qHtv45FepJun7kVTVKMEsWhbSHGOrwIQAMq10qYv/RsqsU6O65Gn8Mfv87HX6mJ9nfqBdPN7ZSgBsQIoHteRXgweRv/z1H+ARwdABBBsCDKAngMAUeW9tB7L0T/gmR/R0CtUHKHAAzFSTTCuNrXpvJXUf4ACD+xMkWGKAAoiFN4+WdlOO/vBw9izg22ERBpuGskc2EFpROYsx2fu57ZF8pcH6JEvTGclrp60k8BbR1SFTiVEVRA09Cn0kW0BCCoIKvAmZMHFuOVBzndALLV2ngOjRRUkMjR4RAcOIZZAQFyJuWudXrVbQRoFCkjLXNl8B332V5zvQFQBG335t5Do9LifprkQG0yOy5pr6NP3k41gzOnDBi0cw8QwElnMnEduCgBsCOPKsaP44U1cKaM8imQWgQfj1hYP5msb8lP1okQGA4ck18oL1kMkjuD4fig1g5pnU24mGQc2hAqMK5NjuPtaXXstjKNsqDwqc5aTRIj8Gq6iHllIhFJN/OhXrQ34stuqJogFFHFXQAQ2MC4AeesIHv4cv/2anRiWNdfARsJGbaAvPmH6ehAXxLM+F1IQUSJjHrtTXn1GL7uVFm8gJ/EfzYOO9GnPQ/zsjymsINWMVA6T4xT6sBGcJBXeBrs1uFBNMUCEU3O10/UwO/AKIJY5S9HZjbaFlMlDrI4PYfAQvXmQyieQmhFHOQBEAZJZlMeQa4UNapPWZw5AVFXIqiDATUGkKhaiCtiADUIfUQUiIHrXhdxUtQFQqfp63P0YF4EHsXCSNdwAn7H1ga+zL7Q777HbvqvNszE2hEoJlRKKI5pIR1u+Yi++AX4JThJuCiaBZBaA5mZFV+7WKEBpBIEHr4DyKKIKQh+jAzK/217/LQSTZyWImRD4aJkH2y/dW3TdVh7pg5PQfAcNHkZnt77+rN24EyB4BbQvolef0VVXYuAgRb52XiQXbabDT2r7Ys3PMQd/rW0LdWYn/CIFk1AL4jMV2GeaRgkAmHHRZr5vF7rWY2YnmmdjfjeCSSz9EPX1sEnoxpsxMYyO5dq5BpGH7i3wi5TvwKor8M4buuZamtFOlZKu3oSWebAB8h1UOk79L9TQZJ65C9lAW+ZqMgsbaipHffv5F19GMIlEBiP9ANEbz6FSxtgg+SXyi5jRTqMDyLVCBb09uGAJ9fbAK2CygEoZBG3r0txMbemsxtVZyUKsxqEoUCdBqgh9dVMwLvkTmsyRV9B0M0kEhboJmixorhVeASZJQUmb2qk4osksQAh9OO6pMSPZsIZHBrVJCa2WW5VqJykCKMhALdiBjUAEAkQQ12B2oArmWEpALEDVHHUqJdekiGorZATi6vynKj8JoOonKuCTnUrVbrcqvOPXp7RG1egpzdq59ur7P+3qf325Po/G6jpWmdbVAGgANAAaAA2ABkADoAEwhfUv3I/mqu8bt5UAAAAASUVORK5CYII=" alt="ELOC" style={{width:"100%",height:"100%",objectFit:"contain"}} alt="ELOC" style={{width:"100%",height:"100%",objectFit:"contain"}} alt="ELOC" style={{ width: 90, height: 90, objectFit: "contain", margin: "0 auto 10px", display: "block" }} />
            <div className="login-title">ELOC Manager</div>
            <div className="login-sub">Excellence in Language & Online Courses</div>
          </div>
          <div className="role-switch">
            {["admin", "teacher", "student"].map(r => (
              <div key={r} className={`role-tab ${role === r ? "active" : ""}`} onClick={() => pick(r)}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </div>
            ))}
          </div>
          <div className="fg">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@eloc.com" />
          </div>
          <div className="fg">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
          </div>
          {err && (
            <div style={{
              background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 12,
              color: "#f87171", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 8
            }}>
              <span>⚠️</span> {err}
            </div>
          )}
          <button className="btn btn-pr w100" style={{justifyContent:"center", opacity:loginLoading?0.7:1}} onClick={login} disabled={loginLoading}>
            {loginLoading
              ? <span style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                  <span style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTop:"2px solid #fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>
                  Signing in...
                </span>
              : "Sign In →"}
          </button>
          <div className="divider" />
          
          {onBack && (
            <button
              onClick={onBack}
              style={{
                marginTop: 14, width: "100%", padding: "9px 0",
                background: "transparent", border: "1px solid var(--border2)",
                borderRadius: 10, cursor: "pointer", fontSize: 13,
                fontWeight: 600, color: "var(--text3)", fontFamily: "var(--font)",
                transition: "all .15s"
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = "var(--accent2)"; e.currentTarget.style.color = "var(--accent2)"; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--text3)"; }}
            >
              ← Back to Home
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ user, active, onNav, open }) {
  const navByRole = {
    admin: [
      { sec: "Overview", items: [{ id: "dashboard", icon: "⬛", label: "Dashboard" }, { id: "analytics", icon: "📊", label: "Analytics", perm: "analytics" }] },
      { sec: "People", items: [{ id: "students", icon: "👨‍🎓", label: "Students", perm: "students" }, { id: "teachers", icon: "👨‍🏫", label: "Teachers", perm: "teachers" }, { id: "groups", icon: "👥", label: "Groups", perm: "groups" }] },
      { sec: "Curriculum", items: [{ id: "books", icon: "📚", label: "Books & Curriculum", perm: "books" }] },
      { sec: "Operations", items: [{ id: "sessions", icon: "📅", label: "Sessions", perm: "sessions" }, { id: "attendance", icon: "✅", label: "Attendance", perm: "students" }, { id: "payments", icon: "💳", label: "Payments", perm: "payments" }] },
      { sec: "Admin", items: [{ id: "admin_users", icon: "🔐", label: "Admin Users" }] },
    ],
    teacher: [
      { sec: "Overview", items: [{ id: "dashboard", icon: "⬛", label: "Dashboard" }] },
      { sec: "Teaching", items: [{ id: "sessions", icon: "📅", label: "My Sessions" }, { id: "groups", icon: "👥", label: "My Groups" }, { id: "materials", icon: "📖", label: "My Materials" }] },
      { sec: "Students", items: [{ id: "attendance", icon: "✅", label: "Attendance" }] },
      { sec: "Finance", items: [{ id: "earnings", icon: "💰", label: "Earnings" }] },
    ],
    student: [
      { sec: "Overview", items: [{ id: "dashboard", icon: "⬛", label: "Dashboard" }] },
      { sec: "Learning", items: [{ id: "sessions", icon: "📅", label: "My Calendar" }, { id: "classes", icon: "📚", label: "My Classes" }, { id: "materials", icon: "📖", label: "My Materials" }] },
      { sec: "Fun", items: [{ id: "games", icon: "🎮", label: "Games" }] },
      { sec: "Account", items: [{ id: "attendance", icon: "✅", label: "Attendance" }, { id: "payments", icon: "💳", label: "Payments" }, { id: "profile", icon: "🔑", label: "My Profile" }] },
    ],
  };

  // For admin users with restricted permissions, filter the nav
  const userPerms = user.permissions; // undefined = superadmin (full access)
  const rawNav = navByRole[user.role] ?? navByRole.admin;
  const nav = user.role !== "admin" || !userPerms ? rawNav : rawNav
    .map(sec => ({
      ...sec,
      items: sec.items.filter(item =>
        // dashboard always visible; admin_users hidden for sub-admins; others checked by perm
        item.id === "dashboard" ? true
        : item.id === "admin_users" ? false
        : !item.perm || userPerms.includes(item.perm)
      ),
    }))
    .filter(sec => sec.items.length > 0);
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-logo">
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAAAILUlEQVR42u2Za4xcZRnH/8/znjP37c52u0u77dbtjd7ZNi1Ea4nByKWlYKRgscWUqiGBBDVWQ1Q+iImX6BdDYqQKCikgUUHwhoR4IaDdQoXSVsrF3Q3usoXddndnZ2bPmXPO+zx+ONNSlQ92duy2ybyfZuadzDy/930u/+c5pF98H87nxTjPVwOgAdAAaAA0ABoA5/VyzsJ/iEIUgALEBKbzBEABETCBXWLnpNWhSqR1ZHD+T6ZbgWNg0gzB6yPhvrcq/YWoJcUfuzAzv8VooFQnBqq7GrUCY4AkF8vy2Ove3r8Xnx3wA6vxbmvaefKG9vUdCQ3rcw9OfX0dgMnwRFn2HJj4wUvF/vEg3jIMAhymE170jb8WHt/WLqGeWy5kBcYlMO09WL7rufHe8QCAoSqYFdDJt81JBkEVOHduIBJ10mZgzN7+9Ikn3igDcBiiiB2HCYYQCSpWZ2edOz/YXC//qQOAKpTgZMwvX/Fufer4O+XIMFQRxUfOUK2m0azL1y3N3rUxv6DFaHBuAIiCDYj5jqfHv7N/LPZ1K2CCw4gEVgDQirbUjpXZG5dlFrYaRCrBuZFGRcEOFUPd/sTwb3rLhhAXK6b4yCmTMFd3uTuXJ6+Y77hpAxtZn4gNk53+QqYKMpgI9apHhvcNeQkDUbJxGgKvmOVuXyg3rsgtWjgP+Q6YpjAMuTjMo/8kv4B0M4ihMq0AADF94vGRfUNe2iEvUkCThrYsnbFrMS5flEtccjW6t0Zz16KpzRBcQENPj72qz/+M9u0lBZxEXRicmnIOnDQ/+FLpd31lAF6kTQnesTJ3+8UtK3IldK3XLV+PFlzC8a+LhQhA5KZp/lrMXyvdm/GTW8gvwnGhOm0xMOxJPmUW592PLsnctDLT1Z5G4Xi4+uO0/XtOIuWIhSqMAzaAOXlxArG85FLZuQf3bCO40yklFDjhyayMQZJg2RZGdf11Zte9FJ86MYg09HX/T/Hmi0hmsHEXz14GFYiocfSBW/jAo8jkIXZ6boCAWVmGaOQRhyXqXMU77iZVQGPrZXwI9+6k3h5yk/CL0v833f17IgMCqerqTXjh59NcB9SCCA5DSfX6b1MiA7FgAxUVwUO3c99+5OdAFYkMBWWogglKIKL8HDjJqcfAlDoyIoANvIKu3kSLN1StFwtife3PdPRPmHEBogDEKJ3Q7i1k3KrDqCLwp+g89WspifCBT8Z17GR0gP6xj4jjQo3xIbviI3T556ECZqiASAdehg1BPJ0uBCKEvs5aQIvfDxD4XWvUSVL5BKBqXNl4M2/9JiWzUIG1MK5Wyuh5GMks1E4vACP0de5KSmShUj1OMgDo0k9JHOnLPsxd60gFEoEdGFa/qHtv45FepJun7kVTVKMEsWhbSHGOrwIQAMq10qYv/RsqsU6O65Gn8Mfv87HX6mJ9nfqBdPN7ZSgBsQIoHteRXgweRv/z1H+ARwdABBBsCDKAngMAUeW9tB7L0T/gmR/R0CtUHKHAAzFSTTCuNrXpvJXUf4ACD+xMkWGKAAoiFN4+WdlOO/vBw9izg22ERBpuGskc2EFpROYsx2fu57ZF8pcH6JEvTGclrp60k8BbR1SFTiVEVRA09Cn0kW0BCCoIKvAmZMHFuOVBzndALLV2ngOjRRUkMjR4RAcOIZZAQFyJuWudXrVbQRoFCkjLXNl8B332V5zvQFQBG335t5Do9LifprkQG0yOy5pr6NP3k41gzOnDBi0cw8QwElnMnEduCgBsCOPKsaP44U1cKaM8imQWgQfj1hYP5msb8lP1okQGA4ck18oL1kMkjuD4fig1g5pnU24mGQc2hAqMK5NjuPtaXXstjKNsqDwqc5aTRIj8Gq6iHllIhFJN/OhXrQ34stuqJogFFHFXQAQ2MC4AeesIHv4cv/2anRiWNdfARsJGbaAvPmH6ehAXxLM+F1IQUSJjHrtTXn1GL7uVFm8gJ/EfzYOO9GnPQ/zsjymsINWMVA6T4xT6sBGcJBXeBrs1uFBNMUCEU3O10/UwO/AKIJY5S9HZjbaFlMlDrI4PYfAQvXmQyieQmhFHOQBEAZJZlMeQa4UNapPWZw5AVFXIqiDATUGkKhaiCtiADUIfUQUiIHrXhdxUtQFQqfp63P0YF4EHsXCSNdwAn7H1ga+zL7Q777HbvqvNszE2hEoJlRKKI5pIR1u+Yi++AX4JThJuCiaBZBaA5mZFV+7WKEBpBIEHr4DyKKIKQh+jAzK/217/LQSTZyWImRD4aJkH2y/dW3TdVh7pg5PQfAcNHkZnt77+rN24EyB4BbQvolef0VVXYuAgRb52XiQXbabDT2r7Ys3PMQd/rW0LdWYn/CIFk1AL4jMV2GeaRgkAmHHRZr5vF7rWY2YnmmdjfjeCSSz9EPX1sEnoxpsxMYyO5dq5BpGH7i3wi5TvwKor8M4buuZamtFOlZKu3oSWebAB8h1UOk79L9TQZJ65C9lAW+ZqMgsbaipHffv5F19GMIlEBiP9ANEbz6FSxtgg+SXyi5jRTqMDyLVCBb09uGAJ9fbAK2CygEoZBG3r0txMbemsxtVZyUKsxqEoUCdBqgh9dVMwLvkTmsyRV9B0M0kEhboJmixorhVeASZJQUmb2qk4osksQAh9OO6pMSPZsIZHBrVJCa2WW5VqJykCKMhALdiBjUAEAkQQ12B2oArmWEpALEDVHHUqJdekiGorZATi6vynKj8JoOonKuCTnUrVbrcqvOPXp7RG1egpzdq59ur7P+3qf325Po/G6jpWmdbVAGgANAAaAA2ABkADoAEwhfUv3I/mqu8bt5UAAAAASUVORK5CYII=" alt="ELOC" style={{width:"100%",height:"100%",objectFit:"contain"}} alt="ELOC" style={{width:"100%",height:"100%",objectFit:"contain"}} alt="ELOC" style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 6 }} />
        <div><div className="logo-name">ELOC</div><div className="logo-ver">Manager v2.1</div></div>
      </div>
      {nav.map(sec => (
        <div key={sec.sec} className="nav-section">
          <div className="nav-section-label">{sec.sec}</div>
          {sec.items.map(item => (
            <div key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => onNav(item.id)}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="sidebar-bottom">
        <div className="contact-section">
          <div className="contact-title">📞 Contact ELOC</div>
          <a href="https://wa.me/212604007232" target="_blank" rel="noreferrer" className="contact-btn contact-btn-wa">
            <span style={{ fontSize: 14 }}>💬</span> WhatsApp
          </a>
          <a href="tel:+212604007232" className="contact-btn contact-btn-call">
            <span style={{ fontSize: 14 }}>📱</span> 06 04 00 72 32
          </a>
          <a href="mailto:Elocbackgound@gmail.com" className="contact-btn contact-btn-mail">
            <span style={{ fontSize: 14 }}>✉️</span> Email Us
          </a>
        </div>
        <div className="user-row">
          <Av name={user.name} />
          <div><div className="user-name">{user.name.split(" ")[0]}</div><div className="user-role">{user.role}</div></div>
        </div>
      </div>
    </aside>
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
function AdminDashboard({ data }) {
  const students = data.users.filter(u => u.role === "student");
  const teachers = data.users.filter(u => u.role === "teacher");
  const totalRevenue = data.payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const pending = data.payments.filter(p => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const completedSessions = data.sessions.filter(s => s.status === "completed").length;
  const totalSessions = data.sessions.length;

  const monthlyRev = [
    { l: "Sep", v: 1200 }, { l: "Oct", v: 1450 }, { l: "Nov", v: 1380 },
    { l: "Dec", v: 900 }, { l: "Jan", v: 1600 }, { l: "Feb", v: totalRevenue },
  ];

  return (
    <div>
      <div className="ph">
        <div>
          <div className="ph-title">Good morning, Sarah 👋</div>
          <div className="ph-sub">Here's your ELOC overview for today</div>
        </div>
      </div>

      <div className="g4 mb16">
        {[
          { icon: "👨‍🎓", label: "Total Students", value: students.length, sub: "Enrolled", color: "#f97316" },
          { icon: "👨‍🏫", label: "Teachers", value: teachers.length, sub: "All active", color: "#22c55e" },
          { icon: "📅", label: "Total Sessions", value: totalSessions, sub: `${completedSessions} completed`, color: "#3b82f6" },
          { icon: "💰", label: "Revenue", value: fmt$(totalRevenue), sub: `${fmt$(pending)} pending`, color: "#f59e0b" },
        ].map((s, i) => (
          <div key={i} className="card stat" style={{ borderColor: `${s.color}20` }}>
            <div className="stat-glow" style={{ background: s.color }} />
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="g2 mb16">
        <div className="card">
          <div className="sh"><div className="sh-title">Monthly Revenue</div></div>
          <BarChart data={monthlyRev} h={120} />
        </div>
        <div className="card">
          <div className="sh"><div className="sh-title">Session Progress</div></div>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <svg width="120" height="120" viewBox="0 0 120 120" style={{ display: "block", margin: "0 auto" }}>
              <circle cx="60" cy="60" r="48" fill="none" stroke="var(--bg4)" strokeWidth="14" />
              <circle cx="60" cy="60" r="48" fill="none" stroke="var(--accent)" strokeWidth="14"
                strokeDasharray={`${2 * Math.PI * 48 * (completedSessions / Math.max(totalSessions, 1))} ${2 * Math.PI * 48}`}
                strokeLinecap="round" strokeDashoffset={2 * Math.PI * 48 * 0.25} transform="rotate(-90 60 60)" />
              <text x="60" y="58" textAnchor="middle" fill="white" fontSize="18" fontWeight="800">{Math.round((completedSessions / Math.max(totalSessions, 1)) * 100)}%</text>
              <text x="60" y="73" textAnchor="middle" fill="#5c6480" fontSize="10">done</text>
            </svg>
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--text2)" }}>{completedSessions} of {totalSessions} sessions completed</div>
          </div>
          <div className="g2" style={{ gap: 8 }}>
            {[
              { l: "Upcoming", v: data.sessions.filter(s => s.status === "upcoming").length, c: "#f97316" },
              { l: "Completed", v: completedSessions, c: "#22c55e" },
              { l: "Cancelled", v: data.sessions.filter(s => s.isCancelled).length, c: "#6b7280" },
              { l: "Series", v: data.series.length, c: "#f59e0b" },
            ].map((item, i) => (
              <div key={i} style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div className="fw7" style={{ color: item.c, fontSize: 16 }}>{item.v}</div>
                <div className="text-xs muted">{item.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="g2">
        <div className="card">
          <div className="sh"><div className="sh-title">Recent Students</div></div>
          {students.slice(0, 5).map(s => (
            <div key={s.id} className="li">
              <Av name={s.name} />
              <div style={{ flex: 1 }}>
                <div className="fw7 text-sm">{s.name}</div>
                <div className="text-xs muted">{s.level} · {s.city}</div>
              </div>
              <Badge status={s.paymentStatus} />
            </div>
          ))}
        </div>
        <div className="card">
          <div className="sh"><div className="sh-title">Active Series</div></div>
          {data.series.slice(0, 5).map(ser => {
            const sessCount = data.sessions.filter(s => s.seriesId === ser.id).length;
            const done = data.sessions.filter(s => s.seriesId === ser.id && s.status === "completed").length;
            const group = data.groups.find(g => g.id === ser.groupId);
            return (
              <div key={ser.id} className="li">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: ser.paused ? "var(--amber)" : "var(--green)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="fw7 text-sm">{ser.title}</div>
                  <div className="text-xs muted">{group?.name} · {ser.recurringDays?.map(d => DAY_SHORT[d]).join("/")} · {done}/{sessCount} done</div>
                </div>
                {ser.paused ? <Badge status="paused" label="Paused" /> : <Badge status="active" label="Active" />}
              </div>
            );
          })}
          {data.series.length === 0 && <div className="empty" style={{ padding: "20px 0" }}><div className="empty-icon" style={{ fontSize: 24 }}>🔁</div><div className="empty-title">No recurring series</div></div>}
        </div>
      </div>

      {/* Curriculum overview */}
      <div className="g3 mt16">
        {data.books.map(book => {
          const lessons = data.lessons.filter(l => l.bookId === book.id);
          const chapters = book.chapters.length;
          const coveredChapters = new Set(lessons.map(l => l.chapterId)).size;
          return (
            <div key={book.id} className="card" style={{ borderLeft: `3px solid ${book.coverColor}` }}>
              <div className="flex ac gap10 mb10">
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${book.coverColor}22`, color: book.coverColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📖</div>
                <div>
                  <div className="fw7" style={{ fontSize: 13 }}>{book.title}</div>
                  <div className="text-xs muted">{book.level} · {book.author}</div>
                </div>
              </div>
              <div className="flex jb text-xs muted mb4"><span>Chapter coverage</span><span>{coveredChapters}/{chapters}</span></div>
              <div className="prog">
                <div className="prog-fill" style={{ width: `${chapters ? (coveredChapters / chapters) * 100 : 0}%`, background: book.coverColor }} />
              </div>
              <div className="flex jb mt8 text-xs muted">
                <span>{lessons.length} lesson{lessons.length !== 1 ? "s" : ""} planned</span>
                <span>{data.groups.filter(g => book.assignedGroups?.includes(g.id)).map(g => g.name).join(", ") || "No groups"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STUDENT PROFILE MODAL ────────────────────────────────────────────────────
function StudentProfileModal({ student, data, setData, onClose, onResetPassword }) {
  const [showCreds, setShowCreds] = useState(false);
  const [editing, setEditing] = useState(false);
  const freshStudent = data.users.find(u => u.id === student.id) ?? student;
  const [editForm, setEditForm] = useState({
    name: freshStudent.name || "",
    email: freshStudent.email || "",
    phone: freshStudent.phone || "",
    age: freshStudent.age || "",
    city: freshStudent.city || "",
    level: freshStudent.level || "A1",
    groupId: freshStudent.groupId || "",
    paymentStatus: freshStudent.paymentStatus || "pending",
    registrationDate: freshStudent.registrationDate || "",
  });

  const saveEdits = async () => {
    if (!editForm.name || !editForm.email) { toast("Name and email required", "error"); return; }
    try {
      const updated = await api.users.update(freshStudent.id, { ...editForm, groupId: editForm.groupId || null, age: editForm.age ? Number(editForm.age) : null });
      const clean = deepClean(updated);
      setData(d => ({ ...d, users: d.users.map(u => u.id === freshStudent.id ? { ...u, ...clean } : u) }));
      toast("✅ Student profile updated");
      setEditing(false);
    } catch(e) { toast(e.message || "Failed to update student", "error"); }
  };

  return (
    <Modal open={true} onClose={onClose} title="Student Profile" lg>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 20 }}>
        <Av name={freshStudent.name} sz="av-xl" />
        <div style={{ flex: 1 }}>
          <div className="fw8" style={{ fontSize: 19 }}>{freshStudent.name}</div>
          <div className="text-sm muted mt4">{freshStudent.email}{freshStudent.phone ? ` · ${freshStudent.phone}` : ""}</div>
          <div className="mt8 flex gap8 ac" style={{ flexWrap: "wrap" }}>
            <Badge status={freshStudent.paymentStatus} />
            <span className="mono fw7 text-xs" style={{ color: "var(--accent2)", background: "var(--glow)", padding: "3px 8px", borderRadius: 99 }}>{freshStudent.level}</span>
          </div>
        </div>
        <div className="flex gap6">
          <button className="btn btn-pr btn-sm" onClick={() => setEditing(e => !e)}>✏️ {editing ? "Cancel" : "Edit"}</button>
          <button className="btn btn-se btn-sm" onClick={() => onResetPassword(freshStudent)}>🔑</button>
        </div>
      </div>

      {editing ? (
        <div className="card mb16" style={{ padding: 16 }}>
          <div className="sh-title mb12">✏️ Edit Student Info</div>
          <div className="input-row">
            <div className="fg"><label>Full Name *</label><input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="fg"><label>Email *</label><input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="fg"><label>Phone</label><input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div className="fg"><label>Age</label><input type="number" value={editForm.age} onChange={e => setEditForm(p => ({ ...p, age: e.target.value }))} /></div>
            <div className="fg"><label>City</label><input value={editForm.city} onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))} /></div>
            <div className="fg"><label>Level</label>
              <select value={editForm.level} onChange={e => setEditForm(p => ({ ...p, level: e.target.value }))}>
                {["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="fg"><label>Group</label>
              <select value={editForm.groupId} onChange={e => setEditForm(p => ({ ...p, groupId: e.target.value }))}>
                <option value="">No group</option>
                {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="fg"><label>Payment Status</label>
              <select value={editForm.paymentStatus} onChange={e => setEditForm(p => ({ ...p, paymentStatus: e.target.value }))}>
                {["paid","pending","overdue","unpaid"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="fg"><label>Registration Date</label><input type="date" value={editForm.registrationDate} onChange={e => setEditForm(p => ({ ...p, registrationDate: e.target.value }))} /></div>
          </div>
          <div className="flex gap8 mt12">
            <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={saveEdits}>💾 Save Changes</button>
          </div>
        </div>
      ) : (
        <div className="g3 mb16">
          {[
            { l: "Level", v: freshStudent.level },
            { l: "City", v: freshStudent.city || "—" },
            { l: "Group", v: data.groups.find(g => g.id === freshStudent.groupId)?.name || "—" },
            { l: "Age", v: freshStudent.age || "—" },
            { l: "Registered", v: freshStudent.registrationDate },
            { l: "Payment", v: freshStudent.paymentStatus },
          ].map((x, i) => (
            <div key={i} className="card card-sm"><div className="text-xs muted">{x.l}</div><div className="fw7 mt4 text-sm">{x.v}</div></div>
          ))}
        </div>
      )}

      {/* Credentials section */}
      <div style={{ marginBottom: 16 }}>
        <div className="flex ac jb mb8">
          <div className="sh-title">Login Credentials</div>
          <button className="btn btn-se btn-sm" onClick={() => setShowCreds(s => !s)}>
            {showCreds ? "🙈 Hide" : "🔑 Show"}
          </button>
        </div>
        {showCreds
          ? <StudentCredentialCard student={freshStudent} />
          : <div style={{ fontSize: 12, color: "var(--text3)", padding: "10px 12px", background: "var(--bg3)", borderRadius: 8 }}>
              Click "Show" to view login credentials for this student.
            </div>
        }
      </div>

      <div className="sh-title mb8">Payment History</div>
      {data.payments.filter(p => p.studentId === freshStudent.id).length === 0
        ? <div className="empty" style={{ padding: "12px 0" }}><div className="empty-icon" style={{ fontSize: 22 }}>💳</div><div className="empty-title">No payments yet</div></div>
        : data.payments.filter(p => p.studentId === freshStudent.id).map(p => (
          <div key={p.id} className="li">
            <div style={{ flex: 1 }}><div className="fw7 text-sm">{p.month}</div><div className="text-xs muted">Due: {p.dueDate}</div></div>
            <div className="fw7 mono" style={{ marginRight: 10 }}>{fmt$(p.amount)}</div>
            <Badge status={p.status} />
          </div>
        ))
      }
    </Modal>
  );
}

// ─── STUDENTS PAGE ────────────────────────────────────────────────────────────
// Password strength checker
const pwStrength = (pw) => {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "#ef4444" };
  if (score <= 2) return { score, label: "Fair", color: "#f59e0b" };
  if (score <= 3) return { score, label: "Good", color: "#3b82f6" };
  return { score, label: "Strong", color: "#22c55e" };
};

// Generate a random readable password
const genPassword = () => {
  const adj = ["Blue","Swift","Bright","Cool","Star","Sky","Fast","Bold"];
  const noun = ["Lion","Eagle","River","Storm","Rock","Wave","Fire","Moon"];
  const num = Math.floor(10 + Math.random() * 90);
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)] + num;
};

function StudentCredentialCard({ student, onCopy }) {
  const [show, setShow] = useState(false);
  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      toast(`📋 ${label} copied!`);
      if (onCopy) onCopy();
    }).catch(() => toast("Copy failed", "error"));
  };
  return (
    <div className="cred-card">
      <div className="cred-card-title">🔑 Login Credentials</div>
      <div className="cred-row">
        <div className="cred-label">Email</div>
        <div className="cred-value">{student.email}</div>
        <button className="link-action-btn" onClick={() => copy(student.email, "Email")}>📋</button>
      </div>
      <div className="cred-row">
        <div className="cred-label">Password</div>
        <div className={`cred-value ${show ? "" : "masked"}`}>{show ? student.password : "••••••••"}</div>
        <button className="link-action-btn" onClick={() => setShow(s => !s)}>{show ? "🙈" : "👁"}</button>
        <button className="link-action-btn" onClick={() => copy(student.password, "Password")}>📋</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8, lineHeight: 1.5 }}>
        Share these credentials with the student so they can log in to their dashboard.
      </div>
    </div>
  );
}

function StudentsPage({ data, setData }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const [search,       setSearch]       = useState("");
  const [lvlFilter,    setLvlFilter]    = useState("all");
  const [payFilter,    setPayFilter]    = useState("all");
  const [groupFilter,  setGroupFilter]  = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [sortBy,       setSortBy]       = useState("name");   // name|date|level|payment
  const [sortDir,      setSortDir]      = useState("asc");
  const [showFilters,  setShowFilters]  = useState(true); // kept for compat, always visible now
  const [showAdd,      setShowAdd]      = useState(false);
  const [viewSt,       setViewSt]       = useState(null);
  const [showCredentials, setShowCredentials] = useState(null);
  const [resetTarget,  setResetTarget]  = useState(null);
  const [newPw,        setNewPw]        = useState("");
  const [form, setForm] = useState({ name: "", age: "", city: "", phone: "", email: "", level: "A2", groupId: "", paymentStatus: "pending", password: "" });

  const activeFilterCount = [
    lvlFilter !== "all", payFilter !== "all", groupFilter !== "all",
    !!dateFrom, !!dateTo
  ].filter(Boolean).length;

  const clearFilters = () => {
    setLvlFilter("all"); setPayFilter("all"); setGroupFilter("all");
    setDateFrom(""); setDateTo(""); setSearch("");
  };

  const allStudents = data.users.filter(u => u.role === "student");

  const students = allStudents
    .filter(s => lvlFilter  === "all" || s.level         === lvlFilter)
    .filter(s => payFilter  === "all" || s.paymentStatus === payFilter)
    .filter(s => groupFilter === "all"|| String(s.groupId) === groupFilter)
    .filter(s => {
      if (!dateFrom && !dateTo) return true;
      const reg = s.registrationDate;
      if (!reg) return false;
      if (dateFrom && reg < dateFrom) return false;
      if (dateTo   && reg > dateTo)   return false;
      return true;
    })
    .filter(s =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email?.toLowerCase().includes(search.toLowerCase()) ||
      s.city?.toLowerCase().includes(search.toLowerCase()) ||
      s.phone?.includes(search)
    )
    .sort((a, b) => {
      let va, vb;
      if (sortBy === "name")    { va = a.name;              vb = b.name; }
      else if (sortBy === "date")    { va = a.registrationDate || ""; vb = b.registrationDate || ""; }
      else if (sortBy === "level")   { va = a.level;             vb = b.level; }
      else if (sortBy === "payment") {
        const order = { paid: 0, pending: 1, overdue: 2 };
        va = order[a.paymentStatus] ?? 3; vb = order[b.paymentStatus] ?? 3;
        return sortDir === "asc" ? va - vb : vb - va;
      }
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });

  const SortTh = ({ col, children }) => (
    <th style={{ cursor:"pointer", userSelect:"none", whiteSpace:"nowrap" }}
      onClick={() => { if (sortBy===col) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortBy(col); setSortDir("asc"); } }}>
      {children}{sortBy===col ? (sortDir==="asc"?" ↑":" ↓") : " ↕"}
    </th>
  );

  const addStudent = async () => {
    if (!form.name || !form.email) { toast("Name and email required", "error"); return; }
    if (!form.password) { toast("Password required", "error"); return; }
    if (form.password.length < 6) { toast("Password must be at least 6 characters", "error"); return; }
    if (data.users.find(u => u.email === form.email)) { toast("Email already exists", "error"); return; }
    try {
      const created = await api.users.create({
        ...form,
        role: "student",
        age: Number(form.age) || null,
        groupId: form.groupId || null,
        registrationDate: new Date().toISOString().split("T")[0],
      });
      const newS = deepClean(created);
      setData(d => ({ ...d, users: [...d.users, newS] }));
      toast(`✅ ${form.name} added!`);
      setShowAdd(false);
      setShowCredentials({ ...newS, password: form.password });
      setForm({ name: "", age: "", city: "", phone: "", email: "", level: "A2", groupId: "", paymentStatus: "pending", password: "" });
    } catch(e) { toast(e.message || "Failed to create student", "error"); }
  };

  const removeStudent = async (id) => {
    try {
      await api.users.delete(id);
      setData(d => ({ ...d, users: d.users.filter(u => u.id !== id) }));
      toast("Student removed");
    } catch(e) { toast(e.message || "Failed to remove student", "error"); }
  };

  const resetPassword = (studentId, password) => {
    if (!password || password.length < 6) { toast("Password must be at least 6 characters", "error"); return; }
    setData(d => ({ ...d, users: d.users.map(u => u.id === studentId ? { ...u, password } : u) }));
    toast("🔑 Password updated");
    setResetTarget(null);
    setNewPw("");
    // If viewing the student, refresh viewSt
    if (viewSt?.id === studentId) setViewSt(v => ({ ...v, password }));
  };

  const strength = pwStrength(form.password);

  // ── quick stats for header ──────────────────────────────────────────────────
  const countPaid    = allStudents.filter(s => s.paymentStatus === "paid").length;
  const countPending = allStudents.filter(s => s.paymentStatus === "pending").length;
  const countOverdue = allStudents.filter(s => s.paymentStatus === "overdue").length;

  return (
    <div>

      {/* ── Page header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">👨‍🎓 Students</div>
          <div className="ph-sub" style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span>
              Showing <strong style={{ color:"var(--text)" }}>{students.length}</strong> of <strong style={{ color:"var(--text)" }}>{allStudents.length}</strong> students
            </span>
            {activeFilterCount > 0 && (
              <span style={{ fontSize:11, fontWeight:700, color:"var(--accent2)", background:"var(--glow)",
                padding:"2px 9px", borderRadius:99, border:"1px solid rgba(249,115,22,.25)" }}>
                {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
              </span>
            )}
          </div>
        </div>
        <div className="ph-right">
          <button className="btn btn-pr" onClick={() => setShowAdd(true)}>+ Add Student</button>
        </div>
      </div>

      {/* ── Quick-stat chips ── */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
        {[
          { label:"All",     count:allStudents.length, val:"all",     color:"var(--accent2)",  bg:"var(--glow)",                    border:"rgba(249,115,22,.25)", f:()=>{ setPayFilter("all"); setLvlFilter("all"); setGroupFilter("all"); setDateFrom(""); setDateTo(""); } },
          { label:"✅ Paid",    count:countPaid,    val:"paid",    color:"#22c55e",  bg:"rgba(34,197,94,.1)",      border:"rgba(34,197,94,.25)",  f:()=>setPayFilter(p=>p==="paid"?"all":"paid") },
          { label:"⏳ Pending", count:countPending, val:"pending", color:"#f59e0b",  bg:"rgba(245,158,11,.1)",     border:"rgba(245,158,11,.25)", f:()=>setPayFilter(p=>p==="pending"?"all":"pending") },
          { label:"🔴 Overdue", count:countOverdue, val:"overdue", color:"#ef4444",  bg:"rgba(239,68,68,.1)",      border:"rgba(239,68,68,.25)",  f:()=>setPayFilter(p=>p==="overdue"?"all":"overdue") },
        ].map(chip => {
          const active = chip.val === "all" ? activeFilterCount === 0 : payFilter === chip.val;
          return (
            <button key={chip.val} onClick={chip.f}
              style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 13px", borderRadius:10,
                background: active ? chip.bg : "var(--bg3)",
                border: `1.5px solid ${active ? chip.border : "var(--border)"}`,
                cursor:"pointer", transition:"all .15s", fontFamily:"var(--font)" }}>
              <span style={{ fontSize:12, fontWeight:700, color: active ? chip.color : "var(--text2)" }}>{chip.label}</span>
              <span style={{ fontSize:11, fontWeight:800, minWidth:18, textAlign:"center",
                padding:"1px 6px", borderRadius:99,
                background: active ? chip.color+"22" : "var(--bg4)",
                color: active ? chip.color : "var(--text3)" }}>{chip.count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Filter panel ── */}
      <div className="card mb14" style={{ padding:"16px 18px" }}>

        {/* Row 1: search bar */}
        <div style={{ position:"relative", marginBottom:14 }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)",
            color:"var(--text3)", fontSize:15, pointerEvents:"none" }}>🔍</span>
          <input
            style={{ paddingLeft:38, width:"100%", fontSize:13 }}
            placeholder="Search by name, email, city or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")}
              style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                background:"none", border:"none", cursor:"pointer", color:"var(--text3)", fontSize:16 }}>✕</button>
          )}
        </div>

        {/* Row 2: filter dropdowns grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, marginBottom:14 }}>

          {/* Level */}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>📚 Level</label>
            <select value={lvlFilter} onChange={e => setLvlFilter(e.target.value)}>
              <option value="all">All Levels</option>
              {["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          {/* Payment status */}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>💳 Payment</label>
            <select value={payFilter} onChange={e => setPayFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="paid">✅ Paid</option>
              <option value="pending">⏳ Pending</option>
              <option value="overdue">🔴 Overdue</option>
            </select>
          </div>

          {/* Group */}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>👥 Group</label>
            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
              <option value="all">All Groups</option>
              <option value="null">No Group</option>
              {data.groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
            </select>
          </div>

          {/* Registered From */}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>📅 Registered From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>

          {/* Registered To */}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>📅 Registered To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>

          {/* Sort */}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>↕ Sort By</label>
            <select value={sortBy+":"+sortDir}
              onChange={e => { const [col,dir] = e.target.value.split(":"); setSortBy(col); setSortDir(dir); }}>
              <option value="name:asc">Name A → Z</option>
              <option value="name:desc">Name Z → A</option>
              <option value="date:desc">Newest Registered</option>
              <option value="date:asc">Oldest Registered</option>
              <option value="level:asc">Level A → Z</option>
              <option value="level:desc">Level Z → A</option>
              <option value="payment:asc">Paid First</option>
              <option value="payment:desc">Overdue First</option>
            </select>
          </div>
        </div>

        {/* Row 3: active filter tags + clear */}
        {(activeFilterCount > 0 || search) && (
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
            paddingTop:12, borderTop:"1px solid var(--border)" }}>
            <span style={{ fontSize:11, color:"var(--text3)", fontWeight:600 }}>Active:</span>

            {search && (
              <span onClick={() => setSearch("")}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600,
                  padding:"3px 10px", borderRadius:99, cursor:"pointer",
                  background:"rgba(99,102,241,.12)", color:"#818cf8", border:"1px solid rgba(99,102,241,.25)" }}>
                🔍 "{search}" <span style={{ opacity:.7 }}>✕</span>
              </span>
            )}
            {lvlFilter !== "all" && (
              <span onClick={() => setLvlFilter("all")}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600,
                  padding:"3px 10px", borderRadius:99, cursor:"pointer",
                  background:"rgba(249,115,22,.12)", color:"var(--accent2)", border:"1px solid rgba(249,115,22,.25)" }}>
                📚 {lvlFilter} <span style={{ opacity:.7 }}>✕</span>
              </span>
            )}
            {payFilter !== "all" && (
              <span onClick={() => setPayFilter("all")}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600,
                  padding:"3px 10px", borderRadius:99, cursor:"pointer",
                  background: payFilter==="paid"?"rgba(34,197,94,.12)":payFilter==="overdue"?"rgba(239,68,68,.12)":"rgba(245,158,11,.12)",
                  color:      payFilter==="paid"?"#22c55e":payFilter==="overdue"?"#ef4444":"#f59e0b",
                  border:     `1px solid ${payFilter==="paid"?"rgba(34,197,94,.25)":payFilter==="overdue"?"rgba(239,68,68,.25)":"rgba(245,158,11,.25)"}` }}>
                💳 {payFilter} <span style={{ opacity:.7 }}>✕</span>
              </span>
            )}
            {groupFilter !== "all" && (
              <span onClick={() => setGroupFilter("all")}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600,
                  padding:"3px 10px", borderRadius:99, cursor:"pointer",
                  background:"rgba(249,115,22,.12)", color:"var(--accent2)", border:"1px solid rgba(249,115,22,.25)" }}>
                👥 {groupFilter==="null"?"No Group":data.groups.find(g=>String(g.id)===groupFilter)?.name||groupFilter} <span style={{ opacity:.7 }}>✕</span>
              </span>
            )}
            {dateFrom && (
              <span onClick={() => setDateFrom("")}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600,
                  padding:"3px 10px", borderRadius:99, cursor:"pointer",
                  background:"rgba(99,102,241,.12)", color:"#818cf8", border:"1px solid rgba(99,102,241,.25)" }}>
                📅 From {dateFrom} <span style={{ opacity:.7 }}>✕</span>
              </span>
            )}
            {dateTo && (
              <span onClick={() => setDateTo("")}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600,
                  padding:"3px 10px", borderRadius:99, cursor:"pointer",
                  background:"rgba(99,102,241,.12)", color:"#818cf8", border:"1px solid rgba(99,102,241,.25)" }}>
                📅 To {dateTo} <span style={{ opacity:.7 }}>✕</span>
              </span>
            )}

            <button onClick={clearFilters}
              style={{ marginLeft:"auto", fontSize:11, fontWeight:700, padding:"4px 12px",
                borderRadius:8, border:"1px solid var(--border2)", background:"var(--bg3)",
                color:"var(--text3)", cursor:"pointer" }}>
              ✕ Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── Students table ── */}
      <div className="card" style={{ padding:0, overflow:"hidden" }}>

        {/* Table header with result count */}
        <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border)",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:13, fontWeight:700 }}>
            {students.length} student{students.length !== 1 ? "s" : ""}
            {activeFilterCount > 0 && <span style={{ fontWeight:400, color:"var(--text3)" }}> matched</span>}
          </div>
          <div style={{ fontSize:11, color:"var(--text3)" }}>
            Click column headers to sort
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh col="name">Student</SortTh>
                <SortTh col="level">Level</SortTh>
                <th>Group</th>
                <th className="hide-mobile">City</th>
                <SortTh col="date">Registered</SortTh>
                <SortTh col="payment">Payment</SortTh>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => {
                const g = data.groups.find(g => g.id === s.groupId);
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                        <Av name={s.name} />
                        <div>
                          <div className="fw7" style={{ fontSize:13 }}>{s.name}</div>
                          <div style={{ fontSize:11, color:"var(--text3)", marginTop:1 }}>{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontFamily:"var(--mono)", fontWeight:800, fontSize:12,
                        color:"var(--accent2)", background:"var(--glow)",
                        padding:"2px 8px", borderRadius:6, border:"1px solid rgba(249,115,22,.2)" }}>
                        {s.level}
                      </span>
                    </td>
                    <td>
                      {g
                        ? <span style={{ fontSize:12, fontWeight:600 }}>{g.name}</span>
                        : <span style={{ fontSize:11, color:"var(--text3)" }}>No group</span>}
                    </td>
                    <td className="hide-mobile" style={{ fontSize:12, color:"var(--text2)" }}>{s.city || "—"}</td>
                    <td style={{ fontSize:11, fontFamily:"var(--mono)", color:"var(--text3)", whiteSpace:"nowrap" }}>
                      {s.registrationDate || "—"}
                    </td>
                    <td><Badge status={s.paymentStatus} /></td>
                    <td>
                      <div style={{ display:"flex", gap:5 }}>
                        <button className="btn btn-se btn-sm"
                          onClick={() => setViewSt(data.users.find(u => u.id === s.id))}>View</button>
                        <button className="btn btn-se btn-sm"
                          onClick={() => { setResetTarget(s); setNewPw(""); }}>🔑</button>
                        <button className="btn btn-da btn-sm"
                          onClick={() => removeStudent(s.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {students.length === 0 && (
            <div className="empty" style={{ padding:"48px 0" }}>
              <div className="empty-icon">🔍</div>
              <div className="empty-title">No students match your filters</div>
              <div className="empty-sub" style={{ marginTop:6, fontSize:12, color:"var(--text3)" }}>
                Try adjusting or clearing the filters above
              </div>
              <button className="btn btn-se btn-sm" style={{ marginTop:12 }} onClick={clearFilters}>
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── ADD STUDENT MODAL ── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Student" lg>
        <div className="input-row">
          <div className="fg"><label>Full Name *</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="John Doe" /></div>
          <div className="fg"><label>Email *</label><input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="john@email.com" /></div>
          <div className="fg"><label>Age</label><input type="number" value={form.age} onChange={e => setForm(p => ({ ...p, age: e.target.value }))} placeholder="20" /></div>
          <div className="fg"><label>Phone</label><input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+1 555-0100" /></div>
          <div className="fg"><label>City</label><input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="New York" /></div>
          <div className="fg"><label>Level</label><select value={form.level} onChange={e => setForm(p => ({ ...p, level: e.target.value }))}>{["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}</select></div>
          <div className="fg" style={{ gridColumn: "1/-1" }}>
            <label>Assign Group</label>
            <select value={form.groupId} onChange={e => setForm(p => ({ ...p, groupId: e.target.value }))}>
              <option value="">No group</option>
              {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        {/* Password section */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🔑 Set Login Password</div>
          <div className="fg" style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Minimum 6 characters"
                style={{ flex: 1 }}
              />
              <button className="btn btn-se btn-sm" style={{ flexShrink: 0 }} onClick={() => setForm(p => ({ ...p, password: genPassword() }))}>
                🎲 Generate
              </button>
            </div>
            {form.password && (
              <>
                <div className="pw-strength" style={{ width: `${(strength.score / 5) * 100}%`, background: strength.color }} />
                <div className="pw-hint" style={{ color: strength.color }}>{strength.label} password</div>
              </>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.6, padding: "8px 10px", background: "var(--bg3)", borderRadius: 8 }}>
            💡 After saving, you'll see the credentials to share with the student.<br/>
            They can use their email + this password to log in.
          </div>
        </div>

        <div className="flex gap8 mt16">
          <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setShowAdd(false)}>Cancel</button>
          <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={addStudent}>Add Student</button>
        </div>
      </Modal>

      {/* ── CREDENTIALS POPUP (shown right after student creation) ── */}
      <Modal open={!!showCredentials} onClose={() => setShowCredentials(null)} title="✅ Student Added Successfully" lg>
        {showCredentials && (
          <>
            <div className="flex ac gap12 mb16">
              <Av name={showCredentials.name} sz="av-lg" />
              <div>
                <div className="fw7" style={{ fontSize: 15 }}>{showCredentials.name}</div>
                <div className="text-xs muted mt2">{showCredentials.level} · {data.groups.find(g => g.id === showCredentials.groupId)?.name || "No group"}</div>
              </div>
            </div>
            <StudentCredentialCard student={showCredentials} />
            <div style={{ background: "rgba(34,197,94,.06)", border: "1px solid rgba(34,197,94,.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 700, marginBottom: 4 }}>📤 How to share with student</div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
                1. Copy the credentials above<br/>
                2. Send via WhatsApp, SMS, or email to the student<br/>
                3. Ask them to change their password after first login
              </div>
            </div>
            <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={() => setShowCredentials(null)}>Done</button>
          </>
        )}
      </Modal>

      {/* ── RESET PASSWORD MODAL ── */}
      <Modal open={!!resetTarget} onClose={() => { setResetTarget(null); setNewPw(""); }} title="Reset Password">
        {resetTarget && (
          <>
            <div className="flex ac gap10 mb16">
              <Av name={resetTarget.name} sz="av-md" />
              <div><div className="fw7">{resetTarget.name}</div><div className="text-xs muted">{resetTarget.email}</div></div>
            </div>
            <div className="fg">
              <label>New Password *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="Min 6 characters"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-se btn-sm" style={{ flexShrink: 0 }} onClick={() => setNewPw(genPassword())}>🎲</button>
              </div>
              {newPw && (() => {
                const s = pwStrength(newPw);
                return <>
                  <div className="pw-strength" style={{ width: `${(s.score / 5) * 100}%`, background: s.color }} />
                  <div className="pw-hint" style={{ color: s.color }}>{s.label}</div>
                </>;
              })()}
            </div>
            <div className="flex gap8 mt12">
              <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => { setResetTarget(null); setNewPw(""); }}>Cancel</button>
              <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={() => resetPassword(resetTarget.id, newPw)}>Save Password</button>
            </div>
          </>
        )}
      </Modal>

      {/* ── VIEW STUDENT MODAL ── */}
      {viewSt && (
        <StudentProfileModal
          student={viewSt}
          data={data}
          setData={setData}
          onClose={() => setViewSt(null)}
          onResetPassword={(s) => { setViewSt(null); setResetTarget(s); setNewPw(""); }}
        />
      )}
    </div>
  );
}

// ─── TEACHERS PAGE ────────────────────────────────────────────────────────────
// ─── TEACHER PROFILE MODAL ────────────────────────────────────────────────────
function TeacherProfileModal({ teacher, data, setData, onClose, onResetPassword, markTeacherPaid }) {
  const [editing, setEditing] = useState(false);
  const fresh = data.users.find(u => u.id === teacher.id) ?? teacher;
  const earnings = teacher.earnings ?? {};
  const [editForm, setEditForm] = useState({
    name: fresh.name || "",
    email: fresh.email || "",
    phone: fresh.phone || "",
    commission: fresh.commission ?? 35,
    salaryType: fresh.salaryType || "commission",
    status: fresh.status || "active",
  });

  const saveEdits = async () => {
    if (!editForm.name || !editForm.email) { toast("Name and email required", "error"); return; }
    try {
      const updated = await api.users.update(fresh.id, { ...editForm, commission: Number(editForm.commission) });
      const clean = deepClean(updated);
      setData(d => ({ ...d, users: d.users.map(u => u.id === fresh.id ? { ...u, ...clean } : u) }));
      toast("✅ Teacher profile updated");
      setEditing(false);
    } catch(e) { toast(e.message || "Failed to update teacher", "error"); }
  };

  return (
    <Modal open={true} onClose={onClose} title="Teacher Profile" lg>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 20 }}>
        <Av name={fresh.name} sz="av-xl" />
        <div style={{ flex: 1 }}>
          <div className="fw8" style={{ fontSize: 19 }}>{fresh.name}</div>
          <div className="text-sm muted mt4">{fresh.email}{fresh.phone ? ` · ${fresh.phone}` : ""}</div>
          <div className="mt8 flex gap8 ac" style={{ flexWrap: "wrap" }}>
            <Badge status={fresh.status} />
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--accent2)", background: "var(--glow)", padding: "3px 8px", borderRadius: 99, fontWeight: 600 }}>{fresh.commission}% commission</span>
          </div>
        </div>
        <div className="flex gap6">
          <button className="btn btn-pr btn-sm" onClick={() => setEditing(e => !e)}>✏️ {editing ? "Cancel" : "Edit"}</button>
          <button className="btn btn-se btn-sm" onClick={onResetPassword}>🔑</button>
        </div>
      </div>

      {editing ? (
        <div className="card mb16" style={{ padding: 16 }}>
          <div className="sh-title mb12">✏️ Edit Teacher Info</div>
          <div className="input-row">
            <div className="fg"><label>Full Name *</label><input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="fg"><label>Email *</label><input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="fg"><label>Phone</label><input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div className="fg"><label>Commission (%)</label><input type="number" min="0" max="100" value={editForm.commission} onChange={e => setEditForm(p => ({ ...p, commission: e.target.value }))} /></div>
            <div className="fg"><label>Salary Type</label>
              <select value={editForm.salaryType} onChange={e => setEditForm(p => ({ ...p, salaryType: e.target.value }))}>
                <option value="commission">Commission</option>
                <option value="fixed">Fixed</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            <div className="fg"><label>Status</label>
              <select value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex gap8 mt12">
            <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={saveEdits}>💾 Save Changes</button>
          </div>
        </div>
      ) : (
        <div className="g4 mb16">
          {[{ l: "Earned", v: fmt$(earnings.commission), c: "var(--green)" }, { l: "Paid", v: fmt$(earnings.paid), c: "var(--blue)" }, { l: "Balance", v: fmt$(earnings.balance), c: earnings.balance > 0 ? "var(--red)" : "var(--green)" }, { l: "Sessions", v: earnings.sessions }].map((x, i) => (
            <div key={i} className="card card-sm" style={{ textAlign: "center" }}><div className="fw8" style={{ fontSize: 18, color: x.c }}>{x.v}</div><div className="text-xs muted">{x.l}</div></div>
          ))}
        </div>
      )}

      <div className="sh-title mb8">Payment Records</div>
      {data.teacherPayments.filter(tp => tp.teacherId === fresh.id).map(tp => (
        <div key={tp.id} className="li">
          <div style={{ flex: 1 }}><div className="fw7 text-sm">{tp.month}</div><div className="text-xs muted">{tp.date ?? "Not yet paid"}</div></div>
          <div className="fw7 mono" style={{ marginRight: 12 }}>{fmt$(tp.amount)}</div>
          <Badge status={tp.status} />
          {tp.status !== "paid" && <button className="btn btn-pr btn-xs" style={{ marginLeft: 8 }} onClick={() => markTeacherPaid(tp.id)}>Pay</button>}
        </div>
      ))}
    </Modal>
  );
}

function TeachersPage({ data, setData }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const [showAdd, setShowAdd] = useState(false);
  const [viewT, setViewT] = useState(null);
  const [showCredentials, setShowCredentials] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", commission: 35, salaryType: "commission", status: "active", password: "" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const allTeachers = data.users.filter(u => u.role === "teacher");
  const teachers = allTeachers
    .filter(t => statusFilter === "all" || t.status === statusFilter)
    .filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.email?.toLowerCase().includes(search.toLowerCase()));

  const addTeacher = async () => {
    if (!form.name || !form.email) { toast("Name and email required", "error"); return; }
    if (!form.password) { toast("Password required", "error"); return; }
    if (form.password.length < 6) { toast("Min 6 characters for password", "error"); return; }
    if (data.users.find(u => u.email.toLowerCase() === form.email.toLowerCase())) { toast("Email already exists", "error"); return; }
    try {
      const created = await api.users.create({ ...form, role: "teacher", commission: Number(form.commission) });
      const newT = deepClean(created);
      setData(d => ({ ...d, users: [...d.users, newT] }));
      toast("✅ Teacher added!");
      setShowAdd(false);
      setShowCredentials({ ...newT, password: form.password });
      setForm({ name: "", email: "", phone: "", commission: 35, salaryType: "commission", status: "active", password: "" });
    } catch(e) { toast(e.message || "Failed to create teacher", "error"); }
  };

  const resetPassword = async (teacherId, password) => {
    if (!password || password.length < 6) { toast("Password must be at least 6 characters", "error"); return; }
    try {
      await api.users.update(teacherId, { password });
      setData(d => ({ ...d, users: d.users.map(u => u.id === teacherId ? { ...u } : u) }));
      toast("🔑 Password updated");
      setResetTarget(null);
      setNewPw("");
    } catch(e) { toast(e.message || "Failed to update password", "error"); }
  };

  const getEarnings = (tid) => {
    const tGroups = data.groups.filter(g => g.teacherId === tid);
    const tStudents = data.users.filter(u => u.role === "student" && tGroups.some(g => g.id === u.groupId));
    const revenue = tStudents.reduce((s, st) => s + data.payments.filter(p => p.studentId === st.id && p.status === "paid").reduce((a, p) => a + p.amount, 0), 0);
    const t = data.users.find(u => u.id === tid);
    const commission = ((t?.commission ?? 35) / 100) * revenue;
    const paid = data.teacherPayments.filter(tp => tp.teacherId === tid && tp.status === "paid").reduce((s, p) => s + p.amount, 0);
    return { revenue, commission, paid, balance: commission - paid, sessions: data.sessions.filter(s => s.teacherId === tid && s.status === "completed").length };
  };

  const markTeacherPaid = (tpId) => {
    setData(d => ({ ...d, teacherPayments: d.teacherPayments.map(tp => tp.id === tpId ? { ...tp, status: "paid", date: new Date().toISOString().split("T")[0] } : tp) }));
    toast("Payment processed");
  };

  const strength = pwStrength(form.password);
  const resetStrength = pwStrength(newPw);

  return (
    <div>
      <div className="ph">
        <div><div className="ph-title">Teachers</div><div className="ph-sub">{teachers.length} of {allTeachers.length} shown</div></div>
        <button className="btn btn-pr" onClick={() => setShowAdd(true)}>+ Add Teacher</button>
      </div>

      {/* Filter bar */}
      <div className="card mb12" style={{ padding: "12px 14px" }}>
        <div className="flex ac gap8" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", fontSize: 14 }}>🔍</span>
            <input style={{ paddingLeft: 32 }} placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {(search || statusFilter !== "all") && (
            <button className="btn btn-se btn-sm" onClick={() => { setSearch(""); setStatusFilter("all"); }}>✕ Clear</button>
          )}
        </div>
      </div>

      {teachers.length === 0 && (
        <div className="empty" style={{ marginTop: 32 }}>
          <div className="empty-icon">👨‍🏫</div>
          <div className="empty-title">No teachers match your filters</div>
        </div>
      )}

      <div className="g2">
        {teachers.map(t => {
          const e = getEarnings(t.id);
          const groups = data.groups.filter(g => g.teacherId === t.id);
          const students = data.users.filter(u => u.role === "student" && groups.some(g => g.id === u.groupId));
          return (
            <div key={t.id} className="card" style={{ cursor: "pointer" }} onClick={() => setViewT({ ...t, earnings: e, groups, students })}>
              <div className="flex ac gap12 mb14">
                <Av name={t.name} sz="av-lg" />
                <div style={{ flex: 1 }}><div className="fw7" style={{ fontSize: 15 }}>{t.name}</div><div className="text-xs muted">{t.email}</div><div className="mt6"><Badge status={t.status} /></div></div>
                <div style={{ textAlign: "right" }}>
                  <div className="fw8 mono" style={{ fontSize: 20, color: "var(--accent2)" }}>{t.commission}%</div>
                  <div className="text-xs muted">commission</div>
                  <button className="btn btn-se btn-xs mt4" onClick={e => { e.stopPropagation(); setResetTarget(t); setNewPw(""); }}>🔑</button>
                </div>
              </div>
              <div className="g3" style={{ gap: 8 }}>
                {[{ l: "Groups", v: groups.length }, { l: "Students", v: students.length }, { l: "Sessions", v: e.sessions }].map((x, i) => (
                  <div key={i} style={{ background: "var(--bg3)", borderRadius: 8, padding: "9px 10px", textAlign: "center" }}>
                    <div className="fw7" style={{ fontSize: 15 }}>{x.v}</div>
                    <div className="text-xs muted">{x.l}</div>
                  </div>
                ))}
              </div>
              <div className="divider" />
              <div className="flex ac jb">
                <div><div className="text-xs muted">Earned</div><div className="fw7" style={{ color: "var(--green)" }}>{fmt$(e.commission)}</div></div>
                <div><div className="text-xs muted">Paid</div><div className="fw7" style={{ color: "var(--blue)" }}>{fmt$(e.paid)}</div></div>
                <div><div className="text-xs muted">Balance</div><div className="fw7" style={{ color: e.balance > 0 ? "var(--red)" : "var(--green)" }}>{fmt$(e.balance)}</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── ADD TEACHER MODAL ── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Teacher" lg>
        <div className="input-row">
          <div className="fg"><label>Full Name *</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" /></div>
          <div className="fg"><label>Email *</label><input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="jane@eloc.com" /></div>
          <div className="fg"><label>Phone</label><input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
          <div className="fg"><label>Commission %</label><input type="number" min="0" max="100" value={form.commission} onChange={e => setForm(p => ({ ...p, commission: e.target.value }))} /></div>
          <div className="fg"><label>Salary Type</label><select value={form.salaryType} onChange={e => setForm(p => ({ ...p, salaryType: e.target.value }))}><option value="commission">Commission</option><option value="fixed">Fixed</option></select></div>
          <div className="fg"><label>Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>

        {/* Password section */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🔑 Set Login Password</div>
          <div className="fg" style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Minimum 6 characters" style={{ flex: 1 }} />
              <button className="btn btn-se btn-sm" style={{ flexShrink: 0 }} onClick={() => setForm(p => ({ ...p, password: genPassword() }))}>🎲 Generate</button>
            </div>
            {form.password && (
              <>
                <div className="pw-strength" style={{ width: `${(strength.score / 5) * 100}%`, background: strength.color }} />
                <div className="pw-hint" style={{ color: strength.color }}>{strength.label} password</div>
              </>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.6, padding: "8px 10px", background: "var(--bg3)", borderRadius: 8 }}>
            💡 After saving, you'll see credentials to share with the teacher.
          </div>
        </div>

        <div className="flex gap8 mt16">
          <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setShowAdd(false)}>Cancel</button>
          <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={addTeacher}>Add Teacher</button>
        </div>
      </Modal>

      {/* ── CREDENTIALS POPUP ── */}
      <Modal open={!!showCredentials} onClose={() => setShowCredentials(null)} title="✅ Teacher Added Successfully" lg>
        {showCredentials && (
          <>
            <div className="flex ac gap12 mb16">
              <Av name={showCredentials.name} sz="av-lg" />
              <div>
                <div className="fw7" style={{ fontSize: 15 }}>{showCredentials.name}</div>
                <div className="text-xs muted mt2">Teacher · {showCredentials.commission}% commission</div>
              </div>
            </div>
            <StudentCredentialCard student={showCredentials} />
            <div style={{ background: "rgba(34,197,94,.06)", border: "1px solid rgba(34,197,94,.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 700, marginBottom: 4 }}>📤 How to share with teacher</div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
                1. Copy the credentials above<br/>
                2. Send via WhatsApp, SMS, or email<br/>
                3. Teacher can log in at the Teacher tab on the login page
              </div>
            </div>
            <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={() => setShowCredentials(null)}>Done</button>
          </>
        )}
      </Modal>

      {/* ── RESET PASSWORD MODAL ── */}
      <Modal open={!!resetTarget} onClose={() => { setResetTarget(null); setNewPw(""); }} title="Reset Teacher Password">
        {resetTarget && (
          <>
            <div className="flex ac gap10 mb16">
              <Av name={resetTarget.name} sz="av-md" />
              <div><div className="fw7">{resetTarget.name}</div><div className="text-xs muted">{resetTarget.email}</div></div>
            </div>
            <div className="fg">
              <label>New Password *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 6 characters" style={{ flex: 1 }} />
                <button className="btn btn-se btn-sm" style={{ flexShrink: 0 }} onClick={() => setNewPw(genPassword())}>🎲</button>
              </div>
              {newPw && (
                <>
                  <div className="pw-strength" style={{ width: `${(resetStrength.score / 5) * 100}%`, background: resetStrength.color }} />
                  <div className="pw-hint" style={{ color: resetStrength.color }}>{resetStrength.label}</div>
                </>
              )}
            </div>
            <div className="flex gap8 mt12">
              <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => { setResetTarget(null); setNewPw(""); }}>Cancel</button>
              <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={() => resetPassword(resetTarget.id, newPw)}>Save Password</button>
            </div>
          </>
        )}
      </Modal>

      {/* ── VIEW TEACHER MODAL ── */}
      {viewT && (
        <TeacherProfileModal
          teacher={viewT}
          data={data}
          setData={setData}
          onClose={() => setViewT(null)}
          onResetPassword={() => { setViewT(null); setResetTarget(viewT); setNewPw(""); }}
          markTeacherPaid={markTeacherPaid}
        />
      )}
    </div>
  );
}

// ─── GROUPS PAGE ──────────────────────────────────────────────────────────────
function GroupsPage({ data, setData }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const [showAdd, setShowAdd] = useState(false);
  const [viewG, setViewG] = useState(null);
  const [editGroupForm, setEditGroupForm] = useState(null);
  const [form, setForm] = useState({ name: "", level: "A2", teacherId: "", maxStudents: 12, schedule: "" });
  const [search, setSearch] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");

  const allGroups = data.groups;
  const filteredGroups = allGroups
    .filter(g => levelFilter === "all" || g.level === levelFilter)
    .filter(g => teacherFilter === "all" || String(g.teacherId) === teacherFilter)
    .filter(g => g.name.toLowerCase().includes(search.toLowerCase()));

  const addGroup = async () => {
    if (!form.name || !form.teacherId) { toast("Name and teacher required", "error"); return; }
    try {
      const created = await api.groups.create({ ...form, maxStudents: Number(form.maxStudents), status: "active" });
      const newG = deepClean(created);
      setData(d => ({ ...d, groups: [...d.groups, newG] }));
      toast("Group created");
      setShowAdd(false);
    } catch(e) { toast(e.message || "Failed to create group", "error"); }
  };

  const saveGroup = async () => {
    if (!editGroupForm.name || !editGroupForm.teacherId) { toast("Name and teacher required", "error"); return; }
    try {
      const updated = await api.groups.update(viewG.id, { ...editGroupForm, maxStudents: Number(editGroupForm.maxStudents) });
      const clean = deepClean(updated);
      setData(d => ({ ...d, groups: d.groups.map(g => g.id === viewG.id ? { ...g, ...clean } : g) }));
      toast("✅ Group updated");
      setEditGroupForm(null);
    } catch(e) { toast(e.message || "Failed to update group", "error"); }
  };

  return (
    <div>
      <div className="ph">
        <div><div className="ph-title">Groups</div><div className="ph-sub">{filteredGroups.length} of {allGroups.length} shown</div></div>
        <button className="btn btn-pr" onClick={() => setShowAdd(true)}>+ Create Group</button>
      </div>

      {/* Filter bar */}
      <div className="card mb12" style={{ padding: "12px 14px" }}>
        <div className="flex ac gap8" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160, position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", fontSize: 14 }}>🔍</span>
            <input style={{ paddingLeft: 32 }} placeholder="Search groups…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select style={{ width: 160 }} value={teacherFilter} onChange={e => setTeacherFilter(e.target.value)}>
            <option value="all">All Teachers</option>
            {data.users.filter(u => u.role === "teacher").map(t => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
          </select>
          <select style={{ width: 120 }} value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
            <option value="all">All Levels</option>
            {["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          {(search || teacherFilter !== "all" || levelFilter !== "all") && (
            <button className="btn btn-se btn-sm" onClick={() => { setSearch(""); setTeacherFilter("all"); setLevelFilter("all"); }}>✕ Clear</button>
          )}
        </div>
      </div>

      {filteredGroups.length === 0 && (
        <div className="empty" style={{ marginTop: 32 }}>
          <div className="empty-icon">👥</div>
          <div className="empty-title">No groups match your filters</div>
        </div>
      )}

      <div className="g3">
        {filteredGroups.map(g => {
          const teacher = data.users.find(u => u.id === g.teacherId);
          const students = data.users.filter(u => u.role === "student" && u.groupId === g.id);
          const series = data.series.filter(s => s.groupId === g.id);
          const fill = (students.length / g.maxStudents) * 100;
          return (
            <div key={g.id} className="card" style={{ cursor: "pointer" }} onClick={() => setViewG({ ...g, teacher, students, series })}>
              <div className="flex ac jb mb10">
                <div><div className="fw7" style={{ fontSize: 14 }}>{g.name}</div><div className="text-xs muted mt4">{g.schedule}</div></div>
                <span className="mono fw7" style={{ fontSize: 13, color: "var(--accent2)", background: "var(--glow)", padding: "4px 10px", borderRadius: 99 }}>{g.level}</span>
              </div>
              {teacher && <div className="flex ac gap8 mb10"><Av name={teacher.name} sz="av-sm" /><div className="text-sm">{teacher.name}</div></div>}
              <div className="flex ac jb text-xs muted mb6"><span>Capacity</span><span>{students.length}/{g.maxStudents}</span></div>
              <div className="prog"><div className="prog-fill" style={{ width: `${fill}%`, background: fill > 80 ? "var(--amber)" : "var(--accent)" }} /></div>
              <div className="flex ac gap6 mt10">
                {series.length > 0 && <span style={{ fontSize: 11, color: "var(--accent2)", background: "var(--glow)", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>🔁 {series.length} series</span>}
                <Badge status={g.status} />
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Create Group">
        <div className="input-row">
          <div className="fg"><label>Group Name *</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="B2 Morning" /></div>
          <div className="fg"><label>Level</label><select value={form.level} onChange={e => setForm(p => ({ ...p, level: e.target.value }))}>{["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}</select></div>
          <div className="fg"><label>Teacher *</label><select value={form.teacherId} onChange={e => setForm(p => ({ ...p, teacherId: e.target.value }))}><option value="">Select…</option>{data.users.filter(u => u.role === "teacher").map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="fg"><label>Max Students</label><input type="number" value={form.maxStudents} onChange={e => setForm(p => ({ ...p, maxStudents: e.target.value }))} /></div>
          <div className="fg" style={{ gridColumn: "1/-1" }}><label>Schedule</label><input value={form.schedule} onChange={e => setForm(p => ({ ...p, schedule: e.target.value }))} placeholder="Mon/Wed/Fri 9:00–10:30" /></div>
        </div>
        <div className="flex gap8 mt12">
          <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setShowAdd(false)}>Cancel</button>
          <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={addGroup}>Create Group</button>
        </div>
      </Modal>

      {viewG && (
        <Modal open={!!viewG} onClose={() => { setViewG(null); setEditGroupForm(null); }} title={viewG.name} lg>
          <div className="flex ac jb mb16">
            <div className="text-sm muted">Group Details</div>
            <button className="btn btn-pr btn-sm" onClick={() => editGroupForm ? setEditGroupForm(null) : setEditGroupForm({
              name: viewG.name, level: viewG.level, teacherId: String(viewG.teacherId || ""), maxStudents: viewG.maxStudents, schedule: viewG.schedule || "", status: viewG.status || "active"
            })}>✏️ {editGroupForm ? "Cancel" : "Edit Group"}</button>
          </div>

          {editGroupForm ? (
            <div className="card mb16" style={{ padding: 16 }}>
              <div className="sh-title mb12">✏️ Edit Group</div>
              <div className="input-row">
                <div className="fg"><label>Group Name *</label><input value={editGroupForm.name} onChange={e => setEditGroupForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div className="fg"><label>Level</label>
                  <select value={editGroupForm.level} onChange={e => setEditGroupForm(p => ({ ...p, level: e.target.value }))}>
                    {["A1","A2","B1","B2","C1","C2"].map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Teacher *</label>
                  <select value={editGroupForm.teacherId} onChange={e => setEditGroupForm(p => ({ ...p, teacherId: e.target.value }))}>
                    <option value="">Select…</option>
                    {data.users.filter(u => u.role === "teacher").map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Max Students</label><input type="number" value={editGroupForm.maxStudents} onChange={e => setEditGroupForm(p => ({ ...p, maxStudents: e.target.value }))} /></div>
                <div className="fg" style={{ gridColumn: "1/-1" }}><label>Schedule</label><input value={editGroupForm.schedule} onChange={e => setEditGroupForm(p => ({ ...p, schedule: e.target.value }))} placeholder="Mon/Wed/Fri 9:00–10:30" /></div>
                <div className="fg"><label>Status</label>
                  <select value={editGroupForm.status} onChange={e => setEditGroupForm(p => ({ ...p, status: e.target.value }))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex gap8 mt12">
                <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setEditGroupForm(null)}>Cancel</button>
                <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={saveGroup}>💾 Save Changes</button>
              </div>
            </div>
          ) : (
            <>
              <div className="g3 mb16">
                <div className="card card-sm tac"><div className="fw8 mono" style={{ fontSize: 22, color: "var(--accent2)" }}>{viewG.level}</div><div className="text-xs muted">Level</div></div>
                <div className="card card-sm tac"><div className="fw8" style={{ fontSize: 22 }}>{viewG.students.length}</div><div className="text-xs muted">Students</div></div>
                <div className="card card-sm tac"><div className="fw8" style={{ fontSize: 22 }}>{viewG.series.length}</div><div className="text-xs muted">Series</div></div>
              </div>
              {viewG.teacher && <div className="flex ac gap8 mb12"><Av name={viewG.teacher.name} sz="av-md" /><div className="fw7">{viewG.teacher.name}</div></div>}
              <div className="text-sm muted mb4">Schedule: <strong style={{ color: "var(--text)" }}>{viewG.schedule}</strong></div>
            </>
          )}

          <div className="divider" />
          <div className="sh-title mb10">Students ({viewG.students.length})</div>
          {viewG.students.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}><div className="empty-icon" style={{ fontSize: 26 }}>👥</div><div className="empty-title">No students enrolled</div></div>
            : viewG.students.map(s => <div key={s.id} className="li"><Av name={s.name} /><div style={{ flex: 1 }}><div className="fw7 text-sm">{s.name}</div><div className="text-xs muted">{s.email}</div></div><Badge status={s.paymentStatus} /></div>)}
          {viewG.series.length > 0 && <>
            <div className="divider" />
            <div className="sh-title mb10">Recurring Series</div>
            {viewG.series.map(s => <div key={s.id} className="li">
              <span style={{ fontSize: 16 }}>🔁</span>
              <div style={{ flex: 1 }}><div className="fw7 text-sm">{s.title}</div><div className="text-xs muted">{s.recurringDays?.map(d => DAY_SHORT[d]).join("/")} · {s.startTime}–{s.endTime}</div></div>
              <Badge status={s.paused ? "paused" : "active"} />
            </div>)}
          </>}
        </Modal>
      )}
    </div>
  );
}

// ─── PAYMENTS PAGE ────────────────────────────────────────────────────────────
function PaymentsPage({ data, setData, userRole, userId }) {
  // Safety: ensure all arrays exist
  data = {
    users: [],
    payments: [],
    groups: [],
    sessions: [],
    teacherPayments: [],
    books: [],
    lessons: [],
    ...data,
  };
  // ── tabs ─────────────────────────────────────────────────────────────────────
  const [tab,       setTab]       = useState("students");   // students | teachers | overview
  const [showAdd,   setShowAdd]   = useState(false);
  const [showPayT,  setShowPayT]  = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMonth,  setPayMonth]  = useState(() => {
    const d = new Date();
    return d.toLocaleString("default",{month:"long"})+" "+d.getFullYear();
  });
  const [form, setForm] = useState({ studentId:"", amount:"", month:new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"}), status:"pending", dueDate:"" });

  // ── period filter ─────────────────────────────────────────────────────────────
  const [period,    setPeriod]    = useState("monthly");    // daily|weekly|monthly|yearly|custom
  const [customFrom,setCustomFrom]= useState("");
  const [customTo,  setCustomTo]  = useState("");
  const [selMonth,  setSelMonth]  = useState("2026-03");    // for monthly picker
  const [selYear,   setSelYear]   = useState("2026");       // for yearly picker
  const [selWeek,   setSelWeek]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate()-d.getDay());
    return d.toISOString().split("T")[0];
  });
  const [selDay,    setSelDay]    = useState("2025-02-26");

  // ── search & status filter ────────────────────────────────────────────────────
  const [search,    setSearch]    = useState("");
  const [statusF,   setStatusF]   = useState("all");

  // ── helpers ───────────────────────────────────────────────────────────────────
  const parseDate = s => s ? new Date(s) : null;

  // Returns [from, to] Date range for current period filter
  const periodRange = () => {
    if (period === "daily") {
      const d = parseDate(selDay) || new Date();
      const from = new Date(d); from.setHours(0,0,0,0);
      const to   = new Date(d); to.setHours(23,59,59,999);
      return [from, to];
    }
    if (period === "weekly") {
      const start = parseDate(selWeek) || new Date();
      start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
      return [start, end];
    }
    if (period === "monthly") {
      const [yr,mo] = selMonth.split("-").map(Number);
      return [new Date(yr, mo-1, 1), new Date(yr, mo, 0, 23, 59, 59)];
    }
    if (period === "yearly") {
      const yr = Number(selYear);
      return [new Date(yr, 0, 1), new Date(yr, 11, 31, 23, 59, 59)];
    }
    if (period === "custom" && customFrom && customTo) {
      return [new Date(customFrom), new Date(customTo+"T23:59:59")];
    }
    return [null, null];
  };

  // Filter a payment (student) by period using p.date (paid date) OR p.dueDate
  const inPeriod = (dateStr) => {
    const [from, to] = periodRange();
    if (!from || !to) return true;
    const d = parseDate(dateStr);
    if (!d) return false;
    return d >= from && d <= to;
  };

  // period label for UI
  const periodLabel = () => {
    if (period === "daily")   return selDay;
    if (period === "weekly")  { const s=parseDate(selWeek)||new Date(); const e=new Date(s); e.setDate(s.getDate()+6); return s.toLocaleDateString("en",{month:"short",day:"numeric"})+" – "+e.toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"}); }
    if (period === "monthly") { const [yr,mo]=selMonth.split("-"); return new Date(yr,mo-1,1).toLocaleString("default",{month:"long",year:"numeric"}); }
    if (period === "yearly")  return selYear;
    if (period === "custom" && customFrom && customTo) return customFrom+" → "+customTo;
    return "All time";
  };

  // shift period forward/back
  const shiftPeriod = (dir) => {
    if (period==="daily")  { const d=new Date(selDay); d.setDate(d.getDate()+dir); setSelDay(d.toISOString().split("T")[0]); }
    if (period==="weekly") { const d=new Date(selWeek); d.setDate(d.getDate()+dir*7); setSelWeek(d.toISOString().split("T")[0]); }
    if (period==="monthly"){ const [yr,mo]=selMonth.split("-").map(Number); const nd=new Date(yr,mo-1+dir,1); setSelMonth(nd.getFullYear()+"-"+String(nd.getMonth()+1).padStart(2,"0")); }
    if (period==="yearly") { setSelYear(s=>String(Number(s)+dir)); }
  };

  // ── student payments ─────────────────────────────────────────────────────────
  const allStudentPay = userRole==="student" ? data.payments.filter(p=>p.studentId===userId) : data.payments;

  const filteredStudentPay = allStudentPay.filter(p => {
    // period: use paid date if paid, else dueDate
    const dateToCheck = p.date || p.dueDate;
    if (!inPeriod(dateToCheck)) return false;
    if (statusF!=="all" && p.status!==statusF) return false;
    if (search) {
      const st = data.users.find(u=>u.id===p.studentId);
      if (!st?.name.toLowerCase().includes(search.toLowerCase()) &&
          !p.month.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const sPaid    = filteredStudentPay.filter(p=>p.status==="paid").reduce((s,p)=>s+p.amount,0);
  const sPending = filteredStudentPay.filter(p=>p.status==="pending").reduce((s,p)=>s+p.amount,0);
  const sOverdue = filteredStudentPay.filter(p=>p.status==="overdue").reduce((s,p)=>s+p.amount,0);
  const sTotal   = sPaid + sPending + sOverdue;

  // ── teacher payroll ───────────────────────────────────────────────────────────
  const teacherPayrollData = data.users.filter(u=>u.role==="teacher").map(teacher => {
    const myGroups   = data.groups.filter(g=>g.teacherId===teacher.id);
    const myStudents = data.users.filter(u=>u.role==="student" && myGroups.some(g=>g.id===u.groupId));
    const totalRevenue = myStudents.reduce((sum,st)=>
      sum+data.payments.filter(p=>p.studentId===st.id&&p.status==="paid").reduce((a,p)=>a+p.amount,0),0);
    const earned      = Math.round(((teacher.commission??35)/100)*totalRevenue);
    const alreadyPaid = data.teacherPayments.filter(tp=>tp.teacherId===teacher.id&&tp.status==="paid").reduce((s,p)=>s+p.amount,0);
    const balance     = earned - alreadyPaid;
    const paymentHistory = data.teacherPayments.filter(tp=>tp.teacherId===teacher.id);
    const completedSessions = data.sessions.filter(s=>s.teacherId===teacher.id&&s.status==="completed").length;
    // period-filtered payouts
    const periodPaid  = data.teacherPayments.filter(tp=>tp.teacherId===teacher.id&&tp.status==="paid"&&inPeriod(tp.date)).reduce((s,p)=>s+p.amount,0);
    return { teacher, myStudents, totalRevenue, earned, alreadyPaid, balance, paymentHistory, completedSessions, periodPaid };
  });

  const tTotalEarned  = teacherPayrollData.reduce((s,t)=>s+t.earned,0);
  const tTotalPaid    = teacherPayrollData.reduce((s,t)=>s+t.alreadyPaid,0);
  const tPeriodPaid   = teacherPayrollData.reduce((s,t)=>s+t.periodPaid,0);
  const tOutstanding  = teacherPayrollData.reduce((s,t)=>s+Math.max(0,t.balance),0);

  // ── overview revenue chart data (monthly last 6) ──────────────────────────────
  const last6 = Array.from({length:6},(_,i)=>{
    const d=new Date(2025,1-i,1);
    const label=d.toLocaleString("default",{month:"short"});
    const yr=d.getFullYear(), mo=d.getMonth();
    const collected = data.payments.filter(p=>{
      if(p.status!=="paid"||!p.date) return false;
      const pd=new Date(p.date);
      return pd.getFullYear()===yr&&pd.getMonth()===mo;
    }).reduce((s,p)=>s+p.amount,0);
    const payroll = data.teacherPayments.filter(tp=>{
      if(tp.status!=="paid"||!tp.date) return false;
      const td=new Date(tp.date);
      return td.getFullYear()===yr&&td.getMonth()===mo;
    }).reduce((s,p)=>s+p.amount,0);
    return {label,collected,payroll,profit:collected-payroll};
  }).reverse();

  const chartMax = Math.max(...last6.map(x=>x.collected),1);

  // ── mutations ─────────────────────────────────────────────────────────────────
  const addPayment = async () => {
    if(!form.studentId||!form.amount){toast("Student and amount required","error");return;}
    try {
      const newP = await api.payments.create({
        ...form,
        amount: Number(form.amount),
        date: form.status==="paid" ? new Date().toISOString().split("T")[0] : null,
        dueDate: form.dueDate || new Date(Date.now()+7*86400000).toISOString().split("T")[0],
      });
      const flat = { ...newP, id: newP._id?.toString() || newP.id };
      setData(d=>({...d, payments:[...d.payments, flat]}));
      toast("Payment recorded ✅");
      setShowAdd(false);
      setForm({studentId:"",amount:"",month:new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"}),status:"pending",dueDate:""});
    } catch(e) { toast(e.message || "Failed to add payment", "error"); }
  };

  const markPaid = async id => {
    try {
      await api.payments.update(id, { status:"paid", date:new Date().toISOString().split("T")[0] });
      setData(d=>({...d,payments:d.payments.map(p=>p.id===id?{...p,status:"paid",date:new Date().toISOString().split("T")[0]}:p)}));
      toast("Marked as paid ✅");
    } catch(e) { toast(e.message||"Failed","error"); }
  };

  const deletePayment = async id => {
    try {
      await api.payments.delete(id);
      setData(d=>({...d,payments:d.payments.filter(p=>p.id!==id)}));
      toast("Payment deleted","warn");
    } catch(e) { toast(e.message||"Failed","error"); }
  };

  const payTeacher = () => {
    if(!payAmount||Number(payAmount)<=0){toast("Enter a valid amount","error");return;}
    const rec = { id:Date.now(), teacherId:showPayT.id, amount:Number(payAmount), month:payMonth,
      status:"paid", date:new Date().toISOString().split("T")[0] };
    setData(d=>({...d,teacherPayments:[...d.teacherPayments,rec]}));
    toast(`💰 $${payAmount} paid to ${showPayT.name}`);
    setShowPayT(null); setPayAmount("");
  };

  // ── period nav bar ────────────────────────────────────────────────────────────
  const PeriodBar = () => (
    <div className="card mb16" style={{ padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        {/* period type pills */}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {[["daily","Day"],["weekly","Week"],["monthly","Month"],["yearly","Year"],["custom","Custom"]].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriod(v)}
              className={"btn btn-xs "+(period===v?"btn-pr":"btn-se")}>{l}</button>
          ))}
        </div>

        {/* period picker */}
        {period==="daily"   && <input type="date" style={{minWidth:140}} value={selDay} onChange={e=>setSelDay(e.target.value)} />}
        {period==="weekly"  && <input type="date" style={{minWidth:140}} value={selWeek} onChange={e=>setSelWeek(e.target.value)} title="Pick any day in the week"/>}
        {period==="monthly" && <input type="month" style={{minWidth:140}} value={selMonth} onChange={e=>setSelMonth(e.target.value)} />}
        {period==="yearly"  && (
          <select style={{minWidth:100}} value={selYear} onChange={e=>setSelYear(e.target.value)}>
            {[String(new Date().getFullYear()-2), String(new Date().getFullYear()-1), String(new Date().getFullYear()), String(new Date().getFullYear()+1)].map(y=><option key={y}>{y}</option>)}
          </select>
        )}
        {period==="custom" && (
          <>
            <input type="date" style={{minWidth:130}} value={customFrom} onChange={e=>setCustomFrom(e.target.value)} placeholder="From"/>
            <span style={{color:"var(--text3)",fontSize:12}}>→</span>
            <input type="date" style={{minWidth:130}} value={customTo} onChange={e=>setCustomTo(e.target.value)} placeholder="To"/>
          </>
        )}

        {/* prev / next arrows */}
        {period!=="custom" && (
          <div style={{ display:"flex", gap:4, marginLeft:4 }}>
            <button className="btn btn-se btn-xs" onClick={()=>shiftPeriod(-1)}>‹</button>
            <button className="btn btn-se btn-xs" onClick={()=>shiftPeriod(+1)}>›</button>
          </div>
        )}

        {/* active label */}
        <div style={{ marginLeft:"auto", fontSize:12, fontWeight:700, color:"var(--accent2)",
          padding:"4px 12px", borderRadius:8, background:"var(--glow)", border:"1px solid rgba(249,115,22,.2)" }}>
          📅 {periodLabel()}
        </div>
      </div>
    </div>
  );

  // ── STUDENT VIEW (non-admin) ──────────────────────────────────────────────────
  if (userRole !== "admin") {
    return (
      <div>
        <div className="ph"><div><div className="ph-title">💳 My Payments</div><div className="ph-sub">Your payment history</div></div></div>
        <PeriodBar />
        <div className="g3 mb16">
          {[
            { l:"Paid",    v:fmt$(sPaid),    c:"var(--green)" },
            { l:"Pending", v:fmt$(sPending), c:"var(--amber)" },
            { l:"Overdue", v:fmt$(sOverdue), c:"var(--red)"   },
          ].map((x,i)=><div key={i} className="card tac"><div className="fw8" style={{fontSize:22,color:x.c}}>{x.v}</div><div className="text-sm muted">{x.l}</div></div>)}
        </div>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Month</th><th>Amount</th><th>Due</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>
                {filteredStudentPay.length===0 && <tr><td colSpan={5} style={{textAlign:"center",color:"var(--text3)",padding:24}}>No payments in this period</td></tr>}
                {filteredStudentPay.map(p=>(
                  <tr key={p.id}>
                    <td>{p.month}</td>
                    <td className="fw7 mono">{fmt$(p.amount)}</td>
                    <td className="mono text-xs hide-mobile">{p.dueDate||"—"}</td>
                    <td className="mono text-xs hide-mobile">{p.date||"—"}</td>
                    <td><Badge status={p.status}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ADMIN VIEW
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div>
      <div className="ph">
        <div><div className="ph-title">💳 Payments</div><div className="ph-sub">Financial tracking, payroll & revenue analytics</div></div>
        <button className="btn btn-pr" onClick={()=>setShowAdd(true)}>+ Record Payment</button>
      </div>

      {/* ── Main tabs ── */}
      <div className="tabs mb16" style={{maxWidth:400}}>
        {[["overview","📊 Overview"],["students","👨‍🎓 Students"],["teachers","👨‍🏫 Teachers"]].map(([v,l])=>(
          <div key={v} className={`tab ${tab===v?"active":""}`} onClick={()=>setTab(v)}>{l}</div>
        ))}
      </div>

      {/* ── Period bar (all tabs) ── */}
      <PeriodBar />

      {/* ════════════════════════════════
          TAB: OVERVIEW
      ════════════════════════════════ */}
      {tab==="overview" && (
        <div>
          {/* KPI row */}
          <div className="g4 mb16">
            {[
              { icon:"💵", label:"Student Revenue",    val:fmt$(sPaid),        c:"#22c55e", sub:"collected this period" },
              { icon:"💸", label:"Teacher Payroll",    val:fmt$(tPeriodPaid),  c:"#f97316", sub:"paid out this period"  },
              { icon:"📈", label:"Net Profit",         val:fmt$(sPaid-tPeriodPaid), c: sPaid-tPeriodPaid>=0?"#22c55e":"#ef4444", sub:"revenue minus payroll" },
              { icon:"⚠️", label:"Unpaid / Overdue",   val:fmt$(sPending+sOverdue), c:"#f59e0b", sub:`${filteredStudentPay.filter(p=>p.status!=="paid").length} payments` },
            ].map((k,i)=>(
              <div key={i} className="card stat" style={{borderColor:k.c+"33"}}>
                <div className="stat-glow" style={{background:k.c}}/>
                <div className="stat-icon">{k.icon}</div>
                <div className="stat-label">{k.label}</div>
                <div className="stat-val" style={{color:k.c}}>{k.val}</div>
                <div className="stat-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Revenue vs Payroll bar chart */}
          <div className="g2 mb16">
            <div className="card">
              <div className="sh mb12"><div className="sh-title">📊 Monthly Revenue vs Payroll</div></div>
              <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120,padding:"0 4px"}}>
                {last6.map((m,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",flex:1}}>
                      <div title={"Revenue: "+fmt$(m.collected)} style={{flex:1,background:"#22c55e",borderRadius:"3px 3px 0 0",
                        height:Math.max(3,(m.collected/chartMax)*100)+"%",transition:"height .5s"}}/>
                      <div title={"Payroll: "+fmt$(m.payroll)} style={{flex:1,background:"#f97316",borderRadius:"3px 3px 0 0",
                        height:Math.max(3,(m.payroll/Math.max(chartMax,1))*100)+"%",transition:"height .5s"}}/>
                    </div>
                    <div style={{fontSize:9,color:"var(--text3)",fontWeight:600}}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:16,marginTop:8,justifyContent:"center"}}>
                {[["#22c55e","Revenue"],["#f97316","Payroll"]].map(([c,l])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)"}}>
                    <div style={{width:10,height:10,borderRadius:3,background:c}}/>
                    {l}
                  </div>
                ))}
              </div>
            </div>

            {/* Profit breakdown */}
            <div className="card">
              <div className="sh mb12"><div className="sh-title">💹 Profit Breakdown ({periodLabel()})</div></div>
              {[
                { label:"Student Revenue",  val:sPaid,              c:"#22c55e", icon:"💵" },
                { label:"Pending",          val:sPending,           c:"#f59e0b", icon:"⏳" },
                { label:"Overdue",          val:sOverdue,           c:"#ef4444", icon:"🔴" },
                { label:"Teacher Payroll",  val:-tPeriodPaid,       c:"#f97316", icon:"💸" },
                { label:"Net Profit",       val:sPaid-tPeriodPaid,  c: sPaid-tPeriodPaid>=0?"#22c55e":"#ef4444", icon:"📈", bold:true },
              ].map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"8px 0", borderBottom:i<4?"1px solid var(--border)":"",
                  fontWeight:r.bold?800:500}}>
                  <span style={{fontSize:13,color:r.bold?"var(--text)":"var(--text2)"}}>{r.icon} {r.label}</span>
                  <span style={{fontSize:13,fontWeight:700,fontFamily:"var(--mono)",color:r.c}}>
                    {r.val>=0?"":"-"}{fmt$(Math.abs(r.val))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-student quick status */}
          <div className="card">
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)"}}>
              <div className="sh-title">👨‍🎓 Student Payment Status</div>
            </div>
            {data.users.filter(u=>u.role==="student").map(st=>{
              const myPay = filteredStudentPay.filter(p=>p.studentId===st.id);
              const paid  = myPay.filter(p=>p.status==="paid").reduce((s,p)=>s+p.amount,0);
              const owed  = myPay.filter(p=>p.status!=="paid").reduce((s,p)=>s+p.amount,0);
              const hasOverdue = myPay.some(p=>p.status==="overdue");
              return (
                <div key={st.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:"1px solid var(--border)"}}>
                  <Av name={st.name} sz="av-sm"/>
                  <div style={{flex:1}}>
                    <div className="fw7" style={{fontSize:13}}>{st.name}</div>
                    <div style={{fontSize:11,color:"var(--text3)"}}>
                      {data.groups.find(g=>g.id===st.groupId)?.name||"No group"} · {myPay.length} record(s) this period
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#22c55e"}}>{fmt$(paid)}</div>
                    {owed>0&&<div style={{fontSize:11,color:hasOverdue?"#ef4444":"#f59e0b"}}>
                      {hasOverdue?"⚠ Overdue: ":"Pending: "}{fmt$(owed)}
                    </div>}
                  </div>
                  <Badge status={st.paymentStatus}/>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: STUDENTS
      ════════════════════════════════ */}
      {tab==="students" && (
        <div>
          {/* KPIs */}
          <div className="g4 mb16">
            {[
              { icon:"✅", label:"Collected",  val:fmt$(sPaid),    c:"#22c55e" },
              { icon:"⏳", label:"Pending",    val:fmt$(sPending), c:"#f59e0b" },
              { icon:"🔴", label:"Overdue",    val:fmt$(sOverdue), c:"#ef4444" },
              { icon:"💰", label:"Total",      val:fmt$(sTotal),   c:"var(--accent2)" },
            ].map((k,i)=>(
              <div key={i} className="card stat" style={{borderColor:k.c+"33"}}>
                <div className="stat-glow" style={{background:k.c}}/>
                <div className="stat-icon">{k.icon}</div>
                <div className="stat-label">{k.label}</div>
                <div className="stat-val" style={{color:k.c}}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Search + status filter */}
          <div className="card mb12" style={{padding:"12px 14px"}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <input style={{flex:1,minWidth:160}} placeholder="🔍 Search student or month…"
                value={search} onChange={e=>setSearch(e.target.value)}/>
              <select style={{minWidth:140}} value={statusF} onChange={e=>setStatusF(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{padding:0}}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Month</th>
                    <th>Amount</th>
                    <th className="hide-mobile">Due Date</th>
                    <th className="hide-mobile">Paid Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudentPay.length===0 &&
                    <tr><td colSpan={7} style={{textAlign:"center",color:"var(--text3)",padding:28}}>No payments in this period</td></tr>}
                  {filteredStudentPay.map(p=>{
                    const st=data.users.find(u=>u.id===p.studentId);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <Av name={st?.name??"?"} sz="av-sm"/>
                            <div>
                              <div className="fw7" style={{fontSize:13}}>{st?.name??"Unknown"}</div>
                              <div style={{fontSize:11,color:"var(--text3)"}}>{st?.level} · {data.groups.find(g=>g.id===st?.groupId)?.name||"—"}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{fontSize:13}}>{p.month}</td>
                        <td className="fw7 mono">{fmt$(p.amount)}</td>
                        <td className="mono text-xs hide-mobile">{p.dueDate||"—"}</td>
                        <td className="mono text-xs hide-mobile">{p.date||"—"}</td>
                        <td><Badge status={p.status}/></td>
                        <td>
                          <div style={{display:"flex",gap:5}}>
                            {p.status!=="paid" &&
                              <button className="btn btn-se btn-xs" onClick={()=>markPaid(p.id)}>✅ Paid</button>}
                            <button className="btn btn-da btn-xs" onClick={()=>deletePayment(p.id)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-student summary cards */}
          <div style={{marginTop:20}}>
            <div className="sh mb12"><div className="sh-title">📋 Per-Student Summary ({periodLabel()})</div></div>
            <div className="g2" style={{gap:10}}>
              {data.users.filter(u=>u.role==="student").map(st=>{
                const myPay=filteredStudentPay.filter(p=>p.studentId===st.id);
                const paid=myPay.filter(p=>p.status==="paid").reduce((s,p)=>s+p.amount,0);
                const owed=myPay.filter(p=>p.status!=="paid").reduce((s,p)=>s+p.amount,0);
                const rate=paid+owed>0?Math.round(paid/(paid+owed)*100):null;
                return (
                  <div key={st.id} className="card card-sm">
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <Av name={st.name} sz="av-md"/>
                      <div style={{flex:1}}>
                        <div className="fw7" style={{fontSize:13}}>{st.name}</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>{myPay.length} payment(s) this period</div>
                      </div>
                      <Badge status={st.paymentStatus}/>
                    </div>
                    <div style={{display:"flex",gap:8,marginBottom:8}}>
                      {[{l:"Paid",v:fmt$(paid),c:"#22c55e"},{l:"Owed",v:fmt$(owed),c:owed>0?"#ef4444":"var(--text3)"}].map((x,i)=>(
                        <div key={i} style={{flex:1,textAlign:"center",background:"var(--bg3)",borderRadius:8,padding:"7px 4px"}}>
                          <div style={{fontSize:14,fontWeight:800,color:x.c}}>{x.v}</div>
                          <div style={{fontSize:10,color:"var(--text3)"}}>{x.l}</div>
                        </div>
                      ))}
                    </div>
                    {rate!==null&&(
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginBottom:4}}>
                          <span>Payment rate</span><span style={{fontWeight:700,color:rate>=80?"#22c55e":rate>=50?"#f59e0b":"#ef4444"}}>{rate}%</span>
                        </div>
                        <div style={{height:4,background:"var(--bg4)",borderRadius:99,overflow:"hidden"}}>
                          <div style={{height:"100%",width:rate+"%",background:rate>=80?"#22c55e":rate>=50?"#f59e0b":"#ef4444",borderRadius:99}}/>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: TEACHERS
      ════════════════════════════════ */}
      {tab==="teachers" && (
        <div>
          {/* KPIs */}
          <div className="g3 mb16">
            {[
              { icon:"💰", label:"Total Earned",        val:fmt$(tTotalEarned),  c:"var(--accent2)" },
              { icon:"✅", label:"Total Paid Out",       val:fmt$(tTotalPaid),   c:"#22c55e"        },
              { icon:"⚠️", label:"Outstanding Balance",  val:fmt$(tOutstanding), c:"#ef4444"        },
            ].map((k,i)=>(
              <div key={i} className="card stat" style={{borderColor:k.c+"33"}}>
                <div className="stat-glow" style={{background:k.c}}/>
                <div className="stat-icon">{k.icon}</div>
                <div className="stat-label">{k.label}</div>
                <div className="stat-val" style={{color:k.c}}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Per-teacher cards */}
          {teacherPayrollData.map(({teacher,myStudents,totalRevenue,earned,alreadyPaid,balance,paymentHistory,completedSessions,periodPaid})=>(
            <div key={teacher.id} className="card mb12">
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
                <Av name={teacher.name} sz="av-lg"/>
                <div style={{flex:1}}>
                  <div className="fw7" style={{fontSize:15}}>{teacher.name}</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{teacher.email} · {teacher.commission}% commission</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {balance>0
                    ? <button className="btn btn-pr btn-sm" onClick={()=>{setShowPayT(teacher);setPayAmount(String(balance));}}>💰 Pay {fmt$(balance)}</button>
                    : <Badge status="paid" label="✓ Settled"/>}
                </div>
              </div>

              {/* Stats row */}
              <div className="g4 mb12" style={{gap:8}}>
                {[
                  {l:"Students",      v:myStudents.length},
                  {l:"Sessions Done", v:completedSessions},
                  {l:"Revenue Gen.",  v:fmt$(totalRevenue)},
                  {l:"Commission",    v:fmt$(earned), c:"var(--accent2)"},
                ].map((x,i)=>(
                  <div key={i} style={{background:"var(--bg3)",borderRadius:9,padding:"10px 12px",textAlign:"center"}}>
                    <div className="fw7" style={{fontSize:15,color:x.c||"var(--text)"}}>{x.v}</div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>{x.l}</div>
                  </div>
                ))}
              </div>

              {/* Period paid info */}
              {periodPaid>0&&(
                <div style={{fontSize:12,color:"var(--accent2)",fontWeight:600,marginBottom:8,
                  padding:"6px 10px",background:"var(--glow)",borderRadius:7,display:"inline-block"}}>
                  📅 {fmt$(periodPaid)} paid in {periodLabel()}
                </div>
              )}

              {/* Balance progress bar */}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginBottom:5}}>
                <span>Paid out</span>
                <span className="fw7" style={{color:balance>0?"#f59e0b":"#22c55e"}}>
                  {fmt$(alreadyPaid)} / {fmt$(earned)} · Balance: {fmt$(balance)}
                </span>
              </div>
              <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden",marginBottom:12}}>
                <div style={{height:"100%",borderRadius:99,transition:"width .5s",
                  width:`${earned>0?Math.min(100,(alreadyPaid/earned)*100):0}%`,
                  background:balance>0?"var(--amber)":"var(--green)"}}/>
              </div>

              {/* Payment history */}
              {paymentHistory.length>0&&(
                <div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>Payment History</div>
                  {paymentHistory.map(tp=>(
                    <div key={tp.id} className="li" style={{padding:"7px 0"}}>
                      <div style={{flex:1}}>
                        <div className="fw7 text-sm">{tp.month}</div>
                        <div style={{fontSize:10,color:"var(--text3)"}}>{tp.date||"Pending"}</div>
                      </div>
                      <div className="fw7 mono" style={{marginRight:10}}>{fmt$(tp.amount)}</div>
                      <Badge status={tp.status}/>
                    </div>
                  ))}
                </div>
              )}
              {paymentHistory.length===0&&(
                <div style={{textAlign:"center",fontSize:12,color:"var(--text3)",padding:"8px 0"}}>No payments made yet</div>
              )}
            </div>
          ))}

          {teacherPayrollData.length===0&&(
            <div className="empty" style={{marginTop:32}}>
              <div className="empty-icon">👨‍🏫</div>
              <div className="empty-title">No teachers on staff</div>
            </div>
          )}
        </div>
      )}

      {/* ── RECORD STUDENT PAYMENT MODAL ── */}
      <Modal open={showAdd} onClose={()=>setShowAdd(false)} title="Record Student Payment">
        <div className="fg"><label>Student *</label>
          <select value={form.studentId} onChange={e=>setForm(p=>({...p,studentId:e.target.value}))}>
            <option value="">Select student…</option>
            {data.users.filter(u=>u.role==="student").map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="input-row">
          <div className="fg"><label>Amount ($) *</label>
            <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="150"/>
          </div>
          <div className="fg"><label>Month / Period</label>
            <input value={form.month} onChange={e=>setForm(p=>({...p,month:e.target.value}))} placeholder={new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})}/>
          </div>
          <div className="fg"><label>Due Date</label>
            <input type="date" value={form.dueDate} onChange={e=>setForm(p=>({...p,dueDate:e.target.value}))}/>
          </div>
          <div className="fg"><label>Status</label>
            <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))}>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button className="btn btn-se w100" style={{justifyContent:"center"}} onClick={()=>setShowAdd(false)}>Cancel</button>
          <button className="btn btn-pr w100" style={{justifyContent:"center"}} onClick={addPayment}>Record</button>
        </div>
      </Modal>

      {/* ── PAY TEACHER MODAL ── */}
      <Modal open={!!showPayT} onClose={()=>{setShowPayT(null);setPayAmount("");}} title="Pay Teacher">
        {showPayT&&(
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <Av name={showPayT.name} sz="av-md"/>
              <div><div className="fw7">{showPayT.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{showPayT.commission}% commission</div></div>
            </div>
            {(()=>{
              const d=teacherPayrollData.find(t=>t.teacher.id===showPayT.id);
              return d?(
                <div className="g3 mb16" style={{gap:8}}>
                  {[{l:"Earned",v:fmt$(d.earned),c:"var(--accent2)"},{l:"Paid",v:fmt$(d.alreadyPaid),c:"#22c55e"},{l:"Balance",v:fmt$(d.balance),c:d.balance>0?"#ef4444":"#22c55e"}]
                    .map((x,i)=><div key={i} className="card card-sm tac"><div className="fw7" style={{color:x.c}}>{x.v}</div><div className="text-xs muted">{x.l}</div></div>)}
                </div>
              ):null;
            })()}
            <div className="input-row">
              <div className="fg"><label>Amount ($)</label>
                <input type="number" value={payAmount} onChange={e=>setPayAmount(e.target.value)} placeholder="0"/>
              </div>
              <div className="fg"><label>Month / Period</label>
                <input value={payMonth} onChange={e=>setPayMonth(e.target.value)}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button className="btn btn-se w100" style={{justifyContent:"center"}} onClick={()=>{setShowPayT(null);setPayAmount("");}}>Cancel</button>
              <button className="btn btn-pr w100" style={{justifyContent:"center"}} onClick={payTeacher}>💰 Confirm Payment</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ─── TEACHER DASHBOARD ────────────────────────────────────────────────────────
function TeacherDashboard({ user, data }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], attendance:[], teacherPayments:[], ...data };
  const myGroups = data.groups.filter(g => g.teacherId === user.id);
  const mySessions = data.sessions.filter(s => s.teacherId === user.id);
  const myStudents = data.users.filter(u => u.role === "student" && myGroups.some(g => g.id === u.groupId));
  const mySeries = data.series.filter(s => s.teacherId === user.id);
  const completedSessions = mySessions.filter(s => s.status === "completed").length;
  const revenue = myStudents.reduce((sum, s) => sum + data.payments.filter(p => p.studentId === s.id && p.status === "paid").reduce((a, p) => a + p.amount, 0), 0);
  const earned = (user.commission / 100) * revenue;
  const paid = data.teacherPayments.filter(tp => tp.teacherId === user.id && tp.status === "paid").reduce((s, p) => s + p.amount, 0);
  const upcomingToday = mySessions.filter(s => s.status === "upcoming").slice(0, 5);

  return (
    <div>
      <div className="ph"><div><div className="ph-title">Welcome, {user.name.split(" ")[0]} 👋</div><div className="ph-sub">Your teaching dashboard</div></div></div>
      <div className="g4 mb16">
        {[
          { icon: "👥", label: "My Groups", value: myGroups.length, color: "#f97316" },
          { icon: "👨‍🎓", label: "Students", value: myStudents.length, color: "#22c55e" },
          { icon: "🔁", label: "Active Series", value: mySeries.length, color: "#3b82f6" },
          { icon: "💰", label: "Balance Due", value: fmt$(earned - paid), color: earned - paid > 0 ? "#ef4444" : "#22c55e" },
        ].map((s, i) => (
          <div key={i} className="card stat" style={{ borderColor: `${s.color}20` }}>
            <div className="stat-glow" style={{ background: s.color }} />
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="g2">
        <div className="card">
          <div className="sh"><div className="sh-title">Earnings Overview</div></div>
          {[{ l: "Revenue generated", v: fmt$(revenue) }, { l: `Commission (${user.commission}%)`, v: fmt$(earned), c: "var(--green)" }, { l: "Paid out", v: fmt$(paid), c: "var(--blue)" }, { l: "Balance", v: fmt$(earned - paid), c: earned - paid > 0 ? "var(--red)" : "var(--green)" }].map((x, i) => (
            <div key={i} className="li"><span style={{ flex: 1, fontSize: 13, color: "var(--text2)" }}>{x.l}</span><span className="fw7 mono" style={{ color: x.c }}>{x.v}</span></div>
          ))}
        </div>
        <div className="card">
          <div className="sh"><div className="sh-title">Upcoming Sessions</div></div>
          {upcomingToday.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}><div className="empty-icon" style={{ fontSize: 26 }}>📅</div><div className="empty-title">No upcoming sessions</div></div>
            : upcomingToday.map(s => {
              const g = data.groups.find(x => x.id === s.groupId);
              const effectiveLink = getMeetingLink(s, data.series);
              return <div key={s.id} className="li">
                <div style={{ width: 36, height: 36, background: "var(--glow)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.sessionMode === "online" ? "💻" : "📝"}</div>
                <div style={{ flex: 1 }}><div className="fw7 text-sm">{s.title}</div><div className="text-xs muted">{g?.name}{s.sessionMode === "online" ? " · Online" : ""}</div></div>
                {s.sessionMode === "online" && effectiveLink
                  ? <button className="btn btn-sm" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", border: "none", fontSize: 11, flexShrink: 0 }} onClick={() => window.open(effectiveLink, "_blank")}>🎥 Join</button>
                  : <div className="tac" style={{ flexShrink: 0 }}><div className="sess-time">{s.date}</div><div className="sess-time">{s.time}</div></div>
                }
              </div>;
            })}
        </div>
      </div>
    </div>
  );
}

// ─── STUDENT DASHBOARD ────────────────────────────────────────────────────────
function StudentProfile({ user, setUser }) {
  const [form, setForm]   = useState({ currentPw: "", newPw: "", confirmPw: "" });
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState(null);

  const handleChange = async () => {
    if (!form.currentPw || !form.newPw || !form.confirmPw) { setMsg({ type:"error", text:"All fields required" }); return; }
    if (form.newPw.length < 6) { setMsg({ type:"error", text:"New password must be at least 6 characters" }); return; }
    if (form.newPw !== form.confirmPw) { setMsg({ type:"error", text:"New passwords don\'t match" }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.auth.changePassword({ currentPassword: form.currentPw, newPassword: form.newPw });
      setMsg({ type:"success", text:"✅ Password changed successfully! Google\'s warning should disappear on next login." });
      setForm({ currentPw: "", newPw: "", confirmPw: "" });
    } catch(e) {
      setMsg({ type:"error", text: e.message || "Failed to change password" });
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="ph">
        <div>
          <div className="ph-title">👤 My Profile</div>
          <div className="ph-sub">Manage your account and security settings</div>
        </div>
      </div>

      {/* Profile Card */}
      <div className="card mb16" style={{ display:"flex", alignItems:"center", gap:16, padding:"20px 24px" }}>
        <Av name={user.name} sz="av-xl" />
        <div>
          <div style={{ fontSize:20, fontWeight:900 }}>{user.name}</div>
          <div style={{ fontSize:13, color:"var(--text3)", marginTop:4 }}>{user.email}</div>
          <div style={{ marginTop:8, display:"flex", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:99, background:"var(--glow)", color:"var(--accent)" }}>
              {user.level || "Student"}
            </span>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="card">
        <div className="sh-title mb16">🔑 Change Password</div>
        <div style={{ background:"rgba(59,130,246,.08)", border:"1px solid rgba(59,130,246,.2)", borderRadius:10, padding:"12px 16px", marginBottom:16, fontSize:13, color:"var(--text2)" }}>
          💡 If you see a "Change your password" warning from your browser, simply set a new strong password here and the warning will go away after your next login.
        </div>
        {msg && (
          <div style={{ padding:"10px 14px", borderRadius:9, marginBottom:14, fontSize:13, fontWeight:600,
            background: msg.type==="success" ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.1)",
            color: msg.type==="success" ? "#16a34a" : "#dc2626",
            border: `1px solid ${msg.type==="success" ? "rgba(34,197,94,.3)" : "rgba(239,68,68,.25)"}` }}>
            {msg.text}
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:12, maxWidth:400 }}>
          <div className="fg">
            <label>Current Password</label>
            <input type="password" value={form.currentPw} onChange={e => setForm(p => ({...p, currentPw: e.target.value}))} placeholder="Enter current password" />
          </div>
          <div className="fg">
            <label>New Password</label>
            <input type="password" value={form.newPw} onChange={e => setForm(p => ({...p, newPw: e.target.value}))} placeholder="At least 6 characters" />
          </div>
          <div className="fg">
            <label>Confirm New Password</label>
            <input type="password" value={form.confirmPw} onChange={e => setForm(p => ({...p, confirmPw: e.target.value}))} placeholder="Repeat new password" />
          </div>
          <button className="btn btn-pr" style={{ alignSelf:"flex-start", minWidth:160 }}
            onClick={handleChange} disabled={saving}>
            {saving ? "Saving…" : "🔑 Update Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentDashboard({ user, data }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], attendance:[], teacherPayments:[], ...data };
  const myGroup = data.groups.find(g => g.id === user.groupId);
  const myTeacher = myGroup ? data.users.find(u => u.id === myGroup.teacherId) : null;
  const mySessions = data.sessions.filter(s => s.groupId === user.groupId && !s.isCancelled);
  const completed = mySessions.filter(s => s.status === "completed");
  const upcoming = mySessions.filter(s => s.status === "upcoming");
  const attended = completed.filter(s => s.attendance[user.id] === true).length;
  const attRate = completed.length > 0 ? Math.round((attended / completed.length) * 100) : 0;
  const myPayments = data.payments.filter(p => p.studentId === user.id);

  return (
    <div>
      <div className="ph"><div><div className="ph-title">Hello, {user.name.split(" ")[0]} 👋</div><div className="ph-sub">Your learning overview</div></div><Badge status={user.paymentStatus} /></div>
      <div className="g4 mb16">
        {[
          { icon: "📅", label: "Upcoming", value: upcoming.length, color: "#3b82f6" },
          { icon: "✅", label: "Completed", value: completed.length, color: "#22c55e" },
          { icon: "📊", label: "Attendance", value: `${attRate}%`, color: "#f59e0b" },
          { icon: "💳", label: "Status", value: user.paymentStatus, color: statusColor[user.paymentStatus] ?? "#f97316" },
        ].map((s, i) => (
          <div key={i} className="card stat" style={{ borderColor: `${s.color}20` }}>
            <div className="stat-glow" style={{ background: s.color }} />
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Next Lesson Preview */}
      <NextLessonCard data={data} user={user} onViewSession={null} />
      <div className="g2">
        {myGroup && <div className="card">
          <div className="sh-title mb12">My Class</div>
          <div className="flex gap12 mb12">
            <div style={{ background: "var(--glow)", borderRadius: 12, padding: "12px 16px", textAlign: "center", flexShrink: 0 }}><div className="fw8 mono" style={{ fontSize: 18, color: "var(--accent2)" }}>{myGroup.level}</div><div className="text-xs muted">Level</div></div>
            <div><div className="fw7" style={{ fontSize: 15 }}>{myGroup.name}</div><div className="text-xs muted mt4">{myGroup.schedule}</div>{myTeacher && <div className="flex ac gap8 mt8"><Av name={myTeacher.name} sz="av-sm" /><span style={{ fontSize: 13 }}>{myTeacher.name}</span></div>}</div>
          </div>
          <div className="prog"><div className="prog-fill" style={{ width: `${attRate}%`, background: "var(--accent)" }} /></div>
          <div className="flex jb text-xs muted mt4"><span>Attendance</span><span className="fw7" style={{ color: "var(--accent2)" }}>{attRate}%</span></div>
        </div>}
        <div className="card">
          <div className="sh-title mb12">Upcoming Sessions</div>
          {upcoming.slice(0, 4).map(s => (
            <div key={s.id} className="li">
              <div style={{ width: 34, height: 34, background: "var(--bg4)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.sessionMode === "online" ? "💻" : "📝"}</div>
              <div style={{ flex: 1 }}><div className="fw7 text-sm">{s.title}</div><div className="text-xs muted">{s.date}</div></div>
              {s.sessionMode === "online" && getMeetingLink(s, data.series) && (() => {
                const minsUntil = minutesUntilSession(s.date, s.time);
                const canJoin = minsUntil <= 30;
                return canJoin
                  ? <button className="btn btn-sm" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", border: "none", fontSize: 11 }} onClick={() => window.open(getMeetingLink(s, data.series), "_blank")}>🎥 Join</button>
                  : <span className="text-xs muted mono">{s.time}</span>;
              })()}
              {s.sessionMode !== "online" && <div className="sess-time">{s.time}</div>}
            </div>
          ))}
          {upcoming.length === 0 && <div className="empty" style={{ padding: "14px 0" }}><div className="empty-icon" style={{ fontSize: 24 }}>📅</div><div className="empty-title">No upcoming sessions</div></div>}
        </div>
      </div>
      <div className="g2 mt16">
        <div className="card">
          <div className="sh-title mb12">My Payments</div>
          {myPayments.map(p => <div key={p.id} className="li"><div style={{ flex: 1 }}><div className="fw7 text-sm">{p.month}</div><div className="text-xs muted">Due: {p.dueDate}</div></div><div className="fw7 mono" style={{ marginRight: 10 }}>{fmt$(p.amount)}</div><Badge status={p.status} /></div>)}
        </div>
        <div className="card">
          <div className="sh-title mb12">Recent Attendance</div>
          {completed.slice(-5).reverse().map(s => <div key={s.id} className="li">
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.attendance[user.id] === true ? "var(--green)" : "var(--red)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}><div className="fw7 text-sm">{s.title}</div><div className="text-xs muted">{s.date}</div></div>
            <Badge status={s.attendance[user.id] === true ? "paid" : "overdue"} label={s.attendance[user.id] === true ? "Present" : "Absent"} />
          </div>)}
        </div>
      </div>
    </div>
  );
}

// ─── TEACHER EARNINGS ─────────────────────────────────────────────────────────
function TeacherEarnings({ user, data }) {
  const myGroups = data.groups.filter(g => g.teacherId === user.id);
  const myStudents = data.users.filter(u => u.role === "student" && myGroups.some(g => g.id === u.groupId));
  const mySessions = data.sessions.filter(s => s.teacherId === user.id);
  const revenue = myStudents.reduce((sum, s) => sum + data.payments.filter(p => p.studentId === s.id && p.status === "paid").reduce((a, p) => a + p.amount, 0), 0);
  const earned = (user.commission / 100) * revenue;
  const paid = data.teacherPayments.filter(tp => tp.teacherId === user.id && tp.status === "paid").reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <div className="ph"><div><div className="ph-title">My Earnings</div><div className="ph-sub">{user.commission}% commission rate</div></div></div>
      <div className="g4 mb16">
        {[
          { l: "Sessions Done", v: mySessions.filter(s => s.status === "completed").length, c: "#3b82f6" },
          { l: "Revenue", v: fmt$(revenue), c: "#f97316" },
          { l: "Earned", v: fmt$(earned), c: "#22c55e" },
          { l: "Balance", v: fmt$(earned - paid), c: earned - paid > 0 ? "#ef4444" : "#22c55e" },
        ].map((x, i) => <div key={i} className="card tac"><div className="fw8" style={{ fontSize: 22, color: x.c }}>{x.v}</div><div className="text-sm muted mt4">{x.l}</div></div>)}
      </div>
      <div className="card">
        <div className="sh-title mb12">Payment Records</div>
        {data.teacherPayments.filter(tp => tp.teacherId === user.id).map(tp => (
          <div key={tp.id} className="li">
            <div style={{ flex: 1 }}><div className="fw7 text-sm">{tp.month}</div><div className="text-xs muted">{tp.date ? `Paid: ${tp.date}` : "Pending"}</div></div>
            <div className="fw7 mono" style={{ marginRight: 12 }}>{fmt$(tp.amount)}</div>
            <Badge status={tp.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
function Analytics({ data, teacherFilter = null }) {
  // Safety: ensure all arrays exist
  data = { users:[], sessions:[], payments:[], groups:[], books:[], lessons:[], series:[], attendance:[], teacherPayments:[], ...data };

  const [tab,      setTab]      = useState("overview");
  const [period,   setPeriod]   = useState("monthly");
  const [selMonth, setSelMonth] = useState(() => { const n=new Date(); return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0"); });
  const [selYear,  setSelYear]  = useState(String(new Date().getFullYear()));

  // ── raw data ────────────────────────────────────────────────────────────────
  const teacherGroupIds = teacherFilter
    ? data.groups.filter(g => String(g.teacherId) === String(teacherFilter)).map(g => g.id)
    : null;
  const students  = data.users.filter(u => u.role === "student" && (!teacherGroupIds || teacherGroupIds.includes(u.groupId)));
  const teachers  = data.users.filter(u => u.role === "teacher");
  // Show sessions that are completed OR have attendance recorded
  const completed = data.sessions.filter(s => s.status === "completed" || Object.keys(s.attendance || {}).length > 0);
  const upcoming  = data.sessions.filter(s => s.status === "upcoming");

  // ── period helpers ──────────────────────────────────────────────────────────
  const inPeriod = dateStr => {
    if (!dateStr) return false;
    if (period === "monthly") {
      const [yr, mo] = selMonth.split("-").map(Number);
      const d = new Date(dateStr);
      return d.getFullYear() === yr && d.getMonth() === mo - 1;
    }
    if (period === "yearly") return dateStr.startsWith(selYear);
    return true;
  };

  const periodLabel = period === "monthly"
    ? new Date(selMonth + "-01").toLocaleString("default", { month:"long", year:"numeric" })
    : period === "yearly" ? selYear : "All Time";

  const shiftMonth = d => {
    const [yr, mo] = selMonth.split("-").map(Number);
    const nd = new Date(yr, mo - 1 + d, 1);
    setSelMonth(nd.getFullYear() + "-" + String(nd.getMonth()+1).padStart(2,"0"));
  };

  // ── finance ─────────────────────────────────────────────────────────────────
  const allPaid       = data.payments.filter(p => p.status === "paid");
  const periodPaid    = allPaid.filter(p => inPeriod(p.date));
  const periodRevenue = periodPaid.reduce((s,p) => s+p.amount, 0);
  const totalRevenue  = allPaid.reduce((s,p) => s+p.amount, 0);
  const pendingRev    = data.payments.filter(p=>p.status==="pending").reduce((s,p)=>s+p.amount,0);
  const overdueRev    = data.payments.filter(p=>p.status==="overdue").reduce((s,p)=>s+p.amount,0);
  const periodPayroll = data.teacherPayments.filter(p=>p.status==="paid"&&inPeriod(p.date)).reduce((s,p)=>s+p.amount,0);
  const netProfit     = periodRevenue - periodPayroll;

  // monthly P&L last 7 months
  const last7 = Array.from({length:7},(_,i)=>{
    const _now = new Date(); const d = new Date(_now.getFullYear(), _now.getMonth()-i, 1);
    const key = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    const rev = data.payments.filter(p=>p.status==="paid"&&p.date?.startsWith(key)).reduce((s,p)=>s+p.amount,0);
    const pay = data.teacherPayments.filter(p=>p.status==="paid"&&p.date?.startsWith(key)).reduce((s,p)=>s+p.amount,0);
    return { label:d.toLocaleString("default",{month:"short"}), rev, pay, profit:rev-pay };
  }).reverse();
  const chartMax = Math.max(...last7.map(x=>x.rev), 1);

  // ── attendance globals ───────────────────────────────────────────────────────
  const allAttPairs  = completed.flatMap(s => Object.values(s.attendance??{}));
  const globalAttRate = allAttPairs.length
    ? Math.round(allAttPairs.filter(Boolean).length / allAttPairs.length * 100) : 0;

  // ── per-student stats ────────────────────────────────────────────────────────
  const studentStats = students.map(st => {
    const sess    = completed.filter(s => st.id in (s.attendance??{}));
    const present = sess.filter(s => s.attendance[st.id]===true).length;
    const rate    = sess.length ? Math.round(present/sess.length*100) : null;
    const paid    = data.payments.filter(p=>p.studentId===st.id&&p.status==="paid").reduce((s,p)=>s+p.amount,0);
    const owed    = data.payments.filter(p=>p.studentId===st.id&&p.status!=="paid").reduce((s,p)=>s+p.amount,0);
    const streak  = (() => { let n=0; for(const s of [...sess].sort((a,b)=>b.date.localeCompare(a.date))){ if(s.attendance[st.id]===true)n++; else break; } return n; })();
    return { ...st, sess:sess.length, present, rate, paid, owed, streak };
  });
  const ranked      = [...studentStats].filter(s=>s.rate!==null).sort((a,b)=>b.rate-a.rate);
  const atRisk      = studentStats.filter(s=>s.rate!==null&&s.rate<70);
  const perfectAtt  = studentStats.filter(s=>s.rate===100).length;

  // ── per-teacher stats ────────────────────────────────────────────────────────
  const teacherStats = teachers.map(t => {
    const myGroups   = data.groups.filter(g=>g.teacherId===t.id);
    const myStudents = students.filter(s=>myGroups.some(g=>g.id===s.groupId));
    const done       = data.sessions.filter(s=>s.teacherId===t.id&&s.status==="completed").length;
    const total      = data.sessions.filter(s=>s.teacherId===t.id).length;
    const revenue    = myStudents.reduce((sum,st)=>sum+data.payments.filter(p=>p.studentId===st.id&&p.status==="paid").reduce((a,p)=>a+p.amount,0),0);
    const earned     = Math.round((t.commission??35)/100*revenue);
    const attPairs   = completed.filter(s=>s.teacherId===t.id).flatMap(s=>Object.values(s.attendance??{}));
    const attRate    = attPairs.length ? Math.round(attPairs.filter(Boolean).length/attPairs.length*100) : 0;
    const paidOut    = data.teacherPayments.filter(p=>p.teacherId===t.id&&p.status==="paid").reduce((s,p)=>s+p.amount,0);
    return {...t, groups:myGroups.length, myStudents:myStudents.length, done, total, revenue, earned, attRate, paidOut, balance:earned-paidOut };
  });

  // ── per-group stats ──────────────────────────────────────────────────────────
  const groupStats = data.groups.map(g => {
    const grpStudents = students.filter(s=>s.groupId===g.id);
    const sessDone    = completed.filter(s=>s.groupId===g.id).length;
    const sessTotal   = data.sessions.filter(s=>s.groupId===g.id).length;
    const attPairs    = completed.filter(s=>s.groupId===g.id).flatMap(s=>Object.values(s.attendance??{}));
    const attRate     = attPairs.length ? Math.round(attPairs.filter(Boolean).length/attPairs.length*100) : 0;
    const teacher     = teachers.find(t=>t.id===g.teacherId);
    const rev         = grpStudents.reduce((sum,st)=>sum+data.payments.filter(p=>p.studentId===st.id&&p.status==="paid").reduce((a,p)=>a+p.amount,0),0);
    const fillPct     = g.maxStudents ? Math.round(grpStudents.length/g.maxStudents*100) : 0;
    return {...g, grpStudents, sessDone, sessTotal, attRate, teacher, rev, fillPct};
  });

  // ── series ────────────────────────────────────────────────────────────────────
  const seriesStats = data.series.map(s => {
    const total = data.sessions.filter(x=>x.seriesId===s.id).length;
    const done  = data.sessions.filter(x=>x.seriesId===s.id&&x.status==="completed").length;
    const pct   = total ? Math.round(done/total*100) : 0;
    return {...s, total, done, pct, group:data.groups.find(g=>g.id===s.groupId)};
  });

  // ── color helpers ─────────────────────────────────────────────────────────────
  const rc  = r => r>=80?"#22c55e":r>=60?"#f59e0b":"#ef4444";
  const rbg = r => r>=80?"rgba(34,197,94,.13)":r>=60?"rgba(245,158,11,.13)":"rgba(239,68,68,.13)";

  // ── PERIOD BAR ────────────────────────────────────────────────────────────────
  const PeriodBar = () => (
    <div className="card mb16" style={{padding:"11px 14px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:4}}>
          {[["monthly","Month"],["yearly","Year"],["all","All Time"]].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriod(v)}
              className={"btn btn-xs "+(period===v?"btn-pr":"btn-se")}>{l}</button>
          ))}
        </div>
        {period==="monthly"&&<>
          <input type="month" style={{minWidth:140}} value={selMonth} onChange={e=>setSelMonth(e.target.value)}/>
          <button className="btn btn-se btn-xs" onClick={()=>shiftMonth(-1)}>‹</button>
          <button className="btn btn-se btn-xs" onClick={()=>shiftMonth(1)}>›</button>
        </>}
        {period==="yearly"&&(
          <select style={{minWidth:100}} value={selYear} onChange={e=>setSelYear(e.target.value)}>
            {[String(new Date().getFullYear()-2), String(new Date().getFullYear()-1), String(new Date().getFullYear()), String(new Date().getFullYear()+1)].map(y=><option key={y}>{y}</option>)}
          </select>
        )}
        <div style={{marginLeft:"auto",fontSize:12,fontWeight:700,color:"var(--accent2)",
          padding:"4px 12px",borderRadius:8,background:"var(--glow)",border:"1px solid rgba(249,115,22,.2)"}}>
          📅 {periodLabel}
        </div>
      </div>
    </div>
  );

  // ── MINI BAR CHART ────────────────────────────────────────────────────────────
  const MiniBar = ({items, max, color="#f97316", h=80}) => (
    <div style={{display:"flex",alignItems:"flex-end",gap:5,height:h,padding:"0 2px"}}>
      {items.map((x,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          <div title={x.l+": "+x.v} style={{width:"100%",background:color,borderRadius:"3px 3px 0 0",
            height:Math.max(3,max?x.v/max*100:0)+"%",transition:"height .5s",
            opacity:.75+.25*(x.v/(max||1))}}/>
          <div style={{fontSize:9,color:"var(--text3)",fontWeight:600,textAlign:"center"}}>{x.l}</div>
        </div>
      ))}
    </div>
  );

  // ── STAT CARD ─────────────────────────────────────────────────────────────────
  const KpiCard = ({icon,label,val,sub,c}) => (
    <div className="card stat" style={{borderColor:c+"33"}}>
      <div className="stat-glow" style={{background:c}}/>
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-val" style={{color:c}}>{val}</div>
      {sub&&<div className="stat-sub">{sub}</div>}
    </div>
  );

  // ── PROG ROW ──────────────────────────────────────────────────────────────────
  const ProgRow = ({label,val,max,pct,color,right}) => {
    const p = pct!==undefined ? pct : (max?Math.round(val/max*100):0);
    return (
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
          <span style={{fontWeight:600,color:"var(--text2)"}}>{label}</span>
          <span style={{fontWeight:700,color:color||"var(--text)"}}>{right||val}</span>
        </div>
        <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden"}}>
          <div style={{height:"100%",width:Math.min(100,Math.max(0,p))+"%",background:color||"var(--accent)",borderRadius:99,transition:"width .5s"}}/>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">📊 Analytics</div>
          <div className="ph-sub">Deep insights across students, teachers, groups and revenue</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs mb16" style={{maxWidth:560}}>
        {[["overview","📊 Overview"],["students","👨‍🎓 Students"],["teachers","👨‍🏫 Teachers"],["revenue","💰 Revenue"],["groups","👥 Groups"]].map(([v,l])=>(
          <div key={v} className={`tab ${tab===v?"active":""}`} onClick={()=>setTab(v)}>{l}</div>
        ))}
      </div>

      {/* ── Period Bar ── */}
      <PeriodBar/>

      {/* ════════════════════ OVERVIEW ════════════════════ */}
      {tab==="overview"&&(
        <div>
          {/* Hero KPIs */}
          <div className="g4 mb16">
            <KpiCard icon="👨‍🎓" label="Total Students"   val={students.length}     sub={`${atRisk.length} at-risk`}           c="#f97316"/>
            <KpiCard icon="✅"   label="Sessions Done"    val={completed.length}    sub={`${upcoming.length} upcoming`}         c="#22c55e"/>
            <KpiCard icon="📈"   label="Avg Attendance"   val={globalAttRate+"%"}   sub="across all groups"                     c="#6366f1"/>
            <KpiCard icon="💵"   label="Revenue (Period)" val={fmt$(periodRevenue)} sub={`Net profit: ${fmt$(netProfit)}`}      c="#f59e0b"/>
          </div>

          <div className="g2 mb16">
            {/* P&L chart */}
            <div className="card">
              <div className="sh mb14"><div className="sh-title">💵 Revenue vs Payroll — Last 7 Months</div></div>
              <div style={{display:"flex",alignItems:"flex-end",gap:6,height:140,padding:"0 4px"}}>
                {last7.map((m,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",flex:1}}>
                      <div title={"Revenue: "+fmt$(m.rev)}
                        style={{flex:1,background:"#22c55e",borderRadius:"3px 3px 0 0",
                          height:Math.max(3,m.rev/chartMax*100)+"%",transition:"height .5s",opacity:.85}}/>
                      <div title={"Payroll: "+fmt$(m.pay)}
                        style={{flex:1,background:"#f97316",borderRadius:"3px 3px 0 0",
                          height:Math.max(2,m.pay/chartMax*100)+"%",transition:"height .5s",opacity:.85}}/>
                    </div>
                    <div style={{fontSize:9,color:"var(--text3)",fontWeight:600}}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:16,marginTop:10,justifyContent:"center"}}>
                {[["#22c55e","Revenue"],["#f97316","Payroll"]].map(([c,l])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)"}}>
                    <div style={{width:10,height:10,borderRadius:3,background:c}}/>{l}
                  </div>
                ))}
              </div>
            </div>

            {/* Right column: payment health + at-risk */}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div className="card" style={{flex:1}}>
                <div className="sh-title mb14">💳 Payment Health</div>
                {[
                  {l:"Paid",    n:data.payments.filter(p=>p.status==="paid").length,    c:"#22c55e"},
                  {l:"Pending", n:data.payments.filter(p=>p.status==="pending").length, c:"#f59e0b"},
                  {l:"Overdue", n:data.payments.filter(p=>p.status==="overdue").length, c:"#ef4444"},
                ].map((x,i)=>{
                  const tot = data.payments.length||1;
                  return (
                    <div key={i} style={{marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                        <span style={{fontWeight:600}}>{x.l}</span>
                        <span style={{fontWeight:700,color:x.c}}>{x.n} <span style={{color:"var(--text3)",fontWeight:400}}>({Math.round(x.n/tot*100)}%)</span></span>
                      </div>
                      <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:Math.round(x.n/tot*100)+"%",background:x.c,borderRadius:99}}/>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{flex:1}}>
                <div className="sh-title mb10">
                  ⚠️ At-Risk Students&nbsp;
                  <span style={{color:"#ef4444",fontWeight:800}}>({atRisk.length})</span>
                </div>
                {atRisk.length===0
                  ? <div style={{fontSize:12,color:"var(--text3)",textAlign:"center",padding:"10px 0"}}>🎉 Everyone is on track!</div>
                  : atRisk.slice(0,5).map(st=>(
                    <div key={st.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                      <Av name={st.name} sz="av-sm"/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:700}}>{st.name}</div>
                        <div style={{fontSize:10,color:"var(--text3)"}}>{data.groups.find(g=>g.id===st.groupId)?.name||"—"}</div>
                      </div>
                      <span style={{fontSize:11,fontWeight:800,padding:"2px 9px",borderRadius:99,
                        background:rbg(st.rate),color:rc(st.rate)}}>{st.rate}%</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>

          {/* Students by level + sessions by group */}
          <div className="g2 mb16">
            <div className="card">
              <div className="sh-title mb14">📊 Students by Level</div>
              {["A1","A2","B1","B2","C1","C2"].map((lvl,i)=>{
                const n = students.filter(s=>s.level===lvl).length;
                return <ProgRow key={lvl} label={lvl} val={n} max={Math.max(...["A1","A2","B1","B2","C1","C2"].map(l=>students.filter(s=>s.level===l).length),1)}
                  color={`hsl(${i*40+20},75%,55%)`} right={n+" student"+(n!==1?"s":"")}/>;
              })}
            </div>

            <div className="card">
              <div className="sh-title mb14">📅 Sessions by Group</div>
              {groupStats.map((g,i)=>(
                <div key={i} style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                    <span style={{fontWeight:700}}>{g.name}</span>
                    <span style={{color:"var(--text3)"}}>{g.sessDone}/{g.sessTotal}&nbsp;·&nbsp;
                      <span style={{fontWeight:700,color:rc(g.attRate)}}>{g.attRate}% att</span>
                    </span>
                  </div>
                  <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",width:g.sessTotal?Math.round(g.sessDone/g.sessTotal*100)+"%":"0%",
                      background:g.sessDone/Math.max(g.sessTotal,1)>=.8?"#22c55e":"var(--accent)",borderRadius:99}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Series progress */}
          <div className="card">
            <div className="sh-title mb14">📚 Series Progress</div>
            <div className="g2" style={{gap:12}}>
              {seriesStats.map((s,i)=>(
                <div key={i} style={{background:"var(--bg3)",borderRadius:12,padding:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700}}>{s.title}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>{s.group?.name||"—"}</div>
                    </div>
                    <span style={{fontSize:22,fontWeight:900,color:s.pct>=80?"#22c55e":"var(--accent2)"}}>{s.pct}%</span>
                  </div>
                  <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden",marginBottom:6}}>
                    <div style={{height:"100%",width:s.pct+"%",background:s.pct>=80?"#22c55e":"var(--accent)",borderRadius:99,transition:"width .5s"}}/>
                  </div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{s.done} / {s.total} sessions completed</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ STUDENTS ════════════════════ */}
      {tab==="students"&&(
        <div>
          <div className="g4 mb16">
            <KpiCard icon="👨‍🎓" label="Total Students"     val={students.length}   sub={`${students.filter(s=>!s.groupId).length} unassigned`} c="#f97316"/>
            <KpiCard icon="📊"   label="Global Att. Rate"   val={globalAttRate+"%"} sub="all completed sessions"                                  c="#6366f1"/>
            <KpiCard icon="🔥"   label="Perfect Attendance" val={perfectAtt}        sub="100% rate students"                                       c="#22c55e"/>
            <KpiCard icon="⚠️"   label="At-Risk"            val={atRisk.length}     sub="below 70% attendance"                                     c="#ef4444"/>
          </div>

          {/* Leaderboard */}
          <div className="card mb16" style={{padding:0}}>
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)",
              display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div className="sh-title">🏆 Attendance Leaderboard</div>
              <span style={{fontSize:11,color:"var(--text3)"}}>{ranked.length} ranked</span>
            </div>
            {ranked.map((st,i)=>(
              <div key={st.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",
                borderBottom:"1px solid var(--border)",
                background:i===0?"rgba(249,115,22,.04)":""}}>
                {/* Rank badge */}
                <div style={{width:30,height:30,borderRadius:9,flexShrink:0,
                  background:i<3?"var(--glow)":"var(--bg3)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:i<3?16:12,fontWeight:800,
                  color:i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#b45309":"var(--text3)"}}>
                  {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
                </div>
                <Av name={st.name} sz="av-sm"/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.name}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>
                    {data.groups.find(g=>g.id===st.groupId)?.name||"No group"} · Lv {st.level} · {st.sess} sessions
                    {st.streak>=3&&<span style={{color:"var(--amber)",fontWeight:700}}> · 🔥{st.streak}</span>}
                  </div>
                </div>
                {/* Rate bar */}
                <div style={{minWidth:110,display:"flex",flexDirection:"column",gap:4}}>
                  <div style={{height:5,background:"var(--bg4)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",width:st.rate+"%",background:rc(st.rate),borderRadius:99}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)"}}>
                    <span>{st.present}/{st.sess}</span>
                    <span style={{fontWeight:800,color:rc(st.rate)}}>{st.rate}%</span>
                  </div>
                </div>
                <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,whiteSpace:"nowrap",
                  background:rbg(st.rate),color:rc(st.rate)}}>
                  {st.rate>=80?"✅ Good":st.rate>=60?"⚠ Fair":"❌ Risk"}
                </span>
              </div>
            ))}
            {ranked.length===0&&<div style={{textAlign:"center",padding:32,color:"var(--text3)"}}>No session data yet</div>}
          </div>

          {/* Level distribution + payment status */}
          <div className="g2">
            <div className="card">
              <div className="sh-title mb14">📊 Level Distribution</div>
              {["A1","A2","B1","B2","C1","C2"].map((lvl,i)=>{
                const n = students.filter(s=>s.level===lvl).length;
                const pct = students.length ? Math.round(n/students.length*100) : 0;
                return (
                  <div key={lvl} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{fontFamily:"var(--mono)",fontWeight:800,fontSize:12,color:"var(--accent2)",minWidth:26}}>{lvl}</span>
                    <div style={{flex:1,height:20,background:"var(--bg4)",borderRadius:6,overflow:"hidden",position:"relative"}}>
                      <div style={{height:"100%",width:pct+"%",background:`hsl(${i*40+20},75%,55%)`,
                        borderRadius:6,transition:"width .5s",display:"flex",alignItems:"center",paddingLeft:6}}>
                        {n>0&&<span style={{fontSize:10,fontWeight:700,color:"#fff"}}>{n}</span>}
                      </div>
                    </div>
                    <span style={{fontSize:11,color:"var(--text3)",minWidth:30,textAlign:"right"}}>{pct}%</span>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <div className="sh-title mb14">💳 Payment Status per Student</div>
              {studentStats.map(st=>(
                <div key={st.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:11,paddingBottom:11,
                  borderBottom:"1px solid var(--border)"}}>
                  <Av name={st.name} sz="av-sm"/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.name}</div>
                    <div style={{fontSize:11,marginTop:2}}>
                      <span style={{color:"#22c55e",fontWeight:600}}>{fmt$(st.paid)}</span>
                      {st.owed>0&&<span style={{color:"#f59e0b",fontWeight:600}}> · {fmt$(st.owed)} owed</span>}
                    </div>
                  </div>
                  <Badge status={st.paymentStatus}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ TEACHERS ════════════════════ */}
      {tab==="teachers"&&(
        <div>
          <div className="g4 mb16">
            <KpiCard icon="👨‍🏫" label="Total Teachers"  val={teachers.length}   sub={`${data.groups.length} groups covered`}  c="#f97316"/>
            <KpiCard icon="📅"   label="Sessions Taught" val={completed.length}  sub="completed sessions total"                 c="#22c55e"/>
            <KpiCard icon="💰"   label="Total Payroll"   val={fmt$(data.teacherPayments.filter(p=>p.status==="paid").reduce((s,p)=>s+p.amount,0))} sub="paid out to date" c="#6366f1"/>
            <KpiCard icon="⭐"   label="Avg Att. Rate"   val={teacherStats.length?Math.round(teacherStats.reduce((s,t)=>s+t.attRate,0)/teacherStats.length)+"%":"—"} sub="in their sessions" c="#f59e0b"/>
          </div>

          {teacherStats.map(t=>(
            <div key={t.id} className="card mb12">
              <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16,flexWrap:"wrap"}}>
                <Av name={t.name} sz="av-xl"/>
                <div style={{flex:1}}>
                  <div style={{fontSize:18,fontWeight:900}}>{t.name}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{t.email} · {t.commission??35}% commission</div>
                </div>
                <div style={{textAlign:"center",padding:"10px 18px",borderRadius:12,
                  background:rbg(t.attRate),border:`1px solid ${rc(t.attRate)}44`}}>
                  <div style={{fontSize:24,fontWeight:900,color:rc(t.attRate)}}>{t.attRate}%</div>
                  <div style={{fontSize:10,color:"var(--text3)"}}>Att. Rate</div>
                </div>
              </div>

              <div className="g4 mb14" style={{gap:8}}>
                {[
                  {l:"Groups",   v:t.groups},
                  {l:"Students", v:t.myStudents},
                  {l:"Done",     v:t.done+"/"+t.total},
                  {l:"Earned",   v:fmt$(t.earned), c:"var(--accent2)"},
                ].map((x,i)=>(
                  <div key={i} style={{background:"var(--bg3)",borderRadius:9,padding:"10px 12px",textAlign:"center"}}>
                    <div style={{fontSize:16,fontWeight:800,color:x.c||"var(--text)"}}>{x.v}</div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>{x.l}</div>
                  </div>
                ))}
              </div>

              <ProgRow label="Session Completion"
                pct={t.total?Math.round(t.done/t.total*100):0}
                color="var(--accent)"
                right={`${t.done}/${t.total} (${t.total?Math.round(t.done/t.total*100):0}%)`}/>
              <ProgRow label="Student Attendance in their classes"
                pct={t.attRate} color={rc(t.attRate)}
                right={<span style={{color:rc(t.attRate),fontWeight:800}}>{t.attRate}%</span>}/>

              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginBottom:5}}>
                <span>Payroll settled</span>
                <span style={{fontWeight:700,color:t.balance>0?"#f59e0b":"#22c55e"}}>
                  {fmt$(t.paidOut)} / {fmt$(t.earned)} · Balance: {fmt$(t.balance)}
                </span>
              </div>
              <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:t.earned?Math.min(100,Math.round(t.paidOut/t.earned*100))+"%":"0%",
                  background:t.balance>0?"var(--amber)":"#22c55e",borderRadius:99,transition:"width .5s"}}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════ REVENUE ════════════════════ */}
      {tab==="revenue"&&(
        <div>
          <div className="g4 mb16">
            <KpiCard icon="💵" label="Revenue (Period)"  val={fmt$(periodRevenue)}         sub={periodLabel}               c="#22c55e"/>
            <KpiCard icon="💸" label="Payroll (Period)"  val={fmt$(periodPayroll)}          sub="teacher payouts"           c="#f97316"/>
            <KpiCard icon="📈" label="Net Profit"        val={fmt$(netProfit)}              sub={netProfit>=0?"Profitable":"Deficit"} c={netProfit>=0?"#22c55e":"#ef4444"}/>
            <KpiCard icon="⚠️" label="Uncollected"       val={fmt$(pendingRev+overdueRev)} sub="pending + overdue"          c="#f59e0b"/>
          </div>

          <div className="g2 mb16">
            {/* Full P&L chart */}
            <div className="card">
              <div className="sh-title mb14">📊 Monthly P&L — Last 7 Months</div>
              <div style={{display:"flex",alignItems:"flex-end",gap:6,height:150,padding:"0 4px"}}>
                {last7.map((m,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",flex:1}}>
                      <div title={"Revenue: "+fmt$(m.rev)}
                        style={{flex:1,background:"#22c55e",borderRadius:"3px 3px 0 0",opacity:.85,
                          height:Math.max(3,m.rev/chartMax*100)+"%",transition:"height .5s"}}/>
                      <div title={"Payroll: "+fmt$(m.pay)}
                        style={{flex:1,background:"#f97316",borderRadius:"3px 3px 0 0",opacity:.85,
                          height:Math.max(2,m.pay/chartMax*100)+"%",transition:"height .5s"}}/>
                      <div title={"Profit: "+fmt$(m.profit)}
                        style={{flex:1,background:m.profit>=0?"#6366f1":"#ef4444",borderRadius:"3px 3px 0 0",opacity:.8,
                          height:Math.max(2,Math.abs(m.profit)/chartMax*100)+"%",transition:"height .5s"}}/>
                    </div>
                    <div style={{fontSize:9,color:"var(--text3)",fontWeight:600}}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:14,marginTop:10,justifyContent:"center",flexWrap:"wrap"}}>
                {[["#22c55e","Revenue"],["#f97316","Payroll"],["#6366f1","Profit"]].map(([c,l])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text3)"}}>
                    <div style={{width:10,height:10,borderRadius:3,background:c}}/>{l}
                  </div>
                ))}
              </div>
            </div>

            {/* Breakdown + margin */}
            <div className="card">
              <div className="sh-title mb14">💰 Breakdown — {periodLabel}</div>
              {[
                {l:"Collected",   v:periodRevenue,    c:"#22c55e", icon:"✅"},
                {l:"Pending",     v:pendingRev,       c:"#f59e0b", icon:"⏳"},
                {l:"Overdue",     v:overdueRev,       c:"#ef4444", icon:"🔴"},
                {l:"Payroll Out", v:periodPayroll,    c:"#f97316", icon:"💸"},
                {l:"Net Profit",  v:netProfit,        c:netProfit>=0?"#22c55e":"#ef4444", icon:"📈", bold:true},
              ].map((r,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"9px 0",borderBottom:i<4?"1px solid var(--border)":"",fontWeight:r.bold?800:400}}>
                  <span style={{fontSize:13,color:r.bold?"var(--text)":"var(--text2)"}}>{r.icon} {r.l}</span>
                  <span style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:700,color:r.c}}>
                    {r.v<0&&"-"}{fmt$(Math.abs(r.v))}
                  </span>
                </div>
              ))}
              {periodRevenue>0&&(
                <div style={{marginTop:14,padding:"12px 14px",borderRadius:10,
                  background:netProfit>=0?"rgba(34,197,94,.07)":"rgba(239,68,68,.07)",
                  border:`1px solid ${netProfit>=0?"rgba(34,197,94,.2)":"rgba(239,68,68,.2)"}`}}>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Profit Margin</div>
                  <div style={{height:6,background:"var(--bg4)",borderRadius:99,overflow:"hidden",marginBottom:6}}>
                    <div style={{height:"100%",width:Math.max(0,Math.min(100,netProfit/periodRevenue*100))+"%",
                      background:netProfit>=0?"#22c55e":"#ef4444",borderRadius:99}}/>
                  </div>
                  <div style={{fontSize:16,fontWeight:900,color:netProfit>=0?"#22c55e":"#ef4444"}}>
                    {Math.round(netProfit/periodRevenue*100)}% margin
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Per-student revenue table */}
          <div className="card" style={{padding:0}}>
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)"}}>
              <div className="sh-title">👨‍🎓 Revenue by Student</div>
            </div>
            {studentStats.map(st=>(
              <div key={st.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",
                borderBottom:"1px solid var(--border)"}}>
                <Av name={st.name} sz="av-sm"/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700}}>{st.name}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{data.groups.find(g=>g.id===st.groupId)?.name||"No group"} · Lv {st.level}</div>
                </div>
                <div style={{display:"flex",gap:14}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#22c55e"}}>{fmt$(st.paid)}</div>
                    <div style={{fontSize:10,color:"var(--text3)"}}>Paid</div>
                  </div>
                  {st.owed>0&&(
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#f59e0b"}}>{fmt$(st.owed)}</div>
                      <div style={{fontSize:10,color:"var(--text3)"}}>Owed</div>
                    </div>
                  )}
                </div>
                <Badge status={st.paymentStatus}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════ GROUPS ════════════════════ */}
      {tab==="groups"&&(
        <div>
          <div className="g4 mb16">
            <KpiCard icon="👥" label="Total Groups"   val={data.groups.length}     sub={`${students.length} students enrolled`} c="#f97316"/>
            <KpiCard icon="👨‍🎓" label="Avg Group Size" val={data.groups.length?Math.round(students.length/data.groups.length):0} sub="students per group" c="#22c55e"/>
            <KpiCard icon="📅" label="Completed"     val={completed.length}        sub={`${upcoming.length} upcoming`}          c="#6366f1"/>
            <KpiCard icon="📊" label="Best Att."     val={groupStats.length?Math.max(...groupStats.map(g=>g.attRate))+"%":"—"} sub="top group rate" c="#f59e0b"/>
          </div>

          {groupStats.map((g,i)=>(
            <div key={i} className="card mb12">
              {/* Group header */}
              <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
                <div style={{width:54,height:54,borderRadius:14,flexShrink:0,
                  background:`hsl(${i*70+20},70%,50%)1a`,
                  border:`2px solid hsl(${i*70+20},70%,50%)44`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:17,fontWeight:900,color:`hsl(${i*70+20},65%,60%)`}}>{g.level}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:17,fontWeight:900}}>{g.name}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
                    {g.schedule} · Teacher: {g.teacher?.name||"—"}
                  </div>
                </div>
                <div style={{textAlign:"center",padding:"10px 16px",borderRadius:12,
                  background:rbg(g.attRate),border:`1px solid ${rc(g.attRate)}44`}}>
                  <div style={{fontSize:24,fontWeight:900,color:rc(g.attRate)}}>{g.attRate}%</div>
                  <div style={{fontSize:10,color:"var(--text3)"}}>Attendance</div>
                </div>
              </div>

              {/* Stats row */}
              <div className="g4 mb14" style={{gap:8}}>
                {[
                  {l:"Students",  v:`${g.grpStudents.length}/${g.maxStudents}`},
                  {l:"Sessions",  v:`${g.sessDone}/${g.sessTotal}`},
                  {l:"Revenue",   v:fmt$(g.rev), c:"var(--accent2)"},
                  {l:"Upcoming",  v:upcoming.filter(s=>s.groupId===g.id).length},
                ].map((x,j)=>(
                  <div key={j} style={{background:"var(--bg3)",borderRadius:9,padding:"10px",textAlign:"center"}}>
                    <div style={{fontSize:15,fontWeight:800,color:x.c||"var(--text)"}}>{x.v}</div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>{x.l}</div>
                  </div>
                ))}
              </div>

              <ProgRow label="Capacity" pct={g.fillPct}
                color={g.fillPct>=90?"#ef4444":g.fillPct>=70?"#f59e0b":"#22c55e"}
                right={`${g.grpStudents.length}/${g.maxStudents} (${g.fillPct}% full)`}/>
              <ProgRow label="Session Completion"
                pct={g.sessTotal?Math.round(g.sessDone/g.sessTotal*100):0}
                color="var(--accent)"
                right={`${g.sessDone}/${g.sessTotal}`}/>

              {/* Students chips */}
              {g.grpStudents.length>0&&(
                <div style={{marginTop:12}}>
                  <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textTransform:"uppercase",
                    letterSpacing:.5,marginBottom:8}}>Students in this group</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                    {g.grpStudents.map(st=>{
                      const sess = completed.filter(s=>s.groupId===g.id&&st.id in (s.attendance??{}));
                      const rate = sess.length?Math.round(sess.filter(s=>s.attendance[st.id]===true).length/sess.length*100):null;
                      return (
                        <div key={st.id} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 10px",
                          borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)"}}>
                          <Av name={st.name} sz="av-sm"/>
                          <div>
                            <div style={{fontSize:11,fontWeight:700}}>{st.name.split(" ")[0]}</div>
                            {rate!==null&&<div style={{fontSize:10,fontWeight:700,color:rc(rate)}}>{rate}%</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── STUDENT CLASSES & ATTENDANCE ─────────────────────────────────────────────
function StudentClasses({ user, data }) {
  const myGroup = data.groups.find(g => g.id === user.groupId);
  const myTeacher = myGroup ? data.users.find(u => u.id === myGroup.teacherId) : null;
  const classmates = myGroup ? data.users.filter(u => u.role === "student" && u.groupId === myGroup.id && u.id !== user.id) : [];
  if (!myGroup) return <div className="empty" style={{ marginTop: 60 }}><div className="empty-icon">📚</div><div className="empty-title">Not assigned to a group yet</div></div>;
  return (
    <div>
      <div className="ph-title mb16">My Classes</div>
      <div className="card mb16">
        <div className="flex ac gap14 mb14">
          <div style={{ background: "var(--accent)", width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, color: "#fff" }}>{myGroup.level}</div>
          <div><div className="fw8" style={{ fontSize: 18 }}>{myGroup.name}</div><div className="text-sm muted mt4">{myGroup.schedule}</div><Badge status={myGroup.status} /></div>
        </div>
        {myTeacher && <div className="card card-sm" style={{ background: "var(--bg3)" }}><div className="text-xs muted mb8">Your Teacher</div><div className="flex ac gap10"><Av name={myTeacher.name} sz="av-md" /><div><div className="fw7">{myTeacher.name}</div><div className="text-xs muted">{myTeacher.email}</div></div></div></div>}
      </div>
      {classmates.length > 0 && <div className="card"><div className="sh-title mb12">Classmates ({classmates.length})</div><div className="g2">{classmates.map(s => <div key={s.id} className="flex ac gap8"><Av name={s.name} /><div><div className="fw7 text-sm">{s.name}</div><div className="text-xs muted">{s.city}</div></div></div>)}</div></div>}
    </div>
  );
}

function StudentAttendance({ user, data }) {
  const mySessions = data.sessions.filter(s => s.groupId === user.groupId && s.status === "completed");
  const attended = mySessions.filter(s => s.attendance[user.id] === true).length;
  const rate = mySessions.length > 0 ? Math.round((attended / mySessions.length) * 100) : 0;
  return (
    <div>
      <div className="ph-title mb16">My Attendance</div>
      <div className="g3 mb16">
        <div className="card tac"><div className="fw8" style={{ fontSize: 34, color: rate >= 80 ? "var(--green)" : "var(--red)" }}>{rate}%</div><div className="text-sm muted">Attendance Rate</div></div>
        <div className="card tac"><div className="fw8" style={{ fontSize: 34, color: "var(--green)" }}>{attended}</div><div className="text-sm muted">Present</div></div>
        <div className="card tac"><div className="fw8" style={{ fontSize: 34, color: "var(--red)" }}>{mySessions.length - attended}</div><div className="text-sm muted">Absent</div></div>
      </div>
      <div className="card">
        <div className="sh-title mb12">Session History</div>
        {mySessions.length === 0 ? <div className="empty"><div className="empty-icon">✅</div><div className="empty-title">No sessions yet</div></div>
          : mySessions.map(s => <div key={s.id} className="li">
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: s.attendance[user.id] === true ? "var(--green)" : "var(--red)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}><div className="fw7 text-sm">{s.title}</div><div className="text-xs muted">{s.date}</div></div>
            <Badge status={s.attendance[user.id] === true ? "paid" : "overdue"} label={s.attendance[user.id] === true ? "✓ Present" : "✗ Absent"} />
          </div>)}
      </div>
    </div>
  );
}

// ─── STUDENT MATERIALS PAGE ───────────────────────────────────────────────────
function StudentMaterials({ user, data }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };

  const [pdfViewer,    setPdfViewer]    = useState(null);
  const [activeTab,    setActiveTab]    = useState("lessons");
  const [expandedCard, setExpandedCard] = useState(null);
  const [hwUploads,    setHwUploads]    = useState({});
  const [dragOver,     setDragOver]     = useState(null);
  const [hwFilter,     setHwFilter]     = useState("all");
  const [lessonSearch, setLessonSearch] = useState("");

  const myGroup           = data.groups.find(g => g.id === user.groupId);
  const mySessions        = data.sessions
    .filter(s => s.groupId === user.groupId && !s.isCancelled)
    .sort((a, b) => a.date.localeCompare(b.date));
  const completedSessions = mySessions.filter(s => s.status === "completed");
  const upcomingSessions  = mySessions.filter(s => s.status === "upcoming");

  const getLessonForSession = (s) =>
    data.lessons.find(l => l.sessionId === s.id)
    ?? (s.seriesId ? data.lessons.find(l => l.seriesId === s.seriesId && !l.sessionId) : null);

  const lessonsWithContent = mySessions
    .map(s => ({ session: s, lesson: getLessonForSession(s) }))
    .filter(x => x.lesson);
  const homeworks = lessonsWithContent.filter(x => x.lesson.homework);
  const myBooks   = data.books.filter(b => b.assignedGroups?.includes(user.groupId));

  // Filtered lessons for search
  const filteredLessons = lessonSearch.trim()
    ? lessonsWithContent.filter(({ lesson, session: s }) =>
        (lesson.title||s.title||"").toLowerCase().includes(lessonSearch.toLowerCase()) ||
        (lesson.description||"").toLowerCase().includes(lessonSearch.toLowerCase()))
    : lessonsWithContent;

  // File helpers
  const fileExt = (url = "") => (url.split(".").pop()?.split("?")[0] || "").toLowerCase();
  const getFileType = (fileId) => {
    if (!fileId) return "unknown";
    const ext = fileExt(typeof fileId === "string" ? fileId : "");
    if (ext === "pdf") return "pdf";
    if (["jpg","jpeg","png","gif","webp"].includes(ext)) return "image";
    if (["doc","docx"].includes(ext)) return "doc";
    if (["mp4","mov","avi"].includes(ext)) return "video";
    if (["mp3","wav","ogg"].includes(ext)) return "audio";
    return "file";
  };
  const fileLabel = (fileId) => {
    if (!fileId) return "File";
    const name = fileId.split("/").pop()?.split("?")[0] || "file";
    try { return decodeURIComponent(name); } catch(_) { return name; }
  };
  const fileIcon = (fileId) => {
    const t = getFileType(fileId);
    return { pdf:"📄", image:"🖼", doc:"📝", video:"🎬", audio:"🎵", file:"📎" }[t] || "📎";
  };
  const fileColor = (fileId) => {
    const t = getFileType(fileId);
    return {
      pdf:   { bg:"rgba(239,68,68,.12)",   color:"#ef4444" },
      image: { bg:"rgba(99,102,241,.12)",  color:"#818cf8" },
      doc:   { bg:"rgba(59,130,246,.12)",  color:"#60a5fa" },
      video: { bg:"rgba(168,85,247,.12)",  color:"#c084fc" },
      audio: { bg:"rgba(34,197,94,.12)",   color:"#4ade80" },
      file:  { bg:"rgba(249,115,22,.12)",  color:"var(--accent2)" },
    }[t] || { bg:"var(--bg3)", color:"var(--text3)" };
  };

  // Open file - PDF gets viewer, image gets viewer, others download
  const openFile = (fileId, label) => {
    const file = getFile(fileId);
    if (!file) return;
    const type = getFileType(fileId);
    if (type === "pdf" || type === "image") {
      setPdfViewer({ ...file, type: type === "pdf" ? "application/pdf" : "image/"+fileExt(fileId) });
    } else {
      downloadFile(file.dataUrl, file.name || label || fileLabel(fileId));
    }
  };

  // Homework upload
  const handleHwUpload = async (lessonId, file) => {
    if (!file) return;
    setHwUploads(p => ({ ...p, [lessonId]: { file, status:"uploading", progress:10 } }));
    try {
      setHwUploads(p => ({ ...p, [lessonId]: { ...p[lessonId], progress:40 } }));
      await api.lessons.uploadFile(lessonId, file);
      setHwUploads(p => ({ ...p, [lessonId]: { file, status:"done", progress:100 } }));
      toast("✅ Homework submitted successfully!");
    } catch(e) {
      setHwUploads(p => ({ ...p, [lessonId]: { file, status:"error", progress:0 } }));
      toast(e.message || "Upload failed", "error");
    }
  };

  // ── Section label component ────────────────────────────────────────────────
  const SectionLabel = ({ icon, label, color="#6366f1", bg="rgba(99,102,241,.12)", right }) => (
    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
      <div style={{ width:20, height:20, borderRadius:5, background:bg, color, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:11, flexShrink:0 }}>{icon}</div>
      <span style={{ fontSize:10, fontWeight:800, letterSpacing:".8px", textTransform:"uppercase",
        color:"var(--text3)" }}>{label}</span>
      {right && <div style={{ marginLeft:"auto" }}>{right}</div>}
    </div>
  );

  // ── File list ─────────────────────────────────────────────────────────────
  const LessonFileList = ({ lesson }) => {
    const files = [];
    if (lesson.fileId) files.push({ id:lesson.fileId, label:"Main Material" });
    (lesson.extraFiles||[]).forEach((fid, i) => files.push({ id:fid, label:`Material ${i+2}` }));
    if (lesson.files?.length) {
      lesson.files.forEach(f => {
        const fid = f.publicId || f.url || f;
        if (!files.find(x => x.id === fid)) files.push({ id:fid, label:f.name||"File" });
      });
    }
    if (!files.length) return null;

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {files.map((f, i) => {
          const file  = getFile(f.id);
          const type  = getFileType(f.id);
          const icon  = fileIcon(f.id);
          const clr   = fileColor(f.id);
          const name  = fileLabel(f.id) !== "file" ? fileLabel(f.id) : f.label;
          return (
            <div key={f.id+i} style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
              borderRadius:10, background:"var(--bg3)", border:"1px solid var(--border)",
              transition:"all .15s", cursor:"pointer",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="var(--accent)"; e.currentTarget.style.background="var(--bg4)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.background="var(--bg3)"; }}
              onClick={() => openFile(f.id, name)}
            >
              {/* File type icon badge */}
              <div style={{ width:38, height:38, borderRadius:9, flexShrink:0, background:clr.bg,
                color:clr.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>
                {icon}
              </div>
              {/* File info */}
              <div style={{ flex:1, minWidth:0 }}>
                <div className="fw6" style={{ fontSize:13, overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap", marginBottom:2 }}>{name}</div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:4,
                    background:clr.bg, color:clr.color, letterSpacing:".4px" }}>{type.toUpperCase()}</span>
                </div>
              </div>
              {/* Action buttons */}
              <div style={{ display:"flex", gap:6, flexShrink:0 }} onClick={e => e.stopPropagation()}>
                {file && (type === "pdf" || type === "image") && (
                  <button className="btn btn-se btn-xs" onClick={() => openFile(f.id, name)}>
                    👁 Preview
                  </button>
                )}
                {file && (
                  <button className="btn btn-pr btn-xs"
                    onClick={() => downloadFile(file.dataUrl, file.name || name)}>
                    📥 Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Homework upload box ───────────────────────────────────────────────────
  const HwUploadBox = ({ lessonId }) => {
    const state    = hwUploads[lessonId];
    const isDrag   = dragOver === lessonId;
    const inputRef = useRef();

    const onDrop = (e) => {
      e.preventDefault(); setDragOver(null);
      const file = e.dataTransfer.files[0];
      if (file) handleHwUpload(lessonId, file);
    };

    if (state?.status === "done") return (
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", borderRadius:10,
        background:"rgba(34,197,94,.08)", border:"1px solid rgba(34,197,94,.2)" }}>
        <div style={{ width:34, height:34, borderRadius:8, background:"rgba(34,197,94,.12)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>✅</div>
        <div style={{ flex:1 }}>
          <div className="fw7" style={{ fontSize:13, color:"var(--green)" }}>Homework submitted!</div>
          <div className="text-xs muted">{state.file?.name}</div>
        </div>
        <button className="btn btn-se btn-xs"
          onClick={() => setHwUploads(p => ({ ...p, [lessonId]:null }))}>
          Upload again
        </button>
      </div>
    );

    if (state?.status === "uploading") return (
      <div style={{ padding:"12px 14px", borderRadius:10, background:"var(--bg3)",
        border:"1px solid var(--border)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span className="fw6" style={{ fontSize:13 }}>Uploading {state.file?.name}…</span>
          <span className="text-xs muted">{state.progress}%</span>
        </div>
        <div style={{ height:5, background:"var(--bg4)", borderRadius:99, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${state.progress}%`,
            background:"linear-gradient(90deg,var(--accent),var(--accent2))",
            borderRadius:99, transition:"width .4s" }} />
        </div>
      </div>
    );

    return (
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(lessonId); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={onDrop}
        style={{
          padding:"18px 16px", borderRadius:10, cursor:"pointer", textAlign:"center",
          transition:"all .2s",
          border:`2px dashed ${isDrag ? "var(--accent)" : "var(--border)"}`,
          background: isDrag ? "var(--glow)" : "var(--bg3)",
        }}
      >
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          style={{ display:"none" }}
          onChange={e => { const f = e.target.files[0]; if (f) handleHwUpload(lessonId, f); }} />
        <div style={{ fontSize:26, marginBottom:6 }}>📤</div>
        <div className="fw7" style={{ fontSize:13, marginBottom:3 }}>Upload Homework</div>
        <div className="text-xs muted">PDF · Image · DOC — drag & drop or click to browse</div>
        {state?.status === "error" && (
          <div style={{ marginTop:8, fontSize:12, color:"var(--red)",
            padding:"6px 10px", borderRadius:6, background:"rgba(239,68,68,.08)" }}>
            ⚠ Upload failed — please try again
          </div>
        )}
      </div>
    );
  };

  // ── Lesson Card ───────────────────────────────────────────────────────────
  const LessonCard = ({ session: s, lesson, index }) => {
    const book      = data.books.find(b => b.id === lesson.bookId);
    const chapter   = book?.chapters?.find(ch => ch.id === lesson.chapterId);
    const isPast    = s.status === "completed";
    const isNext    = s.id === upcomingSessions[0]?.id;
    const isOpen    = expandedCard === s.id;
    const today     = new Date().toISOString().split("T")[0];
    const hwState   = hwUploads[lesson.id];
    const allFiles  = [
      lesson.fileId && lesson.fileId,
      ...(lesson.extraFiles||[]),
      ...(lesson.files||[]).map(f => f.publicId||f.url||f),
    ].filter(Boolean);
    const hasFiles     = allFiles.length > 0;
    const isOverdue    = lesson.homeworkDue && lesson.homeworkDue < today;
    const isDueSoon    = lesson.homeworkDue && lesson.homeworkDue >= today &&
      lesson.homeworkDue <= new Date(Date.now()+3*24*60*60*1000).toISOString().split("T")[0];
    const accentLeft   = isNext ? "var(--accent)" : isPast ? "var(--green)" : "var(--border)";

    return (
      <div id={`lesson-${s.id}`} style={{
        borderRadius:14, background:"var(--bg2)", marginBottom:12, overflow:"hidden",
        border:"1px solid var(--border)", borderLeft:`4px solid ${accentLeft}`,
        transition:"box-shadow .15s, transform .1s",
        boxShadow: isOpen ? "0 6px 28px rgba(0,0,0,.18)" : "none",
      }}>

        {/* ── Header (click to expand) ── */}
        <div style={{ padding:"14px 16px", cursor:"pointer", userSelect:"none" }}
          onClick={() => setExpandedCard(isOpen ? null : s.id)}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>

            {/* Number / status badge */}
            <div style={{
              width:42, height:42, borderRadius:10, flexShrink:0,
              display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13,
              background: isPast ? "rgba(34,197,94,.1)" : isNext ? "var(--glow)" : "var(--bg3)",
              color:      isPast ? "var(--green)"        : isNext ? "var(--accent2)" : "var(--text3)",
              border:`1px solid ${isPast ? "rgba(34,197,94,.2)" : isNext ? "rgba(249,115,22,.2)" : "var(--border)"}`,
            }}>
              {isPast ? "✓" : `#${index+1}`}
            </div>

            {/* Title + meta */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:3 }}>
                <div className="fw7" style={{ fontSize:14.5 }}>{lesson.title || s.title}</div>
                {isNext && (
                  <span style={{ fontSize:9, fontWeight:800, letterSpacing:".8px", padding:"2px 7px",
                    borderRadius:99, background:"var(--glow)", color:"var(--accent2)",
                    border:"1px solid rgba(249,115,22,.2)", textTransform:"uppercase" }}>NEXT</span>
                )}
                {lesson.homework && (
                  <span style={{ fontSize:9, fontWeight:700, letterSpacing:".5px", padding:"2px 6px",
                    borderRadius:99, textTransform:"uppercase",
                    background: isOverdue ? "rgba(239,68,68,.12)" : isDueSoon ? "rgba(245,158,11,.12)" : "rgba(249,115,22,.08)",
                    color: isOverdue ? "var(--red)" : isDueSoon ? "var(--amber)" : "var(--text3)" }}>
                    {isOverdue ? "⚠ Overdue" : isDueSoon ? "⏰ Due soon" : "📝 Homework"}
                  </span>
                )}
              </div>
              <div className="text-xs muted" style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                <span>📅 {s.date}</span>
                {(s.startTime||s.time) && <span>🕐 {s.startTime||s.time}</span>}
                {book && <span>📚 {book.title}{chapter ? ` · ${chapter.title}` : ""}</span>}
                {hasFiles && (
                  <span style={{ color:"var(--accent2)", fontWeight:600 }}>
                    📎 {allFiles.length} file{allFiles.length!==1?"s":""}
                  </span>
                )}
              </div>
            </div>

            {/* Right side */}
            <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
              <Badge status={isPast ? "paid" : "pending"} label={isPast ? "Done" : "Upcoming"} />
              <span style={{ fontSize:20, color:"var(--text3)", transition:"transform .2s",
                transform: isOpen ? "rotate(180deg)" : "none" }}>⌄</span>
            </div>
          </div>
        </div>

        {/* ── Expanded content ── */}
        {isOpen && (
          <div style={{ borderTop:"1px solid var(--border)" }}>

            {/* SECTION 1: Lesson Content */}
            {lesson.description && (
              <div style={{ padding:"16px 18px", borderBottom:"1px solid var(--border)" }}>
                <SectionLabel icon="✏" label="Lesson Content"
                  color="#818cf8" bg="rgba(99,102,241,.12)" />
                <div style={{
                  fontSize:14, lineHeight:1.8, color:"var(--text2)", whiteSpace:"pre-wrap",
                  padding:"12px 14px", borderRadius:10, background:"var(--bg3)",
                  border:"1px solid var(--border)",
                }}>
                  {lesson.description}
                </div>
              </div>
            )}

            {/* SECTION 2: Material Files */}
            {hasFiles && (
              <div style={{ padding:"16px 18px", borderBottom:"1px solid var(--border)" }}>
                <SectionLabel icon="📁" label="Materials"
                  color="var(--accent2)" bg="rgba(249,115,22,.12)"
                  right={
                    <span className="text-xs muted">
                      {allFiles.length} file{allFiles.length!==1?"s":""} · click to preview
                    </span>
                  }
                />
                <LessonFileList lesson={lesson} />
              </div>
            )}

            {/* SECTION 3: Homework */}
            {lesson.homework && (
              <div style={{ padding:"16px 18px" }}>
                <SectionLabel icon="📝" label="Homework"
                  color="var(--amber)" bg="rgba(245,158,11,.12)"
                  right={lesson.homeworkDue && (
                    <span style={{ fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:6,
                      background: isOverdue ? "rgba(239,68,68,.12)" : isDueSoon ? "rgba(245,158,11,.12)" : "var(--bg3)",
                      color: isOverdue ? "var(--red)" : isDueSoon ? "var(--amber)" : "var(--text3)",
                      border:`1px solid ${isOverdue ? "rgba(239,68,68,.2)" : isDueSoon ? "rgba(245,158,11,.2)" : "var(--border)"}`,
                    }}>
                      📅 Due: {lesson.homeworkDue}
                    </span>
                  )}
                />
                <div style={{ fontSize:13.5, color:"var(--text2)", lineHeight:1.7, marginBottom:12,
                  padding:"12px 14px", borderRadius:10,
                  background:"rgba(245,158,11,.06)", border:"1px solid rgba(245,158,11,.12)" }}>
                  {lesson.homework}
                </div>
                <HwUploadBox lessonId={lesson.id} />
              </div>
            )}

            {/* Empty state */}
            {!lesson.description && !hasFiles && !lesson.homework && (
              <div style={{ padding:"28px 16px", textAlign:"center", color:"var(--text3)", fontSize:13 }}>
                No content uploaded yet for this lesson.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Page header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">📚 My Materials</div>
          <div className="ph-sub">
            {lessonsWithContent.length} lessons · {myBooks.length} books · {homeworks.length} assignments
            {myGroup && (
              <span style={{ marginLeft:8, padding:"2px 8px", borderRadius:99,
                background:"var(--glow)", color:"var(--accent2)", fontSize:11, fontWeight:700 }}>
                {myGroup.name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginBottom:16 }}>
        {[
          { icon:"📖", label:"Lessons", value:lessonsWithContent.length, color:"#818cf8", bg:"rgba(99,102,241,.08)" },
          { icon:"✅", label:"Completed", value:completedSessions.length, color:"var(--green)", bg:"rgba(34,197,94,.08)" },
          { icon:"📝", label:"Homework", value:homeworks.length, color:"var(--amber)", bg:"rgba(245,158,11,.08)" },
          { icon:"📚", label:"Books", value:myBooks.length, color:"var(--accent2)", bg:"rgba(249,115,22,.08)" },
        ].map(item => (
          <div key={item.label} style={{ padding:"12px 14px", borderRadius:12, background:item.bg,
            border:`1px solid ${item.color}22`, display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:20 }}>{item.icon}</div>
            <div>
              <div className="fw8" style={{ fontSize:18, color:item.color, lineHeight:1 }}>{item.value}</div>
              <div className="text-xs muted">{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Next lesson banner ── */}
      {upcomingSessions.length > 0 && (() => {
        const next   = upcomingSessions[0];
        const lesson = getLessonForSession(next);
        if (!lesson) return null;
        const book    = data.books.find(b => b.id === lesson.bookId);
        const chapter = book?.chapters?.find(ch => ch.id === lesson.chapterId);
        const allFiles = [lesson.fileId, ...(lesson.extraFiles||[])].filter(Boolean);
        return (
          <div style={{
            borderRadius:14, marginBottom:16, overflow:"hidden",
            background:"linear-gradient(135deg, var(--bg2) 0%, var(--bg3) 100%)",
            border:"1px solid var(--accent)44", position:"relative",
          }}>
            {/* Glow accent line */}
            <div style={{ height:3, background:"linear-gradient(90deg,var(--accent),var(--accent2))", width:"100%" }} />
            <div style={{ padding:"16px 18px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <span style={{ fontSize:11, fontWeight:800, color:"var(--accent2)",
                  letterSpacing:".5px", textTransform:"uppercase" }}>📌 NEXT LESSON</span>
                <span className="mono text-xs muted">{next.date} · {next.startTime||next.time}</span>
              </div>
              <div className="fw8" style={{ fontSize:18, marginBottom:4 }}>{lesson.title || next.title}</div>
              {book && <div className="text-sm muted mb8">📚 {book.title}{chapter ? ` · ${chapter.title}` : ""}</div>}
              {lesson.description && (
                <div style={{ fontSize:13, color:"var(--text2)", marginBottom:12, lineHeight:1.65,
                  padding:"10px 12px", borderRadius:8, background:"var(--bg3)", borderLeft:"3px solid var(--accent)44" }}>
                  {lesson.description.length > 200
                    ? lesson.description.slice(0,200) + "…"
                    : lesson.description}
                </div>
              )}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                {allFiles.length > 0 && (
                  <button className="btn btn-se btn-sm" onClick={() => {
                    setActiveTab("lessons"); setExpandedCard(next.id);
                    setTimeout(() => document.getElementById(`lesson-${next.id}`)?.scrollIntoView({ behavior:"smooth", block:"center" }), 100);
                  }}>📁 View {allFiles.length} Material{allFiles.length!==1?"s":""}</button>
                )}
                {lesson.fileId && getFile(lesson.fileId) && (
                  <button className="btn btn-pr btn-sm"
                    onClick={() => openFile(lesson.fileId, lesson.title)}>
                    👁 Preview File
                  </button>
                )}
                {lesson.homework && (
                  <button className="btn btn-se btn-sm" style={{ color:"var(--amber)", borderColor:"rgba(245,158,11,.3)" }}
                    onClick={() => { setActiveTab("homework"); }}>
                    📝 View Homework
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Tabs ── */}
      <div className="tabs mb16">
        {[
          { key:"lessons",  icon:"📖", label:"Lessons",  count:lessonsWithContent.length },
          { key:"homework", icon:"📝", label:"Homework", count:homeworks.length },
          { key:"books",    icon:"📚", label:"Books",    count:myBooks.length },
        ].map(t => (
          <div key={t.key} className={`tab ${activeTab===t.key?"active":""}`}
            onClick={() => setActiveTab(t.key)}>
            {t.icon} {t.label}
            <span style={{ fontSize:11, opacity:.7, marginLeft:4 }}>({t.count})</span>
          </div>
        ))}
      </div>

      {/* ══════════ LESSONS TAB ══════════ */}
      {activeTab === "lessons" && (
        <div>
          {/* Search */}
          {lessonsWithContent.length > 3 && (
            <div style={{ marginBottom:12 }}>
              <input
                value={lessonSearch} onChange={e => setLessonSearch(e.target.value)}
                placeholder="🔍 Search lessons…"
                style={{ width:"100%", padding:"9px 14px", borderRadius:10, fontSize:13,
                  background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text)",
                  outline:"none" }}
              />
            </div>
          )}

          {filteredLessons.length === 0 ? (
            <div className="empty" style={{ marginTop:32 }}>
              <div className="empty-icon">📖</div>
              <div className="empty-title">{lessonSearch ? "No lessons found" : "No lesson content yet"}</div>
              <div className="text-sm muted">
                {lessonSearch ? "Try a different search term" : "Your teacher will upload materials before each session"}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span className="text-xs muted">
                  {filteredLessons.length} lesson{filteredLessons.length!==1?"s":""}{lessonSearch?" found":""}
                </span>
                <span className="text-xs muted">Most recent first · click to expand</span>
              </div>
              {[...filteredLessons].reverse().map(({ session: s, lesson }, i) => (
                <LessonCard key={s.id} session={s} lesson={lesson}
                  index={filteredLessons.length - 1 - i} />
              ))}
            </>
          )}
        </div>
      )}

      {/* ══════════ HOMEWORK TAB ══════════ */}
      {activeTab === "homework" && (
        <div>
          {homeworks.length === 0 ? (
            <div className="empty" style={{ marginTop:32 }}>
              <div className="empty-icon">📝</div>
              <div className="empty-title">No homework assigned yet</div>
              <div className="text-sm muted">Assignments will appear here when your teacher adds them</div>
            </div>
          ) : (
            <>
              {/* Filter pills */}
              <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
                {[
                  { key:"all",     label:"All",       count:homeworks.length },
                  { key:"pending", label:"Pending",   count:homeworks.filter(x => !hwUploads[x.lesson.id]?.status).length },
                  { key:"done",    label:"Submitted", count:Object.values(hwUploads).filter(v=>v?.status==="done").length },
                ].map(item => (
                  <button key={item.key}
                    onClick={() => setHwFilter(item.key)}
                    className={`btn btn-xs ${hwFilter===item.key ? "btn-pr" : "btn-se"}`}
                    style={{ gap:6 }}>
                    {item.label} <span style={{ opacity:.7 }}>({item.count})</span>
                  </button>
                ))}
              </div>

              {homeworks
                .filter(({ lesson }) => {
                  if (hwFilter === "done")    return hwUploads[lesson.id]?.status === "done";
                  if (hwFilter === "pending") return !hwUploads[lesson.id]?.status;
                  return true;
                })
                .map(({ session: s, lesson }) => {
                  const today     = new Date().toISOString().split("T")[0];
                  const isOverdue = lesson.homeworkDue && lesson.homeworkDue < today && s.status === "completed";
                  const isDueSoon = lesson.homeworkDue && lesson.homeworkDue >= today &&
                    lesson.homeworkDue <= new Date(Date.now()+3*24*60*60*1000).toISOString().split("T")[0];
                  const hwState   = hwUploads[lesson.id];

                  return (
                    <div key={s.id} style={{
                      borderRadius:14, background:"var(--bg2)", marginBottom:12, overflow:"hidden",
                      border:"1px solid var(--border)",
                      borderLeft:`4px solid ${isOverdue?"var(--red)":isDueSoon?"var(--amber)":"var(--border)"}`,
                    }}>
                      <div style={{ padding:"16px 18px" }}>
                        {/* Header */}
                        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
                          gap:12, marginBottom:12 }}>
                          <div>
                            <div className="fw7" style={{ fontSize:14.5, marginBottom:4 }}>
                              {lesson.title || s.title}
                            </div>
                            <div className="text-xs muted">📅 {s.date} · {s.startTime||s.time}</div>
                          </div>
                          <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap" }}>
                            {hwState?.status === "done" && <Badge status="paid" label="✅ Submitted" />}
                            {isOverdue && !hwState?.status && <Badge status="overdue" label="Overdue" />}
                            {isDueSoon && !isOverdue && !hwState?.status && <Badge status="pending" label="Due Soon" />}
                            {lesson.homeworkDue && (
                              <span className="mono text-xs" style={{
                                color: isOverdue?"var(--red)":"var(--amber)",
                                padding:"4px 8px",
                                background: isOverdue?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)",
                                borderRadius:6, fontWeight:700,
                              }}>Due {lesson.homeworkDue}</span>
                            )}
                          </div>
                        </div>

                        {/* Instructions */}
                        <div style={{ fontSize:13.5, color:"var(--text2)", lineHeight:1.7, marginBottom:14,
                          padding:"12px 14px", borderRadius:10,
                          background:"rgba(245,158,11,.06)", border:"1px solid rgba(245,158,11,.12)" }}>
                          {lesson.homework}
                        </div>

                        <HwUploadBox lessonId={lesson.id} />
                      </div>
                    </div>
                  );
                })
              }
            </>
          )}
        </div>
      )}

      {/* ══════════ BOOKS TAB ══════════ */}
      {activeTab === "books" && (
        <div>
          {myBooks.length === 0 ? (
            <div className="empty" style={{ marginTop:32 }}>
              <div className="empty-icon">📚</div>
              <div className="empty-title">No books assigned yet</div>
              <div className="text-sm muted">Books assigned to your group will appear here</div>
            </div>
          ) : myBooks.map(book => {
            const coveredChapters = new Set(
              data.lessons.filter(l => l.bookId === book.id).map(l => l.chapterId)
            );
            const progress = book.chapters?.length
              ? Math.round(coveredChapters.size / book.chapters.length * 100) : 0;

            return (
              <div key={book.id} style={{ borderRadius:14, background:"var(--bg2)",
                border:"1px solid var(--border)", marginBottom:14, overflow:"hidden" }}>

                {/* Book header */}
                <div style={{ padding:"16px 18px", display:"flex", gap:14,
                  alignItems:"flex-start", borderBottom:"1px solid var(--border)" }}>
                  <div style={{ width:62, height:78, borderRadius:10, flexShrink:0,
                    background:`linear-gradient(135deg,${book.coverColor||"var(--accent)"},${(book.coverColor||"#f97316")}88)`,
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:28,
                    boxShadow:`0 4px 16px ${book.coverColor||"#f97316"}44` }}>📖</div>
                  <div style={{ flex:1 }}>
                    <div className="fw8" style={{ fontSize:16, marginBottom:4 }}>{book.title}</div>
                    {book.author && <div className="text-xs muted mb8">by {book.author}</div>}
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:12 }}>
                      <Badge status="active" label={book.level || "B1"} />
                      <span className="text-xs muted">
                        {book.chapters?.length||0} chapters · {coveredChapters.size} covered
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                        <span className="text-xs muted">Your progress</span>
                        <span className="text-xs mono" style={{ color:"var(--accent2)", fontWeight:700 }}>{progress}%</span>
                      </div>
                      <div style={{ height:7, background:"var(--bg4)", borderRadius:99, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${progress}%`,
                          background:"linear-gradient(90deg,var(--accent),var(--accent2))",
                          borderRadius:99, transition:"width .6s" }} />
                      </div>
                    </div>
                  </div>
                  {/* Book actions */}
                  {book.fileId && getFile(book.fileId) && (
                    <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
                      <button className="btn btn-se btn-sm"
                        onClick={() => openFile(book.fileId, book.title)}>
                        👁 Preview
                      </button>
                      <button className="btn btn-pr btn-sm"
                        onClick={() => { const f=getFile(book.fileId); if(f) downloadFile(f.dataUrl,f.name||book.title); }}>
                        📥 Download
                      </button>
                    </div>
                  )}
                </div>

                {/* Chapters */}
                {book.chapters?.length > 0 && (
                  <div style={{ padding:"12px 18px" }}>
                    <div className="text-xs muted" style={{ marginBottom:8, fontWeight:700, letterSpacing:".5px" }}>
                      CHAPTERS
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:6 }}>
                      {book.chapters.map(ch => {
                        const done = coveredChapters.has(ch.id);
                        return (
                          <div key={ch.id} style={{
                            display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
                            borderRadius:8, fontSize:12, fontWeight: done ? 600 : 400,
                            background: done ? "rgba(34,197,94,.07)" : "var(--bg3)",
                            border:`1px solid ${done ? "rgba(34,197,94,.2)" : "var(--border)"}`,
                            color: done ? "var(--green)" : "var(--text2)",
                          }}>
                            <span style={{ fontSize:14 }}>{done ? "✅" : "⭕"}</span>
                            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {ch.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pdfViewer && <PdfViewer file={pdfViewer} onClose={() => setPdfViewer(null)} />}
    </div>
  );
}

// ─── ADMIN USERS PAGE ─────────────────────────────────────────────────────────
const ADMIN_PERMS = [
  { id: "students",  label: "Manage Students",  icon: "👨‍🎓" },
  { id: "teachers",  label: "Manage Teachers",  icon: "👨‍🏫" },
  { id: "groups",    label: "Manage Groups",    icon: "👥" },
  { id: "books",     label: "Curriculum",       icon: "📚" },
  { id: "sessions",  label: "Sessions",         icon: "📅" },
  { id: "payments",  label: "Payments",         icon: "💳" },
  { id: "analytics", label: "Analytics",        icon: "📊" },
];

const EMPTY_FORM = { name: "", email: "", password: "", confirmPassword: "", permissions: ["students","sessions"] };

// FormPanel is defined OUTSIDE AdminUsersPage so React doesn't recreate it
// on every keystroke (which would cause inputs to lose focus after each character).
function AdminFormPanel({ form, setForm, showPw, setShowPw, onSave, onCancel, saveLabel }) {
  const togglePerm = (pid) => setForm(f => ({
    ...f,
    permissions: f.permissions.includes(pid)
      ? f.permissions.filter(p => p !== pid)
      : [...f.permissions, pid],
  }));

  return (
    <div className="card mb16" style={{ padding: 20, border: "2px solid var(--accent)", borderRadius: 12 }}>
      <div className="sh-title mb14">{saveLabel === "Create" ? "➕ New Admin User" : "✏️ Edit Admin User"}</div>

      <div className="input-row">
        <div className="fg">
          <label>Full Name *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Mohamed Ali" />
        </div>
        <div className="fg">
          <label>Email Address *</label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@yourdomain.com" />
        </div>
        <div className="fg" style={{ position: "relative" }}>
          <label>Password * <span style={{ fontSize: 10, color: "var(--text3)" }}>(min 6 chars)</span></label>
          <input type={showPw ? "text" : "password"} value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Set a strong password" />
          <button onClick={() => setShowPw(s => !s)} style={{ position: "absolute", right: 10, top: 34, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text3)" }}>
            {showPw ? "🙈" : "👁"}
          </button>
        </div>
        <div className="fg">
          <label>Confirm Password *</label>
          <input type={showPw ? "text" : "password"} value={form.confirmPassword}
            onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="Repeat password" />
        </div>
      </div>

      <div className="sh-title mt16 mb10">🔑 Access Permissions</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {ADMIN_PERMS.map(p => {
          const on = form.permissions.includes(p.id);
          return (
            <button key={p.id} onClick={() => togglePerm(p.id)} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `2px solid ${on ? "var(--accent)" : "var(--border)"}`,
              background: on ? "var(--glow)" : "var(--bg2)",
              color: on ? "var(--accent2)" : "var(--text3)",
              transition: "all .15s",
            }}>
              {p.icon} {p.label} {on && <span style={{ fontSize: 10 }}>✓</span>}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14 }}>
        💡 Selected permissions control which pages this admin can see in the sidebar.
      </div>

      <div className="flex gap8">
        <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={onCancel}>Cancel</button>
        <button className="btn btn-pr w100" style={{ justifyContent: "center" }} onClick={onSave}>💾 {saveLabel} Admin</button>
      </div>
    </div>
  );
}

function AdminUsersPage({ data, setData, currentUser }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], ...data };
  const admins = data.users.filter(u => u.role === "admin");

  const [showAdd,   setShowAdd]   = useState(false);
  const [editUser,  setEditUser]  = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [showPw,    setShowPw]    = useState(false);
  const [revealPw,  setRevealPw]  = useState({});

  const openAdd = () => { setForm(EMPTY_FORM); setShowPw(false); setShowAdd(true); setEditUser(null); };
  const openEdit = (u) => {
    setForm({ name: u.name, email: u.email, password: u.password, confirmPassword: u.password, permissions: u.permissions ?? ADMIN_PERMS.map(p => p.id) });
    setShowPw(false); setEditUser(u); setShowAdd(false);
  };

  const validate = () => {
    if (!form.name.trim())  { toast("Name is required", "error"); return false; }
    if (!form.email.trim()) { toast("Email is required", "error"); return false; }
    const emailExists = data.users.find(u => u.email === form.email.trim() && u.id !== editUser?.id);
    if (emailExists)        { toast("Email already in use", "error"); return false; }
    if (form.password.length < 6) { toast("Password must be at least 6 characters", "error"); return false; }
    if (form.password !== form.confirmPassword) { toast("Passwords do not match", "error"); return false; }
    if (form.permissions.length === 0) { toast("Grant at least one permission", "error"); return false; }
    return true;
  };

  const saveNew = async () => {
    if (!validate()) return;
    try {
      const newUser = await api.users.create({
        name: form.name.trim(), email: form.email.trim(),
        password: form.password, role: "admin",
        permissions: form.permissions,
      });
      const flat = { ...newUser, id: newUser._id?.toString() || newUser.id };
      setData(d => ({ ...d, users: [...d.users, flat] }));
      toast("✅ Admin user created");
      setShowAdd(false);
    } catch(e) { toast(e.message || "Failed to create admin", "error"); }
  };

  const saveEdit = async () => {
    if (!validate()) return;
    try {
      const updated = await api.users.update(editUser.id, {
        name: form.name.trim(), email: form.email.trim(),
        password: form.password, permissions: form.permissions,
      });
      const flat = { ...updated, id: updated._id?.toString() || updated.id };
      setData(d => ({ ...d, users: d.users.map(u => u.id === editUser.id ? { ...u, ...flat } : u) }));
      toast("✅ Admin user updated");
      setEditUser(null);
    } catch(e) { toast(e.message || "Failed to update admin", "error"); }
  };

  const deleteAdmin = async () => {
    if (delTarget.id === currentUser.id) { toast("You cannot delete your own account", "error"); setDelTarget(null); return; }
    try {
      await api.users.delete(delTarget.id);
      setData(d => ({ ...d, users: d.users.filter(u => u.id !== delTarget.id) }));
      toast("Admin user removed");
    } catch(e) { toast(e.message || "Failed to delete", "error"); }
    setDelTarget(null);
  };

  return (
    <div>
      <div className="ph">
        <div>
          <div className="ph-title">🔐 Admin Users</div>
          <div className="ph-sub">{admins.length} admin{admins.length !== 1 ? "s" : ""} — control who can manage the platform</div>
        </div>
        {!showAdd && !editUser && (
          <button className="btn btn-pr" onClick={openAdd}>+ Add Admin</button>
        )}
      </div>

      {showAdd && (
        <AdminFormPanel
          form={form} setForm={setForm}
          showPw={showPw} setShowPw={setShowPw}
          onSave={saveNew} onCancel={() => setShowAdd(false)} saveLabel="Create"
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {admins.map(u => {
          const isMe = u.id === currentUser.id;
          const isEditing = editUser?.id === u.id;
          const perms = u.permissions ?? ADMIN_PERMS.map(p => p.id);
          return (
            <div key={u.id}>
              <div className="card" style={{ border: isMe ? "2px solid var(--accent)" : undefined }}>
                <div className="flex ac gap12">
                  <div style={{ width: 46, height: 46, borderRadius: 12, background: "var(--glow)", color: "var(--accent2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
                    {u.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="flex ac gap8">
                      <div className="fw7" style={{ fontSize: 15 }}>{u.name}</div>
                      {isMe && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent2)", background: "var(--glow)", padding: "2px 8px", borderRadius: 99 }}>YOU</span>}
                    </div>
                    <div className="text-xs muted mt2">{u.email}</div>
                    <div className="flex ac gap6 mt4">
                      <span className="text-xs" style={{ color: "var(--text3)", fontFamily: "var(--mono)" }}>
                        {revealPw[u.id] ? u.password : "••••••••"}
                      </span>
                      <button onClick={() => setRevealPw(r => ({ ...r, [u.id]: !r[u.id] }))}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--text3)", padding: "0 2px" }}>
                        {revealPw[u.id] ? "🙈" : "👁"}
                      </button>
                      <button onClick={() => navigator.clipboard.writeText(u.password).then(() => toast("Password copied!"))}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--text3)", padding: "0 2px" }}>
                        📋
                      </button>
                    </div>
                  </div>
                  <div className="flex gap6">
                    <button className="btn btn-se btn-sm" onClick={() => isEditing ? setEditUser(null) : openEdit(u)}>
                      ✏️ {isEditing ? "Cancel" : "Edit"}
                    </button>
                    {!isMe && <button className="btn btn-da btn-sm" onClick={() => setDelTarget(u)}>🗑</button>}
                  </div>
                </div>

                <div className="flex ac gap6 mt12" style={{ flexWrap: "wrap" }}>
                  {ADMIN_PERMS.filter(p => perms.includes(p.id)).map(p => (
                    <span key={p.id} style={{ fontSize: 11, fontWeight: 600, color: "var(--accent2)", background: "var(--glow)", padding: "3px 10px", borderRadius: 99 }}>
                      {p.icon} {p.label}
                    </span>
                  ))}
                  {ADMIN_PERMS.filter(p => !perms.includes(p.id)).map(p => (
                    <span key={p.id} style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)", background: "var(--bg3)", padding: "3px 10px", borderRadius: 99, textDecoration: "line-through" }}>
                      {p.icon} {p.label}
                    </span>
                  ))}
                </div>

                {u.createdAt && (
                  <div className="text-xs muted mt8">
                    Added {u.createdAt}{u.createdBy ? ` by ${data.users.find(x => x.id === u.createdBy)?.name ?? "Admin"}` : ""}
                  </div>
                )}
              </div>

              {isEditing && (
                <div style={{ marginTop: 8 }}>
                  <AdminFormPanel
                    form={form} setForm={setForm}
                    showPw={showPw} setShowPw={setShowPw}
                    onSave={saveEdit} onCancel={() => setEditUser(null)} saveLabel="Update"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {delTarget && (
        <Modal open={true} onClose={() => setDelTarget(null)} title="Remove Admin User">
          <div style={{ textAlign: "center", padding: "8px 0 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <div className="fw7" style={{ fontSize: 15, marginBottom: 8 }}>Remove <strong>{delTarget.name}</strong>?</div>
            <div className="text-sm muted mb20">This admin will lose all access to the platform immediately.</div>
            <div className="flex gap8">
              <button className="btn btn-se w100" style={{ justifyContent: "center" }} onClick={() => setDelTarget(null)}>Cancel</button>
              <button className="btn btn-da w100" style={{ justifyContent: "center" }} onClick={deleteAdmin}>🗑 Remove</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── ADMIN ATTENDANCE PAGE ────────────────────────────────────────────────────
function AdminAttendancePage({ data, setData, teacherFilter }) {
  data = { users:[], sessions:[], groups:[], payments:[], books:[], lessons:[], series:[], attendance:[], teacherPayments:[], ...data };
  const students  = data.users.filter(u => u.role === "student");
  // Show sessions that are completed OR have attendance recorded
  const completed = data.sessions.filter(s => s.status === "completed" || Object.keys(s.attendance || {}).length > 0);

  const [view,        setView]        = useState("overview");
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterDate,  setFilterDate]  = useState("");
  const [search,      setSearch]      = useState("");
  const [focusStId,   setFocusStId]   = useState(null);
  const [focusSessId, setFocusSessId] = useState(null);

  const groupName   = gid => data.groups.find(g => g.id === gid)?.name  ?? "—";
  const teacherName = tid => data.users.find(u => u.id === tid)?.name   ?? "—";

  const filteredSessions = completed.filter(s => {
    if (teacherFilter && s.teacherId !== teacherFilter) return false;
    if (filterGroup !== "all" && String(s.groupId) !== String(filterGroup)) return false;
    if (filterDate  && s.date !== filterDate) return false;
    return true;
  });

  const studentStats = students.map(st => {
    const mySessions = filteredSessions.filter(s => st.id in (s.attendance ?? {}));
    const present    = mySessions.filter(s => s.attendance[st.id] === true).length;
    const absent     = mySessions.filter(s => s.attendance[st.id] === false).length;
    const rate       = mySessions.length ? Math.round(present / mySessions.length * 100) : null;
    const streak     = (() => {
      let n = 0;
      for (const s of [...mySessions].sort((a,b) => b.date.localeCompare(a.date))) {
        if (s.attendance[st.id] === true) n++; else break;
      }
      return n;
    })();
    const lastSeen = mySessions
      .filter(s => s.attendance[st.id] === true)
      .sort((a,b) => b.date.localeCompare(a.date))[0]?.date ?? null;
    return { ...st, mySessions, present, absent, rate, streak, lastSeen };
  });

  const filtered = studentStats.filter(st => {
    if (filterGroup !== "all" && st.groupId !== Number(filterGroup)) return false;
    if (search && !st.name.toLowerCase().includes(search.toLowerCase()))      return false;
    return true;
  }).sort((a,b) => (b.rate ?? -1) - (a.rate ?? -1));

  const totalPresent = filtered.reduce((a,s) => a + s.present, 0);
  const totalAbsent  = filtered.reduce((a,s) => a + s.absent,  0);
  const withRate     = filtered.filter(s => s.rate !== null);
  const avgRate      = withRate.length ? Math.round(withRate.reduce((a,s)=>a+s.rate,0)/withRate.length) : 0;
  const atRisk       = filtered.filter(s => s.rate !== null && s.rate < 70).length;

  const toggleAtt = async (sessId, stuId, val) => {
    // Optimistic local update - also mark session as completed so it shows in overview
    setData(d => ({
      ...d,
      sessions: d.sessions.map(s =>
        s.id === sessId
          ? { ...s, attendance: { ...s.attendance, [stuId]: val }, status: "completed" }
          : s
      )
    }));
    // Persist to backend
    try {
      await api.sessions.markStudent(sessId, stuId, val);
      // Ensure session status is completed
      const sess = (() => { let found = null; return found; })();
      // Mark session completed via API (idempotent)
      api.sessions.update(sessId, { status: "completed" }).catch(() => {});
    } catch(e) {
      console.error('Attendance save error:', e);
      toast('Failed to save attendance', 'error');
    }
  };

  const rc  = r => r === null ? "var(--text3)"            : r >= 80 ? "#22c55e"              : r >= 60 ? "#f59e0b"              : "#ef4444";
  const rbg = r => r === null ? "var(--bg3)"              : r >= 80 ? "rgba(34,197,94,.13)"  : r >= 60 ? "rgba(245,158,11,.13)" : "rgba(239,68,68,.13)";

  const focusSt   = focusStId   ? studentStats.find(s => s.id === focusStId)         : null;
  const focusSess = focusSessId ? filteredSessions.find(s => s.id === focusSessId)   : null;

  const TAB = ({ id, label }) => (
    <button className={"btn btn-sm " + (view===id ? "btn-pr" : "btn-se")}
      onClick={() => { setView(id); setFocusStId(null); setFocusSessId(null); }}>{label}</button>
  );

  return (
    <div>
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">✅ Attendance Center</div>
          <div className="ph-sub">Track, analyse and edit every student's attendance in real-time</div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="g4 mb16">
        {[
          { icon:"📋", label:"Completed Sessions", val:filteredSessions.length, c:"#f97316" },
          { icon:"✅", label:"Total Present",       val:totalPresent,            c:"#22c55e" },
          { icon:"❌", label:"Total Absent",         val:totalAbsent,             c:"#ef4444" },
          { icon:"⚠️", label:"At-Risk  (<70 %)",    val:atRisk,                  c:"#f59e0b" },
        ].map((k,i) => (
          <div key={i} className="card stat" style={{ borderColor:k.c+"33" }}>
            <div className="stat-glow" style={{ background:k.c }} />
            <div className="stat-icon">{k.icon}</div>
            <div className="stat-label">{k.label}</div>
            <div className="stat-val"  style={{ color:k.c }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="card mb16" style={{ padding:"14px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <input style={{ flex:1, minWidth:150 }} placeholder="🔍 Search student…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <select style={{ minWidth:155 }} value={filterGroup}
            onChange={e => { setFilterGroup(e.target.value); setFocusStId(null); setFocusSessId(null); }}>
            <option value="all">All Groups</option>
            {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <input type="date" style={{ minWidth:145 }} value={filterDate}
            onChange={e => setFilterDate(e.target.value)} />
          {filterDate && <button className="btn btn-se btn-sm" onClick={() => setFilterDate("")}>✕ Clear</button>}
          <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            <TAB id="overview" label="📊 Matrix"     />
            <TAB id="student"  label="👨‍🎓 Students"  />
            <TAB id="session"  label="📅 Sessions"   />
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          MATRIX VIEW
      ══════════════════════════════════════════ */}
      {view === "overview" && (() => {
        const cols = [...filteredSessions].sort((a,b) => a.date.localeCompare(b.date)).slice(-14);
        return (
          <div className="card" style={{ padding:0, overflow:"hidden" }}>
            <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border)",
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div className="sh-title">📊 Attendance Matrix  <span style={{ fontWeight:400, color:"var(--text3)", fontSize:12 }}>— last {cols.length} sessions</span></div>
              <span style={{ fontSize:12, color:"var(--text3)" }}>Avg: <strong style={{ color:rc(avgRate) }}>{avgRate}%</strong></span>
            </div>
            <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:"var(--bg3)" }}>
                    <th style={{ padding:"9px 14px", textAlign:"left", position:"sticky", left:0,
                      background:"var(--bg3)", zIndex:2, borderRight:"1px solid var(--border)", minWidth:170 }}>Student</th>
                    <th style={{ padding:"9px 8px", textAlign:"center", whiteSpace:"nowrap" }}>Rate</th>
                    <th style={{ padding:"9px 8px", textAlign:"center" }}>✅</th>
                    <th style={{ padding:"9px 8px", textAlign:"center" }}>❌</th>
                    <th style={{ padding:"9px 8px", textAlign:"center", whiteSpace:"nowrap" }}>🔥</th>
                    {cols.map(s => (
                      <th key={s.id} onClick={() => { setFocusSessId(s.id); setView("session"); }}
                        title={s.title + " — " + s.date}
                        style={{ padding:"5px 3px", textAlign:"center", minWidth:36, cursor:"pointer",
                          color:"var(--text3)", fontWeight:600 }}>
                        <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:.3 }}>{s.date.slice(5)}</div>
                        <div style={{ fontSize:9, opacity:.55, marginTop:1 }}>{s.title.slice(0,5)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(st => (
                    <tr key={st.id} style={{ borderTop:"1px solid var(--border)" }}>
                      <td style={{ padding:"9px 14px", position:"sticky", left:0, background:"var(--bg2)",
                        zIndex:1, borderRight:"1px solid var(--border)" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <Av name={st.name} sz="av-sm" />
                          <div>
                            <div className="fw7" style={{ fontSize:12, color:"var(--accent2)", cursor:"pointer" }}
                              onClick={() => { setFocusStId(st.id); setView("student"); }}>{st.name}</div>
                            <div style={{ fontSize:10, color:"var(--text3)" }}>{groupName(st.groupId)}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign:"center", padding:"9px 6px" }}>
                        {st.rate !== null
                          ? <span style={{ padding:"3px 8px", borderRadius:99, fontSize:11, fontWeight:700,
                              background:rbg(st.rate), color:rc(st.rate) }}>{st.rate}%</span>
                          : <span style={{ color:"var(--text3)" }}>—</span>}
                      </td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#22c55e" }}>{st.present}</td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#ef4444" }}>{st.absent}</td>
                      <td style={{ textAlign:"center", color:"var(--amber)", fontWeight:700 }}>
                        {st.streak > 0 ? "🔥"+st.streak : "—"}
                      </td>
                      {cols.map(s => {
                        const inSess = st.id in (s.attendance ?? {});
                        const val    = s.attendance?.[st.id];
                        return (
                          <td key={s.id} style={{ textAlign:"center", padding:"6px 2px" }}>
                            {!inSess
                              ? <span style={{ color:"var(--border2)", fontSize:14 }}>·</span>
                              : <button onClick={() => toggleAtt(s.id, st.id, !val)}
                                  title="Click to toggle"
                                  style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, padding:"1px 2px",
                                    borderRadius:4, transition:"transform .1s" }}
                                  onMouseOver={e => e.currentTarget.style.transform="scale(1.35)"}
                                  onMouseOut={e  => e.currentTarget.style.transform="scale(1)"}>
                                  {val ? "✅" : "❌"}
                                </button>
                            }
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div style={{ textAlign:"center", padding:"40px", color:"var(--text3)" }}>No students match filters</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════
          BY STUDENT VIEW
      ══════════════════════════════════════════ */}
      {view === "student" && !focusSt && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {filtered.map(st => (
            <div key={st.id} className="card" style={{ cursor:"pointer",
              borderColor: st.rate!==null && st.rate<70 ? "rgba(239,68,68,.3)" : "" }}
              onClick={() => setFocusStId(st.id)}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <Av name={st.name} sz="av-lg" />
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span className="fw7" style={{ fontSize:14 }}>{st.name}</span>
                    {st.rate !== null && st.rate < 70 &&
                      <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:99,
                        background:"rgba(239,68,68,.12)", color:"#ef4444", border:"1px solid rgba(239,68,68,.2)" }}>⚠ At-Risk</span>}
                    {st.streak >= 3 &&
                      <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:99,
                        background:"rgba(245,158,11,.12)", color:"var(--amber)", border:"1px solid rgba(245,158,11,.2)" }}>🔥 {st.streak} streak</span>}
                  </div>
                  <div style={{ fontSize:11, color:"var(--text3)", margin:"2px 0 8px" }}>
                    {groupName(st.groupId)} · Level {st.level} · {st.mySessions.length} sessions
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ flex:1, height:6, background:"var(--bg4)", borderRadius:99, overflow:"hidden" }}>
                      <div style={{ height:"100%", borderRadius:99, width:(st.rate??0)+"%", background:rc(st.rate), transition:"width .5s" }} />
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color:rc(st.rate), minWidth:34 }}>
                      {st.rate !== null ? st.rate+"%" : "—"}
                    </span>
                  </div>
                </div>
                <div style={{ display:"flex", gap:16, textAlign:"center", flexShrink:0 }}>
                  <div>
                    <div style={{ fontSize:22, fontWeight:800, color:"#22c55e", lineHeight:1 }}>{st.present}</div>
                    <div style={{ fontSize:9, color:"var(--text3)", textTransform:"uppercase", marginTop:2 }}>Present</div>
                  </div>
                  <div style={{ width:1, background:"var(--border)" }} />
                  <div>
                    <div style={{ fontSize:22, fontWeight:800, color:"#ef4444", lineHeight:1 }}>{st.absent}</div>
                    <div style={{ fontSize:9, color:"var(--text3)", textTransform:"uppercase", marginTop:2 }}>Absent</div>
                  </div>
                </div>
                <span style={{ color:"var(--accent2)", fontSize:20, marginLeft:4 }}>›</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 &&
            <div className="empty"><div className="empty-icon">👨‍🎓</div><div className="empty-title">No students found</div></div>}
        </div>
      )}

      {view === "student" && focusSt && (
        <div>
          <button className="btn btn-se btn-sm mb16" onClick={() => setFocusStId(null)}>← All Students</button>
          {/* Profile header */}
          <div className="card mb16" style={{ borderColor:rc(focusSt.rate)+"33" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:16, flexWrap:"wrap" }}>
              <Av name={focusSt.name} sz="av-xl" />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:20, fontWeight:900, letterSpacing:"-.4px" }}>{focusSt.name}</div>
                <div style={{ fontSize:12, color:"var(--text3)", marginTop:3 }}>
                  {focusSt.email} · {groupName(focusSt.groupId)} · Level {focusSt.level}
                  {focusSt.lastSeen && <span> · Last seen: <strong>{focusSt.lastSeen}</strong></span>}
                </div>
              </div>
              {focusSt.rate !== null && focusSt.rate < 70 &&
                <div style={{ textAlign:"center", padding:"10px 16px", borderRadius:12,
                  background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.2)" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#ef4444" }}>⚠ AT-RISK</div>
                  <div style={{ fontSize:10, color:"var(--text3)", marginTop:1 }}>Below 70 %</div>
                </div>}
            </div>
            <div className="g4 mb16">
              {[
                { label:"Rate",     val:focusSt.rate!==null ? focusSt.rate+"%" : "—",        c:rc(focusSt.rate) },
                { label:"Present",  val:focusSt.present,                                      c:"#22c55e"        },
                { label:"Absent",   val:focusSt.absent,                                       c:"#ef4444"        },
                { label:"Streak",   val:focusSt.streak>0 ? "🔥 "+focusSt.streak : "—",       c:"var(--amber)"   },
              ].map((x,i) => (
                <div key={i} className="card card-sm" style={{ textAlign:"center" }}>
                  <div style={{ fontSize:24, fontWeight:800, color:x.c }}>{x.val}</div>
                  <div style={{ fontSize:11, color:"var(--text3)", marginTop:4 }}>{x.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11, color:"var(--text3)", marginBottom:6, display:"flex", justifyContent:"space-between" }}>
              <span>Attendance progress</span>
              <span>{focusSt.present} / {focusSt.mySessions.length} sessions</span>
            </div>
            <div style={{ height:8, background:"var(--bg4)", borderRadius:99, overflow:"hidden" }}>
              <div style={{ height:"100%", borderRadius:99, width:(focusSt.rate??0)+"%",
                background:rc(focusSt.rate), transition:"width .6s" }} />
            </div>
          </div>
          {/* Session-by-session history */}
          <div className="card" style={{ padding:0 }}>
            <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div className="sh-title">📅 Session History ({focusSt.mySessions.length})</div>
              <span style={{ fontSize:11, color:"var(--text3)" }}>Click status to toggle</span>
            </div>
            {[...focusSt.mySessions].sort((a,b) => b.date.localeCompare(a.date)).map(s => {
              const present = s.attendance[focusSt.id];
              return (
                <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 18px",
                  borderBottom:"1px solid var(--border)",
                  background:present===true?"rgba(34,197,94,.03)":present===false?"rgba(239,68,68,.03)":"" }}>
                  <span style={{ fontSize:22, cursor:"pointer", flexShrink:0, transition:"transform .15s" }}
                    title="Click to toggle"
                    onClick={() => toggleAtt(s.id, focusSt.id, !present)}
                    onMouseOver={e=>e.currentTarget.style.transform="scale(1.25)"}
                    onMouseOut={e =>e.currentTarget.style.transform="scale(1)"}>
                    {present===true?"✅":present===false?"❌":"⬜"}
                  </span>
                  <div style={{ flex:1 }}>
                    <div className="fw7" style={{ fontSize:13 }}>{s.title}</div>
                    <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>
                      {s.date} · {s.time} – {s.endTime} · {groupName(s.groupId)}
                    </div>
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:99, flexShrink:0,
                    background:present===true?"rgba(34,197,94,.13)":present===false?"rgba(239,68,68,.13)":"var(--bg3)",
                    color:present===true?"#22c55e":present===false?"#ef4444":"var(--text3)" }}>
                    {present===true?"Present":present===false?"Absent":"—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          BY SESSION VIEW — roll call
      ══════════════════════════════════════════ */}
      {view === "session" && !focusSess && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {[...filteredSessions].sort((a,b) => b.date.localeCompare(a.date)).map(s => {
            const att      = s.attendance ?? {};
            const enrolled = Object.keys(att).length;
            const present  = Object.values(att).filter(v=>v===true).length;
            const absent   = Object.values(att).filter(v=>v===false).length;
            const rate     = enrolled ? Math.round(present/enrolled*100) : null;
            return (
              <div key={s.id} className="card" style={{ cursor:"pointer" }} onClick={() => setFocusSessId(s.id)}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:"var(--glow)",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>📅</div>
                  <div style={{ flex:1 }}>
                    <div className="fw7" style={{ fontSize:14 }}>{s.title}</div>
                    <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>
                      {s.date} · {s.time} · {groupName(s.groupId)} · {teacherName(s.teacherId)}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:12, textAlign:"center", flexShrink:0 }}>
                    <div><div style={{ fontWeight:800, color:"#22c55e" }}>{present}</div><div style={{ fontSize:9, color:"var(--text3)" }}>Present</div></div>
                    <div><div style={{ fontWeight:800, color:"#ef4444" }}>{absent}</div><div style={{ fontSize:9, color:"var(--text3)" }}>Absent</div></div>
                    {rate !== null &&
                      <div style={{ padding:"5px 12px", borderRadius:9, background:rbg(rate) }}>
                        <div style={{ fontWeight:800, color:rc(rate), fontSize:15 }}>{rate}%</div>
                        <div style={{ fontSize:9, color:"var(--text3)" }}>Rate</div>
                      </div>}
                  </div>
                  <span style={{ color:"var(--accent2)", fontSize:20 }}>›</span>
                </div>
              </div>
            );
          })}
          {filteredSessions.length === 0 &&
            <div className="empty"><div className="empty-icon">📅</div><div className="empty-title">No completed sessions</div></div>}
        </div>
      )}

      {view === "session" && focusSess && (() => {
        const att      = focusSess.attendance ?? {};
        const enrolled = Object.keys(att).length;
        const present  = Object.values(att).filter(v=>v===true).length;
        const absent   = enrolled - present;
        const rate     = enrolled ? Math.round(present/enrolled*100) : null;
        return (
          <div>
            <button className="btn btn-se btn-sm mb16" onClick={() => setFocusSessId(null)}>← All Sessions</button>
            {/* Session header */}
            <div className="card mb16">
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                <div style={{ width:52, height:52, borderRadius:14, background:"var(--glow)",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>📅</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:18, fontWeight:900 }}>{focusSess.title}</div>
                  <div style={{ fontSize:12, color:"var(--text3)", marginTop:3 }}>
                    {focusSess.date} · {focusSess.time} – {focusSess.endTime} · {groupName(focusSess.groupId)} · {teacherName(focusSess.teacherId)}
                  </div>
                </div>
              </div>
              <div className="g4">
                {[
                  { label:"Enrolled", val:enrolled, c:"var(--text)"  },
                  { label:"Present",  val:present,  c:"#22c55e"      },
                  { label:"Absent",   val:absent,   c:"#ef4444"      },
                  { label:"Rate",     val:rate!==null?rate+"%":"—", c:rc(rate) },
                ].map((x,i) => (
                  <div key={i} className="card card-sm" style={{ textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:x.c }}>{x.val}</div>
                    <div style={{ fontSize:11, color:"var(--text3)", marginTop:4 }}>{x.label}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Roll call */}
            <div className="card" style={{ padding:0 }}>
              <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div className="sh-title">📋 Roll Call  <span style={{ fontWeight:400, color:"var(--text3)", fontSize:12 }}>— {enrolled} students</span></div>
                <span style={{ fontSize:11, color:"var(--text3)" }}>Click to toggle</span>
              </div>
              {Object.entries(att)
                .sort(([,a],[,b]) => (b===true?1:0)-(a===true?1:0))
                .map(([stuId, isPresent]) => {
                  const st = data.users.find(u => u.id === stuId);
                  if (!st) return null;
                  return (
                    <div key={stuId} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 18px",
                      borderBottom:"1px solid var(--border)",
                      background:isPresent?"rgba(34,197,94,.03)":"rgba(239,68,68,.03)" }}>
                      <Av name={st.name} sz="av-md" />
                      <div style={{ flex:1 }}>
                        <div className="fw7" style={{ fontSize:13 }}>{st.name}</div>
                        <div style={{ fontSize:11, color:"var(--text3)" }}>Level {st.level} · {groupName(st.groupId)}</div>
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={() => toggleAtt(focusSess.id, stuId, true)}
                          style={{ padding:"7px 16px", borderRadius:8, border:"2px solid",
                            borderColor:isPresent===true?"#22c55e":"var(--border2)",
                            background:isPresent===true?"rgba(34,197,94,.15)":"var(--bg3)",
                            color:isPresent===true?"#22c55e":"var(--text3)",
                            fontWeight:700, fontSize:12, cursor:"pointer", transition:"all .15s", fontFamily:"var(--font)" }}>
                          ✅ Present
                        </button>
                        <button onClick={() => toggleAtt(focusSess.id, stuId, false)}
                          style={{ padding:"7px 16px", borderRadius:8, border:"2px solid",
                            borderColor:isPresent===false?"#ef4444":"var(--border2)",
                            background:isPresent===false?"rgba(239,68,68,.15)":"var(--bg3)",
                            color:isPresent===false?"#ef4444":"var(--text3)",
                            fontWeight:700, fontSize:12, cursor:"pointer", transition:"all .15s", fontFamily:"var(--font)" }}>
                          ❌ Absent
                        </button>
                      </div>
                    </div>
                  );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// ─── GAMES PAGE ───────────────────────────────────────────────────────────────
const QUIZ_DATA = [
  {
    id: "grammar", title: "Grammar Challenge", icon: "📝",
    description: "Tenses, articles, prepositions, passive voice and more.",
    difficulty: "Medium", color: "#f97316",
    questions: [
      { q: "She ___ to school every day.", opts: ["go","goes","going","gone"], a: 1 },
      { q: "They ___ playing football when it started to rain.", opts: ["were","was","are","be"], a: 0 },
      { q: "I have ___ my homework.", opts: ["did","do","done","doing"], a: 2 },
      { q: "He ___ lived here for ten years.", opts: ["have","has","had","is"], a: 1 },
      { q: "She is ___ than her sister.", opts: ["tall","taller","tallest","most tall"], a: 1 },
      { q: "Which sentence is correct?", opts: ["He don't like it.","He doesn't likes it.","He doesn't like it.","He not like it."], a: 2 },
      { q: "I will call you ___ I arrive.", opts: ["until","when","while","during"], a: 1 },
      { q: "The book ___ on the table.", opts: ["is","are","were","been"], a: 0 },
      { q: "Neither Tom nor his friends ___ invited.", opts: ["was","were","is","are"], a: 1 },
      { q: "She ___ be tired after such a long day.", opts: ["must","might","shall","need"], a: 0 },
      { q: "We ___ finish before noon.", opts: ["had better","better had","have better","best"], a: 0 },
      { q: "___ you mind opening the window?", opts: ["Do","Will","Would","Shall"], a: 2 },
      { q: "The passive of 'They built the bridge' is:", opts: ["The bridge was built.","The bridge is built.","The bridge has built.","The bridge built."], a: 0 },
      { q: "If I ___ you, I'd apologise.", opts: ["am","was","were","be"], a: 2 },
      { q: "She asked me ___ I was happy.", opts: ["that","if","what","how"], a: 1 },
      { q: "By tomorrow I ___ finished the project.", opts: ["will have","will be","would have","have"], a: 0 },
      { q: "He ___ here since Monday.", opts: ["is","was","has been","had been"], a: 2 },
      { q: "Choose the correct article: ___ university.", opts: ["a","an","the","no article"], a: 0 },
      { q: "She ran ___ than anyone in the class.", opts: ["more fast","fastest","faster","most fast"], a: 2 },
      { q: "I wish I ___ speak French fluently.", opts: ["can","could","would","shall"], a: 1 },
      { q: "The report must ___ submitted by Friday.", opts: ["be","is","being","been"], a: 0 },
      { q: "We ___ to the cinema last night.", opts: ["go","went","gone","goes"], a: 1 },
      { q: "She ___ working here for five years next month.", opts: ["will have been","has been","will be","is"], a: 0 },
      { q: "He's good ___ tennis.", opts: ["in","at","on","for"], a: 1 },
      { q: "The children ___ asleep by 8 pm.", opts: ["fallen","fell","had fallen","has fallen"], a: 2 },
    ],
  },
  {
    id: "vocabulary", title: "Vocabulary Booster", icon: "📖",
    description: "Synonyms, antonyms, definitions and word usage in context.",
    difficulty: "Easy", color: "#22c55e",
    questions: [
      { q: "What is a synonym for 'happy'?", opts: ["Sad","Joyful","Angry","Tired"], a: 1 },
      { q: "What does 'benevolent' mean?", opts: ["Evil","Kind","Angry","Confused"], a: 1 },
      { q: "Choose the antonym of 'ancient':", opts: ["Old","Modern","Wise","Huge"], a: 1 },
      { q: "What does 'eloquent' mean?", opts: ["Silent","Clumsy","Well-spoken","Angry"], a: 2 },
      { q: "'Abundant' means:", opts: ["Scarce","Plentiful","Small","Hidden"], a: 1 },
      { q: "A word meaning 'to make larger':", opts: ["Shrink","Amplify","Diminish","Reduce"], a: 1 },
      { q: "What does 'melancholy' mean?", opts: ["Happy","Excited","Sad","Energetic"], a: 2 },
      { q: "'Tenacious' means:", opts: ["Giving up easily","Persistent","Lazy","Confused"], a: 1 },
      { q: "What is the meaning of 'obscure'?", opts: ["Clear","Bright","Not well-known","Loud"], a: 2 },
      { q: "Synonym for 'begin':", opts: ["Finish","Commence","Stop","Delay"], a: 1 },
      { q: "What does 'frugal' mean?", opts: ["Generous","Spendthrift","Economical","Wasteful"], a: 2 },
      { q: "'Ambiguous' means:", opts: ["Clear","Uncertain in meaning","Obvious","Simple"], a: 1 },
      { q: "What does 'vivid' mean?", opts: ["Dull","Bright and clear","Dark","Quiet"], a: 1 },
      { q: "A synonym for 'difficult' is:", opts: ["Easy","Simple","Challenging","Quick"], a: 2 },
      { q: "What does 'lethargic' mean?", opts: ["Energetic","Slow and tired","Happy","Sharp"], a: 1 },
      { q: "'Concise' means:", opts: ["Long-winded","Brief and clear","Confusing","Detailed"], a: 1 },
      { q: "Antonym of 'generous':", opts: ["Kind","Stingy","Humble","Brave"], a: 1 },
      { q: "What does 'persist' mean?", opts: ["Give up","Continue firmly","Stop","Avoid"], a: 1 },
      { q: "A word meaning 'to copy illegally':", opts: ["Publish","Share","Plagiarise","Create"], a: 2 },
      { q: "'Eminent' means:", opts: ["Unknown","Distinguished","Ordinary","Simple"], a: 1 },
      { q: "What does 'immense' mean?", opts: ["Tiny","Very large","Average","Normal"], a: 1 },
      { q: "Synonym for 'fast':", opts: ["Slow","Rapid","Steady","Late"], a: 1 },
      { q: "What is the meaning of 'transparent'?", opts: ["Opaque","Clear","Colourful","Solid"], a: 1 },
      { q: "'Serene' means:", opts: ["Noisy","Calm and peaceful","Excited","Confused"], a: 1 },
      { q: "Antonym of 'temporary':", opts: ["Short","Brief","Permanent","Quick"], a: 2 },
    ],
  },
  {
    id: "tenses", title: "Tenses Mastery", icon: "⏰",
    description: "Master all 12 English tenses with real sentence practice.",
    difficulty: "Hard", color: "#8b5cf6",
    questions: [
      { q: "I ___ breakfast every morning. (Simple Present)", opts: ["ate","eating","eat","have eaten"], a: 2 },
      { q: "She ___ a letter right now. (Present Continuous)", opts: ["write","wrote","is writing","has written"], a: 2 },
      { q: "They ___ the test. (Present Perfect)", opts: ["finish","finished","have finished","finishing"], a: 2 },
      { q: "He ___ for three hours. (Present Perfect Continuous)", opts: ["has been studying","is studying","studied","studies"], a: 0 },
      { q: "We ___ to Paris last year. (Simple Past)", opts: ["go","gone","went","goes"], a: 2 },
      { q: "I ___ when you called. (Past Continuous)", opts: ["read","was reading","have read","reads"], a: 1 },
      { q: "By the time she arrived, we ___. (Past Perfect)", opts: ["left","had left","have left","leaving"], a: 1 },
      { q: "He ___ all day before the meeting. (Past Perfect Continuous)", opts: ["worked","was working","had been working","has worked"], a: 2 },
      { q: "It ___ tomorrow. (Simple Future)", opts: ["rained","rains","will rain","raining"], a: 2 },
      { q: "I ___ at this time tomorrow. (Future Continuous)", opts: ["study","will be studying","studied","am studying"], a: 1 },
      { q: "By Friday, she ___ the report. (Future Perfect)", opts: ["completes","will complete","will have completed","completing"], a: 2 },
      { q: "By next year, I ___ here for a decade. (Future Perfect Continuous)", opts: ["will live","will be living","will have been living","live"], a: 2 },
      { q: "'He is always losing his keys.' Which tense is this?", opts: ["Simple Present","Present Continuous","Present Perfect","Past Simple"], a: 1 },
      { q: "They ___ yet.", opts: ["haven't finished","didn't finish","don't finish","aren't finishing"], a: 0 },
      { q: "'She had already eaten when he arrived.' What tense is used?", opts: ["Past Simple","Past Perfect","Past Continuous","Past Perfect Continuous"], a: 1 },
      { q: "Which sentence uses habitual past?", opts: ["He used to play cricket.","He plays cricket.","He had played cricket.","He is playing cricket."], a: 0 },
      { q: "I ___ never visited Canada. (Present Perfect)", opts: ["never visited","have never visited","never visit","had never visited"], a: 1 },
      { q: "The plane ___ at 6pm. (scheduled future)", opts: ["leaves","will leave","is leaving","left"], a: 0 },
      { q: "She said she ___ come. (Reported speech)", opts: ["will","would","shall","can"], a: 1 },
      { q: "I ___ since 9am.", opts: ["play","played","have been playing","am playing"], a: 2 },
      { q: "They ___ when the boss arrived. (Past Continuous)", opts: ["discussed","were discussing","have discussed","discuss"], a: 1 },
      { q: "Present Perfect is used for:", opts: ["Completed past at known time","Recent past with present relevance","Future plans","Habits"], a: 1 },
      { q: "I ___ by the time you get back. (Future Perfect)", opts: ["finish","finished","will have finished","am finishing"], a: 2 },
      { q: "She ___ English since she was ten.", opts: ["studied","studies","has been studying","was studying"], a: 2 },
      { q: "If you heat water to 100°C, it ___.", opts: ["boiled","boils","would boil","will boil"], a: 1 },
    ],
  },
  {
    id: "reading", title: "Reading Speed Test", icon: "⚡",
    description: "Test comprehension, inference and vocabulary in context.",
    difficulty: "Medium", color: "#3b82f6",
    questions: [
      { q: "If something is 'paramount', it is:", opts: ["Unimportant","Extremely important","Hidden","Ordinary"], a: 1 },
      { q: "'The economy flourished.' What does 'flourished' mean?", opts: ["Declined","Remained stable","Thrived","Collapsed"], a: 2 },
      { q: "What is the main purpose of a topic sentence?", opts: ["Conclude a paragraph","Introduce the main idea","Provide evidence","Summarise the essay"], a: 1 },
      { q: "An 'analogy' is used to:", opts: ["Contradict an idea","Compare two things to explain one","List facts","Ask a question"], a: 1 },
      { q: "'Consequently' signals:", opts: ["Contrast","Addition","A result or effect","Time"], a: 2 },
      { q: "To 'infer' from a text means to:", opts: ["Read directly","Conclude from clues","Copy it","Ignore it"], a: 1 },
      { q: "'She persevered.' What does 'persevered' mean?", opts: ["Gave up","Continued despite difficulty","Complained","Quit"], a: 1 },
      { q: "Which strategy helps understand difficult vocabulary?", opts: ["Skip the word","Look for context clues","Re-read randomly","Guess randomly"], a: 1 },
      { q: "'Nevertheless' is used to show:", opts: ["A result","A contrast","An addition","A reason"], a: 1 },
      { q: "Skimming a text means:", opts: ["Reading every word","Reading for specific info","Getting the general idea quickly","Reading aloud"], a: 2 },
      { q: "What does 'author's purpose' mean?", opts: ["The title","Why the author wrote it","The length","The characters"], a: 1 },
      { q: "A 'persuasive' text aims to:", opts: ["Entertain","Convince readers of a viewpoint","Describe neutrally","Teach a skill"], a: 1 },
      { q: "'Context' in reading refers to:", opts: ["Font size","Surrounding words that explain meaning","Chapter number","Bibliography"], a: 1 },
      { q: "An 'implicit' idea in a text is:", opts: ["Directly stated","Hidden and suggested","Irrelevant","Contradicted"], a: 1 },
      { q: "'Unprecedented findings' means the findings were:", opts: ["Expected","Never seen before","Disproven","Published"], a: 1 },
      { q: "Scanning is used to:", opts: ["Understand the big picture","Find specific info quickly","Analyse tone","Check grammar"], a: 1 },
      { q: "Which connective shows cause-and-effect?", opts: ["However","Moreover","Therefore","Meanwhile"], a: 2 },
      { q: "A text using 'devastating' and 'tragic' has a ___ tone.", opts: ["Humorous","Formal","Sombre","Optimistic"], a: 2 },
      { q: "A 'biased' passage:", opts: ["Presents both sides equally","Favours one side unfairly","Avoids opinions","Is fictional"], a: 1 },
      { q: "The main idea of a paragraph is found in its:", opts: ["Concluding sentence","Topic sentence","Middle sentence","First word"], a: 1 },
      { q: "'Redundant' in writing means:", opts: ["Essential","Unnecessarily repeated","New information","Technical"], a: 1 },
      { q: "'Far-reaching implications' — 'implications' means:", opts: ["Solutions","Consequences","Costs","Explanations"], a: 1 },
      { q: "Making notes while reading is called:", opts: ["Speed reading","Skimming","Annotating","Scanning"], a: 2 },
      { q: "'As quiet as mice' is an example of:", opts: ["Metaphor","Simile","Alliteration","Hyperbole"], a: 1 },
      { q: "An 'objective' text:", opts: ["Shows opinions","States facts without bias","Uses emotional language","Exaggerates"], a: 1 },
    ],
  },
  {
    id: "mixed", title: "Mixed English Test", icon: "🌟",
    description: "Grammar, vocabulary, punctuation and language skills combined.",
    difficulty: "Hard", color: "#ec4899",
    questions: [
      { q: "Choose the correctly punctuated sentence:", opts: ["Its a sunny day","It's a sunny day","Its' a sunny day","It is a sunny, day"], a: 1 },
      { q: "Which word is a conjunction?", opts: ["Quickly","Beautiful","Although","Run"], a: 2 },
      { q: "She works ___ a nurse.", opts: ["like","as","for","by"], a: 1 },
      { q: "What type of noun is 'happiness'?", opts: ["Proper noun","Abstract noun","Concrete noun","Collective noun"], a: 1 },
      { q: "'Running is good exercise' — 'Running' is a:", opts: ["Gerund","Infinitive","Participle","Adjective"], a: 0 },
      { q: "Which word is spelled correctly?", opts: ["Accomodate","Accommodate","Acommodate","Acomodate"], a: 1 },
      { q: "I ___ rather stay home than go out.", opts: ["would","will","shall","should"], a: 0 },
      { q: "Which uses the Oxford comma correctly?", opts: ["I need eggs milk and butter.","I need eggs, milk and butter.","I need eggs, milk, and butter.","I need eggs; milk and butter."], a: 2 },
      { q: "What is the plural of 'criterion'?", opts: ["Criterions","Criteria","Criterias","Criterion"], a: 1 },
      { q: "Which is direct speech?", opts: ["He said he was tired.","She asked whether I was okay.","\"I'm hungry,\" he said.","They told us to wait."], a: 2 },
      { q: "He is the ___ player on the team.", opts: ["more good","gooder","best","better"], a: 2 },
      { q: "Which word is an adverb?", opts: ["Happy","Happiness","Happily","Happier"], a: 2 },
      { q: "Identify the subordinate clause: 'She cried because she was sad.'", opts: ["She cried","because she was sad","She","was sad"], a: 1 },
      { q: "'I can't stomach his arrogance.' 'Stomach' is used as:", opts: ["Noun","Adjective","Verb","Adverb"], a: 2 },
      { q: "Which is passive voice?", opts: ["The dog chased the cat.","The cake was eaten by Tom.","She wrote the report.","They fixed the car."], a: 1 },
      { q: "A clause differs from a phrase because it:", opts: ["Has only nouns","Contains a subject and verb","Is always short","Never has a verb"], a: 1 },
      { q: "The prefix 'mis-' means:", opts: ["Before","Wrongly","Again","Not"], a: 1 },
      { q: "He apologised ___ being rude.", opts: ["for","of","about","on"], a: 0 },
      { q: "Which is a compound sentence?", opts: ["She ran.","Although it rained, we went out.","I like tea and she likes coffee.","Running fast is hard."], a: 2 },
      { q: "Which is spelled correctly?", opts: ["Recieve","Recieve","Receive","Recive"], a: 2 },
      { q: "Correct semicolon use:", opts: ["I love Paris; it's beautiful.","I love; Paris it's beautiful.","I love Paris it's; beautiful.","I love Paris; it's; beautiful."], a: 0 },
      { q: "Which is a correct homophone trio?", opts: ["Their / There / They're","Their / There / Theyre","There / Their / Thier","They're / Their / Theres"], a: 0 },
      { q: "An apostrophe in 'Sarah's book' shows:", opts: ["Contraction","Possession","Plural","Quotation"], a: 1 },
      { q: "Best word for a formal email: 'I am writing to ___ about your services.'", opts: ["ask","enquire","question","wonder"], a: 1 },
      { q: "Which tense is used for a scheduled future event?", opts: ["Future perfect","Present simple","Past simple","Past perfect"], a: 1 },
    ],
  },
];

const DIFF_COLOR = { Easy: "#22c55e", Medium: "#f59e0b", Hard: "#ef4444" };

const GAMES_CSS = `
  @keyframes confettiFall {
    0%   { transform: translateY(-10px) rotate(0deg);   opacity: 1; }
    100% { transform: translateY(105vh) rotate(600deg); opacity: 0; }
  }
  @keyframes bounceIn {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.08); }
    80%  { transform: scale(0.96); }
    100% { transform: scale(1);   opacity: 1; }
  }
  @keyframes slideUpFade {
    from { transform: translateY(22px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  @keyframes trophySpin {
    0%,100% { transform: translateY(0)   rotate(0deg)   scale(1);    }
    25%     { transform: translateY(-18px) rotate(-8deg) scale(1.12); }
    75%     { transform: translateY(-9px)  rotate(6deg)  scale(1.06); }
  }
  @keyframes bannerPop {
    0%   { transform: scaleX(0); opacity: 0; }
    60%  { transform: scaleX(1.04); }
    100% { transform: scaleX(1); opacity: 1; }
  }
  @keyframes cardHover { to { transform: translateY(-4px); } }
  .gcard          { transition: transform .2s, box-shadow .2s; cursor: default; }
  .gcard:hover    { transform: translateY(-4px); box-shadow: 0 14px 36px rgba(0,0,0,.13); }
  .opt-btn        { width:100%; text-align:left; padding:13px 16px; border-radius:10px;
                    border:2px solid var(--border); background:var(--bg2); color:var(--text);
                    cursor:pointer; font-size:14px; transition:all .14s;
                    margin-bottom:9px; display:flex; align-items:center; gap:11px; }
  .opt-btn:hover:not(:disabled) { border-color:var(--accent); background:var(--glow); }
  .opt-btn.opt-correct { border-color:#22c55e; background:rgba(34,197,94,.13); color:#15803d; font-weight:700; }
  .opt-btn.opt-wrong   { border-color:#ef4444; background:rgba(239,68,68,.10); color:#b91c1c; }
  .gbar        { height:7px; background:var(--border); border-radius:99px; overflow:hidden; margin-bottom:18px; }
  .gbar-fill   { height:100%; border-radius:99px; transition:width .45s cubic-bezier(.4,0,.2,1); }
`;

function ConfettiRain() {
  const cols = ["#f97316","#fb923c","#fbbf24","#22c55e","#3b82f6","#8b5cf6","#ec4899","#ef4444","#fff"];
  const pieces = Array.from({ length: 72 }, (_, i) => ({
    id: i, x: Math.random() * 100,
    delay: Math.random() * 2.4, dur: 2.2 + Math.random() * 1.8,
    color: cols[i % cols.length], w: 7 + Math.random() * 9,
    h: 9 + Math.random() * 7, rot: Math.random() * 360,
    circle: Math.random() > 0.55,
  }));
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9999, overflow:"hidden" }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position:"absolute", left:`${p.x}%`, top:"-20px",
          width:p.w, height:p.circle ? p.w : p.h,
          background:p.color, borderRadius: p.circle ? "50%" : "2px",
          transform:`rotate(${p.rot}deg)`,
          animation:`confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,
        }} />
      ))}
    </div>
  );
}

function GamesPage({ user, data, setData }) {
  data = { users:[], groups:[], sessions:[], payments:[], books:[], lessons:[], series:[], teacherPayments:[], attendance:[], gameScores:[], ...data };
  const [quiz,     setQuiz]     = useState(null);   // active quiz object
  const [qIdx,     setQIdx]     = useState(0);
  const [selected, setSelected] = useState(null);   // chosen option index
  const [answers,  setAnswers]  = useState([]);     // array of chosen indices
  const [phase,    setPhase]    = useState("cards");// cards | quiz | result
  const [confetti, setConfetti] = useState(false);

  const scores   = data.gameScores ?? [];
  const myScores = scores.filter(s => s.userId === user.id);
  const bestFor  = (qid) => {
    const s = myScores.filter(s => s.quizId === qid);
    return s.length ? Math.max(...s.map(s => s.pct)) : null;
  };

  /* ── Start ── */
  const startQuiz = (q) => {
    setQuiz(q); setQIdx(0); setSelected(null); setAnswers([]); setPhase("quiz"); setConfetti(false);
  };

  /* ── Select option ── */
  const pick = (idx) => { if (selected !== null) return; setSelected(idx); };

  /* ── Next / Finish ── */
  const advance = () => {
    const newAnswers = [...answers, selected];
    if (qIdx < quiz.questions.length - 1) {
      setAnswers(newAnswers); setQIdx(i => i + 1); setSelected(null);
    } else {
      const correct = newAnswers.filter((a, i) => a === quiz.questions[i].a).length;
      const pct     = Math.round((correct / quiz.questions.length) * 100);
      setData(d => ({
        ...d,
        gameScores: [...(d.gameScores ?? []), {
          id: Date.now(), userId: user.id, quizId: quiz.id,
          correct, total: quiz.questions.length, pct,
          date: new Date().toISOString().split("T")[0],
        }],
      }));
      setAnswers(newAnswers); setPhase("result");
      if (pct >= 80) { setConfetti(true); setTimeout(() => setConfetti(false), 5500); }
    }
  };

  /* ── Derived result values ── */
  const totalQ   = quiz?.questions.length ?? 25;
  const correct  = answers.filter((a, i) => a === quiz?.questions[i]?.a).length;
  const finalPct = Math.round((correct / totalQ) * 100);
  const perf     = finalPct >= 85 ? { label:"Excellent! 🏆",       col:"#22c55e" }
                 : finalPct >= 70 ? { label:"Very Good! 🎯",        col:"#3b82f6" }
                 : finalPct >= 50 ? { label:"Good! 👍",             col:"#f59e0b" }
                 :                  { label:"Keep Practicing! 💪",  col:"#f97316" };

  return (
    <div>
      <style>{GAMES_CSS}</style>
      {confetti && <ConfettiRain />}

      {/* ════════════ CARDS ════════════ */}
      {phase === "cards" && (
        <>
          <div className="ph">
            <div>
              <div className="ph-title">🎮 Games</div>
              <div className="ph-sub">Practice English through 5 quizzes — 25 questions each</div>
            </div>
          </div>
          <div className="g2" style={{ marginTop:8 }}>
            {QUIZ_DATA.map((q, i) => {
              const best = bestFor(q.id);
              return (
                <div key={q.id} className="card gcard"
                  style={{ borderLeft:`4px solid ${q.color}`, animation:`slideUpFade .4s ${i*.09}s both` }}>
                  <div className="flex ac gap12 mb12">
                    <div style={{ width:54, height:54, borderRadius:14, flexShrink:0,
                      background:`${q.color}1a`, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:28 }}>{q.icon}</div>
                    <div style={{ flex:1 }}>
                      <div className="fw8" style={{ fontSize:15 }}>{q.title}</div>
                      <div className="text-xs mt4" style={{ color:"var(--text3)", lineHeight:1.5 }}>{q.description}</div>
                    </div>
                  </div>

                  <div className="flex ac jb mb12">
                    <span style={{ fontSize:11, fontWeight:700,
                      color:DIFF_COLOR[q.difficulty],
                      background:`${DIFF_COLOR[q.difficulty]}18`,
                      padding:"3px 10px", borderRadius:99 }}>{q.difficulty}</span>
                    <span className="text-xs muted">25 questions · MCQ</span>
                  </div>

                  {best !== null && (
                    <div className="flex ac gap8 mb12"
                      style={{ background:"var(--bg3)", borderRadius:9, padding:"8px 12px" }}>
                      <span>🏅</span>
                      <span className="text-xs fw7">Best Score</span>
                      <span className="mono fw8" style={{
                        marginLeft:"auto", fontSize:14,
                        color: best >= 80 ? "#22c55e" : best >= 50 ? "#f59e0b" : "#ef4444",
                      }}>{best}%</span>
                    </div>
                  )}

                  <button className="btn btn-pr w100"
                    style={{ justifyContent:"center", background:q.color,
                      boxShadow:`0 4px 18px ${q.color}40` }}
                    onClick={() => startQuiz(q)}>
                    {best !== null ? "🔄 Retry Quiz" : "▶ Start Quiz"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ════════════ QUIZ ════════════ */}
      {phase === "quiz" && quiz && (() => {
        const q    = quiz.questions[qIdx];
        const prog = ((qIdx + 1) / quiz.questions.length) * 100;
        return (
          <div style={{ maxWidth:660, margin:"0 auto", animation:"slideUpFade .3s" }}>

            {/* Top bar */}
            <div className="flex ac jb mb14">
              <div className="flex ac gap10">
                <span style={{ fontSize:22 }}>{quiz.icon}</span>
                <div>
                  <div className="fw7" style={{ fontSize:14 }}>{quiz.title}</div>
                  <div className="text-xs muted">Question {qIdx+1} of {quiz.questions.length}</div>
                </div>
              </div>
              <button className="btn btn-se btn-sm" onClick={() => setPhase("cards")}>✕ Exit</button>
            </div>

            {/* Progress bar */}
            <div className="gbar">
              <div className="gbar-fill"
                style={{ width:`${prog}%`, background:`linear-gradient(90deg,${quiz.color},${quiz.color}99)` }} />
            </div>

            {/* Question */}
            <div className="card mb14"
              style={{ borderLeft:`4px solid ${quiz.color}`, padding:"20px 20px 16px" }}>
              <div style={{ fontSize:11, fontWeight:700, color:quiz.color,
                textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>
                Q{qIdx+1}
              </div>
              <div style={{ fontSize:15, fontWeight:700, lineHeight:1.55 }}>{q.q}</div>
            </div>

            {/* Options */}
            <div>
              {q.opts.map((opt, idx) => {
                let cls = "opt-btn";
                if (selected !== null) {
                  if (idx === q.a)                       cls += " opt-correct";
                  else if (idx === selected && idx !== q.a) cls += " opt-wrong";
                }
                const bg = selected !== null && idx === q.a ? "#22c55e"
                         : selected === idx && idx !== q.a ? "#ef4444"
                         : "var(--bg3)";
                return (
                  <button key={idx} className={cls}
                    disabled={selected !== null} onClick={() => pick(idx)}>
                    <span style={{ width:26, height:26, borderRadius:"50%",
                      background:bg, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:11, fontWeight:800, flexShrink:0,
                      color: (selected !== null && (idx === q.a || idx === selected)) ? "#fff" : "var(--text3)",
                    }}>{String.fromCharCode(65+idx)}</span>
                    {opt}
                  </button>
                );
              })}
            </div>

            {/* Feedback + Next */}
            {selected !== null && (
              <div style={{ animation:"slideUpFade .25s" }}>
                <div className="flex ac gap8 mt2 mb12"
                  style={{ background: selected===q.a ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
                    borderRadius:10, padding:"11px 14px" }}>
                  <span style={{ fontSize:18 }}>{selected===q.a ? "✅" : "❌"}</span>
                  <span style={{ fontSize:13, fontWeight:600,
                    color: selected===q.a ? "#15803d" : "#b91c1c" }}>
                    {selected===q.a ? "Correct!" : `Incorrect — Answer: ${q.opts[q.a]}`}
                  </span>
                </div>
                <button className="btn btn-pr w100"
                  style={{ justifyContent:"center", background:quiz.color }}
                  onClick={advance}>
                  {qIdx < quiz.questions.length-1 ? "Next Question →" : "See My Results 🎉"}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ════════════ RESULT ════════════ */}
      {phase === "result" && quiz && (
        <div style={{ maxWidth:520, margin:"0 auto", textAlign:"center" }}>

          {/* Trophy / emoji */}
          <div style={{ fontSize:78, lineHeight:1, marginBottom:8,
            animation: finalPct >= 80 ? "trophySpin 1.4s ease-in-out infinite" : "bounceIn .7s" }}>
            {finalPct >= 80 ? "🏆" : "📊"}
          </div>

          {/* Great Job banner */}
          {finalPct >= 80 && (
            <div style={{ display:"inline-block", marginBottom:18,
              background:"linear-gradient(135deg,#f97316,#fb923c)",
              color:"#fff", fontWeight:800, fontSize:18,
              padding:"10px 32px", borderRadius:99,
              boxShadow:"0 4px 24px rgba(249,115,22,.45)",
              animation:"bannerPop .5s .1s cubic-bezier(.34,1.56,.64,1) both",
              transformOrigin:"center",
            }}>🎉 Great Job!</div>
          )}

          <div className="card" style={{ padding:28, marginTop: finalPct >= 80 ? 0 : 16, animation:"bounceIn .6s .15s both" }}>
            <div style={{ fontSize:13, color:"var(--text3)", fontWeight:600, marginBottom:10 }}>
              {quiz.title} — Results
            </div>

            {/* Big score */}
            <div style={{ fontSize:76, fontWeight:900, color:perf.col, lineHeight:1,
              fontFamily:"var(--mono)", marginBottom:6 }}>{finalPct}%</div>
            <div style={{ fontSize:20, fontWeight:700, color:perf.col, marginBottom:20 }}>{perf.label}</div>

            {/* Score bar */}
            <div className="gbar" style={{ height:10, marginBottom:22 }}>
              <div className="gbar-fill"
                style={{ width:`${finalPct}%`, background:`linear-gradient(90deg,${perf.col},${perf.col}99)` }} />
            </div>

            {/* Stats row */}
            <div className="g3 mb20">
              <div className="card card-sm tac">
                <div className="fw8" style={{ fontSize:24, color:"#22c55e" }}>{correct}</div>
                <div className="text-xs muted">Correct</div>
              </div>
              <div className="card card-sm tac">
                <div className="fw8" style={{ fontSize:24, color:"#ef4444" }}>{totalQ - correct}</div>
                <div className="text-xs muted">Wrong</div>
              </div>
              <div className="card card-sm tac">
                <div className="fw8" style={{ fontSize:24 }}>{totalQ}</div>
                <div className="text-xs muted">Total</div>
              </div>
            </div>

            {/* Encouragement */}
            {finalPct < 80 && (
              <div style={{ background:"var(--bg3)", borderRadius:10,
                padding:"12px 16px", marginBottom:18, fontSize:13,
                color:"var(--text2)", lineHeight:1.55 }}>
                💡 Keep practicing and try again! Every attempt makes you stronger.
              </div>
            )}

            <div className="flex gap8">
              <button className="btn btn-se w100" style={{ justifyContent:"center" }}
                onClick={() => setPhase("cards")}>← All Games</button>
              <button className="btn btn-pr w100" style={{ justifyContent:"center", background:quiz.color }}
                onClick={() => startQuiz(quiz)}>🔄 Retry</button>
            </div>
          </div>

          {/* Score history */}
          {(() => {
            const hist = myScores.filter(s => s.quizId === quiz.id).slice(-5).reverse();
            return hist.length > 1 ? (
              <div className="card mt12" style={{ textAlign:"left", padding:"14px 16px" }}>
                <div className="sh-title mb8">📈 Your History</div>
                {hist.map((s, i) => (
                  <div key={s.id} className="flex ac jb"
                    style={{ padding:"7px 0", borderBottom: i < hist.length-1 ? "1px solid var(--border)" : "none" }}>
                    <span className="text-xs muted">{s.date}</span>
                    <span className="mono fw7" style={{
                      color: s.pct >= 80 ? "#22c55e" : s.pct >= 50 ? "#f59e0b" : "#ef4444" }}>
                      {s.pct}%
                    </span>
                  </div>
                ))}
              </div>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("App error:", error, info); }
  render() {
    if (this.state.hasError) return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0a",color:"#fff",gap:16,padding:24}}>
        <div style={{fontSize:40}}>⚠️</div>
        <div style={{fontSize:20,fontWeight:700}}>Something went wrong</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",maxWidth:400,textAlign:"center"}}>{this.state.error?.message || "An unexpected error occurred"}</div>
        <button onClick={() => { this.setState({hasError:false,error:null}); window.location.reload(); }}
          style={{marginTop:8,padding:"10px 24px",background:"#f97316",color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:14}}>
          Reload App
        </button>
      </div>
    );
    return this.props.children;
  }
}
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authScreen, setAuthScreen] = useState("landing");
  const [page, setPage] = useState("dashboard");

  // ── Real data from API ──────────────────────────────────────────
  const emptyData = { users:[], groups:[], sessions:[], series:[], payments:[], books:[], lessons:[], attendance:[], teacherPayments:[] };
  const [data, setData] = useState(emptyData);
  const [apiLoading, setApiLoading] = useState(true);

  // Load all data once user is authenticated — declared BEFORE useEffect that references it


  const normalize = (arr) => (arr || []).map(item => {
    const flat = deepClean(item);
    flat.id = item._id?.toString() || item.id?.toString() || flat.id;
    delete flat._id;
    // book cover color normalization
    flat.coverColor = flat.coverColor || flat.color || '#f97316';
    flat.color = flat.coverColor;
    // fix chapters - keep as objects with id
    if (Array.isArray(item.chapters)) {
      flat.chapters = item.chapters.map(ch => ({
        id:    ch._id?.toString() || ch.id,
        title: ch.title || '',
        order: ch.order || 0,
      }));
    }
    // normalize: ensure sessions have both time and startTime for compatibility
    if (item.startTime && !flat.time) flat.time = flat.startTime;
    if (item.time && !flat.startTime) flat.startTime = flat.time;
    // Fix mode/sessionMode field name mismatch: backend schema uses 'mode', frontend uses 'sessionMode'
    if (flat.mode && !flat.sessionMode) flat.sessionMode = flat.mode;
    if (flat.sessionMode && !flat.mode) flat.mode = flat.sessionMode;
    if (!flat.sessionMode) flat.sessionMode = "offline";
    if (!flat.mode) flat.mode = "offline";
    // normalize attendance: ensure it's always a plain object {studentId: boolean}
    if (Array.isArray(item.attendance)) {
      // Legacy array format: convert to object
      const attObj = {};
      item.attendance.forEach(a => {
        const sid = a.studentId?._id?.toString() || a.studentId?.toString() || a.studentId;
        if (sid) attObj[sid] = a.status === 'present' || a.status === true;
      });
      flat.attendance = attObj;
    } else if (!item.attendance || typeof item.attendance !== 'object') {
      flat.attendance = {};
    }
    return flat;
  });

  const loadAllData = useCallback(async () => {
    try {
      setApiLoading(true);
      const [users, groups, sessions, series, payments, books, lessons, attendance, teacherPayments] = await Promise.all([
        api.users.list(),
        api.groups.list(),
        api.sessions.list(),
        api.series.list(),
        api.payments.list(),
        api.books.list(),
        api.lessons.list(),
        api.attendance.list().catch(() => []),
        api.teacherPayments.list().catch(() => []),
      ]);
      setData({
        users:          normalize(users),
        groups:         normalize(groups),
        sessions:       normalize(sessions),
        series:         normalize(series),
        payments:       normalize(payments),
        books:          normalize(books),
        lessons:        normalize(lessons),
        attendance:     normalize(attendance),
        teacherPayments: normalize(teacherPayments),
      });
    } catch (err) {
      console.error("Failed to load data:", err);
      // Keep emptyData on error so app still renders
      setData(d => ({ ...emptyData, ...d }));
    } finally {
      setApiLoading(false);
    }
  }, []);

  // On mount: validate stored token
  useEffect(() => {
    if (hasToken()) {
      api.auth.me()
        .then(u => {
          setUser(deepClean(u));
        })
        .catch(() => clearToken())
        .finally(() => setAuthLoading(false));
    } else {
      setAuthLoading(false);
    }
  }, []);

  // Load data when user logs in
  useEffect(() => {
    if (user) loadAllData();
  }, [user, loadAllData]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toasts = useToasts();

  const logout = () => {
    localStorage.removeItem('eloc_token');
    sessionStorage.clear();
    setUser(null);
    setPage("dashboard");
    setAuthScreen("landing");
  };

  const titleMap = { dashboard: "Dashboard", analytics: "Analytics", students: "Students", teachers: "Teachers", groups: "Groups", books: "Books & Curriculum", sessions: "Sessions", payments: "Payments", earnings: "Earnings", classes: "My Classes", attendance: "Attendance", materials: "My Materials", games: "🎮 Games", admin_users: "🔐 Admin Users", admin_attendance: "✅ Attendance Center" };

  const renderPage = () => {
    if (user.role === "admin") {
      const pages = {
        dashboard: <AdminDashboard data={data} />,
        analytics: <Analytics data={data} />,
        students: <StudentsPage data={data} setData={setData} />,
        teachers: <TeachersPage data={data} setData={setData} />,
        groups: <GroupsPage data={data} setData={setData} />,
        books: <BooksPage data={data} setData={setData} />,
        sessions: <SessionsPage data={data} setData={setData} userRole="admin" userId={user.id} />,
        payments: <PaymentsPage data={data} setData={setData} userRole="admin" userId={user.id} />,
        admin_users: <AdminUsersPage data={data} setData={setData} currentUser={user} />,
        attendance: <AdminAttendancePage data={data} setData={setData} />,
      };
      return pages[page] ?? pages.dashboard;
    }
    if (user.role === "teacher") {
      const pages = {
        dashboard: <TeacherDashboard user={user} data={data} />,
        sessions: <SessionsPage data={data} setData={setData} userRole="teacher" userId={user.id} />,
        groups: <GroupsPage data={data} setData={setData} />,
        materials: <MaterialsPage user={user} data={data} setData={setData} />,
        attendance: <AdminAttendancePage data={data} setData={setData} teacherFilter={user.id} />,
        earnings: <TeacherEarnings user={user} data={data} />,
      };
      return pages[page] ?? pages.dashboard;
    }
    if (user.role === "student") {
      const pages = {
        dashboard: <StudentDashboard user={user} data={data} />,
        sessions: <SessionsPage data={data} setData={setData} userRole="student" userId={user.id} />,
        classes: <StudentClasses user={user} data={data} />,
        materials: <StudentMaterials user={user} data={data} />,
        attendance: <StudentAttendance user={user} data={data} />,
        payments: <PaymentsPage data={data} setData={setData} userRole="student" userId={user.id} />,
        games: <GamesPage user={user} data={data} setData={setData} />,
        profile: <StudentProfile user={user} setUser={setUser} />,
      };
      return pages[page] ?? pages.dashboard;
    }
  };

  if (authLoading) return (
    <>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:"#0a0a0a",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
        <div style={{fontSize:32,fontWeight:900,background:"linear-gradient(135deg,#f97316,#fb923c)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>ELOC</div>
        <div style={{width:36,height:36,border:"3px solid rgba(249,115,22,.2)",borderTopColor:"#f97316",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      </div>
    </>
  );

  if (!user) return (
    <>
      <style>{CSS}</style>
      {authScreen === "landing" && <LandingPage onGoLogin={() => setAuthScreen("login")} onGoSignup={() => setAuthScreen("signup")} />}
      {authScreen === "login"   && <LoginPage onLogin={(token, u) => { saveToken(token); setUser(u); setAuthScreen("landing"); }} users={data.users} onBack={() => setAuthScreen("landing")} />}
      {authScreen === "signup"  && <StudentSignupPage onBack={() => setAuthScreen("landing")} onSuccess={u => { setUser(u); setAuthScreen("landing"); }} data={data} setData={setData} />}
      <div className="toast-wrap">{toasts.map(t => <div key={t.id} className={`toast t-${t.type}`}>{t.msg}</div>)}</div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className={`sidebar-overlay${sidebarOpen ? " open" : ""}`} onClick={() => setSidebarOpen(false)} />
        <Sidebar user={user} active={page} onNav={p => { setPage(p); setSidebarOpen(false); }} open={sidebarOpen} />
        <main className="main">
          <header className="topbar">
            <div className="flex ac gap10">
              <button className="hamburger" onClick={() => setSidebarOpen(true)}>☰</button>
              <div className="topbar-title">{titleMap[page] ?? "ELOC"}</div>
            </div>
            <div className="topbar-right">
              <div className="topbar-chip topbar-date" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent2)", background: "var(--glow)", borderColor: "rgba(249,115,22,.2)" }}>
                Thu, Feb 26 2025
              </div>
              <div className="topbar-chip" onClick={logout}>
                <Av name={user.name} sz="av-sm" />
                {user.name.split(" ")[0]}
                <span style={{ fontSize: 10, color: "var(--text3)" }}>Sign out</span>
              </div>
            </div>
          </header>
          <div className="content">{renderPage()}</div>
        </main>
      </div>
      <div className="toast-wrap">{toasts.map(t => <div key={t.id} className={`toast t-${t.type}`}>{t.msg}</div>)}</div>
    </>
  );
}
