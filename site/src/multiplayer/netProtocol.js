// Single source of truth for multiplayer message shapes and helpers.
// Every consumer (BuddyProvider, ArcadeView, PongNetController) imports from
// here so the wire format lives in one place.
//
// Messages are sent via `session.send(data)` and received via
// `session.on('message', ({ from, data }) => ...)`. The PartyKit server
// relays every message to everyone EXCEPT the sender, so no de-dup is
// required.

// ---- Kinds ------------------------------------------------------------------

export const KIND = {
  // Buddy channel
  BUDDY_META: 'buddy-meta',
  PRESENCE: 'presence',
  ENTER_GAME: 'enter-game',
  LEAVE_GAME: 'leave-game',
  // Pong channel (multiplexed over the same session)
  PONG_READY: 'pong-ready',
  PONG_INPUT: 'pong-input',
  PONG_SNAPSHOT: 'pong-snapshot',
  PONG_REQUEST_STATE: 'pong-request-state',
  // RTS (Starbloom) channel
  RTS_READY: 'rts-ready',
  RTS_COMMAND: 'rts-command',
  RTS_SNAPSHOT: 'rts-snapshot',
  RTS_REQUEST_STATE: 'rts-request-state',
  // StackDuo channel
  STACKDUO_READY: 'sd-ready',
  STACKDUO_INPUT: 'sd-input',
  STACKDUO_SNAPSHOT: 'sd-snapshot',
  STACKDUO_LOBBY: 'sd-lobby',
  STACKDUO_LOBBY_ACTION: 'sd-laction',
  STACKDUO_REQUEST_STATE: 'sd-req',
  // Zookeepers channel
  ZOO_READY: 'zoo-ready',
  ZOO_INPUT: 'zoo-input',
  ZOO_SNAPSHOT: 'zoo-snap',
  ZOO_LOBBY: 'zoo-lobby',
  ZOO_LOBBY_ACTION: 'zoo-laction',
  ZOO_REQUEST_STATE: 'zoo-req',
};

// ---- Message factories ------------------------------------------------------

export function makeBuddyMeta(nickname) {
  return { kind: KIND.BUDDY_META, t: Date.now(), nickname };
}

export function makePresence({ x, y, nickname, seq, gameId = null }) {
  return { kind: KIND.PRESENCE, t: Date.now(), seq, x, y, nickname, gameId };
}

export function makeEnterGame({ gameId, gameRoute, nickname }) {
  return { kind: KIND.ENTER_GAME, t: Date.now(), gameId, gameRoute, nickname };
}

export function makeLeaveGame({ gameId }) {
  return { kind: KIND.LEAVE_GAME, t: Date.now(), gameId };
}

export function makePongReady({ myId, committedRole = null }) {
  return { kind: KIND.PONG_READY, t: Date.now(), myId, committedRole };
}

export function makePongInput({ seq, keys, startPressed = false }) {
  return { kind: KIND.PONG_INPUT, t: Date.now(), seq, keys, startPressed };
}

export function makePongSnapshot(seq, state) {
  return {
    kind: KIND.PONG_SNAPSHOT,
    t: Date.now(),
    seq,
    phase: state.phase,
    p1: pickEntity(state.p1),
    p2: pickEntity(state.p2),
    ai1: pickEntity(state.ai1),
    ai2: pickEntity(state.ai2),
    ball: pickBall(state.ball),
    score: { ...state.score },
    hits: state.hits,
    lastToucher: state.lastToucher,
    lastSide: state.lastSide,
    touchCooldown: state.touchCooldown,
    serveTimer: state.serveTimer,
  };
}

export function makePongRequestState() {
  return { kind: KIND.PONG_REQUEST_STATE, t: Date.now() };
}

export function makeRtsReady({ myId, committedRole = null }) {
  return { kind: KIND.RTS_READY, t: Date.now(), myId, committedRole };
}

export function makeRtsCommand({ command }) {
  return { kind: KIND.RTS_COMMAND, t: Date.now(), command };
}

