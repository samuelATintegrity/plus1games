// Starbloom — game state factory, constants, and palette.

import { generateMap } from './map.js';
import { makeBuilding, makeUnit, UNIT_DEFS, BUILDING_DEFS } from './entities.js';

// GameBoy DMG palette
export const C = {
  darkest:  '#0f380f',
  dark:     '#306230',
  light:    '#8bac0f',
  lightest: '#9bbc0f',
};

// Display
export const LOGICAL_W = 320;
export const LOGICAL_H = 240;
export const SCALE = 3;

// Map
export const TILE_SIZE = 8;
export const MAP_W = 128;
export const MAP_H = 128;

// Viewport (inside HUD)
export const HUD_TOP_H = 16;
export const HUD_BOT_H = 48;
export const VP_X = 0;
export const VP_Y = HUD_TOP_H;
export const VP_W = LOGICAL_W;          // 320
export const VP_H = LOGICAL_H - HUD_TOP_H - HUD_BOT_H; // 176

// Minimap area in bottom bar
export const MINIMAP_X = 272;
export const MINIMAP_Y = LOGICAL_H - HUD_BOT_H; // 192
export const MINIMAP_W = 48;
export const MINIMAP_H = 48;

// Command bar area in bottom bar (left of minimap)
export const CMD_BAR_X = 0;
export const CMD_BAR_Y = LOGICAL_H - HUD_BOT_H; // 192
export const CMD_BAR_W = MINIMAP_X - 2;          // 270
export const CMD_BAR_H = HUD_BOT_H;              // 48

// Simulation
export const TICKS_PER_SEC = 30;

// Sight radii (in tiles)
export const SIGHT_RADIUS = {
  sprout: 6,
  bonker: 5,
  lobber: 7,
  stomper: 4,
  mender: 5,
  building: 7,
};

// Starting positions per player index (tile coords)
// Team 0: top-left quadrant, Team 1: bottom-right quadrant
export const START_POS = [
  { tx: 14, ty: 14 },   // player 0 (team 0)
  { tx: 14, ty: 32 },   // player 1 (team 0)
  { tx: 113, ty: 95 },  // player 2 (team 1)
  { tx: 113, ty: 113 }, // player 3 (team 1)
];

// Upgrades
export const UPGRADES = [
  {
    tier: 1,
    options: [
      { id: 'sharp_tools', name: 'Sharp Tools', desc: 'Sprouts gather 25% faster', cost: { food: 150, gold: 100 } },
      { id: 'thick_shells', name: 'Thick Shells', desc: 'All units +15 HP', cost: { food: 150, gold: 100 } },
    ],
  },
  {
    tier: 2,
    options: [
      { id: 'long_arms', name: 'Long Arms', desc: 'Ranged units +1 range', cost: { food: 200, gold: 150 } },
      { id: 'fast_feet', name: 'Fast Feet', desc: 'All units +20% speed', cost: { food: 200, gold: 150 } },
    ],
  },
  {
    tier: 3,
    options: [
      { id: 'rally_cry', name: 'Rally Cry', desc: 'Units near Nest +3 dmg', cost: { food: 250, gold: 200 } },
      { id: 'fortress', name: 'Fortress', desc: 'Buildings +100 HP', cost: { food: 250, gold: 200 } },
    ],
  },
];

// Player factory
function makePlayer(index, teamIndex, isHuman) {
  const start = START_POS[index];
  return {
    index,
    team: teamIndex,
    isHuman,
    resources: { food: 200, gold: 100 },
    unitCount: 0,
    buildingCount: 0,
    maxUnits: 5,            // increases with buildings
    selectedId: -1,         // clicked entity (for info display)
    commandMode: 'none',    // 'none' | 'build' | 'build_place' | 'attack' | 'train'
    buildChoice: null,      // building type when in build_place mode
    cursorTx: start.tx,
    cursorTy: start.ty,
    cameraX: start.tx * TILE_SIZE - VP_W / 2,
    cameraY: start.ty * TILE_SIZE - VP_H / 2,
    shareCooldown: 0,
    requestCooldown: 0,
    pendingRequest: null,   // { from, type } when teammate requests
    upgrades: [],           // list of upgrade ids applied
    upgradeTier: 0,         // next available tier (0 = tier 1 not yet purchased)
  };
}

// Full game state factory
export function makeGameState(config = {}) {
  const seed = config.seed ?? (Date.now() & 0xFFFF);
  const mode = config.mode ?? 'vsai';  // 'vsai' | 'pvp'
  const difficulty = config.difficulty ?? 'medium';

  const map = generateMap(seed);

  const players = [
    makePlayer(0, 0, true),
    makePlayer(1, 0, mode === 'pvp' || mode === 'vsai'),
    makePlayer(2, 1, mode === 'pvp'),
    makePlayer(3, 1, mode === 'pvp'),
  ];
  // In vsai mode, player 1 is AI ally, players 2-3 are AI enemies
  if (mode === 'vsai') {
    players[1].isHuman = false;
    players[2].isHuman = false;
    players[3].isHuman = false;
  }

  // Fog of war per team: 0=unexplored, 1=explored, 2=visible
  const fogSize = MAP_W * MAP_H;
  const fog = [
    new Uint8Array(fogSize), // team 0
    new Uint8Array(fogSize), // team 1
  ];

  const state = {
    map,
    seed,
    mode,
    difficulty,
    players,
    units: [],
    buildings: [],
    fog,
    tick: 0,
    phase: 'menu',      // 'menu' | 'playing' | 'wonder' | 'over'
    wonderOwner: -1,
    wonderTimer: 0,
    winTeam: -1,
    events: [],          // { text, tx, ty, elapsed, duration }
    particles: [],       // { x, y, frame, maxFrame }
    nextId: 1,
    // Mouse state (used by renderer for hover effects)
    mouseLogX: -1,
    mouseLogY: -1,
    hoveredBtn: null,    // id of hovered command button
  };

  // Place starting Nest + 3 Sprouts for each player
  for (let pi = 0; pi < 4; pi++) {
    const sp = START_POS[pi];
    const nest = makeBuilding(state, pi, 'nest', sp.tx, sp.ty);
    nest.built = true;
    nest.buildProgress = BUILDING_DEFS.nest.buildTime;
    state.buildings.push(nest);
    state.players[pi].buildingCount++;
    state.players[pi].maxUnits += BUILDING_DEFS.nest.popBonus;

    // Mark tiles as built
    for (let dy = 0; dy < BUILDING_DEFS.nest.size; dy++) {
      for (let dx = 0; dx < BUILDING_DEFS.nest.size; dx++) {
        map.setTile(sp.tx + dx, sp.ty + dy, 4); // BUILT
      }
    }

    // 3 Sprouts near the nest
    for (let i = 0; i < 3; i++) {
      const ux = sp.tx + BUILDING_DEFS.nest.size + i;
      const uy = sp.ty;
      const unit = makeUnit(state, pi, 'sprout', ux, uy);
      state.units.push(unit);
      state.players[pi].unitCount++;
    }
  }

  return state;
}
