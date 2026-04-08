// Pong: Beach Volleyball — a symmetric 2v2 volleyball twist on Pong.
//
// Top-down aerial view of a sandy beach court. The "net" is just a dashed
// line — the ball always crosses it freely. Scoring is pure Pong: get the
// ball past the opponent's back edge. But BOTH SIDES play volleyball rules:
// exactly 3 touches before the ball must cross the midline, no single
// player can touch it twice in a row, and hits 1 and 2 auto-arc toward the
// other teammate (bump → set) while hit 3 auto-launches as a rocket punch.
//
// While a side is mid-rally (hits 1 or 2), a "court gravity" drags the ball
// toward that side's own back wall. This gives the bump/set a real
// volleyball arc in top-down, AND creates genuine risk: if your partner
// doesn't move to receive the pass, the ball drifts backward off your own
// edge and you lose the point.
//
// Controls — hotseat (one shared keyboard):
//   Player 1: WASD
//   Player 2: Arrow keys

import { useEffect, useRef, useState } from 'react';

// ---- constants --------------------------------------------------------------

const LOGICAL_W = 320;
const LOGICAL_H = 240;
const SCALE = 3;

const COURT_TOP = 28;
const COURT_BOTTOM = LOGICAL_H - 12;
const MID_X = LOGICAL_W / 2;

const PLAYER_RADIUS = 10;
const BALL_RADIUS = 5;
const PLAYER_SPEED = 170;   // px/s
const AI_SPEED = 135;       // px/s — slightly slower so the AI can whiff

const BOUNCE_PASS_SPEED = 180;
const ROCKET_SPEED = 380;
const COURT_GRAVITY = 130;  // px/s² lateral pull toward the rallying side's back wall

const WIN_SCORE = 7;

// GameBoy DMG palette (from tailwind.config.js `gb`)
const C = {
  darkest: '#0f380f',
  dark: '#306230',
  light: '#8bac0f',
  lightest: '#9bbc0f',
};

// ---- helpers ----------------------------------------------------------------

function sendBallTo(ball, tx, ty, speed) {
  const dx = tx - ball.x;
  const dy = ty - ball.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  ball.vx = (dx / d) * speed;
  ball.vy = (dy / d) * speed;
}

function circleHit(ball, p) {
  const dx = ball.x - p.x;
  const dy = ball.y - p.y;
  const r = BALL_RADIUS + PLAYER_RADIUS;
  return dx * dx + dy * dy <= r * r;
}

// ---- initial state ----------------------------------------------------------

function makeInitialState() {
  const midY = (COURT_TOP + COURT_BOTTOM) / 2;
  return {
    p1:  { x: 60,  y: midY - 28 },
    p2:  { x: 60,  y: midY + 28 },
    ai1: { x: LOGICAL_W - 60, y: midY - 28 },
    ai2: { x: LOGICAL_W - 60, y: midY + 28 },
    ball: { x: MID_X, y: midY, vx: -210, vy: 40, rocket: false },
    score: { team: 0, ai: 0 },
    hits: 0,
    lastToucher: null,   // 'p1' | 'p2' | 'ai1' | 'ai2' | null
    lastSide: 'ai',      // 'team' | 'ai' — current half the ball is on
    touchCooldown: 0,
    serveTimer: 0.9,
  };
}

// ---- component --------------------------------------------------------------

