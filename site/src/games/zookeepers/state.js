// Zookeepers — constants, movement helpers, palette, and state factory.

import { COLS, ROWS, TILE, parseMaze, isWalkableByZookeeper, isWalkableByAnimal } from './maze.js';

// ---- Display constants -------------------------------------------------------

export const LOGICAL_W = 320;
export const LOGICAL_H = 240;
export const SCALE     = 3;
export const TILE_SIZE = 7;          // px per tile
export const MAZE_PX_W = COLS * TILE_SIZE;  // 217
export const MAZE_PX_H = ROWS * TILE_SIZE;  // 231
export const MAZE_X    = Math.floor((LOGICAL_W - MAZE_PX_W) / 2); // 51
export const MAZE_Y    = 5;

// ---- Directions --------------------------------------------------------------
// 0=right, 1=down, 2=left, 3=up, -1=none
export const DIR = { RIGHT: 0, DOWN: 1, LEFT: 2, UP: 3, NONE: -1 };
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export function oppositeDir(d) {
  if (d < 0) return -1;
  return (d + 2) % 4;
}

// ---- Palette (DSi-inspired) --------------------------------------------------

export const C = {
  darkest:  '#0d1b2a',
  dark:     '#2b4162',
  light:    '#5fa8d3',
  lightest: '#d1e3f0',
};

// ---- Gameplay constants ------------------------------------------------------

export const BASE_ZK_SPEED   = 65;   // px/s zookeeper base speed
export const BASE_ANIM_SPEED = 55;   // px/s animal base speed
export const FRIGHT_SPEED_MULT = 0.5;
export const EATEN_SPEED_MULT  = 2.0;
export const TUNNEL_SPEED_MULT = 0.6; // animals slow in tunnel

// DAS for direction input — not really DAS like tetris, just the feel of
// holding a direction key. In Pac-Man, you hold the key and it stays as
// nextDir, so no repeat needed; we just set nextDir on keydown.

// Speed tiers per level (multiplier on animal base speed)
export const LEVEL_SPEED = [1.0, 1.0, 1.1, 1.2, 1.3, 1.3]; // index = level-1, capped at last

// Fright duration per level (seconds)
export const FRIGHT_DURATION = [6, 6, 4, 2, 2, 0]; // index = level-1

// Pen release dot thresholds per animal index
export const PEN_RELEASE_DOTS = [0, 5, 30, 60]; // ape, rhino, tiger, bear

// Mode schedule (scatter/chase durations in seconds)
// Even indices = scatter, odd = chase
export const MODE_SCHEDULE = [7, 20, 7, 20, 5, 20, 5, 99999];

// Scoring
export const SCORE_DOT    = 10;
export const SCORE_PELLET = 50;
export const SCORE_FRIGHT  = [200, 400, 800, 1600]; // per kill in one fright
export const SCORE_FRUIT   = [100, 300, 500, 700, 1000, 2000, 3000, 5000];

// Fruit spawn thresholds (dots eaten)
export const FRUIT_THRESHOLDS = [70, 170];

// Lives
export const STARTING_LIVES = 3;

// ---- Movement helpers --------------------------------------------------------

export function tileCenter(tileX, tileY) {
  return {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tileY * TILE_SIZE + TILE_SIZE / 2,
  };
}

const CENTER_THRESHOLD = 1.0; // px

export function isAtTileCenter(entity) {
  const cx = entity.tileX * TILE_SIZE + TILE_SIZE / 2;
  const cy = entity.tileY * TILE_SIZE + TILE_SIZE / 2;
  return Math.abs(entity.x - cx) < CENTER_THRESHOLD &&
         Math.abs(entity.y - cy) < CENTER_THRESHOLD;
}

export function snapToTileCenter(entity) {
  entity.x = entity.tileX * TILE_SIZE + TILE_SIZE / 2;
  entity.y = entity.tileY * TILE_SIZE + TILE_SIZE / 2;
}

