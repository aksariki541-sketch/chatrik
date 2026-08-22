import React from 'react';
import { initials } from '../lib/format.js';

export function Logo({ size = 42 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="#0b1220" />
      <defs>
        <linearGradient id="rcg" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
      </defs>
      <path fill="url(#rcg)" d="M16 22.5c0-5.8 5.2-10.5 11.6-10.5h8.8C42.8 12 48 16.7 48 22.5v9c0 5.8-5.2 10.5-11.6 10.5h-3.4L26 50.2c-.7.6-1.8.1-1.8-.8v-7.4h-3.6C21.2 42 16 37.3 16 31.5v-9z" />
      <circle cx="27.2" cy="27.2" r="2.3" fill="#0b1220" />
      <circle cx="35.8" cy="27.2" r="2.3" fill="#0b1220" />
      <circle cx="44.5" cy="27.2" r="2.3" fill="#0b1220" />
    </svg>
  );
}

export function Avatar({ user, size = 44, square, showPresence, presence }) {
  const src = user?.avatar;
  const name = user?.displayName || user?.name || user?.username || '';
  const st = presence?.status || user?.status;
  return (
    <div className={`avatar ${square ? 'sq' : ''}`} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {src ? <img src={src} alt="" /> : initials(name)}
      {showPresence && <span className={`presence ${st === 'online' ? 'on' : st === 'away' ? 'away' : 'off'}`} />}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" style={wide ? { width: minWidth() } : undefined} role="dialog" aria-label={title}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function minWidth() { return 'min(560px, 100%)'; }

export function Empty({ title, body, action, actionLabel }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 36 }}>💬</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <button className="btn btn-primary" style={{ width: 'auto', padding: '0 18px' }} onClick={action}>{actionLabel}</button>}
    </div>
  );
}

export function SkeletonList({ n = 8 }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div className="sk-row" key={i}>
          <div className="sk sk-av" />
          <div className="sk-lines">
            <div className="sk sk-l1" />
            <div className="sk sk-l2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConnectionBar({ status }) {
  const [flash, setFlash] = React.useState(false);
  const prev = React.useRef(status);
  React.useEffect(() => {
    if (prev.current !== 'connected' && status === 'connected' && prev.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1600);
      prev.current = status;
      return () => clearTimeout(t);
    }
    prev.current = status;
  }, [status]);
  if (status === 'reconnecting') return <div className="conn-bar warn">⚠ Reconnecting…</div>;
  if (status === 'offline') return <div className="conn-bar bad">⚠ You are offline</div>;
  if (status === 'connecting') return <div className="conn-bar warn">Connecting…</div>;
  if (flash) return <div className="conn-bar ok">🟢 Connected</div>;
  return null;
}
