import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect, adminOnly, teacherOrAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// GET /api/users  — admin gets all, teacher gets students, student gets themselves
router.get('/', async (req, res) => {
  try {
    let query = {};
    let fields = '-password';
    if (req.user.role === 'student') {
      // Students only see themselves
      query._id = req.user._id;
    } else if (req.user.role === 'teacher') {
      // Teachers see students + themselves (needed for profile, settings)
      query.$or = [
        { role: 'student' },
        { _id: req.user._id },
      ];
    }
    // Admins see everyone
    const users = await User.find(query).select(fields).lean().sort({ createdAt: -1 });
    res.json(users.map(u => ({
      ...u,
      id: u._id.toString(),
      _id: u._id.toString(),
      groupId: u.groupId?.toString() || ''
    })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/users  — admin creates teachers/students
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, email, password, role, phone, commission, salaryType,
            age, city, level, groupId, permissions } = req.body;
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({
      name, email, password, role, phone, commission, salaryType,
      age, city, level, groupId,
      // Save permissions array for sub-admins (empty array = no access, undefined = full)
      ...(Array.isArray(permissions) ? { permissions } : {}),
      avatar: name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2),
      registrationDate: new Date().toISOString().split('T')[0],
    });
    const plain = user.toObject();
    plain.id = plain._id.toString();
    plain._id = plain.id;
    delete plain.password;
    res.status(201).json(plain);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  try {
    // students can only update themselves
    if (req.user.role === 'student' && req.user._id.toString() !== req.params.id)
      return res.status(403).json({ message: 'Forbidden' });

    // Only admins can change passwords for other users
    const isPasswordChange = !!req.body.password;
    if (isPasswordChange && req.user.role !== 'admin' && req.user._id.toString() !== req.params.id)
      return res.status(403).json({ message: 'Only admins can change another user\'s password' });

    if (isPasswordChange && req.body.password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    // Whitelist fields to prevent mass assignment / role escalation
    const { name, email, phone, age, city, level, groupId,
            commission, salaryType, status, avatar,
            registrationDate, paymentStatus, notes,
            trialDate, trialTime, registrationStatus,
            permissions } = req.body;
    const allowed = { name, email, phone, age, city, level, groupId,
                      commission, salaryType, status, avatar,
                      registrationDate, paymentStatus, notes,
                      trialDate, trialTime, registrationStatus };

    // Allow admins to update permissions array (for sub-admin role management)
    if (Array.isArray(permissions)) allowed.permissions = permissions;

    // Only admins can change roles
    if (req.user.role === 'admin' && req.body.role) allowed.role = req.body.role;

    // Remove undefined fields
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);

    // Password change: must use .save() so the pre('save') bcrypt hook fires
    if (isPasswordChange) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      // Apply all other field updates
      Object.assign(user, allowed);
      // Set new password — pre('save') will hash it
      user.password = req.body.password;
      await user.save();
      const plain = user.toObject();
      plain.id = plain._id.toString();
      plain._id = plain.id;
      delete plain.password;
      return res.json({ ...plain, _passwordChanged: true });
    }

    // No password change — use fast findByIdAndUpdate
    const user = await User.findByIdAndUpdate(req.params.id, allowed, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const plain = user.toObject();
    plain.id = plain._id.toString();
    plain._id = plain.id;
    res.json(plain);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/users/:id — admin only
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

export default router;
