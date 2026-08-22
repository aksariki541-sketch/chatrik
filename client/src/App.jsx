import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { MessageSquare, Users, Bell, User as UserIcon } from 'lucide-react';
import Auth from './pages/Auth.jsx';
import Profile from './pages/Profile.jsx';
import { ConnectionBar, Avatar, Empty, Modal } from './components/ui.jsx';
import {
  Sidebar, ChatView, DetailsPanel, NewChatModal, NewGroupModal, SearchModal, ForwardModal,
} from './components/Chat.jsx';
import { useStore } from './lib/store.js';
import { api } from './lib/api.js';
import { connectSocket, disconnectSocket, getSocket } from './lib/socket.js';
import { formatListTime } from './lib/format.js';

function useViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty('--vvh', window.innerHeight + 'px');
        root.style.setProperty('--vv-off', '0px');
        return;
      }
      root.style.setProperty('--vvh', vv.height + 'px');
      root.style.setProperty('--vv-off', vv.offsetTop + 'px');
    };
    apply();
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      window.visualViewport?.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
}

function usePresenceIdle() {
  useEffect(() => {
    let away = false;
    const ping = () => {
      const s = getSocket();
      if (!s) return;
      const hidden = document.hidden;
      if (hidden && !away) { s.emit('presence', { status: 'away' }); away = true; }
      if (!hidden && away) { s.emit('presence', { status: 'online' }); away = false; }
    };
    document.addEventListener('visibilitychange', ping);
    const onOnline = () => useStore.setState({ connection: getSocket()?.connected ? 'connected' : 'reconnecting' });
    const onOffline = () => useStore.setState({ connection: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', ping);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
}

function Guard({ children }) {
  const user = useStore((s) => s.user);
  const bootstrapped = useStore((s) => s.bootstrapped);
  if (!bootstrapped) {
    return (
      <div className="app-root" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="small">Loading RikiChat…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Guest({ children }) {
  const user = useStore((s) => s.user);
  const bootstrapped = useStore((s) => s.bootstrapped);
  if (!bootstrapped) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function Contacts({ onOpen }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const conversations = useStore((s) => s.conversations);
  const peers = conversations.filter((c) => c.type === 'dm' && c.peer).map((c) => c.peer);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setUsers([]); return; }
      const r = await api.searchUsers(q.trim());
      setUsers(r.users);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  const list = q.trim() ? users : peers;
  return (
    <div className="sidebar" style={{ width: '100%', border: 0 }}>
      <div className="topbar"><div className="brand-name">Contacts</div></div>
      <div className="search-wrap">
        <input className="search-input" placeholder="Find people" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chat-list">
        {list.length === 0 && <Empty title="No contacts yet" body="Search a username to start chatting." />}
        {list.map((u) => (
          <button key={u.id} className="chat-item" onClick={async () => {
            const { conversation } = await api.openDm(u.id);
            useStore.getState().upsertConversation(conversation);
            onOpen(conversation.id);
          }}>
            <Avatar user={u} size={44} showPresence presence={useStore.getState().presence[u.id]} />
            <div className="chat-item-body">
              <div className="chat-item-name">{u.displayName}</div>
              <div className="chat-item-preview">@{u.username}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NotificationsView({ onOpen }) {
  const notifications = useStore((s) => s.notifications);
  useEffect(() => { api.readNotifications({ all: true }).catch(() => {}); }, []);
  return (
    <div className="sidebar" style={{ width: '100%', border: 0 }}>
      <div className="topbar"><div className="brand-name">Notifications</div></div>
      <div className="chat-list">
        {notifications.length === 0 && <Empty title="You're all caught up" body="New messages and invites will show up here." />}
        {notifications.map((n) => (
          <button key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => {
            if (n.data?.conversationId) onOpen(n.data.conversationId);
          }}>
            <div>
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              <div className="small">{n.body}</div>
              <div className="small">{formatListTime(n.createdAt)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function JoinPage() {
  const { code } = useParams();
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.getInvite(code).then((r) => setInfo(r.conversation)).catch((e) => setErr(e.message));
  }, [code]);
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h3>RikiChat Invite</h3>
        {err && <div className="error-banner">{err}</div>}
        {info && (
          <>
            <p>Join <b>{info.name}</b></p>
            <p className="small">{info.description}</p>
            <button className="btn btn-primary" onClick={async () => {
              const { conversation } = await api.joinInvite(code);
              useStore.getState().upsertConversation(conversation);
              nav('/');
              useStore.getState().setActive(conversation.id);
            }}>Join group</button>
          </>
        )}
      </div>
    </div>
  );
}

function Shell() {
  useViewport();
  usePresenceIdle();
  const nav = useNavigate();
  const user = useStore((s) => s.user);
  const connection = useStore((s) => s.connection);
  const activeId = useStore((s) => s.activeId);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState('chats');
  const [mobileTab, setMobileTab] = useState('chats');
  const [details, setDetails] = useState(false);
  const [modal, setModal] = useState(null);
  const [fwd, setFwd] = useState(null);

  useEffect(() => {
    connectSocket();
    return () => {};
  }, []);

  useEffect(() => {
    const onFwd = (e) => setFwd(e.detail);
    window.addEventListener('rc-forward', onFwd);
    return () => window.removeEventListener('rc-forward', onFwd);
  }, []);

  function openChat(id) {
    useStore.getState().setActive(id);
    setMobileTab('chats');
    setDetails(false);
    nav('/');
  }

  const chatOpen = !!activeId && mobileTab === 'chats';

  return (
    <div className={`app-root ${chatOpen ? 'in-chat' : ''}`}>
      <ConnectionBar status={connection} />
      <div className={`shell ${chatOpen ? 'chat-open' : ''} ${mobileTab !== 'chats' ? '' : ''}`}>
        {mobileTab === 'chats' && (
          <Sidebar
            tab={tab}
            setTab={setTab}
            onOpenChat={openChat}
            onNewChat={() => setModal('new')}
            onNewGroup={() => setModal('group')}
            onOpenSearch={() => setModal('search')}
            onOpenNotifs={() => setMobileTab('notifs')}
            onOpenSettings={() => setMobileTab('profile')}
            onOpenProfile={() => setMobileTab('profile')}
          />
        )}
        {mobileTab === 'contacts' && <Contacts onOpen={openChat} />}
        {mobileTab === 'notifs' && <NotificationsView onOpen={openChat} />}
        {mobileTab === 'profile' && (
          <div style={{ width: '100%', overflow: 'auto' }}><Profile /></div>
        )}
        {mobileTab === 'chats' && (
          <main className="main">
            <ChatView onBack={() => useStore.getState().setActive(null)} onOpenDetails={() => setDetails(true)} detailsOpen={details} />
          </main>
        )}
        {mobileTab === 'chats' && (
          <DetailsPanel open={details} onClose={() => setDetails(false)} />
        )}
      </div>
      <nav className="bottom-nav">
        <button className={mobileTab === 'chats' ? 'active' : ''} onClick={() => { setMobileTab('chats'); }}>
          <MessageSquare size={20} /> Chats
        </button>
        <button className={mobileTab === 'contacts' ? 'active' : ''} onClick={() => setMobileTab('contacts')}>
          <Users size={20} /> Contacts
        </button>
        <button className={mobileTab === 'notifs' ? 'active' : ''} onClick={() => setMobileTab('notifs')}>
          <Bell size={20} />
          Notifications
        </button>
        <button className={mobileTab === 'profile' ? 'active' : ''} onClick={() => setMobileTab('profile')}>
          <UserIcon size={20} /> Profile
        </button>
      </nav>
      {modal === 'new' && <NewChatModal onClose={() => setModal(null)} onOpen={openChat} />}
      {modal === 'group' && <NewGroupModal onClose={() => setModal(null)} onOpen={openChat} />}
      {modal === 'search' && <SearchModal onClose={() => setModal(null)} onOpenChat={openChat} />}
      {modal === 'notifs' && (
        <Modal title="Notifications" onClose={() => setModal(null)}>
          <NotificationsView onOpen={(id) => { openChat(id); setModal(null); }} />
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal title="Profile & settings" onClose={() => setModal(null)}>
          <Profile />
        </Modal>
      )}
      {fwd && <ForwardModal message={fwd} onClose={() => setFwd(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default function App() {
  const bootstrap = useStore((s) => s.bootstrap);
  const bootstrapped = useStore((s) => s.bootstrapped);
  useEffect(() => { bootstrap(); }, []);
  useEffect(() => () => disconnectSocket(), []);

  if (!bootstrapped) {
    return (
      <div className="app-root" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="small">Loading RikiChat…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Guest><Auth mode="login" /></Guest>} />
      <Route path="/register" element={<Guest><Auth mode="register" /></Guest>} />
      <Route path="/join/:code" element={<Guard><JoinPage /></Guard>} />
      <Route path="/*" element={<Guard><Shell /></Guard>} />
    </Routes>
  );
}
