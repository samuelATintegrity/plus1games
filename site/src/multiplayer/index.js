// Public multiplayer API. Games should import from here.
import { connectBuddyPass } from './buddyPass.js';
import { createRoom, joinRoom } from './roomCode.js';
import { joinOpenMatch } from './openMatch.js';

export { connectBuddyPass, createRoom, joinRoom, joinOpenMatch };

// Convenience dispatcher.
//   connect({ type: 'buddyPass', buddyId })
//   connect({ type: 'roomCode', code })            // join
//   connect({ type: 'roomCode' })                  // host
//   connect({ type: 'openMatch', gameId })
export async function connect(opts) {
  switch (opts.type) {
    case 'buddyPass': return connectBuddyPass(opts);
    case 'roomCode':  return opts.code ? joinRoom(opts.code) : createRoom();
    case 'openMatch': return joinOpenMatch(opts);
    default: throw new Error(`Unknown session type: ${opts.type}`);
  }
}
