// Zookeepers — Canvas2D rendering.
//
// Draws the maze, dots, power pellets, zookeeper sprites, animal sprites,
// HUD (score, lives, level), lobby, countdown, and game-over screens.
// All rendering uses the GameBoy 4-color palette at 320x240 logical pixels.

import { COLS, ROWS, TILE } from './maze.js';
import {
  LOGICAL_W, LOGICAL_H, TILE_SIZE, MAZE_X, MAZE_Y,
  C, DIR, DX, DY,
} from './state.js';

import { loadSprites } from '../../shared/spriteLoader.js';

// SVG asset imports
import zk1Frame0Url from './assets/zk1-frame-0.svg';
import zk1Frame1Url from './assets/zk1-frame-1.svg';
import zk1Frame2Url from './assets/zk1-frame-2.svg';
import zk1Frame3Url from './assets/zk1-frame-3.svg';
import zk2Frame0Url from './assets/zk2-frame-0.svg';
import zk2Frame1Url from './assets/zk2-frame-1.svg';
import zk2Frame2Url from './assets/zk2-frame-2.svg';
import zk2Frame3Url from './assets/zk2-frame-3.svg';
import apeNormalUrl from './assets/ape-normal.svg';
import rhinoNormalUrl from './assets/rhino-normal.svg';
import tigerNormalUrl from './assets/tiger-normal.svg';
import bearNormalUrl from './assets/bear-normal.svg';
import animalFrightUrl from './assets/animal-fright.svg';
import animalFrightBlinkUrl from './assets/animal-fright-blink.svg';
import animalEatenUrl from './assets/animal-eaten.svg';
import wallTileUrl from './assets/wall-tile.svg';
import penGateUrl from './assets/pen-gate.svg';
import pelletUrl from './assets/pellet.svg';
import fruitUrl from './assets/fruit.svg';

// ---- Sprite cache ------------------------------------------------------------

let sprites = null;

export async function initSprites() {
  sprites = await loadSprites({
    zk1f0: zk1Frame0Url, zk1f1: zk1Frame1Url, zk1f2: zk1Frame2Url, zk1f3: zk1Frame3Url,
    zk2f0: zk2Frame0Url, zk2f1: zk2Frame1Url, zk2f2: zk2Frame2Url, zk2f3: zk2Frame3Url,
    apeNormal: apeNormalUrl, rhinoNormal: rhinoNormalUrl,
    tigerNormal: tigerNormalUrl, bearNormal: bearNormalUrl,
    fright: animalFrightUrl, frightBlink: animalFrightBlinkUrl,
    eaten: animalEatenUrl,
    wallTile: wallTileUrl, penGate: penGateUrl,
    pellet: pelletUrl, fruit: fruitUrl,
  });
}

// ---- Public API --------------------------------------------------------------

export function render(ctx, state) {
  // Clear
  ctx.fillStyle = C.dark;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  switch (state.phase) {
    case 'lobby':
      drawLobby(ctx, state);
      break;
    case 'countdown':
      drawMaze(ctx, state);
      drawDots(ctx, state);
      drawAnimals(ctx, state);
      drawZookeepers(ctx, state);
      drawHUD(ctx, state);
      drawCountdown(ctx, state);
      break;
    case 'playing':
      drawMaze(ctx, state);
      drawDots(ctx, state);
      drawFruit(ctx, state);
      drawAnimals(ctx, state);
      drawZookeepers(ctx, state);
      drawHUD(ctx, state);
      break;
    case 'dying':
      drawMaze(ctx, state);
      drawDots(ctx, state);
      drawAnimals(ctx, state);
      drawZookeepers(ctx, state);
      drawHUD(ctx, state);
      break;
    case 'levelComplete':
      drawMaze(ctx, state);
      drawZookeepers(ctx, state);
      drawHUD(ctx, state);
      drawCenterText(ctx, 'LEVEL COMPLETE!');
      break;
    case 'over':
      drawMaze(ctx, state);
      drawHUD(ctx, state);
      drawGameOver(ctx, state);
      break;
    default:
      break;
  }
}

// ---- Maze --------------------------------------------------------------------

