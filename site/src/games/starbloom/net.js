// RtsNetController — wraps a multiplayer transport and owns all of the
// RTS-over-wire logic: host election, command relay, snapshot broadcasting.
//
// Architecture:
//   - Host runs full simulation + AI, broadcasts snapshots at 10 Hz
//   - Guest sends discrete commands (confirm, cancel, number, etc.)
//   - No client-side prediction — cursor/camera are purely local
//   - Guest state comes entirely from host snapshots

import {
  KIND,
  electHost,
  makeRtsReady,
  makeRtsCommand,
  makeRtsSnapshot,
  makeRtsRequestState,
} from '../../multiplayer/netProtocol.js';

const SNAPSHOT_INTERVAL = 1 / 10; // 10 Hz

export class RtsNetController {
  constructor({ transport }) {
    this.t = transport;
    this.unsubscribeRaw = null;
    this.unsubscribeLeave = null;

    this.role = null; // 'host' | 'guest' | null

    // Host: queued commands from guest
    this.guestCommands = [];

    // Guest: latest snapshot
    this.latestSnapshot = null;
    this.latestSnapshotSeq = -1;

    // Callbacks
    this._onSnapshot = null;
    this._onRequestState = null;
    this._onPlayerLeave = null;

    // Host send state
    this._accum = 0;
    this._snapSeq = 0;

    this._electionCancel = null;
  }