// Can a zookeeper move from (tileX, tileY) in direction d?
export function canMoveZK(tiles, tileX, tileY, d) {
  if (d < 0) return false;
  let nx = tileX + DX[d];
  let ny = tileY + DY[d];
  // Tunnel wrap
  if (nx < 0) nx = COLS - 1;
  else if (nx >= COLS) nx = 0;
  if (ny < 0 || ny >= ROWS) return false;
  return isWalkableByZookeeper(tiles[ny * COLS + nx]);
}

// Can an animal move from (tileX, tileY) in direction d?
export function canMoveAnimal(tiles, tileX, tileY, d) {
  if (d < 0) return false;
  let nx = tileX + DX[d];
  let ny = tileY + DY[d];
  if (nx < 0) nx = COLS - 1;
  else if (nx >= COLS) nx = 0;
  if (ny < 0 || ny >= ROWS) return false;
  return isWalkableByAnimal(tiles[ny * COLS + nx]);
}

export function wrapTunnel(entity) {
  const halfTile = TILE_SIZE / 2;
  if (entity.x < -halfTile) {
    entity.x += COLS * TILE_SIZE;
    entity.tileX = COLS - 1;
  } else if (entity.x > COLS * TILE_SIZE + halfTile) {
    entity.x -= COLS * TILE_SIZE;
    entity.tileX = 0;
  }
}

// Update tileX/tileY from pixel position
export function updateTile(entity) {
  entity.tileX = Math.round((entity.x - TILE_SIZE / 2) / TILE_SIZE);
  entity.tileY = Math.round((entity.y - TILE_SIZE / 2) / TILE_SIZE);
  // Clamp
  if (entity.tileX < 0) entity.tileX = 0;
  if (entity.tileX >= COLS) entity.tileX = COLS - 1;
  if (entity.tileY < 0) entity.tileY = 0;
  if (entity.tileY >= ROWS) entity.tileY = ROWS - 1;
}

// ---- Animal type definitions -------------------------------------------------

export const ANIMAL_TYPES = ['ape', 'rhino', 'tiger', 'bear'];

// Scatter corners (tile coordinates)
export const SCATTER_CORNERS = [
  { col: COLS - 1, row: 0 },        // ape → top-right
  { col: 0,        row: 0 },        // rhino → top-left
  { col: COLS - 1, row: ROWS - 1 }, // tiger → bottom-right
  { col: 0,        row: ROWS - 1 }, // bear → bottom-left
];

// ---- State factory -----------------------------------------------------------

function makeZookeeper(index, spawnCol, spawnRow) {
  const c = tileCenter(spawnCol, spawnRow);
  return {
    index,
    alive: true,
    x: c.x,
    y: c.y,
    tileX: spawnCol,
    tileY: spawnRow,
    dir: DIR.LEFT,
    nextDir: DIR.LEFT,
    speed: BASE_ZK_SPEED,
    animFrame: 0,
    animTimer: 0,
    deathTimer: 0,
    spawnTileX: spawnCol,
    spawnTileY: spawnRow,
    isHuman: index === 0,
  };
}

function makeAnimal(index, type, spawnCol, spawnRow, scatterCorner) {
  const c = tileCenter(spawnCol, spawnRow);
  return {
    index,
    type,
    x: c.x,
    y: c.y,
    tileX: spawnCol,
    tileY: spawnRow,
    dir: DIR.UP,
    speed: BASE_ANIM_SPEED,
    mode: 'scatter',
    prevMode: 'scatter',
    inPen: true,
    exitingPen: false,
    released: index === 0, // ape released immediately
    targetTileX: scatterCorner.col,
    targetTileY: scatterCorner.row,
    scatterTileX: scatterCorner.col,
    scatterTileY: scatterCorner.row,
    frightBlinkTimer: 0,
    isHuman: false,
    animFrame: 0,
    animTimer: 0,
    reverseQueued: false,
  };
}

