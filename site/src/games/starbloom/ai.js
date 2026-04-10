// Starbloom — AI decision tree with difficulty scaling.
//
// AI runs every N ticks. Uses a priority-based decision loop:
// 1. Defend  2. Economy  3. Produce  4. Build  5. Attack  6. Wonder  7. Share

import { UNIT_DEFS, BUILDING_DEFS, BUILD_ORDER, TRAIN_TABLE, makeUnit, makeBuilding } from './entities.js';
import { TILE } from './map.js';
import { findPath, tileDist } from './pathfinding.js';
import { TILE_SIZE, TICKS_PER_SEC, MAP_W, MAP_H } from './state.js';

const DIFFICULTY = {
  easy:   { interval: 45, gatherMul: 0.8, attackMin: 6 * 60, startBonus: -0.2, wonderThreshold: Infinity },
  medium: { interval: 30, gatherMul: 1.0, attackMin: 4 * 60, startBonus: 0,    wonderThreshold: 2.0 },
  hard:   { interval: 15, gatherMul: 1.2, attackMin: 2.5 * 60, startBonus: 0.2, wonderThreshold: 1.5 },
};

export function initAI(state) {
  // Apply starting resource bonus
  const diff = DIFFICULTY[state.difficulty] || DIFFICULTY.medium;
  for (const p of state.players) {
    if (!p.isHuman) {
      p.resources.food = Math.floor(p.resources.food * (1 + diff.startBonus));
      p.resources.gold = Math.floor(p.resources.gold * (1 + diff.startBonus));
    }
  }
}

export function tickAI(state, dt) {
  const diff = DIFFICULTY[state.difficulty] || DIFFICULTY.medium;

  for (let pi = 0; pi < 4; pi++) {
    const p = state.players[pi];
    if (p.isHuman) continue;
    if (state.tick % diff.interval !== 0) continue;

    const myUnits = state.units.filter(u => u.owner === pi);
    const myBuildings = state.buildings.filter(b => b.owner === pi);
    const gameSec = state.tick / TICKS_PER_SEC;

    // 1. DEFEND: rally to threatened buildings
    aiDefend(state, p, myUnits, myBuildings);

    // 2. ECONOMY: assign idle sprouts
    aiEconomy(state, p, myUnits, myBuildings, diff);

    // 3. PRODUCE: train units
    aiProduce(state, p, myUnits, myBuildings);

    // 4. BUILD: expand
    aiBuild(state, p, myUnits, myBuildings);

    // 5. ATTACK: if enough military and past attack timing
    if (gameSec >= diff.attackMin) {
      aiAttack(state, p, myUnits, myBuildings);
    }

    // 6. WONDER: if dominant
    aiWonder(state, p, myUnits, myBuildings, diff);

    // 7. SHARE: help teammate
    aiShare(state, p);
  }
}

// ---- AI sub-decisions -------------------------------------------------------

function aiDefend(state, p, myUnits, myBuildings) {
  // Check if any building is under attack (enemy within 5 tiles)
  for (const b of myBuildings) {
    if (!b.built) continue;
    const nearbyEnemy = state.units.find(u =>
      state.players[u.owner].team !== p.team &&
      tileDist(u.tx, u.ty, b.tx, b.ty) <= 5
    );
    if (nearbyEnemy) {
      // Rally idle military to defend
      const idleMilitary = myUnits.filter(u =>
        u.type !== 'sprout' && u.type !== 'mender' && u.state === 'idle'
      );
      for (const u of idleMilitary) {
        u.targetId = nearbyEnemy.id;
        u.state = 'attacking';
        const path = findPath(state.map, u.tx, u.ty, nearbyEnemy.tx, nearbyEnemy.ty);
        if (path) { u.path = path; u.pathIdx = 0; }
      }
      return; // defend is highest priority
    }
  }
}

function aiEconomy(state, p, myUnits, myBuildings, diff) {
  const sprouts = myUnits.filter(u => u.type === 'sprout' && u.state === 'idle');
  for (const sprout of sprouts) {
    // Find nearest ungathered resource
    const resource = findNearestResource(state, sprout.tx, sprout.ty);
    if (resource) {
      sprout.targetTx = resource.tx;
      sprout.targetTy = resource.ty;
      sprout.carryType = resource.type === TILE.FOREST ? 'food' : 'gold';
      sprout.carryAmt = 0;
      sprout.gatherTimer = 0;
      sprout.state = 'gathering';
      const path = findPath(state.map, sprout.tx, sprout.ty, resource.tx, resource.ty);
      if (path) { sprout.path = path; sprout.pathIdx = 0; }
    }
  }
}