export default function PongBeachVolleyball() {
  const canvasRef = useRef(null);
  const stateRef = useRef(makeInitialState());
  const keysRef = useRef({});
  const phaseRef = useRef('menu');
  const [phase, setPhase] = useState('menu');

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Keyboard — stable listener, no phase dep.
  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.code] = true;
      if ((phaseRef.current === 'menu' || phaseRef.current === 'over') &&
          (e.code === 'Space' || e.code === 'Enter')) {
        stateRef.current = makeInitialState();
        setPhase('playing');
      }
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

  // Canvas + RAF loop — stable, no phase dep.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = LOGICAL_W * SCALE;
    canvas.height = LOGICAL_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
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
        P1: WASD &nbsp;·&nbsp; P2: ARROWS &nbsp;·&nbsp; BUMP · SET · ROCKET.
        Don't whiff your partner's pass — the ball drifts back and scores on you.
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
  // Pre-serve freeze.
  if (s.serveTimer > 0) {
    s.serveTimer -= dt;
    return;
  }

  // --- Player input ---
  movePlayer(s.p1, keys['KeyW'], keys['KeyS'], keys['KeyA'], keys['KeyD'], dt, 'team');
  movePlayer(s.p2, keys['ArrowUp'], keys['ArrowDown'], keys['ArrowLeft'], keys['ArrowRight'], dt, 'team');

  // --- AI movement (volleyball-aware) ---
  updateAI(s, dt);

  // --- Ball movement + court gravity ---
  // Court gravity only applies during a side's active bump/set phase.
  if (!s.ball.rocket && s.hits > 0 && s.hits < 3) {
    if (s.lastSide === 'team') s.ball.vx -= COURT_GRAVITY * dt; // pull left (toward team back wall)
    else if (s.lastSide === 'ai') s.ball.vx += COURT_GRAVITY * dt; // pull right (toward AI back wall)
  }
  s.ball.x += s.ball.vx * dt;
  s.ball.y += s.ball.vy * dt;

  // Top/bottom wall bounces — left/right are open score zones.
  if (s.ball.y < COURT_TOP + BALL_RADIUS) {
    s.ball.y = COURT_TOP + BALL_RADIUS;
    s.ball.vy = Math.abs(s.ball.vy);
  }
  if (s.ball.y > COURT_BOTTOM - BALL_RADIUS) {
    s.ball.y = COURT_BOTTOM - BALL_RADIUS;
    s.ball.vy = -Math.abs(s.ball.vy);
  }

  // Side tracking — reset hit counter whenever the ball crosses the midline.
  const currentSide = s.ball.x < MID_X ? 'team' : 'ai';
  if (currentSide !== s.lastSide) {
    s.hits = 0;
    s.lastToucher = null;
    s.lastSide = currentSide;
    s.ball.rocket = false;
  }

  if (s.touchCooldown > 0) s.touchCooldown -= dt;

  // --- Team contact ---
  if (currentSide === 'team' && s.touchCooldown <= 0 && s.hits < 3) {
    if (circleHit(s.ball, s.p1) && s.lastToucher !== 'p1') {
      handleTeamHit(s, 'p1');
    } else if (circleHit(s.ball, s.p2) && s.lastToucher !== 'p2') {
      handleTeamHit(s, 'p2');
    }
  }

  // --- AI contact ---
  if (currentSide === 'ai' && s.touchCooldown <= 0 && s.hits < 3) {
    if (circleHit(s.ball, s.ai1) && s.lastToucher !== 'ai1') {
      handleAIHit(s, 'ai1');
    } else if (circleHit(s.ball, s.ai2) && s.lastToucher !== 'ai2') {
      handleAIHit(s, 'ai2');
    }
  }

  // --- Pong scoring: ball past either edge ---
  if (s.ball.x < -BALL_RADIUS - 4) {
    s.score.ai += 1;
    startServe(s, 'team');
  } else if (s.ball.x > LOGICAL_W + BALL_RADIUS + 4) {
    s.score.team += 1;
    startServe(s, 'ai');
  }
}

function movePlayer(p, up, down, left, right, dt, side) {
  let vx = 0, vy = 0;
  if (up) vy -= PLAYER_SPEED;
  if (down) vy += PLAYER_SPEED;
  if (left) vx -= PLAYER_SPEED;
  if (right) vx += PLAYER_SPEED;
  if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
  p.x += vx * dt;
  p.y += vy * dt;
  clampToSide(p, side);
}

function clampToSide(p, side) {
  if (side === 'team') {
    if (p.x < PLAYER_RADIUS) p.x = PLAYER_RADIUS;
    if (p.x > MID_X - PLAYER_RADIUS - 2) p.x = MID_X - PLAYER_RADIUS - 2;
  } else {
    if (p.x < MID_X + PLAYER_RADIUS + 2) p.x = MID_X + PLAYER_RADIUS + 2;
    if (p.x > LOGICAL_W - PLAYER_RADIUS) p.x = LOGICAL_W - PLAYER_RADIUS;
  }
  if (p.y < COURT_TOP + PLAYER_RADIUS) p.y = COURT_TOP + PLAYER_RADIUS;
  if (p.y > COURT_BOTTOM - PLAYER_RADIUS) p.y = COURT_BOTTOM - PLAYER_RADIUS;
}

