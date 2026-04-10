// StackDuo — constants, piece definitions, SRS kick tables, and state factory.

// ---- Display constants -------------------------------------------------------
export const LOGICAL_W = 320;
export const LOGICAL_H = 240;
export const SCALE = 3;
export const CELL = 5;
export const BOARD_W = 20;
export const BOARD_H = 30;
export const BOARD_PX_W = BOARD_W * CELL;  // 80
export const BOARD_PX_H = BOARD_H * CELL;  // 160
export const PREVIEW_COUNT = 3;

// ---- Gameplay constants ------------------------------------------------------
export const DANGER_ROW = 10;
export const SYNC_BONUS_MS = 500;
export const LOCK_DELAY = 500;       // ms before piece locks
export const LOCK_MOVE_LIMIT = 15;   // max resets of lock delay
export const DAS_DELAY = 167;        // ms before auto-shift starts
export const DAS_REPEAT = 33;        // ms between auto-shift repeats
export const SOFT_DROP_INTERVAL = 50; // ms per cell during soft drop

// Speed tiers: [elapsed_seconds, ms_per_cell_drop]
export const SPEED_TIERS = [
  [0, 800], [60, 650], [120, 500], [180, 380], [240, 280],
];

// Garbage table: index = lines cleared, value = garbage sent
export const GARBAGE_TABLE = [0, 0, 1, 2, 4];

// Scoring table: index = lines cleared
export const SCORE_TABLE = [0, 100, 300, 500, 800];

// ---- Palette (GameBoy DMG) ---------------------------------------------------
export const C = {
  darkest:  '#0f380f',
  dark:     '#306230',
  light:    '#8bac0f',
  lightest: '#9bbc0f',
};

// Player visual styles — distinguish pieces by border vs fill shade
export const PLAYER_STYLES = [
  { fill: C.light,    border: C.darkest },  // P0 Team A left
  { fill: C.lightest, border: C.dark },      // P1 Team A right
  { fill: C.light,    border: C.darkest },  // P2 Team B left
  { fill: C.lightest, border: C.dark },      // P3 Team B right
];

