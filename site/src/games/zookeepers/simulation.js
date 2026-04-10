// Zookeepers — per-tick game simulation.
//
// tickSimulation(state, dt) is called once per frame by the host (or in local
// mode). It handles: entity movement, dot eating, power pellets, frightened
// timer, animal-zookeeper collisions, death/respawn, level completion, scatter/
// chase mode switching, fruit spawning, and pen release.

import { COLS, ROWS, TILE } from './maze.js';
import {
  DIR, DX, DY, TILE_SIZE, oppositeDir,
  canMoveZK, canMoveAnimal,
  tileCenter, isAtTileCenter, snapToTileCenter,
  wrapTunnel, updateTile,
  BASE_ZK_SPEED, BASE_ANIM_SPEED,
  FRIGHT_SPEED_MULT, EATEN_SPEED_MULT, TUNNEL_SPEED_MULT,
  LEVEL_SPEED, FRIGHT_DURATION, PEN_RELEASE_DOTS,
  MODE_SCHEDULE, SCORE_DOT, SCORE_PELLET, SCORE_FRIGHT,
  SCORE_FRUIT, FRUIT_THRESHOLDS, STARTING_LIVES,
  resetPositions, resetLevel,
} from './state.js';
import { tickAnimalAI } from './ai.js';

// ---- Public API --------------------------------------------------------------

export function tickSimulation(state, dt) {
  if (state.phase === 'countdown') {
    state.countdownTimer -= dt;
    if (state.countdownTimer <= 0) {
      state.phase = 'playing';
      state.countdownTimer = 0;
    }
    return;
  }

  if (state.phase === 'dying') {
    state.dyingTimer -= dt;
    if (state.dyingTimer <= 0) {
      state.dyingTimer = 0;
      state.dyingZookeeper = -1;
      if (state.lives <= 0) {
        state.phase = 'over';
      } else {
        resetPositions(state);
        state.phase = 'playing';
      }
    }
    return;
  }

  if (state.phase === 'levelComplete') {
    state.levelCompleteTimer -= dt;
    if (state.levelCompleteTimer <= 0) {
      state.level++;
      resetLevel(state);
      state.phase = 'countdown';
      state.countdownTimer = 2;
    }
    return;
  }

  if (state.phase !== 'playing') return;

  state.elapsed += dt;

  // ---- Pen release check (also needed after death-reset) ---------------------
  checkPenRelease(state);

  // ---- Mode switching (scatter/chase timer) ----------------------------------
  tickModeSwitch(state, dt);

  // ---- Fright timer ----------------------------------------------------------
  if (state.frightTimer > 0) {
    state.frightTimer -= dt;
    if (state.frightTimer <= 0) {
      state.frightTimer = 0;
      // Restore modes
      for (const a of state.animals) {
        if (a.mode === 'frightened') {
          a.mode = state.globalMode;
          a.frightBlinkTimer = 0;
        }
      }
    } else if (state.frightTimer < 2) {
      // Blinking phase
      for (const a of state.animals) {
        if (a.mode === 'frightened') {
          a.frightBlinkTimer += dt;
        }
      }
    }
  }

  // ---- AI zookeepers ----------------------------------------------------------
  for (const zk of state.zookeepers) {
    if (!zk.isHuman && zk.alive) {
      tickAIZookeeper(zk, state);
    }
  }

  // ---- Move zookeepers -------------------------------------------------------
  for (const zk of state.zookeepers) {
    if (!zk.alive) continue;
    moveEntity(zk, state.tiles, true, state, dt);
  }

  // ---- Move animals ----------------------------------------------------------
  for (const a of state.animals) {
    tickAnimalMovement(a, state, dt);
  }

  // ---- Dot eating ------------------------------------------------------------
  for (const zk of state.zookeepers) {
    if (!zk.alive) continue;
    const idx = zk.tileY * COLS + zk.tileX;
    const tile = state.tiles[idx];
    if (tile === TILE.DOT) {
      state.tiles[idx] = TILE.EMPTY;
      state.score += SCORE_DOT;
      state.dotsRemaining--;
      state.dotsEaten++;
      checkPenRelease(state);
      checkFruitSpawn(state);
    } else if (tile === TILE.PELLET) {
      state.tiles[idx] = TILE.EMPTY;
      state.score += SCORE_PELLET;
      state.dotsRemaining--;
      state.dotsEaten++;
      activateFrightened(state);
      checkPenRelease(state);
    }
  }

  // ---- Level complete? -------------------------------------------------------
  if (state.dotsRemaining <= 0) {
    state.phase = 'levelComplete';
    state.levelCompleteTimer = 2.0;
    return;
  }

  // ---- Fruit timer -----------------------------------------------------------
  if (state.fruitActive) {
    state.fruitTimer -= dt;
    if (state.fruitTimer <= 0) {
      state.fruitActive = false;
    } else {
      // Check if zookeeper eats fruit
      for (const zk of state.zookeepers) {
        if (!zk.alive) continue;
        if (zk.tileX === state.fruitTileX && zk.tileY === state.fruitTileY) {
          const fruitIdx = Math.min(state.fruitType, SCORE_FRUIT.length - 1);
          state.score += SCORE_FRUIT[fruitIdx];
          state.fruitActive = false;
          break;
        }
      }
    }
  }

  // ---- Animal-zookeeper collision --------------------------------------------
  for (const a of state.animals) {
    if (a.inPen || a.exitingPen) continue;
    for (const zk of state.zookeepers) {
      if (!zk.alive) continue;
      const dx = Math.abs(a.x - zk.x);
      const dy = Math.abs(a.y - zk.y);
      if (dx < TILE_SIZE * 0.6 && dy < TILE_SIZE * 0.6) {
        if (a.mode === 'frightened') {
          // Zookeeper eats animal
          const killIdx = Math.min(state.frightKillCount, SCORE_FRIGHT.length - 1);
          state.score += SCORE_FRIGHT[killIdx];
          state.frightKillCount++;
          a.mode = 'eaten';
          a.speed = BASE_ANIM_SPEED * EATEN_SPEED_MULT;
        } else if (a.mode !== 'eaten') {
          // Animal catches zookeeper
          zk.alive = false;
          state.lives--;
          state.phase = 'dying';
          state.dyingTimer = 1.5;
          state.dyingZookeeper = zk.index;
          return; // stop simulation this frame
        }
      }
    }
  }
}

