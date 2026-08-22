import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Plus, Bell, Settings, ArrowLeft, MoreVertical, Paperclip, Smile,
  Send, Mic, Phone, Pin, VolumeX, Volume2, Archive, Trash2, UserX, Flag,
  LogOut, Users, Image as ImageIcon, FileText, Link2, X, Play, Pause,
  Copy, Reply, Pencil, Forward, Check, CheckCheck, AlertCircle,
} from 'lucide-react';
import { Avatar, Empty, SkeletonList, Modal } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { api, compressImage } from '../lib/api.js';
import { getSocket, sendMessage, emitEdit, emitDelete, emitReact } from '../lib/socket.js';
import {
  formatTime, formatListTime, formatDateSep, formatLastSeen, formatSize, formatDuration,
  EMOJIS, REACTIONS, nid, linkify,
} from '../lib/format.js';

function presenceOf(store, userId) {
  return store.presence[userId] || { status: 'offline' };
}

export function Sidebar({ tab, setTab, onOpenChat, onNewChat, onNewGroup, onOpenSearch, onOpenNotifs, onOpenSettings, onOpenProfile }) {
  const conversations = useStore((s) => s.conversations);
  const user = useStore((s) => s.user);
  const presence = useStore((s) => s.presence);
  const activeId = useStore((s) => s.activeId);
  const notifications = useStore((s) => s.notifications);
  const [q, setQ] = useState('');
  const unreadNotifs = notifications.filter((n) => !n.read).length;

  const filtered = useMemo(() => {
    let list = conversations;
    if (tab === 'groups') list = list.filter((c) => c.type === 'group' && !c.archived);
    else if (tab === 'archived') list = list.filter((c) => c.archived);
    else list = list.filter((c) => !c.archived);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((c) => (c.name || '').toLowerCase().includes(s) || (c.lastMessage?.content || '').toLowerCase().includes(s));
    }
    return list;
  }, [conversations, tab, q]);

  return (
    <aside className="sidebar">
      <div className="topbar">
        <div className="brand-row" style={{ margin: 0, gap: 10 }}>
          <div className="brand-logo" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <svg width="34" height="34" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b1220"/><path fill="#22d3ee" d="M16 22.5c0-5.8 5.2-10.5 11.6-10.5h8.8C42.8 12 48 16.7 48 22.5v9c0 5.8-5.2 10.5-11.6 10.5h-3.4L26 50.2c-.7.6-1.8.1-1.8-.8v-7.4h-3.6C21.2 42 16 37.3 16 31.5v-9z"/></svg>
          </div>
          <div className="brand-name" style={{ fontSize: 18 }}>RikiChat</div>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="icon-btn desktop-only" onClick={onOpenSearch} title="Search"><Search size={18} /></button>
          <button className="icon-btn" onClick={onOpenNotifs} title="Notifications">
            <Bell size={18} />
            {unreadNotifs > 0 && <span className="badge">{unreadNotifs > 9 ? '9+' : unreadNotifs}</span>}
          </button>
          <button className="icon-btn desktop-only" onClick={onOpenSettings} title="Settings"><Settings size={18} /></button>
        </div>
      </div>
      <div className="search-wrap">
        <Search size={16} />
        <input className="search-input" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => setTab('chats')}>Chats</button>
        <button className={`tab ${tab === 'groups' ? 'active' : ''}`} onClick={() => setTab('groups')}>Groups</button>
        <button className={`tab ${tab === 'archived' ? 'active' : ''}`} onClick={() => setTab('archived')}>Archive</button>
      </div>
      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost grow" style={{ height: 36 }} onClick={onNewChat}><Plus size={16} /> New chat</button>
        <button className="btn btn-ghost" style={{ height: 36, width: 36, padding: 0 }} onClick={onNewGroup} title="New group"><Users size={16} /></button>
      </div>
      <div className="chat-list">
        {filtered.length === 0 && (
          <div className="empty" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 15 }}>No conversations yet.</h3>
            <p>Start a new conversation</p>
          </div>
        )}
        {filtered.map((c) => {
          const peerId = c.peer?.id;
          const pres = peerId ? (presence[peerId] || {}) : {};
          const online = c.type === 'dm' && pres.status === 'online';
          return (
            <button
              key={c.id}
              className={`chat-item ${activeId === c.id ? 'active' : ''} ${c.muted ? 'muted' : ''}`}
              onClick={() => onOpenChat(c.id)}
            >
              <Avatar user={c.type === 'dm' ? c.peer : { displayName: c.name, avatar: c.avatar }} size={48} square={c.type === 'group'} showPresence={c.type === 'dm'} presence={pres} />
              <div className="chat-item-body">
                <div className="chat-item-top">
                  <div className="chat-item-name">{c.pinned ? '📌 ' : ''}{c.name}</div>
                  <div className="chat-item-time">{formatListTime(c.lastMessage?.createdAt || c.updatedAt)}</div>
                </div>
                <div className="chat-item-bottom">
                  <div className="chat-item-preview">
                    {c.lastMessage?.deleted
                      ? 'This message was deleted'
                      : c.lastMessage?.type && c.lastMessage.type !== 'text' && c.lastMessage.type !== 'deleted'
                        ? (c.type === 'group' && c.lastMessage.senderName ? `${c.lastMessage.senderName}: ` : '') + (c.lastMessage.type === 'voice' ? '🎤 Voice message' : `📎 ${c.lastMessage.type}`)
                        : (c.type === 'group' && c.lastMessage?.senderName ? `${c.lastMessage.senderName}: ` : '') + (c.lastMessage?.content || 'No messages yet')}
                  </div>
                  {c.unread > 0 && <span className="unread">{c.unread > 99 ? '99+' : c.unread}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <button onClick={onOpenProfile} style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, textAlign: 'left' }}>
          <Avatar user={user} size={40} showPresence presence={{ status: 'online' }} />
          <div className="me-meta">
            <div className="me-name">{user?.displayName}</div>
            <div className="me-user">@{user?.username}</div>
          </div>
        </button>
        <button className="icon-btn" onClick={onOpenSettings}><Settings size={18} /></button>
      </div>
    </aside>
  );
}

export function ChatView({ onBack, onOpenDetails, detailsOpen }) {
  const activeId = useStore((s) => s.activeId);
  const conv = useStore((s) => s.conversations.find((c) => c.id === activeId));
  const bucket = useStore((s) => s.messages[activeId]);
  const user = useStore((s) => s.user);
  const presence = useStore((s) => s.presence);
  const typing = useStore((s) => s.typing[activeId] || {});
  const loadMessages = useStore((s) => s.loadMessages);
  const scroller = useRef(null);
  const bottom = useRef(null);
  const stick = useRef(true);
  const [menu, setMenu] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [viewer, setViewer] = useState(null);

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId, { reset: !bucket?.items?.length });
    getSocket()?.emit('conversation:join', { conversationId: activeId });
    getSocket()?.emit('conversation:read', { conversationId: activeId });
    api.readChat(activeId).catch(() => {});
  }, [activeId]);

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [bucket?.items?.length, Object.keys(typing).length]);

  if (!activeId) {
    return (
      <div className="welcome">
        <svg width="72" height="72" viewBox="0 0 64 64" aria-hidden>
          <rect width="64" height="64" rx="18" fill="#0b1220" />
          <path fill="#22d3ee" d="M16 22.5c0-5.8 5.2-10.5 11.6-10.5h8.8C42.8 12 48 16.7 48 22.5v9c0 5.8-5.2 10.5-11.6 10.5h-3.4L26 50.2c-.7.6-1.8.1-1.8-.8v-7.4h-3.6C21.2 42 16 37.3 16 31.5v-9z"/>
        </svg>
        <h2>RikiChat</h2>
        <p>Connect. Chat. Stay in sync.</p>
        <p className="small">Select a conversation or start a new chat.</p>
      </div>
    );
  }
  if (!conv) {
    return <div className="empty"><h3>Conversation unavailable</h3></div>;
  }

  const peer = conv.peer;
  const pres = peer ? (presence[peer.id] || {}) : {};
  const typingNames = Object.values(typing).filter(Boolean);
  const sub = conv.type === 'group'
    ? `${conv.members?.length || 0} members${typingNames.length ? ` · ${typingNames[0]} is typing…` : ''}`
    : typingNames.length
      ? `${typingNames[0]} is typing…`
      : pres.status === 'online'
        ? 'Online'
        : pres.status === 'away'
          ? 'Away'
          : formatLastSeen(pres.lastSeen || peer?.lastSeen);

  const items = bucket?.items || [];
  const grouped = [];
  let lastSender = null;
  let lastTime = 0;
  let lastDay = '';
  for (const m of items) {
    const day = formatDateSep(m.createdAt);
    if (day !== lastDay) {
      grouped.push({ kind: 'date', id: 'd' + m.createdAt, label: day });
      lastDay = day;
      lastSender = null;
    }
    if (m.type === 'system') {
      grouped.push({ kind: 'sys', id: m.id, m });
      lastSender = null;
      continue;
    }
    const groupedWithPrev = m.senderId === lastSender && m.createdAt - lastTime < 5 * 60 * 1000;
    grouped.push({ kind: 'msg', id: m.id, m, grouped: groupedWithPrev });
    lastSender = m.senderId;
    lastTime = m.createdAt;
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && bucket?.hasMore && !bucket.loading) {
      const prevH = el.scrollHeight;
      loadMessages(activeId).then?.();
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - prevH + el.scrollTop;
      });
    }
  }

  function jumpTo(id) {
    const el = document.getElementById('msg-' + id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlight(id);
      setTimeout(() => setHighlight(null), 1400);
    }
  }

  return (
    <>
      <div className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
        <button onClick={onOpenDetails} style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1, textAlign: 'left' }}>
          <Avatar user={conv.type === 'dm' ? peer : { displayName: conv.name, avatar: conv.avatar }} size={40} square={conv.type === 'group'} showPresence={conv.type === 'dm'} presence={pres} />
          <div className="chat-header-meta">
            <div className="chat-header-name">{conv.name}</div>
            <div className="chat-header-sub">
              {conv.type === 'dm' && <span className={`dot ${pres.status === 'online' ? '' : pres.status === 'away' ? 'away' : 'off'}`} />}
              {typingNames.length ? <span className="typing-dots"><span /><span /><span /></span> : null}
              {sub}
            </div>
          </div>
        </button>
        <button className="icon-btn" onClick={onOpenDetails} title="Details"><MoreVertical size={18} /></button>
      </div>
      {conv.pinnedMessages?.[0] && (
        <div className="pin-bar" onClick={() => jumpTo(conv.pinnedMessages[0].messageId)}>
          <Pin size={14} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="small">Pinned message</div>
            <strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {conv.pinnedMessages[0].content || conv.pinnedMessages[0].type}
            </strong>
          </div>
        </div>
      )}
      <div className="messages" ref={scroller} onScroll={onScroll}>
        {bucket?.loading && items.length === 0 && <SkeletonList n={6} />}
        {bucket?.hasMore && items.length > 0 && (
          <button className="load-more" onClick={() => loadMessages(activeId)}>Load older messages</button>
        )}
        {!bucket?.loading && items.length === 0 && (
          <div className="empty"><h3>No messages yet.</h3><p>Say hello 👋</p></div>
        )}
        {grouped.map((g) => {
          if (g.kind === 'date') return <div className="date-sep" key={g.id}>{g.label}</div>;
          if (g.kind === 'sys') return <div className="sys-msg" key={g.id}>{g.m.content}</div>;
          return (
            <MessageBubble
              key={g.id}
              m={g.m}
              grouped={g.grouped}
              mine={g.m.senderId === user.id}
              highlight={highlight === g.m.id}
              showName={conv.type === 'group' && !g.grouped && g.m.senderId !== user.id}
              onMenu={setMenu}
              onJump={jumpTo}
              onViewer={setViewer}
            />
          );
        })}
        <div ref={bottom} />
      </div>
      <Composer conv={conv} />
      {menu && (
        <MessageMenu
          menu={menu}
          conv={conv}
          mine={menu.m.senderId === user.id}
          onClose={() => setMenu(null)}
          onJump={jumpTo}
        />
      )}
      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)}>
          <button className="close" onClick={() => setViewer(null)}><X size={18} /></button>
          {viewer.fileType === 'video'
            ? <video src={viewer.fileUrl} controls autoPlay onClick={(e) => e.stopPropagation()} />
            : <img src={viewer.fileUrl} alt="" onClick={(e) => e.stopPropagation()} />}
        </div>
      )}
    </>
  );
}

