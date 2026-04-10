// Starbloom — all Canvas2D rendering: tiles, entities, HUD, minimap, effects.
// Renders at 320x240 logical resolution with fog of war and clickable command bar.

import {
  C, LOGICAL_W, LOGICAL_H, TILE_SIZE, MAP_W, MAP_H,
  VP_X, VP_Y, VP_W, VP_H, HUD_TOP_H, HUD_BOT_H,
  MINIMAP_X, MINIMAP_Y, MINIMAP_W, MINIMAP_H,
  CMD_BAR_X, CMD_BAR_Y, CMD_BAR_W, CMD_BAR_H,
  TICKS_PER_SEC,
} from './state.js';
import { TILE } from './map.js';
import { BUILDING_DEFS, UNIT_DEFS, BUILD_ORDER, TRAIN_TABLE, findEntity } from './entities.js';
import { UPGRADES } from './state.js';
import { FOG, getFog } from './fog.js';

// ---- Command bar button definitions -----------------------------------------

const BTN_W = 52;
const BTN_H = 14;
const BTN_GAP = 2;

// Row 1: main commands
const ROW1_Y = CMD_BAR_Y + 2;

export const CMD_BUTTONS = [
  { id: 'gather_f', label: 'GATHER F', x: CMD_BAR_X + 2,                        y: ROW1_Y, w: BTN_W, h: BTN_H },
  { id: 'gather_g', label: 'GATHER G', x: CMD_BAR_X + 2 + (BTN_W + BTN_GAP),    y: ROW1_Y, w: BTN_W, h: BTN_H },
  { id: 'build',    label: 'BUILD',    x: CMD_BAR_X + 2 + (BTN_W + BTN_GAP) * 2, y: ROW1_Y, w: BTN_W, h: BTN_H },
  { id: 'attack',   label: 'ATTACK',   x: CMD_BAR_X + 2 + (BTN_W + BTN_GAP) * 3, y: ROW1_Y, w: BTN_W, h: BTN_H },
  { id: 'train',    label: 'TRAIN',    x: CMD_BAR_X + 2 + (BTN_W + BTN_GAP) * 4, y: ROW1_Y, w: BTN_W, h: BTN_H },
];

// Row 2: sub-option buttons (generated dynamically per commandMode)
const ROW2_Y = CMD_BAR_Y + 18;

const SUB_BTN_W = 43;  // narrower to fit 6 items in CMD_BAR_W
const BUILD_SUB_BUTTONS = BUILD_ORDER.map((bt, i) => ({
  id: 'build_' + bt,
  label: bt.toUpperCase().slice(0, 6),
  x: CMD_BAR_X + 2 + (SUB_BTN_W + BTN_GAP) * i,
  y: ROW2_Y,
  w: SUB_BTN_W,
  h: BTN_H,
}));

const TRAIN_UNITS = ['sprout', 'bonker', 'lobber', 'stomper', 'mender'];
const TRAIN_SUB_BUTTONS = TRAIN_UNITS.map((ut, i) => ({
  id: 'train_' + ut,
  label: ut.toUpperCase(),
  x: CMD_BAR_X + 2 + (BTN_W + BTN_GAP) * i,
  y: ROW2_Y,
  w: BTN_W,
  h: BTN_H,
}));

export function getSubButtons(commandMode) {
  if (commandMode === 'build') return BUILD_SUB_BUTTONS;
  if (commandMode === 'train') return TRAIN_SUB_BUTTONS;
  return [];
}

export function getButtonAtLogical(lx, ly, commandMode) {
  // Check row 1
  for (const btn of CMD_BUTTONS) {
    if (lx >= btn.x && lx < btn.x + btn.w && ly >= btn.y && ly < btn.y + btn.h) {
      return btn.id;
    }
  }
  // Check row 2 sub-buttons
  const subs = getSubButtons(commandMode);
  for (const btn of subs) {
    if (lx >= btn.x && lx < btn.x + btn.w && ly >= btn.y && ly < btn.y + btn.h) {
      return btn.id;
    }
  }
  return null;
}

// ---- Main draw entry --------------------------------------------------------