// ---- AI movement ------------------------------------------------------------
// The AI plays volleyball. When the ball is on the team side, both AIs rest
// in defensive positions ready to receive a rocket. When the ball is on the
// AI side, the AI that's eligible to hit (not the lastToucher) moves to the
// ball; the other AI anticipates where the arcing bump/set will land and
// moves there to receive the next touch.
function updateAI(s, dt) {
  const { ai1, ai2, ball } = s;
  const midY = (COURT_TOP + COURT_BOTTOM) / 2;
  const restX = LOGICAL_W - 55;

  if (ball.x < MID_X) {
    // Defensive: wait for the incoming rocket.
    const topRestY = (COURT_TOP + midY) / 2;
    const botRestY = (midY + COURT_BOTTOM) / 2;
    moveAITo(ai1, restX, topRestY, dt);
    moveAITo(ai2, restX, botRestY, dt);
    return;
  }

  // Offensive / receive: ball is on the AI side.
  // Figure out who is the "striker" (should go to the ball) and who is the
  // "support" (should anticipate the next pass's landing).
  let strikerId, supportId;
  if (s.lastToucher === 'ai1') {
    strikerId = 'ai2'; supportId = 'ai1';
  } else if (s.lastToucher === 'ai2') {
    strikerId = 'ai1'; supportId = 'ai2';
  } else {
    // Fresh rally — whoever is closer takes the ball.
    const d1 = Math.hypot(ai1.x - ball.x, ai1.y - ball.y);
    const d2 = Math.hypot(ai2.x - ball.x, ai2.y - ball.y);
    if (d1 <= d2) { strikerId = 'ai1'; supportId = 'ai2'; }
    else          { strikerId = 'ai2'; supportId = 'ai1'; }
  }

  const striker = s[strikerId];
  const support = s[supportId];

  // Striker: go to the ball, stepping slightly behind it in X so the contact
  // happens at the ball's center (not behind it).
  const strikerTargetX = Math.min(LOGICAL_W - PLAYER_RADIUS - 4, ball.x + 4);
  const strikerTargetY = ball.y;
  moveAITo(striker, strikerTargetX, strikerTargetY, dt);

  // Support: anticipate where the arcing bump/set will end up.
  // If hits are 0, we're about to receive a rocket or serve — support hangs
  // back opposite the striker vertically so both zones are covered.
  // If hits are 1 or 2, the striker will bump toward the support's current
  // position; support should move to mirror the striker vertically on the
  // OTHER side of midY so the arc lands between them.
  let supportTargetX = Math.min(LOGICAL_W - 30, Math.max(MID_X + 40, ball.x - 30));
  let supportTargetY;
  if (s.hits === 0) {
    // Guard the opposite vertical half.
    supportTargetY = ball.y < midY ? midY + 30 : midY - 30;
  } else {
    // Volleyball support: move to the mirror position across midY so the
    // incoming bump arc (which pulls right under gravity) drops near us.
    supportTargetY = ball.y < midY ? midY + 20 : midY - 20;
    // Pull the support a little back so the rightward gravity drift reaches them.
    supportTargetX = Math.min(LOGICAL_W - 30, Math.max(MID_X + 40, ball.x + 28));
  }
  moveAITo(support, supportTargetX, supportTargetY, dt);
}

function moveAITo(p, tx, ty, dt) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.5) {
    const step = Math.min(AI_SPEED * dt, d);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
  }
  clampToSide(p, 'ai');
}

// ---- hit handlers -----------------------------------------------------------

function handleTeamHit(s, who) {
  s.hits += 1;
  s.lastToucher = who;
  s.touchCooldown = 0.22;

  if (s.hits >= 3) {
    // Rocket punch: aim at the midpoint between the AI defenders.
    const gapY = (s.ai1.y + s.ai2.y) / 2 + (Math.random() - 0.5) * 40;
    const clampedY = Math.max(COURT_TOP + 8, Math.min(COURT_BOTTOM - 8, gapY));
    sendBallTo(s.ball, LOGICAL_W + 60, clampedY, ROCKET_SPEED);
    s.ball.rocket = true;
  } else {
    // Bump/set: arc toward the other teammate. The leftward court gravity
    // will curve the ball during flight, giving it the volleyball feel.
    const other = who === 'p1' ? s.p2 : s.p1;
    sendBallTo(s.ball, other.x, other.y, BOUNCE_PASS_SPEED);
    s.ball.rocket = false;
  }
}

function handleAIHit(s, who) {
  s.hits += 1;
  s.lastToucher = who;
  s.touchCooldown = 0.22;

  if (s.hits >= 3) {
    // AI rocket punch: aim at the midpoint between the two team players.
    const gapY = (s.p1.y + s.p2.y) / 2 + (Math.random() - 0.5) * 40;
    const clampedY = Math.max(COURT_TOP + 8, Math.min(COURT_BOTTOM - 8, gapY));
    sendBallTo(s.ball, -60, clampedY, ROCKET_SPEED);
    s.ball.rocket = true;
  } else {
    const other = who === 'ai1' ? s.ai2 : s.ai1;
    sendBallTo(s.ball, other.x, other.y, BOUNCE_PASS_SPEED);
    s.ball.rocket = false;
  }
}

