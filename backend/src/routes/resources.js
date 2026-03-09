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

// Helper: convert mongoose doc array to plain objects with string IDs
const toPlain = (docs) => (docs||[]).map(d => {
  const obj = typeof d.toObject === 'function' ? d.toObject() : { ...d };
  obj.id = obj._id?.toString() || obj.id;
  obj._id = obj.id;
  // flatten all ObjectId fields
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && v._id) obj[key] = v._id.toString();
    if (Array.isArray(v)) obj[key] = v.map(i => i?._id ? i._id.toString() : i?.toString ? i.toString() : i);
  }
  return obj;
});

// Helper: normalize single mongoose doc to plain object with string IDs
const toPlainOne = (d) => {
  if (!d) return null;
  const obj = typeof d.toObject === 'function' ? d.toObject() : { ...d };
  // Use JSON parse/stringify to safely serialize all BSON types (ObjectId, Date, etc.)
  const jsonSafe = JSON.parse(JSON.stringify(obj));
  jsonSafe.id  = jsonSafe._id?.toString() || jsonSafe.id;
  // Ensure mode/sessionMode both present
  const resolvedMode = jsonSafe.sessionMode || jsonSafe.mode || 'offline';
  jsonSafe.sessionMode = resolvedMode;
  jsonSafe.mode = resolvedMode;
  return jsonSafe;
};

// ── GROUPS ──────────────────────────────────────────────────────────────────
export const groupRouter = express.Router();
groupRouter.use(protect);

