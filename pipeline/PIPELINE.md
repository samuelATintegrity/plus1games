# plus1.games pipeline

End-to-end workflow for going from "we should make a game about X" to "it's live on plus1.games."

## Source of truth
`pipeline/games.json` is the local database of every game and its status. It conforms to `pipeline/game-schema.json` and is committed to git. Read/write helpers live in `pipeline/lib/games-db.js`.

## The five stages

```
brainstormed ──► approved ──► building ──► testing ──► deployed
   (Claude)      (you edit)   (CI)         (built,    (PR merged)
                                            in PR)
```

### 1. Brainstorm — `pipeline/brainstorm/`
```bash
cd pipeline
npm run brainstorm -- --count 5
```
Calls Claude with the schema as context. New ideas are appended to `games.json` with `status: "brainstormed"`. Existing base games are passed in as a no-dupes hint.

### 2. Approve
Open `pipeline/games.json`. Find ideas you like. Change their `status` from `"brainstormed"` to `"approved"`. (Optional: write a long-form spec to `docs/game-specs/<id>.md`.) Commit and push.

### 3. Build — `.github/workflows/daily-build.yml`
Runs on cron daily at 14:00 UTC, or manually via the **Run workflow** button in the GitHub Actions tab:
1. `node pipeline/build/build-daily.js --pick` finds the oldest approved game
2. `--mark-building` flips its status to `"building"`
3. The Anthropic Claude Code Action runs with `pipeline/build/build-prompt.md` and `GAME_ID` set
4. Claude Code creates `site/src/games/<id>/`, registers a route in `App.jsx`, adds an arcade machine to `world.js`, and flips status to `"testing"`
5. `peter-evans/create-pull-request` opens a PR titled `Build: <id>`

### 4. Preview & approve
Cloudflare Pages auto-creates a preview deployment for every PR. The link appears as a check on the PR. Open it, share the preview URL with a friend, play through the game.

If something is broken, comment on the PR and re-run the workflow, or push fixes to the build branch directly.

### 5. Deploy
Merge the PR. Cloudflare Pages publishes `main` to plus1.games. The `post-merge.yml` workflow then flips the game's status from `"testing"` to `"deployed"` and stamps `deployedAt`.

## How games appear in the site
- **List view** (`site/src/list/ListView.jsx`) imports `pipeline/games.json` at build time and shows everything with `status === "deployed"`.
- **Arcade view** (`site/src/arcade/ArcadeView.jsx`) reads `world.js`, which holds machine positions added during the build stage.

## Multiplayer
Every game uses `site/src/multiplayer/` for its session. Three connection types: `buddyPass`, `roomCode`, `openMatch`. Backed by PartyKit (`/partykit/`) on Cloudflare Workers. See `site/src/multiplayer/README.md`.

## Conventions
- One game per day, max
- IDs are kebab-case and immutable once approved
- Don't edit `games.json` by hand for status fields the pipeline owns (`building`, `testing`, `deployed`) — let the scripts manage them
