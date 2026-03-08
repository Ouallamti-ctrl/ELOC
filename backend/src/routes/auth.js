import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password)
    return res.status(400).json({ message: 'Email and password required' });

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ message: 'Invalid email or password' });

  const plain = user.toObject();
  plain.id = plain._id.toString();
  plain._id = plain.id;
  delete plain.password;
  res.json({ token: signToken(user._id), user: plain });
});

// POST /api/auth/register  (students self-register)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, age, city, level } = req.body;
    // Input validation
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' });
    if (!email?.includes('@')) return res.status(400).json({ message: 'Valid email is required' });
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    // Sanitize
    const cleanEmail = email.toLowerCase().trim();
    const exists = await User.findOne({ email: cleanEmail });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({
      name: name.trim(), email: cleanEmail, password,
      role: 'student',
      phone, age, city, level,
      registrationDate: new Date().toISOString().split('T')[0],
      avatar: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2),
    });

    const plain = user.toObject();
    plain.id = plain._id.toString();
    plain._id = plain.id;
    delete plain.password;
    res.status(201).json({ token: signToken(user._id), user: plain });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me  (validate token + get current user)
router.get('/me', protect, (req, res) => {
  const plain = req.user.toObject ? req.user.toObject() : { ...req.user };
  plain.id = plain._id?.toString() || plain.id;
  plain._id = plain.id;
  delete plain.password;
  res.json(plain);
});

// PUT /api/auth/password  (change own password)
router.put('/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (!(await user.comparePassword(currentPassword)))
      return res.status(400).json({ message: 'Current password incorrect' });
    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
