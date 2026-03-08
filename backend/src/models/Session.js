import mongoose from 'mongoose';
const { Schema } = mongoose;
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
