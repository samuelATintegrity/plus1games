// Starbloom — core simulation tick.
//
// Handles: unit movement, resource gathering, building construction,
// unit training, combat, healing, towers, wonder countdown.

import { TILE_SIZE, TICKS_PER_SEC, MAP_W, MAP_H } from './state.js';
import { UNIT_DEFS, BUILDING_DEFS, makeUnit, removeUnit, removeBuilding, findEntity } from './entities.js';
import { TILE, depleteResource, getResourceRemaining } from './map.js';
import { findPath, tileDist } from './pathfinding.js';
import { updateFog } from './fog.js';

const GATHER_TIME = 3.0;   // seconds at resource node
const CARRY_AMT = { food: 8, gold: 6 };
const WONDER_COUNTDOWN = 300; // 5 minutes in seconds
const ATTACK_COOLDOWN = 1.0;
const TOWER_COOLDOWN = 1.5;
const HEAL_RATE = 4;        // HP per second
const RETREAT_HP_RATIO = 0.2;
const KNOCKBACK_MELEE = 2;  // pixels
const KNOCKBACK_STOMPER = 4;
const DIZZY_DURATION = 0.5;

export function tickSimulation(state, dt) {
  state.tick++;

  // Update cooldowns
  for (const p of state.players) {
    if (p.shareCooldown > 0) p.shareCooldown = Math.max(0, p.shareCooldown - dt);
    if (p.requestCooldown > 0) p.requestCooldown = Math.max(0, p.requestCooldown - dt);
  }

  // Update events
  for (let i = state.events.length - 1; i >= 0; i--) {
    state.events[i].elapsed += dt;
    if (state.events[i].elapsed >= state.events[i].duration) {
      state.events.splice(i, 1);
    }
  }

  // Update particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    state.particles[i].frame += dt * 8;
    if (state.particles[i].frame >= state.particles[i].maxFrame) {
      state.particles.splice(i, 1);
    }
  }

  // Process units
  const unitsSnapshot = [...state.units]; // snapshot to avoid mutation issues
  for (const unit of unitsSnapshot) {
    if (!state.units.includes(unit)) continue; // was removed

    // Damage flash decay
    if (unit.flashTimer > 0) unit.flashTimer -= dt;
    if (unit.dizzyTimer > 0) {
      unit.dizzyTimer -= dt;
      continue; // can't act while dizzy
    }

    // Auto-retreat when low HP
    if (unit.hp <= unit.maxHp * RETREAT_HP_RATIO && unit.state !== 'retreating' && unit.state !== 'attacking') {
      const nearestFriendlyBuilding = findNearestBuilding(state, unit.owner, unit.tx, unit.ty);
      if (nearestFriendlyBuilding) {
        unit.path = findPath(state.map, unit.tx, unit.ty, nearestFriendlyBuilding.tx, nearestFriendlyBuilding.ty);
        unit.pathIdx = 0;
        unit.state = 'retreating';
      }
    }

    switch (unit.state) {
      case 'idle':
        tickIdle(state, unit, dt);
        break;
      case 'moving':
      case 'retreating':
        tickMoving(state, unit, dt);
        break;
      case 'gathering':
        tickGathering(state, unit, dt);
        break;
      case 'building':
        tickBuilding(state, unit, dt);
        break;
      case 'attacking':
        tickAttacking(state, unit, dt);
        break;
      case 'healing':
        tickHealing(state, unit, dt);
        break;
    }
  }

  // Process buildings
  for (const building of [...state.buildings]) {
    if (!state.buildings.includes(building)) continue;
    if (building.flashTimer > 0) building.flashTimer -= dt;

    // Tower auto-attack
    if (building.built && building.type === 'tower') {
      tickTower(state, building, dt);
    }

    // Unit training
    if (building.built && building.trainType) {
      tickTraining(state, building, dt);
    }
  }

  // Wonder countdown
  if (state.phase === 'wonder') {
    tickWonder(state, dt);
  }

  // Update fog of war
  updateFog(state);

  // Check elimination win condition
  checkElimination(state);
}

// ---- Unit ticking -----------------------------------------------------------

