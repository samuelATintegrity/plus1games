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
const AI_SPEED = 165;       // px/s

// Bump/set arcs are computed as 2D projectiles with lateral "court gravity"
// pulling the ball toward the rallying side's back wall. Tuned so the ball
// visibly arcs forward about 50 pixels before curving back to the partner.
const BOUNCE_ARC_TIME = 0.9; // seconds of flight from hitter to receiver
const COURT_GRAVITY = 500;   // px/s² lateral pull during bumps and sets

// How much the hitter's current movement velocity contaminates the launch.
// 0 = perfect aim regardless of motion; 1 = hitter velocity is added in
// full. 0.35 means moving at full speed against the intended pass direction
// shifts the landing spot by ~45 px, forcing the partner to chase instead
// of parking.
const VELOCITY_BIAS = 0.35;

const ROCKET_SPEED = 380;
// Max angle a spike can take. 1.5 = arctan(1.5) ≈ 56° off the horizontal,
// which is steep enough to bank a rocket off the top or bottom wall.
const ROCKET_MAX_Y_RATIO = 1.5;

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

// Projectile launch. Given a target (tx, ty), a lateral acceleration `ax`
// (signed px/s² — negative = leftward for team, positive = rightward for AI),
// and a flight time T, compute the initial velocity such that the ball
// passes through (tx, ty) exactly at time T under that constant acceleration.
// Because `ax` pulls the ball backward, vx0 ends up pointing *forward* (away
// from the shooter's back wall), producing a visible volleyball-style arc.
//
//   x(T) = x0 + vx0*T + 0.5*ax*T²  ⇒  vx0 = (dx - 0.5*ax*T²) / T
//   y(T) = y0 + vy0*T              ⇒  vy0 = dy / T
function launchArcTo(ball, tx, ty, ax, T) {
  const dx = tx - ball.x;
  const dy = ty - ball.y;
  ball.vx = (dx - 0.5 * ax * T * T) / T;
  ball.vy = dy / T;
}

function circleHit(ball, p) {
  const dx = ball.x - p.x;
  const dy = ball.y - p.y;
  const r = BALL_RADIUS + PLAYER_RADIUS;
  return dx * dx + dy * dy <= r * r;
}

// Predict what Y the ball will have when it reaches targetX, accounting
// for top/bottom wall bounces along the way. Used by the AI to place
// itself on the intercept line BEFORE a fast rocket arrives. Returns the
// current y if the ball isn't moving toward targetX (t < 0 or vx == 0).
function predictBallY(ball, targetX) {
  if (ball.vx === 0) return ball.y;
  const t = (targetX - ball.x) / ball.vx;
  if (t < 0) return ball.y;
  const yRaw = ball.y + ball.vy * t;
  const hMin = COURT_TOP + BALL_RADIUS;
  const hMax = COURT_BOTTOM - BALL_RADIUS;
  const span = hMax - hMin;
  if (span <= 0) return ball.y;
  // Fold yRaw back into [hMin, hMax] using triangle-wave reflection.
  let rel = ((yRaw - hMin) % (2 * span) + 2 * span) % (2 * span);
  if (rel > span) rel = 2 * span - rel;
  return hMin + rel;
}

// ---- initial state ----------------------------------------------------------

