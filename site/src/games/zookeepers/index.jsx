// Zookeepers — main React component.
//
// Manages: canvas setup, requestAnimationFrame loop, keyboard input, phase
// management (lobby → countdown → playing → dying → levelComplete → over),
// and network orchestration (host/guest via room code or buddy pass).

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLayoutMode } from '../../layout/LayoutModeContext.jsx';
import { useBuddy } from '../../multiplayer/BuddyProvider.jsx';
import { LOGICAL_W, LOGICAL_H, SCALE, DIR, C } from './state.js';
import { makeGameState } from './state.js';
import { tickSimulation, startGame } from './simulation.js';
import { render, initSprites } from './render.js';
import { useGameSession } from './useGameSession.js';
import { ZookeepersNetController } from './net.js';
import { KIND } from '../../multiplayer/netProtocol.js';

export default function Zookeepers() {
  useLayoutMode('fullscreen');

  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const phaseRef = useRef('lobby');
  const dirRef = useRef(DIR.NONE);     // local player's current input direction
  const netRef = useRef(null);          // ZookeepersNetController

  const [statusText, setStatusText] = useState('');
  const [searchParams] = useSearchParams();
  const buddy = useBuddy();
  const session = useGameSession({ buddy, searchParams });

  // ---- Canvas setup ----------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = LOGICAL_W * SCALE;
    canvas.height = LOGICAL_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    initSprites();
  }, []);

  // ---- Game state init -------------------------------------------------------

  useEffect(() => {
    stateRef.current = makeGameState();
    phaseRef.current = 'lobby';
  }, []);

  // ---- Network setup ---------------------------------------------------------

  useEffect(() => {
    if (!session.ready) return;
    const state = stateRef.current;
    if (!state) return;

    if (session.transport) {
      const net = new ZookeepersNetController({ transport: session.transport });
      netRef.current = net;

      net.onLobbyAction((data, from) => {
        // Host handles lobby actions
        handleLobbyAction(state, data, from);
        net.sendLobby(state.lobby);
      });

      net.onPlayerLeave(({ from }) => {
        // Replace disconnected player with AI
        for (let i = 0; i < 4; i++) {
          if (state.lobby.slots[i] === from) {
            state.lobby.slots[i] = 'ai';
            if (i < 2) state.zookeepers[i].isHuman = false;
            else state.animals[i - 2].isHuman = false;
          }
        }
        if (net.role === 'host') net.sendLobby(state.lobby);
      });

      net.onRequestState(() => {
        net.sendSnapshotNow(state);
      });

      // Start host election
      net.electHost().then(({ role, myId }) => {
        if (role === 'host') {
          // Host: assign self to slot 0
          state.lobby.slots[0] = myId;
          // Fill rest with AI
          for (let i = 1; i < 4; i++) {
            if (!state.lobby.slots[i]) state.lobby.slots[i] = 'ai';
          }
          net.localPlayerIndex = 0;
          state.zookeepers[0].isHuman = true;
          net.sendLobby(state.lobby);
          setStatusText('You are HOST · ENTER to start');
        } else {
          // Guest: request state
          net.requestState();
          setStatusText('Joined as guest · waiting for host');
        }
      });

      return () => {
        net.close();
        netRef.current = null;
      };
    } else {
      // Local mode — player is ZK1, everything else AI
      state.lobby.slots[0] = 'local';
      state.lobby.slots[1] = 'ai';
      state.lobby.slots[2] = 'ai';
      state.lobby.slots[3] = 'ai';
      state.zookeepers[0].isHuman = true;
      state.zookeepers[1].isHuman = false;
      for (const a of state.animals) a.isHuman = false;
      setStatusText('Local mode · ENTER to start');
    }
  }, [session.ready, session.transport]);

  // ---- Keyboard input --------------------------------------------------------

  useEffect(() => {
    function onKeyDown(e) {
      const state = stateRef.current;
      if (!state) return;

      switch (e.code) {
        case 'ArrowLeft':  case 'KeyA': dirRef.current = DIR.LEFT;  break;
        case 'ArrowRight': case 'KeyD': dirRef.current = DIR.RIGHT; break;
        case 'ArrowUp':    case 'KeyW': dirRef.current = DIR.UP;    break;
        case 'ArrowDown':  case 'KeyS': dirRef.current = DIR.DOWN;  break;
        case 'Enter': {
          if (state.phase === 'lobby') {
            const net = netRef.current;
            if (!net || net.role === 'host' || !net.role) {
              // Fill empty slots with AI
              for (let i = 0; i < 4; i++) {
                if (!state.lobby.slots[i]) state.lobby.slots[i] = 'ai';
              }
              startGame(state);
              phaseRef.current = state.phase;
              if (net && net.role === 'host') {
                net.sendSnapshotNow(state);
              }
            }
          } else if (state.phase === 'over') {
            // Restart
            const fresh = makeGameState();
            // Preserve lobby assignments
            fresh.lobby = { ...state.lobby };
            // Restore human flags
            applyLobbyToState(fresh);
            startGame(fresh);
            stateRef.current = fresh;
            phaseRef.current = fresh.phase;
          }
          break;
        }
        case 'KeyF': {
          // Fill empty slots with AI (lobby only)
          if (state.phase === 'lobby') {
            for (let i = 0; i < 4; i++) {
              if (!state.lobby.slots[i]) state.lobby.slots[i] = 'ai';
            }
            const net = netRef.current;
            if (net && net.role === 'host') net.sendLobby(state.lobby);
          }
          break;
        }
        default: break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- RAF loop --------------------------------------------------------------

  useEffect(() => {
    let raf;
    let lastTime = 0;

    function frame(time) {
      raf = requestAnimationFrame(frame);

      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;

      const state = stateRef.current;
      if (!state) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const net = netRef.current;

      // ---- Network: guest applies snapshot -----------------------------------
      if (net && net.role === 'guest') {
        if (net.latestSnapshot) {
          net.applySnapshotTo(state);
          net.latestSnapshot = null;
        }
        if (net.latestLobby) {
          state.lobby.slots = [...net.latestLobby.slots];
          applyLobbyToState(state);
          net.latestLobby = null;
          // Determine our player index from lobby
          const myId = net.t.getMyId();
          for (let i = 0; i < 4; i++) {
            if (state.lobby.slots[i] === myId) {
              net.localPlayerIndex = i;
              break;
            }
          }
        }
      }

      // ---- Apply local input -------------------------------------------------
      if (net && net.role === 'guest') {
        const pi = net.localPlayerIndex;
        if (pi >= 0 && pi < 2) {
          state.zookeepers[pi].nextDir = dirRef.current;
        } else if (pi >= 2 && pi < 4) {
          state.animals[pi - 2].nextDir = dirRef.current;
        }
        net.sendInput(pi, dirRef.current);
      } else {
        // Host or local — apply to ZK 0 (or whichever we control)
        const pi = net ? net.localPlayerIndex : 0;
        if (pi >= 0 && pi < 2) {
          state.zookeepers[pi].nextDir = dirRef.current;
        } else if (pi >= 2) {
          state.animals[pi - 2].nextDir = dirRef.current;
        }
      }

      // ---- Host: drain guest inputs ------------------------------------------
      if (net && net.role === 'host') {
        const inputs = net.drainGuestInputs();
        for (const inp of inputs) {
          const { playerIndex, dir } = inp;
          if (playerIndex >= 0 && playerIndex < 2) {
            state.zookeepers[playerIndex].nextDir = dir;
          } else if (playerIndex >= 2 && playerIndex < 4) {
            state.animals[playerIndex - 2].nextDir = dir;
          }
        }
      }

      // ---- Simulate (host or local only) -------------------------------------
      if (!net || net.role === 'host') {
        tickSimulation(state, dt);
        phaseRef.current = state.phase;

        // Broadcast snapshot
        if (net) net.maybeSendSnapshot(state, dt);
      }

      // ---- Render ------------------------------------------------------------
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(SCALE, SCALE);
      render(ctx, state);
      ctx.restore();

      // ---- Status text updates -----------------------------------------------
      updateStatus(state, net);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Status text helper ----------------------------------------------------

  const lastStatusRef = useRef('');
  function updateStatus(state, net) {
    let text = '';
    if (state.phase === 'lobby') {
      text = net ? (net.role === 'host' ? 'ENTER to start' : 'Waiting for host') : 'ENTER to start';
    } else if (state.phase === 'countdown') {
      text = 'GET READY...';
    } else if (state.phase === 'playing') {
      text = 'WASD/Arrows: move';
    } else if (state.phase === 'dying') {
      text = '';
    } else if (state.phase === 'over') {
      text = 'GAME OVER · ENTER to restart';
    }
    if (text !== lastStatusRef.current) {
      lastStatusRef.current = text;
      setStatusText(text);
    }
  }

  // ---- Render ----------------------------------------------------------------

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        style={{ width: LOGICAL_W * SCALE, height: LOGICAL_H * SCALE }}
      />
      {statusText && (
        <p className="text-gb-light text-xs font-mono">{statusText}</p>
      )}
    </div>
  );
}

// ---- Lobby helpers -----------------------------------------------------------

function handleLobbyAction(state, data) {
  if (data.action === 'switchSlot' && typeof data.from === 'string') {
    // Find player's current slot and swap
    let currentSlot = -1;
    for (let i = 0; i < 4; i++) {
      if (state.lobby.slots[i] === data.from) { currentSlot = i; break; }
    }
    if (currentSlot >= 0 && data.targetSlot >= 0 && data.targetSlot < 4) {
      const target = state.lobby.slots[data.targetSlot];
      if (!target || target === 'ai') {
        state.lobby.slots[data.targetSlot] = data.from;
        state.lobby.slots[currentSlot] = target || null;
      }
    }
  }
}

function applyLobbyToState(state) {
  for (let i = 0; i < 2; i++) {
    state.zookeepers[i].isHuman = state.lobby.slots[i] !== null && state.lobby.slots[i] !== 'ai';
  }
  for (let i = 2; i < 4; i++) {
    state.animals[i - 2].isHuman = state.lobby.slots[i] !== null && state.lobby.slots[i] !== 'ai';
  }
}

// (AI zookeeper logic moved to simulation.js)
