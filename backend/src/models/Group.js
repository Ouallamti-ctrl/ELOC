import mongoose from 'mongoose';
const { Schema } = mongoose;
const groupSchema = new Schema({
  name:          { type: String, required: true },
  level:         { type: String },
  teacherId:     { type: Schema.Types.ObjectId, ref: 'User' },
  maxStudents:   { type: Number, default: 12 },
  students:      [{ type: Schema.Types.ObjectId, ref: 'User' }],
  schedule:      { type: String },
  room:          { type: String },
  startDate:     { type: String },
  endDate:       { type: String },
  status:        { type: String, default: 'active' },
  assignedBooks: [{ type: Schema.Types.ObjectId, ref: 'Book' }],
}, { timestamps: true });
export const Group = mongoose.model('Group', groupSchema);
