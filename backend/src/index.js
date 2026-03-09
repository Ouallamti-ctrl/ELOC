import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';

// Simple in-memory rate limiter (no extra deps)
function createRateLimiter({ windowMs = 60000, max = 20, message = 'Too many requests' } = {}) {
  const store = new Map();
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const record = store.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
    record.count++;
    store.set(key, record);
    if (record.count > max) return res.status(429).json({ message });
    next();
  };
}
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many login attempts, try again in 15 minutes' });
const apiLimiter  = createRateLimiter({ windowMs: 60 * 1000, max: 300 });
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import {
  groupRouter, sessionRouter, paymentRouter,
  bookRouter, lessonRouter, seriesRouter,
  teacherPaymentRouter, attendanceRouter
} from './routes/resources.js';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://eloc.pro',
    'https://www.eloc.pro',
    'https://jocular-pastelito-a84716.netlify.app',
    /\.netlify\.app$/,
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', loginLimiter);
app.use('/api',          apiLimiter);
app.use('/api/auth',     authRouter);
app.use('/api/users',    usersRouter);
app.use('/api/groups',   groupRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/books',    bookRouter);
app.use('/api/lessons',  lessonRouter);
app.use('/api/series',   seriesRouter);
app.use('/api/attendance',        attendanceRouter);
app.use('/api/teacher-payments',  teacherPaymentRouter);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ message: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
});
