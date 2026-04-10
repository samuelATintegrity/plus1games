// StackDuo — Canvas2D rendering: boards, pieces, ghosts, queues, hold slots,
// HUD, lobby screen, countdown, and game-over screen.

import {
  LOGICAL_W, LOGICAL_H, CELL, BOARD_W, BOARD_H,
  BOARD_PX_W, BOARD_PX_H, DANGER_ROW, PREVIEW_COUNT,
  SHAPES, PLAYER_STYLES, C, currentSpeed,
} from './state.js';
import { ghostY } from './state.js';

// ---- Layout constants --------------------------------------------------------

const HUD_TOP = 12;   // top HUD height
const BOARD_Y = HUD_TOP;

// Board X positions — two 20-cell-wide boards side by side with queue panels
const BOARD_A_X = 24;
const BOARD_B_X = 196;

// Queue panels (20px wide columns beside boards)
// P0 queue = left of board A, P1 queue = right of board A
// P2 queue = left of board B, P3 queue = right of board B
const QUEUE_X = [0, 126, 174, 298];
const QUEUE_Y = 44;
const QUEUE_PIECE_H = 24;

// Hold panels
const HOLD_X = [0, 126, 174, 298];
const HOLD_Y = BOARD_Y + 2;

// Garbage warning bar (drawn inside board edge)
const GARB_BAR_W = 2;

// ---- Public API --------------------------------------------------------------

export function draw(ctx, state, localPlayerIndex, blink) {
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  for (let bi = 0; bi < 2; bi++) {
    const bx = bi === 0 ? BOARD_A_X : BOARD_B_X;
    drawBoardBg(ctx, bx, BOARD_Y, state.boards[bi], blink);
    drawBoardCells(ctx, state.boards[bi], bx, BOARD_Y);

    const p1 = state.players[bi * 2];
    const p2 = state.players[bi * 2 + 1];

    // Ghost pieces (no teammate collision — ghosts show landing on board only)
    if (p1.piece) drawGhost(ctx, state.boards[bi], p1, bx, BOARD_Y);
    if (p2.piece) drawGhost(ctx, state.boards[bi], p2, bx, BOARD_Y);
    // Active pieces
    if (p1.piece) drawActivePiece(ctx, p1, bx, BOARD_Y);
    if (p2.piece) drawActivePiece(ctx, p2, bx, BOARD_Y);

    // Garbage warning
    if (state.boards[bi].pendingGarbage > 0) {
      drawGarbageWarning(ctx, bx, BOARD_Y, state.boards[bi], blink);
    }
  }

  // Queues and holds
  for (let pi = 0; pi < 4; pi++) {
    drawHold(ctx, state.players[pi], HOLD_X[pi], HOLD_Y);
    drawQueue(ctx, state.players[pi], QUEUE_X[pi], QUEUE_Y);
  }

  drawTopHUD(ctx, state);
  drawBottomHUD(ctx, state);

  // Highlight local player label
  if (localPlayerIndex >= 0 && localPlayerIndex < 4) {
    drawLocalIndicator(ctx, localPlayerIndex, blink);
  }
}