function tickIdle(state, unit, dt) {
  // Auto-engage: military units engage nearby enemies
  if (unit.type !== 'sprout' && unit.type !== 'mender') {
    const nearby = findNearestEnemy(state, unit);
    if (nearby && tileDist(unit.tx, unit.ty, nearby.tx, nearby.ty) <= getRange(state, unit) + 1) {
      unit.targetId = nearby.id;
      unit.state = 'attacking';
      return;
    }
  }

  // Mender: auto-heal nearby wounded ally
  if (unit.type === 'mender') {
    const wounded = findNearestWounded(state, unit);
    if (wounded && tileDist(unit.tx, unit.ty, wounded.tx, wounded.ty) <= getRange(state, unit)) {
      unit.targetId = wounded.id;
      unit.state = 'healing';
      return;
    }
  }

  // Sprout: flee from nearby enemies
  if (unit.type === 'sprout') {
    const nearby = findNearestEnemy(state, unit);
    if (nearby && tileDist(unit.tx, unit.ty, nearby.tx, nearby.ty) <= 2) {
      const fleeTx = unit.tx + Math.sign(unit.tx - nearby.tx) * 3;
      const fleeTy = unit.ty + Math.sign(unit.ty - nearby.ty) * 3;
      const path = findPath(state.map, unit.tx, unit.ty,
        Math.max(0, Math.min(MAP_W - 1, fleeTx)),
        Math.max(0, Math.min(MAP_H - 1, fleeTy)));
      if (path) {
        unit.path = path;
        unit.pathIdx = 0;
        unit.state = 'retreating';
      }
    }
  }
}

function tickMoving(state, unit, dt) {
  if (!unit.path || unit.pathIdx >= unit.path.length) {
    unit.state = 'idle';
    unit.path = null;
    return;
  }

  const [targetTx, targetTy] = unit.path[unit.pathIdx];
  const targetPx = targetTx * TILE_SIZE + TILE_SIZE / 2;
  const targetPy = targetTy * TILE_SIZE + TILE_SIZE / 2;
  const dx = targetPx - unit.px;
  const dy = targetPy - unit.py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const speed = getSpeed(state, unit) * dt;

  if (dist <= speed) {
    unit.px = targetPx;
    unit.py = targetPy;
    unit.tx = targetTx;
    unit.ty = targetTy;
    unit.pathIdx++;
  } else {
    unit.px += (dx / dist) * speed;
    unit.py += (dy / dist) * speed;
  }

  // Auto-engage while moving (not retreating)
  if (unit.state === 'moving' && unit.type !== 'sprout' && unit.type !== 'mender') {
    const nearby = findNearestEnemy(state, unit);
    if (nearby && tileDist(unit.tx, unit.ty, nearby.tx, nearby.ty) <= getRange(state, unit)) {
      unit.targetId = nearby.id;
      unit.state = 'attacking';
    }
  }
}

function tickGathering(state, unit, dt) {
  // Phase 1: Walk to resource
  if (unit.carryAmt === 0 && unit.path && unit.pathIdx < unit.path.length) {
    tickMoving(state, unit, dt);
    unit.state = 'gathering'; // restore state after tickMoving might set idle
    return;
  }

  // Phase 2: At resource node — gather
  if (unit.carryAmt === 0) {
    const tile = state.map.getTile(unit.targetTx, unit.targetTy);
    if (tile !== TILE.FOREST && tile !== TILE.ROCK) {
      // Resource depleted, go idle
      unit.state = 'idle';
      return;
    }
    // Walk to the exact tile if not there
    if (unit.tx !== unit.targetTx || unit.ty !== unit.targetTy) {
      const path = findPath(state.map, unit.tx, unit.ty, unit.targetTx, unit.targetTy);
      if (path) { unit.path = path; unit.pathIdx = 0; }
      return;
    }

    const gatherMultiplier = hasUpgrade(state, unit.owner, 'sharp_tools') ? 0.75 : 1.0;
    unit.gatherTimer += dt;
    if (unit.gatherTimer >= GATHER_TIME * gatherMultiplier) {
      unit.gatherTimer = 0;
      unit.carryAmt = CARRY_AMT[unit.carryType];
      depleteResource(unit.targetTx, unit.targetTy);
      const rem = getResourceRemaining(unit.targetTx, unit.targetTy);
      if (rem <= 0) {
        state.map.setTile(unit.targetTx, unit.targetTy, TILE.GRASS);
      }
      // Path to nearest depot
      const depot = findNearestDepot(state, unit.owner, unit.tx, unit.ty);
      if (depot) {
        const path = findPath(state.map, unit.tx, unit.ty, depot.tx, depot.ty);
        if (path) { unit.path = path; unit.pathIdx = 0; }
      }
    }
    return;
  }

  // Phase 3: Carrying — walk to depot
  if (unit.path && unit.pathIdx < unit.path.length) {
    tickMoving(state, unit, dt);
    unit.state = 'gathering';
    return;
  }

  // Phase 4: At depot — deposit
  const depot = findNearestDepot(state, unit.owner, unit.tx, unit.ty);
  if (depot && tileDist(unit.tx, unit.ty, depot.tx, depot.ty) <= 2) {
    state.players[unit.owner].resources[unit.carryType] += unit.carryAmt;
    addEvent(state, `+${unit.carryAmt}`, depot.tx, depot.ty - 1);
    unit.carryAmt = 0;
    // Return to resource
    const path = findPath(state.map, unit.tx, unit.ty, unit.targetTx, unit.targetTy);
    if (path) { unit.path = path; unit.pathIdx = 0; }
  } else if (depot) {
    const path = findPath(state.map, unit.tx, unit.ty, depot.tx, depot.ty);
    if (path) { unit.path = path; unit.pathIdx = 0; }
  } else {
    unit.state = 'idle';
  }
}

