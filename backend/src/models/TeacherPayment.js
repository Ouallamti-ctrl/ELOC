import mongoose from 'mongoose';
const { Schema } = mongoose;
const teacherPaymentSchema = new Schema({
  teacherId: { type: Schema.Types.ObjectId, ref: 'User' },
  amount:    { type: Number, required: true },
  date:      { type: String },
  month:     { type: String },
  status:    { type: String, default: 'pending' },
  note:      { type: String },
}, { timestamps: true });
export const TeacherPayment = mongoose.model('TeacherPayment', teacherPaymentSchema);