export function drawLobby(ctx, state, blink, localPlayerIndex, isHost) {
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Title
  ctx.fillStyle = C.lightest;
  ctx.font = 'bold 10px monospace';
  ctx.fillText('STACKDUO', 160, 16);
  ctx.font = '7px monospace';
  ctx.fillStyle = C.light;
  ctx.fillText('2v2 BLOCK BATTLE', 160, 30);

  // Team A column
  ctx.fillStyle = C.lightest;
  ctx.font = 'bold 8px monospace';
  ctx.fillText('TEAM A', 80, 52);
  drawSlot(ctx, state.lobby.slots[0], 'P1 (LEFT)', 80, 66, localPlayerIndex === 0, blink);
  drawSlot(ctx, state.lobby.slots[1], 'P2 (RIGHT)', 80, 94, localPlayerIndex === 1, blink);

  // Team B column
  ctx.fillText('TEAM B', 240, 52);
  drawSlot(ctx, state.lobby.slots[2], 'P3 (LEFT)', 240, 66, localPlayerIndex === 2, blink);
  drawSlot(ctx, state.lobby.slots[3], 'P4 (RIGHT)', 240, 94, localPlayerIndex === 3, blink);

  // Divider
  ctx.strokeStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(160, 52);
  ctx.lineTo(160, 120);
  ctx.stroke();

  // Controls help
  ctx.fillStyle = C.dark;
  ctx.font = '6px monospace';
  ctx.fillText('T: SWITCH TEAM  |  F: FILL AI  |  G: REMOVE AI', 160, 134);

  // Status
  const allFilled = state.lobby.slots.every(s => s !== null);
  ctx.font = '7px monospace';
  if (isHost) {
    if (allFilled) {
      ctx.fillStyle = blink ? C.lightest : C.dark;
      ctx.fillText('PRESS ENTER TO START', 160, 160);
    } else {
      ctx.fillStyle = C.light;
      ctx.fillText('WAITING FOR PLAYERS...', 160, 160);
    }
  } else {
    ctx.fillStyle = C.light;
    ctx.fillText('WAITING FOR HOST...', 160, 160);
  }

  // Controls reference
  ctx.fillStyle = C.dark;
  ctx.font = '5px monospace';
  const controls = [
    'MOVE: A/D or \u2190/\u2192',
    'SOFT DROP: S or \u2193',
    'HARD DROP: W or \u2191',
    'ROTATE: Q/E',
    'HOLD: R',
  ];
  for (let i = 0; i < controls.length; i++) {
    ctx.fillText(controls[i], 160, 184 + i * 9);
  }
}

export function drawCountdown(ctx, timer) {
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.lightest;
  ctx.font = 'bold 24px monospace';
  const num = Math.ceil(timer);
  ctx.fillText(num <= 0 ? 'GO!' : String(num), 160, 120);
}

export function drawGameOver(ctx, state, blink) {
  // Dim the game view
  ctx.fillStyle = 'rgba(15, 56, 15, 0.7)';
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillStyle = C.lightest;
  ctx.font = 'bold 12px monospace';
  const winner = state.winTeam === 0 ? 'TEAM A' : 'TEAM B';
  ctx.fillText(`${winner} WINS!`, 160, 60);

  // Stats
  ctx.font = '7px monospace';
  ctx.fillStyle = C.light;
  const bA = state.boards[0];
  const bB = state.boards[1];
  ctx.fillText(`TEAM A: ${bA.score} pts  ${bA.totalLinesCleared} lines`, 160, 90);
  ctx.fillText(`TEAM B: ${bB.score} pts  ${bB.totalLinesCleared} lines`, 160, 104);

  // Per-player stats
  ctx.font = '6px monospace';
  ctx.fillStyle = C.dark;
  for (let pi = 0; pi < 4; pi++) {
    const p = state.players[pi];
    const label = p.isHuman ? `P${pi + 1}` : `AI${pi + 1}`;
    const x = pi < 2 ? 100 : 220;
    const y = 124 + (pi % 2) * 12;
    ctx.fillText(`${label}: ${p.linesCleared}L  ${p.piecesPlaced}pcs`, x, y);
  }

  if (blink) {
    ctx.fillStyle = C.lightest;
    ctx.font = '8px monospace';
    ctx.fillText('PRESS ENTER', 160, 170);
  }
}

// ---- Board rendering ---------------------------------------------------------

function drawBoardBg(ctx, bx, by, board, blink) {
  // Board border
  const borderColor = board.inDanger && blink ? C.lightest : C.dark;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - 1, by - 1, BOARD_PX_W + 2, BOARD_PX_H + 2);

  // Grid lines (subtle)
  ctx.strokeStyle = '#1a4a1a';
  ctx.lineWidth = 0.5;
  for (let x = 1; x < BOARD_W; x++) {
    ctx.beginPath();
    ctx.moveTo(bx + x * CELL, by);
    ctx.lineTo(bx + x * CELL, by + BOARD_PX_H);
    ctx.stroke();
  }
  for (let y = 1; y < BOARD_H; y++) {
    ctx.beginPath();
    ctx.moveTo(bx, by + y * CELL);
    ctx.lineTo(bx + BOARD_PX_W, by + y * CELL);
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  // Danger line
  ctx.strokeStyle = C.dark;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(bx, by + DANGER_ROW * CELL);
  ctx.lineTo(bx + BOARD_PX_W, by + DANGER_ROW * CELL);
  ctx.stroke();
  ctx.setLineDash([]);

  // Danger label
  if (board.inDanger && blink) {
    ctx.fillStyle = C.lightest;
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DANGER', bx + BOARD_PX_W / 2, by - 9);
  }
}

