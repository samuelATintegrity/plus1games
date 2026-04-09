// PongNetController — wraps a multiplayer Session and owns all of the
// pong-over-wire logic: host election, state serialization, snapshot
// broadcasting, guest input relay, and reconciliation hooks.
//
// The controller supports two session delivery modes:
//
//   • "raw Session"     — used when the game is launched with ?room=1234.
//     The pong component creates its own Session and hands it to the
//     controller. Messages are sent via session.send() and received via
//     session.on('message', ({from, data}) => ...).
//
//   • "buddy passthrough" — used when the game was entered from a buddy
//     pass. The pong component passes an abstracted { send, subscribe,
//     getMyId, getOtherIds, onPlayerLeave } object that forwards to the
//     buddy session. This way the provider keeps ownership of the buddy
//     session lifetime, and pong just multiplexes its own kinds on it.

import {
  KIND,
  electHost,
  makePongInput,
  makePongReady,
  makePongRequestState,
  makePongSnapshot,
} from '../../multiplayer/netProtocol.js';

const SNAPSHOT_INTERVAL = 1 / 30; // 30 Hz

export class PongNetController {
  /**
   * @param {Object} opts
   * @param {Object} opts.transport — { send, subscribe, getMyId, getOtherIds, onPlayerLeave }
   */
  constructor({ transport }) {
    this.t = transport;
    this.unsubscribeRaw = null;
    this.unsubscribeLeave = null;

    this.role = null;        // 'host' | 'guest' | null
    this.guestKeys = {       // host reads this to drive P2
      ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
    };

    // Guest-side snapshot buffer
    this.latestSnapshot = null;
    this.latestSnapshotAppliedSeq = -1;

    // Callbacks
    this._onSnapshot = null;
    this._onGuestStart = null;
    this._onRequestState = null;
    this._onPlayerLeave = null;

    // Host send state
    this._accum = 0;
    this._snapSeq = 0;

    // Guest send state
    this._inputSeq = 0;
    this._lastSentKeys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
  }

  // Subscribe to raw messages once
  _ensureSubscribed() {
    if (this.unsubscribeRaw) return;
    this.unsubscribeRaw = this.t.subscribe(({ from, data }) => {
      if (!data || !data.kind) return;
      switch (data.kind) {
        case KIND.PONG_INPUT:
          // Host consumes guest input
          if (this.role === 'host' && data.keys) {
            this.guestKeys.ArrowUp = !!data.keys.ArrowUp;
            this.guestKeys.ArrowDown = !!data.keys.ArrowDown;
            this.guestKeys.ArrowLeft = !!data.keys.ArrowLeft;
            this.guestKeys.ArrowRight = !!data.keys.ArrowRight;
            if (data.startPressed && this._onStartPressed) this._onStartPressed();
          }
          break;
        case KIND.PONG_SNAPSHOT:
          if (this.role === 'guest') {
            this.latestSnapshot = data;
            if (this._onSnapshot) this._onSnapshot(data);
          }
          break;
        case KIND.PONG_REQUEST_STATE:
          if (this.role === 'host' && this._onRequestState) {
            this._onRequestState();
          }
          break;
        case KIND.PONG_READY:
          // If we've already finished election and someone new comes online,
          // reply with our own pong-ready so they can finish their election.
          // We advertise our committed role so the late-arriving peer takes
          // the opposite side regardless of lex-min — otherwise a host that
          // had timed out alone could collide with a guest whose id happens
          // to sort earlier.
          if (this.role) {
            this.t.send(makePongReady({
              myId: this.t.getMyId(),
              committedRole: this.role,
            }));
          }
          break;
        default:
          break;
      }
    });

    if (this.t.onPlayerLeave) {
      this.unsubscribeLeave = this.t.onPlayerLeave((payload) => {
        if (this._onPlayerLeave) this._onPlayerLeave(payload);
      });
    }
  }

  // Perform host election. Sends pong-ready repeatedly until the peer's
  // pong-ready arrives; resolves lex-min on the pair of ids. No timeout —
  // networked mode is meant for two real players, so we wait indefinitely
  // for the second one. The periodic rebroadcast (every 600 ms) ensures a
  // late-joining peer receives our readiness even if they arrived after
  // our first send, without requiring them to be online when we started.
  //
  // Cancellation: the caller holds the returned promise; if the component
  // unmounts before resolution, it should call `cancelElection()`.
  electHost() {
    this._ensureSubscribed();
    const myId = this.t.getMyId();
    const sendReady = () => this.t.send(makePongReady({
      myId: this.t.getMyId(),
      committedRole: this.role || null,
    }));
    sendReady();

    return new Promise((resolve) => {
      let done = false;
      let peerId = null;
      let peerCommittedRole = null;
      let peekUnsub = null;
      let pollTimer = null;

      const finish = () => {
        if (done) return;
        done = true;
        if (pollTimer) clearInterval(pollTimer);
        if (peekUnsub) peekUnsub();
        let role, hostId, otherId;
        if (peerCommittedRole) {
          // The peer has already elected and committed. Defer to them.
          role = peerCommittedRole === 'host' ? 'guest' : 'host';
          hostId = role === 'host' ? myId : peerId;
          otherId = peerId;
        } else {
          const others = peerId ? [peerId] : [];
          ({ role, hostId, otherId } = electHost(myId, others));
        }
        this.role = role;
        // Broadcast our committed role immediately so the peer finishes
        // their own election on the next message rather than after their
        // next poll tick.
        this.t.send(makePongReady({
          myId: this.t.getMyId(),
          committedRole: this.role,
        }));
        resolve({ role, hostId, otherId });
      };

      peekUnsub = this.t.subscribe(({ data }) => {
        if (done) return;
        if (data && data.kind === KIND.PONG_READY && data.myId) {
          peerId = data.myId;
          peerCommittedRole = data.committedRole || null;
          finish();
        }
      });
      // Keep rebroadcasting our readiness so any peer that joins after
      // us picks up the handshake without waiting on their own resends.
      pollTimer = setInterval(sendReady, 600);
      this._electionCancel = () => {
        if (done) return;
        done = true;
        if (pollTimer) clearInterval(pollTimer);
        if (peekUnsub) peekUnsub();
      };
    });
  }

