// Pong: Beach Volleyball — a co-op twist on classic Pong.
//
// Two players share the entire near court and must play volleyball rules:
// exactly 3 hits per side before the ball crosses the net. On hits 1 and 2
// the ball auto-arcs toward whichever teammate did NOT just touch it,
// forcing the bump-set rhythm. Hit 3 auto-launches as a fast spike across
// the net at the AI. You literally can't solo it — the ball always flies to
// your partner.
//
// v1 uses LOCAL hotseat multiplayer (both players share one keyboard):
//   Player 1: WASD
//   Player 2: Arrow keys
// This keeps latency at zero, which really matters for fast reflex play.
// Networked play via `connect({ type: 'roomCode' })` can be added later —
// see site/src/multiplayer/README.md for the API.

import { useEffect, useRef, useState } from 'react';

// ---- constants --------------------------------------------------------------

const LOGICAL_W = 320;
const LOGICAL_H = 240;
const SCALE = 3;

const FLOOR_Y = 220;
const NET_X = LOGICAL_W / 2;
const NET_TOP = 130;
const NET_BOTTOM = FLOOR_Y;

const GRAVITY = 560;         // px/s^2
const PLAYER_RADIUS = 10;
const BALL_RADIUS = 5;
const PLAYER_SPEED = 180;    // px/s
const AI_SPEED = 150;        // px/s

const WIN_SCORE = 15;

// GameBoy DMG palette (from tailwind.config.js `gb`)
const C = {
  darkest: '#0f380f',
  dark: '#306230',
  light: '#8bac0f',
  lightest: '#9bbc0f',
};

// ---- physics helpers --------------------------------------------------------

// Launch the ball on a parabolic arc from its current position to (tx, ty)
// such that it reaches the target after T seconds under gravity.
function arcBallTo(ball, tx, ty, T = 0.65) {
  ball.vx = (tx - ball.x) / T;
  ball.vy = (ty - ball.y - 0.5 * GRAVITY * T * T) / T;
}

function spike(ball) {
  ball.vx = 380;
  ball.vy = 20 + Math.random() * 60; // slightly downward, varied
}

function circleHit(ball, p) {
  const dx = ball.x - p.x;
  const dy = ball.y - p.y;
  const r = BALL_RADIUS + PLAYER_RADIUS;
  return dx * dx + dy * dy <= r * r;
}

// ---- initial state ----------------------------------------------------------

function makeInitialState() {
  return {
    p1: { x: 70, y: FLOOR_Y - PLAYER_RADIUS - 5 },
    p2: { x: 110, y: FLOOR_Y - PLAYER_RADIUS - 5 },
    ai: { x: LOGICAL_W - 60, y: FLOOR_Y - PLAYER_RADIUS - 5 },
    ball: { x: LOGICAL_W - 50, y: 70, vx: -130, vy: 20 },
    score: { team: 0, ai: 0 },
    teamHits: 0,
    lastToucher: null,     // 'p1' | 'p2' | 'ai' | null
    lastSide: 'ai',        // 'team' | 'ai'
    touchCooldown: 0,      // seconds
    serveTimer: 0.8,       // delay before the first serve moves
  };
}

// ---- component --------------------------------------------------------------

export default function PongBeachVolleyball() {
  const canvasRef = useRef(null);
  const stateRef = useRef(makeInitialState());
  const keysRef = useRef({});
  const phaseRef = useRef('menu');
  const [phase, setPhase] = useState('menu');

  // Keep phaseRef in sync with phase state (used by stable RAF loop).
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Keyboard listeners — stable, no phase dep.
  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.code] = true;
      // Space / Enter starts or restarts the game from menu / game-over.
      if ((phaseRef.current === 'menu' || phaseRef.current === 'over') &&
          (e.code === 'Space' || e.code === 'Enter')) {
        stateRef.current = makeInitialState();
        setPhase('playing');
      }
      // Prevent page scroll on movement keys.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
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

  // Canvas setup + animation loop — stable, no phase dep.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = LOGICAL_W * SCALE;
    canvas.height = LOGICAL_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // Use setTransform (not scale) so hot-reloads don't compound.
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    let raf = 0;
    let lastT = performance.now();

    const frame = (nowT) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.033, (nowT - lastT) / 1000);
      lastT = nowT;

      const s = stateRef.current;
      if (phaseRef.current === 'playing') {
        update(s, dt, keysRef.current);
        if (s.score.team >= WIN_SCORE || s.score.ai >= WIN_SCORE) {
          setPhase('over');
        }
      }
      draw(ctx, s, phaseRef.current);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <h2 className="font-pixel text-gb-lightest text-sm">PONG: BEACH VOLLEYBALL</h2>
      <p className="text-[10px] text-gb-light text-center max-w-md">
        P1: WASD &nbsp;·&nbsp; P2: ARROWS &nbsp;·&nbsp; 3 hits per side — bump, set, SPIKE.
        The ball always arcs to your partner, so you must alternate.
      </p>
      <canvas
        ref={canvasRef}
        className="border-2 border-gb-dark"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}

