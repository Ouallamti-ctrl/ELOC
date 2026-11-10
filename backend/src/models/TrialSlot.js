import mongoose from 'mongoose';
const { Schema } = mongoose;
// Extra trial-test times added by the admin, on top of the default slots.
// date = "YYYY-MM-DD" for one specific day, or "" = available every day.
const trialSlotSchema = new Schema({
  date: { type: String, default: '' },
  time: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
}, { timestamps: true });
trialSlotSchema.index({ date: 1, time: 1 }, { unique: true });
export const TrialSlot = mongoose.model('TrialSlot', trialSlotSchema);
