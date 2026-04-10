// StackDuo — simulation: gravity, DAS, input, locking, line clears, garbage,
// danger mode, speed tiers, and topout detection.

import {
  BOARD_W, BOARD_H, CELL, DANGER_ROW, SYNC_BONUS_MS,
  LOCK_DELAY, LOCK_MOVE_LIMIT, DAS_DELAY, DAS_REPEAT, SOFT_DROP_INTERVAL,
  GARBAGE_TABLE, SCORE_TABLE, SHAPES,
  collides, tryRotate, ghostY, nextPieceType, fillQueue, spawnX, currentSpeed,
} from './state.js';

// ---- Public API --------------------------------------------------------------

export function tickSimulation(state, dt) {
  if (state.phase !== 'playing') return;
  state.elapsed += dt;

  const speedMs = currentSpeed(state.elapsed);

  for (let bi = 0; bi < 2; bi++) {
    const board = state.boards[bi];
    const pLeft  = state.players[bi * 2];
    const pRight = state.players[bi * 2 + 1];

    // Danger mode check
    board.inDanger = isDanger(board);
    const effSpeed = board.inDanger ? speedMs * 1.2 : speedMs;

    // Apply any pending garbage whose timer has elapsed
    tickGarbageTimer(board, dt);

    // Process left-entry first for determinism
    tickPlayer(state, board, pLeft, pRight, dt, effSpeed);
    tickPlayer(state, board, pRight, pLeft, dt, effSpeed);

    // Check topout after both players tick
    if (isTopout(board, pLeft, pRight)) {
      state.phase = 'over';
      state.winTeam = 1 - bi;
      return;
    }
  }
}

// Spawn initial pieces for all players at game start.
export function spawnInitialPieces(state) {
  for (const p of state.players) {
    fillQueue(p);
    doSpawn(state.boards[p.team], p, getTeammate(state, p));
  }
}

// ---- Per-player tick ---------------------------------------------------------