// ---- update -----------------------------------------------------------------

function update(s, dt, keys) {
  // Serve delay between rallies: freeze everything briefly.
  if (s.serveTimer > 0) {
    s.serveTimer -= dt;
    return;
  }

  // --- P1 input (WASD) ---
  movePlayer(s.p1, keys['KeyW'], keys['KeyS'], keys['KeyA'], keys['KeyD'], dt);

  // --- P2 input (Arrow keys) ---
  movePlayer(s.p2, keys['ArrowUp'], keys['ArrowDown'], keys['ArrowLeft'], keys['ArrowRight'], dt);

  // --- AI movement ---
  let target;
  if (s.ball.x > NET_X) {
    target = s.ball.x; // track the ball when it's on AI's side
  } else {
    target = LOGICAL_W - 60; // rest near the back of the AI court
  }
  const aiDx = target - s.ai.x;
  const step = AI_SPEED * dt * (s.ball.x > NET_X ? 1 : 0.5);
  if (aiDx > 2) s.ai.x += Math.min(step, aiDx);
  else if (aiDx < -2) s.ai.x -= Math.min(step, -aiDx);
  if (s.ai.x < NET_X + PLAYER_RADIUS + 2) s.ai.x = NET_X + PLAYER_RADIUS + 2;
  if (s.ai.x > LOGICAL_W - PLAYER_RADIUS) s.ai.x = LOGICAL_W - PLAYER_RADIUS;

  // --- Ball physics ---
  s.ball.vy += GRAVITY * dt;
  s.ball.x += s.ball.vx * dt;
  s.ball.y += s.ball.vy * dt;

  // Wall bounces (left, right, top)
  if (s.ball.x < BALL_RADIUS) { s.ball.x = BALL_RADIUS; s.ball.vx = Math.abs(s.ball.vx) * 0.8; }
  if (s.ball.x > LOGICAL_W - BALL_RADIUS) { s.ball.x = LOGICAL_W - BALL_RADIUS; s.ball.vx = -Math.abs(s.ball.vx) * 0.8; }
  if (s.ball.y < BALL_RADIUS) { s.ball.y = BALL_RADIUS; s.ball.vy = Math.abs(s.ball.vy) * 0.5; }

  // Net collision (a thin vertical strip from NET_TOP to the floor)
  if (s.ball.y > NET_TOP && Math.abs(s.ball.x - NET_X) < BALL_RADIUS + 2) {
    if (s.ball.vx > 0 && s.ball.x < NET_X) {
      s.ball.x = NET_X - BALL_RADIUS - 2;
      s.ball.vx = -Math.abs(s.ball.vx) * 0.6;
    } else if (s.ball.vx < 0 && s.ball.x > NET_X) {
      s.ball.x = NET_X + BALL_RADIUS + 2;
      s.ball.vx = Math.abs(s.ball.vx) * 0.6;
    }
  }

  // Side tracking — reset hit counter whenever the ball crosses the net.
  const currentSide = s.ball.x < NET_X ? 'team' : 'ai';
  if (currentSide !== s.lastSide) {
    s.teamHits = 0;
    s.lastToucher = null;
    s.lastSide = currentSide;
  }

  // Touch cooldown so a single frame doesn't re-trigger contact.
  if (s.touchCooldown > 0) s.touchCooldown -= dt;

  // --- Team contact (enforces alternation: you cannot hit twice in a row) ---
  if (currentSide === 'team' && s.touchCooldown <= 0) {
    if (circleHit(s.ball, s.p1) && s.lastToucher !== 'p1') {
      handleTeamHit(s, 'p1');
    } else if (circleHit(s.ball, s.p2) && s.lastToucher !== 'p2') {
      handleTeamHit(s, 'p2');
    }
  }

  // --- AI contact: return with an arc toward a random spot on team side ---
  if (currentSide === 'ai' && s.touchCooldown <= 0 && circleHit(s.ball, s.ai)) {
    const tx = 40 + Math.random() * (NET_X - 80);
    const ty = FLOOR_Y - 40;
    arcBallTo(s.ball, tx, ty, 0.8);
    s.touchCooldown = 0.25;
    s.teamHits = 0;
    s.lastToucher = 'ai';
  }

  // --- Ball hits the ground = point scored ---
  if (s.ball.y >= FLOOR_Y - BALL_RADIUS && s.ball.vy > 0) {
    if (s.ball.x < NET_X) {
      s.score.ai += 1;
    } else {
      s.score.team += 1;
    }
    startServe(s);
  }
}

