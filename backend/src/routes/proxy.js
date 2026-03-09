// ── PDF Proxy Route ───────────────────────────────────────────────────────────
// Proxies Cloudinary PDFs through the backend to fix CORS issues on browsers.
// Usage: GET /api/proxy-pdf?url=https://res.cloudinary.com/...
import express from 'express';
export const proxyRouter = express.Router();

proxyRouter.get('/', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.startsWith('https://res.cloudinary.com')) {
      return res.status(400).json({ message: 'Invalid URL' });
    }
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'ELOC-Server/1.0' }
    });
    if (!upstream.ok) return res.status(upstream.status).send('Upstream error');

    res.set({
      'Content-Type': upstream.headers.get('content-type') || 'application/pdf',
      'Content-Disposition': 'inline',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    });
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});
