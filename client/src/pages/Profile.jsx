import { useState } from 'react';
import { Camera, LogOut, Shield } from 'lucide-react';
import { Avatar } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { disconnectSocket } from '../lib/socket.js';
import { useNavigate } from 'react-router-dom';

export default function Profile() {
  const user = useStore((s) => s.user);
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { user: u } = await api.updateMe({ displayName, username, bio });
      useStore.getState().setUser(u);
      useStore.getState().toastMsg('Profile updated');
    } catch (ex) {
      useStore.getState().toastMsg(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function onAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { user: u } = await api.uploadAvatar(file);
      useStore.getState().setUser(u);
    } catch (ex) {
      useStore.getState().toastMsg(ex.message);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    sessionStorage.removeItem('rc_token');
    disconnectSocket();
    useStore.setState({ user: null, conversations: [], messages: {}, notifications: [], activeId: null });
    nav('/login');
  }

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="avatar-edit">
          <Avatar user={user} size={96} />
          <label title="Change avatar">
            <Camera size={14} />
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatar} />
          </label>
        </div>
        <div className="center">
          <div style={{ fontWeight: 700, fontSize: 20 }}>{user?.displayName}</div>
          <div className="small">@{user?.username}</div>
        </div>
        <form onSubmit={save} style={{ marginTop: 24 }}>
          <div className="field"><label>Display name</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} /></div>
          <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} /></div>
          <div className="field"><label>Bio</label><textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={180} /></div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </form>
        <div className="settings-list">
          <button className="action-row" onClick={async () => {
            if (typeof Notification === 'undefined') return;
            const p = await Notification.requestPermission();
            useStore.getState().toastMsg(p === 'granted' ? 'Notifications enabled' : 'Notifications blocked');
          }}><Shield size={16} /> Enable desktop notifications</button>
          <button className="action-row danger" onClick={logout}><LogOut size={16} /> Log out</button>
        </div>
      </div>
    </div>
  );
}