export function makeGameState() {
  const { tiles, spawns, dotCount } = parseMaze();

  // Determine spawn positions; fall back to sensible defaults
  const zk1 = spawns.zk1 || { col: 15, row: 25 };
  const zk2 = spawns.zk2 || { col: 15, row: 31 };

  // Animal spawns — we need 4. The maze might define them via 'A' markers or
  // we fall back to the pen area.
  const animalSpawns = [];
  for (let i = 0; i < 4; i++) {
    animalSpawns.push(spawns.animals[i] || { col: 14 + i, row: 14 });
  }

  const penGate = spawns.penGate || { col: 13, row: 13 };

  return {
    phase: 'lobby',
    elapsed: 0,
    countdownTimer: 0,
    level: 1,
    score: 0,
    lives: STARTING_LIVES,
    dotsRemaining: dotCount,
    dotsTotal: dotCount,
    dotsEaten: 0,

    // Power pellet / frightened
    frightTimer: 0,
    frightKillCount: 0,

    // Fruit
    fruitActive: false,
    fruitType: 0,
    fruitTimer: 0,
    fruitTileX: Math.floor(COLS / 2),
    fruitTileY: 20,
    fruitTriggered: [false, false], // per threshold

    // Maze tiles
    tiles: tiles,

    // Pen gate location (for eaten-animal pathfinding)
    penGateCol: penGate.col,
    penGateRow: penGate.row,

    // Zookeepers
    zookeepers: [
      makeZookeeper(0, zk1.col, zk1.row),
      makeZookeeper(1, zk2.col, zk2.row),
    ],

    // Animals
    animals: [
      makeAnimal(0, 'ape',   animalSpawns[0].col, animalSpawns[0].row, SCATTER_CORNERS[0]),
      makeAnimal(1, 'rhino', animalSpawns[1].col, animalSpawns[1].row, SCATTER_CORNERS[1]),
      makeAnimal(2, 'tiger', animalSpawns[2].col, animalSpawns[2].row, SCATTER_CORNERS[2]),
      makeAnimal(3, 'bear',  animalSpawns[3].col, animalSpawns[3].row, SCATTER_CORNERS[3]),
    ],

    // Scatter/chase alternation
    modeTimer: MODE_SCHEDULE[0],
    modePhase: 0,
    globalMode: 'scatter',

    // Death animation state
    dyingTimer: 0,
    dyingZookeeper: -1,

    // Level-complete animation
    levelCompleteTimer: 0,

    // Lobby
    lobby: {
      slots: [null, null, null, null],
    },
  };
}

// Reset positions for a new life (after death)
export function resetPositions(state) {
  for (const zk of state.zookeepers) {
    const c = tileCenter(zk.spawnTileX, zk.spawnTileY);
    zk.x = c.x;
    zk.y = c.y;
    zk.tileX = zk.spawnTileX;
    zk.tileY = zk.spawnTileY;
    zk.dir = DIR.LEFT;
    zk.nextDir = DIR.LEFT;
    zk.alive = true;
    zk.deathTimer = 0;
    zk.animFrame = 0;
  }

  for (let i = 0; i < state.animals.length; i++) {
    const a = state.animals[i];
    const spawn = { col: state.penGateCol + (i - 1), row: state.penGateRow + 1 };
    // Ape spawns at pen gate, others inside pen
    if (i === 0) {
      spawn.col = state.penGateCol + 1;
      spawn.row = state.penGateRow + 1;
    }
    const c = tileCenter(spawn.col, spawn.row);
    a.x = c.x;
    a.y = c.y;
    a.tileX = spawn.col;
    a.tileY = spawn.row;
    a.dir = DIR.UP;
    a.mode = 'scatter';
    a.prevMode = 'scatter';
    a.inPen = true;
    a.exitingPen = false;
    a.released = i === 0;
    a.reverseQueued = false;
    a.frightBlinkTimer = 0;
  }

  state.modeTimer = MODE_SCHEDULE[0];
  state.modePhase = 0;
  state.globalMode = 'scatter';
  state.frightTimer = 0;
  state.frightKillCount = 0;
}

// Reset the full level (re-populate dots, reset everything)
export function resetLevel(state) {
  const { tiles, dotCount } = parseMaze();
  state.tiles = tiles;
  state.dotsRemaining = dotCount;
  state.dotsTotal = dotCount;
  state.dotsEaten = 0;
  state.fruitActive = false;
  state.fruitTriggered = [false, false];
  resetPositions(state);
}
