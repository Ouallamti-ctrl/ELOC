import mongoose from 'mongoose';
const { Schema } = mongoose;
const attendanceSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
  studentId: { type: Schema.Types.ObjectId, ref: 'User' },
  present:   { type: Boolean, default: false },
  date:      { type: String },
  note:      { type: String },
}, { timestamps: true });
export const Attendance = mongoose.model('Attendance', attendanceSchema);