function movePlayer(p, up, down, left, right, dt) {
  let vx = 0, vy = 0;
  if (up) vy -= PLAYER_SPEED;
  if (down) vy += PLAYER_SPEED;
  if (left) vx -= PLAYER_SPEED;
  if (right) vx += PLAYER_SPEED;
  // Normalize diagonals so diagonal movement isn't faster.
  if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
  p.x += vx * dt;
  p.y += vy * dt;
  if (p.x < PLAYER_RADIUS) p.x = PLAYER_RADIUS;
  if (p.x > NET_X - PLAYER_RADIUS - 2) p.x = NET_X - PLAYER_RADIUS - 2;
  if (p.y < 40) p.y = 40;
  if (p.y > FLOOR_Y - PLAYER_RADIUS) p.y = FLOOR_Y - PLAYER_RADIUS;
}

function handleTeamHit(s, who) {
  s.teamHits += 1;
  s.lastToucher = who;
  s.touchCooldown = 0.25;

  if (s.teamHits >= 3) {
    // Third hit — auto-spike across the net.
    spike(s.ball);
  } else {
    // Hits 1 and 2 — arc toward the OTHER teammate.
    const other = who === 'p1' ? s.p2 : s.p1;
    arcBallTo(s.ball, other.x, other.y - 8, 0.65);
  }
}

function startServe(s) {
  s.teamHits = 0;
  s.lastToucher = null;
  s.serveTimer = 0.8;
  // Ball comes from the AI side, arcing toward the team court.
  s.ball.x = LOGICAL_W - 50;
  s.ball.y = 70;
  s.ball.vx = -130;
  s.ball.vy = 20;
  s.lastSide = 'ai';
  s.touchCooldown = 0;
}

// ---- draw -------------------------------------------------------------------

