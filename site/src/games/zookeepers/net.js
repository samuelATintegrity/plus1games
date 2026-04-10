// ZookeepersNetController — handles host election, lobby management, snapshot
// broadcasting, guest input relay, and state serialization for 4-player
// networked Zookeepers.
//
// Follows the same transport abstraction as StackDuoNetController:
// the controller receives a { send, subscribe, getMyId, getOtherIds, onPlayerLeave }
// object and is agnostic of whether it's backed by a room-code session or buddy pass.

import {
  KIND,
  electHost,
  makeZooReady,
  makeZooInput,
  makeZooSnapshot,
  makeZooLobby,
  makeZooLobbyAction,
  makeZooRequestState,
} from '../../multiplayer/netProtocol.js';

import { COLS, ROWS } from './maze.js';

const SNAPSHOT_INTERVAL = 1 / 30; // 30 Hz

export class ZookeepersNetController {
  constructor({ transport }) {
    this.t = transport;
    this.unsubscribeRaw = null;
    this.unsubscribeLeave = null;

    this.role = null;           // 'host' | 'guest'
    this.localPlayerIndex = -1; // 0-3, assigned during lobby

    // Host: queued guest inputs
    this._guestInputs = [];

    // Guest: latest snapshot
    this.latestSnapshot = null;
    this.latestSnapshotSeq = -1;

    // Guest: latest lobby state from host
    this.latestLobby = null;

    // Callbacks
    this._onLobbyAction = null;
    this._onPlayerLeave = null;
    this._onRequestState = null;

    // Host snapshot sending state
    this._accum = 0;
    this._snapSeq = 0;

    // Election
    this._electionCancel = null;
  }