// ---- Tetromino definitions ---------------------------------------------------
export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Each rotation state is an array of 4 [col, row] offsets relative to origin.
// Standard SRS layout.
export const SHAPES = {
  I: [
    [[0,1],[1,1],[2,1],[3,1]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[1,0],[1,1],[1,2],[1,3]],
  ],
  O: [
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
  ],
  T: [
    [[1,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[2,1],[1,2]],
    [[1,0],[0,1],[1,1],[1,2]],
  ],
  S: [
    [[1,0],[2,0],[0,1],[1,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[1,1],[2,1],[0,2],[1,2]],
    [[0,0],[0,1],[1,1],[1,2]],
  ],
  Z: [
    [[0,0],[1,0],[1,1],[2,1]],
    [[2,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,2]],
    [[1,0],[0,1],[1,1],[0,2]],
  ],
  J: [
    [[0,0],[0,1],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[0,2],[1,2]],
  ],
  L: [
    [[2,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,1],[0,2]],
    [[0,0],[1,0],[1,1],[1,2]],
  ],
};

// ---- SRS Wall Kick tables ----------------------------------------------------
// Key format: "fromRot>toRot", values are arrays of [dx, dy] offsets to try.
// Positive dx = right, positive dy = down.

const KICKS_JLSTZ = {
  '0>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '1>0': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '1>2': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '2>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '2>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '3>2': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '3>0': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '0>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
};

const KICKS_I = {
  '0>1': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  '1>0': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  '1>2': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  '2>1': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  '2>3': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  '3>2': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  '3>0': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  '0>3': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
};

export function getKicks(type, fromRot, toRot) {
  const key = `${fromRot}>${toRot}`;
  return (type === 'I' ? KICKS_I : KICKS_JLSTZ)[key] || [[0, 0]];
}

// ---- Piece collision ---------------------------------------------------------

// Returns true if placing `type` at (x, y) with rotation `rot` collides with
// board boundaries, locked cells, or the other player's active piece.
export function collides(cells, type, x, y, rot, otherPiece) {
  const offsets = SHAPES[type][rot];
  for (let i = 0; i < 4; i++) {
    const cx = x + offsets[i][0];
    const cy = y + offsets[i][1];
    if (cx < 0 || cx >= BOARD_W || cy >= BOARD_H) return true;
    if (cy < 0) continue; // above ceiling is allowed for spawning
    if (cells[cy * BOARD_W + cx] !== 0) return true;
    if (otherPiece) {
      const oc = SHAPES[otherPiece.type][otherPiece.rot];
      for (let j = 0; j < 4; j++) {
        if (otherPiece.x + oc[j][0] === cx && otherPiece.y + oc[j][1] === cy) return true;
      }
    }
  }
  return false;
}

// Try SRS rotation. Returns { x, y, rot } on success, or null on failure.
export function tryRotate(cells, piece, dir, otherPiece) {
  const newRot = (piece.rot + dir + 4) % 4;
  const kicks = getKicks(piece.type, piece.rot, newRot);
  for (const [kx, ky] of kicks) {
    if (!collides(cells, piece.type, piece.x + kx, piece.y + ky, newRot, otherPiece)) {
      return { x: piece.x + kx, y: piece.y + ky, rot: newRot };
    }
  }
  return null;
}

// Ghost Y — the lowest row where the piece can sit.
export function ghostY(cells, piece, otherPiece) {
  let gy = piece.y;
  while (!collides(cells, piece.type, piece.x, gy + 1, piece.rot, otherPiece)) gy++;
  return gy;
}

// ---- 7-bag randomizer --------------------------------------------------------

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function fillQueue(player) {
  while (player.queue.length < PREVIEW_COUNT + 1) {
    if (player.bag.length === 0) {
      player.bag = shuffleArray([...PIECE_TYPES]);
    }
    player.queue.push(player.bag.pop());
  }
}

export function nextPieceType(player) {
  fillQueue(player);
  return player.queue.shift();
}

// ---- State factory -----------------------------------------------------------

function makeEmptyKeys() {
  return {
    left: false, right: false,
    softDrop: false, hardDrop: false,
    rotateCW: false, rotateCCW: false,
    hold: false,
  };
}

function makePlayer(index, team, entry) {
  return {
    index,
    team,
    entry,          // 'left' | 'right'
    isHuman: true,
    piece: null,    // { type, rot, x, y } or null
    bag: [],
    queue: [],
    hold: null,     // piece type string or null
    holdUsed: false,
    dropTimer: 0,
    lockTimer: 0,
    lockMoves: 0,
    keys: makeEmptyKeys(),
    prevKeys: makeEmptyKeys(), // previous frame for edge detection
    dasDir: 0,      // -1 left, 0 none, 1 right
    dasTimer: 0,
    linesCleared: 0,
    piecesPlaced: 0,
    _ai: null,      // AI state, set by ai.js if needed
  };
}

function makeBoard() {
  return {
    cells: new Uint8Array(BOARD_W * BOARD_H),
    pendingGarbage: 0,
    garbageTimer: 0,    // 1-second delay before garbage arrives
    lastClearTime: 0,
    linesCleared: [0, 0],
    totalLinesCleared: 0,
    inDanger: false,
    score: 0,
  };
}

export function makeGameState() {
  return {
    phase: 'lobby',    // 'lobby' | 'countdown' | 'playing' | 'over'
    elapsed: 0,
    countdownTimer: 0,
    winTeam: -1,
    boards: [makeBoard(), makeBoard()],
    players: [
      makePlayer(0, 0, 'left'),
      makePlayer(1, 0, 'right'),
      makePlayer(2, 1, 'left'),
      makePlayer(3, 1, 'right'),
    ],
    lobby: {
      slots: [null, null, null, null], // peerId string | 'ai' | null
    },
  };
}

// Spawn entry column for a player's entry side.
export function spawnX(entry) {
  return entry === 'left' ? 4 : 14;
}

// Current drop speed in ms based on elapsed time.
export function currentSpeed(elapsed) {
  let speed = SPEED_TIERS[0][1];
  for (let i = SPEED_TIERS.length - 1; i >= 0; i--) {
    if (elapsed >= SPEED_TIERS[i][0]) { speed = SPEED_TIERS[i][1]; break; }
  }
  return speed;
}