export function draw(ctx, state, localPlayerIdx, blinkPhase) {
  const p = state.players[localPlayerIdx];
  const teamIdx = p.team;
  const fog = state.fog[teamIdx];

  // Clear
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Draw viewport contents (clipped to viewport area)
  const camX = p.cameraX;
  const camY = p.cameraY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(VP_X, VP_Y, VP_W, VP_H);
  ctx.clip();

  drawTiles(ctx, state, camX, camY, fog);
  drawBuildings(ctx, state, camX, camY, localPlayerIdx, blinkPhase, fog, teamIdx);
  drawUnits(ctx, state, camX, camY, localPlayerIdx, blinkPhase, fog, teamIdx);
  drawCursor(ctx, p, camX, camY, blinkPhase, state);
  drawParticles(ctx, state, camX, camY);
  drawEvents(ctx, state, camX, camY);

  ctx.restore();

  // HUD bars drawn on top
  drawTopHUD(ctx, state, localPlayerIdx);
  drawBottomBar(ctx, state, localPlayerIdx, blinkPhase);

  // Wonder pulse ring
  if (state.phase === 'wonder') {
    const wonder = state.buildings.find(b => b.type === 'starbloom' && b.built);
    if (wonder) {
      // Only show if visible to local team
      const wFog = getFog(fog, wonder.tx + 1, wonder.ty + 1);
      if (wFog === FOG.VISIBLE) {
        const wx = wonder.tx * TILE_SIZE + TILE_SIZE * 1.5 - camX + VP_X;
        const wy = wonder.ty * TILE_SIZE + TILE_SIZE * 1.5 - camY + VP_Y;
        const pulseR = ((state.tick % 90) / 90) * 16;
        ctx.strokeStyle = C.lightest;
        ctx.globalAlpha = 1 - pulseR / 16;
        ctx.beginPath();
        ctx.arc(wx, wy, pulseR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
}

// ---- Menu / Over screens ----------------------------------------------------

export function drawMenu(ctx, state, blinkPhase, statusText) {
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.fillStyle = C.lightest;
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STARBLOOM', LOGICAL_W / 2, 60);

  ctx.fillStyle = C.light;
  ctx.font = '5px monospace';
  ctx.fillText('Two civilizations race to bloom', LOGICAL_W / 2, 80);

  ctx.fillStyle = blinkPhase ? C.lightest : C.light;
  ctx.fillText(statusText || 'Click to Start', LOGICAL_W / 2, 130);

  ctx.fillStyle = C.dark;
  ctx.fillText('[D] Difficulty: ' + (state.difficulty || 'medium').toUpperCase(), LOGICAL_W / 2, 160);
  ctx.fillText('WASD=Move  SPACE=Select  E=Cancel', LOGICAL_W / 2, 180);
  ctx.fillText('1-4=Commands  Q=Cycle  S=Share  R=Request', LOGICAL_W / 2, 192);
}

export function drawGameOver(ctx, state, blinkPhase) {
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.fillStyle = C.lightest;
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const teamName = state.winTeam === 0 ? 'BLOOPS' : 'ZIPS';
  ctx.fillText(teamName + ' WIN!', LOGICAL_W / 2, 80);

  if (state.buildings.some(b => b.type === 'starbloom' && b.built)) {
    ctx.fillStyle = C.light;
    ctx.font = '5px monospace';
    ctx.fillText('THE STARBLOOM HAS BLOOMED', LOGICAL_W / 2, 110);
  }

  ctx.fillStyle = blinkPhase ? C.lightest : C.light;
  ctx.font = '5px monospace';
  ctx.fillText('Click to Play Again', LOGICAL_W / 2, 150);
}

// ---- Tiles ------------------------------------------------------------------

function drawTiles(ctx, state, camX, camY, fog) {
  const startTx = Math.max(0, Math.floor(camX / TILE_SIZE));
  const startTy = Math.max(0, Math.floor(camY / TILE_SIZE));
  const endTx = Math.min(MAP_W, startTx + Math.ceil(VP_W / TILE_SIZE) + 1);
  const endTy = Math.min(MAP_H, startTy + Math.ceil(VP_H / TILE_SIZE) + 1);

  for (let ty = startTy; ty < endTy; ty++) {
    for (let tx = startTx; tx < endTx; tx++) {
      const fogLevel = getFog(fog, tx, ty);
      const sx = tx * TILE_SIZE - camX + VP_X;
      const sy = ty * TILE_SIZE - camY + VP_Y;

      // UNEXPLORED: draw darkest and skip
      if (fogLevel === FOG.UNEXPLORED) {
        ctx.fillStyle = C.darkest;
        ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        continue;
      }

      // Draw terrain (EXPLORED or VISIBLE)
      const tile = state.map.getTile(tx, ty);
      switch (tile) {
        case TILE.GRASS:
          ctx.fillStyle = C.lightest;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          // Texture dots
          if ((tx + ty * 7) % 11 === 0) {
            ctx.fillStyle = C.light;
            ctx.fillRect(sx + 3, sy + 3, 1, 1);
          }
          break;
        case TILE.FOREST:
          ctx.fillStyle = C.dark;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          // Tree canopy
          ctx.fillStyle = C.light;
          ctx.fillRect(sx + 2, sy + 1, 4, 3);
          ctx.fillStyle = C.darkest;
          ctx.fillRect(sx + 3, sy + 5, 2, 2);
          break;
        case TILE.ROCK:
          ctx.fillStyle = C.light;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          // Ore dots
          ctx.fillStyle = C.darkest;
          ctx.fillRect(sx + 1, sy + 2, 2, 2);
          ctx.fillRect(sx + 5, sy + 4, 2, 2);
          break;
        case TILE.WATER:
          ctx.fillStyle = C.darkest;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          // Wave pattern
          ctx.fillStyle = C.dark;
          const waveOff = (state.tick * 0.1 + tx) % 6;
          ctx.fillRect(sx + waveOff, sy + 3, 2, 1);
          break;
        case TILE.BUILT:
          ctx.fillStyle = C.lightest;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          break;
      }

      // Territory indicator: dot near friendly buildings (only if VISIBLE)
      if (fogLevel === FOG.VISIBLE && (tile === TILE.GRASS || tile === TILE.BUILT)) {
        for (const b of state.buildings) {
          if (b.built && Math.abs(b.tx - tx) <= 4 && Math.abs(b.ty - ty) <= 4) {
            const team = state.players[b.owner].team;
            ctx.fillStyle = team === 0 ? C.light : C.dark;
            if ((tx + ty) % 3 === 0) {
              ctx.fillRect(sx + 1, sy + 1, 1, 1);
            }
            break;
          }
        }
      }

      // EXPLORED overlay: darken the terrain with a semi-transparent layer
      if (fogLevel === FOG.EXPLORED) {
        ctx.fillStyle = C.darkest;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        ctx.globalAlpha = 1;
      }
    }
  }
}

// ---- Buildings --------------------------------------------------------------

function drawBuildings(ctx, state, camX, camY, localPlayerIdx, blinkPhase, fog, localTeam) {
  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    const sx = b.tx * TILE_SIZE - camX + VP_X;
    const sy = b.ty * TILE_SIZE - camY + VP_Y;
    const w = def.size * TILE_SIZE;
    const h = def.size * TILE_SIZE;

    // Off-screen cull
    if (sx + w < 0 || sx > VP_W || sy + h < VP_Y - 8 || sy > VP_Y + VP_H) continue;

    const bTeam = state.players[b.owner].team;

    // Fog check: enemy buildings only drawn if any of their tiles are VISIBLE
    if (bTeam !== localTeam) {
      let anyVisible = false;
      for (let dy = 0; dy < def.size && !anyVisible; dy++) {
        for (let dx = 0; dx < def.size && !anyVisible; dx++) {
          if (getFog(fog, b.tx + dx, b.ty + dy) === FOG.VISIBLE) {
            anyVisible = true;
          }
        }
      }
      if (!anyVisible) continue;
    }

    const isSelected = state.players[localPlayerIdx].selectedId === b.id;

    if (!b.built) {
      // Under construction: dashed outline + progress fill
      ctx.strokeStyle = bTeam === 0 ? C.lightest : C.dark;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
      // Progress fill
      const progress = b.buildProgress / b.buildTime;
      ctx.fillStyle = bTeam === 0 ? C.light : C.dark;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(sx + 1, sy + h - 3, (w - 2) * progress, 2);
      ctx.globalAlpha = 1;
    } else {
      // Damage flash
      if (b.flashTimer > 0) {
        ctx.fillStyle = C.lightest;
        ctx.fillRect(sx, sy, w, h);
      } else {
        drawBuildingSprite(ctx, b, sx, sy, w, h, bTeam, blinkPhase);
      }
    }

    // HP bar (if damaged)
    if (b.built && b.hp < b.maxHp) {
      const ratio = b.hp / b.maxHp;
      ctx.fillStyle = C.darkest;
      ctx.fillRect(sx, sy - 3, w, 2);
      ctx.fillStyle = ratio > 0.5 ? C.light : C.lightest;
      ctx.fillRect(sx, sy - 3, w * ratio, 2);
    }

    // Selection highlight
    if (isSelected) {
      ctx.strokeStyle = blinkPhase ? C.lightest : C.light;
      ctx.strokeRect(sx - 1, sy - 1, w + 2, h + 2);
    }

    // Training progress bar
    if (b.trainType && b.built) {
      const ratio = b.trainProgress / b.trainTime;
      ctx.fillStyle = C.darkest;
      ctx.fillRect(sx, sy + h + 1, w, 2);
      ctx.fillStyle = C.lightest;
      ctx.fillRect(sx, sy + h + 1, w * ratio, 2);
    }
  }
}

function drawBuildingSprite(ctx, b, sx, sy, w, h, team, blinkPhase) {
  const fill = team === 0 ? C.lightest : C.dark;
  const outline = team === 0 ? C.darkest : C.lightest;
  const pulse = blinkPhase && (b.type === 'starbloom');

  ctx.fillStyle = fill;
  ctx.fillRect(sx + 1, sy + 1, w - 2, h - 2);
  ctx.strokeStyle = pulse ? C.lightest : outline;
  ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);

  // Type-specific details
  ctx.fillStyle = outline;
  switch (b.type) {
    case 'nest':
      // Door notch
      ctx.fillRect(sx + w / 2 - 2, sy + h - 3, 4, 3);
      // Window
      ctx.fillRect(sx + 3, sy + 3, 2, 2);
      ctx.fillRect(sx + w - 5, sy + 3, 2, 2);
      break;
    case 'depot':
      // Open-top box
      ctx.clearRect(sx + 2, sy, 4, 2);
      ctx.fillStyle = fill;
      ctx.fillRect(sx + 2, sy, 4, 2);
      break;
    case 'barracks':
      // Crossed lines (swords emblem)
      ctx.beginPath();
      ctx.moveTo(sx + 3, sy + 3);
      ctx.lineTo(sx + w - 3, sy + h - 3);
      ctx.moveTo(sx + w - 3, sy + 3);
      ctx.lineTo(sx + 3, sy + h - 3);
      ctx.strokeStyle = outline;
      ctx.stroke();
      break;
    case 'tower':
      // Tall rectangle with dot on top
      ctx.fillRect(sx + 2, sy, 4, 2);
      ctx.fillStyle = C.lightest;
      ctx.fillRect(sx + 3, sy - 1, 2, 2);
      break;
    case 'wall':
      // Solid block, darker
      ctx.fillStyle = C.dark;
      ctx.fillRect(sx, sy, w, h);
      break;
    case 'academy':
      // Book marking
      ctx.fillRect(sx + 4, sy + 3, 1, h - 6);
      ctx.fillRect(sx + w - 5, sy + 3, 1, h - 6);
      ctx.fillRect(sx + 4, sy + h / 2, w - 8, 1);
      break;
    case 'starbloom':
      // Star/pyramid shape
      ctx.fillStyle = pulse ? C.lightest : C.light;
      const cx = sx + w / 2;
      const cy = sy + h / 2;
      // Diamond
      ctx.beginPath();
      ctx.moveTo(cx, sy + 2);
      ctx.lineTo(sx + w - 2, cy);
      ctx.lineTo(cx, sy + h - 2);
      ctx.lineTo(sx + 2, cy);
      ctx.closePath();
      ctx.fill();
      // Center dot
      ctx.fillStyle = C.darkest;
      ctx.fillRect(cx - 1, cy - 1, 3, 3);
      break;
  }
}

// ---- Units ------------------------------------------------------------------

function drawUnits(ctx, state, camX, camY, localPlayerIdx, blinkPhase, fog, localTeam) {
  for (const u of state.units) {
    const uTeam = state.players[u.owner].team;

    // Fog check: enemy units only drawn if their tile is VISIBLE
    if (uTeam !== localTeam) {
      if (getFog(fog, u.tx, u.ty) !== FOG.VISIBLE) continue;
    }

    const sx = u.px - camX + VP_X;
    const sy = u.py - camY + VP_Y;

    // Off-screen cull
    if (sx < VP_X - 4 || sx > VP_X + VP_W + 4 || sy < VP_Y - 4 || sy > VP_Y + VP_H + 4) continue;

    const isSelected = state.players[localPlayerIdx].selectedId === u.id;

    // Damage flash
    if (u.flashTimer > 0) {
      ctx.fillStyle = C.lightest;
      ctx.fillRect(sx - 3, sy - 3, 6, 6);
      continue;
    }

    // Dizzy wobble
    let offsetX = 0;
    if (u.dizzyTimer > 0) {
      offsetX = Math.sin(u.dizzyTimer * 30) * 2;
    }

    // Idle animation: Bloops bounce, Zips vibrate
    let animY = 0, animX = 0;
    if (u.state === 'idle') {
      if (uTeam === 0) {
        animY = Math.sin(state.tick * 0.15 + u.id) * 1;
      } else {
        animX = Math.sin(state.tick * 0.3 + u.id) * 0.5;
      }
    }

    const dx = sx + offsetX + animX;
    const dy = sy + animY;

    drawUnitSprite(ctx, u, dx, dy, uTeam, state);

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = blinkPhase ? C.lightest : C.light;
      ctx.strokeRect(dx - 4, dy - 4, 8, 8);
    }

    // HP bar (if damaged)
    if (u.hp < u.maxHp) {
      const ratio = u.hp / u.maxHp;
      ctx.fillStyle = C.darkest;
      ctx.fillRect(dx - 4, dy - 6, 8, 1);
      ctx.fillStyle = ratio > 0.5 ? C.light : C.lightest;
      ctx.fillRect(dx - 4, dy - 6, 8 * ratio, 1);
    }

    // Carry indicator
    if (u.carryAmt > 0) {
      ctx.fillStyle = u.carryType === 'food' ? C.dark : C.lightest;
      ctx.fillRect(dx + 2, dy - 2, 2, 2);
    }
  }
}

function drawUnitSprite(ctx, unit, x, y, team, state) {
  const fill = team === 0 ? C.lightest : C.dark;
  const outline = team === 0 ? C.darkest : C.lightest;

  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;

  switch (unit.type) {
    case 'sprout':
      // Small circle
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'bonker':
      // Square
      ctx.fillRect(x - 2, y - 2, 5, 5);
      ctx.strokeRect(x - 2, y - 2, 5, 5);
      break;
    case 'lobber':
      // Triangle
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y + 2);
      ctx.lineTo(x - 3, y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'stomper':
      // Large filled square
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.strokeRect(x - 3, y - 3, 6, 6);
      // Inner detail
      ctx.fillStyle = outline;
      ctx.fillRect(x - 1, y - 1, 2, 2);
      break;
    case 'mender':
      // Cross/plus
      ctx.fillRect(x - 1, y - 3, 2, 6);
      ctx.fillRect(x - 3, y - 1, 6, 2);
      break;
  }

  // Eye dot (shifts toward movement direction)
  ctx.fillStyle = outline;
  let eyeX = 0, eyeY = 0;
  if (unit.path && unit.pathIdx < unit.path.length) {
    const [ntx, nty] = unit.path[unit.pathIdx];
    const dpx = ntx * TILE_SIZE + TILE_SIZE / 2 - unit.px;
    const dpy = nty * TILE_SIZE + TILE_SIZE / 2 - unit.py;
    const len = Math.sqrt(dpx * dpx + dpy * dpy) || 1;
    eyeX = Math.round(dpx / len);
    eyeY = Math.round(dpy / len);
  }
  ctx.fillRect(x + eyeX, y + eyeY - 1, 1, 1);
}

// ---- Cursor -----------------------------------------------------------------

function drawCursor(ctx, p, camX, camY, blinkPhase, state) {
  // Keyboard cursor (dashed rect)
  const sx = p.cursorTx * TILE_SIZE - camX + VP_X;
  const sy = p.cursorTy * TILE_SIZE - camY + VP_Y;

  ctx.strokeStyle = blinkPhase ? C.lightest : C.dark;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 1]);
  ctx.strokeRect(sx + 0.5, sy + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
  ctx.setLineDash([]);

  // Mouse hover highlight: draw a small highlight on tile under mouse
  if (state.mouseLogX >= VP_X && state.mouseLogX < VP_X + VP_W &&
      state.mouseLogY >= VP_Y && state.mouseLogY < VP_Y + VP_H) {
    const mouseTx = Math.floor((state.mouseLogX - VP_X + camX) / TILE_SIZE);
    const mouseTy = Math.floor((state.mouseLogY - VP_Y + camY) / TILE_SIZE);
    if (mouseTx >= 0 && mouseTx < MAP_W && mouseTy >= 0 && mouseTy < MAP_H) {
      const msx = mouseTx * TILE_SIZE - camX + VP_X;
      const msy = mouseTy * TILE_SIZE - camY + VP_Y;
      // Don't double-draw if mouse is on same tile as keyboard cursor
      if (mouseTx !== p.cursorTx || mouseTy !== p.cursorTy) {
        ctx.strokeStyle = C.light;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(msx + 0.5, msy + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Build ghost
  if ((p.commandMode === 'build' || p.commandMode === 'build_place') && p.buildChoice) {
    const def = BUILDING_DEFS[p.buildChoice];
    const w = def.size * TILE_SIZE;
    const h = def.size * TILE_SIZE;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = C.light;
    ctx.fillRect(sx, sy, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.lightest;
    ctx.setLineDash([1, 1]);
    ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
  }
}

// ---- Particles & Effects ----------------------------------------------------

function drawParticles(ctx, state, camX, camY) {
  for (const p of state.particles) {
    if (p.frame < 0) continue; // delayed start
    const sx = p.x - camX + VP_X;
    const sy = p.y - camY + VP_Y;

    if (p.type === 'poof') {
      const r = Math.floor(p.frame) + 1;
      ctx.fillStyle = C.lightest;
      ctx.globalAlpha = 1 - (p.frame / p.maxFrame);
      // 4 dots expanding outward
      ctx.fillRect(sx - r, sy, 1, 1);
      ctx.fillRect(sx + r, sy, 1, 1);
      ctx.fillRect(sx, sy - r, 1, 1);
      ctx.fillRect(sx, sy + r, 1, 1);
      ctx.globalAlpha = 1;
    } else if (p.type === 'projectile') {
      // Lerp from source to target
      const t = p.frame / p.maxFrame;
      const px = p.x + (p.tx - p.x) * t - camX + VP_X;
      const py = p.y + (p.ty - p.y) * t - camY + VP_Y;
      ctx.fillStyle = C.lightest;
      ctx.fillRect(px, py, 2, 2);
    }
  }
}

function drawEvents(ctx, state, camX, camY) {
  ctx.font = '5px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const ev of state.events) {
    const sx = ev.tx * TILE_SIZE - camX + VP_X + TILE_SIZE / 2;
    const sy = ev.ty * TILE_SIZE - camY + VP_Y - ev.elapsed * 8;
    ctx.fillStyle = C.lightest;
    ctx.globalAlpha = Math.max(0, 1 - ev.elapsed / ev.duration);
    ctx.fillText(ev.text, sx, sy);
    ctx.globalAlpha = 1;
  }
}

// ---- Top HUD ----------------------------------------------------------------

function drawTopHUD(ctx, state, localPlayerIdx) {
  const p = state.players[localPlayerIdx];
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, 0, LOGICAL_W, HUD_TOP_H);

  ctx.fillStyle = C.lightest;
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Resources
  ctx.fillText(`F:${p.resources.food}`, 4, 2);
  ctx.fillText(`G:${p.resources.gold}`, 48, 2);

  // Unit count
  ctx.fillText(`U:${p.unitCount}/${p.maxUnits}`, 92, 2);

  // Ally info
  const ally = state.players.find(q => q.team === p.team && q.index !== p.index);
  if (ally) {
    ctx.fillStyle = C.light;
    ctx.fillText(`ALLY F:${ally.resources.food} G:${ally.resources.gold}`, 140, 2);
  }

  // Game timer
  const totalSec = Math.floor(state.tick / TICKS_PER_SEC);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  ctx.fillStyle = C.lightest;
  ctx.textAlign = 'right';
  ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, LOGICAL_W - 4, 2);

  // Wonder timer
  if (state.phase === 'wonder') {
    const wMins = Math.floor(state.wonderTimer / 60);
    const wSecs = Math.floor(state.wonderTimer % 60);
    const isOwner = state.players[state.wonderOwner]?.team === p.team;
    ctx.fillStyle = isOwner ? C.lightest : C.light;
    ctx.textAlign = 'center';
    ctx.font = '6px monospace';
    ctx.fillText(`STARBLOOM ${wMins}:${String(wSecs).padStart(2, '0')}`, LOGICAL_W / 2, 8);
  }

  // Pending request notification
  if (p.pendingRequest) {
    ctx.fillStyle = (state.tick % 20 < 10) ? C.lightest : C.dark;
    ctx.textAlign = 'center';
    ctx.font = '5px monospace';
    ctx.fillText(`ALLY NEEDS ${p.pendingRequest.type.toUpperCase()} [1]50 [2]100 [3]Ignore`, LOGICAL_W / 2, 9);
  }
}

// ---- Bottom Bar (Command Bar + Minimap) -------------------------------------

function drawBottomBar(ctx, state, localPlayerIdx, blinkPhase) {
  const p = state.players[localPlayerIdx];

  // Background for entire bottom bar
  ctx.fillStyle = C.darkest;
  ctx.fillRect(0, CMD_BAR_Y, LOGICAL_W, HUD_BOT_H);

  // Draw command bar (left side)
  drawCommandBar(ctx, state, localPlayerIdx, blinkPhase);

  // Minimap (right side)
  drawMinimap(ctx, state, localPlayerIdx);
}

function drawButton(ctx, btn, hovered) {
  // Background
  ctx.fillStyle = hovered ? C.light : C.dark;
  ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
  // Text
  ctx.fillStyle = hovered ? C.darkest : C.light;
  ctx.font = '5px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
}

function drawCommandBar(ctx, state, localPlayerIdx, blinkPhase) {
  const p = state.players[localPlayerIdx];
  const hoveredBtn = state.hoveredBtn;

  // Row 1: main command buttons
  for (const btn of CMD_BUTTONS) {
    drawButton(ctx, btn, hoveredBtn === btn.id);
  }

  // Row 2: sub-options based on commandMode
  const ROW2_TXT_Y = CMD_BAR_Y + 18;

  if (p.commandMode === 'build') {
    const subs = BUILD_SUB_BUTTONS;
    for (const btn of subs) {
      drawButton(ctx, btn, hoveredBtn === btn.id);
    }
  } else if (p.commandMode === 'train') {
    const subs = TRAIN_SUB_BUTTONS;
    for (const btn of subs) {
      drawButton(ctx, btn, hoveredBtn === btn.id);
    }
  } else if (p.commandMode === 'build_place') {
    ctx.fillStyle = C.light;
    ctx.font = '5px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Click map to place', CMD_BAR_X + 4, ROW2_TXT_Y + 2);
  } else if (p.commandMode === 'attack') {
    ctx.fillStyle = C.light;
    ctx.font = '5px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Click map to attack', CMD_BAR_X + 4, ROW2_TXT_Y + 2);
  } else if (p.commandMode === 'share') {
    drawShareRow(ctx);
  } else if (p.commandMode === 'request') {
    drawRequestRow(ctx);
  } else {
    // Default: show selected entity info or help text
    const ent = findEntity(state, p.selectedId);
    if (ent) {
      drawRow2EntityInfo(ctx, ent, state, p);
    } else {
      ctx.fillStyle = C.light;
      ctx.font = '5px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('SPACE=Select Q=Cycle S=Share R=Request', CMD_BAR_X + 4, ROW2_TXT_Y + 2);
    }
  }

  // Row 3: status line (selected entity HP, etc.)
  const ROW3_Y = CMD_BAR_Y + 34;
  const ent = findEntity(state, p.selectedId);
  if (ent) {
    drawRow3Status(ctx, ent, state, p, ROW3_Y);
  }
}

