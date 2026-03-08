import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
const { Schema } = mongoose;

// ── GROUP ─────────────────────────────────────────────────────────────────────
const groupSchema = new Schema({
  name:           { type: String, required: true },
  level:          { type: String },
  teacherId:      { type: Schema.Types.ObjectId, ref: 'User' },
  maxStudents:    { type: Number, default: 12 },
  students:       [{ type: Schema.Types.ObjectId, ref: 'User' }],
  schedule:       { type: String },
  room:           { type: String },
  startDate:      { type: String },
  endDate:        { type: String },
  status:         { type: String, default: 'active' },
  assignedBooks:  [{ type: Schema.Types.ObjectId, ref: 'Book' }],
}, { timestamps: true });
export const Group = mongoose.model('Group', groupSchema);

// ── SESSION ───────────────────────────────────────────────────────────────────
const sessionSchema = new Schema({
  title:       { type: String },
  groupId:     { type: Schema.Types.ObjectId, ref: 'Group' },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User' },
  date:        { type: String },
  startTime:   { type: String },
  endTime:     { type: String },
  duration:    { type: Number },
  status:      { type: String, default: 'upcoming' },
  seriesId:    { type: String },
  lessonId:    { type: Schema.Types.ObjectId, ref: 'Lesson' },
  mode:        { type: String, default: 'offline' },
  meetingLink: { type: String },
  notes:       { type: String },
  attendance:  [{ studentId: { type: Schema.Types.ObjectId, ref: 'User' }, status: String }],
}, { timestamps: true });
export const Session = mongoose.model('Session', sessionSchema);

// ── PAYMENT ───────────────────────────────────────────────────────────────────
const paymentSchema = new Schema({
  studentId:   { type: Schema.Types.ObjectId, ref: 'User' },
  amount:      { type: Number },
  month:       { type: String },
  status:      { type: String, default: 'pending' },
  date:        { type: String },
  dueDate:     { type: String },
  method:      { type: String },
  note:        { type: String },
}, { timestamps: true });
export const Payment = mongoose.model('Payment', paymentSchema);

// ── BOOK ──────────────────────────────────────────────────────────────────────
const bookSchema = new Schema({
  title:          { type: String, required: true },
  author:         { type: String },
  level:          { type: String },
  color:          { type: String },
  coverColor:     { type: String },
  description:    { type: String },
  chapters:       [{ title: String, order: Number }],
  assignedGroups: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
  fileId:         { type: String },
  fileUrl:        { type: String },
  fileName:       { type: String },
}, { timestamps: true });
export const Book = mongoose.model('Book', bookSchema);

// ── LESSON ────────────────────────────────────────────────────────────────────
const lessonSchema = new Schema({
  title:        { type: String, required: true },
  teacherId:    { type: Schema.Types.ObjectId, ref: 'User' },
  sessionId:    { type: Schema.Types.ObjectId, ref: 'Session' },
  bookId:       { type: Schema.Types.ObjectId, ref: 'Book' },
  chapterIndex: { type: Number },
  description:  { type: String },
  homework:     { type: String },
  homeworkDue:  { type: String },
  privateNotes: { type: String },
  files: [{
    name:     String,
    url:      String,
    publicId: String,
    size:     Number,
    type:     String,
  }],
}, { timestamps: true });
export const Lesson = mongoose.model('Lesson', lessonSchema);

// ── SERIES ────────────────────────────────────────────────────────────────────
const seriesSchema = new Schema({
  title:         { type: String, required: true },
  groupId:       { type: Schema.Types.ObjectId, ref: 'Group' },
  teacherId:     { type: Schema.Types.ObjectId, ref: 'User' },
  startDate:     { type: String },
  startTime:     { type: String },
  endTime:       { type: String },
  duration:      { type: Number },
  recurringDays: [Number],
  endType:       { type: String },
  endDate:       { type: String },
  repeatWeeks:   { type: Number },
  paused:        { type: Boolean, default: false },
}, { timestamps: true });
export const Series = mongoose.model('Series', seriesSchema);

// ── TEACHER PAYMENT ───────────────────────────────────────────────────────────
const teacherPaymentSchema = new Schema({
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User' },
  amount:      { type: Number, required: true },
  date:        { type: String },
  month:       { type: String },
  status:      { type: String, default: 'pending' },
  note:        { type: String },
}, { timestamps: true });
export const TeacherPayment = mongoose.model('TeacherPayment', teacherPaymentSchema);

// ── ATTENDANCE ────────────────────────────────────────────────────────────────
const attendanceSchema = new Schema({
  sessionId:   { type: Schema.Types.ObjectId, ref: 'Session' },
  studentId:   { type: Schema.Types.ObjectId, ref: 'User' },
  present:     { type: Boolean, default: false },
  date:        { type: String },
  note:        { type: String },
}, { timestamps: true });
export const Attendance = mongoose.model('Attendance', attendanceSchema);
