import { nanoid } from 'nanoid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../../.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function ensureSecret() {
  loadEnv();
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  const extra = `JWT_SECRET=${secret}\nPORT=${process.env.PORT || 3001}\n`;
  fs.appendFileSync(ENV_PATH, extra);
  process.env.JWT_SECRET = secret;
  return secret;
}

export const JWT_SECRET = null; // set after ensureSecret

export function id(prefix = '') {
  return prefix + nanoid(16);
}

export function now() {
  return Date.now();
}

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function signToken(userId) {
  return jwt.sign({ uid: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
export const DISPLAY_RE = /^[\p{L}\p{N} .'_-]{1,40}$/u;

export function sanitizeText(s, max = 4000) {
  if (typeof s !== 'string') return '';
  return s.replace(/\u0000/g, '').trim().slice(0, max);
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    bio: u.bio || '',
    status: u.status || 'offline',
    lastSeen: u.last_seen,
    createdAt: u.created_at,
  };
}

export function parseJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE !== '0',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

export const ALLOWED_MIME = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'],
  file: [
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
  ],
};

export const BLOCKED_EXT = new Set([
  'exe', 'bat', 'cmd', 'sh', 'bash', 'ps1', 'msi', 'dll', 'com', 'scr',
  'js', 'mjs', 'cjs', 'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi',
  'html', 'htm', 'svg', 'xhtml', 'hta', 'vbs', 'wsf', 'jar', 'apk',
]);

export const MAX_SIZE = {
  image: 10 * 1024 * 1024,
  video: 40 * 1024 * 1024,
  audio: 8 * 1024 * 1024,
  voice: 8 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};

export function kindFromMime(mime, originalName = '') {
  const ext = (originalName.split('.').pop() || '').toLowerCase();
  if (BLOCKED_EXT.has(ext)) return null;
  if (ALLOWED_MIME.image.includes(mime)) return 'image';
  if (ALLOWED_MIME.video.includes(mime)) return 'video';
  if (ALLOWED_MIME.audio.includes(mime)) return 'audio';
  if (ALLOWED_MIME.file.includes(mime)) return 'file';
  return null;
}