function MessageBubble({ m, grouped, mine, highlight, showName, onMenu, onJump, onViewer }) {
  const ticks = m.status === 'seen' ? 'seen' : m.status === 'failed' ? 'failed' : '';
  return (
    <div
      id={'msg-' + m.id}
      className={`msg-row ${mine ? 'own' : ''} ${grouped ? 'grouped' : ''} ${highlight ? 'highlight-msg' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); onMenu({ m, x: e.clientX, y: e.clientY }); }}
      onDoubleClick={() => useStore.getState().socket && emitReact({ id: m.id, emoji: '👍' })}
    >
      {!mine && !grouped && <Avatar user={m.sender} size={28} />}
      {!mine && grouped && <div style={{ width: 28 }} />}
      <div className="msg-col">
        {showName && <div className="sender-name">{m.sender?.displayName}</div>}
        <div
          className="bubble"
          onTouchStart={(e) => {
            const t = e.touches[0];
            e.currentTarget._lp = setTimeout(() => onMenu({ m, x: t.clientX, y: t.clientY }), 480);
          }}
          onTouchEnd={(e) => clearTimeout(e.currentTarget._lp)}
          onTouchMove={(e) => clearTimeout(e.currentTarget._lp)}
        >
          {m.reply && (
            <div className="quote" onClick={(e) => { e.stopPropagation(); onJump(m.reply.id); }}>
              <b>{m.reply.senderName}</b>
              {m.reply.deleted ? 'This message was deleted' : (m.reply.content || m.reply.type)}
            </div>
          )}
          {m.deleted ? (
            <div className="msg-text deleted">This message was deleted</div>
          ) : (
            <>
              {m.attachments?.map((a) => (
                <Attachment key={a.id} a={a} onViewer={onViewer} />
              ))}
              {m.content && m.type === 'text' && (
                <div className="msg-text">
                  {linkify(m.content).map((p, i) =>
                    /^https?:\/\//.test(p)
                      ? <a key={i} className="linkish" href={p} target="_blank" rel="noreferrer">{p}</a>
                      : <span key={i}>{p}</span>
                  )}
                </div>
              )}
              {m.forwardedFrom && <div className="small">Forwarded</div>}
            </>
          )}
          <div className="msg-meta">
            {m.edited && !m.deleted && <span>Edited</span>}
            <span>{formatTime(m.createdAt)}</span>
            {mine && !m.deleted && (
              <span className={`ticks ${ticks}`}>
                {m.status === 'failed' ? <AlertCircle size={14} /> :
                  m.status === 'seen' || m.status === 'delivered' ? <CheckCheck size={14} /> :
                    m.pending ? <span style={{ opacity: .5 }}><Check size={14} /></span> : <Check size={14} />}
              </span>
            )}
          </div>
        </div>
        {m.status === 'failed' && (
          <div className="failed-row">⚠ Failed to send <button onClick={() => retry(m)}>Retry</button></div>
        )}
        {!!Object.keys(m.reactions || {}).length && (
          <div className="reactions">
            {Object.entries(m.reactions).map(([emoji, users]) => {
              const mineR = users.includes(useStore.getState().user.id);
              return (
                <button key={emoji} className={`rxn ${mineR ? 'mine' : ''}`} onClick={() => emitReact({ id: m.id, emoji, remove: mineR })}>
                  {emoji} {users.length}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function retry(m) {
  const st = useStore.getState();
  st.pushMessage({ ...m, pending: true, failed: false, status: 'sending' });
  sendMessage({
    conversationId: m.conversationId,
    content: m.content,
    type: m.type,
    replyTo: m.replyTo,
    clientId: m.clientId,
    attachments: m.attachments,
  }).then((res) => {
    if (res?.error) st.pushMessage({ ...m, pending: false, failed: true, status: 'failed' });
    else if (res.message) st.pushMessage(res.message);
  });
}

function Attachment({ a, onViewer }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef(null);
  const [prog, setProg] = useState(0);
  if (a.fileType === 'image') {
    return (
      <div className="media-card" onClick={() => onViewer(a)}>
        <img src={a.fileUrl} alt={a.fileName} loading="lazy" />
      </div>
    );
  }
  if (a.fileType === 'video') {
    return (
      <div className="media-card" onClick={() => onViewer(a)}>
        <video src={a.fileUrl} preload="metadata" />
      </div>
    );
  }
  if (a.fileType === 'audio' || a.fileType === 'voice') {
    return (
      <div className="voice-card">
        <button className="icon-btn" onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (playing) { el.pause(); setPlaying(false); }
          else { el.play(); setPlaying(true); }
        }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <audio
          ref={audio}
          src={a.fileUrl}
          onTimeUpdate={(e) => setProg(e.target.duration ? e.target.currentTime / e.target.duration : 0)}
          onEnded={() => { setPlaying(false); setProg(0); }}
        />
        <div className="wave"><span style={{ width: `${prog * 100}%` }} /></div>
        <span className="small">{formatDuration(a.duration || 0)}</span>
      </div>
    );
  }
  return (
    <div className="file-card">
      <FileText size={22} />
      <div>
        <a href={a.fileUrl} download={a.fileName}>{a.fileName}</a>
        <div className="small">{formatSize(a.fileSize)} · Download</div>
      </div>
    </div>
  );
}

function MessageMenu({ menu, conv, mine, onClose, onJump }) {
  const [mode, setMode] = useState('menu');
  const setReply = (m) => {
    window.dispatchEvent(new CustomEvent('rc-reply', { detail: m }));
    onClose();
  };
  const setEdit = (m) => {
    window.dispatchEvent(new CustomEvent('rc-edit', { detail: m }));
    onClose();
  };
  async function del(scope) {
    await emitDelete({ id: menu.m.id, scope });
    onClose();
  }
  async function pin() {
    try {
      if (conv.pinnedMessages?.some((p) => p.messageId === menu.m.id)) await api.unpin(conv.id, menu.m.id);
      else await api.pin(conv.id, menu.m.id);
    } catch (e) {
      useStore.getState().toastMsg(e.message);
    }
    onClose();
  }
  const style = {
    top: Math.min(menu.y, window.innerHeight - 280),
    left: Math.min(menu.x, window.innerWidth - 200),
  };
  return (
    <div className="overlay" style={{ background: 'transparent', placeItems: 'unset' }} onMouseDown={onClose}>
      <div className="menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
        {mode === 'menu' && (
          <>
            <div className="rxn-bar" style={{ marginBottom: 6 }}>
              {REACTIONS.map((e) => (
                <button key={e} onClick={() => { emitReact({ id: menu.m.id, emoji: e }); onClose(); }}>{e}</button>
              ))}
            </div>
            <button onClick={() => setReply(menu.m)}><Reply size={16} /> Reply</button>
            <button onClick={() => { navigator.clipboard.writeText(menu.m.content || ''); onClose(); }}><Copy size={16} /> Copy</button>
            <button onClick={() => { window.dispatchEvent(new CustomEvent('rc-forward', { detail: menu.m })); onClose(); }}><Forward size={16} /> Forward</button>
            <button onClick={pin}><Pin size={16} /> Pin</button>
            {mine && menu.m.type === 'text' && !menu.m.deleted && (
              <button onClick={() => setEdit(menu.m)}><Pencil size={16} /> Edit</button>
            )}
            {mine && !menu.m.deleted && (
              <>
                <button className="danger" onClick={() => del('me')}><Trash2 size={16} /> Delete for me</button>
                <button className="danger" onClick={() => del('everyone')}><Trash2 size={16} /> Delete for everyone</button>
              </>
            )}
            {!mine && <button className="danger" onClick={() => del('me')}><Trash2 size={16} /> Delete for me</button>}
            {!mine && (
              <button className="danger" onClick={async () => { await api.report({ targetType: 'message', targetId: menu.m.id, reason: 'report' }); useStore.getState().toastMsg('Report sent'); onClose(); }}>
                <Flag size={16} /> Report
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Composer({ conv }) {
  const [text, setText] = useState(() => useStore.getState().getDraft(conv.id));
  const [reply, setReply] = useState(null);
  const [edit, setEdit] = useState(null);
  const [emoji, setEmoji] = useState(false);
  const [files, setFiles] = useState([]);
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);
  const fileRef = useRef(null);
  const typingOn = useRef(false);
  const stopTimer = useRef(null);
  const mediaRec = useRef(null);
  const chunks = useRef([]);
  const recStart = useRef(0);
  const [recSec, setRecSec] = useState(0);

  useEffect(() => {
    setText(useStore.getState().getDraft(conv.id));
    setReply(null); setEdit(null); setFiles([]);
  }, [conv.id]);

  useEffect(() => {
    const onReply = (e) => { setReply(e.detail); setEdit(null); ta.current?.focus(); };
    const onEdit = (e) => { setEdit(e.detail); setText(e.detail.content || ''); setReply(null); ta.current?.focus(); };
    window.addEventListener('rc-reply', onReply);
    window.addEventListener('rc-edit', onEdit);
    return () => {
      window.removeEventListener('rc-reply', onReply);
      window.removeEventListener('rc-edit', onEdit);
    };
  }, []);

  useEffect(() => {
    useStore.getState().saveDraft(conv.id, edit ? '' : text);
  }, [text, conv.id, edit]);

  function emitTyping(on) {
    const s = getSocket();
    if (!s) return;
    if (on && typingOn.current) return;
    typingOn.current = on;
    s.emit('typing', { conversationId: conv.id, on });
  }
  function onChange(e) {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px';
    emitTyping(true);
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => emitTyping(false), 1500);
  }

  async function send() {
    const content = text.trim();
    if (!content && !files.length && !rec) return;
    if (edit) {
      await emitEdit({ id: edit.id, content });
      setEdit(null); setText(''); emitTyping(false);
      return;
    }
    setBusy(true);
    try {
      let attachments = [];
      let type = 'text';
      if (files.length) {
        const prepared = [];
        for (const f of files) prepared.push(f.file.type.startsWith('image/') ? await compressImage(f.file) : f.file);
        const up = await api.upload(prepared);
        attachments = up.files;
        type = attachments[0]?.fileType || 'file';
      }
      if (rec) {
        const up = await api.upload([rec.file]);
        attachments = up.files.map((f) => ({ ...f, fileType: 'voice', duration: rec.duration }));
        type = 'voice';
      }
      const clientId = nid();
      const pending = {
        id: clientId,
        clientId,
        conversationId: conv.id,
        senderId: useStore.getState().user.id,
        sender: useStore.getState().user,
        content,
        type,
        replyTo: reply?.id,
        reply: reply ? { id: reply.id, content: reply.content, senderName: reply.sender?.displayName, type: reply.type } : null,
        createdAt: Date.now(),
        attachments,
        reactions: {},
        pending: true,
        status: 'sending',
      };
      useStore.getState().pushMessage(pending);
      setText(''); setReply(null); setFiles([]); setRec(null);
      if (ta.current) ta.current.style.height = 'auto';
      emitTyping(false);
      const res = await sendMessage({
        conversationId: conv.id,
        content,
        type,
        replyTo: reply?.id,
        clientId,
        attachments,
      });
      if (res?.error) {
        useStore.getState().pushMessage({ ...pending, pending: false, failed: true, status: 'failed' });
        if (res.code === 'rate') useStore.getState().toastMsg(res.error);
      } else if (res.message) {
        useStore.getState().pushMessage(res.message);
      }
    } catch (e) {
      useStore.getState().toastMsg(e.message || 'Failed to send');
    } finally {
      setBusy(false);
    }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        const duration = (Date.now() - recStart.current) / 1000;
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        setRec({ file, duration, url: URL.createObjectURL(blob) });
        setRecSec(0);
      };
      mediaRec.current = mr;
      recStart.current = Date.now();
      mr.start();
      setRec({ recording: true });
      const iv = setInterval(() => setRecSec(Math.round((Date.now() - recStart.current) / 1000)), 200);
      mediaRec.current._iv = iv;
    } catch {
      useStore.getState().toastMsg('Microphone permission is required.');
    }
  }
  function stopRec() {
    if (mediaRec.current && mediaRec.current.state !== 'inactive') {
      clearInterval(mediaRec.current._iv);
      mediaRec.current.stop();
    }
  }

  return (
    <div className="composer-wrap">
      {reply && (
        <div className="reply-bar">
          <div className="grow"><b>{reply.sender?.displayName}</b><div>{reply.content || reply.type}</div></div>
          <button className="icon-btn" onClick={() => setReply(null)}><X size={16} /></button>
        </div>
      )}
      {edit && (
        <div className="edit-bar">
          <div className="grow"><b>Editing message</b></div>
          <button className="icon-btn" onClick={() => { setEdit(null); setText(''); }}><X size={16} /></button>
        </div>
      )}
      {!!files.length && (
        <div className="attach-preview">
          {files.map((f, i) => (
            <div className="thumb" key={i}>
              {f.file.type.startsWith('image/') ? <img src={f.url} alt="" /> :
                f.file.type.startsWith('video/') ? <video src={f.url} /> :
                  <div style={{ padding: 8, fontSize: 11 }}>{f.file.name}</div>}
              <button className="x" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      {rec?.recording && (
        <div className="rec-bar"><span className="rec-dot" /> Recording {formatDuration(recSec)}
          <button className="btn btn-danger" style={{ height: 32, width: 'auto' }} onClick={stopRec}>Stop</button>
        </div>
      )}
      {rec?.file && (
        <div className="reply-bar">
          <div className="grow">🎤 Voice message · {formatDuration(rec.duration)}</div>
          <button className="icon-btn" onClick={() => setRec(null)}><X size={16} /></button>
        </div>
      )}
      <div className="composer" style={{ position: 'relative' }}>
        <button className="icon-btn" onClick={() => setEmoji((v) => !v)} title="Emoji"><Smile size={20} /></button>
        <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Attach"><Paperclip size={20} /></button>
        <input
          ref={fileRef}
          className="hidden-file"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,audio/*,.pdf,.zip,.txt,.docx,.xlsx,.pptx"
          onChange={(e) => {
            const list = [...e.target.files].slice(0, 4).map((file) => ({ file, url: URL.createObjectURL(file) }));
            setFiles((f) => [...f, ...list].slice(0, 4));
            e.target.value = '';
          }}
        />
        {emoji && (
          <div className="emoji-pop">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => { setText((t) => t + e); ta.current?.focus(); }}>{e}</button>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          className="composer-input"
          rows={1}
          placeholder="Type a message..."
          value={text}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        {text.trim() || files.length || rec?.file ? (
          <button className="send-btn" disabled={busy} onClick={send} aria-label="Send"><Send size={18} /></button>
        ) : (
          <button className="icon-btn" onClick={rec?.recording ? stopRec : startRec} title="Voice message"><Mic size={20} /></button>
        )}
      </div>
    </div>
  );
}

export function DetailsPanel({ open, onClose, onOpenProfile }) {
  const activeId = useStore((s) => s.activeId);
  const conv = useStore((s) => s.conversations.find((c) => c.id === activeId));
  const user = useStore((s) => s.user);
  const [tab, setTab] = useState('info');
  const [media, setMedia] = useState(null);
  const [invite, setInvite] = useState(null);
  const [addQ, setAddQ] = useState('');
  const [addRes, setAddRes] = useState([]);

  useEffect(() => {
    if (!activeId || !open) return;
    api.media(activeId).then(setMedia).catch(() => {});
    setInvite(null); setTab('info');
  }, [activeId, open]);

  if (!open || !conv) return null;
  const canAdmin = conv.type === 'group' && (conv.myRole === 'owner' || conv.myRole === 'admin');

  async function toggle(field, value) {
    const { conversation } = await api.patchConversation(conv.id, { [field]: value });
    useStore.getState().upsertConversation(conversation);
  }

  return (
    <aside className={`details ${open ? 'open' : ''}`}>
      <div className="details-head">
        <button className="icon-btn" style={{ position: 'absolute', right: 8, top: 8 }} onClick={onClose}><X size={16} /></button>
        <Avatar user={conv.type === 'dm' ? conv.peer : { displayName: conv.name, avatar: conv.avatar }} size={84} square={conv.type === 'group'} />
        <h3 style={{ margin: '10px 0 4px' }}>{conv.name}</h3>
        {conv.type === 'dm' && <div className="small">@{conv.peer?.username}</div>}
        {conv.type === 'group' && <div className="small">{conv.description || 'No description'}</div>}
      </div>
      <div className="tabs" style={{ padding: 12 }}>
        <button className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Info</button>
        <button className={`tab ${tab === 'media' ? 'active' : ''}`} onClick={() => setTab('media')}>Media</button>
        {conv.type === 'group' && <button className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>Members</button>}
      </div>
      {tab === 'info' && (
        <>
          <section>
            <h4>Settings</h4>
            <button className="action-row" onClick={() => toggle('muted', !conv.muted)}>{conv.muted ? <Volume2 size={16} /> : <VolumeX size={16} />} {conv.muted ? 'Unmute' : 'Mute notifications'}</button>
            <button className="action-row" onClick={() => toggle('pinned', !conv.pinned)}><Pin size={16} /> {conv.pinned ? 'Unpin chat' : 'Pin chat'}</button>
            <button className="action-row" onClick={() => toggle('archived', !conv.archived)}><Archive size={16} /> {conv.archived ? 'Unarchive' : 'Archive'}</button>
            <button className="action-row" onClick={async () => { if (confirm('Clear chat history on this device?')) { await api.clearChat(conv.id); useStore.setState({ messages: { ...useStore.getState().messages, [conv.id]: { items: [], hasMore: false } } }); } }}><Trash2 size={16} /> Clear chat</button>
            {conv.type === 'dm' && (
              <>
                <button className="action-row danger" onClick={async () => { await api.block(conv.peer.id); useStore.getState().toastMsg('User blocked'); }}><UserX size={16} /> Block user</button>
                <button className="action-row danger" onClick={async () => { await api.report({ targetType: 'user', targetId: conv.peer.id, reason: 'report' }); useStore.getState().toastMsg('Report sent'); }}><Flag size={16} /> Report user</button>
              </>
            )}
            {conv.type === 'group' && (
              <button className="action-row danger" onClick={async () => { await api.removeMember(conv.id, user.id); }}><LogOut size={16} /> Leave group</button>
            )}
            {conv.myRole === 'owner' && conv.type === 'group' && (
              <button className="action-row danger" onClick={async () => { if (confirm('Delete this group for everyone?')) await api.deleteConversation(conv.id); }}><Trash2 size={16} /> Delete group</button>
            )}
          </section>
          {canAdmin && (
            <section>
              <h4>Group</h4>
              <GroupEdit conv={conv} />
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={async () => {
                const r = await api.invite(conv.id);
                setInvite(`${location.origin}/join/${r.code}`);
              }}>Create invite link</button>
              {invite && <div className="invite-box" style={{ marginTop: 8 }}>{invite}<div className="small">Expires in 7 days</div></div>}
            </section>
          )}
          <section>
            <h4>Pinned</h4>
            {(conv.pinnedMessages || []).length === 0 && <div className="small">No pinned messages</div>}
            {(conv.pinnedMessages || []).map((p) => (
              <div key={p.messageId} className="small" style={{ padding: '6px 0' }}>📌 {p.content || p.type}</div>
            ))}
          </section>
        </>
      )}
      {tab === 'media' && (
        <>
          <section>
            <h4>Media</h4>
            <div className="media-grid">
              {(media?.media || []).map((m) => (
                m.fileType === 'video'
                  ? <video key={m.id} src={m.fileUrl} />
                  : <img key={m.id} src={m.fileUrl} alt="" />
              ))}
            </div>
            {!media?.media?.length && <div className="small">No media yet</div>}
          </section>
          <section>
            <h4>Files</h4>
            {(media?.files || []).map((f) => (
              <a key={f.id} className="action-row" href={f.fileUrl} download={f.fileName}><FileText size={16} /> {f.fileName}</a>
            ))}
            {!media?.files?.length && <div className="small">No files</div>}
          </section>
          <section>
            <h4>Links</h4>
            {(media?.links || []).map((l, i) => (
              <a key={i} className="action-row" href={l.url} target="_blank" rel="noreferrer"><Link2 size={16} /> {l.url}</a>
            ))}
            {!media?.links?.length && <div className="small">No links</div>}
          </section>
        </>
      )}
      {tab === 'members' && (
        <section>
          {canAdmin && (
            <div style={{ marginBottom: 12 }}>
              <input className="search-input" placeholder="Add member by username" value={addQ} onChange={async (e) => {
                setAddQ(e.target.value);
                if (e.target.value.trim().length > 0) {
                  const r = await api.searchUsers(e.target.value.trim());
                  setAddRes(r.users);
                } else setAddRes([]);
              }} />
              {addRes.map((u) => (
                <button key={u.id} className="user-chip" onClick={async () => { await api.addMember(conv.id, u.id); setAddQ(''); setAddRes([]); }}>
                  <Avatar user={u} size={32} /> {u.displayName} <span className="small">@{u.username}</span>
                </button>
              ))}
            </div>
          )}
          {(conv.members || []).map((m) => (
            <div key={m.id} className="member-row">
              <Avatar user={m} size={36} showPresence presence={useStore.getState().presence[m.id]} />
              <div className="grow">
                <div>{m.displayName}</div>
                <div className="small">@{m.username} · {m.role}</div>
              </div>
              {canAdmin && m.id !== user.id && m.role !== 'owner' && (
                <>
                  {conv.myRole === 'owner' && (
                    <button className="small" onClick={() => api.patchMember(conv.id, m.id, m.role === 'admin' ? 'member' : 'admin')}>
                      {m.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                  )}
                  <button className="small" style={{ color: 'var(--danger)' }} onClick={() => api.removeMember(conv.id, m.id)}>Remove</button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}

function GroupEdit({ conv }) {
  const [name, setName] = useState(conv.name);
  const [description, setDescription] = useState(conv.description || '');
  return (
    <div className="stack">
      <input className="search-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
      <textarea className="search-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={2} />
      <button className="btn btn-ghost" onClick={async () => {
        const { conversation } = await api.patchConversation(conv.id, { name, description });
        useStore.getState().upsertConversation(conversation);
      }}>Save changes</button>
    </div>
  );
}

export function NewChatModal({ onClose, onOpen }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setUsers([]); return; }
      const r = await api.searchUsers(q.trim());
      setUsers(r.users);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="New chat" onClose={onClose}>
      <input className="search-input" autoFocus placeholder="Search username" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="stack" style={{ marginTop: 12 }}>
        {users.map((u) => (
          <button key={u.id} className="user-chip" onClick={async () => {
            const { conversation } = await api.openDm(u.id);
            useStore.getState().upsertConversation(conversation);
            onOpen(conversation.id);
            onClose();
          }}>
            <Avatar user={u} size={40} />
            <div><div>{u.displayName}</div><div className="small">@{u.username}</div></div>
          </button>
        ))}
        {q && !users.length && <div className="small center">No users found</div>}
      </div>
    </Modal>
  );
}

export function NewGroupModal({ onClose, onOpen }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [picked, setPicked] = useState([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setUsers([]); return; }
      const r = await api.searchUsers(q.trim());
      setUsers(r.users);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="New group" onClose={onClose}>
      <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <input className="search-input" placeholder="Add members" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="stack" style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}>
        {users.map((u) => (
          <button key={u.id} className="user-chip" onClick={() => setPicked((p) => p.some((x) => x.id === u.id) ? p : [...p, u])}>
            <Avatar user={u} size={32} /> {u.displayName}
          </button>
        ))}
      </div>
      <div className="small" style={{ margin: '8px 0' }}>{picked.length} selected</div>
      <button className="btn btn-primary" disabled={name.trim().length < 2} onClick={async () => {
        const { conversation } = await api.createGroup({ name: name.trim(), description, memberIds: picked.map((p) => p.id) });
        useStore.getState().upsertConversation(conversation);
        onOpen(conversation.id);
        onClose();
      }}>Create group</button>
    </Modal>
  );
}

export function SearchModal({ onClose, onOpenChat }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setRes(null); return; }
      setRes(await api.search(q.trim()));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Search" onClose={onClose} wide>
      <input className="search-input" autoFocus placeholder="Search users, groups, messages" value={q} onChange={(e) => setQ(e.target.value)} />
      {res && (
        <div style={{ marginTop: 16 }}>
          <h4 className="small">Users</h4>
          {res.users.map((u) => (
            <button key={u.id} className="user-chip" onClick={async () => {
              const { conversation } = await api.openDm(u.id);
              useStore.getState().upsertConversation(conversation);
              onOpenChat(conversation.id);
              onClose();
            }}><Avatar user={u} size={32} /> {u.displayName} <span className="small">@{u.username}</span></button>
          ))}
          <h4 className="small" style={{ marginTop: 12 }}>Groups</h4>
          {res.groups.map((g) => (
            <button key={g.id} className="user-chip" onClick={() => { onOpenChat(g.id); onClose(); }}>
              <Avatar user={{ displayName: g.name, avatar: g.avatar }} size={32} square /> {g.name}
            </button>
          ))}
          <h4 className="small" style={{ marginTop: 12 }}>Messages</h4>
          {res.messages.map((m) => (
            <button key={m.id} className="user-chip" onClick={() => { onOpenChat(m.conversationId, m.id); onClose(); }}>
              <div>
                <div><b>{m.sender?.displayName}</b> <span className="small">{m.conversationName}</span></div>
                <div className="small">{m.content}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ForwardModal({ message, onClose }) {
  const conversations = useStore((s) => s.conversations);
  const [picked, setPicked] = useState([]);
  return (
    <Modal title="Forward message" onClose={onClose}>
      <div className="stack" style={{ maxHeight: 280, overflow: 'auto' }}>
        {conversations.filter((c) => !c.archived).map((c) => (
          <button key={c.id} className="user-chip" onClick={() => setPicked((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])}>
            <Avatar user={c.type === 'dm' ? c.peer : { displayName: c.name, avatar: c.avatar }} size={32} square={c.type === 'group'} />
            <span className="grow">{c.name}</span>
            {picked.includes(c.id) && <Check size={16} color="#22d3ee" />}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!picked.length} onClick={async () => {
        await api.forward(message.id, picked);
        onClose();
      }}>Forward</button>
    </Modal>
  );
}
