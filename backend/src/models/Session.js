import mongoose from 'mongoose';
const { Schema } = mongoose;
const sessionSchema = new Schema({
  title:        { type: String },
  groupId:      { type: Schema.Types.ObjectId, ref: 'Group' },
  teacherId:    { type: Schema.Types.ObjectId, ref: 'User' },
  date:         { type: String, index: true },
  startTime:    { type: String },
  endTime:      { type: String },
  duration:     { type: Number },
  status:       { type: String, default: 'upcoming' },
  seriesId:     { type: String },
  lessonId:     { type: Schema.Types.ObjectId, ref: 'Lesson' },
  mode:         { type: String, default: 'offline' },
  meetingLink:  { type: String },
  notes:        { type: String },
  isCancelled:  { type: Boolean, default: false },
  isException:  { type: Boolean, default: false },
  recurringDays:{ type: [String], default: [] },
  // attendance stored as plain object { studentId: boolean } for O(1) lookups
  attendance:   { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// Index for common queries
sessionSchema.index({ groupId: 1, date: 1 });
sessionSchema.index({ teacherId: 1, date: 1 });
export const Session = mongoose.model('Session', sessionSchema);