function drawRow2EntityInfo(ctx, ent, state, p) {
  const y = CMD_BAR_Y + 18 + 2;
  ctx.fillStyle = C.light;
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const isUnit = 'state' in ent;
  if (isUnit) {
    const def = UNIT_DEFS[ent.type];
    ctx.fillText(`${ent.type.toUpperCase()} DMG:${def.dmg} RNG:${def.range} SPD:${def.speed}`, CMD_BAR_X + 4, y);
  } else {
    // Building info
    const trainable = TRAIN_TABLE[ent.type];
    if (ent.type === 'academy') {
      const tier = p.upgradeTier;
      if (tier < UPGRADES.length) {
        const opts = UPGRADES[tier].options;
        const parts = opts.map((o, i) => `[${i + 1}]${o.name}`).join(' ');
        ctx.fillText(parts, CMD_BAR_X + 4, y);
      } else {
        ctx.fillText('ALL UPGRADES COMPLETE', CMD_BAR_X + 4, y);
      }
    } else if (trainable) {
      const parts = trainable.map((ut, i) => `[${i + 1}]${ut.toUpperCase()}`).join(' ');
      ctx.fillText(parts, CMD_BAR_X + 4, y);
    } else {
      ctx.fillText(ent.type.toUpperCase(), CMD_BAR_X + 4, y);
    }
  }
}

