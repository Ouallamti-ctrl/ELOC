import mongoose from 'mongoose';
const { Schema } = mongoose;

// ── GROUP ───────────────────────────────────────────────────────────────────
const groupSchema = new Schema({
  name:        { type: String, required: true },
  level:       { type: String, enum: ['A1','A2','B1','B2','C1','C2'], required: true },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  maxStudents: { type: Number, default: 12 },
  schedule:    { type: String },
  status:      { type: String, enum: ['active','inactive','completed'], default: 'active' },
}, { timestamps: true });

// ── SESSION ─────────────────────────────────────────────────────────────────
const sessionSchema = new Schema({
  title:       { type: String, required: true },
  groupId:     { type: Schema.Types.ObjectId, ref: 'Group', required: true },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date:        { type: String, required: true },
  startTime:   { type: String },
  endTime:     { type: String },
  duration:    { type: Number },
  status:      { type: String, enum: ['upcoming','completed','cancelled'], default: 'upcoming' },
  seriesId:    { type: String },
  lessonId:    { type: Schema.Types.ObjectId, ref: 'Lesson' },
  attendance:  [{ studentId: { type: Schema.Types.ObjectId, ref: 'User' }, status: { type: String, enum: ['present','absent','late'] } }],
  notes:       { type: String },
}, { timestamps: true });

// ── PAYMENT ─────────────────────────────────────────────────────────────────
const paymentSchema = new Schema({
  studentId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount:      { type: Number, required: true },
  month:       { type: String },
  status:      { type: String, enum: ['paid','pending','overdue'], default: 'pending' },
  date:        { type: String },
  dueDate:     { type: String },
  method:      { type: String },
  note:        { type: String },
}, { timestamps: true });

// ── BOOK ────────────────────────────────────────────────────────────────────
const bookSchema = new Schema({
  title:       { type: String, required: true },
  author:      { type: String },
  level:       { type: String },
  color:       { type: String },
  coverColor:  { type: String },
  description: { type: String },
  chapters:    [{ title: String, order: Number }],
  assignedGroups: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
  fileId:      { type: String },      // Cloudinary public_id
  fileUrl:     { type: String },      // Cloudinary secure_url
  fileName:    { type: String },
}, { timestamps: true });

// ── LESSON ──────────────────────────────────────────────────────────────────
const lessonSchema = new Schema({
  title:       { type: String, required: true },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId:   { type: Schema.Types.ObjectId, ref: 'Session' },
  bookId:      { type: Schema.Types.ObjectId, ref: 'Book' },
  chapterIndex:{ type: Number },
  description: { type: String },
  homework:    { type: String },
  homeworkDue: { type: String },
  privateNotes:{ type: String },
  files: [{
    name:     String,
    url:      String,      // Cloudinary URL
    publicId: String,      // Cloudinary public_id
    size:     Number,
    type:     String,
  }],
}, { timestamps: true });

// ── SERIES ──────────────────────────────────────────────────────────────────
const seriesSchema = new Schema({
  title:         { type: String, required: true },
  groupId:       { type: Schema.Types.ObjectId, ref: 'Group' },
  teacherId:     { type: Schema.Types.ObjectId, ref: 'User' },
  startDate:     { type: String },
  startTime:     { type: String },
  endTime:       { type: String },
  duration:      { type: Number },
  recurringDays: [Number],
  endType:       { type: String, enum: ['date','count','never'] },
  endDate:       { type: String },
  repeatWeeks:   { type: Number },
  paused:        { type: Boolean, default: false },
}, { timestamps: true });

export const Group    = mongoose.model('Group',    groupSchema);
export const Session  = mongoose.model('Session',  sessionSchema);
export const Payment  = mongoose.model('Payment',  paymentSchema);
export const Book     = mongoose.model('Book',     bookSchema);
export const Lesson   = mongoose.model('Lesson',   lessonSchema);
export const Series   = mongoose.model('Series',   seriesSchema);

// ── TEACHER PAYMENT ───────────────────────────────────────────────────────────
const teacherPaymentSchema = new Schema({
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount:      { type: Number, required: true },
  date:        { type: String },
  month:       { type: String },
  status:      { type: String, default: 'pending' },
  note:        { type: String },
}, { timestamps: true });
export const TeacherPayment = model('TeacherPayment', teacherPaymentSchema);

// ── Attendance ────────────────────────────────────────────────────────────────
const attendanceSchema = new Schema({
  sessionId:  { type: Schema.Types.ObjectId, ref: 'Session' },
  studentId:  { type: Schema.Types.ObjectId, ref: 'User' },
  present:    { type: Boolean, default: false },
  date:       { type: String },
  note:       { type: String },
}, { timestamps: true });
export const Attendance = model('Attendance', attendanceSchema);
