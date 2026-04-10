// Starbloom — A* pathfinding on tile grid.

import { MAP_W, MAP_H } from './state.js';

// 4-directional movement only (no diagonals)
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];

export function findPath(map, fromTx, fromTy, toTx, toTy, maxSteps = 800) {
  if (fromTx === toTx && fromTy === toTy) return [];

  // Target tile might be a building — allow walking TO it even if not normally walkable
  const targetKey = toTy * MAP_W + toTx;

  const openSet = [];
  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();

  const startKey = fromTy * MAP_W + fromTx;
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(fromTx, fromTy, toTx, toTy));
  openSet.push(startKey);

  let steps = 0;
  while (openSet.length > 0 && steps < maxSteps) {
    steps++;

    // Find node with lowest fScore
    let bestIdx = 0;
    let bestF = fScore.get(openSet[0]) ?? Infinity;
    for (let i = 1; i < openSet.length; i++) {
      const f = fScore.get(openSet[i]) ?? Infinity;
      if (f < bestF) { bestF = f; bestIdx = i; }
    }
    const currentKey = openSet[bestIdx];
    openSet.splice(bestIdx, 1);

    if (currentKey === targetKey) {
      return reconstructPath(cameFrom, currentKey);
    }

    const cx = currentKey % MAP_W;
    const cy = (currentKey - cx) / MAP_W;
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;

      const nKey = ny * MAP_W + nx;

      // Walkable check: allow target tile even if BUILT (so units can walk to buildings)
      if (nKey !== targetKey && !map.isWalkable(nx, ny)) continue;

      const tentativeG = currentG + 1;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + heuristic(nx, ny, toTx, toTy));
        if (!openSet.includes(nKey)) {
          openSet.push(nKey);
        }
      }
    }
  }

  // No path found — return null
  return null;
}

function heuristic(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by); // Manhattan distance
}

function reconstructPath(cameFrom, currentKey) {
  const path = [];
  let key = currentKey;
  while (cameFrom.has(key)) {
    const tx = key % MAP_W;
    const ty = (key - tx) / MAP_W;
    path.unshift([tx, ty]);
    key = cameFrom.get(key);
  }
  return path;
}

// Tile distance (Manhattan)
export function tileDist(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
