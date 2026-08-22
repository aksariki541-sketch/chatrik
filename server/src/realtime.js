import { db } from './db.js';
import {
  now, sanitizeText, verifyToken, publicUser,
} from './utils.js';
import {
  memberOf, memberIdsOf, shapeMessage, shapeConversation, insertMessage,
  markDelivered, markConversationRead, isBlocked, createNotification,
  shapeNotification, addSocket, removeSocket, setPresence, presence, typing,
  getPresence, rateLimit,
} from './http.js';

const REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '😡']);

export function attachRealtime(io) {
  io.use((socket, next) => {
    const cookie = socket.handshake.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)rc_token=([^;]+)/);
    const token = socket.handshake.auth?.token || (m ? decodeURIComponent(m[1]) : null);
    const payload = token ? verifyToken(token) : null;
    if (!payload?.uid) return next(new Error('Unauthorized'));
    const user = db.get('SELECT * FROM users WHERE id = ?', [payload.uid]);
    if (!user) return next(new Error('Unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`);
    const convs = db.all(
      'SELECT conversation_id FROM conversation_members WHERE user_id = ?',
      [user.id]
    );
    for (const c of convs) socket.join(`conv:${c.conversation_id}`);

    const first = addSocket(user.id, socket.id);
    if (first) {
      io.emit('presence', { userId: user.id, status: 'online', lastSeen: now() });
    }

    // Deliver pending messages
    for (const c of convs) {
      const pending = db.all(
        `SELECT id FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted = 0
         AND created_at > ? LIMIT 80`,
        [c.conversation_id, user.id, now() - 3 * 24 * 3600 * 1000]
      );
      for (const m of pending) markDelivered(m.id, user.id);
    }

    socket.emit('ready', {
      user: publicUser(user),
      presence: snapshotPresence(),
    });

    socket.on('presence', (data) => {
      const status = data?.status;
      if (!['online', 'away'].includes(status)) return;
      setPresence(user.id, status, io);
    });

    socket.on('typing', (data) => {
      const conversationId = data?.conversationId;
      const on = !!data?.on;
      if (!conversationId || !memberOf(conversationId, user.id)) return;
      if (!rateLimit('typ:' + user.id + conversationId, 8, 3000) && on) return;
      let map = typing.get(conversationId);
      if (!map) {
        map = new Map();
        typing.set(conversationId, map);
      }
      if (map.get(user.id)) clearTimeout(map.get(user.id));
      if (on) {
        map.set(user.id, setTimeout(() => {
          map.delete(user.id);
          socket.to(`conv:${conversationId}`).emit('typing', {
            conversationId, userId: user.id, on: false, displayName: user.display_name,
          });
        }, 2500));
      } else {
        map.delete(user.id);
      }
      socket.to(`conv:${conversationId}`).emit('typing', {
        conversationId, userId: user.id, on, displayName: user.display_name,
      });
    });

    socket.on('conversation:join', (data) => {
      const conversationId = data?.conversationId;
      if (!conversationId || !memberOf(conversationId, user.id)) return;
      socket.join(`conv:${conversationId}`);
    });

    socket.on('conversation:read', (data) => {
      const conversationId = data?.conversationId;
      if (!conversationId || !memberOf(conversationId, user.id)) return;
      markConversationRead(conversationId, user.id);
      io.to(`conv:${conversationId}`).emit('conversation:read', {
        conversationId, userId: user.id, at: now(),
      });
      const conv = db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
      socket.emit('conversation:upsert', shapeConversation(conv, user.id));
    });

    socket.on('message:send', (data, cb) => {
      try {
        const result = handleSend(io, socket, user, data);
        if (typeof cb === 'function') cb(result);
      } catch (err) {
        if (typeof cb === 'function') cb({ error: err.message || 'Failed to send' });
      }
    });

    socket.on('message:edit', (data, cb) => {
      try {
        const result = handleEdit(io, user, data);
        if (typeof cb === 'function') cb(result);
      } catch (err) {
        if (typeof cb === 'function') cb({ error: err.message || 'Failed' });
      }
    });

    socket.on('message:delete', (data, cb) => {
      try {
        const result = handleDelete(io, user, data);
        if (typeof cb === 'function') cb(result);
      } catch (err) {
        if (typeof cb === 'function') cb({ error: err.message || 'Failed' });
      }
    });

    socket.on('message:react', (data, cb) => {
      try {
        const result = handleReact(io, user, data);
        if (typeof cb === 'function') cb(result);
      } catch (err) {
        if (typeof cb === 'function') cb({ error: err.message || 'Failed' });
      }
    });

    socket.on('disconnect', () => {
      const last = removeSocket(user.id, socket.id);
      if (last) {
        io.emit('presence', { userId: user.id, status: 'offline', lastSeen: now() });
      }
    });
  });
}