function tickBuilding(state, unit, dt) {
  const target = state.buildings.find(b => b.id === unit.targetId);
  if (!target || target.built) {
    unit.state = 'idle';
    unit.targetId = -1;
    return;
  }

  // Walk to building site
  if (tileDist(unit.tx, unit.ty, target.tx, target.ty) > 2) {
    if (!unit.path || unit.pathIdx >= unit.path.length) {
      const path = findPath(state.map, unit.tx, unit.ty, target.tx, target.ty);
      if (path) { unit.path = path; unit.pathIdx = 0; }
      else { unit.state = 'idle'; return; }
    }
    tickMoving(state, unit, dt);
    unit.state = 'building';
    return;
  }

  // At site — construct
  // Check if multiple sprouts are building the same thing
  const builders = state.units.filter(u => u.state === 'building' && u.targetId === target.id);
  const speedMultiplier = 1 + (builders.length - 1) * 0.5; // 50% faster per extra builder
  target.buildProgress += dt * speedMultiplier;

  if (target.buildProgress >= target.buildTime) {
    target.built = true;
    target.buildProgress = target.buildTime;
    const def = BUILDING_DEFS[target.type];
    state.players[target.owner].maxUnits += def.popBonus;

    addEvent(state, target.type.toUpperCase() + ' COMPLETE', target.tx, target.ty);

    // Check wonder
    if (target.type === 'starbloom') {
      state.phase = 'wonder';
      state.wonderOwner = target.owner;
      state.wonderTimer = WONDER_COUNTDOWN;
      addEvent(state, 'THE STARBLOOM HAS AWAKENED', 64, 64);
    }

    // Set all builders on this building to idle
    for (const u of builders) {
      u.state = 'idle';
      u.targetId = -1;
    }
  }
}

function tickAttacking(state, unit, dt) {
  let target = findEntity(state, unit.targetId);
  if (!target || ('hp' in target && target.hp <= 0)) {
    unit.state = 'idle';
    unit.targetId = -1;
    return;
  }

  const targetTx = target.tx;
  const targetTy = target.ty;
  const dist = tileDist(unit.tx, unit.ty, targetTx, targetTy);
  const range = getRange(state, unit);

  if (dist > range) {
    // Move toward target
    if (!unit.path || unit.pathIdx >= unit.path.length) {
      const path = findPath(state.map, unit.tx, unit.ty, targetTx, targetTy);
      if (path) { unit.path = path; unit.pathIdx = 0; }
      else { unit.state = 'idle'; return; }
    }
    tickMoving(state, unit, dt);
    unit.state = 'attacking';
    return;
  }

  // In range — attack
  unit.cooldown -= dt;
  if (unit.cooldown <= 0) {
    const dmg = getDamage(state, unit);
    target.hp -= dmg;
    target.flashTimer = 0.3;
    unit.cooldown = ATTACK_COOLDOWN;

    // Knockback
    if ('px' in target) {
      const kb = unit.type === 'stomper' ? KNOCKBACK_STOMPER : KNOCKBACK_MELEE;
      const dxDir = target.tx - unit.tx;
      const dyDir = target.ty - unit.ty;
      const len = Math.sqrt(dxDir * dxDir + dyDir * dyDir) || 1;
      target.px += (dxDir / len) * kb;
      target.py += (dyDir / len) * kb;
      if (target.dizzyTimer > 0) {
        target.dizzyTimer = DIZZY_DURATION;
      } else if (kb > 2) {
        target.dizzyTimer = DIZZY_DURATION;
      }
    }

    // Add projectile visual for lobber
    if (unit.type === 'lobber' && 'px' in target) {
      state.particles.push({
        x: unit.px, y: unit.py,
        tx: target.px, ty: target.py,
        frame: 0, maxFrame: 3, type: 'projectile',
      });
    }

    if (target.hp <= 0) {
      // POOF!
      const px = target.px ?? (target.tx * TILE_SIZE + TILE_SIZE / 2);
      const py = target.py ?? (target.ty * TILE_SIZE + TILE_SIZE / 2);
      state.particles.push({ x: px, y: py, frame: 0, maxFrame: 4, type: 'poof' });

      if ('state' in target) {
        removeUnit(state, target.id);
      } else {
        // Building poof — cascade
        const def = BUILDING_DEFS[target.type];
        for (let i = 0; i < Math.min(4, def.size * def.size); i++) {
          state.particles.push({
            x: px + (i % 2) * 6 - 3,
            y: py + Math.floor(i / 2) * 6 - 3,
            frame: -i * 0.5, maxFrame: 4, type: 'poof',
          });
        }
        removeBuilding(state, target.id);
      }
      unit.state = 'idle';
      unit.targetId = -1;
    }
  }
}