  _ensureSubscribed() {
    if (this.unsubscribeRaw) return;
    this.unsubscribeRaw = this.t.subscribe(({ from, data }) => {
      if (!data || !data.kind) return;
      switch (data.kind) {
        case KIND.RTS_COMMAND:
          if (this.role === 'host' && data.command) {
            this.guestCommands.push(data.command);
          }
          break;
        case KIND.RTS_SNAPSHOT:
          if (this.role === 'guest') {
            this.latestSnapshot = data;
            if (this._onSnapshot) this._onSnapshot(data);
          }
          break;
        case KIND.RTS_REQUEST_STATE:
          if (this.role === 'host' && this._onRequestState) {
            this._onRequestState();
          }
          break;
        case KIND.RTS_READY:
          if (this.role) {
            this.t.send(makeRtsReady({
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

  // Host election — identical to Pong's lex-min algorithm.
  electHost() {
    this._ensureSubscribed();
    const myId = this.t.getMyId();
    const sendReady = () => this.t.send(makeRtsReady({
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
          role = peerCommittedRole === 'host' ? 'guest' : 'host';
          hostId = role === 'host' ? myId : peerId;
          otherId = peerId;
        } else {
          const others = peerId ? [peerId] : [];
          ({ role, hostId, otherId } = electHost(myId, others));
        }
        this.role = role;
        this.t.send(makeRtsReady({
          myId: this.t.getMyId(),
          committedRole: this.role,
        }));
        resolve({ role, hostId, otherId });
      };

      peekUnsub = this.t.subscribe(({ data }) => {
        if (done) return;
        if (data && data.kind === KIND.RTS_READY && data.myId) {
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

  // Host: drain queued guest commands
  drainGuestCommands() {
    const cmds = this.guestCommands;
    this.guestCommands = [];
    return cmds;
  }

  // Host: send snapshot at 10 Hz
  maybeSendSnapshot(state, dt) {
    if (this.role !== 'host') return;
    this._accum += dt;
    if (this._accum < SNAPSHOT_INTERVAL) return;
    this._accum = 0;
    this.sendSnapshotNow(state);
  }

  // Host: send immediate snapshot (e.g. answer to request-state)
  sendSnapshotNow(state) {
    if (this.role !== 'host') return;
    this._snapSeq++;
    this.t.send(makeRtsSnapshot(this._snapSeq, serializeState(state)));
  }

  // Guest: send a discrete command to the host
  sendCommand(command) {
    if (this.role !== 'guest') return;
    this.t.send(makeRtsCommand({ command }));
  }

  // Guest: request full state (used on mount / reconnect)
  requestState() {
    if (this.role !== 'guest') return;
    this.t.send(makeRtsRequestState());
  }

  // Guest: apply the latest snapshot to the local state.
  // `localPlayerIdx` identifies this player so cursor/camera are preserved.
  applySnapshotTo(state, localPlayerIdx) {
    const snap = this.latestSnapshot;
    if (!snap || snap.seq <= this.latestSnapshotSeq) return false;
    this.latestSnapshotSeq = snap.seq;
    deserializeInto(state, snap, localPlayerIdx);
    return true;
  }

  getAuthoritativePhase() {
    return this.latestSnapshot?.phase ?? null;
  }

  onSnapshot(cb) { this._onSnapshot = cb; }
  onRequestState(cb) { this._onRequestState = cb; }
  onPlayerLeave(cb) { this._onPlayerLeave = cb; }

  close() {
    this.cancelElection();
    if (this.unsubscribeRaw) { this.unsubscribeRaw(); this.unsubscribeRaw = null; }
    if (this.unsubscribeLeave) { this.unsubscribeLeave(); this.unsubscribeLeave = null; }
  }
}

// ---- Serialization -----------------------------------------------------------

function serializeState(state) {
  return {
    phase: state.phase,
    tick: state.tick,
    nextId: state.nextId,
    wonderOwner: state.wonderOwner,
    wonderTimer: state.wonderTimer,
    winTeam: state.winTeam,
    seed: state.seed,
    difficulty: state.difficulty,
    tiles: packTiles(state.map.tiles),
    players: state.players.map(p => ({
      index: p.index,
      team: p.team,
      isHuman: p.isHuman,
      resources: { food: p.resources.food, gold: p.resources.gold },
      unitCount: p.unitCount,
      buildingCount: p.buildingCount,
      maxUnits: p.maxUnits,
      selectedId: p.selectedId,
      commandMode: p.commandMode,
      buildChoice: p.buildChoice,
      cursorTx: p.cursorTx,
      cursorTy: p.cursorTy,
      shareCooldown: p.shareCooldown,
      requestCooldown: p.requestCooldown,
      pendingRequest: p.pendingRequest,
      upgrades: p.upgrades,
      upgradeTier: p.upgradeTier,
    })),
    units: state.units.map(u => ({
      id: u.id, owner: u.owner, type: u.type,
      tx: u.tx, ty: u.ty, px: u.px, py: u.py,
      hp: u.hp, maxHp: u.maxHp, state: u.state,
      targetId: u.targetId, targetTx: u.targetTx, targetTy: u.targetTy,
      carryType: u.carryType, carryAmt: u.carryAmt,
      cooldown: u.cooldown, gatherTimer: u.gatherTimer,
      flashTimer: u.flashTimer, dizzyTimer: u.dizzyTimer,
    })),
    buildings: state.buildings.map(b => ({
      id: b.id, owner: b.owner, type: b.type,
      tx: b.tx, ty: b.ty, hp: b.hp, maxHp: b.maxHp,
      built: b.built, buildProgress: b.buildProgress, buildTime: b.buildTime,
      trainType: b.trainType, trainProgress: b.trainProgress, trainTime: b.trainTime,
      towerCooldown: b.towerCooldown, flashTimer: b.flashTimer,
    })),
    events: state.events.map(e => ({
      text: e.text, tx: e.tx, ty: e.ty,
      elapsed: e.elapsed, duration: e.duration,
    })),
    particles: state.particles.map(p => ({
      x: p.x, y: p.y, frame: p.frame, maxFrame: p.maxFrame,
    })),
  };
}

// Pack tile array to compact string (each tile is 0-4, one digit per tile)
function packTiles(tiles) {
  let s = '';
  for (let i = 0; i < tiles.length; i++) s += tiles[i];
  return s;
}

// Unpack tile string back into Uint8Array
function unpackTiles(str, tiles) {
  for (let i = 0; i < str.length && i < tiles.length; i++) {
    tiles[i] = str.charCodeAt(i) - 48; // '0' = 48
  }
}

function deserializeInto(state, snap, localPlayerIdx) {
  state.phase = snap.phase;
  state.tick = snap.tick;
  state.nextId = snap.nextId;
  state.wonderOwner = snap.wonderOwner;
  state.wonderTimer = snap.wonderTimer;
  state.winTeam = snap.winTeam;

  // Update map tiles from host
  if (snap.tiles) {
    unpackTiles(snap.tiles, state.map.tiles);
  }

  // Update players — preserve local cursor/camera for the guest's own player
  for (let i = 0; i < snap.players.length && i < state.players.length; i++) {
    const sp = snap.players[i];
    const tp = state.players[i];
    tp.resources.food = sp.resources.food;
    tp.resources.gold = sp.resources.gold;
    tp.unitCount = sp.unitCount;
    tp.buildingCount = sp.buildingCount;
    tp.maxUnits = sp.maxUnits;
    tp.selectedId = sp.selectedId;
    tp.commandMode = sp.commandMode;
    tp.buildChoice = sp.buildChoice;
    tp.shareCooldown = sp.shareCooldown;
    tp.requestCooldown = sp.requestCooldown;
    tp.pendingRequest = sp.pendingRequest;
    tp.upgrades = sp.upgrades;
    tp.upgradeTier = sp.upgradeTier;
    // Don't overwrite local player's cursor/camera
    if (i !== localPlayerIdx) {
      tp.cursorTx = sp.cursorTx;
      tp.cursorTy = sp.cursorTy;
    }
  }

  // Replace units, buildings, events, particles wholesale
  state.units = snap.units;
  state.buildings = snap.buildings;
  state.events = snap.events;
  state.particles = snap.particles;
}

// ---- Transport adapters ------------------------------------------------------

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
