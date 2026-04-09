import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { machines, WORLD_WIDTH, WORLD_HEIGHT } from './world.js';
import { useLayoutMode } from '../layout/LayoutModeContext.jsx';
import { useBuddy } from '../multiplayer/BuddyProvider.jsx';
import { makePresence } from '../multiplayer/netProtocol.js';
import BuddyStartPanel from '../components/BuddyStartPanel.jsx';

// GameBoy DMG palette
const PALETTE = {
  darkest: '#0f380f',
  dark: '#306230',
  light: '#8bac0f',
  lightest: '#9bbc0f',
};

const SPEED = 2.0;        // px/frame logical (~120 px/s at 60fps)
const MACHINE_REACH = 14; // px — enter radius around a machine

// Presence network tuning
const PRESENCE_MIN_INTERVAL_MS = 66;   // 15 Hz cap
const PRESENCE_KEEPALIVE_MS = 2000;    // 0.5 Hz when idle
const PRESENCE_MOVE_THRESHOLD = 0.5;   // px
const RENDER_DELAY_MS = 150;           // remote interpolation buffer

export default function ArcadeView() {
  useLayoutMode('fullscreen');
  const navigate = useNavigate();
  const buddy = useBuddy();

  const canvasRef = useRef(null);
  const playerRef = useRef({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
  const keysRef = useRef({});
  const scaleRef = useRef(3);
  const [nearMachine, setNearMachine] = useState(null);

  // Presence send state (survives across renders)
  const presenceRef = useRef({
    seq: 0,
    lastSentT: 0,
    lastSentX: null,
    lastSentY: null,
  });

  // Keep buddy ref stable inside the tick loop
  const buddyRef = useRef(buddy);
  useEffect(() => { buddyRef.current = buddy; }, [buddy]);

  // Keyboard
  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) {
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

  // Resize the canvas so the logical world fills the viewport with integer
  // scaling and dark-green letterboxing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.max(
        1,
        Math.floor(Math.min(vw / WORLD_WIDTH, vh / WORLD_HEIGHT))
      );
      scaleRef.current = scale;
      canvas.width = WORLD_WIDTH * scale;
      canvas.height = WORLD_HEIGHT * scale;
      canvas.style.width = `${WORLD_WIDTH * scale}px`;
      canvas.style.height = `${WORLD_HEIGHT * scale}px`;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const k = keysRef.current;
      const p = playerRef.current;
      const b = buddyRef.current;

      // --- Movement ---
      let dx = 0, dy = 0;
      if (k['ArrowLeft'] || k['KeyA']) dx -= 1;
      if (k['ArrowRight'] || k['KeyD']) dx += 1;
      if (k['ArrowUp'] || k['KeyW']) dy -= 1;
      if (k['ArrowDown'] || k['KeyS']) dy += 1;
      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
      p.x += dx * SPEED;
      p.y += dy * SPEED;
      p.x = Math.max(4, Math.min(WORLD_WIDTH - 4, p.x));
      p.y = Math.max(4, Math.min(WORLD_HEIGHT - 4, p.y));

      // --- Proximity check ---
      let near = null;
      for (const m of machines) {
        const ddx = p.x - m.x;
        const ddy = p.y - m.y;
        if (ddx * ddx + ddy * ddy <= MACHINE_REACH * MACHINE_REACH) {
          near = m;
          break;
        }
      }
      setNearMachine((cur) => (cur?.id === near?.id ? cur : near));

      // --- Press Enter at a machine → navigate ---
      if (near && k['Enter']) {
        k['Enter'] = false; // consume
        if (b.isActive) {
          b.notifyEnterGame(near.id, near.gameRoute);
          navigate(`${near.gameRoute}?buddy=${b.pairId}`);
        } else {
          navigate(near.gameRoute);
        }
        return;
      }

      // --- Send presence (throttled) ---
      if (b.isActive && b.isConnected) {
        const now = performance.now();
        const ps = presenceRef.current;
        const moved =
          ps.lastSentX === null ||
          Math.abs(p.x - ps.lastSentX) > PRESENCE_MOVE_THRESHOLD ||
          Math.abs(p.y - ps.lastSentY) > PRESENCE_MOVE_THRESHOLD;
        const overdue = now - ps.lastSentT > PRESENCE_KEEPALIVE_MS;
        if ((moved && now - ps.lastSentT > PRESENCE_MIN_INTERVAL_MS) || overdue) {
          b.sendBuddyMessage(makePresence({
            x: p.x, y: p.y,
            nickname: b.nickname,
            seq: ++ps.seq,
            gameId: null,
          }));
          ps.lastSentT = now;
          ps.lastSentX = p.x;
          ps.lastSentY = p.y;
        }
      }

      // --- Draw ---
      ctx.fillStyle = PALETTE.lightest;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Floor grid dots
      ctx.fillStyle = PALETTE.light;
      for (let y = 0; y < WORLD_HEIGHT; y += 16) {
        for (let x = 0; x < WORLD_WIDTH; x += 16) {
          ctx.fillRect(x, y, 1, 1);
        }
      }

      // Machines — cabinet sprites.
      for (const m of machines) {
        ctx.fillStyle = PALETTE.dark;
        ctx.fillRect(m.x - 8, m.y - 12, 16, 20);
        ctx.fillStyle = PALETTE.light;
        ctx.fillRect(m.x - 6, m.y - 10, 12, 8);
        if (nearMachine && nearMachine.id === m.id) {
          ctx.strokeStyle = PALETTE.darkest;
          ctx.lineWidth = 1;
          ctx.strokeRect(m.x - 9, m.y - 13, 18, 22);
        }
      }

      // Remote buddies — interpolated pixels in a different palette shade.
      if (b.isActive) {
        const nowT = performance.now();
        const targetT = nowT - RENDER_DELAY_MS;
        ctx.fillStyle = PALETTE.dark;
        for (const [, r] of b.remotePlayers) {
          if (r.curX == null) continue;
          // Only render buddies currently in the arcade (not in a game).
          if (r.gameId) continue;
          let rx = r.curX;
          let ry = r.curY;
          if (r.prevX != null && targetT > r.prevT && targetT < r.curT) {
            const alpha = (targetT - r.prevT) / (r.curT - r.prevT);
            rx = r.prevX + (r.curX - r.prevX) * alpha;
            ry = r.prevY + (r.curY - r.prevY) * alpha;
          } else if (targetT <= r.prevT && r.prevX != null) {
            rx = r.prevX; ry = r.prevY;
          }
          ctx.fillRect(Math.round(rx) - 2, Math.round(ry) - 2, 4, 4);
          // Name label
          if (r.nickname) {
            ctx.font = '6px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = PALETTE.darkest;
            ctx.fillText(r.nickname, Math.round(rx), Math.round(ry) - 5);
            ctx.fillStyle = PALETTE.dark;
          }
        }
      }

      // Local player — dark pixel (always drawn on top of buddies)
      ctx.fillStyle = PALETTE.darkest;
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [navigate, nearMachine]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gb-darkest overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ imageRendering: 'pixelated' }}
      />

      {/* Top-left: list button + title */}
      <div className="absolute top-3 left-3 flex items-center gap-3 pointer-events-none">
        <button
          type="button"
          onClick={() => navigate('/list')}
          className="pointer-events-auto px-2 py-1 text-[10px] bg-gb-darkest text-gb-lightest border border-gb-light hover:bg-gb-dark"
        >
          ← LIST
        </button>
        <span className="text-[10px] text-gb-light tracking-widest">ARCADE</span>
      </div>

      {/* Bottom-center: machine prompt */}
      {nearMachine && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] bg-gb-darkest text-gb-lightest border border-gb-light">
          PRESS ENTER — {nearMachine.name.toUpperCase()}
        </div>
      )}

      {/* Bottom-left: buddy start panel OR controls hint */}
      <div className="absolute bottom-3 left-3">
        {buddy.isActive ? (
          <span className="text-[9px] text-gb-light">
            WASD / ARROWS · ENTER TO PLAY
          </span>
        ) : (
          <BuddyStartPanel />
        )}
      </div>
    </div>
  );
}
