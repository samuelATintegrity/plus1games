#!/usr/bin/env node
// Daily build orchestrator. Picks the oldest "approved" game and prints its id.
// The GitHub Action consumes that id and hands it to the Claude Code Action,
// which builds the game folder under site/src/games/<id>/.
//
// Local usage:
//   node pipeline/build/build-daily.js --pick    # prints the id (or empty)
//   node pipeline/build/build-daily.js --list    # lists all approved games

import { listByStatus, setStatus } from '../lib/games-db.js';

const args = process.argv.slice(2);

function pickOldestApproved() {
  const approved = listByStatus('approved');
  if (approved.length === 0) return null;
  approved.sort((a, b) => {
    const ta = a.approvedAt ?? a.createdAt ?? '';
    const tb = b.approvedAt ?? b.createdAt ?? '';
    return ta.localeCompare(tb);
  });
  return approved[0];
}

if (args.includes('--list')) {
  const approved = listByStatus('approved');
  if (approved.length === 0) {
    console.log('No approved games waiting to build.');
  } else {
    for (const g of approved) console.log(`${g.id}\t${g.name}`);
  }
  process.exit(0);
}

if (args.includes('--pick')) {
  const game = pickOldestApproved();
  if (!game) {
    // Print nothing — GitHub Action checks for empty output.
    process.exit(0);
  }
  process.stdout.write(game.id);
  process.exit(0);
}

if (args.includes('--mark-building')) {
  const game = pickOldestApproved();
  if (!game) {
    console.log('Nothing to mark.');
    process.exit(0);
  }
  setStatus(game.id, 'building');
  console.log(`Marked ${game.id} as building.`);
  process.exit(0);
}

console.log(`Usage:
  build-daily.js --pick           Print the id of the next game to build (or nothing).
  build-daily.js --list           List all approved games.
  build-daily.js --mark-building  Mark the next game as 'building'.

To actually trigger a build, push to GitHub and run the "Daily Game Build" workflow.`);
