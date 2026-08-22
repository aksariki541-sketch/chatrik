export function initials(name = '') {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return ((p[0][0] || '') + (p[1]?.[0] || '')).toUpperCase().slice(0, 2);
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(ts);
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  if (now - d < 6 * 24 * 3600 * 1000) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDateSep(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function formatLastSeen(ts) {
  if (!ts) return 'last seen recently';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return 'last seen just now';
  if (diff < 60 * 60 * 1000) return `last seen ${Math.floor(diff / 60000)} min ago`;
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return `last seen today at ${formatTime(ts)}`;
  return `last seen ${d.toLocaleDateString()} at ${formatTime(ts)}`;
}

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function linkify(text) {
  const url = /(https?:\/\/[^\s<]+)/g;
  const parts = String(text || '').split(url);
  return parts;
}

export const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😴',
  '😭','😡','🤯','🤩','😇','🙃','😐','😤','🥺','😬',
  '👍','👎','👏','🙌','🙏','💪','🔥','✨','💯','🎉',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕',
  '👋','🤝','👀','💬','✅','❌','⭐','🌙','☀️','⚡',
];

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

export function draftKey(id) {
  return `rc_draft_${id}`;
}

export function nid() {
  return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
