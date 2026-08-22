async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = sessionStorage.getItem('rc_token');
  if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/auth/me'),
  login: (body) => req('/api/auth/login', { method: 'POST', body }),
  register: (body) => req('/api/auth/register', { method: 'POST', body }),
  logout: () => req('/api/auth/logout', { method: 'POST', body: {} }),
  updateMe: (body) => req('/api/users/me', { method: 'PATCH', body }),
  uploadAvatar: (file) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return req('/api/users/me/avatar', { method: 'POST', body: fd });
  },
  searchUsers: (q) => req('/api/users/search?q=' + encodeURIComponent(q)),
  getUser: (id) => req('/api/users/' + id),
  block: (id) => req('/api/users/' + id + '/block', { method: 'POST', body: {} }),
  unblock: (id) => req('/api/users/' + id + '/block', { method: 'DELETE' }),
  blocks: () => req('/api/users/me/blocks'),
  conversations: () => req('/api/conversations'),
  getConversation: (id) => req('/api/conversations/' + id),
  openDm: (userId) => req('/api/conversations/dm', { method: 'POST', body: { userId } }),
  createGroup: (body) => req('/api/conversations/group', { method: 'POST', body }),
  patchConversation: (id, body) => req('/api/conversations/' + id, { method: 'PATCH', body }),
  clearChat: (id) => req('/api/conversations/' + id + '/clear', { method: 'POST', body: {} }),
  readChat: (id) => req('/api/conversations/' + id + '/read', { method: 'POST', body: {} }),
  messages: (id, before) => req(`/api/conversations/${id}/messages?limit=40${before ? '&before=' + before : ''}`),
  media: (id) => req('/api/conversations/' + id + '/media'),
  addMember: (id, userId) => req(`/api/conversations/${id}/members`, { method: 'POST', body: { userId } }),
  removeMember: (id, userId) => req(`/api/conversations/${id}/members/${userId}`, { method: 'DELETE' }),
  patchMember: (id, userId, role) => req(`/api/conversations/${id}/members/${userId}`, { method: 'PATCH', body: { role } }),
  deleteConversation: (id) => req('/api/conversations/' + id, { method: 'DELETE' }),
  invite: (id) => req(`/api/conversations/${id}/invite`, { method: 'POST', body: {} }),
  revokeInvites: (id) => req(`/api/conversations/${id}/invite/revoke`, { method: 'POST', body: {} }),
  getInvite: (code) => req('/api/join/' + code),
  joinInvite: (code) => req('/api/join/' + code, { method: 'POST', body: {} }),
  pin: (id, messageId) => req(`/api/conversations/${id}/pin`, { method: 'POST', body: { messageId } }),
  unpin: (id, messageId) => req(`/api/conversations/${id}/pin/${messageId}`, { method: 'DELETE' }),
  search: (q) => req('/api/search?q=' + encodeURIComponent(q)),
  notifications: () => req('/api/notifications'),
  readNotifications: (body) => req('/api/notifications/read', { method: 'POST', body }),
  report: (body) => req('/api/reports', { method: 'POST', body }),
  forward: (id, conversationIds) => req(`/api/messages/${id}/forward`, { method: 'POST', body: { conversationIds } }),
  upload: async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return req('/api/upload', { method: 'POST', body: fd });
  },
};

export async function compressImage(file, max = 1600) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}
