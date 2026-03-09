import express from 'express';
import { Group }          from '../models/Group.js';
import { Session }        from '../models/Session.js';
import { Payment }        from '../models/Payment.js';
import { Book }           from '../models/Book.js';
import { Lesson }         from '../models/Lesson.js';
import { Series }         from '../models/Series.js';
import { TeacherPayment } from '../models/TeacherPayment.js';
import { Attendance }     from '../models/Attendance.js';
import { protect, adminOnly, teacherOrAdmin } from '../middleware/auth.js';
import { upload, cloudinary } from '../config/cloudinary.js';

// ── UNIVERSAL ID NORMALIZER ──────────────────────────────────────────────────
// Converts ANY mongoose document or plain object to a safe JSON with string IDs.
// Single source of truth — used everywhere instead of ad-hoc conversions.
const normalize = (doc) => {
  if (!doc) return null;
  // Use JSON round-trip to flatten BSON types (ObjectId, Date, Decimal128)
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const flat = JSON.parse(JSON.stringify(obj));
  // Guarantee id = string
  flat.id  = flat._id?.toString() || flat.id || '';
  flat._id = flat.id;
  // Flatten all known ObjectId reference fields to strings
  const refFields = ['teacherId','groupId','studentId','bookId','sessionId','lessonId','paymentId'];
  for (const f of refFields) {
    if (flat[f] != null) flat[f] = flat[f]?.toString?.() ?? flat[f];
  }
  // Flatten arrays of ObjectIds
  const arrFields = ['assignedGroups','students','assignedBooks'];
  for (const f of arrFields) {
    if (Array.isArray(flat[f])) flat[f] = flat[f].map(v => v?.toString?.() ?? v);
  }
  // Normalize session mode fields
  if ('mode' in flat || 'sessionMode' in flat) {
    const m = flat.sessionMode || flat.mode || 'offline';
    flat.mode = m; flat.sessionMode = m;
  }
  // Normalize attendance: always a plain {studentId:boolean} object
  if (flat.attendance !== undefined) {
    if (Array.isArray(flat.attendance)) {
      const obj = {};
      flat.attendance.forEach(a => {
        const sid = a.studentId?.toString?.() ?? a.studentId;
        if (sid) obj[sid] = a.status === 'present' || a.status === true;
      });
      flat.attendance = obj;
    } else if (!flat.attendance || typeof flat.attendance !== 'object') {
      flat.attendance = {};
    }
  }
  return flat;
};

const normalizeMany = (docs) => (docs || []).map(normalize);

// ── GROUPS ───────────────────────────────────────────────────────────────────
export const groupRouter = express.Router();
groupRouter.use(protect);

