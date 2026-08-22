import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { connectSocket } from '../lib/socket.js';

export default function Auth({ mode }) {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body = { username: username.trim(), password, displayName: displayName.trim() };
      const data = register ? await api.register(body) : await api.login({ username: username.trim(), password });
      if (data.token) sessionStorage.setItem('rc_token', data.token);
      useStore.getState().setUser(data.user);
      const [{ conversations }, { notifications }] = await Promise.all([api.conversations(), api.notifications()]);
      useStore.setState({ conversations, notifications, bootstrapped: true });
      connectSocket();
      nav('/');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand-row">
          <div className="brand-logo"><Logo size={42} /></div>
          <div className="brand-name">RikiChat</div>
        </div>
        <p className="tagline">Connect. Chat. Stay in sync.</p>
        {err && <div className="error-banner">{err}</div>}
        {register && (
          <div className="field">
            <label htmlFor="dn">Display name</label>
            <input id="dn" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} />
          </div>
        )}
        <div className="field">
          <label htmlFor="un">Username</label>
          <input id="un" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={20} />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        {register && <div className="pw-hint">At least 8 characters, with letters and numbers.</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
        <div className="auth-switch">
          {register ? <>Already have an account? <Link to="/login">Sign in</Link></> : <>New here? <Link to="/register">Create an account</Link></>}
        </div>
      </form>
    </div>
  );
}