// Initialize game for playing
export function startGame(state) {
  state.phase = 'countdown';
  state.countdownTimer = 3;
  state.score = 0;
  state.lives = STARTING_LIVES;
  state.level = 1;
  state.elapsed = 0;
  resetLevel(state);
}

// ---- Internal ----------------------------------------------------------------

function tickModeSwitch(state, dt) {
  if (state.frightTimer > 0) return; // paused during fright

  state.modeTimer -= dt;
  if (state.modeTimer <= 0) {
    state.modePhase++;
    if (state.modePhase >= MODE_SCHEDULE.length) {
      state.modePhase = MODE_SCHEDULE.length - 1;
    }
    state.modeTimer = MODE_SCHEDULE[state.modePhase];
    state.globalMode = (state.modePhase % 2 === 0) ? 'scatter' : 'chase';

    // All AI animals reverse direction on mode switch
    for (const a of state.animals) {
      if (!a.isHuman && a.mode !== 'frightened' && a.mode !== 'eaten' && !a.inPen) {
        a.reverseQueued = true;
        a.mode = state.globalMode;
      }
    }
  }
}

function activateFrightened(state) {
  const lvlIdx = Math.min(state.level - 1, FRIGHT_DURATION.length - 1);
  const dur = FRIGHT_DURATION[lvlIdx];
  if (dur <= 0) return; // no fright on this level

  state.frightTimer = dur;
  state.frightKillCount = 0;

  for (const a of state.animals) {
    if (a.mode !== 'eaten' && !a.inPen) {
      a.prevMode = a.mode;
      a.mode = 'frightened';
      a.frightBlinkTimer = 0;
      // Reverse direction
      if (!a.isHuman) {
        a.reverseQueued = true;
      }
    }
  }
}

function checkPenRelease(state) {
  for (let i = 0; i < state.animals.length; i++) {
    const a = state.animals[i];
    if (!a.released && state.dotsEaten >= PEN_RELEASE_DOTS[i]) {
      a.released = true;
    }
  }
}

function checkFruitSpawn(state) {
  for (let i = 0; i < FRUIT_THRESHOLDS.length; i++) {
    if (!state.fruitTriggered[i] && state.dotsEaten >= FRUIT_THRESHOLDS[i]) {
      state.fruitTriggered[i] = true;
      state.fruitActive = true;
      state.fruitType = Math.min(state.level - 1 + i, SCORE_FRUIT.length - 1);
      state.fruitTimer = 10; // 10 seconds
    }
  }
}

