import mongoose from 'mongoose';
const { Schema } = mongoose;
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
  files: [{ name: String, url: String, publicId: String, size: Number, type: String }],
}, { timestamps: true });
export const Lesson = mongoose.model('Lesson', lessonSchema);