function drawMaze(ctx, state) {
  const tiles = state.tiles;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const t = tiles[row * COLS + col];
      const sx = MAZE_X + col * TILE_SIZE;
      const sy = MAZE_Y + row * TILE_SIZE;
      if (t === TILE.WALL || t === TILE.PEN_WALL) {
        if (sprites) {
          ctx.drawImage(sprites.wallTile, sx, sy, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = C.darkest;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        }
      }
      if (t === TILE.PEN_GATE) {
        if (sprites) {
          ctx.drawImage(sprites.penGate, sx, sy, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = C.light;
          const gy = sy + TILE_SIZE - 2;
          ctx.fillRect(sx, gy, TILE_SIZE, 2);
        }
      }
    }
  }
}

// ---- Dots & pellets ----------------------------------------------------------

function drawDots(ctx, state) {
  const tiles = state.tiles;
  const pelletOn = Math.floor(state.elapsed * 4) % 2 === 0; // pulse

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const t = tiles[row * COLS + col];
      const cx = MAZE_X + col * TILE_SIZE + TILE_SIZE / 2;
      const cy = MAZE_Y + row * TILE_SIZE + TILE_SIZE / 2;

      if (t === TILE.DOT) {
        ctx.fillStyle = C.lightest;
        ctx.fillRect(Math.floor(cx) - 0, Math.floor(cy) - 0, 1, 1);
      } else if (t === TILE.PELLET && pelletOn) {
        if (sprites) {
          const px = MAZE_X + col * TILE_SIZE;
          const py = MAZE_Y + row * TILE_SIZE;
          ctx.drawImage(sprites.pellet, px, py, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = C.lightest;
          ctx.fillRect(Math.floor(cx) - 1, Math.floor(cy) - 1, 3, 3);
        }
      }
    }
  }
}

// ---- Fruit -------------------------------------------------------------------

function drawFruit(ctx, state) {
  if (!state.fruitActive) return;
  if (sprites) {
    const fx = MAZE_X + state.fruitTileX * TILE_SIZE;
    const fy = MAZE_Y + state.fruitTileY * TILE_SIZE;
    ctx.drawImage(sprites.fruit, fx, fy, TILE_SIZE, TILE_SIZE);
  } else {
    const cx = MAZE_X + state.fruitTileX * TILE_SIZE + TILE_SIZE / 2;
    const cy = MAZE_Y + state.fruitTileY * TILE_SIZE + TILE_SIZE / 2;
    // Simple diamond shape
    ctx.fillStyle = C.lightest;
    ctx.fillRect(Math.floor(cx) - 1, Math.floor(cy) - 2, 3, 1);
    ctx.fillRect(Math.floor(cx) - 2, Math.floor(cy) - 1, 5, 1);
    ctx.fillRect(Math.floor(cx) - 2, Math.floor(cy),     5, 1);
    ctx.fillRect(Math.floor(cx) - 1, Math.floor(cy) + 1, 3, 1);
  }
}

// ---- Zookeepers --------------------------------------------------------------

function drawZookeepers(ctx, state) {
  for (const zk of state.zookeepers) {
    if (state.phase === 'dying' && state.dyingZookeeper === zk.index) {
      drawDyingZookeeper(ctx, zk, state);
      continue;
    }
    if (!zk.alive) continue;

    if (sprites) {
      // SVG sprite rendering
      const frame = zk.animFrame % 4;
      const spriteKey = `zk${zk.index + 1}f${frame}`;
      const img = sprites[spriteKey];
      const drawSize = TILE_SIZE + 2; // ~9px to match original ~7px diameter + margin
      const dx = MAZE_X + zk.x - drawSize / 2;
      const dy = MAZE_Y + zk.y - drawSize / 2;

      ctx.save();
      // SVGs face RIGHT; transform for other directions
      switch (zk.dir) {
        case DIR.LEFT:
          ctx.translate(MAZE_X + zk.x, MAZE_Y + zk.y);
          ctx.scale(-1, 1);
          ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
          break;
        case DIR.UP:
          ctx.translate(MAZE_X + zk.x, MAZE_Y + zk.y);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
          break;
        case DIR.DOWN:
          ctx.translate(MAZE_X + zk.x, MAZE_Y + zk.y);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
          break;
        default: // RIGHT or NONE
          ctx.drawImage(img, dx, dy, drawSize, drawSize);
          break;
      }
      ctx.restore();
    } else {
      // Procedural fallback
      const mouthAngles = [0, 15, 30, 15];
      const mouth = mouthAngles[zk.animFrame % 4];
      ctx.fillStyle = zk.index === 0 ? C.lightest : C.light;

      if (mouth === 0) {
        fillCircle(ctx, MAZE_X + zk.x, MAZE_Y + zk.y, 3);
      } else {
        drawPacShape(ctx, MAZE_X + zk.x, MAZE_Y + zk.y, 3, zk.dir, mouth, zk.index === 0 ? C.lightest : C.light);
      }

      if (zk.index === 1) {
        ctx.fillStyle = C.darkest;
        ctx.fillRect(Math.floor(MAZE_X + zk.x) - 2, Math.floor(MAZE_Y + zk.y) - 4, 5, 1);
      }
    }
  }
}

