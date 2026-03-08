import mongoose from 'mongoose';
const { Schema } = mongoose;
const paymentSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User' },
  amount:    { type: Number },
  month:     { type: String },
  status:    { type: String, default: 'pending' },
  date:      { type: String },
  dueDate:   { type: String },
  method:    { type: String },
  note:      { type: String },
}, { timestamps: true });
export const Payment = mongoose.model('Payment', paymentSchema);