function aiProduce(state, p, myUnits, myBuildings) {
  // Target ratio: 40% sprouts, 60% military
  const sproutCount = myUnits.filter(u => u.type === 'sprout').length;
  const militaryCount = myUnits.filter(u => u.type !== 'sprout' && u.type !== 'mender').length;
  const needSprout = sproutCount < 4 || (sproutCount / (sproutCount + militaryCount + 1)) < 0.35;

  // Train from available buildings
  for (const b of myBuildings) {
    if (!b.built || b.trainType) continue;
    const trainable = TRAIN_TABLE[b.type];
    if (!trainable) continue;

    if (p.unitCount >= p.maxUnits) return;

    if (b.type === 'nest' && needSprout) {
      const def = UNIT_DEFS.sprout;
      if (p.resources.food >= def.cost.food && p.resources.gold >= def.cost.gold) {
        p.resources.food -= def.cost.food;
        p.resources.gold -= def.cost.gold;
        b.trainType = 'sprout';
        b.trainProgress = 0;
        b.trainTime = def.buildTime;
      }
    } else if (b.type === 'barracks' && !needSprout) {
      // Pick a random military unit we can afford
      const affordable = trainable.filter(t => {
        const def = UNIT_DEFS[t];
        return p.resources.food >= def.cost.food && p.resources.gold >= def.cost.gold;
      });
      if (affordable.length > 0) {
        const pick = affordable[Math.floor(Math.random() * affordable.length)];
        const def = UNIT_DEFS[pick];
        p.resources.food -= def.cost.food;
        p.resources.gold -= def.cost.gold;
        b.trainType = pick;
        b.trainProgress = 0;
        b.trainTime = def.buildTime;
      }
    }
  }
}

function aiBuild(state, p, myUnits, myBuildings) {
  // Priority: depot near resources > barracks > tower
  const hasBarracks = myBuildings.some(b => b.type === 'barracks' && b.built);
  const hasDepot = myBuildings.some(b => b.type === 'depot' && b.built);
  const hasTower = myBuildings.some(b => b.type === 'tower' && b.built);
  const hasAcademy = myBuildings.some(b => b.type === 'academy' && b.built);
  // Prefer idle sprout, but pull a gathering sprout if none idle
  let buildingSprout = myUnits.find(u => u.type === 'sprout' && u.state === 'idle');
  if (!buildingSprout) {
    buildingSprout = myUnits.find(u => u.type === 'sprout' && (u.state === 'gathering' || u.state === 'returning'));
  }
  if (!buildingSprout) return;

  let buildType = null;
  if (!hasBarracks && canAfford(p, 'barracks')) buildType = 'barracks';
  else if (!hasDepot && canAfford(p, 'depot')) buildType = 'depot';
  else if (hasBarracks && !hasTower && canAfford(p, 'tower')) buildType = 'tower';
  else if (hasBarracks && !hasAcademy && canAfford(p, 'academy') && p.resources.food > 300) buildType = 'academy';
  else if (myBuildings.filter(b => b.type === 'barracks').length < 2 && canAfford(p, 'barracks') && p.resources.food > 250) buildType = 'barracks';

  if (!buildType) return;

  // Find a valid placement near base
  const nest = myBuildings.find(b => b.type === 'nest');
  if (!nest) return;

  const def = BUILDING_DEFS[buildType];
  const spot = findBuildSpot(state, nest.tx, nest.ty, def.size);
  if (!spot) return;

  // Deduct cost and create building
  p.resources.food -= def.cost.food;
  p.resources.gold -= def.cost.gold;
  const building = makeBuilding(state, p.index, buildType, spot.tx, spot.ty);
  state.buildings.push(building);
  p.buildingCount++;

  // Mark tiles
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      state.map.setTile(spot.tx + dx, spot.ty + dy, TILE.BUILT);
    }
  }

  // Send sprout to build
  buildingSprout.targetId = building.id;
  buildingSprout.state = 'building';
  const path = findPath(state.map, buildingSprout.tx, buildingSprout.ty, spot.tx, spot.ty);
  if (path) { buildingSprout.path = path; buildingSprout.pathIdx = 0; }
}

