# multiplayer

Real-time two-player networking. All three connection types return a `Session` (see `session.js`) backed by [PartyKit](https://partykit.io) on Cloudflare Workers. The PartyKit server lives in `/partykit` at the repo root.

| type        | how it works |
|-------------|--------------|
| `buddyPass` | Persistent partner room. Both buddies share a stable `pairId`. Used by the arcade for jump-in presence. |
| `roomCode`  | Host calls `createRoom()` → gets a 4-digit code → guest calls `joinRoom(code)`. |
| `openMatch` | `joinOpenMatch({ gameId })` enters a matchmaking lobby; server pairs the first two players and reconnects them to a fresh play room. |

## Usage in a game

```js
import { connect } from '../../multiplayer';

// host
const session = await connect({ type: 'roomCode' });
console.log('share this code:', session.code);

// guest
const session = await connect({ type: 'roomCode', code: '1234' });

// open match
const session = await connect({ type: 'openMatch', gameId: 'tetris-2p' });

// listen + send
session.on('message', ({ from, data }) => console.log(from, data));
session.on('player-join', () => {});
session.on('player-leave', () => {});
session.send({ kind: 'move', x: 5, y: 7 });
session.close();
```

## Local dev

You need both servers running:

```bash
# terminal 1
cd partykit && npm run dev      # PartyKit on :1999

# terminal 2
cd site && npm run dev          # Vite on :5173
```

## Production

After `npx partykit deploy` from `/partykit`, set `VITE_PARTYKIT_HOST` in `site/.env` (and in Cloudflare Pages env vars) to the deployed host.
