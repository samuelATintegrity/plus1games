// Read/write helpers for pipeline/games.json with schema validation.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = resolve(__dirname, '..');
const GAMES_PATH = resolve(PIPELINE_DIR, 'games.json');
const SCHEMA_PATH = resolve(PIPELINE_DIR, 'game-schema.json');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export const STATUSES = ['brainstormed', 'approved', 'building', 'testing', 'deployed'];

export function loadAll() {
  const raw = readFileSync(GAMES_PATH, 'utf8');
  return JSON.parse(raw);
}

export function saveAll(games) {
  for (const g of games) {
    if (!validate(g)) {
      const msg = ajv.errorsText(validate.errors, { dataVar: g.id || 'game' });
      throw new Error(`Invalid game spec: ${msg}`);
    }
  }
  // Atomic write — write to tmp then rename.
  const tmp = `${GAMES_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(games, null, 2) + '\n', 'utf8');
  renameSync(tmp, GAMES_PATH);
}

export function listByStatus(status) {
  return loadAll().filter((g) => g.status === status);
}

export function findById(id) {
  return loadAll().find((g) => g.id === id) || null;
}

export function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  const games = loadAll();
  const game = games.find((g) => g.id === id);
  if (!game) throw new Error(`No game with id ${id}`);
  game.status = status;
  const now = new Date().toISOString();
  if (status === 'approved' && !game.approvedAt) game.approvedAt = now;
  if (status === 'deployed' && !game.deployedAt) game.deployedAt = now;
  saveAll(games);
  return game;
}

export function addGame(partial) {
  const games = loadAll();
  const now = new Date().toISOString();
  const game = {
    id: partial.id,
    name: partial.name ?? '',
    originalBaseGame: partial.originalBaseGame ?? '',
    coopSpin: partial.coopSpin ?? '',
    winRules: partial.winRules ?? '',
    turnRules: partial.turnRules ?? 'real-time',
    moveRules: partial.moveRules ?? '',
    setupInstructions: partial.setupInstructions ?? '',
    playerCount: 2,
    buildComplexity: partial.buildComplexity ?? 'small',
    artStyleNotes: partial.artStyleNotes ?? '',
    status: partial.status ?? 'brainstormed',
    createdAt: partial.createdAt ?? now,
    approvedAt: partial.approvedAt ?? null,
    deployedAt: partial.deployedAt ?? null,
  };
  if (games.some((g) => g.id === game.id)) {
    throw new Error(`Duplicate game id: ${game.id}`);
  }
  games.push(game);
  saveAll(games);
  return game;
}

export function getSchema() {
  return schema;
}
