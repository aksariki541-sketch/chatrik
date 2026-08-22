import { db } from './db.js';
import {
  id, now, hashPassword, verifyPassword, signToken, verifyToken,
  USERNAME_RE, DISPLAY_RE, sanitizeText, publicUser, parseJson,
  COOKIE_OPTS, kindFromMime, MAX_SIZE, BLOCKED_EXT,
} from './utils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || t - b.start > windowMs) {
    b = { start: t, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= limit;
}

export function getTokenFromReq(req) {
  const c = req.cookies?.rc_token;
  if (c) return c;
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function authUser(req) {
  const token = getTokenFromReq(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  return db.get('SELECT * FROM users WHERE id = ?', [payload.uid]);
}

export function requireAuth(req, res, next) {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = u;
  next();
}

export function memberOf(conversationId, userId) {
  return db.get(
    'SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
}

export function isBlocked(a, b) {
  return !!db.get(
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    [a, b, b, a]
  );
}

export function getAttachments(messageId) {
  return db.all('SELECT * FROM attachments WHERE message_id = ?', [messageId]).map(a => ({
    id: a.id,
    fileUrl: a.file_url,
    fileName: a.file_name,
    fileType: a.file_type,
    mime: a.mime,
    fileSize: a.file_size,
    width: a.width,
    height: a.height,
    duration: a.duration,
  }));
}

export function getReactions(messageId) {
  const rows = db.all('SELECT user_id, emoji FROM reactions WHERE message_id = ?', [messageId]);
  const map = {};
  for (const r of rows) {
    if (!map[r.emoji]) map[r.emoji] = [];
    map[r.emoji].push(r.user_id);
  }
  return map;
}

export function getReplyPreview(replyTo) {
  if (!replyTo) return null;
  const m = db.get('SELECT * FROM messages WHERE id = ?', [replyTo]);
  if (!m) return null;
  const sender = db.get('SELECT * FROM users WHERE id = ?', [m.sender_id]);
  return {
    id: m.id,
    content: m.deleted ? '' : (m.content || ''),
    type: m.type,
    deleted: !!m.deleted,
    senderId: m.sender_id,
    senderName: sender?.display_name || 'Unknown',
  };
}

export function messageStatusFor(msg, viewerId, memberIds) {
  if (msg.sender_id !== viewerId) return null;
  const others = memberIds.filter(id => id !== msg.sender_id);
  if (!others.length) return 'sent';
  const rows = db.all('SELECT user_id, status FROM message_status WHERE message_id = ?', [msg.id]);
  const byUser = Object.fromEntries(rows.map(r => [r.user_id, r.status]));
  const allSeen = others.every(uid => byUser[uid] === 'seen');
  const anySeen = others.some(uid => byUser[uid] === 'seen');
  const allDelivered = others.every(uid => byUser[uid] === 'delivered' || byUser[uid] === 'seen');
  const anyDelivered = others.some(uid => byUser[uid] === 'delivered' || byUser[uid] === 'seen');
  if (msg.type === 'system') return 'seen';
  if (others.length === 1) {
    if (allSeen) return 'seen';
    if (anyDelivered) return 'delivered';
    return 'sent';
  }
  if (allSeen) return 'seen';
  if (anySeen || anyDelivered) return 'delivered';
  return 'sent';
}

export function shapeMessage(msg, viewerId, memberIds) {
  const deletedFor = parseJson(msg.deleted_for, []);
  if (deletedFor.includes(viewerId)) return null;
  const sender = db.get('SELECT * FROM users WHERE id = ?', [msg.sender_id]);
  const deleted = !!msg.deleted;
  return {
    id: msg.id,
    conversationId: msg.conversation_id,
    senderId: msg.sender_id,
    sender: publicUser(sender),
    content: deleted ? '' : (msg.content || ''),
    type: deleted ? 'deleted' : msg.type,
    replyTo: msg.reply_to,
    reply: deleted ? null : getReplyPreview(msg.reply_to),
    edited: !!msg.edited,
    editedAt: msg.edited_at,
    deleted,
    forwardedFrom: msg.forwarded_from,
    clientId: msg.client_id,
    createdAt: msg.created_at,
    attachments: deleted ? [] : getAttachments(msg.id),
    reactions: deleted ? {} : getReactions(msg.id),
    status: messageStatusFor(msg, viewerId, memberIds),
  };
}

export function memberIdsOf(conversationId) {
  return db.all(
    'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
    [conversationId]
  ).map(r => r.user_id);
}

export function unreadCount(conversationId, userId, clearedAt) {
  const row = db.get(
    `SELECT COUNT(*) AS c FROM messages m
     WHERE m.conversation_id = ?
       AND m.created_at > ?
       AND m.sender_id != ?
       AND m.deleted = 0`,
    [conversationId, clearedAt || 0, userId]
  );
  const lastRead = db.get(
    'SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  const since = Math.max(clearedAt || 0, lastRead?.last_read_at || 0);
  const r = db.get(
    `SELECT COUNT(*) AS c FROM messages
     WHERE conversation_id = ? AND created_at > ? AND sender_id != ? AND deleted = 0
       AND id NOT IN (SELECT json_each.value FROM messages mm, json_each(mm.deleted_for)
                      WHERE mm.id = messages.id AND json_each.value = ?)`,
    [conversationId, since, userId, userId]
  );
  return r?.c ?? row?.c ?? 0;
}

function lastVisibleMessage(conversationId, userId, clearedAt) {
  const rows = db.all(
    `SELECT * FROM messages WHERE conversation_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 30`,
    [conversationId, clearedAt || 0]
  );
  for (const m of rows) {
    const deletedFor = parseJson(m.deleted_for, []);
    if (deletedFor.includes(userId)) continue;
    return m;
  }
  return null;
}

export function shapeConversation(conv, viewerId) {
  const mem = memberOf(conv.id, viewerId);
  if (!mem) return null;
  const members = db.all(
    `SELECT u.*, cm.role, cm.joined_at FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`,
    [conv.id]
  );
  const memberIds = members.map(m => m.id);
  const last = lastVisibleMessage(conv.id, viewerId, mem.cleared_at);
  let lastMessage = null;
  if (last) {
    lastMessage = {
      id: last.id,
      content: last.deleted ? 'This message was deleted' : (last.content || ''),
      type: last.deleted ? 'deleted' : last.type,
      senderId: last.sender_id,
      senderName: members.find(m => m.id === last.sender_id)?.display_name || '',
      createdAt: last.created_at,
      deleted: !!last.deleted,
    };
  }
  let peer = null;
  if (conv.type === 'dm') {
    const other = members.find(m => m.id !== viewerId);
    peer = publicUser(other);
  }
  const since = Math.max(mem.cleared_at || 0, mem.last_read_at || 0);
  const unread = db.get(
    `SELECT COUNT(*) AS c FROM messages
     WHERE conversation_id = ? AND created_at > ? AND sender_id != ? AND deleted = 0`,
    [conv.id, since, viewerId]
  )?.c || 0;

  const pins = db.all(
    `SELECT p.*, m.content, m.type, m.deleted, m.sender_id FROM pins p
     JOIN messages m ON m.id = p.message_id WHERE p.conversation_id = ?
     ORDER BY p.pinned_at DESC`,
    [conv.id]
  ).map(p => ({
    messageId: p.message_id,
    pinnedBy: p.pinned_by,
    pinnedAt: p.pinned_at,
    content: p.deleted ? 'This message was deleted' : p.content,
    type: p.type,
  }));

  return {
    id: conv.id,
    type: conv.type,
    name: conv.type === 'group' ? conv.name : (peer?.displayName || 'Unknown'),
    avatar: conv.type === 'group' ? conv.avatar : peer?.avatar,
    description: conv.description || '',
    ownerId: conv.owner_id,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    peer,
    members: members.map(m => ({
      ...publicUser(m),
      role: m.role,
      joinedAt: m.joined_at,
    })),
    lastMessage,
    unread,
    muted: !!mem.muted,
    pinned: !!mem.pinned,
    archived: !!mem.archived,
    myRole: mem.role,
    pinnedMessages: pins,
  };
}

export function listConversations(userId) {
  const rows = db.all(
    `SELECT c.* FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = ? AND cm.hidden = 0
     ORDER BY cm.pinned DESC, c.updated_at DESC`,
    [userId]
  );
  return rows.map(c => shapeConversation(c, userId)).filter(Boolean);
}

export function findDm(a, b) {
  return db.get(
    `SELECT c.* FROM conversations c
     JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
     JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
     WHERE c.type = 'dm'
     LIMIT 1`,
    [a, b]
  );
}

export function createDm(a, b) {
  const existing = findDm(a, b);
  if (existing) {
    db.run('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND user_id = ?', [existing.id, a]);
    return existing;
  }
  const cid = id('c_');
  const t = now();
  db.transaction(() => {
    db.run(
      'INSERT INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [cid, 'dm', t, t]
    );
    db.run(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      [cid, a, 'member', t]
    );
    db.run(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      [cid, b, 'member', t]
    );
  });
  return db.get('SELECT * FROM conversations WHERE id = ?', [cid]);
}

export function createNotification({ userId, type, title, body, data }) {
  const nid = id('n_');
  db.run(
    'INSERT INTO notifications (id, user_id, type, title, body, data, read, created_at) VALUES (?,?,?,?,?,?,0,?)',
    [nid, userId, type, title, body || '', JSON.stringify(data || {}), now()]
  );
  return db.get('SELECT * FROM notifications WHERE id = ?', [nid]);
}

export function shapeNotification(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: parseJson(n.data, {}),
    read: !!n.read,
    createdAt: n.created_at,
  };
}

export function insertMessage({ conversationId, senderId, content, type, replyTo, clientId, forwardedFrom }) {
  if (clientId) {
    const existing = db.get('SELECT * FROM messages WHERE client_id = ? AND sender_id = ?', [clientId, senderId]);
    if (existing) return existing;
  }
  const mid = id('m_');
  const t = now();
  db.run(
    `INSERT INTO messages (id, conversation_id, sender_id, content, type, reply_to, client_id, forwarded_from, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [mid, conversationId, senderId, content || '', type || 'text', replyTo || null, clientId || null, forwardedFrom || null, t]
  );
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [t, conversationId]);
  db.run('UPDATE conversation_members SET hidden = 0, archived = 0 WHERE conversation_id = ?', [conversationId]);
  return db.get('SELECT * FROM messages WHERE id = ?', [mid]);
}

export function markDelivered(messageId, userId) {
  const existing = db.get('SELECT * FROM message_status WHERE message_id = ? AND user_id = ?', [messageId, userId]);
  if (existing?.status === 'seen') return existing;
  const t = now();
  if (existing) {
    if (existing.status === 'delivered') return existing;
    db.run('UPDATE message_status SET status = ?, at = ? WHERE message_id = ? AND user_id = ?', ['delivered', t, messageId, userId]);
  } else {
    db.run('INSERT INTO message_status (message_id, user_id, status, at) VALUES (?,?,?,?)', [messageId, userId, 'delivered', t]);
  }
  return { status: 'delivered' };
}

export function markConversationRead(conversationId, userId) {
  const t = now();
  db.run(
    'UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
    [t, conversationId, userId]
  );
  const msgs = db.all(
    `SELECT id FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted = 0 AND created_at > ?`,
    [conversationId, userId, t - 7 * 24 * 3600 * 1000]
  );
  for (const m of msgs) {
    const existing = db.get('SELECT * FROM message_status WHERE message_id = ? AND user_id = ?', [m.id, userId]);
    if (existing?.status === 'seen') continue;
    if (existing) {
      db.run('UPDATE message_status SET status = ?, at = ? WHERE message_id = ? AND user_id = ?', ['seen', t, m.id, userId]);
    } else {
      db.run('INSERT INTO message_status (message_id, user_id, status, at) VALUES (?,?,?,?)', [m.id, userId, 'seen', t]);
    }
  }
  return t;
}

const presence = new Map(); // userId -> { status, lastSeen, sockets: Set }
const typing = new Map(); // convId -> Map(userId -> timeout)

export function getPresence(userId) {
  const p = presence.get(userId);
  if (!p || p.sockets.size === 0) {
    const u = db.get('SELECT last_seen, status FROM users WHERE id = ?', [userId]);
    return { status: 'offline', lastSeen: u?.last_seen || null };
  }
  return { status: p.status, lastSeen: p.lastSeen };
}

export function setPresence(userId, status, io) {
  let p = presence.get(userId);
  if (!p) {
    p = { status, lastSeen: now(), sockets: new Set() };
    presence.set(userId, p);
  }
  p.status = status;
  p.lastSeen = now();
  db.run('UPDATE users SET status = ?, last_seen = ? WHERE id = ?', [status === 'offline' ? 'offline' : status, p.lastSeen, userId]);
  io.emit('presence', { userId, status, lastSeen: p.lastSeen });
}

export function addSocket(userId, socketId) {
  let p = presence.get(userId);
  if (!p) {
    p = { status: 'online', lastSeen: now(), sockets: new Set() };
    presence.set(userId, p);
  }
  p.sockets.add(socketId);
  p.status = 'online';
  p.lastSeen = now();
  db.run('UPDATE users SET status = ?, last_seen = ? WHERE id = ?', ['online', p.lastSeen, userId]);
  return p.sockets.size === 1;
}

export function removeSocket(userId, socketId) {
  const p = presence.get(userId);
  if (!p) return true;
  p.sockets.delete(socketId);
  if (p.sockets.size === 0) {
    p.status = 'offline';
    p.lastSeen = now();
    db.run('UPDATE users SET status = ?, last_seen = ? WHERE id = ?', ['offline', p.lastSeen, userId]);
    return true;
  }
  return false;
}

export { presence, typing, UPLOAD_ROOT };

export function registerRoutes(app, io) {
  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'RikiChat' }));

  app.post('/api/auth/register', async (req, res) => {
    if (!rateLimit('reg:' + req.ip, 8, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait.' });
    }
    const username = sanitizeText(req.body?.username || '', 20).toLowerCase();
    const displayName = sanitizeText(req.body?.displayName || '', 40);
    const password = String(req.body?.password || '');
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 chars, start with a letter, and use only letters, numbers, or _.' });
    }
    if (!DISPLAY_RE.test(displayName)) {
      return res.status(400).json({ error: 'Display name is invalid.' });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be 8–72 characters.' });
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must include letters and numbers.' });
    }
    const exists = db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) return res.status(409).json({ error: 'Username is already taken.' });
    const uid = id('u_');
    const hash = await hashPassword(password);
    const t = now();
    db.run(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, last_seen, status)
       VALUES (?,?,?,?,?,?,?)`,
      [uid, username, displayName, hash, t, t, 'online']
    );
    const token = signToken(uid);
    res.cookie('rc_token', token, COOKIE_OPTS);
    const user = publicUser(db.get('SELECT * FROM users WHERE id = ?', [uid]));
    res.json({ user, token });
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!rateLimit('login:' + req.ip, 12, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait.' });
    }
    const username = sanitizeText(req.body?.username || '', 20).toLowerCase();
    const password = String(req.body?.password || '');
    const u = db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!u || !(await verifyPassword(password, u.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = signToken(u.id);
    res.cookie('rc_token', token, COOKIE_OPTS);
    res.json({ user: publicUser(u), token });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('rc_token', { ...COOKIE_OPTS, maxAge: 0 });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.patch('/api/users/me', requireAuth, (req, res) => {
    const displayName = req.body?.displayName != null ? sanitizeText(req.body.displayName, 40) : null;
    const bio = req.body?.bio != null ? sanitizeText(req.body.bio, 180) : null;
    let username = req.body?.username != null ? sanitizeText(req.body.username, 20).toLowerCase() : null;
    if (displayName !== null) {
      if (!DISPLAY_RE.test(displayName)) return res.status(400).json({ error: 'Display name is invalid.' });
      db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, req.user.id]);
    }
    if (bio !== null) {
      db.run('UPDATE users SET bio = ? WHERE id = ?', [bio, req.user.id]);
    }
    if (username !== null && username !== req.user.username) {
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username is invalid.' });
      const last = req.user.username_changed_at || 0;
      if (now() - last < 14 * 24 * 3600 * 1000 && last > 0) {
        return res.status(400).json({ error: 'You can change your username once every 14 days.' });
      }
      if (db.get('SELECT id FROM users WHERE username = ?', [username])) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      db.run('UPDATE users SET username = ?, username_changed_at = ? WHERE id = ?', [username, now(), req.user.id]);
    }
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: publicUser(u) });
  });

  app.get('/api/users/search', requireAuth, (req, res) => {
    const q = sanitizeText(req.query.q || '', 40).toLowerCase();
    if (q.length < 1) return res.json({ users: [] });
    const like = `%${q.replace(/%/g, '')}%`;
    const users = db.all(
      `SELECT * FROM users WHERE id != ? AND (username LIKE ? OR display_name LIKE ?) LIMIT 20`,
      [req.user.id, like, like]
    ).map(publicUser);
    res.json({ users });
  });

  app.get('/api/users/:id', requireAuth, (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const blocked = !!db.get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, u.id]);
    const blockedBy = !!db.get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [u.id, req.user.id]);
    const pres = getPresence(u.id);
    res.json({
      user: { ...publicUser(u), status: pres.status, lastSeen: pres.lastSeen },
      blocked,
      blockedBy,
    });
  });

  app.post('/api/users/:id/block', requireAuth, (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot block yourself.' });
    const u = db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    db.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)', [req.user.id, req.params.id, now()]);
    res.json({ ok: true });
  });

  app.delete('/api/users/:id/block', requireAuth, (req, res) => {
    db.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, req.params.id]);
    res.json({ ok: true });
  });

  app.get('/api/users/me/blocks', requireAuth, (req, res) => {
    const rows = db.all(
      `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`,
      [req.user.id]
    );
    res.json({ users: rows.map(publicUser) });
  });

  app.get('/api/conversations', requireAuth, (req, res) => {
    res.json({ conversations: listConversations(req.user.id) });
  });

  app.post('/api/conversations/dm', requireAuth, (req, res) => {
    const userId = req.body?.userId;
    if (!userId || userId === req.user.id) return res.status(400).json({ error: 'Invalid user.' });
    const u = db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    if (isBlocked(req.user.id, userId)) return res.status(403).json({ error: 'You cannot message this user.' });
    const conv = createDm(req.user.id, userId);
    res.json({ conversation: shapeConversation(conv, req.user.id) });
  });

  app.post('/api/conversations/group', requireAuth, (req, res) => {
    const name = sanitizeText(req.body?.name || '', 60);
    if (name.length < 2) return res.status(400).json({ error: 'Group name is required.' });
    const description = sanitizeText(req.body?.description || '', 240);
    let memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds.slice(0, 80) : [];
    memberIds = [...new Set(memberIds.filter(x => x && x !== req.user.id))];
    const cid = id('c_');
    const t = now();
    db.run(
      'INSERT INTO conversations (id, type, name, description, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [cid, 'group', name, description, req.user.id, t, t]
    );
    db.run(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
      [cid, req.user.id, 'owner', t]
    );
    for (const uid of memberIds) {
      const u = db.get('SELECT id FROM users WHERE id = ?', [uid]);
      if (!u || isBlocked(req.user.id, uid)) continue;
      db.run(
        'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
        [cid, uid, 'member', t]
      );
    }
    const sys = insertMessage({
      conversationId: cid,
      senderId: req.user.id,
      content: `${req.user.display_name} created the group`,
      type: 'system',
    });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [cid]);
    const shaped = shapeConversation(conv, req.user.id);
    io.to(`user:${req.user.id}`).emit('conversation:upsert', shaped);
    for (const uid of memberIds) {
      const c = shapeConversation(conv, uid);
      io.to(`user:${uid}`).emit('conversation:upsert', c);
      const n = createNotification({
        userId: uid,
        type: 'group_invite',
        title: 'Group invitation',
        body: `You were added to ${name}`,
        data: { conversationId: cid },
      });
      io.to(`user:${uid}`).emit('notification', shapeNotification(n));
    }
    io.to(`conv:${cid}`).emit('message:new', shapeMessage(sys, req.user.id, memberIdsOf(cid)));
    res.json({ conversation: shaped });
  });

  app.get('/api/conversations/:id', requireAuth, (req, res) => {
    if (!memberOf(req.params.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json({ conversation: shapeConversation(conv, req.user.id) });
  });

  app.patch('/api/conversations/:id', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem) return res.status(403).json({ error: 'Forbidden' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    const body = req.body || {};
    if (typeof body.muted === 'boolean') {
      db.run('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?', [body.muted ? 1 : 0, conv.id, req.user.id]);
    }
    if (typeof body.pinned === 'boolean') {
      db.run('UPDATE conversation_members SET pinned = ? WHERE conversation_id = ? AND user_id = ?', [body.pinned ? 1 : 0, conv.id, req.user.id]);
    }
    if (typeof body.archived === 'boolean') {
      db.run('UPDATE conversation_members SET archived = ? WHERE conversation_id = ? AND user_id = ?', [body.archived ? 1 : 0, conv.id, req.user.id]);
    }
    if (body.hidden === true) {
      db.run('UPDATE conversation_members SET hidden = 1 WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.id]);
    }
    if (conv.type === 'group' && (mem.role === 'owner' || mem.role === 'admin')) {
      if (body.name) {
        const name = sanitizeText(body.name, 60);
        if (name.length >= 2) db.run('UPDATE conversations SET name = ? WHERE id = ?', [name, conv.id]);
      }
      if (body.description != null) {
        db.run('UPDATE conversations SET description = ? WHERE id = ?', [sanitizeText(body.description, 240), conv.id]);
      }
    }
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    const shaped = shapeConversation(updated, req.user.id);
    io.to(`user:${req.user.id}`).emit('conversation:upsert', shaped);
    if (conv.type === 'group' && (body.name || body.description != null)) {
      for (const uid of memberIdsOf(conv.id)) {
        io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
      }
    }
    res.json({ conversation: shaped });
  });

  app.post('/api/conversations/:id/clear', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem) return res.status(403).json({ error: 'Forbidden' });
    db.run('UPDATE conversation_members SET cleared_at = ?, last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
      [now(), now(), req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
    if (!memberOf(req.params.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    markConversationRead(req.params.id, req.user.id);
    io.to(`conv:${req.params.id}`).emit('conversation:read', {
      conversationId: req.params.id,
      userId: req.user.id,
      at: now(),
    });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    io.to(`user:${req.user.id}`).emit('conversation:upsert', shapeConversation(conv, req.user.id));
    res.json({ ok: true });
  });

  app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(80, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const before = req.query.before ? Number(req.query.before) : now() + 1000;
    const ids = memberIdsOf(req.params.id);
    const rows = db.all(
      `SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? AND created_at > ?
       ORDER BY created_at DESC LIMIT ?`,
      [req.params.id, before, mem.cleared_at || 0, limit + 1]
    );
    const hasMore = rows.length > limit;
    const slice = rows.slice(0, limit).reverse();
    const messages = slice.map(m => shapeMessage(m, req.user.id, ids)).filter(Boolean);
    res.json({ messages, hasMore });
  });

  app.get('/api/conversations/:id/media', requireAuth, (req, res) => {
    if (!memberOf(req.params.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const mem = memberOf(req.params.id, req.user.id);
    const rows = db.all(
      `SELECT a.*, m.created_at, m.type AS msg_type, m.content FROM attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE m.conversation_id = ? AND m.deleted = 0 AND m.created_at > ?
       ORDER BY m.created_at DESC LIMIT 200`,
      [req.params.id, mem.cleared_at || 0]
    );
    const media = [];
    const files = [];
    const links = [];
    for (const r of rows) {
      const item = {
        id: r.id,
        messageId: r.message_id,
        fileUrl: r.file_url,
        fileName: r.file_name,
        fileType: r.file_type,
        fileSize: r.file_size,
        createdAt: r.created_at,
        mime: r.mime,
      };
      if (r.file_type === 'image' || r.file_type === 'video') media.push(item);
      else files.push(item);
    }
    const msgs = db.all(
      `SELECT id, content, created_at FROM messages
       WHERE conversation_id = ? AND deleted = 0 AND created_at > ? AND type = 'text'
       ORDER BY created_at DESC LIMIT 400`,
      [req.params.id, mem.cleared_at || 0]
    );
    const urlRe = /https?:\/\/[^\s<>]+/gi;
    for (const m of msgs) {
      const found = m.content?.match(urlRe);
      if (found) {
        for (const url of found) links.push({ messageId: m.id, url, createdAt: m.created_at });
      }
    }
    const pins = db.all(
      `SELECT p.*, m.content, m.type, m.deleted FROM pins p
       JOIN messages m ON m.id = p.message_id WHERE p.conversation_id = ? ORDER BY p.pinned_at DESC`,
      [req.params.id]
    );
    res.json({ media, files, links, pins: pins.map(p => ({
      messageId: p.message_id, content: p.deleted ? '' : p.content, type: p.type, pinnedAt: p.pinned_at,
    })) });
  });

  app.post('/api/conversations/:id/members', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (conv.type !== 'group') return res.status(400).json({ error: 'Not a group' });
    const userId = req.body?.userId;
    const u = db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (memberOf(conv.id, userId)) return res.status(409).json({ error: 'Already a member' });
    db.run(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
      [conv.id, userId, 'member', now()]
    );
    const sys = insertMessage({
      conversationId: conv.id,
      senderId: req.user.id,
      content: `${req.user.display_name} added ${u.display_name}`,
      type: 'system',
    });
    const ids = memberIdsOf(conv.id);
    io.to(`conv:${conv.id}`).emit('message:new', shapeMessage(sys, req.user.id, ids));
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    for (const uid of ids) io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
    const n = createNotification({
      userId,
      type: 'group_invite',
      title: 'Group invitation',
      body: `You were added to ${conv.name}`,
      data: { conversationId: conv.id },
    });
    io.to(`user:${userId}`).emit('notification', shapeNotification(n));
    res.json({ ok: true, conversation: shapeConversation(updated, req.user.id) });
  });

  app.delete('/api/conversations/:id/members/:userId', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv || conv.type !== 'group') return res.status(400).json({ error: 'Not a group' });
    const targetId = req.params.userId;
    const target = memberOf(conv.id, targetId);
    if (!target) return res.status(404).json({ error: 'Not a member' });
    const leaving = targetId === req.user.id;
    if (!leaving && mem.role !== 'owner' && mem.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    if (!leaving && target.role === 'owner') return res.status(403).json({ error: 'Cannot remove the owner.' });
    if (!leaving && target.role === 'admin' && mem.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
    db.run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv.id, targetId]);
    const u = db.get('SELECT * FROM users WHERE id = ?', [targetId]);
    const sys = insertMessage({
      conversationId: conv.id,
      senderId: req.user.id,
      content: leaving ? `${req.user.display_name} left the group` : `${req.user.display_name} removed ${u?.display_name || 'a member'}`,
      type: 'system',
    });
    const ids = memberIdsOf(conv.id);
    io.to(`conv:${conv.id}`).emit('message:new', shapeMessage(sys, req.user.id, ids));
    io.to(`user:${targetId}`).emit('conversation:removed', { conversationId: conv.id });
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    for (const uid of ids) io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
    res.json({ ok: true });
  });

  app.patch('/api/conversations/:id/members/:userId', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!mem || mem.role !== 'owner' || conv.type !== 'group') return res.status(403).json({ error: 'Forbidden' });
    const role = req.body?.role;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const target = memberOf(conv.id, req.params.userId);
    if (!target || target.role === 'owner') return res.status(400).json({ error: 'Cannot change this member.' });
    db.run('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?', [role, conv.id, req.params.userId]);
    const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.userId]);
    const sys = insertMessage({
      conversationId: conv.id,
      senderId: req.user.id,
      content: role === 'admin'
        ? `${u?.display_name} is now an admin`
        : `${u?.display_name} is no longer an admin`,
      type: 'system',
    });
    const ids = memberIdsOf(conv.id);
    io.to(`conv:${conv.id}`).emit('message:new', shapeMessage(sys, req.user.id, ids));
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    for (const uid of ids) io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
    res.json({ ok: true });
  });

  app.delete('/api/conversations/:id', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    if (conv.type === 'group') {
      if (mem?.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this group.' });
      const ids = memberIdsOf(conv.id);
      db.run('DELETE FROM conversation_members WHERE conversation_id = ?', [conv.id]);
      for (const uid of ids) io.to(`user:${uid}`).emit('conversation:removed', { conversationId: conv.id });
      res.json({ ok: true });
      return;
    }
    db.run('UPDATE conversation_members SET hidden = 1 WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.id]);
    res.json({ ok: true });
  });

  app.post('/api/conversations/:id/invite', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!mem || conv?.type !== 'group') return res.status(403).json({ error: 'Forbidden' });
    if (mem.role !== 'owner' && mem.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const code = id('').replace(/_/g, '').slice(0, 8).toUpperCase();
    const expires = now() + 7 * 24 * 3600 * 1000;
    db.run(
      'INSERT INTO invites (code, conversation_id, created_by, expires_at, created_at) VALUES (?,?,?,?,?)',
      [code, conv.id, req.user.id, expires, now()]
    );
    res.json({ code, url: `/join/${code}`, expiresAt: expires });
  });

  app.post('/api/conversations/:id/invite/revoke', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    db.run('UPDATE invites SET revoked = 1 WHERE conversation_id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.get('/api/join/:code', requireAuth, (req, res) => {
    const inv = db.get('SELECT * FROM invites WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!inv || inv.revoked) return res.status(404).json({ error: 'Invite is invalid or expired.' });
    if (inv.expires_at && inv.expires_at < now()) return res.status(410).json({ error: 'Invite has expired.' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [inv.conversation_id]);
    res.json({ conversation: { id: conv.id, name: conv.name, avatar: conv.avatar, description: conv.description, type: conv.type } });
  });

  app.post('/api/join/:code', requireAuth, (req, res) => {
    const inv = db.get('SELECT * FROM invites WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!inv || inv.revoked) return res.status(404).json({ error: 'Invite is invalid or expired.' });
    if (inv.expires_at && inv.expires_at < now()) return res.status(410).json({ error: 'Invite has expired.' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [inv.conversation_id]);
    if (memberOf(conv.id, req.user.id)) {
      return res.json({ conversation: shapeConversation(conv, req.user.id) });
    }
    db.run(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
      [conv.id, req.user.id, 'member', now()]
    );
    db.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', [inv.code]);
    const sys = insertMessage({
      conversationId: conv.id,
      senderId: req.user.id,
      content: `${req.user.display_name} joined via invite`,
      type: 'system',
    });
    const ids = memberIdsOf(conv.id);
    io.to(`conv:${conv.id}`).emit('message:new', shapeMessage(sys, req.user.id, ids));
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    for (const uid of ids) io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
    res.json({ conversation: shapeConversation(updated, req.user.id) });
  });

  app.post('/api/conversations/:id/pin', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem) return res.status(403).json({ error: 'Forbidden' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (conv.type === 'group' && mem.role === 'member') return res.status(403).json({ error: 'Only admins can pin messages.' });
    const messageId = req.body?.messageId;
    const msg = db.get('SELECT * FROM messages WHERE id = ? AND conversation_id = ?', [messageId, conv.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    db.run('INSERT OR REPLACE INTO pins (conversation_id, message_id, pinned_by, pinned_at) VALUES (?,?,?,?)',
      [conv.id, messageId, req.user.id, now()]);
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    for (const uid of memberIdsOf(conv.id)) {
      io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
    }
    res.json({ ok: true });
  });

  app.delete('/api/conversations/:id/pin/:messageId', requireAuth, (req, res) => {
    const mem = memberOf(req.params.id, req.user.id);
    if (!mem) return res.status(403).json({ error: 'Forbidden' });
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (conv.type === 'group' && mem.role === 'member') return res.status(403).json({ error: 'Forbidden' });
    db.run('DELETE FROM pins WHERE conversation_id = ? AND message_id = ?', [conv.id, req.params.messageId]);
    const updated = db.get('SELECT * FROM conversations WHERE id = ?', [conv.id]);
    for (const uid of memberIdsOf(conv.id)) {
      io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(updated, uid));
    }
    res.json({ ok: true });
  });

  app.post('/api/upload', requireAuth, (req, res) => {
    // handled by multer in index — this is a fallback
    res.status(400).json({ error: 'No file' });
  });

  app.get('/api/search', requireAuth, (req, res) => {
    if (!rateLimit('search:' + req.user.id, 30, 60 * 1000)) {
      return res.status(429).json({ error: 'Slow down.' });
    }
    const q = sanitizeText(req.query.q || '', 80);
    if (q.length < 1) return res.json({ users: [], groups: [], messages: [] });
    const like = `%${q.replace(/%/g, '').replace(/_/g, '')}%`;
    const users = db.all(
      `SELECT * FROM users WHERE id != ? AND (username LIKE ? OR display_name LIKE ?) LIMIT 12`,
      [req.user.id, like, like]
    ).map(publicUser);
    const groups = db.all(
      `SELECT c.* FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ? AND c.type = 'group' AND c.name LIKE ? LIMIT 12`,
      [req.user.id, like]
    ).map(c => shapeConversation(c, req.user.id));
    const msgs = db.all(
      `SELECT m.* FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
       WHERE m.deleted = 0 AND m.type = 'text' AND m.content LIKE ?
         AND m.created_at > cm.cleared_at
       ORDER BY m.created_at DESC LIMIT 30`,
      [req.user.id, like]
    );
    const messages = msgs.map(m => {
      const sender = db.get('SELECT * FROM users WHERE id = ?', [m.sender_id]);
      const conv = db.get('SELECT * FROM conversations WHERE id = ?', [m.conversation_id]);
      return {
        id: m.id,
        conversationId: m.conversation_id,
        conversationName: conv?.type === 'group' ? conv.name : publicUser(sender)?.displayName,
        content: m.content,
        createdAt: m.created_at,
        sender: publicUser(sender),
      };
    });
    res.json({ users, groups, messages });
  });

  app.get('/api/notifications', requireAuth, (req, res) => {
    const rows = db.all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 80',
      [req.user.id]
    );
    res.json({ notifications: rows.map(shapeNotification) });
  });

  app.post('/api/notifications/read', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (req.body?.all) {
      db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
    } else if (ids.length) {
      for (const nid of ids.slice(0, 100)) {
        db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [nid, req.user.id]);
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/reports', requireAuth, (req, res) => {
    const targetType = req.body?.targetType;
    const targetId = req.body?.targetId;
    const reason = sanitizeText(req.body?.reason || '', 400);
    if (!['user', 'message'].includes(targetType) || !targetId) {
      return res.status(400).json({ error: 'Invalid report.' });
    }
    db.run(
      'INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?)',
      [id('r_'), req.user.id, targetType, targetId, reason, now()]
    );
    res.json({ ok: true });
  });

  app.post('/api/messages/:id/forward', requireAuth, (req, res) => {
    const msg = db.get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!msg || msg.deleted) return res.status(404).json({ error: 'Message not found' });
    if (!memberOf(msg.conversation_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const targets = Array.isArray(req.body?.conversationIds) ? req.body.conversationIds.slice(0, 8) : [];
    const created = [];
    for (const cid of targets) {
      if (!memberOf(cid, req.user.id)) continue;
      const copy = insertMessage({
        conversationId: cid,
        senderId: req.user.id,
        content: msg.content,
        type: msg.type,
        forwardedFrom: msg.id,
        clientId: id('fwd_'),
      });
      const atts = db.all('SELECT * FROM attachments WHERE message_id = ?', [msg.id]);
      for (const a of atts) {
        db.run(
          `INSERT INTO attachments (id, message_id, file_url, file_name, file_type, mime, file_size, width, height, duration)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id('a_'), copy.id, a.file_url, a.file_name, a.file_type, a.mime, a.file_size, a.width, a.height, a.duration]
        );
      }
      const ids = memberIdsOf(cid);
      const shaped = shapeMessage(copy, req.user.id, ids);
      io.to(`conv:${cid}`).emit('message:new', shaped);
      const conv = db.get('SELECT * FROM conversations WHERE id = ?', [cid]);
      for (const uid of ids) io.to(`user:${uid}`).emit('conversation:upsert', shapeConversation(conv, uid));
      created.push(shaped);
    }
    res.json({ messages: created });
  });
}