function snapshotPresence() {
  const out = {};
  for (const [uid, p] of presence.entries()) {
    if (p.sockets.size > 0) out[uid] = { status: p.status, lastSeen: p.lastSeen };
  }
  return out;
}

function handleSend(io, socket, user, data) {
  const conversationId = data?.conversationId;
  if (!conversationId) throw new Error('Missing conversation');
  const mem = memberOf(conversationId, user.id);
  if (!mem) throw new Error('Forbidden');
  if (!rateLimit('msg:' + user.id, 16, 8000)) {
    const err = { error: "You're sending messages too quickly. Please wait a moment.", code: 'rate' };
    return err;
  }
  const conv = db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (conv.type === 'dm') {
    const ids = memberIdsOf(conversationId);
    const other = ids.find(x => x !== user.id);
    if (other && isBlocked(user.id, other)) throw new Error('You cannot message this user.');
  }
  const type = ['text', 'image', 'video', 'audio', 'file', 'voice'].includes(data.type) ? data.type : 'text';
  const content = sanitizeText(data.content || '', 4000);
  if (type === 'text' && !content) throw new Error('Message is empty');
  if (data.replyTo) {
    const orig = db.get('SELECT id FROM messages WHERE id = ? AND conversation_id = ?', [data.replyTo, conversationId]);
    if (!orig) data.replyTo = null;
  }
  const msg = insertMessage({
    conversationId,
    senderId: user.id,
    content,
    type,
    replyTo: data.replyTo || null,
    clientId: data.clientId || null,
    forwardedFrom: data.forwardedFrom || null,
  });
  if (Array.isArray(data.attachments)) {
    for (const a of data.attachments.slice(0, 6)) {
      if (!a?.fileUrl || !a?.fileName) continue;
      db.run(
        `INSERT INTO attachments (id, message_id, file_url, file_name, file_type, mime, file_size, width, height, duration)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [a.id || ('a_' + msg.id + Math.random().toString(36).slice(2, 8)),
          msg.id, a.fileUrl, a.fileName, a.fileType || type, a.mime || null,
          a.fileSize || 0, a.width || null, a.height || null, a.duration || null]
      );
    }
  }
  const ids = memberIdsOf(conversationId);
  for (const uid of ids) {
    if (uid === user.id) continue;
    const p = getPresence(uid);
    if (p.status !== 'offline') markDelivered(msg.id, uid);
  }
  const full = db.get('SELECT * FROM messages WHERE id = ?', [msg.id]);
  for (const uid of ids) {
    const shaped = shapeMessage(full, uid, ids);
    io.to(`user:${uid}`).emit('message:new', shaped);
    const convShaped = shapeConversation(conv, uid);
    io.to(`user:${uid}`).emit('conversation:upsert', convShaped);
    if (uid !== user.id) {
      const member = memberOf(conversationId, uid);
      if (member && !member.muted) {
        const title = conv.type === 'group' ? conv.name : user.display_name;
        const body = type === 'text'
          ? `${conv.type === 'group' ? user.display_name + ': ' : ''}${content.slice(0, 80)}`
          : `${user.display_name} sent ${type === 'voice' ? 'a voice message' : 'an attachment'}`;
        const n = createNotification({
          userId: uid,
          type: 'message',
          title: title || 'New message',
          body,
          data: { conversationId, messageId: msg.id },
        });
        io.to(`user:${uid}`).emit('notification', shapeNotification(n));
      }
    }
  }
  return { message: shapeMessage(full, user.id, ids) };
}

function handleEdit(io, user, data) {
  const msg = db.get('SELECT * FROM messages WHERE id = ?', [data?.id]);
  if (!msg) throw new Error('Not found');
  if (msg.sender_id !== user.id) throw new Error('Forbidden');
  if (msg.deleted) throw new Error('Cannot edit a deleted message');
  if (msg.type !== 'text') throw new Error('Only text messages can be edited');
  if (now() - msg.created_at > 24 * 3600 * 1000) throw new Error('Edit window expired');
  const content = sanitizeText(data.content || '', 4000);
  if (!content) throw new Error('Message is empty');
  db.run('UPDATE messages SET content = ?, edited = 1, edited_at = ? WHERE id = ?', [content, now(), msg.id]);
  const full = db.get('SELECT * FROM messages WHERE id = ?', [msg.id]);
  const ids = memberIdsOf(msg.conversation_id);
  const shaped = shapeMessage(full, user.id, ids);
  io.to(`conv:${msg.conversation_id}`).emit('message:updated', shaped);
  return { message: shaped };
}

function handleDelete(io, user, data) {
  const msg = db.get('SELECT * FROM messages WHERE id = ?', [data?.id]);
  if (!msg) throw new Error('Not found');
  if (!memberOf(msg.conversation_id, user.id)) throw new Error('Forbidden');
  const scope = data?.scope === 'everyone' ? 'everyone' : 'me';
  if (scope === 'everyone') {
    if (msg.sender_id !== user.id) throw new Error('Forbidden');
    db.run('UPDATE messages SET deleted = 1, content = ? WHERE id = ?', ['', msg.id]);
  } else {
    const arr = JSON.parse(msg.deleted_for || '[]');
    if (!arr.includes(user.id)) arr.push(user.id);
    db.run('UPDATE messages SET deleted_for = ? WHERE id = ?', [JSON.stringify(arr), msg.id]);
  }
  const full = db.get('SELECT * FROM messages WHERE id = ?', [msg.id]);
  const ids = memberIdsOf(msg.conversation_id);
  if (scope === 'everyone') {
    const shaped = shapeMessage(full, user.id, ids);
    io.to(`conv:${msg.conversation_id}`).emit('message:updated', shaped);
    return { message: shaped };
  }
  io.to(`user:${user.id}`).emit('message:removed', { id: msg.id, conversationId: msg.conversation_id });
  return { ok: true, id: msg.id };
}

function handleReact(io, user, data) {
  const msg = db.get('SELECT * FROM messages WHERE id = ?', [data?.id]);
  if (!msg || msg.deleted) throw new Error('Not found');
  if (!memberOf(msg.conversation_id, user.id)) throw new Error('Forbidden');
  const emoji = String(data?.emoji || '');
  if (!REACTIONS.has(emoji)) throw new Error('Invalid reaction');
  const existing = db.get(
    'SELECT * FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [msg.id, user.id, emoji]
  );
  if (existing || data?.remove) {
    db.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [msg.id, user.id, emoji]);
  } else {
    db.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ?', [msg.id, user.id]);
    db.run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?,?,?,?)',
      [msg.id, user.id, emoji, now()]);
  }
  const full = db.get('SELECT * FROM messages WHERE id = ?', [msg.id]);
  const ids = memberIdsOf(msg.conversation_id);
  const shaped = shapeMessage(full, user.id, ids);
  io.to(`conv:${msg.conversation_id}`).emit('message:updated', shaped);
  return { message: shaped };
}