export function makeRtsSnapshot(seq, snapshot) {
  return { kind: KIND.RTS_SNAPSHOT, t: Date.now(), seq, ...snapshot };
}

export function makeRtsRequestState() {
  return { kind: KIND.RTS_REQUEST_STATE, t: Date.now() };
}

function pickEntity(e) {
  if (!e) return null;
  return { x: e.x, y: e.y, vx: e.vx ?? 0, vy: e.vy ?? 0 };
}

function pickBall(b) {
  if (!b) return null;
  return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, rocket: !!b.rocket };
}

// ---- Host election ----------------------------------------------------------

// Lex-min election: whoever's id sorts first is host. Deterministic on both
// sides regardless of who sends their pong-ready first.
export function electHost(myId, otherIds) {
  const all = [myId, ...otherIds].filter(Boolean).sort();
  const hostId = all[0];
  return {
    role: hostId === myId ? 'host' : 'guest',
    hostId,
    otherId: otherIds[0] ?? null,
  };
}

// ---- Pair ID generation -----------------------------------------------------

// 6-character uppercase base32 code. 32^6 ≈ 1.07B keyspace — plenty for
// ephemeral 2-player rooms without a collision concern.
const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Crockford-ish (no I, L, O, 0, 1)

export function generatePairId() {
  const bytes = new Uint8Array(6);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += BASE32_ALPHABET[b % 32];
  return out;
}

export function buddyRoomFromPairId(pairId) {
  return `buddy-${pairId}`;
}

// The short code and the pairId are the same string — the helper exists so
// callsites can be self-documenting.
export function pairIdToShortCode(pairId) {
  return pairId ? pairId.toUpperCase() : '';
}

// Validate a user-entered short code. Returns the canonical form or null.
export function parseShortCode(raw) {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z2-9]/g, '');
  if (cleaned.length !== 6) return null;
  for (const c of cleaned) if (!BASE32_ALPHABET.includes(c)) return null;
  return cleaned;
}

// ---- StackDuo message factories ---------------------------------------------

export function makeStackDuoReady({ myId, committedRole = null }) {
  return { kind: KIND.STACKDUO_READY, t: Date.now(), myId, committedRole };
}

export function makeStackDuoInput({ playerIndex, keys }) {
  return { kind: KIND.STACKDUO_INPUT, t: Date.now(), playerIndex, keys };
}

export function makeStackDuoSnapshot(seq, snapshot) {
  return { kind: KIND.STACKDUO_SNAPSHOT, t: Date.now(), seq, ...snapshot };
}

export function makeStackDuoLobby(lobbyState) {
  return { kind: KIND.STACKDUO_LOBBY, t: Date.now(), ...lobbyState };
}

export function makeStackDuoLobbyAction(action) {
  return { kind: KIND.STACKDUO_LOBBY_ACTION, t: Date.now(), ...action };
}

export function makeStackDuoRequestState() {
  return { kind: KIND.STACKDUO_REQUEST_STATE, t: Date.now() };
}

// ---- Zookeepers message factories -------------------------------------------

export function makeZooReady({ myId, committedRole = null }) {
  return { kind: KIND.ZOO_READY, t: Date.now(), myId, committedRole };
}

export function makeZooInput({ playerIndex, dir }) {
  return { kind: KIND.ZOO_INPUT, t: Date.now(), playerIndex, dir };
}

export function makeZooSnapshot(seq, snapshot) {
  return { kind: KIND.ZOO_SNAPSHOT, t: Date.now(), seq, ...snapshot };
}

export function makeZooLobby(lobbyState) {
  return { kind: KIND.ZOO_LOBBY, t: Date.now(), ...lobbyState };
}

export function makeZooLobbyAction(action) {
  return { kind: KIND.ZOO_LOBBY_ACTION, t: Date.now(), ...action };
}

export function makeZooRequestState() {
  return { kind: KIND.ZOO_REQUEST_STATE, t: Date.now() };
}