function aiAttack(state, p, myUnits, myBuildings) {
  const idleMilitary = myUnits.filter(u =>
    u.type !== 'sprout' && u.type !== 'mender' && u.state === 'idle'
  );

  if (idleMilitary.length < 3) return;

  // Find nearest enemy building (relative to our base)
  const myNest = myBuildings.find(b => b.type === 'nest');
  const refTx = myNest ? myNest.tx : p.cursorTx;
  const refTy = myNest ? myNest.ty : p.cursorTy;
  let nearestEnemyBuilding = null;
  let nearestDist = Infinity;
  for (const b of state.buildings) {
    if (state.players[b.owner].team === p.team) continue;
    const d = tileDist(refTx, refTy, b.tx, b.ty);
    if (d < nearestDist) { nearestDist = d; nearestEnemyBuilding = b; }
  }

  if (!nearestEnemyBuilding) return;

  for (const u of idleMilitary) {
    u.targetId = nearestEnemyBuilding.id;
    u.state = 'attacking';
    const path = findPath(state.map, u.tx, u.ty, nearestEnemyBuilding.tx, nearestEnemyBuilding.ty);
    if (path) { u.path = path; u.pathIdx = 0; }
  }
}

function aiWonder(state, p, myUnits, myBuildings, diff) {
  if (state.buildings.some(b => b.type === 'starbloom')) return; // already exists

  // Check military advantage
  const myMilitary = myUnits.filter(u => u.type !== 'sprout' && u.type !== 'mender').length;
  const enemyMilitary = state.units.filter(u =>
    state.players[u.owner].team !== p.team && u.type !== 'sprout' && u.type !== 'mender'
  ).length;

  if (myMilitary < (enemyMilitary + 1) * diff.wonderThreshold) return;
  if (!canAfford(p, 'starbloom')) return;

  // Find a sprout and build spot
  const sprout = myUnits.find(u => u.type === 'sprout' && u.state === 'idle');
  if (!sprout) return;
  const nest = myBuildings.find(b => b.type === 'nest');
  if (!nest) return;

  const def = BUILDING_DEFS.starbloom;
  const spot = findBuildSpot(state, nest.tx, nest.ty, def.size);
  if (!spot) return;

  p.resources.food -= def.cost.food;
  p.resources.gold -= def.cost.gold;
  const building = makeBuilding(state, p.index, 'starbloom', spot.tx, spot.ty);
  state.buildings.push(building);
  p.buildingCount++;

  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      state.map.setTile(spot.tx + dx, spot.ty + dy, TILE.BUILT);
    }
  }

  sprout.targetId = building.id;
  sprout.state = 'building';
  const path = findPath(state.map, sprout.tx, sprout.ty, spot.tx, spot.ty);
  if (path) { sprout.path = path; sprout.pathIdx = 0; }
}

function aiShare(state, p) {
  const teammate = state.players.find(q => q.team === p.team && q.index !== p.index);
  if (!teammate) return;

  // Auto-share when surplus > 300 and teammate < 100
  for (const res of ['food', 'gold']) {
    if (p.resources[res] > 300 && teammate.resources[res] < 100) {
      const amount = 100;
      const tax = Math.floor(amount * 0.15);
      p.resources[res] -= amount;
      teammate.resources[res] += amount - tax;
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

function canAfford(player, buildingType) {
  const def = BUILDING_DEFS[buildingType];
  return player.resources.food >= def.cost.food && player.resources.gold >= def.cost.gold;
}

function findNearestResource(state, tx, ty) {
  let nearest = null;
  let nearestDist = Infinity;
  // Search in a reasonable radius
  for (let dy = -30; dy <= 30; dy++) {
    for (let dx = -30; dx <= 30; dx++) {
      const rx = tx + dx;
      const ry = ty + dy;
      const tile = state.map.getTile(rx, ry);
      if (tile !== TILE.FOREST && tile !== TILE.ROCK) continue;
      // Check if not too many gatherers already
      const gatherers = state.units.filter(u =>
        u.state === 'gathering' && u.targetTx === rx && u.targetTy === ry
      ).length;
      if (gatherers >= 3) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = { tx: rx, ty: ry, type: tile };
      }
    }
  }
  return nearest;
}

function findBuildSpot(state, baseTx, baseTy, size) {
  // Search spiral outward from base for valid placement
  for (let r = 3; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only ring
        const tx = baseTx + dx;
        const ty = baseTy + dy;
        if (tx < 0 || ty < 0 || tx + size > MAP_W || ty + size > MAP_H) continue;
        let valid = true;
        for (let sy = 0; sy < size && valid; sy++) {
          for (let sx = 0; sx < size && valid; sx++) {
            if (state.map.getTile(tx + sx, ty + sy) !== TILE.GRASS) valid = false;
          }
        }
        if (valid) return { tx, ty };
      }
    }
  }
  return null;
}
