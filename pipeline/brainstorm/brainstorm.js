#!/usr/bin/env node
// Brainstorm new co-op game ideas with Claude and append them to games.json.
//
// Usage:
//   node pipeline/brainstorm/brainstorm.js               # default 5 ideas
//   node pipeline/brainstorm/brainstorm.js --count 10
//
// Requires ANTHROPIC_API_KEY in .env at the repo root.

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { loadAll, addGame, getSchema } from '../lib/games-db.js';

const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const COUNT = countIdx >= 0 ? parseInt(args[countIdx + 1], 10) : 5;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const client = new Anthropic();
const schema = getSchema();
const existing = loadAll();
const existingIds = new Set(existing.map((g) => g.id));
const existingBaseGames = existing.map((g) => g.originalBaseGame).filter(Boolean);

const systemPrompt = `You are a game designer for plus1.games — a site of small, fast, two-player co-op browser games. Each game is a co-op twist on a classic single-player or competitive game.

When asked, you generate fresh ideas as a strict JSON array. Every entry must conform to this JSON Schema:

${JSON.stringify(schema, null, 2)}

Rules:
- id is kebab-case, short, and unique
- playerCount is always 2
- status is always "brainstormed"
- createdAt, approvedAt, deployedAt are null
- coopSpin must clearly explain HOW two players cooperate (shared input, complementary roles, split screen, etc.)
- Prefer mechanics that work in a browser with keyboard input
- Variety: mix arcade, puzzle, rhythm, drawing, word, and reflex games
- Avoid duplicating these existing base games: ${existingBaseGames.join(', ') || '(none yet)'}
- Avoid these existing ids: ${[...existingIds].join(', ') || '(none yet)'}

Output ONLY the JSON array. No prose, no code fences.`;

const userPrompt = `Generate ${COUNT} new game ideas as a JSON array.`;

console.log(`Asking Claude for ${COUNT} ideas...`);

const response = await client.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }],
});

const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();

// Strip code fences if Claude added them anyway.
const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

let ideas;
try {
  ideas = JSON.parse(jsonText);
} catch (err) {
  console.error('Failed to parse Claude response as JSON:');
  console.error(text);
  process.exit(1);
}

if (!Array.isArray(ideas)) {
  console.error('Expected an array. Got:', typeof ideas);
  process.exit(1);
}

let added = 0;
let skipped = 0;
for (const idea of ideas) {
  try {
    if (existingIds.has(idea.id)) {
      skipped++;
      continue;
    }
    addGame({ ...idea, status: 'brainstormed' });
    existingIds.add(idea.id);
    added++;
    console.log(`  + ${idea.id} — ${idea.name}`);
  } catch (err) {
    console.warn(`  ! ${idea.id || '(no id)'}: ${err.message}`);
    skipped++;
  }
}

console.log(`\nDone. Added ${added}, skipped ${skipped}. Edit pipeline/games.json to flip ideas to "approved".`);
