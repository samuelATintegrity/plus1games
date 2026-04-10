// StackDuoNetController — handles host election, lobby management, snapshot
// broadcasting, guest input relay, and state serialization for 4-player
// networked StackDuo.
//
// Follows the same transport abstraction as PongNetController / RtsNetController:
// the controller receives a { send, subscribe, getMyId, getOtherIds, onPlayerLeave }
// object and is agnostic of whether it's backed by a room-code session or buddy pass.

import {
  KIND,
  electHost,
  makeStackDuoReady,
  makeStackDuoInput,
  makeStackDuoSnapshot,
  makeStackDuoLobby,
  makeStackDuoLobbyAction,
  makeStackDuoRequestState,
} from '../../multiplayer/netProtocol.js';

import { BOARD_W, BOARD_H } from './state.js';

const SNAPSHOT_INTERVAL = 1 / 30; // 30 Hz

export class StackDuoNetController {
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
    this._onStartPressed = null;

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
        case KIND.STACKDUO_INPUT:
          if (this.role === 'host') {
            this._guestInputs.push(data);
          }
          break;
        case KIND.STACKDUO_SNAPSHOT:
          if (this.role === 'guest') {
            if (data.seq > this.latestSnapshotSeq) {
              this.latestSnapshot = data;
              this.latestSnapshotSeq = data.seq;
            }
          }
          break;
        case KIND.STACKDUO_LOBBY:
          if (this.role === 'guest') {
            this.latestLobby = data;
          }
          break;
        case KIND.STACKDUO_LOBBY_ACTION:
          if (this.role === 'host' && this._onLobbyAction) {
            this._onLobbyAction(data, from);
          }
          break;
        case KIND.STACKDUO_REQUEST_STATE:
          if (this.role === 'host' && this._onRequestState) {
            this._onRequestState();
          }
          break;
        case KIND.STACKDUO_READY:
          // If already elected, reply so late joiners can finish their election.
          if (this.role) {
            this.t.send(makeStackDuoReady({
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
    const sendReady = () => this.t.send(makeStackDuoReady({
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
        this.t.send(makeStackDuoReady({ myId, committedRole: this.role }));
        resolve({ role, myId });
      };

      peekUnsub = this.t.subscribe(({ data }) => {
        if (done) return;
        if (data && data.kind === KIND.STACKDUO_READY && data.myId) {
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
    this.t.send(makeStackDuoSnapshot(this._snapSeq, serializeState(state)));
  }

  sendSnapshotNow(state) {
    if (this.role !== 'host') return;
    this._snapSeq++;
    this.t.send(makeStackDuoSnapshot(this._snapSeq, serializeState(state)));
  }

  // ---- Host: lobby broadcast ------------------------------------------------

  sendLobby(lobbyState) {
    if (this.role !== 'host') return;
    this.t.send(makeStackDuoLobby(lobbyState));
  }

  // ---- Host: drain guest inputs ---------------------------------------------

  drainGuestInputs() {
    const out = this._guestInputs;
    this._guestInputs = [];
    return out;
  }

  // ---- Guest: send input ----------------------------------------------------

  sendInput(playerIndex, keys) {
    if (this.role !== 'guest') return;
    this.t.send(makeStackDuoInput({ playerIndex, keys }));
  }

  // ---- Guest: lobby actions -------------------------------------------------

  sendLobbyAction(action) {
    if (this.role !== 'guest') return;
    this.t.send(makeStackDuoLobbyAction(action));
  }

  // ---- Guest: request state -------------------------------------------------

  requestState() {
    if (this.role !== 'guest') return;
    this.t.send(makeStackDuoRequestState());
  }

  // ---- Guest: apply snapshot to state ---------------------------------------

  applySnapshotTo(state, localPlayerIndex) {
    const snap = this.latestSnapshot;
    if (!snap) return false;

    state.phase = snap.phase;
    state.elapsed = snap.elapsed;
    state.countdownTimer = snap.countdownTimer;
    state.winTeam = snap.winTeam;

    // Apply boards
    for (let bi = 0; bi < 2; bi++) {
      const sb = snap.boards[bi];
      const tb = state.boards[bi];
      unpackCells(sb.cells, tb.cells);
      tb.pendingGarbage = sb.pendingGarbage;
      tb.garbageTimer = sb.garbageTimer;
      tb.lastClearTime = sb.lastClearTime;
      tb.linesCleared[0] = sb.linesCleared[0];
      tb.linesCleared[1] = sb.linesCleared[1];
      tb.totalLinesCleared = sb.totalLinesCleared;
      tb.inDanger = sb.inDanger;
      tb.score = sb.score;
    }

    // Apply players
    for (let pi = 0; pi < 4; pi++) {
      const sp = snap.players[pi];
      const tp = state.players[pi];
      tp.isHuman = sp.isHuman;
      tp.queue = sp.queue ? [...sp.queue] : tp.queue;
      tp.hold = sp.hold;
      tp.holdUsed = sp.holdUsed;
      tp.linesCleared = sp.linesCleared;
      tp.piecesPlaced = sp.piecesPlaced;
      tp.dropTimer = sp.dropTimer;
      tp.lockTimer = sp.lockTimer;
      tp.lockMoves = sp.lockMoves;

      // For local player, only override piece if significantly different
      if (pi === localPlayerIndex && tp.piece && sp.piece) {
        // Reconcile: snap to host if piece type or rotation differs,
        // or if position differs by more than 1 cell
        if (sp.piece.type !== tp.piece.type || sp.piece.rot !== tp.piece.rot ||
            Math.abs(sp.piece.x - tp.piece.x) > 1 || Math.abs(sp.piece.y - tp.piece.y) > 1) {
          tp.piece = sp.piece ? { ...sp.piece } : null;
        }
      } else {
        tp.piece = sp.piece ? { ...sp.piece } : null;
      }
    }

    // Apply lobby
    if (snap.lobby) {
      state.lobby.slots = [...snap.lobby.slots];
    }

    return true;
  }

  // ---- Callbacks ------------------------------------------------------------

  onLobbyAction(cb) { this._onLobbyAction = cb; }
  onPlayerLeave(cb) { this._onPlayerLeave = cb; }
  onRequestState(cb) { this._onRequestState = cb; }
  onStartPressed(cb) { this._onStartPressed = cb; }

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
    winTeam: state.winTeam,
    boards: state.boards.map(b => ({
      cells: packCells(b.cells),
      pendingGarbage: b.pendingGarbage,
      garbageTimer: b.garbageTimer,
      lastClearTime: b.lastClearTime,
      linesCleared: [...b.linesCleared],
      totalLinesCleared: b.totalLinesCleared,
      inDanger: b.inDanger,
      score: b.score,
    })),
    players: state.players.map(p => ({
      isHuman: p.isHuman,
      piece: p.piece ? { ...p.piece } : null,
      queue: [...p.queue],
      hold: p.hold,
      holdUsed: p.holdUsed,
      dropTimer: p.dropTimer,
      lockTimer: p.lockTimer,
      lockMoves: p.lockMoves,
      linesCleared: p.linesCleared,
      piecesPlaced: p.piecesPlaced,
    })),
    lobby: { slots: [...state.lobby.slots] },
  };
}

// Pack Uint8Array board cells into a compact digit string (each cell 0-5).
function packCells(cells) {
  let s = '';
  for (let i = 0; i < cells.length; i++) s += cells[i];
  return s;
}

// Unpack digit string back into Uint8Array.
function unpackCells(packed, target) {
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
