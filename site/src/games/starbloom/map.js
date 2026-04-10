// Starbloom — seeded procedural map generation.
//
// 128x128 tile grid with rotationally symmetric layout.
// Tile types: GRASS(0), FOREST(1), ROCK(2), WATER(3), BUILT(4)

import { MAP_W, MAP_H, START_POS } from './state.js';

export const TILE = {
  GRASS:  0,
  FOREST: 1,
  ROCK:   2,
  WATER:  3,
  BUILT:  4,
};

// Simple seeded PRNG (xorshift32)
function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Zone definitions: resource clusters placed symmetrically (128x128).
const ZONE_TEMPLATES = [
  // Center zone (shared contested area)
  { tx: 64, ty: 64, forest: 10, rock: 6 },
  // Mid zones (between bases and center)
  { tx: 40, ty: 40, forest: 7, rock: 4 },
  { tx: 88, ty: 40, forest: 7, rock: 4 },
  { tx: 40, ty: 88, forest: 7, rock: 4 },
  // Off-center zones
  { tx: 32, ty: 72, forest: 5, rock: 5 },
  { tx: 72, ty: 72, forest: 5, rock: 5 },
  { tx: 56, ty: 32, forest: 5, rock: 3 },
  { tx: 72, ty: 56, forest: 5, rock: 3 },
  // Near-base zones (medium)
  { tx: 28, ty: 20, forest: 5, rock: 3 },
  { tx: 20, ty: 48, forest: 4, rock: 3 },
  // Outlier zones
  { tx: 48, ty: 56, forest: 4, rock: 3 },
  { tx: 56, ty: 96, forest: 4, rock: 3 },
  { tx: 96, ty: 48, forest: 4, rock: 3 },
];

export function generateMap(seed) {
  const rng = makeRng(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H);

  // Fill with grass
  tiles.fill(TILE.GRASS);

  // Place resource zones
  const zones = [];
  for (const zt of ZONE_TEMPLATES) {
    placeZone(tiles, rng, zt.tx, zt.ty, zt.forest, zt.rock, zones);
    // Mirror: rotate 180 degrees around center
    const mx = MAP_W - 1 - zt.tx;
    const my = MAP_H - 1 - zt.ty;
    if (mx !== zt.tx || my !== zt.ty) {
      placeZone(tiles, rng, mx, my, zt.forest, zt.rock, zones);
    }
  }

  // Place starting resources near each player's base
  for (const sp of START_POS) {
    placeStartResources(tiles, rng, sp.tx, sp.ty);
  }

  // Place water barriers to create chokepoints
  placeWater(tiles, rng);

  // Create map object with accessor
  const map = {
    tiles,
    seed,
    zones,
    getTile(tx, ty) {
      if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return TILE.WATER;
      return tiles[ty * MAP_W + tx];
    },
    setTile(tx, ty, v) {
      if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
        tiles[ty * MAP_W + tx] = v;
      }
    },
    inBounds(tx, ty) {
      return tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;
    },
    isWalkable(tx, ty) {
      const t = map.getTile(tx, ty);
      return t === TILE.GRASS || t === TILE.FOREST || t === TILE.ROCK;
    },
  };

  return map;
}

function placeZone(tiles, rng, cx, cy, forestCount, rockCount, zones) {
  const placed = [];
  let attempts = 0;
  let fc = 0, rc = 0;
  while ((fc < forestCount || rc < rockCount) && attempts < 150) {
    const dx = Math.floor(rng() * 14) - 7;
    const dy = Math.floor(rng() * 14) - 7;
    const tx = cx + dx;
    const ty = cy + dy;
    if (tx < 1 || tx >= MAP_W - 1 || ty < 1 || ty >= MAP_H - 1) { attempts++; continue; }
    if (tiles[ty * MAP_W + tx] !== TILE.GRASS) { attempts++; continue; }
    if (fc < forestCount) {
      tiles[ty * MAP_W + tx] = TILE.FOREST;
      fc++;
      placed.push({ tx, ty, type: 'forest' });
    } else if (rc < rockCount) {
      tiles[ty * MAP_W + tx] = TILE.ROCK;
      rc++;
      placed.push({ tx, ty, type: 'rock' });
    }
    attempts++;
  }
  zones.push({ cx, cy, tiles: placed });
}

function placeStartResources(tiles, rng, baseTx, baseTy) {
  // Place 6 forest and 4 rock tiles within ~8 tiles of the base
  let fc = 0, rc = 0;
  let attempts = 0;
  while ((fc < 6 || rc < 4) && attempts < 120) {
    const dx = Math.floor(rng() * 16) - 8;
    const dy = Math.floor(rng() * 16) - 8;
    const tx = baseTx + dx;
    const ty = baseTy + dy;
    if (tx < 1 || tx >= MAP_W - 1 || ty < 1 || ty >= MAP_H - 1) { attempts++; continue; }
    if (tiles[ty * MAP_W + tx] !== TILE.GRASS) { attempts++; continue; }
    if (Math.abs(tx - baseTx) <= 3 && Math.abs(ty - baseTy) <= 1) { attempts++; continue; }
    if (fc < 6) {
      tiles[ty * MAP_W + tx] = TILE.FOREST;
      fc++;
    } else {
      tiles[ty * MAP_W + tx] = TILE.ROCK;
      rc++;
    }
    attempts++;
  }
}

function placeWater(tiles, rng) {
  // Horizontal water band across center with gaps
  const centerY = Math.floor(MAP_H / 2);
  for (let x = 16; x < MAP_W - 16; x++) {
    const y = centerY + Math.floor(rng() * 5) - 2;
    if ((x % 14) < 4) continue; // gaps for chokepoints
    if (y >= 0 && y < MAP_H && tiles[y * MAP_W + x] === TILE.GRASS) {
      tiles[y * MAP_W + x] = TILE.WATER;
    }
  }
  // Vertical water band
  const centerX = Math.floor(MAP_W / 2);
  for (let y = 16; y < MAP_H - 16; y++) {
    const x = centerX + Math.floor(rng() * 5) - 2;
    if ((y % 14) < 4) continue;
    if (x >= 0 && x < MAP_W && tiles[y * MAP_W + x] === TILE.GRASS) {
      tiles[y * MAP_W + x] = TILE.WATER;
    }
  }
  // Diagonal water patches for variety
  for (let i = 0; i < 8; i++) {
    const px = Math.floor(rng() * (MAP_W - 20)) + 10;
    const py = Math.floor(rng() * (MAP_H - 20)) + 10;
    const len = 4 + Math.floor(rng() * 6);
    for (let j = 0; j < len; j++) {
      const wx = px + j;
      const wy = py + j + Math.floor(rng() * 3) - 1;
      if (wx >= 0 && wx < MAP_W && wy >= 0 && wy < MAP_H && tiles[wy * MAP_W + wx] === TILE.GRASS) {
        tiles[wy * MAP_W + wx] = TILE.WATER;
      }
    }
  }
}

// Resource depletion tracking (per tile)
const depletionMap = new Map();

export function getResourceRemaining(tx, ty) {
  const key = `${tx},${ty}`;
  if (!depletionMap.has(key)) depletionMap.set(key, 30);
  return depletionMap.get(key);
}

export function depleteResource(tx, ty) {
  const key = `${tx},${ty}`;
  const rem = getResourceRemaining(tx, ty) - 1;
  depletionMap.set(key, rem);
  return rem;
}

export function resetDepletion() {
  depletionMap.clear();
}