function startServe(s, to) {
  const midY = (COURT_TOP + COURT_BOTTOM) / 2;
  s.hits = 0;
  s.lastToucher = null;
  s.serveTimer = 0.8;
  s.ball.x = MID_X + (to === 'team' ? 2 : -2);
  s.ball.y = midY + (Math.random() - 0.5) * 80;
  s.ball.rocket = false;
  s.ball.vx = to === 'team' ? -210 : 210;
  s.ball.vy = (Math.random() - 0.5) * 140;
  s.lastSide = to === 'team' ? 'ai' : 'team';
  s.touchCooldown = 0;
}

// ---- draw -------------------------------------------------------------------

function draw(ctx, s, phase) {
  // Sand court background
  ctx.fillStyle = C.light;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Deterministic sand texture
  ctx.fillStyle = C.lightest;
  for (let i = 0; i < 120; i++) {
    const x = (i * 37) % LOGICAL_W;
    const y = (i * 53 + 7) % LOGICAL_H;
    ctx.fillRect(x, y, 1, 1);
  }

  // HUD strip at top
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, COURT_TOP - 4);

  // Court outline
  ctx.strokeStyle = C.darkest;
  ctx.lineWidth = 1;
  ctx.strokeRect(2, COURT_TOP, LOGICAL_W - 4, COURT_BOTTOM - COURT_TOP);

  // Center "line" (not a net — ball always crosses)
  ctx.fillStyle = C.dark;
  for (let y = COURT_TOP + 4; y < COURT_BOTTOM - 2; y += 8) {
    ctx.fillRect(MID_X - 1, y, 2, 4);
  }

  // Goal markers at the extreme left/right edges so players can see where
  // "past the opponent" actually is.
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, COURT_TOP, 2, COURT_BOTTOM - COURT_TOP);
  ctx.fillRect(LOGICAL_W - 2, COURT_TOP, 2, COURT_BOTTOM - COURT_TOP);

  // Players
  drawTeamPlayer(ctx, s.p1, '1');
  drawTeamPlayer(ctx, s.p2, '2');
  drawAIPlayer(ctx, s.ai1);
  drawAIPlayer(ctx, s.ai2);

  // Ball trail when in rocket mode
  if (s.ball.rocket) {
    const mag = Math.sqrt(s.ball.vx * s.ball.vx + s.ball.vy * s.ball.vy) || 1;
    const nx = s.ball.vx / mag;
    const ny = s.ball.vy / mag;
    ctx.strokeStyle = C.darkest;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.ball.x, s.ball.y);
    ctx.lineTo(s.ball.x - nx * 12, s.ball.y - ny * 12);
    ctx.stroke();
  }

  // Ball
  ctx.fillStyle = C.lightest;
  ctx.beginPath();
  ctx.arc(s.ball.x, s.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.darkest;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s.ball.x - BALL_RADIUS, s.ball.y);
  ctx.lineTo(s.ball.x + BALL_RADIUS, s.ball.y);
  ctx.stroke();

  // Hit counter label floating near the ball during either side's rally
  if (s.hits > 0 && s.hits < 3) {
    ctx.fillStyle = C.darkest;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = s.hits === 2 ? 'SET' : 'PASS';
    ctx.fillText(label, s.ball.x, s.ball.y - BALL_RADIUS - 3);
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
  ctx.fillText(`FIRST TO ${WIN_SCORE}`, MID_X, 6);

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
  ctx.fillText(title, MID_X, LOGICAL_H / 2 - 5);
  ctx.fillStyle = C.light;
  ctx.font = 'bold 8px monospace';
  ctx.fillText(sub, MID_X, LOGICAL_H / 2 + 10);
}

function drawTeamPlayer(ctx, p, label) {
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
}

function drawAIPlayer(ctx, a) {
  ctx.fillStyle = C.darkest;
  ctx.beginPath();
  ctx.arc(a.x, a.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.lightest;
  ctx.lineWidth = 1;
  ctx.stroke();
  // X mark
  ctx.beginPath();
  ctx.moveTo(a.x - 4, a.y - 4);
  ctx.lineTo(a.x + 4, a.y + 4);
  ctx.moveTo(a.x + 4, a.y - 4);
  ctx.lineTo(a.x - 4, a.y + 4);
  ctx.stroke();
}
