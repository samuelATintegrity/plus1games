import { Session } from './session.js';

// Buddy Pass — persistent partner link.
// Both buddies share a stable pairId derived from their pairing.
// For now the caller passes the pairId; future work: derive it from auth.
export async function connectBuddyPass({ buddyId } = {}) {
  if (!buddyId) throw new Error('buddyId required for Buddy Pass');
  const session = new Session('buddyPass', `buddy-${buddyId}`, { buddyId });
  await waitForOpen(session);
  return session;
}

function waitForOpen(session) {
  return new Promise((resolve) => {
    const off = session.on('open', () => { off(); resolve(); });
  });
}
