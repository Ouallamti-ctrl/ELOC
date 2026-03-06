import express from 'express';
import User from '../models/User.js';
import { protect, adminOnly, teacherOrAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// GET /api/users  — admin gets all, teacher gets students, student gets themselves
router.get('/', async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'student') query._id = req.user._id;
    const users = await User.find(query).select('-password').sort({ createdAt: -1 });
    res.json(users);
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
            age, city, level, groupId } = req.body;
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({
      name, email, password, role, phone, commission, salaryType,
      age, city, level, groupId,
      avatar: name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2),
      registrationDate: new Date().toISOString().split('T')[0],
    });
    res.status(201).json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  try {
    // students can only update themselves
    if (req.user.role === 'student' && req.user._id.toString() !== req.params.id)
      return res.status(403).json({ message: 'Forbidden' });

    // never allow password update via this route
    delete req.body.password;

    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
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
