// ── PAYMENT CYCLE ────────────────────────────────────────────────────────────
// One payment record = one student × one month covered (monthKey "YYYY-MM").
// Overdue records are generated HERE on the server only (never in browsers),
// so two admin devices can no longer create duplicates.
import { Payment } from '../models/Payment.js';
import User from '../models/User.js';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, 'décembre': 12, decembre: 12,
};
const EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const pad = n => String(n).padStart(2, '0');

// "March 2026" | "mars 2026" | "2026-03" → "2026-03" (null if unknown)
export function monthKeyFromLabel(label) {
  if (!label) return null;
  const s = String(label).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = /^(\S+)\s+(\d{4})$/.exec(s.replace(/\s+/g, ' '));
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${pad(MONTHS[m[1].toLowerCase()])}`;
  return null;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${EN[m - 1]} ${y}`;
}

export function monthKeyOf(p) {
  return p.monthKey || monthKeyFromLabel(p.month) || (p.dueDate ? String(p.dueDate).slice(0, 7) : null);
}

const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

// Today in Morocco (UTC+1), as "YYYY-MM-DD"
const todayMA = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

// Fill monthKey + an English month label on a request body before saving
export function normalizePaymentBody(body) {
  const out = { ...body };
  const key = out.monthKey || monthKeyFromLabel(out.month);
  if (key) { out.monthKey = key; out.month = monthLabel(key); }
  return out;
}

// For every active student: create an "overdue" record for each month after
// their latest recorded month whose due day has passed. Idempotent.
let running = null;
let lastRun = 0;
export function ensureOverdue({ force = false, dryRun = null } = {}) {
  if (running && !dryRun) return running;
  if (!force && Date.now() - lastRun < 30 * 60 * 1000) return Promise.resolve(0);
  running = (async () => {
    const today = todayMA();
    const thisMonth = today.slice(0, 7);
    const students = await User.find({ role: 'student', paymentStatus: { $nin: ['on_hold', 'cancelled'] } }, { _id: 1 }).lean();
    const pays = await Payment.find({}, { studentId: 1, month: 1, monthKey: 1, dueDate: 1, amount: 1, createdAt: 1 }).lean();
    const byStudent = new Map();
    for (const p of pays) {
      const k = String(p.studentId);
      if (!byStudent.has(k)) byStudent.set(k, []);
      byStudent.get(k).push(p);
    }
    let created = 0;
    for (const st of students) {
      const mine = (byStudent.get(String(st._id)) || [])
        .map(p => ({ p, key: monthKeyOf(p) }))
        .filter(x => x.key)
        .sort((a, b) => a.key.localeCompare(b.key) || new Date(a.p.createdAt) - new Date(b.p.createdAt));
      if (!mine.length) continue; // never paid → nothing to chase automatically
      const last = mine[mine.length - 1];
      const known = new Set(mine.map(x => x.key));
      // Due day of month: taken from the latest record's due date when it falls in its own month
      let dueDay = 1;
      if (last.p.dueDate && String(last.p.dueDate).slice(0, 7) === last.key) dueDay = Number(String(last.p.dueDate).slice(8, 10)) || 1;
      for (let key = addMonths(last.key, 1); key <= thisMonth; key = addMonths(key, 1)) {
        if (known.has(key)) continue;
        const [y, m] = key.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const dueDate = `${key}-${pad(Math.min(dueDay, daysInMonth))}`;
        if (dueDate >= today) break; // not due yet
        if (dryRun) { dryRun.push({ studentId: String(st._id), key, amount: last.p.amount, dueDate }); continue; }
        const res = await Payment.updateOne(
          { studentId: st._id, monthKey: key },
          { $setOnInsert: { studentId: st._id, monthKey: key, month: monthLabel(key), amount: last.p.amount, status: 'overdue', dueDate, date: null, auto: true } },
          { upsert: true }
        ).catch(e => { if (e.code !== 11000) throw e; return {}; });
        if (res.upsertedCount) created++;
      }
    }
    lastRun = Date.now();
    if (created) console.log(`[payments] auto-overdue created ${created} record(s)`);
    return created;
  })().finally(() => { running = null; });
  return running;
}

// When a student is set to cancelled / on_hold, remove the UNPAID overdue records
// the server generated for them (auto: true). Manually entered records are never touched.
export async function cleanupInactiveOverdue() {
  const inactive = await User.find({ role: 'student', paymentStatus: { $in: ['on_hold', 'cancelled'] } }, { _id: 1 }).lean();
  if (!inactive.length) return 0;
  const r = await Payment.deleteMany({ auto: true, status: 'overdue', studentId: { $in: inactive.map(u => u._id) } });
  if (r.deletedCount) console.log(`[payments] removed ${r.deletedCount} auto-overdue record(s) of cancelled/on-hold students`);
  return r.deletedCount;
}

// One-time fix for old records: add monthKey and an English label.
export async function backfillMonthKeys() {
  const docs = await Payment.find({ $or: [{ monthKey: { $exists: false } }, { monthKey: null }] }, { month: 1, dueDate: 1 }).lean();
  let n = 0;
  for (const d of docs) {
    const key = monthKeyFromLabel(d.month) || (d.dueDate ? String(d.dueDate).slice(0, 7) : null);
    if (!key) continue;
    await Payment.updateOne({ _id: d._id }, { $set: { monthKey: key, month: monthLabel(key) } });
    n++;
  }
  if (n) console.log(`[payments] backfilled monthKey on ${n} record(s)`);
  return n;
}
