// Starbloom — 2v2 RTS-Lite.
//
// Mouse-driven with keyboard shortcuts:
//   Mouse: click command bar buttons, click map to execute commands
//   WASD: move cursor/camera  |  Space: select  |  E: cancel
//   1-4: quick commands  |  Q: cycle units  |  S: share  |  R: request

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLayoutMode } from '../../layout/LayoutModeContext.jsx';
import { useBuddy } from '../../multiplayer/BuddyProvider.jsx';

import { C, LOGICAL_W, LOGICAL_H, SCALE, makeGameState, TICKS_PER_SEC, VP_X, VP_Y, VP_W, VP_H, TILE_SIZE, MINIMAP_X, MINIMAP_Y, MINIMAP_W, MINIMAP_H, MAP_W, MAP_H } from './state.js';
import { updateCursor, updateCamera, makeCursorState, cursorKeyDown, updateEdgeScroll, canvasToLogical, screenToTile, isInViewport } from './camera.js';
import { cmdGatherFood, cmdGatherGold, cmdBuildMode, cmdBuildSelect, cmdBuildPlace, cmdAttackMode, cmdAttackTarget, cmdTrainMode, cmdTrain, cmdCancel, cmdSelect, cmdUpgrade, processShareKey, processRequestKey, processShareChoice, processRequestChoice } from './commands.js';
import { tickSimulation } from './simulation.js';
import { tickAI, initAI } from './ai.js';
import { draw, drawMenu, drawGameOver, getButtonAtLogical, getSubButtons } from './render.js';
import { updateFog } from './fog.js';
import { resetDepletion } from './map.js';
import { RtsNetController } from './net.js';
import { useGameSession } from './useGameSession.js';

