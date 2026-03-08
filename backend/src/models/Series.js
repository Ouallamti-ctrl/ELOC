import mongoose from 'mongoose';
const { Schema } = mongoose;
const seriesSchema = new Schema({
  title:         { type: String, required: true },
  groupId:       { type: Schema.Types.ObjectId, ref: 'Group' },
  teacherId:     { type: Schema.Types.ObjectId, ref: 'User' },
  startDate:     { type: String },
  startTime:     { type: String },
  endTime:       { type: String },
  duration:      { type: Number },
  recurringDays: [Number],
  endType:       { type: String },
  endDate:       { type: String },
  repeatWeeks:   { type: Number },
  paused:        { type: Boolean, default: false },
}, { timestamps: true });
export const Series = mongoose.model('Series', seriesSchema);
