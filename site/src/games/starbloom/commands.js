// Starbloom — command system (global, mouse-driven).
//
// Commands affect ALL units of the player's type:
//   GATHER FOOD/GOLD → all sprouts go gather
//   BUILD → pick type → click location → all sprouts go build
//   ATTACK → click location → all military units attack-move
//   TRAIN → pick unit type → first available building trains

import { findEntity, makeBuilding, UNIT_DEFS, BUILDING_DEFS, BUILD_ORDER, TRAIN_TABLE } from './entities.js';
import { TILE } from './map.js';
import { findPath, tileDist } from './pathfinding.js';
import { TILE_SIZE, MAP_W, MAP_H, UPGRADES } from './state.js';

// ---- Global commands --------------------------------------------------------

// All sprouts gather food (nearest forest)
export function cmdGatherFood(state, pi) {
  const sprouts = state.units.filter(u => u.owner === pi && u.type === 'sprout');
  if (sprouts.length === 0) { addEvent(state, 'NO SPROUTS', 64, 64); return false; }
  let assigned = 0;
  for (const u of sprouts) {
    const target = findNearestResource(state, u.tx, u.ty, TILE.FOREST);
    if (target) {
      const path = findPath(state.map, u.tx, u.ty, target.tx, target.ty);
      if (path) {
        u.path = path;
        u.pathIdx = 0;
        u.state = 'gathering';
        u.targetTx = target.tx;
        u.targetTy = target.ty;
        u.targetId = -1;
        u.carryType = 'food';
        u.carryAmt = 0;
        u.gatherTimer = 0;
        assigned++;
      }
    }
  }
  if (assigned === 0) addEvent(state, 'NO FOOD NEARBY', sprouts[0].tx, sprouts[0].ty);
  state.players[pi].commandMode = 'none';
  return assigned > 0;
}

// All sprouts gather gold (nearest rock)
export function cmdGatherGold(state, pi) {
  const sprouts = state.units.filter(u => u.owner === pi && u.type === 'sprout');
  if (sprouts.length === 0) { addEvent(state, 'NO SPROUTS', 64, 64); return false; }
  let assigned = 0;
  for (const u of sprouts) {
    const target = findNearestResource(state, u.tx, u.ty, TILE.ROCK);
    if (target) {
      const path = findPath(state.map, u.tx, u.ty, target.tx, target.ty);
      if (path) {
        u.path = path;
        u.pathIdx = 0;
        u.state = 'gathering';
        u.targetTx = target.tx;
        u.targetTy = target.ty;
        u.targetId = -1;
        u.carryType = 'gold';
        u.carryAmt = 0;
        u.gatherTimer = 0;
        assigned++;
      }
    }
  }
  if (assigned === 0) addEvent(state, 'NO GOLD NEARBY', sprouts[0].tx, sprouts[0].ty);
  state.players[pi].commandMode = 'none';
  return assigned > 0;
}

// Enter build mode (shows building selection)
export function cmdBuildMode(state, pi) {
  state.players[pi].commandMode = 'build';
  state.players[pi].buildChoice = null;
  return true;
}

// Select a building type in build mode
export function cmdBuildSelect(state, pi, buildType) {
  const player = state.players[pi];
  if (player.commandMode !== 'build') return false;
  if (!BUILDING_DEFS[buildType]) return false;
  player.buildChoice = buildType;
  player.commandMode = 'build_place';
  return true;
}

// Place a building at (tx,ty) — all sprouts go build it
export function cmdBuildPlace(state, pi, tx, ty) {
  const player = state.players[pi];
  if (player.commandMode !== 'build_place' || !player.buildChoice) return false;

  const bType = player.buildChoice;
  const def = BUILDING_DEFS[bType];

  // Check cost
  if (player.resources.food < def.cost.food || player.resources.gold < def.cost.gold) {
    addEvent(state, 'NOT ENOUGH RESOURCES', tx, ty);
    return false;
  }

  // Check placement (all tiles must be GRASS)
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      const t = state.map.getTile(tx + dx, ty + dy);
      if (t !== TILE.GRASS) {
        addEvent(state, 'CANT BUILD HERE', tx, ty);
        return false;
      }
    }
  }

  // Only one starbloom allowed
  if (bType === 'starbloom') {
    if (state.buildings.some(b => b.type === 'starbloom')) {
      addEvent(state, 'STARBLOOM EXISTS', tx, ty);
      return false;
    }
  }

  // Deduct resources
  player.resources.food -= def.cost.food;
  player.resources.gold -= def.cost.gold;

  // Create building (under construction)
  const building = makeBuilding(state, pi, bType, tx, ty);
  state.buildings.push(building);
  player.buildingCount++;

  // Mark tiles as BUILT
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      state.map.setTile(tx + dx, ty + dy, TILE.BUILT);
    }
  }

  // Send ALL sprouts to build it
  const sprouts = state.units.filter(u => u.owner === pi && u.type === 'sprout');
  for (const u of sprouts) {
    const path = findPath(state.map, u.tx, u.ty, tx, ty);
    if (path) {
      u.path = path;
      u.pathIdx = 0;
      u.state = 'building';
      u.targetId = building.id;
      u.carryAmt = 0;
    }
  }

  player.commandMode = 'none';
  player.buildChoice = null;
  addEvent(state, bType.toUpperCase() + ' PLACED', tx, ty);
  return true;
}

