import mongoose from 'mongoose';
const { Schema } = mongoose;
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