export default function Starbloom() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useLayoutMode('fullscreen');
  const buddy = useBuddy();

  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const phaseRef = useRef('menu');
  const keysRef = useRef({});
  const cursorStatesRef = useRef([makeCursorState(), makeCursorState()]);
  const [phase, setPhase] = useState('menu');

  // Networking
  const { mode: netMode, transport, ready: transportReady } = useGameSession({ buddy, searchParams });
  const netRef = useRef(null);
  const localPlayerRef = useRef(0);

  // Network controller setup
  useEffect(() => {
    if (!transport) {
      netRef.current = null;
      localPlayerRef.current = 0;
      return;
    }
    const net = new RtsNetController({ transport });
    netRef.current = net;
    net.electHost().then(({ role }) => {
      if (role === 'guest') {
        localPlayerRef.current = 1;
        net.requestState();
      }
    });
    net.onRequestState(() => {
      const s = stateRef.current;
      if (s && s.map) net.sendSnapshotNow(s);
    });
    net.onPlayerLeave(() => {
      const s = stateRef.current;
      if (s && s.players[1]) s.players[1].isHuman = false;
    });
    return () => { net.close(); netRef.current = null; localPlayerRef.current = 0; };
  }, [transport]);

  // ---- Mouse handlers ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getLogical = (e) => {
      const rect = canvas.getBoundingClientRect();
      return canvasToLogical(e.clientX - rect.left, e.clientY - rect.top);
    };

    const onMouseMove = (e) => {
      const { lx, ly } = getLogical(e);
      const s = stateRef.current;
      if (s) {
        s.mouseLogX = lx;
        s.mouseLogY = ly;
        // Update hovered button
        const pi = localPlayerRef.current;
        const p = s.players?.[pi];
        s.hoveredBtn = p ? getButtonAtLogical(lx, ly, p.commandMode) : null;
      }
    };

    const onClick = (e) => {
      if (phaseRef.current === 'menu') {
        handleMenuClick();
        return;
      }
      if (phaseRef.current === 'over') {
        handleGameOverClick();
        return;
      }
      const { lx, ly } = getLogical(e);
      handleGameClick(lx, ly);
    };

    const onContextMenu = (e) => {
      e.preventDefault();
      const s = stateRef.current;
      const pi = localPlayerRef.current;
      if (s && s.players?.[pi]) {
        cmdCancel(s, pi);
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  function handleMenuClick() {
    const net = netRef.current;
    const isGuest = net?.role === 'guest';
    if (isGuest) return; // guest can't start

    resetDepletion();
    stateRef.current = makeGameState({ difficulty: stateRef.current?.difficulty || 'medium' });
    stateRef.current.phase = 'playing';
    initAI(stateRef.current);
    phaseRef.current = 'playing';
    setPhase('playing');
  }

  function handleGameOverClick() {
    const net = netRef.current;
    const isGuest = net?.role === 'guest';
    if (isGuest) return;
    phaseRef.current = 'menu';
    setPhase('menu');
  }

  function handleGameClick(lx, ly) {
    const s = stateRef.current;
    const pi = localPlayerRef.current;
    if (!s || !s.players?.[pi]) return;
    const p = s.players[pi];
    const net = netRef.current;

    // 1. Check command bar button click
    const btnId = getButtonAtLogical(lx, ly, p.commandMode);
    if (btnId) {
      handleButtonClick(s, pi, btnId);
      return;
    }

    // 2. Check minimap click (jump camera)
    if (lx >= MINIMAP_X && lx < MINIMAP_X + MINIMAP_W &&
        ly >= MINIMAP_Y && ly < MINIMAP_Y + MINIMAP_H) {
      const tx = Math.floor(((lx - MINIMAP_X) / MINIMAP_W) * MAP_W);
      const ty = Math.floor(((ly - MINIMAP_Y) / MINIMAP_H) * MAP_H);
      p.cursorTx = Math.max(0, Math.min(MAP_W - 1, tx));
      p.cursorTy = Math.max(0, Math.min(MAP_H - 1, ty));
      return;
    }

    // 3. Viewport click — handle based on command mode
    if (isInViewport(lx, ly)) {
      const { tx, ty } = screenToTile(lx, ly, p.cameraX, p.cameraY);
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;

      // Update cursor position to clicked tile
      p.cursorTx = tx;
      p.cursorTy = ty;

      // If guest in networked mode, send command
      if (net?.role === 'guest') {
        switch (p.commandMode) {
          case 'build_place':
            net.sendCommand({ type: 'buildPlace', tx, ty });
            break;
          case 'attack':
            net.sendCommand({ type: 'attackTarget', tx, ty });
            break;
          default:
            net.sendCommand({ type: 'select', tx, ty });
            break;
        }
        return;
      }

      // Local/host: process command based on mode
      switch (p.commandMode) {
        case 'build_place':
          cmdBuildPlace(s, pi, tx, ty);
          break;
        case 'attack':
          cmdAttackTarget(s, pi, tx, ty);
          break;
        default:
          cmdSelect(s, pi, tx, ty);
          break;
      }
    }
  }

  function handleButtonClick(s, pi, btnId) {
    const net = netRef.current;
    const isGuest = net?.role === 'guest';

    // If guest, send button clicks as commands
    if (isGuest) {
      net.sendCommand({ type: 'button', btnId });
      return;
    }

    // Host/local: process button directly
    processButtonAction(s, pi, btnId);
  }

  function processButtonAction(s, pi, btnId) {
    switch (btnId) {
      case 'gather_f': cmdGatherFood(s, pi); break;
      case 'gather_g': cmdGatherGold(s, pi); break;
      case 'build':    cmdBuildMode(s, pi); break;
      case 'attack':   cmdAttackMode(s, pi); break;
      case 'train':    cmdTrainMode(s, pi); break;
      default:
        // Sub-buttons
        if (btnId.startsWith('build_')) {
          const buildType = btnId.replace('build_', '');
          cmdBuildSelect(s, pi, buildType);
        } else if (btnId.startsWith('train_')) {
          const unitType = btnId.replace('train_', '');
          cmdTrain(s, pi, unitType);
        }
        break;
    }
  }

  // ---- Keyboard handlers ----
  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.code] = true;
      const net = netRef.current;
      const isGuest = net?.role === 'guest';
      const isNetworked = !!net?.role;
      const pi = localPlayerRef.current;

      // Menu
      if (phaseRef.current === 'menu') {
        if (!isGuest && (e.code === 'Space' || e.code === 'Enter')) {
          handleMenuClick();
          e.preventDefault();
          return;
        }
        if (!isGuest && e.code === 'KeyD') {
          const diffs = ['easy', 'medium', 'hard'];
          const cur = stateRef.current?.difficulty || 'medium';
          const next = diffs[(diffs.indexOf(cur) + 1) % diffs.length];
          if (!stateRef.current) stateRef.current = { difficulty: next };
          else stateRef.current.difficulty = next;
          return;
        }
        return;
      }

      // Game over
      if (phaseRef.current === 'over') {
        if (!isGuest && (e.code === 'Space' || e.code === 'Enter')) {
          handleGameOverClick();
          e.preventDefault();
          return;
        }
        return;
      }

      const s = stateRef.current;
      if (!s || !s.players?.[pi]) return;
      const p = s.players[pi];

      // Guest sends keyboard commands to host
      if (isGuest) {
        if (e.code === 'Space') {
          net.sendCommand({ type: 'select', tx: p.cursorTx, ty: p.cursorTy });
          e.preventDefault();
        } else if (e.code === 'KeyE') {
          net.sendCommand({ type: 'cancel' });
        } else if (e.code === 'KeyQ') {
          net.sendCommand({ type: 'cycleUnit' });
        } else if (e.code === 'KeyS' && !e.ctrlKey) {
          net.sendCommand({ type: 'shareKey' });
        } else if (e.code === 'KeyR') {
          net.sendCommand({ type: 'requestKey' });
        } else if (e.code.startsWith('Digit')) {
          const num = parseInt(e.code.replace('Digit', ''));
          if (num >= 1 && num <= 4) {
            net.sendCommand({ type: 'number', num, cursorTx: p.cursorTx, cursorTy: p.cursorTy });
          }
        }

        // Cursor movement stays local for guest
        if (e.code === 'KeyW') cursorKeyDown(cursorStatesRef.current[0], 'up');
        if (e.code === 'KeyA') cursorKeyDown(cursorStatesRef.current[0], 'left');
        if (e.code === 'KeyS' && !e.ctrlKey) cursorKeyDown(cursorStatesRef.current[0], 'down');
        if (e.code === 'KeyD') cursorKeyDown(cursorStatesRef.current[0], 'right');

        if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
        return;
      }

      // Host/local keyboard commands
      if (e.code === 'Space') {
        cmdSelect(s, pi, p.cursorTx, p.cursorTy);
        e.preventDefault();
      } else if (e.code === 'KeyE') {
        cmdCancel(s, pi);
      } else if (e.code === 'Digit1') {
        cmdGatherFood(s, pi);
      } else if (e.code === 'Digit2') {
        cmdGatherGold(s, pi);
      } else if (e.code === 'Digit3') {
        cmdBuildMode(s, pi);
      } else if (e.code === 'Digit4') {
        cmdAttackMode(s, pi);
      } else if (e.code === 'KeyQ') {
        // Cycle through own units
        const myUnits = s.units.filter(u => u.owner === pi);
        if (myUnits.length > 0) {
          let curIdx = myUnits.findIndex(u => u.id === p.selectedId);
          curIdx = (curIdx + 1) % myUnits.length;
          const unit = myUnits[curIdx];
          p.selectedId = unit.id;
          p.cursorTx = unit.tx;
          p.cursorTy = unit.ty;
        }
      } else if (e.code === 'KeyS' && !e.ctrlKey) {
        processShareKey(s, pi);
      } else if (e.code === 'KeyR') {
        processRequestKey(s, pi);
      }

      // Cursor directions
      if (e.code === 'KeyW') cursorKeyDown(cursorStatesRef.current[0], 'up');
      if (e.code === 'KeyA') cursorKeyDown(cursorStatesRef.current[0], 'left');
      if (e.code === 'KeyD' && phaseRef.current === 'playing') cursorKeyDown(cursorStatesRef.current[0], 'right');

      // Hotseat P2 (local mode only)
      if (!isNetworked && s.players[1]?.isHuman) {
        if (e.code === 'ArrowUp') cursorKeyDown(cursorStatesRef.current[1], 'up');
        if (e.code === 'ArrowDown') cursorKeyDown(cursorStatesRef.current[1], 'down');
        if (e.code === 'ArrowLeft') cursorKeyDown(cursorStatesRef.current[1], 'left');
        if (e.code === 'ArrowRight') cursorKeyDown(cursorStatesRef.current[1], 'right');
      }

      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const up = (e) => { keysRef.current[e.code] = false; };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- RAF loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = LOGICAL_W * SCALE;
    canvas.height = LOGICAL_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    if (!stateRef.current) {
      stateRef.current = { difficulty: 'medium' };
    }

    let raf = 0;
    let fallbackTimer = 0;
    let lastT = performance.now();
    let blinkTimer = 0;
    let alive = true;

    const frame = (nowT) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      // Fallback: if RAF stops firing (hidden tab / headless), use setTimeout
      clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => { if (alive) frame(performance.now()); }, 50);
      const dt = Math.min(0.033, (nowT - lastT) / 1000);
      lastT = nowT;
      blinkTimer += dt;
      const blinkPhase = blinkTimer % 0.6 < 0.3;

      const s = stateRef.current;
      const net = netRef.current;
      const localIdx = localPlayerRef.current;
      const isGuest = net?.role === 'guest';
      const isHost = net?.role === 'host';
      const isNetworked = isHost || isGuest;

      // Menu phase
      if (phaseRef.current === 'menu') {
        if (isGuest && net.latestSnapshot) {
          const snap = net.latestSnapshot;
          if (snap.phase && snap.phase !== 'menu') {
            if (!s || !s.map) {
              resetDepletion();
              stateRef.current = makeGameState({ seed: snap.seed, difficulty: snap.difficulty });
            }
            net.applySnapshotTo(stateRef.current, localIdx);
            phaseRef.current = 'playing';
            setPhase('playing');
            return;
          }
        }
        let statusText = null;
        if (isNetworked && !net.role) statusText = 'CONNECTING...';
        else if (isGuest) statusText = 'WAITING FOR HOST...';
        else if (isHost) statusText = 'Click to Start (NETWORKED)';
        else if (netMode !== 'local' && !transportReady) statusText = 'CONNECTING...';
        drawMenu(ctx, s, blinkPhase, statusText);
        return;
      }

      // Game over
      if (phaseRef.current === 'over' || (s && s.phase === 'over')) {
        if (isGuest && s && s.map) net.applySnapshotTo(s, localIdx);
        drawGameOver(ctx, s, blinkPhase);
        if (phaseRef.current !== 'over') {
          phaseRef.current = 'over';
          setPhase('over');
        }
        return;
      }

      if (!s || !s.players) return;

      // Guest: apply latest snapshot and compute fog locally
      if (isGuest) {
        net.applySnapshotTo(s, localIdx);
        if (s.fog) updateFog(s);
        if (s.phase === 'over' && phaseRef.current !== 'over') {
          phaseRef.current = 'over';
          setPhase('over');
        }
      }

      // Host: process guest commands
      if (isHost) {
        const cmds = net.drainGuestCommands();
        for (const cmd of cmds) {
          if (cmd.cursorTx != null) s.players[1].cursorTx = cmd.cursorTx;
          if (cmd.cursorTy != null) s.players[1].cursorTy = cmd.cursorTy;
          switch (cmd.type) {
            case 'select': cmdSelect(s, 1, cmd.tx, cmd.ty); break;
            case 'cancel': cmdCancel(s, 1); break;
            case 'button': processButtonAction(s, 1, cmd.btnId); break;
            case 'buildPlace': cmdBuildPlace(s, 1, cmd.tx, cmd.ty); break;
            case 'attackTarget': cmdAttackTarget(s, 1, cmd.tx, cmd.ty); break;
            case 'shareKey': processShareKey(s, 1); break;
            case 'requestKey': processRequestKey(s, 1); break;
            case 'number':
              if (cmd.num >= 1 && cmd.num <= 4) {
                [cmdGatherFood, cmdGatherGold, cmdBuildMode, cmdAttackMode][cmd.num - 1](s, 1);
              }
              break;
            case 'cycleUnit': {
              const myUnits = s.units.filter(u => u.owner === 1);
              if (myUnits.length > 0) {
                let curIdx = myUnits.findIndex(u => u.id === s.players[1].selectedId);
                curIdx = (curIdx + 1) % myUnits.length;
                s.players[1].selectedId = myUnits[curIdx].id;
                s.players[1].cursorTx = myUnits[curIdx].tx;
                s.players[1].cursorTy = myUnits[curIdx].ty;
              }
              break;
            }
          }
        }
      }

      // Update local cursor/camera
      const k = keysRef.current;
      const localP = s.players[localIdx];
      const localKeys = {
        up: !!k.KeyW,
        down: !!k.KeyS,
        left: !!k.KeyA,
        right: !!k.KeyD,
      };
      updateCursor(localP, localKeys, dt, cursorStatesRef.current[0]);

      // Mouse edge scrolling
      const mouseScrolling = updateEdgeScroll(localP, s.mouseLogX, s.mouseLogY, dt);
      if (!mouseScrolling) {
        updateCamera(localP, dt);
      }

      // Hotseat P2 cursor (local mode only)
      if (!isNetworked && s.players[1]?.isHuman) {
        const p2Keys = {
          up: !!k.ArrowUp, down: !!k.ArrowDown,
          left: !!k.ArrowLeft, right: !!k.ArrowRight,
        };
        updateCursor(s.players[1], p2Keys, dt, cursorStatesRef.current[1]);
        updateCamera(s.players[1], dt);
      }

      // Simulation + AI (host and local only)
      if (!isGuest) {
        tickSimulation(s, dt);
        tickAI(s, dt);
      }

      // Host: broadcast snapshot
      if (isHost) {
        net.maybeSendSnapshot(s, dt);
      }

      // Render
      draw(ctx, s, localIdx, blinkPhase);
    };

    raf = requestAnimationFrame(frame);
    // Kick off fallback in case RAF never fires (headless/hidden tab)
    fallbackTimer = setTimeout(() => { if (alive) frame(performance.now()); }, 100);
    return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(fallbackTimer); };
  }, []);

  return (
    <div className="flex items-center justify-center w-full h-full bg-gb-darkest">
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          width: LOGICAL_W * SCALE,
          height: LOGICAL_H * SCALE,
          imageRendering: 'pixelated',
          cursor: 'crosshair',
        }}
      />
    </div>
  );
}