// Enter attack mode (click on map to send all military units)
export function cmdAttackMode(state, pi) {
  const military = state.units.filter(u => u.owner === pi && u.type !== 'sprout' && u.type !== 'mender');
  if (military.length === 0) { addEvent(state, 'NO FIGHTERS', 64, 64); return false; }
  state.players[pi].commandMode = 'attack';
  return true;
}

// Attack-move all military units to (tx,ty)
export function cmdAttackTarget(state, pi, tx, ty) {
  const player = state.players[pi];
  const military = state.units.filter(u => u.owner === pi && u.type !== 'sprout' && u.type !== 'mender');

  // Find enemy entity at target
  const enemyUnit = state.units.find(u =>
    state.players[u.owner].team !== player.team && u.tx === tx && u.ty === ty);
  const enemyBuilding = state.buildings.find(b => {
    if (state.players[b.owner].team === player.team) return false;
    const def = BUILDING_DEFS[b.type];
    return tx >= b.tx && tx < b.tx + def.size && ty >= b.ty && ty < b.ty + def.size;
  });
  const target = enemyUnit || enemyBuilding;

  for (const u of military) {
    if (target) {
      u.targetId = target.id;
      u.state = 'attacking';
      const path = findPath(state.map, u.tx, u.ty, target.tx ?? tx, target.ty ?? ty);
      u.path = path;
      u.pathIdx = 0;
    } else {
      // Attack-move to location
      const path = findPath(state.map, u.tx, u.ty, tx, ty);
      if (path) {
        u.path = path;
        u.pathIdx = 0;
        u.state = 'moving';
        u.targetTx = tx;
        u.targetTy = ty;
      }
    }
  }

  player.commandMode = 'none';
  return military.length > 0;
}

// Train a unit type at the first available building
export function cmdTrain(state, pi, unitType) {
  const player = state.players[pi];
  const uDef = UNIT_DEFS[unitType];
  if (!uDef) return false;

  if (player.unitCount >= player.maxUnits) {
    addEvent(state, 'POP CAP REACHED', player.cursorTx, player.cursorTy);
    return false;
  }
  if (player.resources.food < uDef.cost.food || player.resources.gold < uDef.cost.gold) {
    addEvent(state, 'NOT ENOUGH RESOURCES', player.cursorTx, player.cursorTy);
    return false;
  }

  // Find first building that can train this type and isn't busy
  const building = state.buildings.find(b => {
    if (b.owner !== pi || !b.built || b.trainType) return false;
    const trainable = TRAIN_TABLE[b.type];
    return trainable && trainable.includes(unitType);
  });

  if (!building) {
    addEvent(state, 'NO BUILDING AVAILABLE', player.cursorTx, player.cursorTy);
    return false;
  }

  player.resources.food -= uDef.cost.food;
  player.resources.gold -= uDef.cost.gold;
  building.trainType = unitType;
  building.trainProgress = 0;
  building.trainTime = uDef.buildTime;
  player.commandMode = 'none';
  return true;
}

// Enter train mode (shows available unit types)
export function cmdTrainMode(state, pi) {
  // Check if we have any training buildings
  const hasTrainer = state.buildings.some(b => b.owner === pi && b.built && TRAIN_TABLE[b.type]);
  if (!hasTrainer) { addEvent(state, 'BUILD A NEST OR BARRACKS', 64, 64); return false; }
  state.players[pi].commandMode = 'train';
  return true;
}

// Cancel current command mode
export function cmdCancel(state, pi) {
  const player = state.players[pi];
  player.commandMode = 'none';
  player.buildChoice = null;
  return true;
}

// Click on map in 'none' mode — select entity for info
export function cmdSelect(state, pi, tx, ty) {
  const player = state.players[pi];

  // Look for own unit at cursor
  const unit = state.units.find(u => u.owner === pi && u.tx === tx && u.ty === ty);
  if (unit) {
    player.selectedId = unit.id;
    return true;
  }

  // Look for own building at cursor
  const building = state.buildings.find(b => {
    if (b.owner !== pi) return false;
    const def = BUILDING_DEFS[b.type];
    return tx >= b.tx && tx < b.tx + def.size && ty >= b.ty && ty < b.ty + def.size;
  });
  if (building) {
    player.selectedId = building.id;
    return true;
  }

  // Clicked empty ground — deselect
  player.selectedId = -1;
  return false;
}

// ---- Share / Request (unchanged) ----

