# Build a plus1.games game

You are Claude Code, building one new co-op browser game for plus1.games.

The game id you are building is in the environment variable `GAME_ID`. Look it up in `pipeline/games.json` — that record contains the full spec (name, original base game, co-op spin, win rules, turn rules, move rules, setup, art notes).

## Your job

1. Read `pipeline/games.json`, find the entry where `id === GAME_ID`. Read its full spec.
2. Read `site/src/games/_template/` to understand the expected structure.
3. Read `site/src/multiplayer/README.md` to understand the multiplayer API. Use `connect()` from `site/src/multiplayer` for two-player networking. Pick the connection type that fits the game (default to `roomCode`).
4. Create the folder `site/src/games/<GAME_ID>/`:
   - `index.jsx` — default-export a React component implementing the full game
   - `spec.json` — copy the spec from games.json for this id
   - `assets/` if you need any
5. Add a route for the game in `site/src/App.jsx` at path `/games/<GAME_ID>` that lazy-imports `./games/<GAME_ID>/index.jsx`.
6. Add an arcade machine entry to `site/src/arcade/world.js`. Pick a free spot inside the world bounds (256×240). Format: `{ id: '<GAME_ID>', name: '<name>', x: <int>, y: <int>, gameRoute: '/games/<GAME_ID>' }`.
7. Update the game's record in `pipeline/games.json`: set `status` to `"testing"`. Do not touch `approvedAt`. Do not set `deployedAt` — that happens on merge.
8. Make sure `cd site && npm run build` succeeds. Fix any errors.

## Constraints

- Use only React, Tailwind, the existing palette in `tailwind.config.js`, and the multiplayer API. No new dependencies.
- The game must work for exactly two players. Stub-friendly is fine: if multiplayer is not testable in CI, the game should still render and accept input from a single player for the preview.
- Keep the game small. ~200-400 lines of game code is the target.
- Match the GameBoy pixel-art aesthetic — chunky pixels, the `gb` palette colors.
- Do not modify any other game folders.

When done, the PR will be opened automatically. The user will play the Cloudflare Pages preview, then merge to deploy.