// ---- Entity movement ---------------------------------------------------------

function moveEntity(entity, tiles, isZookeeper, state, dt) {
  const speed = entity.speed;
  if (speed === 0) return;

  // Animation
  entity.animTimer = (entity.animTimer || 0) + dt;
  if (entity.animTimer > 0.08) {
    entity.animTimer = 0;
    entity.animFrame = (entity.animFrame + 1) % 4;
  }

  if (entity.dir === DIR.NONE) {
    // Try to start in nextDir
    if (entity.nextDir !== DIR.NONE) {
      const canMove = isZookeeper ? canMoveZK : canMoveAnimal;
      if (canMove(tiles, entity.tileX, entity.tileY, entity.nextDir)) {
        entity.dir = entity.nextDir;
      }
    }
    if (entity.dir === DIR.NONE) return;
  }

  const dist = speed * dt;
  const dx = DX[entity.dir] * dist;
  const dy = DY[entity.dir] * dist;

  const oldTileX = entity.tileX;
  const oldTileY = entity.tileY;

  entity.x += dx;
  entity.y += dy;

  // Tunnel wrap
  wrapTunnel(entity);
  updateTile(entity);

  // Check if we crossed/reached a tile center
  const cx = entity.tileX * TILE_SIZE + TILE_SIZE / 2;
  const cy = entity.tileY * TILE_SIZE + TILE_SIZE / 2;
  const canMoveFunc = isZookeeper ? canMoveZK : canMoveAnimal;

  // Did we arrive at a new tile center?
  if (entity.tileX !== oldTileX || entity.tileY !== oldTileY || isAtTileCenter(entity)) {
    // Snap perpendicular axis
    if (entity.dir === DIR.LEFT || entity.dir === DIR.RIGHT) {
      entity.y = cy;
    } else {
      entity.x = cx;
    }

    // Try turning to nextDir
    if (entity.nextDir !== DIR.NONE && entity.nextDir !== entity.dir) {
      if (canMoveFunc(tiles, entity.tileX, entity.tileY, entity.nextDir)) {
        snapToTileCenter(entity);
        entity.dir = entity.nextDir;
        return;
      }
    }

    // Check if current direction is still valid
    if (!canMoveFunc(tiles, entity.tileX, entity.tileY, entity.dir)) {
      snapToTileCenter(entity);
      entity.dir = DIR.NONE;
    }
  }
}

// ---- Animal movement ---------------------------------------------------------

