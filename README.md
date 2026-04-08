# plus1.games

A two-player co-op browser game platform. Games are brainstormed with Claude, approved one-by-one, then built automatically — one per day — by Claude Code in a GitHub Action. Each build opens a PR with a Cloudflare Pages preview URL so you can play the game before deploying it to [plus1.games](https://plus1.games).

## How a game gets made

```
1. brainstorm  →  Claude generates ideas, appended to pipeline/games.json
2. approve     →  you edit games.json, change status: "brainstormed" → "approved"
3. build       →  daily GitHub Action picks the oldest approved game and runs
                  Claude Code to build it. Opens a PR.
4. preview     →  Cloudflare Pages auto-creates a preview URL on the PR.
                  You play the game with a friend.
5. deploy      →  merge the PR. Cloudflare Pages publishes to plus1.games.
```

Full pipeline doc: [`pipeline/PIPELINE.md`](pipeline/PIPELINE.md).

## Repo layout
```
site/        React + Vite frontend (the actual website)
partykit/    Realtime multiplayer server (Cloudflare Workers via PartyKit)
pipeline/    Brainstorm + daily-build scripts and the games.json source of truth
docs/        Long-form game specs (one .md per game)
.github/     Workflows for daily build + post-merge status update
```

## First-time setup (one-time, ~30 minutes)

### 1. Install dependencies
```bash
cd site && npm install && cd ..
cd pipeline && npm install && cd ..
cd partykit && npm install && cd ..
```

### 2. Set environment variables
```bash
cp .env.example .env
```
Edit `.env` and paste your Anthropic API key from https://console.anthropic.com.

### 3. Create the GitHub repo
If you have the GitHub CLI:
```bash
gh repo create plus1games --public --source=. --remote=origin --push
```
Otherwise, create one manually at https://github.com/new (name it `plus1games`), then:
```bash
git init
git add .
git commit -m "Initial scaffold"
git branch -M main
git remote add origin https://github.com/<your-username>/plus1games.git
git push -u origin main
```

### 4. Connect Cloudflare Pages to the repo
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Pick your `plus1games` repo
3. **Build settings**:
   - Framework preset: `None`
   - Build command: `cd site && npm install && npm run build`
   - Build output directory: `site/dist`
4. **Save and Deploy** — first build will run. Wait for it to finish.

### 5. Point plus1.games at the Pages project
1. Pages project → **Custom domains** → **Set up a custom domain** → enter `plus1.games`
2. Cloudflare auto-configures DNS since you bought the domain through Cloudflare Registrar.

### 6. Add your Anthropic key to GitHub
1. Repo on GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Name: `ANTHROPIC_API_KEY`
3. Value: your `sk-ant-...` key

### 7. Deploy the multiplayer server
```bash
cd partykit
npx partykit deploy
```
First time, it'll log you into Cloudflare. Copy the printed host (something like `plus1games.your-username.partykit.dev`) and:
- Paste into `.env` at the repo root as `VITE_PARTYKIT_HOST=...`
- Add it to Cloudflare Pages: project → Settings → **Environment variables** → add `VITE_PARTYKIT_HOST` for **Production**

### 8. Trigger your first deploy
```bash
git commit --allow-empty -m "Trigger deploy"
git push
```
Within ~2 minutes plus1.games should show the (empty) site.

## Day-to-day workflow

```bash
# 1. Generate ideas
cd pipeline && npm run brainstorm -- --count 5

# 2. Open pipeline/games.json, find ones you like, change status to "approved"

# 3. Wait for the daily build (or trigger manually):
#    GitHub repo → Actions → Daily Game Build → Run workflow

# 4. Open the PR, click the Cloudflare Pages preview link, play with a friend

# 5. Merge the PR. Done — it's live on plus1.games.
```

## Local development

```bash
# terminal 1
cd partykit && npm run dev      # PartyKit at 127.0.0.1:1999

# terminal 2
cd site && npm run dev          # Vite at http://localhost:5173
```
