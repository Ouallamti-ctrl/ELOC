import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  email:            { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:         { type: String, required: true, minlength: 6 },
  role:             { type: String, enum: ['admin', 'teacher', 'student'], required: true },
  avatar:           { type: String },

  // Teacher fields
  phone:            { type: String },
  commission:       { type: Number },
  salaryType:       { type: String, enum: ['commission', 'fixed'] },
  status:           { type: String, enum: ['active', 'inactive'], default: 'active' },

  // Student fields
  age:              { type: Number },
  city:             { type: String },
  level:            { type: String, enum: ['A1','A2','B1','B2','C1','C2'] },
  groupId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },
  registrationDate: { type: String },
  paymentStatus:    { type: String, enum: ['paid','pending','overdue'], default: 'pending' },

  // Trial booking
  trialDate:          { type: String, default: null },
  trialTime:          { type: String, default: null },
  registrationStatus: { type: String, enum: ['pending','confirmed','rejected'], default: null },

  // Admin permissions — only used when role === 'admin'
  // undefined = Super Admin (full access), [] = no access, ['students','payments'] = restricted
  permissions: { type: [String], default: undefined },

  // Extra fields stored by the app
  notes: { type: String },
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Never send password in JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.model('User', userSchema);
