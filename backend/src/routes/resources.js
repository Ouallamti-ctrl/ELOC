import express from 'express';
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
import { Group, Session, Payment, Book, Lesson, Series } from '../models/index.js';
import { protect, adminOnly, teacherOrAdmin } from '../middleware/auth.js';
import { upload, cloudinary } from '../config/cloudinary.js';

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
    res.status(201).json(group);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

groupRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const group = await Group.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(group);
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
    const sessions = await Session.find(filter).lean()
      .populate('teacherId', 'name avatar')
      .populate('groupId', 'name level')
      .sort({ date: 1, startTime: 1 });
    res.json(sessions);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

sessionRouter.post('/', teacherOrAdmin, async (req, res) => {
  try {
    const session = await Session.create(req.body);
    res.status(201).json(session);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

sessionRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try {
    const session = await Session.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(session);
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
    const session = await Session.findByIdAndUpdate(
      req.params.id,
      { attendance: req.body.attendance, status: 'completed' },
      { new: true }
    );
    res.json(session);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENTS ────────────────────────────────────────────────────────────────
export const paymentRouter = express.Router();
paymentRouter.use(protect);

paymentRouter.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'student' ? { studentId: req.user._id } : {};
    const payments = await Payment.find(filter).populate('studentId', 'name email avatar');
    res.json(payments);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.post('/', adminOnly, async (req, res) => {
  try {
    const payment = await Payment.create(req.body);
    res.status(201).json(payment);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

paymentRouter.put('/:id', adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(payment);
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
    res.json(books.map(b => ({ ...b, id: b._id.toString(), _id: b._id.toString(), coverColor: b.coverColor || b.color || '#f97316', assignedGroups: (b.assignedGroups||[]).map(g=>g?.toString()) })));
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
    const book = await Book.findByIdAndUpdate(req.params.id, {
      fileId:   req.file.public_id,
      fileUrl:  req.file.secure_url,
      fileName: req.file.originalname,
    }, { new: true });
    res.json(book);
  } catch (err) { res.status(500).json({ message: err.message }); }
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
    const lessons = await Lesson.find(filter)
      .populate('teacherId', 'name avatar')
      .populate('bookId', 'title color level')
      .populate('sessionId', 'date startTime groupId')
      .sort({ createdAt: -1 });
    res.json(lessons);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.post('/', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.create({ ...req.body, teacherId: req.user._id });
    res.status(201).json(lesson);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

lessonRouter.put('/:id', teacherOrAdmin, async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(lesson);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/lessons/:id/files  — upload file to a lesson
lessonRouter.post('/:id/files', teacherOrAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const fileEntry = {
      name:     req.file.originalname,
      url:      req.file.secure_url,
      publicId: req.file.public_id,
      size:     req.file.size,
      type:     req.file.mimetype,
    };
    const lesson = await Lesson.findByIdAndUpdate(
      req.params.id,
      { $push: { files: fileEntry } },
      { new: true }
    );
    res.json(lesson);
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