function drawBoardCells(ctx, board, bx, by) {
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const val = board.cells[y * BOARD_W + x];
      if (val === 0) continue;
      const px = bx + x * CELL;
      const py = by + y * CELL;
      if (val === 5) {
        // Garbage cell
        ctx.fillStyle = C.dark;
        ctx.fillRect(px, py, CELL, CELL);
        // Hatched pattern
        ctx.strokeStyle = C.darkest;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(px, py + CELL);
        ctx.lineTo(px + CELL, py);
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        const style = PLAYER_STYLES[(val - 1) % 4];
        ctx.fillStyle = style.fill;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        ctx.strokeStyle = style.border;
        ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      }
    }
  }
}

function drawActivePiece(ctx, player, bx, by) {
  const piece = player.piece;
  const style = PLAYER_STYLES[player.index];
  const offsets = SHAPES[piece.type][piece.rot];
  for (let i = 0; i < 4; i++) {
    const px = bx + (piece.x + offsets[i][0]) * CELL;
    const py = by + (piece.y + offsets[i][1]) * CELL;
    if (py < by) continue;
    ctx.fillStyle = style.fill;
    ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
    ctx.lineWidth = 1;
  }
}

function drawGhost(ctx, board, player, bx, by) {
  const piece = player.piece;
  const gy = ghostY(board.cells, piece, null);
  if (gy === piece.y) return;
  const style = PLAYER_STYLES[player.index];
  const offsets = SHAPES[piece.type][piece.rot];
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 4; i++) {
    const px = bx + (piece.x + offsets[i][0]) * CELL;
    const py = by + (gy + offsets[i][1]) * CELL;
    if (py < by) continue;
    ctx.fillStyle = style.fill;
    ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
    ctx.strokeStyle = style.border;
    ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
  }
  ctx.globalAlpha = 1;
}

function drawGarbageWarning(ctx, bx, by, board, blink) {
  if (!blink) return;
  const count = Math.min(board.pendingGarbage, BOARD_H);
  ctx.fillStyle = C.lightest;
  for (let i = 0; i < count; i++) {
    const y = by + BOARD_PX_H - (i + 1) * CELL;
    ctx.fillRect(bx + 1, y, GARB_BAR_W, CELL);
  }
}

// ---- Queue & Hold rendering --------------------------------------------------

function drawQueue(ctx, player, qx, qy) {
  ctx.fillStyle = C.dark;
  ctx.font = '5px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(player.isHuman ? `P${player.index + 1}` : `AI`, qx + 10, qy - 6);

  for (let i = 0; i < PREVIEW_COUNT && i < player.queue.length; i++) {
    drawMiniPiece(ctx, player.queue[i], player.index, qx, qy + i * QUEUE_PIECE_H);
  }
}

function drawHold(ctx, player, hx, hy) {
  ctx.strokeStyle = C.dark;
  ctx.strokeRect(hx, hy, 20, 16);
  ctx.fillStyle = C.dark;
  ctx.font = '4px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('HOLD', hx + 10, hy - 5);
  if (player.hold) {
    drawMiniPiece(ctx, player.hold, player.index, hx + 1, hy + 1, true);
  }
}

