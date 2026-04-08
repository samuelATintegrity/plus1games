# arcade

Top-down GameBoy-style world. The player character walks around with WASD or arrow keys; approaching an arcade machine and pressing Enter launches that game.

- `ArcadeView.jsx` — canvas + input + render loop
- `world.js` — machine placement (auto-populated by the build pipeline as games are deployed)

## Buddy Pass presence (TODO)
When two players are on a Buddy Pass session, both characters render in the world via `src/multiplayer/buddyPass.js`. If your buddy enters a game, you get an in-arcade notification.
