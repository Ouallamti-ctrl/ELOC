// Run once to seed initial admin: node src/seed.js
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import User from './models/User.js';
import { Group } from './models/index.js';

await connectDB();

console.log('🌱 Seeding database...');

// Clear existing
await User.deleteMany({});
await Group.deleteMany({});

// Create admin
const admin = await User.create({
  name: 'Admin ELOC',
  email: 'admin@elocinternational.com',
  password: 'ChangeMe123!',
  role: 'admin',
  avatar: 'AD',
});

// Create a sample teacher
const teacher = await User.create({
  name: 'Oualid Lamti',
  email: 'oualid@elocinternational.com',
  password: 'ChangeMe123!',
  role: 'teacher',
  phone: '+212 6 04 00 72 32',
  commission: 40,
  salaryType: 'commission',
  status: 'active',
  avatar: 'OL',
});

// Create sample groups
const g1 = await Group.create({ name: 'B2 Morning', level: 'B2', teacherId: teacher._id, maxStudents: 12, schedule: 'Mon/Wed/Fri 09:00–10:30', status: 'active' });
const g2 = await Group.create({ name: 'A2 Evening', level: 'A2', teacherId: teacher._id, maxStudents: 10, schedule: 'Tue/Thu 18:00–19:30', status: 'active' });

console.log('✅ Seed complete!');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Admin login:');
console.log('  Email:    admin@elocinternational.com');
console.log('  Password: ChangeMe123!');
console.log('');
console.log('  Teacher login:');
console.log('  Email:    oualid@elocinternational.com');
console.log('  Password: ChangeMe123!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('⚠️  CHANGE THESE PASSWORDS IMMEDIATELY!');

await mongoose.disconnect();
