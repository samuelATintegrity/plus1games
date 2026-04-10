// StackDuo — AI player: evaluates all valid placements and simulates
// human-paced keyboard input to execute the chosen move.

import { BOARD_W, BOARD_H, SHAPES, PIECE_TYPES, collides } from './state.js';

// ---- Public API --------------------------------------------------------------

export function tickAI(player, board, otherPlayer, dt) {
  if (player.isHuman || !player.piece) return;

  if (!player._ai) {
    player._ai = { target: null, thinkTimer: 0, moveTimer: 0, phase: 'thinking' };
  }
  const ai = player._ai;
  const piece = player.piece;
  // Teammates' active pieces don't block each other
  const otherPiece = null;

  if (ai.phase === 'thinking') {
    ai.thinkTimer += dt;
    if (ai.thinkTimer >= 0.3) {
      ai.target = findBestPlacement(board.cells, piece, otherPiece);
      ai.thinkTimer = 0;
      ai.phase = 'executing';
    }
    clearKeys(player);
    return;
  }

  // Executing — step toward target with artificial delay
  ai.moveTimer += dt;
  if (ai.moveTimer < 0.05) return;
  ai.moveTimer = 0;
  clearKeys(player);

  if (!ai.target) {
    player.keys.hardDrop = true;
    ai.phase = 'thinking';
    return;
  }

  // Rotate first
  const rotDiff = (ai.target.rot - piece.rot + 4) % 4;
  if (rotDiff !== 0) {
    player.keys.rotateCW = true;
    return;
  }

  // Then move horizontally
  if (piece.x < ai.target.x) {
    player.keys.right = true;
    return;
  }
  if (piece.x > ai.target.x) {
    player.keys.left = true;
    return;
  }

  // At target — hard drop
  player.keys.hardDrop = true;
  ai.phase = 'thinking';
}

// Reset AI state when a new piece spawns (called externally or on piece change).
export function resetAI(player) {
  if (player._ai) {
    player._ai.target = null;
    player._ai.thinkTimer = 0;
    player._ai.moveTimer = 0;
    player._ai.phase = 'thinking';
  }
}

// ---- Placement search --------------------------------------------------------

function findBestPlacement(cells, piece, otherPiece) {
  let best = null;
  let bestScore = -Infinity;

  for (let rot = 0; rot < 4; rot++) {
    // Skip duplicate rotations for O piece
    if (piece.type === 'O' && rot > 0) break;

    for (let x = -2; x < BOARD_W + 2; x++) {
      // Find landing Y
      if (collides(cells, piece.type, x, 0, rot, otherPiece)) {
        // Try starting from higher
        let startY = -2;
        let valid = false;
        for (let sy = startY; sy < BOARD_H; sy++) {
          if (!collides(cells, piece.type, x, sy, rot, otherPiece)) {
            valid = true;
            break;
          }
        }
        if (!valid) continue;
      }

      let y = -2;
      // Find highest valid row
      while (y < BOARD_H && collides(cells, piece.type, x, y, rot, otherPiece)) y++;
      if (y >= BOARD_H) continue;
      // Drop to landing
      while (!collides(cells, piece.type, x, y + 1, rot, otherPiece)) y++;

      if (collides(cells, piece.type, x, y, rot, otherPiece)) continue;

      const score = evaluatePlacement(cells, piece.type, rot, x, y);
      if (score > bestScore) {
        bestScore = score;
        best = { x, rot };
      }
    }
  }
  return best;
}

function evaluatePlacement(cells, type, rot, px, py) {
  // Simulate placement on a cloned board
  const clone = new Uint8Array(cells);
  const offsets = SHAPES[type][rot];
  for (let i = 0; i < 4; i++) {
    const cx = px + offsets[i][0];
    const cy = py + offsets[i][1];
    if (cy >= 0 && cy < BOARD_H && cx >= 0 && cx < BOARD_W) {
      clone[cy * BOARD_W + cx] = 1;
    }
  }

  // Count completed lines
  let lines = 0;
  for (let y = 0; y < BOARD_H; y++) {
    let full = true;
    for (let x = 0; x < BOARD_W; x++) {
      if (clone[y * BOARD_W + x] === 0) { full = false; break; }
    }
    if (full) lines++;
  }

  // Count holes (empty cell with filled cell above)
  let holes = 0;
  for (let x = 0; x < BOARD_W; x++) {
    let blocked = false;
    for (let y = 0; y < BOARD_H; y++) {
      if (clone[y * BOARD_W + x] !== 0) blocked = true;
      else if (blocked) holes++;
    }
  }

  // Aggregate height
  let aggHeight = 0;
  const colHeights = new Array(BOARD_W);
  for (let x = 0; x < BOARD_W; x++) {
    colHeights[x] = 0;
    for (let y = 0; y < BOARD_H; y++) {
      if (clone[y * BOARD_W + x] !== 0) {
        colHeights[x] = BOARD_H - y;
        break;
      }
    }
    aggHeight += colHeights[x];
  }

  // Bumpiness
  let bumpiness = 0;
  for (let x = 1; x < BOARD_W; x++) {
    bumpiness += Math.abs(colHeights[x] - colHeights[x - 1]);
  }

  return lines * 100 - holes * 40 - aggHeight * 1 - bumpiness * 5;
}

// ---- Helpers ----------------------------------------------------------------

function clearKeys(player) {
  const k = player.keys;
  k.left = false;
  k.right = false;
  k.softDrop = false;
  k.hardDrop = false;
  k.rotateCW = false;
  k.rotateCCW = false;
  k.hold = false;
}
