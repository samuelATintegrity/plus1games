// Starbloom — unit and building definitions + factory functions.

import { TILE_SIZE } from './state.js';

// ---- Unit definitions -------------------------------------------------------

export const UNIT_DEFS = {
  sprout:  { cost: { food: 50,  gold: 0  }, hp: 30,  dmg: 3,  range: 1, speed: 40,  buildTime: 5  },
  bonker:  { cost: { food: 80,  gold: 20 }, hp: 60,  dmg: 8,  range: 1, speed: 50,  buildTime: 8  },
  lobber:  { cost: { food: 60,  gold: 40 }, hp: 35,  dmg: 6,  range: 3, speed: 45,  buildTime: 10 },
  stomper: { cost: { food: 120, gold: 60 }, hp: 100, dmg: 12, range: 1, speed: 30,  buildTime: 14 },
  mender:  { cost: { food: 40,  gold: 80 }, hp: 25,  dmg: 0,  range: 2, speed: 45,  buildTime: 10 },
};

// What each building can train
export const TRAIN_TABLE = {
  nest:     ['sprout'],
  barracks: ['bonker', 'lobber', 'stomper', 'mender'],
};

// ---- Building definitions ---------------------------------------------------

export const BUILDING_DEFS = {
  nest:      { cost: { food: 0,   gold: 0   }, hp: 500, buildTime: 0,  size: 2, popBonus: 5 },
  depot:     { cost: { food: 100, gold: 50  }, hp: 200, buildTime: 15, size: 1, popBonus: 0 },
  barracks:  { cost: { food: 150, gold: 100 }, hp: 300, buildTime: 20, size: 2, popBonus: 3 },
  tower:     { cost: { food: 50,  gold: 150 }, hp: 250, buildTime: 12, size: 1, popBonus: 0, range: 4, towerDmg: 5 },
  wall:      { cost: { food: 25,  gold: 25  }, hp: 400, buildTime: 5,  size: 1, popBonus: 0 },
  academy:   { cost: { food: 200, gold: 200 }, hp: 200, buildTime: 25, size: 2, popBonus: 0 },
  starbloom: { cost: { food: 500, gold: 500 }, hp: 600, buildTime: 60, size: 3, popBonus: 0 },
};

// Ordered list for build menu
export const BUILD_ORDER = ['depot', 'barracks', 'tower', 'wall', 'academy', 'starbloom'];

// ---- Factory functions ------------------------------------------------------

export function makeUnit(state, owner, type, tx, ty) {
  const def = UNIT_DEFS[type];
  return {
    id: state.nextId++,
    owner,
    type,
    tx, ty,
    px: tx * TILE_SIZE + TILE_SIZE / 2,
    py: ty * TILE_SIZE + TILE_SIZE / 2,
    hp: def.hp,
    maxHp: def.hp,
    state: 'idle',      // 'idle' | 'moving' | 'gathering' | 'building' | 'attacking' | 'healing' | 'retreating'
    targetId: -1,
    targetTx: -1,
    targetTy: -1,
    path: null,
    pathIdx: 0,
    carryType: null,     // 'food' | 'gold'
    carryAmt: 0,
    cooldown: 0,
    gatherTimer: 0,
    flashTimer: 0,       // damage flash
    dizzyTimer: 0,       // stun timer
  };
}

export function makeBuilding(state, owner, type, tx, ty) {
  const def = BUILDING_DEFS[type];
  return {
    id: state.nextId++,
    owner,
    type,
    tx, ty,
    hp: def.hp,
    maxHp: def.hp,
    built: false,
    buildProgress: 0,
    buildTime: def.buildTime,
    // Training queue
    trainType: null,
    trainProgress: 0,
    trainTime: 0,
    // Tower
    towerCooldown: 0,
    flashTimer: 0,
  };
}

// Helper: find any entity (unit or building) by id
export function findEntity(state, id) {
  if (id < 0) return null;
  return state.units.find(u => u.id === id) || state.buildings.find(b => b.id === id) || null;
}

// Remove a unit by id
export function removeUnit(state, id) {
  const idx = state.units.findIndex(u => u.id === id);
  if (idx >= 0) {
    const u = state.units[idx];
    state.players[u.owner].unitCount--;
    state.units.splice(idx, 1);
    // Clear any references to this unit
    for (const p of state.players) {
      if (p.selectedId === id) {
        p.selectedId = -1;
        p.commandMode = 'none';
      }
    }
    for (const u2 of state.units) {
      if (u2.targetId === id) {
        u2.targetId = -1;
        u2.state = 'idle';
      }
    }
  }
}

// Remove a building by id
export function removeBuilding(state, id) {
  const idx = state.buildings.findIndex(b => b.id === id);
  if (idx >= 0) {
    const b = state.buildings[idx];
    const def = BUILDING_DEFS[b.type];
    state.players[b.owner].buildingCount--;
    if (b.built) {
      state.players[b.owner].maxUnits -= def.popBonus;
    }
    // Free tiles
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        state.map.setTile(b.tx + dx, b.ty + dy, 0); // back to GRASS
      }
    }
    state.buildings.splice(idx, 1);
    for (const p of state.players) {
      if (p.selectedId === id) {
        p.selectedId = -1;
        p.commandMode = 'none';
      }
    }
    for (const u of state.units) {
      if (u.targetId === id) {
        u.targetId = -1;
        u.state = 'idle';
      }
    }
  }
}