function tickAnimalMovement(animal, state, dt) {
  // Pen logic
  if (animal.inPen) {
    if (animal.released) {
      animal.exitingPen = true;
      animal.inPen = false;
      // Move to pen gate
      const gateC = tileCenter(state.penGateCol + 1, state.penGateRow);
      animal.targetTileX = state.penGateCol + 1;
      animal.targetTileY = state.penGateRow;
      // Teleport above pen gate when close
      const dx = Math.abs(animal.x - gateC.x);
      const dy = Math.abs(animal.y - gateC.y);
      if (dx < TILE_SIZE && dy < TILE_SIZE) {
        // Place above pen gate
        const aboveGate = tileCenter(state.penGateCol + 1, state.penGateRow - 1);
        animal.x = aboveGate.x;
        animal.y = aboveGate.y;
        animal.tileX = state.penGateCol + 1;
        animal.tileY = state.penGateRow - 1;
        animal.exitingPen = false;
        animal.dir = DIR.LEFT;
        animal.mode = state.globalMode;
      } else {
        // Move upward toward gate
        animal.y -= BASE_ANIM_SPEED * dt;
        updateTile(animal);
      }
    } else {
      // Bob up and down in pen
      animal.animTimer = (animal.animTimer || 0) + dt;
      animal.y += Math.sin(animal.animTimer * 4) * 0.5;
    }
    return;
  }

  if (animal.exitingPen) {
    // Moving out of pen to above gate
    const aboveGate = tileCenter(state.penGateCol + 1, state.penGateRow - 1);
    const dy = aboveGate.y - animal.y;
    if (Math.abs(dy) < 2) {
      animal.x = aboveGate.x;
      animal.y = aboveGate.y;
      animal.tileX = state.penGateCol + 1;
      animal.tileY = state.penGateRow - 1;
      animal.exitingPen = false;
      animal.dir = DIR.LEFT;
      animal.mode = state.globalMode;
    } else {
      animal.y += Math.sign(dy) * BASE_ANIM_SPEED * dt;
      updateTile(animal);
    }
    return;
  }

  // Eaten — heading back to pen
  if (animal.mode === 'eaten') {
    animal.speed = BASE_ANIM_SPEED * EATEN_SPEED_MULT;
    // Check if reached pen gate area
    if (Math.abs(animal.tileX - (state.penGateCol + 1)) <= 1 &&
        animal.tileY === state.penGateRow) {
      // Re-enter pen
      animal.inPen = true;
      animal.exitingPen = false;
      animal.released = true; // will immediately exit
      animal.mode = state.globalMode;
      const penInside = tileCenter(state.penGateCol + 1, state.penGateRow + 1);
      animal.x = penInside.x;
      animal.y = penInside.y;
      animal.tileX = state.penGateCol + 1;
      animal.tileY = state.penGateRow + 1;
      animal.speed = BASE_ANIM_SPEED;
      return;
    }
  }

  // Determine speed
  const lvlIdx = Math.min(state.level - 1, LEVEL_SPEED.length - 1);
  let speed = BASE_ANIM_SPEED * LEVEL_SPEED[lvlIdx];
  if (animal.mode === 'frightened') speed *= FRIGHT_SPEED_MULT;
  else if (animal.mode === 'eaten') speed *= EATEN_SPEED_MULT;
  // Tunnel slowdown
  const tile = state.tiles[animal.tileY * COLS + animal.tileX];
  if (tile === TILE.TUNNEL && animal.mode !== 'eaten') speed *= TUNNEL_SPEED_MULT;
  animal.speed = speed;

  // Handle reverse on mode switch
  if (animal.reverseQueued) {
    animal.reverseQueued = false;
    const opp = oppositeDir(animal.dir);
    if (opp >= 0) animal.dir = opp;
  }

  // AI targeting (or human control via nextDir)
  if (!animal.isHuman) {
    tickAnimalAI(animal, state);
  }

  // Move
  moveEntity(animal, state.tiles, false, state, dt);
}

// ---- BFS-based AI for zookeepers (when slot is AI) ---------------------------
// Finds the nearest dot via BFS and sets nextDir to the first step along that
// path. Runs every 6 calls (~10 Hz at 60fps).

function tickAIZookeeper(zk, state) {
  zk._aiTimer = (zk._aiTimer || 0) + 1;
  if (zk._aiTimer < 6) return;
  zk._aiTimer = 0;

  const tiles = state.tiles;
  const start = zk.tileY * COLS + zk.tileX;

  const visited = new Uint8Array(COLS * ROWS);
  const firstDir = new Int8Array(COLS * ROWS).fill(-1);
  const queue = [];

  visited[start] = 1;

  for (let d = 0; d < 4; d++) {
    if (!canMoveZK(tiles, zk.tileX, zk.tileY, d)) continue;
    let nx = zk.tileX + DX[d];
    let ny = zk.tileY + DY[d];
    if (nx < 0) nx = COLS - 1;
    else if (nx >= COLS) nx = 0;
    if (ny < 0 || ny >= ROWS) continue;
    const ni = ny * COLS + nx;
    if (visited[ni]) continue;
    visited[ni] = 1;
    firstDir[ni] = d;
    queue.push(ni);
  }

  let head = 0;
  let found = -1;
  while (head < queue.length) {
    const ci = queue[head++];
    const t = tiles[ci];
    if (t === TILE.DOT || t === TILE.PELLET) {
      found = ci;
      break;
    }
    const cx = ci % COLS;
    const cy = (ci - cx) / COLS;
    for (let d = 0; d < 4; d++) {
      let nx = cx + DX[d];
      let ny = cy + DY[d];
      if (nx < 0) nx = COLS - 1;
      else if (nx >= COLS) nx = 0;
      if (ny < 0 || ny >= ROWS) continue;
      const ni = ny * COLS + nx;
      if (visited[ni]) continue;
      const nt = tiles[ni];
      if (nt === TILE.WALL || nt === TILE.PEN_WALL || nt === TILE.PEN_GATE) continue;
      visited[ni] = 1;
      firstDir[ni] = firstDir[ci];
      queue.push(ni);
    }
  }

  if (found >= 0) {
    zk.nextDir = firstDir[found];
  } else {
    for (let d = 0; d < 4; d++) {
      if (canMoveZK(tiles, zk.tileX, zk.tileY, d)) { zk.nextDir = d; break; }
    }
  }
}
