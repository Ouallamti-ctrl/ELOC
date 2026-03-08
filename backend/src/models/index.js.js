import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema, model } = mongoose;

// ── Group ─────────────────────────────────────────────────────────────────────
const groupSchema = new Schema({
  name:        { type: String, required: true },
  level:       { type: String },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User' },
  students:    [{ type: Schema.Types.ObjectId, ref: 'User' }],
  schedule:    { type: String },
  room:        { type: String },
  startDate:   { type: String },
  endDate:     { type: String },
  status:      { type: String, default: 'active' },
  assignedBooks: [{ type: Schema.Types.ObjectId, ref: 'Book' }],
}, { timestamps: true });
export const Group = model('Group', groupSchema);

// ── Session ───────────────────────────────────────────────────────────────────
const sessionSchema = new Schema({
  groupId:     { type: Schema.Types.ObjectId, ref: 'Group' },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User' },
  date:        { type: String },
  startTime:   { type: String },
  endTime:     { type: String },
  topic:       { type: String },
  status:      { type: String, default: 'scheduled' },
  notes:       { type: String },
}, { timestamps: true });
export const Session = model('Session', sessionSchema);

// ── Payment ───────────────────────────────────────────────────────────────────
const paymentSchema = new Schema({
  studentId:   { type: Schema.Types.ObjectId, ref: 'User' },
  amount:      { type: Number },
  date:        { type: String },
  month:       { type: String },
  status:      { type: String, default: 'pending' },
  method:      { type: String },
  note:        { type: String },
}, { timestamps: true });
export const Payment = model('Payment', paymentSchema);

// ── Book ──────────────────────────────────────────────────────────────────────
const bookSchema = new Schema({
  title:       { type: String, required: true },
  author:      { type: String },
  level:       { type: String },
  color:       { type: String },
  coverColor:  { type: String },
  description: { type: String },
  chapters:    [{ title: String, order: Number }],
  assignedGroups: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
  fileId:      { type: String },
}, { timestamps: true });
export const Book = model('Book', bookSchema);

// ── Lesson ────────────────────────────────────────────────────────────────────
const lessonSchema = new Schema({
  bookId:      { type: Schema.Types.ObjectId, ref: 'Book' },
  chapterId:   { type: String },
  title:       { type: String, required: true },
  type:        { type: String },
  fileId:      { type: String },
  duration:    { type: Number },
  order:       { type: Number },
  notes:       { type: String },
}, { timestamps: true });
export const Lesson = model('Lesson', lessonSchema);

// ── Series ────────────────────────────────────────────────────────────────────
const seriesSchema = new Schema({
  title:       { type: String, required: true },
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User' },
  level:       { type: String },
  description: { type: String },
  sessions:    [{ type: Schema.Types.ObjectId, ref: 'Session' }],
}, { timestamps: true });
export const Series = model('Series', seriesSchema);

// ── TeacherPayment ────────────────────────────────────────────────────────────
const teacherPaymentSchema = new Schema({
  teacherId:   { type: Schema.Types.ObjectId, ref: 'User' },
  amount:      { type: Number, required: true },
  date:        { type: String },
  month:       { type: String },
  status:      { type: String, default: 'pending' },
  note:        { type: String },
}, { timestamps: true });
export const TeacherPayment = model('TeacherPayment', teacherPaymentSchema);

// ── Attendance ────────────────────────────────────────────────────────────────
const attendanceSchema = new Schema({
  sessionId:   { type: Schema.Types.ObjectId, ref: 'Session' },
  studentId:   { type: Schema.Types.ObjectId, ref: 'User' },
  present:     { type: Boolean, default: false },
  date:        { type: String },
  note:        { type: String },
}, { timestamps: true });
export const Attendance = model('Attendance', attendanceSchema);