function tickHealing(state, unit, dt) {
  const target = state.units.find(u => u.id === unit.targetId);
  if (!target || target.hp >= target.maxHp) {
    unit.state = 'idle';
    unit.targetId = -1;
    // Look for next wounded
    const wounded = findNearestWounded(state, unit);
    if (wounded) {
      unit.targetId = wounded.id;
      unit.state = 'healing';
    }
    return;
  }

  const dist = tileDist(unit.tx, unit.ty, target.tx, target.ty);
  if (dist > getRange(state, unit)) {
    if (!unit.path || unit.pathIdx >= unit.path.length) {
      const path = findPath(state.map, unit.tx, unit.ty, target.tx, target.ty);
      if (path) { unit.path = path; unit.pathIdx = 0; }
      else { unit.state = 'idle'; return; }
    }
    tickMoving(state, unit, dt);
    unit.state = 'healing';
    return;
  }

  target.hp = Math.min(target.maxHp, target.hp + HEAL_RATE * dt);
}

function tickTower(state, building, dt) {
  if (!building.built) return;
  building.towerCooldown -= dt;
  if (building.towerCooldown > 0) return;

  const def = BUILDING_DEFS.tower;
  // Find nearest enemy unit in range
  let nearest = null;
  let nearestDist = Infinity;
  for (const u of state.units) {
    if (state.players[u.owner].team === state.players[building.owner].team) continue;
    const d = tileDist(building.tx, building.ty, u.tx, u.ty);
    if (d <= def.range && d < nearestDist) {
      // Prioritize units attacking buildings
      const priority = u.state === 'attacking' ? -100 : 0;
      if (d + priority < nearestDist) {
        nearestDist = d + priority;
        nearest = u;
      }
    }
  }

  if (nearest) {
    nearest.hp -= def.towerDmg;
    nearest.flashTimer = 0.3;
    building.towerCooldown = TOWER_COOLDOWN;

    state.particles.push({
      x: building.tx * TILE_SIZE + TILE_SIZE / 2,
      y: building.ty * TILE_SIZE + TILE_SIZE / 2,
      tx: nearest.px, ty: nearest.py,
      frame: 0, maxFrame: 3, type: 'projectile',
    });

    if (nearest.hp <= 0) {
      state.particles.push({ x: nearest.px, y: nearest.py, frame: 0, maxFrame: 4, type: 'poof' });
      removeUnit(state, nearest.id);
    }
  }
}

function tickTraining(state, building, dt) {
  building.trainProgress += dt;
  if (building.trainProgress >= building.trainTime) {
    const p = state.players[building.owner];
    if (p.unitCount >= p.maxUnits) {
      // Can't spawn, wait
      building.trainProgress = building.trainTime;
      return;
    }
    // Spawn unit adjacent to building
    const def = BUILDING_DEFS[building.type];
    const spawnTx = building.tx + def.size;
    const spawnTy = building.ty;
    const unit = makeUnit(state, building.owner, building.trainType, spawnTx, spawnTy);
    // Apply thick_shells upgrade
    if (hasUpgrade(state, building.owner, 'thick_shells')) {
      unit.maxHp += 15;
      unit.hp += 15;
    }
    state.units.push(unit);
    p.unitCount++;
    building.trainType = null;
    building.trainProgress = 0;
    building.trainTime = 0;
  }
}