function drawMiniPiece(ctx, type, playerIndex, px, py, small) {
  const style = PLAYER_STYLES[playerIndex];
  const offsets = SHAPES[type][0]; // always show rotation 0
  const s = small ? 3 : 4;
  // Center the piece in preview area
  const minX = Math.min(...offsets.map(o => o[0]));
  const maxX = Math.max(...offsets.map(o => o[0]));
  const minY = Math.min(...offsets.map(o => o[1]));
  const maxY = Math.max(...offsets.map(o => o[1]));
  const pw = (maxX - minX + 1) * s;
  const ph = (maxY - minY + 1) * s;
  const ox = px + (20 - pw) / 2 - minX * s;
  const oy = py + (small ? (14 - ph) / 2 : (QUEUE_PIECE_H - ph) / 2) - minY * s;

  for (let i = 0; i < 4; i++) {
    const cx = ox + offsets[i][0] * s;
    const cy = oy + offsets[i][1] * s;
    ctx.fillStyle = style.fill;
    ctx.fillRect(cx, cy, s - 1, s - 1);
    ctx.strokeStyle = style.border;
    ctx.strokeRect(cx, cy, s - 1, s - 1);
  }
}

// ---- HUD ---------------------------------------------------------------------

function drawTopHUD(ctx, state) {
  ctx.textBaseline = 'top';
  ctx.font = '7px monospace';

  // Team labels and scores
  ctx.textAlign = 'left';
  ctx.fillStyle = C.light;
  ctx.fillText(`TEAM A: ${state.boards[0].score}`, BOARD_A_X, 2);

  ctx.textAlign = 'right';
  ctx.fillText(`TEAM B: ${state.boards[1].score}`, BOARD_B_X + BOARD_PX_W, 2);

  // Timer
  ctx.textAlign = 'center';
  ctx.fillStyle = C.dark;
  const mins = Math.floor(state.elapsed / 60);
  const secs = Math.floor(state.elapsed % 60);
  ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, 160, 2);

  // Line counts
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.dark;
  ctx.fillText(`${state.boards[0].totalLinesCleared}L`, BOARD_A_X, 10);
  ctx.textAlign = 'right';
  ctx.fillText(`${state.boards[1].totalLinesCleared}L`, BOARD_B_X + BOARD_PX_W, 10);
}

function drawBottomHUD(ctx, state) {
  const y = BOARD_Y + BOARD_PX_H + 4;
  ctx.textBaseline = 'top';
  ctx.font = '6px monospace';

  // Speed indicator
  ctx.textAlign = 'center';
  ctx.fillStyle = C.dark;
  const speed = currentSpeed(state.elapsed);
  ctx.fillText(`SPD ${speed}ms`, 160, y);

  // Per-player line counts
  ctx.font = '5px monospace';
  for (let pi = 0; pi < 4; pi++) {
    const p = state.players[pi];
    const label = p.isHuman ? `P${pi + 1}` : `AI`;
    const x = HOLD_X[pi] + 10;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.dark;
    ctx.fillText(`${label}:${p.linesCleared}L`, x, y + 10);
  }
}

function drawLocalIndicator(ctx, pi, blink) {
  if (!blink) return;
  const x = QUEUE_X[pi] + 10;
  ctx.fillStyle = C.lightest;
  ctx.font = '4px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('\u25bc YOU', x, HOLD_Y - 8);
}

// ---- Lobby helpers -----------------------------------------------------------

function drawSlot(ctx, slot, label, cx, cy, isLocal, blink) {
  ctx.textAlign = 'center';
  ctx.font = '6px monospace';
  ctx.fillStyle = C.dark;
  ctx.fillText(label, cx, cy);

  const boxW = 60, boxH = 16;
  const bx = cx - boxW / 2, by = cy + 9;

  if (isLocal && blink) {
    ctx.strokeStyle = C.lightest;
  } else {
    ctx.strokeStyle = C.dark;
  }
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.font = '7px monospace';
  if (slot === null) {
    ctx.fillStyle = C.dark;
    ctx.fillText('EMPTY', cx, by + 4);
  } else if (slot === 'ai') {
    ctx.fillStyle = C.light;
    ctx.fillText('AI', cx, by + 4);
  } else {
    ctx.fillStyle = C.lightest;
    // Show truncated peer ID
    const display = typeof slot === 'string' ? slot.slice(0, 8) : 'PLAYER';
    ctx.fillText(display, cx, by + 4);
  }
}
