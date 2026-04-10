// Zookeepers — animal AI.
//
// Each animal has a personality modelled after classic Pac-Man ghosts:
//   Ape   (Blinky) — targets nearest zookeeper directly
//   Rhino (Pinky)  — targets 4 tiles ahead of nearest zookeeper
//   Tiger (Inky)   — complex targeting using ape's position
//   Bear  (Clyde)  — chases when far, scatters when close
//
// At each intersection the AI picks the neighbouring tile (excluding reverse)
// whose Euclidean distance to the target tile is smallest.

import { COLS, ROWS, TILE } from './maze.js';
import { DIR, DX, DY, oppositeDir, canMoveAnimal } from './state.js';

// ---- Public API --------------------------------------------------------------

// Called once per frame per AI animal (when at or near a tile center / new tile).
// Sets animal.nextDir based on targeting.
export function tickAnimalAI(animal, state) {
  // Only make decisions at tile centers (or very close)
  const cx = animal.tileX * 7 + 3.5; // TILE_SIZE=7
  const cy = animal.tileY * 7 + 3.5;
  const distToCenter = Math.abs(animal.x - cx) + Math.abs(animal.y - cy);
  if (distToCenter > 2 && animal.dir !== DIR.NONE) return; // not at a decision point

  // Compute target tile
  let targetX, targetY;

  if (animal.mode === 'scatter') {
    targetX = animal.scatterTileX;
    targetY = animal.scatterTileY;
  } else if (animal.mode === 'chase') {
    const t = computeChaseTarget(animal, state);
    targetX = t.x;
    targetY = t.y;
  } else if (animal.mode === 'eaten') {
    // Head to pen gate
    targetX = state.penGateCol + 1;
    targetY = state.penGateRow;
  } else {
    // Frightened — random
    pickRandomDir(animal, state.tiles);
    return;
  }

  animal.targetTileX = targetX;
  animal.targetTileY = targetY;

  // Pick the best direction at this intersection
  pickBestDir(animal, state.tiles, targetX, targetY);
}

// ---- Chase target per animal type --------------------------------------------

function computeChaseTarget(animal, state) {
  const nearest = findNearestZookeeper(animal, state);
  if (!nearest) return { x: animal.scatterTileX, y: animal.scatterTileY };

  switch (animal.type) {
    case 'ape': {
      // Direct pursuit — target = nearest zookeeper's tile
      return { x: nearest.tileX, y: nearest.tileY };
    }
    case 'rhino': {
      // 4 tiles ahead of nearest zookeeper in their facing direction
      let tx = nearest.tileX;
      let ty = nearest.tileY;
      if (nearest.dir >= 0) {
        tx += DX[nearest.dir] * 4;
        ty += DY[nearest.dir] * 4;
      }
      return { x: tx, y: ty };
    }
    case 'tiger': {
      // Vector doubling: take tile 2 ahead of nearest zookeeper,
      // then double the vector from ape's position to that tile.
      let tx = nearest.tileX;
      let ty = nearest.tileY;
      if (nearest.dir >= 0) {
        tx += DX[nearest.dir] * 2;
        ty += DY[nearest.dir] * 2;
      }
      const ape = state.animals[0];
      const vx = tx - ape.tileX;
      const vy = ty - ape.tileY;
      return { x: ape.tileX + vx * 2, y: ape.tileY + vy * 2 };
    }
    case 'bear': {
      // Chase when far (>8 tiles), scatter corner when close
      const dist = Math.sqrt(
        (animal.tileX - nearest.tileX) ** 2 +
        (animal.tileY - nearest.tileY) ** 2
      );
      if (dist > 8) {
        return { x: nearest.tileX, y: nearest.tileY };
      }
      return { x: animal.scatterTileX, y: animal.scatterTileY };
    }
    default:
      return { x: nearest.tileX, y: nearest.tileY };
  }
}

function findNearestZookeeper(animal, state) {
  let best = null;
  let bestDist = Infinity;
  for (const zk of state.zookeepers) {
    if (!zk.alive) continue;
    const d = (animal.tileX - zk.tileX) ** 2 + (animal.tileY - zk.tileY) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = zk;
    }
  }
  return best;
}

// ---- Direction picking -------------------------------------------------------

function pickBestDir(animal, tiles, targetX, targetY) {
  const reverse = oppositeDir(animal.dir);
  let bestDir = animal.dir >= 0 ? animal.dir : DIR.RIGHT;
  let bestDist = Infinity;

  for (let d = 0; d < 4; d++) {
    // No 180-degree turns (except if dir is NONE)
    if (d === reverse && animal.dir !== DIR.NONE) continue;
    if (!canMoveAnimal(tiles, animal.tileX, animal.tileY, d)) continue;

    const nx = animal.tileX + DX[d];
    const ny = animal.tileY + DY[d];
    const dist = (nx - targetX) ** 2 + (ny - targetY) ** 2;

    if (dist < bestDist) {
      bestDist = dist;
      bestDir = d;
    }
  }

  animal.nextDir = bestDir;
  // Also immediately set dir if currently stopped
  if (animal.dir === DIR.NONE) animal.dir = bestDir;
}

function pickRandomDir(animal, tiles) {
  const reverse = oppositeDir(animal.dir);
  const options = [];
  for (let d = 0; d < 4; d++) {
    if (d === reverse && animal.dir !== DIR.NONE) continue;
    if (canMoveAnimal(tiles, animal.tileX, animal.tileY, d)) {
      options.push(d);
    }
  }
  if (options.length > 0) {
    animal.nextDir = options[Math.floor(Math.random() * options.length)];
    if (animal.dir === DIR.NONE) animal.dir = animal.nextDir;
  }
}
