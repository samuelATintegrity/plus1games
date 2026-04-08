import { Session } from './session.js';

// Open Match — sit at a machine, get matched with anyone else waiting.
// Connects to `match-<gameId>`. The PartyKit server emits a 'matched' event
// with a fresh playRoomId; this helper transparently reconnects to that room
// and resolves with the play session.

export async function joinOpenMatch({ gameId } = {}) {
  if (!gameId) throw new Error('gameId required for open match');

  const lobby = new Session('openMatch', `match-${gameId}`, { gameId });

  return new Promise((resolve, reject) => {
    const onMatched = (msg) => {
      lobby.close();
      const play = new Session('openMatch', msg.playRoomId, { gameId });
      play.on('open', () => resolve(play));
    };
    lobby.on('matched', onMatched);
    lobby.on('close', () => {
      // If the lobby closes before matching, surface that as an error
      // unless we already promoted to a play session.
    });
    setTimeout(() => {
      // 60s lobby timeout
      reject(new Error('No partner found. Try again or share a Room Code.'));
      lobby.close();
    }, 60000);
  });
}