function drawDyingZookeeper(ctx, zk, state) {
  // Shrinking circle
  const t = state.dyingTimer / 1.5;
  const r = Math.max(0, Math.floor(3 * t));
  if (r > 0) {
    ctx.fillStyle = zk.index === 0 ? C.lightest : C.light;
    fillCircle(ctx, MAZE_X + zk.x, MAZE_Y + zk.y, r);
  }
}

function drawPacShape(ctx, cx, cy, r, dir, mouthDeg, color) {
  // Draw a filled circle minus a triangular mouth wedge
  // Simplified pixel approach: fill a circle, then cut out mouth with background
  ctx.fillStyle = color;
  fillCircle(ctx, cx, cy, r);

  // Cut out mouth — draw a triangle in the background color
  ctx.fillStyle = C.dark;
  const mouthSize = Math.floor(r * mouthDeg / 30);
  const floorCx = Math.floor(cx);
  const floorCy = Math.floor(cy);

  switch (dir) {
    case DIR.RIGHT:
      for (let i = 0; i <= mouthSize; i++) {
        ctx.fillRect(floorCx + r - i, floorCy - i, i + 1, 1);
        ctx.fillRect(floorCx + r - i, floorCy + i, i + 1, 1);
      }
      break;
    case DIR.LEFT:
      for (let i = 0; i <= mouthSize; i++) {
        ctx.fillRect(floorCx - r, floorCy - i, i + 1, 1);
        ctx.fillRect(floorCx - r, floorCy + i, i + 1, 1);
      }
      break;
    case DIR.DOWN:
      for (let i = 0; i <= mouthSize; i++) {
        ctx.fillRect(floorCx - i, floorCy + r - i, 1, i + 1);
        ctx.fillRect(floorCx + i, floorCy + r - i, 1, i + 1);
      }
      break;
    case DIR.UP:
      for (let i = 0; i <= mouthSize; i++) {
        ctx.fillRect(floorCx - i, floorCy - r, 1, i + 1);
        ctx.fillRect(floorCx + i, floorCy - r, 1, i + 1);
      }
      break;
    default:
      break;
  }
}

// ---- Animals -----------------------------------------------------------------

function drawAnimals(ctx, state) {
  for (const a of state.animals) {
    if (a.inPen && !a.released && state.phase === 'dying') continue;

    const ax = MAZE_X + a.x;
    const ay = MAZE_Y + a.y;

    if (sprites) {
      // SVG sprite rendering
      const drawSize = TILE_SIZE + 2; // match zookeeper sizing
      const dx = ax - drawSize / 2;
      const dy = ay - drawSize / 2;
      let img;

      if (a.mode === 'eaten') {
        img = sprites.eaten;
      } else if (a.mode === 'frightened') {
        const blinking = state.frightTimer < 2 && Math.floor(a.frightBlinkTimer * 6) % 2 === 1;
        img = blinking ? sprites.frightBlink : sprites.fright;
      } else {
        // Normal mode — type-specific sprite
        img = sprites[`${a.type}Normal`];
      }

      if (img) {
        ctx.drawImage(img, dx, dy, drawSize, drawSize);
      }
    } else {
      // Procedural fallback
      if (a.mode === 'eaten') {
        drawEyes(ctx, ax, ay, a.dir);
        continue;
      }

      if (a.mode === 'frightened') {
        const blinking = state.frightTimer < 2 && Math.floor(a.frightBlinkTimer * 6) % 2 === 1;
        ctx.fillStyle = blinking ? C.dark : C.lightest;
        fillGhostBody(ctx, ax, ay);
        drawFrightenedFace(ctx, ax, ay, blinking);
        continue;
      }

      ctx.fillStyle = C.light;
      drawAnimalBody(ctx, ax, ay, a);
      drawEyes(ctx, ax, ay, a.dir);
    }
  }
}