function drawRow3Status(ctx, ent, state, p, y) {
  ctx.fillStyle = C.lightest;
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const name = ent.type.toUpperCase();
  const hpText = `${name} HP:${Math.ceil(ent.hp)}/${ent.maxHp}`;

  const isUnit = 'state' in ent;
  if (isUnit) {
    const stateLabel = ent.state.toUpperCase();
    let extra = `${hpText} [${stateLabel}]`;
    if (ent.carryAmt > 0) {
      extra += ` CARRY:${ent.carryAmt} ${ent.carryType}`;
    }
    ctx.fillText(extra, CMD_BAR_X + 4, y);
  } else {
    let extra = hpText;
    if (ent.trainType) {
      const pct = Math.floor((ent.trainProgress / ent.trainTime) * 100);
      extra += ` TRAIN:${ent.trainType.toUpperCase()} ${pct}%`;
    }
    if (!ent.built) {
      const pct = Math.floor((ent.buildProgress / ent.buildTime) * 100);
      extra += ` BUILD:${pct}%`;
    }
    ctx.fillText(extra, CMD_BAR_X + 4, y);
  }
}

function drawShareRow(ctx) {
  const y = CMD_BAR_Y + 18 + 2;
  ctx.fillStyle = C.lightest;
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('SHARE: [1]50F [2]100F [3]50G [4]100G E=Cancel', CMD_BAR_X + 4, y);
}

