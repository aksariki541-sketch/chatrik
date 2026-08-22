import { io } from 'socket.io-client';
import { useStore } from './store.js';

let socket = null;

export function getSocket() {
  return socket;
}

export function connectSocket() {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    auth: { token: sessionStorage.getItem('rc_token') },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000,
  });
  const st = useStore.getState;
  const set = useStore.setState;

  socket.on('connect', () => {
    set({ connection: 'connected', socket });
    if (st().activeId) socket.emit('conversation:read', { conversationId: st().activeId });
  });
  socket.on('disconnect', () => set({ connection: 'reconnecting' }));
  socket.on('connect_error', () => set({ connection: 'reconnecting' }));
  socket.on('reconnect_attempt', () => set({ connection: 'reconnecting' }));
  socket.on('ready', (payload) => {
    if (payload?.presence) st().setPresenceMap(payload.presence);
  });
  socket.on('presence', ({ userId, status, lastSeen }) => {
    st().setPresence(userId, { status, lastSeen });
  });
  socket.on('typing', ({ conversationId, userId, on, displayName }) => {
    if (userId === st().user?.id) return;
    st().setTyping(conversationId, userId, on, displayName);
  });
  socket.on('message:new', (msg) => {
    st().pushMessage(msg);
    if (st().activeId === msg.conversationId && document.visibilityState === 'visible') {
      socket.emit('conversation:read', { conversationId: msg.conversationId });
    }
  });
  socket.on('message:updated', (msg) => st().pushMessage(msg));
  socket.on('message:removed', ({ id, conversationId }) => st().removeMessage(conversationId, id));
  socket.on('conversation:upsert', (conv) => st().upsertConversation(conv));
  socket.on('conversation:removed', ({ conversationId }) => st().removeConversation(conversationId));
  socket.on('conversation:read', ({ conversationId }) => {
    const bucket = st().messages[conversationId];
    if (!bucket) return;
    const uid = st().user?.id;
    const items = bucket.items.map((m) => {
      if (m.senderId !== uid) return m;
      return { ...m, status: 'seen' };
    });
    useStore.setState({
      messages: { ...st().messages, [conversationId]: { ...bucket, items } },
    });
  });
  socket.on('notification', (n) => {
    st().addNotification(n);
    maybeBrowserNotify(n);
  });

  useStore.setState({ socket });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

function maybeBrowserNotify(n) {
  if (document.visibilityState === 'visible') return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(n.title || 'RikiChat', { body: n.body || '', tag: n.id });
  } catch { /* ignore */ }
}

export function sendMessage(payload) {
  return new Promise((resolve) => {
    const s = getSocket();
    if (!s || !s.connected) {
      resolve({ error: 'Not connected' });
      return;
    }
    s.emit('message:send', payload, (res) => resolve(res || {}));
  });
}

export function emitEdit(payload) {
  return new Promise((resolve) => getSocket()?.emit('message:edit', payload, (r) => resolve(r || {})));
}
export function emitDelete(payload) {
  return new Promise((resolve) => getSocket()?.emit('message:delete', payload, (r) => resolve(r || {})));
}
export function emitReact(payload) {
  return new Promise((resolve) => getSocket()?.emit('message:react', payload, (r) => resolve(r || {})));
}