function drawAnimalBody(ctx, cx, cy, animal) {
  // Base ghost-like body
  fillGhostBody(ctx, cx, cy);

  // Type-specific details
  const floorX = Math.floor(cx);
  const floorY = Math.floor(cy);

  switch (animal.type) {
    case 'ape':
      // Ear bumps
      ctx.fillRect(floorX - 3, floorY - 4, 2, 1);
      ctx.fillRect(floorX + 2, floorY - 4, 2, 1);
      break;
    case 'rhino':
      // Horn on facing side
      {
        const hx = animal.dir === DIR.LEFT ? floorX - 4 : floorX + 3;
        ctx.fillRect(hx, floorY - 1, 2, 2);
      }
      break;
    case 'tiger':
      // Horizontal stripe lines
      ctx.fillStyle = C.darkest;
      ctx.fillRect(floorX - 2, floorY - 1, 5, 1);
      ctx.fillRect(floorX - 2, floorY + 1, 5, 1);
      ctx.fillStyle = C.light;
      break;
    case 'bear':
      // Slightly larger body (extra pixel on each side)
      ctx.fillRect(floorX - 4, floorY - 1, 1, 3);
      ctx.fillRect(floorX + 3, floorY - 1, 1, 3);
      break;
    default:
      break;
  }
}

function fillGhostBody(ctx, cx, cy) {
  const x = Math.floor(cx);
  const y = Math.floor(cy);
  // Classic ghost shape: rounded top, wavy bottom
  //   xxx
  //  xxxxx
  //  xxxxx
  //  xxxxx
  //  x x x
  ctx.fillRect(x - 1, y - 3, 3, 1);
  ctx.fillRect(x - 2, y - 2, 5, 1);
  ctx.fillRect(x - 3, y - 1, 7, 1);
  ctx.fillRect(x - 3, y,     7, 1);
  ctx.fillRect(x - 3, y + 1, 7, 1);
  ctx.fillRect(x - 3, y + 2, 7, 1);
  // Wavy bottom
  ctx.fillRect(x - 3, y + 3, 2, 1);
  ctx.fillRect(x - 0, y + 3, 1, 1);
  ctx.fillRect(x + 2, y + 3, 2, 1);
}

function drawEyes(ctx, cx, cy, dir) {
  const x = Math.floor(cx);
  const y = Math.floor(cy);
  // White part
  ctx.fillStyle = C.lightest;
  ctx.fillRect(x - 2, y - 2, 2, 2);
  ctx.fillRect(x + 1, y - 2, 2, 2);
  // Pupil (direction-dependent)
  ctx.fillStyle = C.darkest;
  let px = 0, py = 0;
  if (dir === DIR.LEFT)  { px = -1; }
  if (dir === DIR.RIGHT) { px = 1; }
  if (dir === DIR.UP)    { py = -1; }
  if (dir === DIR.DOWN)  { py = 1; }
  ctx.fillRect(x - 2 + px, y - 2 + py, 1, 1);
  ctx.fillRect(x + 1 + px, y - 2 + py, 1, 1);
}

function drawFrightenedFace(ctx, cx, cy, blinking) {
  const x = Math.floor(cx);
  const y = Math.floor(cy);
  const color = blinking ? C.lightest : C.darkest;
  ctx.fillStyle = color;
  // Simple worried expression: two dots for eyes, zigzag mouth
  ctx.fillRect(x - 1, y - 2, 1, 1);
  ctx.fillRect(x + 1, y - 2, 1, 1);
  // Zigzag mouth
  ctx.fillRect(x - 2, y + 1, 1, 1);
  ctx.fillRect(x - 1, y + 2, 1, 1);
  ctx.fillRect(x,     y + 1, 1, 1);
  ctx.fillRect(x + 1, y + 2, 1, 1);
  ctx.fillRect(x + 2, y + 1, 1, 1);
}

// ---- HUD ---------------------------------------------------------------------

