import { create } from 'zustand';
import { api } from './api.js';
import { draftKey } from './format.js';

function upsertConv(list, conv) {
  if (!conv) return list;
  const i = list.findIndex((c) => c.id === conv.id);
  const next = i >= 0 ? list.map((c, idx) => (idx === i ? { ...c, ...conv } : c)) : [conv, ...list];
  next.sort((a, b) => (b.pinned - a.pinned) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
  return next;
}

function mergeMsg(items, msg) {
  if (!msg) return items;
  const byClient = msg.clientId ? items.findIndex((m) => m.clientId === msg.clientId || m.id === msg.clientId) : -1;
  const byId = items.findIndex((m) => m.id === msg.id);
  const idx = byId >= 0 ? byId : byClient;
  if (idx >= 0) {
    const next = items.slice();
    next[idx] = { ...next[idx], ...msg, pending: false, failed: false };
    return next;
  }
  return [...items, msg].sort((a, b) => a.createdAt - b.createdAt);
}

export const useStore = create((set, get) => ({
  user: null,
  bootstrapped: false,
  conversations: [],
  messages: {},
  presence: {},
  typing: {},
  notifications: [],
  connection: 'connecting',
  activeId: null,
  toast: null,
  socket: null,

  setUser: (user) => set({ user }),
  setSocket: (socket) => set({ socket }),
  setConnection: (connection) => set({ connection }),
  setActive: (activeId) => set({ activeId }),
  toastMsg: (toast) => {
    set({ toast });
    if (toast) setTimeout(() => set({ toast: null }), 2800);
  },

  bootstrap: async () => {
    try {
      const { user } = await api.me();
      const [{ conversations }, { notifications }] = await Promise.all([
        api.conversations(),
        api.notifications(),
      ]);
      set({ user, conversations, notifications, bootstrapped: true });
      return user;
    } catch {
      set({ user: null, bootstrapped: true });
      return null;
    }
  },

  upsertConversation: (conv) => set({ conversations: upsertConv(get().conversations, conv) }),
  removeConversation: (id) => set({
    conversations: get().conversations.filter((c) => c.id !== id),
    activeId: get().activeId === id ? null : get().activeId,
  }),

  setPresence: (userId, payload) => set({
    presence: { ...get().presence, [userId]: payload },
  }),
  setPresenceMap: (map) => set({ presence: { ...get().presence, ...map } }),

  setTyping: (conversationId, userId, on, displayName) => {
    const cur = { ...(get().typing[conversationId] || {}) };
    if (on) cur[userId] = displayName;
    else delete cur[userId];
    set({ typing: { ...get().typing, [conversationId]: cur } });
  },

  addNotification: (n) => set({ notifications: [n, ...get().notifications].slice(0, 80) }),

  pushMessage: (msg) => {
    if (!msg) return;
    const cid = msg.conversationId;
    const bucket = get().messages[cid] || { items: [], hasMore: true };
    set({
      messages: {
        ...get().messages,
        [cid]: { ...bucket, items: mergeMsg(bucket.items, msg) },
      },
    });
  },

  removeMessage: (conversationId, id) => {
    const bucket = get().messages[conversationId];
    if (!bucket) return;
    set({
      messages: {
        ...get().messages,
        [conversationId]: { ...bucket, items: bucket.items.filter((m) => m.id !== id) },
      },
    });
  },

  loadMessages: async (id, { reset } = {}) => {
    const bucket = get().messages[id] || { items: [], hasMore: true, loading: false };
    if (bucket.loading) return;
    if (!reset && bucket.items.length && !bucket.hasMore) return;
    const before = !reset && bucket.items.length ? bucket.items[0].createdAt : undefined;
    set({
      messages: { ...get().messages, [id]: { ...bucket, loading: true } },
    });
    try {
      const { messages, hasMore } = await api.messages(id, before);
      const cur = get().messages[id] || { items: [] };
      const merged = reset
        ? messages
        : [...messages, ...cur.items].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
          .sort((a, b) => a.createdAt - b.createdAt);
      set({
        messages: { ...get().messages, [id]: { items: merged, hasMore, loading: false } },
      });
    } catch {
      set({
        messages: { ...get().messages, [id]: { ...(get().messages[id] || bucket), loading: false } },
      });
    }
  },

  saveDraft: (id, text) => {
    if (!id) return;
    if (text) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  },
  getDraft: (id) => localStorage.getItem(draftKey(id)) || '',
}));