groupRouter.get('/', async (req, res) => {
  try {
    const groups = await Group.find().lean();
    // Return plain objects with string IDs - no populated objects that confuse frontend
    res.json(groups.map(g => ({
      ...g,
      id: g._id.toString(),
      _id: g._id.toString(),
      teacherId: g.teacherId?.toString() || '',
      students: (g.students || []).map(s => s?.toString ? s.toString() : s),
      assignedBooks: (g.assignedBooks || []).map(b => b?.toString ? b.toString() : b),
    })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.post('/', adminOnly, async (req, res) => {
  try {
    const group = await Group.create(req.body);
    res.status(201).json(toPlainOne(group));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const group = await Group.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(toPlainOne(group));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Group.findByIdAndDelete(req.params.id);
    res.json({ message: 'Group deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── SESSIONS ────────────────────────────────────────────────────────────────
export const sessionRouter = express.Router();
sessionRouter.use(protect);

sessionRouter.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'teacher') {
      // Match both ObjectId and string versions of teacherId
      filter.$or = [{ teacherId: req.user._id }, { teacherId: req.user._id.toString() }];
    }
    if (req.user.role === 'student') {
      const user = req.user;
      const group = await Group.findOne({ _id: user.groupId });
      if (group) filter.groupId = group._id;
    }
    const sessions = await Session.find(filter)
      .sort({ date: 1, startTime: 1 });
    res.json(sessions.map(s => {
      const o = s.toObject();
      // Normalize attendance: convert legacy array to object format
      let att = o.attendance || {};
      if (Array.isArray(att)) {
        const attObj = {};
        att.forEach(a => {
          const sid = a.studentId?.toString();
          if (sid) attObj[sid] = a.status === 'present' || a.status === true;
        });
        att = attObj;
      }
      const resolvedMode = o.sessionMode || o.mode || "offline";
      return {
        ...o,
        id:          o._id.toString(),
        _id:         o._id.toString(),
        teacherId:   o.teacherId?.toString() || '',
        groupId:     o.groupId?.toString()   || '',
        attendance:  att,
        mode:        resolvedMode,
        sessionMode: resolvedMode,
      };
    }));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

sessionRouter.post('/', teacherOrAdmin, async (req, res) => {
  try {
    // Remove any temp frontend id field, normalize mode/sessionMode
    const { id: _tempId, _id: _tempOid, sessionMode, mode, ...rest } = req.body;
    const resolvedMode = sessionMode || mode || "offline";
    const session = await Session.create({ ...rest, mode: resolvedMode, sessionMode: resolvedMode });
    const plain = toPlainOne(session);
    // Ensure both mode fields are in response
    if (!plain.sessionMode && plain.mode) plain.sessionMode = plain.mode;
    if (!plain.mode && plain.sessionMode) plain.mode = plain.sessionMode;
    res.status(201).json(plain);
  } catch (err) {
    console.error('Session create error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to create session' });
  }
});

sessionRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try {
    // Teachers can only update their own sessions
    if (req.user.role === 'teacher') {
      const existing = await Session.findById(req.params.id);
      if (existing && existing.teacherId?.toString() !== req.user._id.toString())
        return res.status(403).json({ message: 'You can only edit your own sessions' });
    }
    // Whitelist allowed fields for update
    const { title, date, startTime, endTime, duration, status, notes,
            mode, sessionMode, meetingLink, groupId, teacherId, attendance,
            isCancelled, isException } = req.body;
    // Accept both mode and sessionMode (frontend uses sessionMode, schema uses mode)
    const resolvedMode = sessionMode || mode || "offline";
    const allowed = { title, date, startTime, endTime, duration, status, notes,
                      mode: resolvedMode, sessionMode: resolvedMode,
                      meetingLink, groupId, teacherId, attendance,
                      isCancelled, isException };
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const session = await Session.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json(toPlainOne(session));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH attendance for a single student in a session
sessionRouter.patch('/:id/attendance', teacherOrAdmin, async (req, res) => {
  try {
    const { studentId, present } = req.body;
    if (!studentId) return res.status(400).json({ message: 'studentId required' });
    // attendance is Mixed type - must use findById + markModified for nested changes
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!session.attendance || typeof session.attendance !== 'object' || Array.isArray(session.attendance)) {
      session.attendance = {};
    }
    session.attendance[studentId] = present;
    // Auto-complete session when attendance is marked so it shows in overview
    if (session.status === 'upcoming') session.status = 'completed';
    session.markModified('attendance'); // required for Mixed type changes
    await session.save();
    const plain = toPlainOne(session);
    // Ensure both mode fields are normalized in response
    const resolvedMode = plain.sessionMode || plain.mode || 'offline';
    plain.sessionMode = resolvedMode;
    plain.mode = resolvedMode;
    res.json(plain);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

sessionRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Session.findByIdAndDelete(req.params.id);
    res.json({ message: 'Session deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/sessions/:id/attendance — mark attendance
sessionRouter.put('/:id/attendance', teacherOrAdmin, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    session.attendance = req.body.attendance || {};
    session.status = 'completed';
    session.markModified('attendance');
    await session.save();
    res.json(toPlainOne(session));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENTS ────────────────────────────────────────────────────────────────
export const paymentRouter = express.Router();
paymentRouter.use(protect);

paymentRouter.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'student' ? { studentId: req.user._id } : {};
    const payments = await Payment.find(filter).sort({ createdAt: -1 });
    res.json(toPlain(payments));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.post('/', adminOnly, async (req, res) => {
  try {
    const payment = await Payment.create(req.body);
    res.status(201).json(toPlainOne(payment));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(toPlainOne(payment));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BOOKS ───────────────────────────────────────────────────────────────────
export const bookRouter = express.Router();
bookRouter.use(protect);

bookRouter.get('/', async (req, res) => {
  try {
    const books = await Book.find().lean();
    res.json(books.map(b => ({
      ...b,
      id:             b._id.toString(),
      _id:            b._id.toString(),
      coverColor:     b.coverColor || b.color || '#f97316',
      color:          b.coverColor || b.color || '#f97316',
      assignedGroups: (b.assignedGroups||[]).map(g=>g?.toString()),
      fileId:         b.fileId || b.fileUrl || '',
      fileUrl:        b.fileUrl || b.fileId || '',
      fileName:       b.fileName || '',
    })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

bookRouter.post('/', adminOnly, async (req, res) => {
  try {
    const { title, author, level, description, coverColor, color, assignedGroups } = req.body;
    const book = await Book.create({ title, author, level, description, assignedGroups: assignedGroups||[], coverColor: coverColor||color||'#f97316', color: coverColor||color||'#f97316' });
    res.status(201).json({ ...book.toObject(), coverColor: book.coverColor || '#f97316' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

bookRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(book);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/books/:id/upload  — upload PDF for a book
bookRouter.post('/:id/upload', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const fileUrl  = req.file.path || req.file.secure_url || '';
    const publicId = req.file.filename || req.file.public_id || '';
    const book = await Book.findByIdAndUpdate(req.params.id, {
      fileId:   fileUrl,
      fileUrl:  fileUrl,
      fileName: req.file.originalname,
      publicId: publicId,
    }, { new: true });
    if (!book) return res.status(404).json({ message: 'Book not found' });
    const plain = JSON.parse(JSON.stringify(book.toObject()));
    plain.id = plain._id.toString();
    plain.fileId = fileUrl;
    plain.fileUrl = fileUrl;
    res.json(plain);
  } catch (err) {
    console.error('Book upload error:', err);
    res.status(500).json({ message: err.message });
  }
});

bookRouter.delete('/:id', adminOnly, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (book?.fileId) await cloudinary.uploader.destroy(book.fileId);
    await Book.findByIdAndDelete(req.params.id);
    res.json({ message: 'Book deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── LESSONS ─────────────────────────────────────────────────────────────────
export const lessonRouter = express.Router();
lessonRouter.use(protect);

lessonRouter.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'teacher' ? { teacherId: req.user._id } : {};
    const lessons = await Lesson.find(filter).sort({ createdAt: -1 });
    res.json(toPlain(lessons));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.post('/', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.create({ ...req.body, teacherId: req.user._id });
    res.status(201).json(toPlainOne(lesson));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(toPlainOne(lesson));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/lessons/:id/files  — upload file to a lesson
lessonRouter.post('/:id/files', teacherOrAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    // multer-storage-cloudinary uses .path for URL and .filename for publicId
    const fileUrl  = req.file.path || req.file.secure_url || '';
    const publicId = req.file.filename || req.file.public_id || '';
    const fileEntry = {
      name:     req.file.originalname,
      url:      fileUrl,
      publicId: publicId,
      size:     req.file.size,
      type:     req.file.mimetype,
    };
    const lesson = await Lesson.findByIdAndUpdate(
      req.params.id,
      { $push: { files: fileEntry } },
      { new: true }
    );
    // Return the Cloudinary URL as fileId so frontend can display the PDF
    res.json({
      fileId:   fileUrl,
      fileUrl:  fileUrl,
      fileName: req.file.originalname,
      publicId: publicId,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/lessons/:id/files/:publicId
lessonRouter.delete('/:id/files/:publicId', teacherOrAdmin, async (req, res) => {
  try {
    await cloudinary.uploader.destroy(decodeURIComponent(req.params.publicId));
    const lesson = await Lesson.findByIdAndUpdate(
      req.params.id,
      { $pull: { files: { publicId: decodeURIComponent(req.params.publicId) } } },
      { new: true }
    );
    res.json(lesson);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.delete('/:id', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    for (const f of lesson?.files || []) {
      if (f.publicId) await cloudinary.uploader.destroy(f.publicId);
    }
    await Lesson.findByIdAndDelete(req.params.id);
    res.json({ message: 'Lesson deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── SERIES ───────────────────────────────────────────────────────────────────
export const seriesRouter = express.Router();
seriesRouter.use(protect);
seriesRouter.get('/', async (req, res) => {
  try { res.json(await Series.find().lean()); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
seriesRouter.post('/', teacherOrAdmin, async (req, res) => {
  try { res.status(201).json(await Series.create(req.body)); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
seriesRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try { res.json(await Series.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
seriesRouter.delete('/:id', adminOnly, async (req, res) => {
  try { await Series.findByIdAndDelete(req.params.id); res.json({ message: 'Series deleted' }); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

// ── TEACHER PAYMENTS ─────────────────────────────────────────────────────────
export const teacherPaymentRouter = express.Router();
teacherPaymentRouter.use(protect);

teacherPaymentRouter.get('/', async (req, res) => {
  try { res.json(await TeacherPayment.find().lean().sort({ date: -1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

teacherPaymentRouter.post('/', adminOnly, async (req, res) => {
  try { const tp = await TeacherPayment.create(req.body); res.status(201).json(tp); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

teacherPaymentRouter.put('/:id', adminOnly, async (req, res) => {
  try { const tp = await TeacherPayment.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json(tp); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

teacherPaymentRouter.delete('/:id', adminOnly, async (req, res) => {
  try { await TeacherPayment.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

// ── Attendance ───────────────────────────────────────────────────────────────
export const attendanceRouter = express.Router();
attendanceRouter.use(protect);
attendanceRouter.get('/', async (req, res) => {
  try {
    const docs = await Attendance.find().lean().sort({ createdAt: -1 });
    res.json(docs.map(d => ({ ...d, id: d._id.toString(), _id: d._id.toString(), studentId: d.studentId?.toString()||'', sessionId: d.sessionId?.toString()||'' })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});
attendanceRouter.post('/', async (req, res) => {
  try { const doc = await Attendance.create(req.body); res.status(201).json({ ...doc.toObject(), id: doc._id.toString() }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
attendanceRouter.put('/:id', async (req, res) => {
  try { const doc = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json(doc); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
attendanceRouter.delete('/:id', async (req, res) => {
  try { await Attendance.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

// ── PDF Proxy: serve Cloudinary file with correct Content-Type for inline display ──
// GET /api/lessons/proxy?url=<encoded_cloudinary_url>
lessonRouter.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ message: 'URL required' });
    if (!url.includes('cloudinary.com')) return res.status(400).json({ message: 'Only Cloudinary URLs allowed' });
    const https = await import('https');
    const http  = await import('http');
    const module = url.startsWith('https') ? https : http;
    module.default.get(url, (upstream) => {
      const isPdf = url.toLowerCase().includes('.pdf') || (upstream.headers['content-type']||'').includes('pdf');
      res.set({
        'Content-Type':        isPdf ? 'application/pdf' : (upstream.headers['content-type'] || 'application/octet-stream'),
        'Content-Disposition': 'inline',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':       'public, max-age=86400',
      });
      upstream.pipe(res);
    }).on('error', e => res.status(500).json({ message: e.message }));
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});