function drawRequestRow(ctx) {
  const y = CMD_BAR_Y + 18 + 2;
  ctx.fillStyle = C.lightest;
  ctx.font = '5px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('REQUEST: [1]Food [2]Gold  E=Cancel', CMD_BAR_X + 4, y);
}

// ---- Minimap ----------------------------------------------------------------

function drawMinimap(ctx, state, localPlayerIdx) {
  const p = state.players[localPlayerIdx];
  const teamIdx = p.team;
  const fog = state.fog[teamIdx];

  // Minimap background + border
  ctx.fillStyle = C.dark;
  ctx.fillRect(MINIMAP_X - 1, MINIMAP_Y - 1, MINIMAP_W + 2, MINIMAP_H + 2);
  ctx.fillStyle = C.darkest;
  ctx.fillRect(MINIMAP_X, MINIMAP_Y, MINIMAP_W, MINIMAP_H);

  const scaleX = MINIMAP_W / MAP_W;
  const scaleY = MINIMAP_H / MAP_H;

  // Draw tile overlay with fog
  for (let py = 0; py < MINIMAP_H; py++) {
    for (let px = 0; px < MINIMAP_W; px++) {
      const tx = Math.floor((px / MINIMAP_W) * MAP_W);
      const ty = Math.floor((py / MINIMAP_H) * MAP_H);
      const fogLevel = getFog(fog, tx, ty);

      // UNEXPLORED: darkest (already the background)
      if (fogLevel === FOG.UNEXPLORED) continue;

      const tile = state.map.getTile(tx, ty);
      let color;
      if (tile === TILE.WATER) {
        color = C.darkest;
      } else if (tile === TILE.FOREST) {
        color = C.dark;
      } else if (tile === TILE.ROCK) {
        color = C.lightest;
      } else {
        // GRASS / BUILT
        color = C.light;
      }

      if (fogLevel === FOG.EXPLORED) {
        // Dimmed: draw terrain then overlay
        ctx.fillStyle = color;
        ctx.fillRect(MINIMAP_X + px, MINIMAP_Y + py, 1, 1);
        ctx.fillStyle = C.darkest;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(MINIMAP_X + px, MINIMAP_Y + py, 1, 1);
        ctx.globalAlpha = 1;
      } else {
        // VISIBLE: full brightness
        ctx.fillStyle = color;
        ctx.fillRect(MINIMAP_X + px, MINIMAP_Y + py, 1, 1);
      }
    }
  }

  // Buildings as small dots (respect fog: only draw if visible or friendly)
  for (const b of state.buildings) {
    const bTeam = state.players[b.owner].team;
    // Enemy buildings: only show if VISIBLE
    if (bTeam !== teamIdx) {
      if (getFog(fog, b.tx, b.ty) !== FOG.VISIBLE) continue;
    }
    const bpx = MINIMAP_X + Math.floor(b.tx * scaleX);
    const bpy = MINIMAP_Y + Math.floor(b.ty * scaleY);
    ctx.fillStyle = bTeam === teamIdx ? C.lightest : C.darkest;
    ctx.fillRect(bpx, bpy, 2, 1);
  }

  // Units as dots (respect fog: only draw if visible or friendly)
  for (const u of state.units) {
    const uTeam = state.players[u.owner].team;
    if (uTeam !== teamIdx) {
      if (getFog(fog, u.tx, u.ty) !== FOG.VISIBLE) continue;
    }
    const upx = MINIMAP_X + Math.floor(u.tx * scaleX);
    const upy = MINIMAP_Y + Math.floor(u.ty * scaleY);
    ctx.fillStyle = uTeam === teamIdx ? C.lightest : C.darkest;
    ctx.fillRect(upx, upy, 1, 1);
  }

  // Camera viewport rect
  const cx = MINIMAP_X + Math.floor((p.cameraX / TILE_SIZE) * scaleX);
  const cy = MINIMAP_Y + Math.floor((p.cameraY / TILE_SIZE) * scaleY);
  const cw = Math.max(2, Math.floor((VP_W / TILE_SIZE) * scaleX));
  const ch = Math.max(2, Math.floor((VP_H / TILE_SIZE) * scaleY));
  ctx.strokeStyle = C.lightest;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 0.5, cy + 0.5, cw, ch);

  // Wonder blink
  if (state.phase === 'wonder') {
    const wonder = state.buildings.find(b => b.type === 'starbloom' && b.built);
    if (wonder && state.tick % 20 < 10) {
      const wx = MINIMAP_X + Math.floor(wonder.tx * scaleX);
      const wy = MINIMAP_Y + Math.floor(wonder.ty * scaleY);
      ctx.fillStyle = C.lightest;
      ctx.fillRect(wx - 1, wy - 1, 3, 3);
    }
  }
}