groupRouter.get('/', async (req, res) => {
  try {
    const groups = await Group.find().lean().sort({ createdAt: -1 });
    res.json(normalizeMany(groups));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.post('/', adminOnly, async (req, res) => {
  try {
    const group = await Group.create(req.body);
    res.status(201).json(normalize(group));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const group = await Group.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.json(normalize(group));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Group.findByIdAndDelete(req.params.id);
    res.json({ message: 'Group deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── SESSIONS ─────────────────────────────────────────────────────────────────
export const sessionRouter = express.Router();
sessionRouter.use(protect);

sessionRouter.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'teacher') {
      filter.$or = [
        { teacherId: req.user._id },
        { teacherId: req.user._id.toString() },
      ];
    }
    if (req.user.role === 'student') {
      // Find group by string or ObjectId match
      const group = await Group.findOne({
        $or: [
          { _id: req.user.groupId },
          { students: req.user._id },
        ]
      });
      if (group) filter.groupId = group._id;
      else return res.json([]); // student not in any group
    }
    const sessions = await Session.find(filter).sort({ date: 1, startTime: 1 });
    res.json(normalizeMany(sessions));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

sessionRouter.post('/', teacherOrAdmin, async (req, res) => {
  try {
    const { id: _tid, _id: _oid, sessionMode, mode, ...rest } = req.body;
    const resolvedMode = sessionMode || mode || 'offline';
    // Ensure attendance is always initialized as empty object
    // Always initialize attendance as empty object for new sessions
    rest.attendance = {};
    // Ensure status defaults to upcoming
    if (!rest.status) rest.status = 'upcoming';
    const session = await Session.create({ ...rest, mode: resolvedMode, sessionMode: resolvedMode });
    res.status(201).json(normalize(session));
  } catch (err) {
    console.error('Session create error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to create session' });
  }
});

sessionRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try {
    if (req.user.role === 'teacher') {
      const existing = await Session.findById(req.params.id);
      if (existing && existing.teacherId?.toString() !== req.user._id.toString())
        return res.status(403).json({ message: 'You can only edit your own sessions' });
    }
    const { title, date, startTime, endTime, duration, status, notes,
            mode, sessionMode, meetingLink, groupId, teacherId, attendance,
            isCancelled, isException } = req.body;
    const resolvedMode = sessionMode || mode || 'offline';
    const allowed = { title, date, startTime, endTime, duration, status, notes,
                      mode: resolvedMode, sessionMode: resolvedMode,
                      meetingLink, groupId, teacherId, attendance,
                      isCancelled, isException };
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const session = await Session.findByIdAndUpdate(req.params.id, allowed, { new: true });
    if (!session) return res.status(404).json({ message: 'Session not found' });
    res.json(normalize(session));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH single student attendance
sessionRouter.patch('/:id/attendance', teacherOrAdmin, async (req, res) => {
  try {
    const { studentId, present } = req.body;
    if (!studentId) return res.status(400).json({ message: 'studentId required' });
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    // Defensive: rebuild attendance if it's not a plain object
    const existingAtt = (session.attendance && typeof session.attendance === 'object' && !Array.isArray(session.attendance))
      ? session.attendance : {};
    session.attendance = { ...existingAtt, [studentId]: present };
    session.status = 'completed';  // Always mark completed when attendance is set
    session.markModified('attendance');
    await session.save();
    res.json(normalize(session));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT full attendance object
sessionRouter.put('/:id/attendance', teacherOrAdmin, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    // Normalize attendance: ensure plain object, convert any legacy array format
    const rawAtt = req.body.attendance;
    let attObj = {};
    if (Array.isArray(rawAtt)) {
      rawAtt.forEach(a => {
        const sid = a.studentId?.toString?.() ?? a.studentId;
        if (sid) attObj[sid] = a.status === 'present' || a.status === true;
      });
    } else if (rawAtt && typeof rawAtt === 'object') {
      attObj = rawAtt;
    }
    session.attendance = attObj;
    session.status = 'completed';
    session.markModified('attendance');
    await session.save();
    res.json(normalize(session));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

sessionRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Session.findByIdAndDelete(req.params.id);
    res.json({ message: 'Session deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENTS ─────────────────────────────────────────────────────────────────
export const paymentRouter = express.Router();
paymentRouter.use(protect);

paymentRouter.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'student' ? { studentId: req.user._id } : {};
    const payments = await Payment.find(filter).sort({ createdAt: -1 });
    res.json(normalizeMany(payments));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.post('/', adminOnly, async (req, res) => {
  try {
    const payment = await Payment.create(req.body);
    res.status(201).json(normalize(payment));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    res.json(normalize(payment));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BOOKS ────────────────────────────────────────────────────────────────────
export const bookRouter = express.Router();
bookRouter.use(protect);

bookRouter.get('/', async (req, res) => {
  try {
    const books = await Book.find().lean().sort({ createdAt: -1 });
    res.json(books.map(b => ({
      ...normalize(b),
      coverColor: b.coverColor || b.color || '#f97316',
      color:      b.coverColor || b.color || '#f97316',
      fileId:     b.fileId  || b.fileUrl  || '',
      fileUrl:    b.fileUrl || b.fileId   || '',
      fileName:   b.fileName || '',
      chapters:   (b.chapters || []).map(ch => ({
        id:    ch._id?.toString() || ch.id,
        title: ch.title || '',
        order: ch.order || 0,
      })),
    })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

bookRouter.post('/', adminOnly, async (req, res) => {
  try {
    const { title, author, level, description, coverColor, color, assignedGroups } = req.body;
    const book = await Book.create({
      title, author, level, description,
      assignedGroups: assignedGroups || [],
      coverColor: coverColor || color || '#f97316',
      color:      coverColor || color || '#f97316',
    });
    res.status(201).json(normalize(book));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

bookRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!book) return res.status(404).json({ message: 'Book not found' });
    res.json(normalize(book));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

bookRouter.post('/:id/upload', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const fileUrl  = req.file.path || req.file.secure_url || '';
    const publicId = req.file.filename || req.file.public_id || '';
    const book = await Book.findByIdAndUpdate(req.params.id, {
      fileId: fileUrl, fileUrl, fileName: req.file.originalname, publicId,
    }, { new: true });
    if (!book) return res.status(404).json({ message: 'Book not found' });
    res.json({ ...normalize(book), fileId: fileUrl, fileUrl });
  } catch (err) {
    console.error('Book upload error:', err);
    res.status(500).json({ message: err.message });
  }
});

bookRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (book?.publicId) {
      try { await cloudinary.uploader.destroy(book.publicId); } catch(_) {}
    }
    await Book.findByIdAndDelete(req.params.id);
    res.json({ message: 'Book deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── LESSONS ──────────────────────────────────────────────────────────────────
export const lessonRouter = express.Router();
lessonRouter.use(protect);

// GET /api/lessons
// Admin: all lessons
// Teacher: lessons they created OR linked to their sessions/groups
// Student: lessons linked to their group's sessions
lessonRouter.get('/', async (req, res) => {
  try {
    let lessons;
    if (req.user.role === 'admin') {
      lessons = await Lesson.find().sort({ createdAt: -1 });
    } else if (req.user.role === 'teacher') {
      // Get all sessions belonging to this teacher
      const mySessions = await Session.find({
        $or: [
          { teacherId: req.user._id },
          { teacherId: req.user._id.toString() },
        ]
      }).lean();
      const mySessionIds  = mySessions.map(s => s._id);
      const mySeriesIds   = [...new Set(mySessions.map(s => s.seriesId).filter(Boolean))];
      lessons = await Lesson.find({
        $or: [
          { teacherId: req.user._id },
          { sessionId: { $in: mySessionIds } },
          { seriesId:  { $in: mySeriesIds  } },
        ]
      }).sort({ createdAt: -1 });
    } else {
      // Student: lessons linked to their group's sessions
      const group = await Group.findOne({
        $or: [{ _id: req.user.groupId }, { students: req.user._id }]
      });
      if (!group) return res.json([]);
      const groupSessions = await Session.find({ groupId: group._id }).lean();
      const sessionIds = groupSessions.map(s => s._id);
      const seriesIds  = [...new Set(groupSessions.map(s => s.seriesId).filter(Boolean))];
      lessons = await Lesson.find({
        $or: [
          { sessionId: { $in: sessionIds } },
          { seriesId:  { $in: seriesIds  } },
        ]
      }).sort({ createdAt: -1 });
    }
    res.json(normalizeMany(lessons));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.post('/', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.create({ ...req.body, teacherId: req.user._id });
    res.status(201).json(normalize(lesson));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!lesson) return res.status(404).json({ message: 'Lesson not found' });
    res.json(normalize(lesson));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/lessons/:id/files — upload file
lessonRouter.post('/:id/files', teacherOrAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const fileUrl  = req.file.path || req.file.secure_url || '';
    const publicId = req.file.filename || req.file.public_id || '';
    const fileEntry = {
      name: req.file.originalname, url: fileUrl,
      publicId, size: req.file.size, type: req.file.mimetype,
    };
    await Lesson.findByIdAndUpdate(req.params.id, { $push: { files: fileEntry } });
    res.json({ fileId: fileUrl, fileUrl, fileName: req.file.originalname, publicId });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/lessons/:id/files/:publicId
lessonRouter.delete('/:id/files/:publicId', teacherOrAdmin, async (req, res) => {
  try {
    const pid = decodeURIComponent(req.params.publicId);
    try { await cloudinary.uploader.destroy(pid); } catch(_) {}
    const lesson = await Lesson.findByIdAndUpdate(
      req.params.id,
      { $pull: { files: { publicId: pid } } },
      { new: true }
    );
    res.json(normalize(lesson));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.delete('/:id', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    for (const f of lesson?.files || []) {
      if (f.publicId) { try { await cloudinary.uploader.destroy(f.publicId); } catch(_) {} }
    }
    await Lesson.findByIdAndDelete(req.params.id);
    res.json({ message: 'Lesson deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/lessons/proxy — serve Cloudinary file inline
lessonRouter.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ message: 'URL required' });
    if (!url.includes('cloudinary.com')) return res.status(400).json({ message: 'Only Cloudinary URLs allowed' });
    const mod = url.startsWith('https') ? await import('https') : await import('http');
    mod.default.get(url, (upstream) => {
      const isPdf = url.toLowerCase().includes('.pdf') || (upstream.headers['content-type']||'').includes('pdf');
      res.set({
        'Content-Type':        isPdf ? 'application/pdf' : (upstream.headers['content-type'] || 'application/octet-stream'),
        'Content-Disposition': 'inline',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      });
      upstream.pipe(res);
    }).on('error', e => res.status(500).json({ message: e.message }));
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── SERIES ────────────────────────────────────────────────────────────────────
export const seriesRouter = express.Router();
seriesRouter.use(protect);

seriesRouter.get('/', async (req, res) => {
  try {
    const all = await Series.find().lean().sort({ createdAt: -1 });
    res.json(normalizeMany(all));
  } catch (err) { res.status(500).json({ message: err.message }); }
});
seriesRouter.post('/', teacherOrAdmin, async (req, res) => {
  try { res.status(201).json(normalize(await Series.create(req.body))); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
seriesRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try { res.json(normalize(await Series.findByIdAndUpdate(req.params.id, req.body, { new: true }))); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
seriesRouter.delete('/:id', adminOnly, async (req, res) => {
  try { await Series.findByIdAndDelete(req.params.id); res.json({ message: 'Series deleted' }); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

// ── TEACHER PAYMENTS ──────────────────────────────────────────────────────────
export const teacherPaymentRouter = express.Router();
teacherPaymentRouter.use(protect);

teacherPaymentRouter.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'teacher' ? { teacherId: req.user._id } : {};
    const all = await TeacherPayment.find(filter).lean().sort({ date: -1 });
    res.json(normalizeMany(all));
  } catch (err) { res.status(500).json({ message: err.message }); }
});
teacherPaymentRouter.post('/', adminOnly, async (req, res) => {
  try { res.status(201).json(normalize(await TeacherPayment.create(req.body))); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
teacherPaymentRouter.put('/:id', adminOnly, async (req, res) => {
  try { res.json(normalize(await TeacherPayment.findByIdAndUpdate(req.params.id, req.body, { new: true }))); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
teacherPaymentRouter.delete('/:id', adminOnly, async (req, res) => {
  try { await TeacherPayment.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

// ── ATTENDANCE ────────────────────────────────────────────────────────────────
export const attendanceRouter = express.Router();
attendanceRouter.use(protect);

attendanceRouter.get('/', async (req, res) => {
  try {
    const docs = await Attendance.find().lean().sort({ createdAt: -1 });
    res.json(normalizeMany(docs));
  } catch (err) { res.status(500).json({ message: err.message }); }
});
attendanceRouter.post('/', async (req, res) => {
  try { res.status(201).json(normalize(await Attendance.create(req.body))); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
attendanceRouter.put('/:id', async (req, res) => {
  try { res.json(normalize(await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true }))); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
attendanceRouter.delete('/:id', async (req, res) => {
  try { await Attendance.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
