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
  seriesId:     { type: String },
  createdBy:    { type: String },
  chapterId:    { type: String },
  teacherNotes: { type: String },
  fileId:          { type: String },   // Cloudinary URL of main image
  driveLink:       { type: String },   // Google Drive link for main PDF
  extraFiles:      [{ type: String }], // Cloudinary URLs of extra images
  extraDriveLinks: [{ type: String }], // Google Drive links for extra PDFs
  files: [{ name: String, url: String, publicId: String, size: Number, type: String }],
  hwSubmissions: [{
    studentId:   { type: String },
    studentName: { type: String },
    lessonId:    { type: String },
    fileName:    { type: String },
    fileExt:     { type: String },
    fileType:    { type: String },
    fileSizeKB:  { type: Number },
    fileData:    { type: String },   // base64 data URL (cleared by teacher after review)
    fileDeleted: { type: Boolean, default: false },
    submittedAt: { type: String },
    reviewedAt:  { type: String },
    feedback:    { type: String, default: null },
  }],
}, { timestamps: true });
export const Lesson = mongoose.model('Lesson', lessonSchema);
