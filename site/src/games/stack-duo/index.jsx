// StackDuo — 2v2 competitive block-stacking game.
//
// Two teams of two share a board each. Each player controls their own falling
// piece simultaneously on their shared team board. Line clears send garbage
// to the opposing team. First team to top out loses.
//
// Supports networked play (room codes / buddy pass) with authoritative host,
// or local play with all AI.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLayoutMode } from '../../layout/LayoutModeContext.jsx';
import { useBuddy } from '../../multiplayer/BuddyProvider.jsx';
import RoomCodePanel from '../../components/RoomCodePanel.jsx';
import { StackDuoNetController } from './net.js';
import { useGameSession } from './useGameSession.js';
import { KIND } from '../../multiplayer/netProtocol.js';
import { LOGICAL_W, LOGICAL_H, SCALE, makeGameState, fillQueue } from './state.js';
import { tickSimulation, spawnInitialPieces } from './simulation.js';
import { tickAI } from './ai.js';
import { draw, drawLobby, drawCountdown, drawGameOver, initSprites } from './render.js';

// Key code → abstract action mapping
const KEY_MAP = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyS: 'softDrop', ArrowDown: 'softDrop',
  KeyW: 'hardDrop', ArrowUp: 'hardDrop',
  KeyE: 'rotateCW',
  KeyQ: 'rotateCCW',
  KeyR: 'hold',
};