  cancelElection() {
    if (this._electionCancel) { this._electionCancel(); this._electionCancel = null; }
  }

  // Host: call once per frame with (state, dtSeconds). Sends a snapshot
  // at most every 1/30s.
  maybeSendSnapshot(state, dt) {
    if (this.role !== 'host') return;
    this._accum += dt;
    if (this._accum < SNAPSHOT_INTERVAL) return;
    this._accum = 0;
    this._snapSeq += 1;
    this.t.send(makePongSnapshot(this._snapSeq, state));
  }

  // Host: send an immediate snapshot (answer to pong-request-state)
  sendSnapshotNow(state) {
    if (this.role !== 'host') return;
    this._snapSeq += 1;
    this.t.send(makePongSnapshot(this._snapSeq, state));
  }

  // Guest: send delta input on keydown/keyup only
  sendGuestInput(keys, { startPressed = false } = {}) {
    if (this.role !== 'guest') return;
    // Only send if something relevant changed OR startPressed is set.
    const relevant = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const now = {};
    let changed = startPressed;
    for (const k of relevant) {
      now[k] = !!keys[k];
      if (now[k] !== this._lastSentKeys[k]) changed = true;
    }
    if (!changed) return;
    this._lastSentKeys = now;
    this._inputSeq += 1;
    this.t.send(makePongInput({ seq: this._inputSeq, keys: now, startPressed }));
  }

  // Guest: ask the host for the current state (used on mount)
  requestState() {
    if (this.role !== 'guest') return;
    this.t.send(makePongRequestState());
  }

  // Apply the latest snapshot to the guest's state ref. Mutates `target`
  // in place to minimize allocations.
  applyLatestSnapshotTo(target) {
    const snap = this.latestSnapshot;
    if (!snap) return false;
    if (snap.seq <= this.latestSnapshotAppliedSeq) return false;
    this.latestSnapshotAppliedSeq = snap.seq;
    applyEntity(target.p1, snap.p1);
    applyEntity(target.p2, snap.p2);
    applyEntity(target.ai1, snap.ai1);
    applyEntity(target.ai2, snap.ai2);
    if (snap.ball) {
      target.ball.x = snap.ball.x;
      target.ball.y = snap.ball.y;
      target.ball.vx = snap.ball.vx;
      target.ball.vy = snap.ball.vy;
      target.ball.rocket = !!snap.ball.rocket;
    }
    if (snap.score) {
      target.score.team = snap.score.team;
      target.score.ai = snap.score.ai;
    }
    target.hits = snap.hits;
    target.lastToucher = snap.lastToucher;
    target.lastSide = snap.lastSide;
    target.touchCooldown = snap.touchCooldown;
    target.serveTimer = snap.serveTimer;
    if (snap.aiAim !== undefined) target.aiAim = snap.aiAim;
    return true;
  }

  // Expose the host's authoritative P2 position so the guest can
  // reconcile its own client-side prediction.
  getAuthoritativeP2() {
    return this.latestSnapshot?.p2 ?? null;
  }

  // Expose authoritative phase for guest phase sync.
  getAuthoritativePhase() {
    return this.latestSnapshot?.phase ?? null;
  }

  onSnapshot(cb) { this._onSnapshot = cb; }
  onRequestState(cb) { this._onRequestState = cb; }
  onStartPressed(cb) { this._onStartPressed = cb; }
  onPlayerLeave(cb) { this._onPlayerLeave = cb; }

  close() {
    this.cancelElection();
    if (this.unsubscribeRaw) { this.unsubscribeRaw(); this.unsubscribeRaw = null; }
    if (this.unsubscribeLeave) { this.unsubscribeLeave(); this.unsubscribeLeave = null; }
  }
}

function applyEntity(target, src) {
  if (!target || !src) return;
  target.x = src.x;
  target.y = src.y;
  target.vx = src.vx;
  target.vy = src.vy;
}

// ---- Transports -------------------------------------------------------------
// Thin adapters that convert either a raw Session or a BuddyProvider context
// into the `transport` object the PongNetController expects.

export function sessionTransport(session) {
  let listeners = new Set();
  session.on('message', (msg) => {
    for (const cb of listeners) cb(msg);
  });
  let leaveListeners = new Set();
  session.on('player-leave', (msg) => {
    for (const cb of leaveListeners) cb(msg);
  });
  return {
    send: (data) => session.send(data),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onPlayerLeave: (cb) => {
      leaveListeners.add(cb);
      return () => leaveListeners.delete(cb);
    },
    getMyId: () => session.id,
    getOtherIds: () => session.players.filter((p) => p !== session.id),
  };
}

export function buddyTransport(buddy) {
  return {
    send: (data) => buddy.sendBuddyMessage(data),
    subscribe: (cb) => buddy.onRawMessage(cb),
    onPlayerLeave: (cb) => buddy.onBuddyLeave(cb),
    getMyId: () => buddy.getSessionId(),
    getOtherIds: () => {
      const out = [];
      for (const [id] of buddy.remotePlayers) out.push(id);
      return out;
    },
  };
}