function tickWonder(state, dt) {
  const wonder = state.buildings.find(b => b.type === 'starbloom' && b.built);
  if (!wonder) {
    state.phase = 'playing';
    state.wonderOwner = -1;
    state.wonderTimer = 0;
    addEvent(state, 'THE STARBLOOM HAS FALLEN', 64, 64);
    return;
  }

  state.wonderTimer -= dt;
  if (state.wonderTimer <= 0) {
    state.phase = 'over';
    state.winTeam = state.players[wonder.owner].team;
    addEvent(state, 'THE STARBLOOM BLOOMS', 64, 64);
  }
}

function checkElimination(state) {
  if (state.phase === 'over') return;
  for (let team = 0; team < 2; team++) {
    const teamPlayers = state.players.filter(p => p.team === team);
    const hasBuildings = state.buildings.some(b => teamPlayers.some(p => p.index === b.owner));
    if (!hasBuildings) {
      state.phase = 'over';
      state.winTeam = 1 - team;
      addEvent(state, 'TEAM ELIMINATED', 64, 64);
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

function findNearestEnemy(state, unit) {
  const team = state.players[unit.owner].team;
  let nearest = null;
  let nearestDist = Infinity;
  for (const u of state.units) {
    if (state.players[u.owner].team === team) continue;
    const d = tileDist(unit.tx, unit.ty, u.tx, u.ty);
    if (d < nearestDist) { nearestDist = d; nearest = u; }
  }
  return nearest;
}

function findNearestWounded(state, unit) {
  const team = state.players[unit.owner].team;
  let nearest = null;
  let nearestDist = Infinity;
  for (const u of state.units) {
    if (state.players[u.owner].team !== team) continue;
    if (u.id === unit.id) continue;
    if (u.hp >= u.maxHp) continue;
    const d = tileDist(unit.tx, unit.ty, u.tx, u.ty);
    if (d < nearestDist) { nearestDist = d; nearest = u; }
  }
  return nearest;
}

function findNearestBuilding(state, owner, tx, ty) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const b of state.buildings) {
    if (b.owner !== owner) continue;
    const d = tileDist(tx, ty, b.tx, b.ty);
    if (d < nearestDist) { nearestDist = d; nearest = b; }
  }
  return nearest;
}

function findNearestDepot(state, owner, tx, ty) {
  let nearest = null;
  let nearestDist = Infinity;
  const team = state.players[owner].team;
  for (const b of state.buildings) {
    if (state.players[b.owner].team !== team) continue;
    if (!b.built) continue;
    if (b.type !== 'nest' && b.type !== 'depot') continue;
    const d = tileDist(tx, ty, b.tx, b.ty);
    if (d < nearestDist) { nearestDist = d; nearest = b; }
  }
  return nearest;
}

export function hasUpgrade(state, ownerIdx, upgradeId) {
  return state.players[ownerIdx].upgrades.includes(upgradeId);
}

function getSpeed(state, unit) {
  let speed = UNIT_DEFS[unit.type].speed;
  if (hasUpgrade(state, unit.owner, 'fast_feet')) speed *= 1.2;
  // Wonder buff
  if (state.phase === 'wonder' && state.players[unit.owner].team === state.players[state.wonderOwner]?.team) {
    speed *= 1.1;
  }
  return speed;
}

function getRange(state, unit) {
  let range = UNIT_DEFS[unit.type].range;
  if (hasUpgrade(state, unit.owner, 'long_arms') && range > 1) range += 1;
  return range;
}

function getDamage(state, unit) {
  let dmg = UNIT_DEFS[unit.type].dmg;
  // Rally cry: near nest
  if (hasUpgrade(state, unit.owner, 'rally_cry')) {
    const nest = state.buildings.find(b => b.owner === unit.owner && b.type === 'nest');
    if (nest && tileDist(unit.tx, unit.ty, nest.tx, nest.ty) <= 8) {
      dmg += 3;
    }
  }
  // Wonder buff
  if (state.phase === 'wonder' && state.players[unit.owner].team === state.players[state.wonderOwner]?.team) {
    dmg += 2;
  }
  return dmg;
}

function addEvent(state, text, tx, ty) {
  state.events.push({ text, tx, ty, elapsed: 0, duration: 2.0 });
}