function tickPlayer(state, board, player, other, dt, speedMs) {
  // Spawn if needed
  if (!player.piece) {
    doSpawn(board, player, other);
    if (!player.piece) return; // topout — caller handles
    return; // don't process input on spawn frame
  }

  const dtMs = dt * 1000;
  const piece = player.piece;
  // Teammates' active pieces don't block each other — only locked cells
  // and board boundaries matter. This prevents mid-air locking when one
  // player's piece temporarily sits above the teammate's falling piece.
  const otherPiece = null;
  const cells = board.cells;

  // ---- Input processing (edge-triggered actions) ----------------------------
  const k = player.keys;
  const pk = player.prevKeys;

  // Rotate CW (rising edge)
  if (k.rotateCW && !pk.rotateCW) {
    const r = tryRotate(cells, piece, 1, otherPiece);
    if (r) { piece.x = r.x; piece.y = r.y; piece.rot = r.rot; resetLock(player); }
  }
  // Rotate CCW (rising edge)
  if (k.rotateCCW && !pk.rotateCCW) {
    const r = tryRotate(cells, piece, -1, otherPiece);
    if (r) { piece.x = r.x; piece.y = r.y; piece.rot = r.rot; resetLock(player); }
  }

  // Hold (rising edge)
  if (k.hold && !pk.hold && !player.holdUsed) {
    const held = player.hold;
    player.hold = piece.type;
    player.holdUsed = true;
    if (held) {
      piece.type = held;
      piece.rot = 0;
      piece.x = spawnX(player.entry);
      piece.y = 0;
      if (collides(cells, piece.type, piece.x, piece.y, piece.rot, otherPiece)) {
        player.piece = null; // topout
        return;
      }
    } else {
      player.piece = null;
      doSpawn(board, player, other);
      return;
    }
    player.lockTimer = 0;
    player.lockMoves = 0;
    player.dropTimer = 0;
  }

  // Hard drop (rising edge)
  if (k.hardDrop && !pk.hardDrop) {
    const gy = ghostY(cells, piece, otherPiece);
    player.piecesPlaced++;
    piece.y = gy;
    lockPiece(state, board, player, other);
    savePrevKeys(player);
    return;
  }

  // ---- DAS (horizontal movement) -------------------------------------------
  {
    const wantLeft = k.left && !k.right;
    const wantRight = k.right && !k.left;
    const dir = wantLeft ? -1 : wantRight ? 1 : 0;

    if (dir !== 0) {
      if (dir !== player.dasDir) {
        // New direction — try immediate move, reset DAS
        player.dasDir = dir;
        player.dasTimer = 0;
        if (!collides(cells, piece.type, piece.x + dir, piece.y, piece.rot, otherPiece)) {
          piece.x += dir;
          resetLock(player);
        }
      } else {
        // Same direction held — DAS timer
        player.dasTimer += dtMs;
        if (player.dasTimer >= DAS_DELAY) {
          player.dasTimer -= DAS_REPEAT;
          if (player.dasTimer > DAS_DELAY) player.dasTimer = DAS_DELAY; // cap
          if (!collides(cells, piece.type, piece.x + dir, piece.y, piece.rot, otherPiece)) {
            piece.x += dir;
            resetLock(player);
          }
        }
      }
    } else {
      player.dasDir = 0;
      player.dasTimer = 0;
    }
  }

  // ---- Gravity --------------------------------------------------------------
  const dropInterval = k.softDrop ? SOFT_DROP_INTERVAL : speedMs;
  player.dropTimer += dtMs;

  while (player.dropTimer >= dropInterval) {
    player.dropTimer -= dropInterval;
    if (!collides(cells, piece.type, piece.x, piece.y + 1, piece.rot, otherPiece)) {
      piece.y++;
    } else {
      player.dropTimer = 0;
      break;
    }
  }

  // ---- Lock delay -----------------------------------------------------------
  if (collides(cells, piece.type, piece.x, piece.y + 1, piece.rot, otherPiece)) {
    player.lockTimer += dtMs;
    if (player.lockTimer >= LOCK_DELAY || player.lockMoves >= LOCK_MOVE_LIMIT) {
      lockPiece(state, board, player, other);
    }
  } else {
    player.lockTimer = 0;
  }

  savePrevKeys(player);
}

// ---- Spawning ---------------------------------------------------------------

function doSpawn(board, player, other) {
  const type = nextPieceType(player);
  const sx = spawnX(player.entry);
  // Spawn only checks locked cells, not teammate's active piece
  if (collides(board.cells, type, sx, 0, 0, null)) {
    // Try one row up (row -1 allowed for spawn)
    if (collides(board.cells, type, sx, -1, 0, null)) {
      player.piece = null;
      return; // topout
    }
    player.piece = { type, rot: 0, x: sx, y: -1 };
  } else {
    player.piece = { type, rot: 0, x: sx, y: 0 };
  }
  player.holdUsed = false;
  player.dropTimer = 0;
  player.lockTimer = 0;
  player.lockMoves = 0;
}

// ---- Locking & line clears --------------------------------------------------

function lockPiece(state, board, player, other) {
  const piece = player.piece;
  const offsets = SHAPES[piece.type][piece.rot];

  // Write cells
  for (let i = 0; i < 4; i++) {
    const cx = piece.x + offsets[i][0];
    const cy = piece.y + offsets[i][1];
    if (cy >= 0 && cy < BOARD_H && cx >= 0 && cx < BOARD_W) {
      board.cells[cy * BOARD_W + cx] = player.index + 1; // 1-4 for player colors
    }
  }
  player.piece = null;

  // Clear full rows
  const cleared = clearRows(board);
  if (cleared > 0) {
    player.linesCleared += cleared;
    board.totalLinesCleared += cleared;
    const ei = player.entry === 'left' ? 0 : 1;
    board.linesCleared[ei] += cleared;
    board.score += SCORE_TABLE[Math.min(cleared, 4)];

    // Calculate garbage to send
    let garbage = GARBAGE_TABLE[Math.min(cleared, 4)];
    if (board.inDanger) garbage += 1;

    // Sync bonus
    const now = performance.now();
    if (board.lastClearTime > 0 && now - board.lastClearTime < SYNC_BONUS_MS) {
      garbage += 1;
    }
    board.lastClearTime = now;

    // Queue garbage on opposing board with 1-second delay
    if (garbage > 0) {
      const opp = state.boards[1 - player.team];
      opp.pendingGarbage += garbage;
      opp.garbageTimer = Math.max(opp.garbageTimer, 1.0); // 1s delay
    }
  }
}