function draw(ctx, s, phase) {
  // Sky
  ctx.fillStyle = C.dark;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Sun
  ctx.fillStyle = C.light;
  ctx.beginPath();
  ctx.arc(NET_X, 40, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.lightest;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Distant horizon line
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 120, LOGICAL_W, 1);

  // Palm tree silhouettes on each side
  drawPalm(ctx, 18, 170);
  drawPalm(ctx, LOGICAL_W - 18, 170);

  // Sand
  ctx.fillStyle = C.light;
  ctx.fillRect(0, FLOOR_Y, LOGICAL_W, LOGICAL_H - FLOOR_Y);
  // Sand texture dots (deterministic so it doesn't shimmer)
  ctx.fillStyle = C.lightest;
  for (let i = 0; i < 50; i++) {
    const x = (i * 37) % LOGICAL_W;
    const y = FLOOR_Y + 2 + ((i * 13) % (LOGICAL_H - FLOOR_Y - 4));
    ctx.fillRect(x, y, 1, 1);
  }
  // Court baseline
  ctx.fillStyle = C.lightest;
  ctx.fillRect(4, FLOOR_Y - 1, LOGICAL_W - 8, 1);

  // Net
  ctx.fillStyle = C.darkest;
  ctx.fillRect(NET_X - 1, NET_TOP - 6, 2, NET_BOTTOM - NET_TOP + 6);
  ctx.strokeStyle = C.darkest;
  ctx.lineWidth = 1;
  for (let y = NET_TOP; y < NET_BOTTOM; y += 4) {
    ctx.beginPath();
    ctx.moveTo(NET_X - 3, y);
    ctx.lineTo(NET_X + 3, y);
    ctx.stroke();
  }
  ctx.fillStyle = C.lightest;
  ctx.fillRect(NET_X - 3, NET_TOP - 7, 6, 2);

  // Players
  drawTeamPlayer(ctx, s.p1, '1');
  drawTeamPlayer(ctx, s.p2, '2');
  drawAI(ctx, s.ai);

  // Ball
  ctx.fillStyle = C.lightest;
  ctx.beginPath();
  ctx.arc(s.ball.x, s.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.darkest;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Ball seam
  ctx.beginPath();
  ctx.moveTo(s.ball.x - BALL_RADIUS, s.ball.y);
  ctx.lineTo(s.ball.x + BALL_RADIUS, s.ball.y);
  ctx.stroke();

  // Hit counter floating above the ball when team is mid-rally
  if (s.teamHits > 0 && s.lastSide === 'team') {
    ctx.fillStyle = C.lightest;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(s.teamHits), s.ball.x, s.ball.y - BALL_RADIUS - 3);
  }

  // Score HUD
  ctx.fillStyle = C.lightest;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`TEAM ${s.score.team}`, 8, 6);
  ctx.textAlign = 'right';
  ctx.fillText(`AI ${s.score.ai}`, LOGICAL_W - 8, 6);
  ctx.textAlign = 'center';
  ctx.fillText(`FIRST TO ${WIN_SCORE}`, NET_X, 6);

  // Phase overlays
  if (phase === 'menu') {
    drawCenterBanner(ctx, 'PRESS SPACE TO START', 'P1: WASD  —  P2: ARROWS');
  } else if (phase === 'over') {
    const msg = s.score.team >= WIN_SCORE ? 'YOU WIN!' : 'AI WINS';
    drawCenterBanner(ctx, msg, 'PRESS SPACE TO PLAY AGAIN');
  }
}

function drawCenterBanner(ctx, title, sub) {
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, LOGICAL_H / 2 - 22, LOGICAL_W, 44);
  ctx.fillStyle = C.lightest;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, NET_X, LOGICAL_H / 2 - 5);
  ctx.fillStyle = C.light;
  ctx.font = 'bold 8px monospace';
  ctx.fillText(sub, NET_X, LOGICAL_H / 2 + 10);
}

function drawTeamPlayer(ctx, p, label) {
  // Filled circle with dark outline + number badge
  ctx.fillStyle = C.lightest;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.darkest;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.darkest;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x, p.y + 1);
  // Shadow on the sand
  ctx.fillStyle = C.dark;
  ctx.fillRect(p.x - PLAYER_RADIUS, FLOOR_Y, PLAYER_RADIUS * 2, 1);
}

function drawAI(ctx, a) {
  // Rectangular silhouette to visually contrast with the round team players.
  const w = PLAYER_RADIUS * 1.6;
  const h = PLAYER_RADIUS * 2.6;
  ctx.fillStyle = C.darkest;
  ctx.fillRect(a.x - w / 2, a.y - h / 2, w, h);
  ctx.strokeStyle = C.lightest;
  ctx.lineWidth = 1;
  ctx.strokeRect(a.x - w / 2, a.y - h / 2, w, h);
  ctx.fillStyle = C.light;
  ctx.fillRect(a.x - 2, a.y - h / 2 + 2, 4, 2); // eye-slit
}

function drawPalm(ctx, x, baseY) {
  // Trunk
  ctx.fillStyle = C.darkest;
  ctx.fillRect(x - 1, baseY, 2, 50);
  // Fronds
  ctx.fillRect(x - 7, baseY - 2, 14, 2);
  ctx.fillRect(x - 5, baseY - 4, 10, 2);
  ctx.fillRect(x - 3, baseY - 6, 6, 2);
  ctx.fillRect(x - 10, baseY, 4, 2);
  ctx.fillRect(x + 6, baseY, 4, 2);
}