export default function StackDuo() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useLayoutMode('fullscreen');
  const buddy = useBuddy();

  const canvasRef = useRef(null);
  const stateRef = useRef(makeGameState());
  const phaseRef = useRef('lobby');
  const keysRef = useRef({});
  const [phase, setPhase] = useState('lobby');

  // Networking
  const game = useGameSession({ buddy, searchParams });
  const netRef = useRef(null);
  const roleRef = useRef('local');
  const localPlayerRef = useRef(0);

  // Blink timer for UI animations
  const blinkRef = useRef(0);

  // Sync phase ref with state
  const updatePhase = (p) => {
    phaseRef.current = p;
    stateRef.current.phase = p;
    setPhase(p);
  };

  // ---- Network controller setup ----
  useEffect(() => {
    if (!game.transport) {
      roleRef.current = 'local';
      // In local mode, fill all slots with AI and auto-assign player 0
      const s = stateRef.current;
      s.lobby.slots = ['local', 'ai', 'ai', 'ai'];
      for (let i = 1; i < 4; i++) s.players[i].isHuman = false;
      localPlayerRef.current = 0;
      netRef.current = null;
      return;
    }

    const net = new StackDuoNetController({ transport: game.transport });
    netRef.current = net;

    // Start host election
    let mounted = true;
    net.electHost().then(({ role, myId }) => {
      if (!mounted) return;
      roleRef.current = role;
      const s = stateRef.current;

      if (role === 'host') {
        // Host assigns self to slot 0
        s.lobby.slots[0] = myId;
        localPlayerRef.current = 0;
        // Fill rest with AI initially
        for (let i = 1; i < 4; i++) {
          s.lobby.slots[i] = 'ai';
          s.players[i].isHuman = false;
        }
        net.sendLobby({ slots: [...s.lobby.slots] });

        // Listen for lobby actions from guests
        net.onLobbyAction((data, from) => {
          handleLobbyAction(data, from);
        });

        // Handle player joins (subscribe to transport for new ready messages)
        // New players are assigned when they send a READY after election
        const joinUnsub = game.transport.subscribe(({ from, data }) => {
          if (!data || data.kind !== KIND.STACKDUO_READY) return;
          if (!data.myId || s.phase !== 'lobby') return;
          // Auto-assign to first empty or AI slot
          const peerId = data.myId;
          // Don't re-add if already in a slot
          if (s.lobby.slots.includes(peerId)) return;
          for (let i = 0; i < 4; i++) {
            if (s.lobby.slots[i] === 'ai' || s.lobby.slots[i] === null) {
              s.lobby.slots[i] = peerId;
              s.players[i].isHuman = true;
              net.sendLobby({ slots: [...s.lobby.slots] });
              // Send current state to newly joined player
              net.sendSnapshotNow(s);
              break;
            }
          }
        });

        // Handle player leave
        net.onPlayerLeave(({ playerId }) => {
          const s = stateRef.current;
          for (let i = 0; i < 4; i++) {
            if (s.lobby.slots[i] === playerId) {
              s.lobby.slots[i] = 'ai';
              s.players[i].isHuman = false;
              if (s.phase === 'lobby') {
                net.sendLobby({ slots: [...s.lobby.slots] });
              }
              break;
            }
          }
        });

        net.onRequestState(() => {
          net.sendSnapshotNow(stateRef.current);
        });
      } else {
        // Guest: find which slot we're in from host lobby broadcasts
        localPlayerRef.current = -1; // will be assigned when lobby arrives
        net.requestState();
      }
    });

    return () => {
      mounted = false;
      net.close();
      netRef.current = null;
    };
  }, [game.transport]);

  // Handle lobby actions from guests (host-side)
  function handleLobbyAction(data, from) {
    const s = stateRef.current;
    const net = netRef.current;
    if (!net || s.phase !== 'lobby') return;

    if (data.action === 'switchTeam') {
      // Find the player's current slot
      const peerId = data.peerId;
      const curIdx = s.lobby.slots.indexOf(peerId);
      if (curIdx === -1) return;
      const curTeam = curIdx < 2 ? 0 : 1;
      const targetTeam = 1 - curTeam;
      // Find empty/AI slot on target team
      const start = targetTeam * 2;
      for (let i = start; i < start + 2; i++) {
        if (s.lobby.slots[i] === 'ai' || s.lobby.slots[i] === null) {
          s.lobby.slots[i] = peerId;
          s.players[i].isHuman = true;
          s.lobby.slots[curIdx] = 'ai';
          s.players[curIdx].isHuman = false;
          net.sendLobby({ slots: [...s.lobby.slots] });
          return;
        }
      }
    } else if (data.action === 'addAi') {
      const slot = data.slot;
      if (slot >= 0 && slot < 4 && s.lobby.slots[slot] === null) {
        s.lobby.slots[slot] = 'ai';
        s.players[slot].isHuman = false;
        net.sendLobby({ slots: [...s.lobby.slots] });
      }
    } else if (data.action === 'removeAi') {
      const slot = data.slot;
      if (slot >= 0 && slot < 4 && s.lobby.slots[slot] === 'ai') {
        s.lobby.slots[slot] = null;
        net.sendLobby({ slots: [...s.lobby.slots] });
      }
    }
  }

  // Start the game (host or local)
  function startGame() {
    const s = stateRef.current;
    // Ensure all slots are filled
    for (let i = 0; i < 4; i++) {
      if (s.lobby.slots[i] === null) {
        s.lobby.slots[i] = 'ai';
        s.players[i].isHuman = false;
      }
    }
    // Initialize queues and spawn
    for (const p of s.players) fillQueue(p);
    s.countdownTimer = 3;
    updatePhase('countdown');
    if (netRef.current) netRef.current.sendSnapshotNow(s);
  }

  // ---- Keyboard input ----
  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.code] = true;

      const phase = phaseRef.current;
      const pi = localPlayerRef.current;
      const s = stateRef.current;
      const net = netRef.current;
      const isGuest = roleRef.current === 'guest';
      const isHost = roleRef.current === 'host';

      // Lobby controls
      if (phase === 'lobby') {
        if (e.code === 'Enter' && !isGuest) {
          const allFilled = s.lobby.slots.every(sl => sl !== null);
          if (allFilled) startGame();
        }
        if (e.code === 'KeyT') {
          if (isGuest && net) {
            net.sendLobbyAction({ action: 'switchTeam', peerId: game.transport.getMyId() });
          } else if (!isGuest) {
            // Host switch team locally
            handleLobbyAction({ action: 'switchTeam', peerId: s.lobby.slots[pi] });
          }
        }
        if (e.code === 'KeyF') {
          // Fill first empty slot with AI
          for (let i = 0; i < 4; i++) {
            if (s.lobby.slots[i] === null) {
              if (isGuest && net) {
                net.sendLobbyAction({ action: 'addAi', slot: i });
              } else {
                s.lobby.slots[i] = 'ai';
                s.players[i].isHuman = false;
                if (net) net.sendLobby({ slots: [...s.lobby.slots] });
              }
              break;
            }
          }
        }
        if (e.code === 'KeyG') {
          // Remove last AI slot
          for (let i = 3; i >= 0; i--) {
            if (s.lobby.slots[i] === 'ai') {
              if (isGuest && net) {
                net.sendLobbyAction({ action: 'removeAi', slot: i });
              } else {
                s.lobby.slots[i] = null;
                if (net) net.sendLobby({ slots: [...s.lobby.slots] });
              }
              break;
            }
          }
        }
      }

      // Game over — restart
      if (phase === 'over' && e.code === 'Enter') {
        // Reset state
        const newState = makeGameState();
        // Preserve lobby slots and player human flags
        newState.lobby.slots = [...s.lobby.slots];
        for (let i = 0; i < 4; i++) {
          newState.players[i].isHuman = s.players[i].isHuman;
        }
        Object.assign(s, newState);
        updatePhase('lobby');
      }

      // Playing — apply input
      if (phase === 'playing' && pi >= 0 && pi < 4) {
        const action = KEY_MAP[e.code];
        if (action) {
          if (isGuest && net) {
            const keys = mapRawToGameKeys(keysRef.current);
            net.sendInput(pi, keys);
          } else {
            s.players[pi].keys[action] = true;
          }
          e.preventDefault();
        }
      }

      // Prevent scrolling
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const up = (e) => {
      keysRef.current[e.code] = false;

      const phase = phaseRef.current;
      const pi = localPlayerRef.current;
      const s = stateRef.current;
      const net = netRef.current;
      const isGuest = roleRef.current === 'guest';

      if (phase === 'playing' && pi >= 0 && pi < 4) {
        const action = KEY_MAP[e.code];
        if (action) {
          if (isGuest && net) {
            const keys = mapRawToGameKeys(keysRef.current);
            net.sendInput(pi, keys);
          } else {
            s.players[pi].keys[action] = false;
          }
        }
      }
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- Canvas + RAF loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = LOGICAL_W * SCALE;
    canvas.height = LOGICAL_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    initSprites();

    let raf = 0;
    let lastT = performance.now();
    const frame = (nowT) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.033, (nowT - lastT) / 1000);
      lastT = nowT;

      blinkRef.current += dt;
      const blink = Math.floor(blinkRef.current * 3) % 2 === 0;

      const s = stateRef.current;
      const r = roleRef.current;
      const net = netRef.current;
      const pi = localPlayerRef.current;
      const curPhase = phaseRef.current;

      // ---- Guest: apply snapshots across all phases ----
      if (r === 'guest' && net) {
        // Apply lobby updates
        if (net.latestLobby) {
          s.lobby.slots = [...net.latestLobby.slots];
          // Determine our local player index from lobby
          const myId = game.transport.getMyId();
          const idx = s.lobby.slots.indexOf(myId);
          if (idx >= 0) localPlayerRef.current = idx;
          net.latestLobby = null;
        }

        // Apply game snapshots
        if (net.latestSnapshot) {
          const savedPiece = pi >= 0 && pi < 4 && s.players[pi]?.piece
            ? { ...s.players[pi].piece } : null;

          net.applySnapshotTo(s, pi);

          // Phase sync
          if (s.phase !== curPhase) {
            updatePhase(s.phase);
          }
        }
      }

      // ---- Countdown ----
      if (curPhase === 'countdown') {
        if (r !== 'guest') {
          s.countdownTimer -= dt;
          if (s.countdownTimer <= 0) {
            spawnInitialPieces(s);
            updatePhase('playing');
            if (net) net.sendSnapshotNow(s);
          }
        }
        drawCountdown(ctx, s.countdownTimer);
        return;
      }

      // ---- Lobby ----
      if (curPhase === 'lobby') {
        const isHost = r === 'host' || r === 'local';
        drawLobby(ctx, s, blink, pi, isHost);
        return;
      }

      // ---- Playing ----
      if (curPhase === 'playing') {
        if (r === 'guest') {
          // Guest: local prediction for own piece only
          // Input is sent via keydown/keyup handlers
        } else {
          // Host or local: run simulation
          // Process AI
          for (let i = 0; i < 4; i++) {
            if (!s.players[i].isHuman) {
              const board = s.boards[s.players[i].team];
              const ti = s.players[i].team * 2;
              const other = s.players[ti] === s.players[i] ? s.players[ti + 1] : s.players[ti];
              tickAI(s.players[i], board, other, dt);
            }
          }

          // Drain guest inputs (host only)
          if (r === 'host' && net) {
            const inputs = net.drainGuestInputs();
            for (const inp of inputs) {
              const idx = inp.playerIndex;
              if (idx >= 0 && idx < 4 && s.players[idx].isHuman) {
                Object.assign(s.players[idx].keys, inp.keys);
              }
            }
          }

          // Simulate
          tickSimulation(s, dt);

          // Check for phase change (game over)
          if (s.phase === 'over' && curPhase !== 'over') {
            updatePhase('over');
          }

          // Broadcast snapshot
          if (r === 'host' && net) {
            net.maybeSendSnapshot(s, dt);
          }
        }
      }

      // ---- Render ----
      if (curPhase === 'playing') {
        draw(ctx, s, pi, blink);
      } else if (curPhase === 'over') {
        draw(ctx, s, pi, blink);
        drawGameOver(ctx, s, blink);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const role = roleRef.current;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gb-darkest">
      <h2 className="font-pixel text-gb-lightest text-sm">STACKDUO</h2>
      <p className="text-[10px] text-gb-light text-center max-w-md">
        {phase === 'countdown' ? 'GET READY...'
          : phase === 'playing' ? (role === 'guest'
            ? `YOU: P${localPlayerRef.current + 1} · TEAM ${localPlayerRef.current < 2 ? 'A' : 'B'}`
            : role === 'host' ? 'HOST · P1 TEAM A' : 'A/D MOVE · Q/E ROT · W DROP · R HOLD')
          : phase === 'over' ? 'GAME OVER · ENTER TO RESTART'
          : role === 'guest'
          ? `YOU: P${localPlayerRef.current + 1} · TEAM ${localPlayerRef.current < 2 ? 'A' : 'B'}`
          : role === 'host'
          ? 'YOU ARE HOST · P1 TEAM A'
          : game.mode !== 'local'
          ? 'WAITING FOR CONNECTION...'
          : 'LOCAL MODE · PRESS ENTER TO START'}
      </p>
      <canvas
        ref={canvasRef}
        className="border-2 border-gb-dark"
        style={{}}
      />
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-[10px] text-gb-light hover:text-gb-lightest underline"
        >
          &larr; Arcade
        </button>
        {game.mode === 'room' && (
          <span className="text-[10px] text-gb-light">
            ROOM: {searchParams.get('room')}
            {!game.ready && ' · CONNECTING...'}
          </span>
        )}
      </div>
      {game.mode === 'local' && !buddy.isActive && phase === 'lobby' && (
        <RoomCodePanel />
      )}
    </div>
  );
}

// Map raw keyboard state to abstract game keys
function mapRawToGameKeys(raw) {
  return {
    left: !!(raw.KeyA || raw.ArrowLeft),
    right: !!(raw.KeyD || raw.ArrowRight),
    softDrop: !!(raw.KeyS || raw.ArrowDown),
    hardDrop: !!(raw.KeyW || raw.ArrowUp),
    rotateCW: !!raw.KeyE,
    rotateCCW: !!raw.KeyQ,
    hold: !!raw.KeyR,
  };
}