export function processShareKey(state, pi) {
  const player = state.players[pi];
  if (player.shareCooldown > 0) {
    addEvent(state, 'SHARE ON COOLDOWN', player.cursorTx, player.cursorTy);
    return false;
  }
  player.commandMode = 'share';
  return true;
}

export function processRequestKey(state, pi) {
  const player = state.players[pi];
  if (player.requestCooldown > 0) {
    addEvent(state, 'REQUEST ON COOLDOWN', player.cursorTx, player.cursorTy);
    return false;
  }
  player.commandMode = 'request';
  return true;
}

export function processShareChoice(state, pi, num) {
  const player = state.players[pi];
  const teammate = state.players.find(p => p.team === player.team && p.index !== pi);
  if (!teammate) { player.commandMode = 'none'; return false; }

  let type, amount;
  switch (num) {
    case 1: type = 'food'; amount = 50; break;
    case 2: type = 'food'; amount = 100; break;
    case 3: type = 'gold'; amount = 50; break;
    case 4: type = 'gold'; amount = 100; break;
    default: player.commandMode = 'none'; return false;
  }

  if (player.resources[type] < amount) {
    addEvent(state, 'NOT ENOUGH ' + type.toUpperCase(), player.cursorTx, player.cursorTy);
    player.commandMode = 'none';
    return false;
  }

  const tax = Math.floor(amount * 0.15);
  player.resources[type] -= amount;
  teammate.resources[type] += amount - tax;
  player.shareCooldown = 45;
  addEvent(state, `SENT ${amount - tax} ${type.toUpperCase()}`, player.cursorTx, player.cursorTy);
  player.commandMode = 'none';
  return true;
}

export function processRequestChoice(state, pi, num) {
  const player = state.players[pi];
  const teammate = state.players.find(p => p.team === player.team && p.index !== pi);
  if (!teammate) { player.commandMode = 'none'; return false; }

  let type;
  switch (num) {
    case 1: type = 'food'; break;
    case 2: type = 'gold'; break;
    default: player.commandMode = 'none'; return false;
  }

  teammate.pendingRequest = { from: pi, type };
  player.requestCooldown = 30;
  addEvent(state, 'REQUESTED ' + type.toUpperCase(), player.cursorTx, player.cursorTy);
  player.commandMode = 'none';
  return true;
}

// Upgrade via academy (click on academy building to see upgrades)
export function cmdUpgrade(state, pi, optionIdx) {
  const player = state.players[pi];
  const tier = player.upgradeTier;
  if (tier >= UPGRADES.length) {
    addEvent(state, 'ALL UPGRADED', player.cursorTx, player.cursorTy);
    return false;
  }
  const options = UPGRADES[tier].options;
  if (optionIdx < 0 || optionIdx >= options.length) return false;

  const upgrade = options[optionIdx];
  if (player.resources.food < upgrade.cost.food || player.resources.gold < upgrade.cost.gold) {
    addEvent(state, 'NOT ENOUGH RESOURCES', player.cursorTx, player.cursorTy);
    return false;
  }

  // Must have an academy
  const academy = state.buildings.find(b => b.owner === pi && b.type === 'academy' && b.built);
  if (!academy) {
    addEvent(state, 'NEED ACADEMY', player.cursorTx, player.cursorTy);
    return false;
  }

  player.resources.food -= upgrade.cost.food;
  player.resources.gold -= upgrade.cost.gold;

  const team = player.team;
  for (const p of state.players) {
    if (p.team === team) {
      p.upgrades.push(upgrade.id);
      p.upgradeTier = Math.max(p.upgradeTier, tier + 1);
    }
  }

  applyUpgrade(state, team, upgrade.id);
  addEvent(state, upgrade.name.toUpperCase() + '!', player.cursorTx, player.cursorTy);
  return true;
}

// ---- Helpers ----------------------------------------------------------------

function findNearestResource(state, fromTx, fromTy, tileType) {
  let best = null;
  let bestDist = Infinity;
  // Search in expanding rings for efficiency
  const maxR = 40;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only ring edges
        const tx = fromTx + dx;
        const ty = fromTy + dy;
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
        if (state.map.getTile(tx, ty) === tileType) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestDist) {
            bestDist = d;
            best = { tx, ty };
          }
        }
      }
    }
    if (best) return best;
  }
  return best;
}

function applyUpgrade(state, team, upgradeId) {
  switch (upgradeId) {
    case 'thick_shells':
      for (const u of state.units) {
        if (state.players[u.owner].team === team) {
          u.maxHp += 15;
          u.hp += 15;
        }
      }
      break;
    case 'fortress':
      for (const b of state.buildings) {
        if (state.players[b.owner].team === team) {
          b.maxHp += 100;
          b.hp = Math.min(b.hp + 100, b.maxHp);
        }
      }
      break;
  }
}

function addEvent(state, text, tx, ty) {
  state.events.push({ text, tx, ty, elapsed: 0, duration: 2.0 });
}

// Re-export for backward compatibility with simulation.js
export { findEntity } from './entities.js';