function drawHUD(ctx, state) {
  ctx.fillStyle = C.lightest;
  ctx.font = '5px monospace';
  ctx.textBaseline = 'top';

  // Score (top-left of maze area)
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE ${state.score}`, MAZE_X, 0);

  // Level (top-right of maze area)
  ctx.textAlign = 'right';
  ctx.fillText(`LVL ${state.level}`, MAZE_X + MAZE_X + COLS * TILE_SIZE, 0);

  // Lives (left margin, below maze)
  ctx.textAlign = 'left';
  for (let i = 0; i < state.lives; i++) {
    const lx = 4 + i * 10;
    const ly = LOGICAL_H - 8;
    ctx.fillStyle = C.lightest;
    fillCircle(ctx, lx + 3, ly + 3, 2);
  }
}

// ---- Lobby -------------------------------------------------------------------

function drawLobby(ctx, state) {
  ctx.fillStyle = C.lightest;
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText('ZOOKEEPERS', LOGICAL_W / 2, 20);

  ctx.font = '5px monospace';
  ctx.fillText('A co-op maze chase', LOGICAL_W / 2, 32);

  // Slot display
  const labels = ['KEEPER 1', 'KEEPER 2', 'ANIMAL 1', 'ANIMAL 2'];
  const slotY = [60, 60, 110, 110];
  const slotX = [LOGICAL_W / 2 - 55, LOGICAL_W / 2 + 55, LOGICAL_W / 2 - 55, LOGICAL_W / 2 + 55];

  ctx.font = '5px monospace';
  for (let i = 0; i < 4; i++) {
    const x = slotX[i];
    const y = slotY[i];
    ctx.fillStyle = C.light;
    ctx.fillText(labels[i], x, y);

    const slot = state.lobby.slots[i];
    ctx.fillStyle = C.lightest;
    if (slot === 'ai') {
      ctx.fillText('[AI]', x, y + 12);
    } else if (slot) {
      ctx.fillText('[PLAYER]', x, y + 12);
    } else {
      ctx.fillStyle = C.dark;
      ctx.fillText('[EMPTY]', x, y + 12);
    }
  }

  // Divider labels
  ctx.fillStyle = C.light;
  ctx.fillText('--- ZOOKEEPERS ---', LOGICAL_W / 2, 48);
  ctx.fillText('--- ANIMALS ---', LOGICAL_W / 2, 98);

  // Instructions
  ctx.fillStyle = C.lightest;
  ctx.font = '4px monospace';
  ctx.fillText('F: FILL AI   ENTER: START', LOGICAL_W / 2, 145);
  ctx.fillText('Share room code for online play', LOGICAL_W / 2, 158);

  // Zookeeper sprite preview
  if (sprites) {
    const previewSize = 9;
    ctx.drawImage(sprites.zk1f2, LOGICAL_W / 2 - 55 - previewSize / 2, 80 - previewSize / 2, previewSize, previewSize);
    ctx.drawImage(sprites.zk2f2, LOGICAL_W / 2 + 55 - previewSize / 2, 80 - previewSize / 2, previewSize, previewSize);
  } else {
    ctx.fillStyle = C.lightest;
    fillCircle(ctx, LOGICAL_W / 2 - 55, 80, 4);
    ctx.fillStyle = C.light;
    fillCircle(ctx, LOGICAL_W / 2 + 55, 80, 4);
  }

  // Animal sprite previews
  if (sprites) {
    const previewSize = 9;
    ctx.drawImage(sprites.apeNormal, LOGICAL_W / 2 - 55 - previewSize / 2, 130 - previewSize / 2, previewSize, previewSize);
    ctx.drawImage(sprites.rhinoNormal, LOGICAL_W / 2 + 55 - previewSize / 2, 130 - previewSize / 2, previewSize, previewSize);
  } else {
    ctx.fillStyle = C.light;
    fillGhostBody(ctx, LOGICAL_W / 2 - 55, 130);
    fillGhostBody(ctx, LOGICAL_W / 2 + 55, 130);
  }
}

// ---- Countdown ---------------------------------------------------------------

function drawCountdown(ctx, state) {
  const num = Math.ceil(state.countdownTimer);
  const text = num > 0 ? `${num}` : 'GO!';
  drawCenterText(ctx, text);
}

// ---- Game over ---------------------------------------------------------------

function drawGameOver(ctx, state) {
  drawCenterText(ctx, 'GAME OVER');
  ctx.fillStyle = C.light;
  ctx.font = '5px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`FINAL SCORE: ${state.score}`, LOGICAL_W / 2, LOGICAL_H / 2 + 12);
  ctx.fillText('ENTER TO RESTART', LOGICAL_W / 2, LOGICAL_H / 2 + 24);
}

// ---- Helpers -----------------------------------------------------------------

function drawCenterText(ctx, text) {
  ctx.fillStyle = C.lightest;
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, LOGICAL_W / 2, LOGICAL_H / 2);
}

function fillCircle(ctx, cx, cy, r) {
  // Pixel-art circle via midpoint algorithm approximation
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -r; dy <= r; dy++) {
    const halfW = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(x0 - halfW, y0 + dy, halfW * 2 + 1, 1);
  }
}
