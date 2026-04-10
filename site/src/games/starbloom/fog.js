// Starbloom — fog of war system.
//
// Per-team visibility: UNEXPLORED → EXPLORED → VISIBLE.
// Units and buildings reveal tiles within their sight radius each tick.
// Previously visible tiles downgrade to EXPLORED (terrain remembered,
// but enemy units/buildings hidden).

import { MAP_W, MAP_H, SIGHT_RADIUS } from './state.js';
import { BUILDING_DEFS } from './entities.js';

export const FOG = {
  UNEXPLORED: 0,
  EXPLORED:   1,
  VISIBLE:    2,
};

// Call once per simulation tick to update fog for all teams.
export function updateFog(state) {
  for (let team = 0; team < 2; team++) {
    const fog = state.fog[team];

    // Downgrade all VISIBLE → EXPLORED
    for (let i = 0; i < fog.length; i++) {
      if (fog[i] === FOG.VISIBLE) fog[i] = FOG.EXPLORED;
    }

    // Reveal around each unit belonging to this team
    for (const u of state.units) {
      if (state.players[u.owner].team !== team) continue;
      const r = SIGHT_RADIUS[u.type] || 5;
      revealCircle(fog, u.tx, u.ty, r);
    }

    // Reveal around each building belonging to this team
    for (const b of state.buildings) {
      if (state.players[b.owner].team !== team) continue;
      const def = BUILDING_DEFS[b.type];
      const cx = b.tx + Math.floor(def.size / 2);
      const cy = b.ty + Math.floor(def.size / 2);
      revealCircle(fog, cx, cy, SIGHT_RADIUS.building);
    }
  }
}

function revealCircle(fog, cx, cy, radius) {
  const r2 = radius * radius;
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(MAP_W - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(MAP_H - 1, cy + radius);
  for (let ty = minY; ty <= maxY; ty++) {
    const dy = ty - cy;
    const dy2 = dy * dy;
    for (let tx = minX; tx <= maxX; tx++) {
      const dx = tx - cx;
      if (dx * dx + dy2 <= r2) {
        fog[ty * MAP_W + tx] = FOG.VISIBLE;
      }
    }
  }
}

// Helpers for querying fog
export function isVisible(fog, tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return false;
  return fog[ty * MAP_W + tx] === FOG.VISIBLE;
}

export function isExplored(fog, tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return false;
  return fog[ty * MAP_W + tx] >= FOG.EXPLORED;
}

export function getFog(fog, tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return FOG.UNEXPLORED;
  return fog[ty * MAP_W + tx];
}
