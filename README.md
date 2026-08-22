# RikiChat

**Connect. Chat. Stay in sync.**

A real-time messaging platform with private chats, groups, media, voice notes, and presence.

## Run

```bash
cd rikichat
npm install
npm run install:all   # first time
npm run dev
```

- App: Vite on port **5173**
- API / WebSocket: Express + Socket.io on port **3001**

Buka `http://localhost:5173`, register dua akun di jendela berbeda (atau jendela privat) untuk tes chat 1-on-1.

JWT secret dibuat otomatis ke file `.env` saat server pertama kali dijalankan.

## Stack

- React + Vite (mobile-first dark UI)
- Express REST API
- Socket.io realtime (messages, typing, presence, read receipts)
- SQLite via sql.js (persisted to `data/rikichat.sqlite`)
- bcrypt password hashing + JWT httpOnly cookies

Passwords are never stored in plaintext. File uploads are type-checked and size-limited.
