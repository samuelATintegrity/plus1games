import { Session } from './session.js';

// Room Code — host creates a 4-digit code, guest joins.
// Both ends connect to the same `room-<code>` PartyKit room.

export async function createRoom() {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const session = new Session('roomCode', `room-${code}`, { code, role: 'host' });
  session.code = code;
  session.role = 'host';
  await waitForOpen(session);
  return session;
}

export async function joinRoom(code) {
  if (!/^\d{4}$/.test(code)) throw new Error('Room code must be 4 digits');
  const session = new Session('roomCode', `room-${code}`, { code, role: 'guest' });
  session.code = code;
  session.role = 'guest';
  await waitForOpen(session);
  return session;
}

function waitForOpen(session) {
  return new Promise((resolve) => {
    const off = session.on('open', () => { off(); resolve(); });
  });
}
