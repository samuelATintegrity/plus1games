# partykit

Real-time multiplayer server for plus1.games. Runs on Cloudflare Workers via PartyKit.

## Develop locally
```bash
cd partykit
npm install        # one-time
npm run dev        # starts at 127.0.0.1:1999
```

## Deploy
```bash
npm run deploy
```
First time, you'll be asked to log in (uses your Cloudflare account). After deploy, copy the printed host (e.g. `plus1games.your-username.partykit.dev`) into:

- Repo root `.env` as `VITE_PARTYKIT_HOST=...` (for local site dev)
- Cloudflare Pages project → Settings → Environment variables → `VITE_PARTYKIT_HOST` (for production builds)

## Room types
| Room id prefix  | Used by      | Behavior |
|-----------------|--------------|----------|
| `buddy-<pairId>`| Buddy Pass   | Persistent room for two paired buddies |
| `room-<code>`   | Room Code    | 4-digit code, host + guest |
| `match-<gameId>`| Open Match   | Server pairs the first two players, sends them to a fresh `play-*` room |
| `play-<id>`     | (after match)| Actual game session created by Open Match |

See `server.js` — it's small and intentionally so.