function makeInitialState() {
  const midY = (COURT_TOP + COURT_BOTTOM) / 2;
  return {
    p1:  { x: 60,  y: midY - 28, vx: 0, vy: 0 },
    p2:  { x: 60,  y: midY + 28, vx: 0, vy: 0 },
    ai1: { x: LOGICAL_W - 60, y: midY - 28, vx: 0, vy: 0 },
    ai2: { x: LOGICAL_W - 60, y: midY + 28, vx: 0, vy: 0 },
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
  // Court gravity only applies during an active bump/set phase (not during
  // serves, rockets, or between rallies). The direction is determined by
  // who made the last touch, not by which side the ball is currently on —
  // this keeps the arc consistent even if it briefly strays across the
  // midline during flight.
  if (!s.ball.rocket && s.hits > 0 && s.hits < 3) {
    const teamRallying = s.lastToucher === 'p1' || s.lastToucher === 'p2';
    if (teamRallying) s.ball.vx -= COURT_GRAVITY * dt; // pulls left toward team back wall
    else              s.ball.vx += COURT_GRAVITY * dt; // pulls right toward AI back wall
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
  p.vx = vx;
  p.vy = vy;
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
// The AI plays volleyball AND defends Pong-style:
//   • Ball on team side, team mid-rally (hits 1 or 2) → shift toward the
//     intercept line and tighten around the middle, anticipating a rocket.
//   • Ball on AI side, incoming rocket/serve → predict where the ball will
//     cross the AI's intercept line (with wall bounces) and send the closer
//     AI to that exact spot; support covers the opposite half.
//   • Ball on AI side, mid-rally (hits 1 or 2) → both AIs hold position.
//     The arc was launched aimed at the receiver's exact current position,
//     so holding is the correct strategy — moving would cause a miss.
//
// The intercept X sits well forward of the back wall so the AI has room
// to step onto a rocket instead of just reacting at its rest line.
const AI_INTERCEPT_X = LOGICAL_W - 60;

function updateAI(s, dt) {
  const { ai1, ai2, ball } = s;
  const midY = (COURT_TOP + COURT_BOTTOM) / 2;

  if (ball.x < MID_X) {
    // Ball on team side. If the team is mid-rally, start pre-positioning
    // toward the likely rocket lane — predict where the current ball will
    // cross AI_INTERCEPT_X and weight the rest Y toward that prediction.
    let anchorY = midY;
    if (!s.ball.rocket && s.hits > 0 && s.hits < 3) {
      // The ball is arcing; its vx can be small or wrong-signed, so fall
      // back to midY if prediction isn't meaningful.
      if (ball.vx > 10) anchorY = predictBallY(ball, AI_INTERCEPT_X);
    }
    const topRestY = Math.max(COURT_TOP + PLAYER_RADIUS + 4, anchorY - 34);
    const botRestY = Math.min(COURT_BOTTOM - PLAYER_RADIUS - 4, anchorY + 34);
    moveAITo(ai1, AI_INTERCEPT_X, topRestY, dt);
    moveAITo(ai2, AI_INTERCEPT_X, botRestY, dt);
    return;
  }

  // Ball on AI side.
  if (s.hits === 0 || s.ball.rocket) {
    // Incoming rocket or fresh ball. Predict the intercept Y including
    // wall bounces. The AI that's vertically closer to that prediction
    // handles it; the other drops to cover the opposite half.
    const predictedY = predictBallY(ball, AI_INTERCEPT_X);
    const d1 = Math.abs(ai1.y - predictedY);
    const d2 = Math.abs(ai2.y - predictedY);
    const [striker, support] = d1 <= d2 ? [ai1, ai2] : [ai2, ai1];

    moveAITo(striker, AI_INTERCEPT_X, predictedY, dt);

    const supportY = predictedY < midY ? midY + 40 : midY - 40;
    moveAITo(support, AI_INTERCEPT_X - 12, supportY, dt);
    return;
  }

  // Mid-rally (hits 1 or 2): both AIs hold position. The arc lands at the
  // receiver's current spot, so any movement would cause a whiff.
  moveAITo(ai1, ai1.x, ai1.y, dt);
  moveAITo(ai2, ai2.x, ai2.y, dt);
}

function moveAITo(p, tx, ty, dt) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.5) {
    const step = Math.min(AI_SPEED * dt, d);
    const nx = dx / d;
    const ny = dy / d;
    p.x += nx * step;
    p.y += ny * step;
    p.vx = nx * AI_SPEED;
    p.vy = ny * AI_SPEED;
  } else {
    p.vx = 0;
    p.vy = 0;
  }
  clampToSide(p, 'ai');
}

// ---- hit handlers -----------------------------------------------------------

// Pick the rocket velocity given a forward sign (+1 = right, -1 = left) and
// a y-ratio (the spike angle's tan component, clamped to ROCKET_MAX_Y_RATIO).
// Magnitude always == ROCKET_SPEED.
function rocketVelocity(forwardSign, yRatio) {
  const r = Math.max(-ROCKET_MAX_Y_RATIO, Math.min(ROCKET_MAX_Y_RATIO, yRatio));
  const mag = Math.sqrt(1 + r * r);
  return {
    vx: (forwardSign / mag) * ROCKET_SPEED,
    vy: (r / mag) * ROCKET_SPEED,
  };
}

function handleTeamHit(s, who) {
  s.hits += 1;
  s.lastToucher = who;
  s.touchCooldown = 0.22;
  const hitter = s[who];

  if (s.hits >= 3) {
    // Rocket punch: the spike angle is set by the hitter's vertical velocity
    // at contact time. Move up-right to bank off the top wall, down-right to
    // bank off the bottom, or stand still for a straight shot.
    const yRatio = (hitter.vy / PLAYER_SPEED) * ROCKET_MAX_Y_RATIO;
    const v = rocketVelocity(+1, yRatio);
    s.ball.vx = v.vx;
    s.ball.vy = v.vy;
    s.ball.rocket = true;
  } else {
    // Bump/set: 2D projectile toward the partner's current position, BUT
    // the hitter's current velocity is mixed in as a bias. Moving while
    // hitting drags the arc in that direction — the partner has to
    // anticipate and chase instead of parking.
    const other = who === 'p1' ? s.p2 : s.p1;
    launchArcTo(s.ball, other.x, other.y, -COURT_GRAVITY, BOUNCE_ARC_TIME);
    s.ball.vx += hitter.vx * VELOCITY_BIAS;
    s.ball.vy += hitter.vy * VELOCITY_BIAS;
    s.ball.rocket = false;
  }
}

function handleAIHit(s, who) {
  s.hits += 1;
  s.lastToucher = who;
  s.touchCooldown = 0.22;
  const hitter = s[who];

  if (s.hits >= 3) {
    // AI rocket: random spike angle (the AI doesn't "choose" a direction
    // like a human player would; the randomness keeps it from being a
    // perfectly predictable straight shot every time).
    const yRatio = (Math.random() - 0.5) * 2 * ROCKET_MAX_Y_RATIO;
    const v = rocketVelocity(-1, yRatio);
    s.ball.vx = v.vx;
    s.ball.vy = v.vy;
    s.ball.rocket = true;
  } else {
    // Mirror of the team bump/set, including velocity bias. The AI is
    // usually stationary during mid-rally holds (bias = 0 → clean arc),
    // but when intercepting an incoming rocket on hit 1 they're moving
    // toward the ball, which biases the bump away from their partner.
    const other = who === 'ai1' ? s.ai2 : s.ai1;
    launchArcTo(s.ball, other.x, other.y, +COURT_GRAVITY, BOUNCE_ARC_TIME);
    s.ball.vx += hitter.vx * VELOCITY_BIAS;
    s.ball.vy += hitter.vy * VELOCITY_BIAS;
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