function clearRows(board) {
  let cleared = 0;
  for (let y = BOARD_H - 1; y >= 0; y--) {
    let full = true;
    for (let x = 0; x < BOARD_W; x++) {
      if (board.cells[y * BOARD_W + x] === 0) { full = false; break; }
    }
    if (full) {
      cleared++;
      // Shift everything above down by one
      for (let yy = y; yy > 0; yy--) {
        for (let x = 0; x < BOARD_W; x++) {
          board.cells[yy * BOARD_W + x] = board.cells[(yy - 1) * BOARD_W + x];
        }
      }
      // Clear top row
      for (let x = 0; x < BOARD_W; x++) board.cells[x] = 0;
      y++; // re-check this row
    }
  }
  return cleared;
}

// ---- Garbage ----------------------------------------------------------------

function tickGarbageTimer(board, dt) {
  if (board.pendingGarbage <= 0) return;
  board.garbageTimer -= dt;
  if (board.garbageTimer <= 0) {
    applyGarbage(board, board.pendingGarbage);
    board.pendingGarbage = 0;
    board.garbageTimer = 0;
  }
}

function applyGarbage(board, count) {
  const cells = board.cells;
  // Shift existing cells up
  for (let y = 0; y < BOARD_H - count; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      cells[y * BOARD_W + x] = cells[(y + count) * BOARD_W + x];
    }
  }
  // Fill bottom rows with garbage (value 5 = garbage, one random gap per row)
  for (let i = 0; i < count; i++) {
    const y = BOARD_H - count + i;
    const gap = Math.floor(Math.random() * BOARD_W);
    for (let x = 0; x < BOARD_W; x++) {
      cells[y * BOARD_W + x] = x === gap ? 0 : 5;
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

function isDanger(board) {
  for (let x = 0; x < BOARD_W; x++) {
    if (board.cells[DANGER_ROW * BOARD_W + x] !== 0) return true;
  }
  return false;
}

function isTopout(board, p1, p2) {
  // A player has topped out if their piece is null (spawn failed)
  // and a new spawn would also fail
  if (p1.piece === null) {
    const type = p1.queue[0] || 'T';
    if (collides(board.cells, type, spawnX(p1.entry), 0, 0, null)) return true;
  }
  if (p2.piece === null) {
    const type = p2.queue[0] || 'T';
    if (collides(board.cells, type, spawnX(p2.entry), 0, 0, null)) return true;
  }
  return false;
}

function resetLock(player) {
  if (player.lockMoves < LOCK_MOVE_LIMIT) {
    player.lockTimer = 0;
    player.lockMoves++;
  }
}

function savePrevKeys(player) {
  const k = player.keys;
  const pk = player.prevKeys;
  pk.left = k.left;
  pk.right = k.right;
  pk.softDrop = k.softDrop;
  pk.hardDrop = k.hardDrop;
  pk.rotateCW = k.rotateCW;
  pk.rotateCCW = k.rotateCCW;
  pk.hold = k.hold;
}

function getTeammate(state, player) {
  const ti = player.team * 2;
  return state.players[ti] === player ? state.players[ti + 1] : state.players[ti];
}
