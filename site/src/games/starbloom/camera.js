// Starbloom — camera viewport and cursor management.
//
// Supports both keyboard cursor movement and mouse-driven camera:
//   - WASD moves cursor
//   - Mouse near viewport edges scrolls camera
//   - Mouse click sets cursor to tile under pointer

import { TILE_SIZE, MAP_W, MAP_H, VP_W, VP_H, VP_X, VP_Y, SCALE } from './state.js';

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Cursor movement speed
const CURSOR_SPEED = 12;
const CURSOR_REPEAT_DELAY = 0.18;
const CURSOR_REPEAT_RATE = 0.06;

// Edge scroll settings
const EDGE_MARGIN = 8;          // logical pixels from viewport edge
const EDGE_SCROLL_SPEED = 100;  // pixels per second

export function updateCursor(player, keys, dt, cursorState) {
  const dirs = ['up', 'down', 'left', 'right'];
  const dxMap = { up: 0, down: 0, left: -1, right: 1 };
  const dyMap = { up: -1, down: 1, left: 0, right: 0 };

  for (const d of dirs) {
    if (keys[d]) {
      cursorState.holdTime[d] += dt;
      if (cursorState.holdTime[d] >= CURSOR_REPEAT_DELAY) {
        cursorState.repeatTimer[d] += dt;
        if (cursorState.repeatTimer[d] >= CURSOR_REPEAT_RATE) {
          cursorState.repeatTimer[d] -= CURSOR_REPEAT_RATE;
          player.cursorTx = clamp(player.cursorTx + dxMap[d], 0, MAP_W - 1);
          player.cursorTy = clamp(player.cursorTy + dyMap[d], 0, MAP_H - 1);
        }
      } else if (cursorState.justPressed[d]) {
        player.cursorTx = clamp(player.cursorTx + dxMap[d], 0, MAP_W - 1);
        player.cursorTy = clamp(player.cursorTy + dyMap[d], 0, MAP_H - 1);
        cursorState.justPressed[d] = false;
      }
    } else {
      if (cursorState.holdTime[d] > 0) {
        cursorState.holdTime[d] = 0;
        cursorState.repeatTimer[d] = 0;
        cursorState.justPressed[d] = true;
      }
    }
  }
}

export function makeCursorState() {
  return {
    holdTime: { up: 0, down: 0, left: 0, right: 0 },
    repeatTimer: { up: 0, down: 0, left: 0, right: 0 },
    justPressed: { up: true, down: true, left: true, right: true },
  };
}

export function cursorKeyDown(cursorState, dir) {
  cursorState.holdTime[dir] = 0;
  cursorState.repeatTimer[dir] = 0;
  cursorState.justPressed[dir] = true;
}

export function updateCamera(player, dt) {
  // Camera smoothly follows cursor, clamped to map bounds
  const targetX = player.cursorTx * TILE_SIZE - VP_W / 2;
  const targetY = player.cursorTy * TILE_SIZE - VP_H / 2;
  const maxX = MAP_W * TILE_SIZE - VP_W;
  const maxY = MAP_H * TILE_SIZE - VP_H;

  const cx = clamp(targetX, 0, maxX);
  const cy = clamp(targetY, 0, maxY);

  player.cameraX += (cx - player.cameraX) * Math.min(1, 6 * dt);
  player.cameraY += (cy - player.cameraY) * Math.min(1, 6 * dt);
  player.cameraX = clamp(player.cameraX, 0, maxX);
  player.cameraY = clamp(player.cameraY, 0, maxY);
}

// Edge-scroll camera based on mouse position (logical coords).
// Returns true if edge-scrolling is active.
export function updateEdgeScroll(player, mouseLogX, mouseLogY, dt) {
  if (mouseLogX < 0 || mouseLogY < 0) return false;

  const maxX = MAP_W * TILE_SIZE - VP_W;
  const maxY = MAP_H * TILE_SIZE - VP_H;
  let scrolling = false;

  // Only edge-scroll when mouse is in the viewport area
  if (mouseLogY >= VP_Y && mouseLogY <= VP_Y + VP_H) {
    if (mouseLogX < VP_X + EDGE_MARGIN) {
      player.cameraX -= EDGE_SCROLL_SPEED * dt;
      scrolling = true;
    } else if (mouseLogX > VP_X + VP_W - EDGE_MARGIN) {
      player.cameraX += EDGE_SCROLL_SPEED * dt;
      scrolling = true;
    }
  }
  if (mouseLogX >= VP_X && mouseLogX <= VP_X + VP_W) {
    if (mouseLogY < VP_Y + EDGE_MARGIN && mouseLogY >= VP_Y) {
      player.cameraY -= EDGE_SCROLL_SPEED * dt;
      scrolling = true;
    } else if (mouseLogY > VP_Y + VP_H - EDGE_MARGIN && mouseLogY <= VP_Y + VP_H) {
      player.cameraY += EDGE_SCROLL_SPEED * dt;
      scrolling = true;
    }
  }

  player.cameraX = clamp(player.cameraX, 0, maxX);
  player.cameraY = clamp(player.cameraY, 0, maxY);
  return scrolling;
}

// Convert canvas pixel coords to logical coords
export function canvasToLogical(canvasX, canvasY) {
  return {
    lx: canvasX / SCALE,
    ly: canvasY / SCALE,
  };
}

// Convert logical viewport coords to tile coords
export function screenToTile(logX, logY, cameraX, cameraY) {
  const worldX = logX - VP_X + cameraX;
  const worldY = logY - VP_Y + cameraY;
  return {
    tx: Math.floor(worldX / TILE_SIZE),
    ty: Math.floor(worldY / TILE_SIZE),
  };
}

// Check if logical coords are inside the viewport
export function isInViewport(logX, logY) {
  return logX >= VP_X && logX <= VP_X + VP_W &&
         logY >= VP_Y && logY <= VP_Y + VP_H;
}