  _ensureSubscribed() {
    if (this.unsubscribeRaw) return;
    this.unsubscribeRaw = this.t.subscribe(({ from, data }) => {
      if (!data || !data.kind) return;
      switch (data.kind) {
        case KIND.ZOO_INPUT:
          if (this.role === 'host') {
            this._guestInputs.push(data);
          }
          break;
        case KIND.ZOO_SNAPSHOT:
          if (this.role === 'guest') {
            if (data.seq > this.latestSnapshotSeq) {
              this.latestSnapshot = data;
              this.latestSnapshotSeq = data.seq;
            }
          }
          break;
        case KIND.ZOO_LOBBY:
          if (this.role === 'guest') {
            this.latestLobby = data;
          }
          break;
        case KIND.ZOO_LOBBY_ACTION:
          if (this.role === 'host' && this._onLobbyAction) {
            this._onLobbyAction(data, from);
          }
          break;
        case KIND.ZOO_REQUEST_STATE:
          if (this.role === 'host' && this._onRequestState) {
            this._onRequestState();
          }
          break;
        case KIND.ZOO_READY:
          if (this.role) {
            this.t.send(makeZooReady({
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

  // ---- Host election --------------------------------------------------------

  electHost() {
    this._ensureSubscribed();
    const myId = this.t.getMyId();
    const sendReady = () => this.t.send(makeZooReady({
      myId,
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

        let role;
        if (peerCommittedRole) {
          role = peerCommittedRole === 'host' ? 'guest' : 'host';
        } else {
          const others = peerId ? [peerId] : [];
          ({ role } = electHost(myId, others));
        }
        this.role = role;
        this.t.send(makeZooReady({ myId, committedRole: this.role }));
        resolve({ role, myId });
      };

      peekUnsub = this.t.subscribe(({ data }) => {
        if (done) return;
        if (data && data.kind === KIND.ZOO_READY && data.myId) {
          peerId = data.myId;
          peerCommittedRole = data.committedRole || null;
          finish();
        }
      });

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

  // ---- Host: snapshot sending -----------------------------------------------

  maybeSendSnapshot(state, dt) {
    if (this.role !== 'host') return;
    this._accum += dt;
    if (this._accum < SNAPSHOT_INTERVAL) return;
    this._accum = 0;
    this._snapSeq++;
    this.t.send(makeZooSnapshot(this._snapSeq, serializeState(state)));
  }

  sendSnapshotNow(state) {
    if (this.role !== 'host') return;
    this._snapSeq++;
    this.t.send(makeZooSnapshot(this._snapSeq, serializeState(state)));
  }

  // ---- Host: lobby broadcast ------------------------------------------------

  sendLobby(lobbyState) {
    if (this.role !== 'host') return;
    this.t.send(makeZooLobby(lobbyState));
  }

  // ---- Host: drain guest inputs ---------------------------------------------

  drainGuestInputs() {
    const out = this._guestInputs;
    this._guestInputs = [];
    return out;
  }

  // ---- Guest: send input ----------------------------------------------------

  sendInput(playerIndex, dir) {
    if (this.role !== 'guest') return;
    this.t.send(makeZooInput({ playerIndex, dir }));
  }

  // ---- Guest: lobby actions -------------------------------------------------

  sendLobbyAction(action) {
    if (this.role !== 'guest') return;
    this.t.send(makeZooLobbyAction(action));
  }

  // ---- Guest: request state -------------------------------------------------

  requestState() {
    if (this.role !== 'guest') return;
    this.t.send(makeZooRequestState());
  }

  // ---- Guest: apply snapshot to state ---------------------------------------

  applySnapshotTo(state) {
    const snap = this.latestSnapshot;
    if (!snap) return false;

    state.phase = snap.phase;
    state.elapsed = snap.elapsed;
    state.countdownTimer = snap.countdownTimer;
    state.level = snap.level;
    state.score = snap.score;
    state.lives = snap.lives;
    state.dotsRemaining = snap.dotsRemaining;
    state.dotsTotal = snap.dotsTotal;
    state.dotsEaten = snap.dotsEaten;
    state.frightTimer = snap.frightTimer;
    state.frightKillCount = snap.frightKillCount;
    state.fruitActive = snap.fruitActive;
    state.fruitType = snap.fruitType;
    state.fruitTimer = snap.fruitTimer;
    state.globalMode = snap.globalMode;
    state.modePhase = snap.modePhase;
    state.modeTimer = snap.modeTimer;
    state.dyingTimer = snap.dyingTimer;
    state.dyingZookeeper = snap.dyingZookeeper;
    state.levelCompleteTimer = snap.levelCompleteTimer;

    // Tiles
    if (snap.tiles) {
      unpackTiles(snap.tiles, state.tiles);
    }

    // Zookeepers
    for (let i = 0; i < 2; i++) {
      const sz = snap.zookeepers[i];
      const tz = state.zookeepers[i];
      tz.alive = sz.alive;
      tz.x = sz.x;
      tz.y = sz.y;
      tz.tileX = sz.tileX;
      tz.tileY = sz.tileY;
      tz.dir = sz.dir;
      tz.nextDir = sz.nextDir;
      tz.animFrame = sz.animFrame;
      tz.isHuman = sz.isHuman;
    }

    // Animals
    for (let i = 0; i < 4; i++) {
      const sa = snap.animals[i];
      const ta = state.animals[i];
      ta.x = sa.x;
      ta.y = sa.y;
      ta.tileX = sa.tileX;
      ta.tileY = sa.tileY;
      ta.dir = sa.dir;
      ta.mode = sa.mode;
      ta.prevMode = sa.prevMode;
      ta.inPen = sa.inPen;
      ta.exitingPen = sa.exitingPen;
      ta.released = sa.released;
      ta.frightBlinkTimer = sa.frightBlinkTimer;
      ta.isHuman = sa.isHuman;
      ta.speed = sa.speed;
    }

    // Lobby
    if (snap.lobby) {
      state.lobby.slots = [...snap.lobby.slots];
    }

    return true;
  }

  // ---- Callbacks ------------------------------------------------------------

  onLobbyAction(cb) { this._onLobbyAction = cb; }
  onPlayerLeave(cb) { this._onPlayerLeave = cb; }
  onRequestState(cb) { this._onRequestState = cb; }

  // ---- Cleanup --------------------------------------------------------------

  close() {
    this.cancelElection();
    if (this.unsubscribeRaw) { this.unsubscribeRaw(); this.unsubscribeRaw = null; }
    if (this.unsubscribeLeave) { this.unsubscribeLeave(); this.unsubscribeLeave = null; }
  }
}

// ---- State serialization ----------------------------------------------------

function serializeState(state) {
  return {
    phase: state.phase,
    elapsed: state.elapsed,
    countdownTimer: state.countdownTimer,
    level: state.level,
    score: state.score,
    lives: state.lives,
    dotsRemaining: state.dotsRemaining,
    dotsTotal: state.dotsTotal,
    dotsEaten: state.dotsEaten,
    frightTimer: state.frightTimer,
    frightKillCount: state.frightKillCount,
    fruitActive: state.fruitActive,
    fruitType: state.fruitType,
    fruitTimer: state.fruitTimer,
    globalMode: state.globalMode,
    modePhase: state.modePhase,
    modeTimer: state.modeTimer,
    dyingTimer: state.dyingTimer,
    dyingZookeeper: state.dyingZookeeper,
    levelCompleteTimer: state.levelCompleteTimer,
    tiles: packTiles(state.tiles),
    zookeepers: state.zookeepers.map(zk => ({
      alive: zk.alive,
      x: zk.x,
      y: zk.y,
      tileX: zk.tileX,
      tileY: zk.tileY,
      dir: zk.dir,
      nextDir: zk.nextDir,
      animFrame: zk.animFrame,
      isHuman: zk.isHuman,
    })),
    animals: state.animals.map(a => ({
      x: a.x,
      y: a.y,
      tileX: a.tileX,
      tileY: a.tileY,
      dir: a.dir,
      mode: a.mode,
      prevMode: a.prevMode,
      inPen: a.inPen,
      exitingPen: a.exitingPen,
      released: a.released,
      frightBlinkTimer: a.frightBlinkTimer,
      isHuman: a.isHuman,
      speed: a.speed,
    })),
    lobby: { slots: [...state.lobby.slots] },
  };
}

// Pack tile array as digit string (each tile 0-6)
function packTiles(tiles) {
  let s = '';
  for (let i = 0; i < tiles.length; i++) s += tiles[i];
  return s;
}

// Unpack digit string back into Uint8Array
function unpackTiles(packed, target) {
  for (let i = 0; i < packed.length; i++) {
    target[i] = packed.charCodeAt(i) - 48; // '0'=48
  }
}

// ---- Transport adapters -----------------------------------------------------

export function sessionTransport(session) {
  const listeners = new Set();
  session.on('message', (msg) => {
    for (const cb of listeners) cb(msg);
  });
  const leaveListeners = new Set();
  session.on('player-leave', (msg) => {
    for (const cb of leaveListeners) cb(msg);
  });
  return {
    send: (data) => session.send(data),
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    onPlayerLeave: (cb) => { leaveListeners.add(cb); return () => leaveListeners.delete(cb); },
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
