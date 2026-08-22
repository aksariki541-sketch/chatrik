import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, db } from './db.js';
import { ensureSecret, id, kindFromMime, MAX_SIZE, BLOCKED_EXT, publicUser } from './utils.js';
import { registerRoutes, requireAuth, UPLOAD_ROOT } from './http.js';
import { attachRealtime } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CLIENT_DIST = path.join(ROOT, 'client/dist');
const PORT = Number(process.env.PORT || 3001);

ensureSecret();
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, req.user.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
    cb(null, id('f_') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE.video, files: 4 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error('This file type is not allowed.'));
    const kind = kindFromMime(file.mimetype, file.originalname);
    if (!kind) return cb(new Error('This file type is not allowed.'));
    cb(null, true);
  },
});

async function main() {
  await initDb();

  const app = express();
  const server = http.createServer(app);
  const io = new SocketIO(server, {
    cors: { origin: true, credentials: true },
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 2 * 1024 * 1024,
  });

  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment.' },
  }));

  app.use('/uploads', express.static(UPLOAD_ROOT, {
    maxAge: '7d',
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.ogg', '.wav'].includes(ext)) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    },
  }));

  registerRoutes(app, io);

  app.post('/api/upload', requireAuth, (req, res) => {
    upload.array('files', 4)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'No file uploaded' });
      const out = [];
      for (const f of files) {
        const kind = kindFromMime(f.mimetype, f.originalname);
        const max = MAX_SIZE[kind] || MAX_SIZE.file;
        if (f.size > max) {
          fs.unlink(f.path, () => {});
          return res.status(400).json({ error: `File too large. Max ${Math.round(max / 1024 / 1024)} MB.` });
        }
        const rel = `/uploads/${req.user.id}/${f.filename}`;
        out.push({
          id: id('a_'),
          fileUrl: rel,
          fileName: f.originalname.slice(0, 120),
          fileType: kind,
          mime: f.mimetype,
          fileSize: f.size,
        });
      }
      res.json({ files: out });
    });
  });

  app.post('/api/users/me/avatar', requireAuth, (req, res) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const kind = kindFromMime(req.file.mimetype, req.file.originalname);
      if (kind !== 'image') {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Avatar must be an image.' });
      }
      const rel = `/uploads/${req.user.id}/${req.file.filename}`;
      db.run('UPDATE users SET avatar = ? WHERE id = ?', [rel, req.user.id]);
      const u = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      res.json({ user: publicUser(u) });
    });
  });

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/uploads')) {
        return next();
      }
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  attachRealtime(io);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`RikiChat server listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
