// PartyKit server for plus1.games multiplayer.
//
// Room id prefix selects behavior:
//   buddy-<pairId>   persistent partner room (Buddy Pass)
//   room-<code>      4-digit room code session
//   match-<gameId>   matchmaking pool — server pairs the first two players
//                    and emits a `matched` message with a fresh play room id;
//                    clients then reconnect to play-<random> for the actual game.

export default {
  async onConnect(conn, room) {
    const id = room.id;
    const players = [...room.getConnections()];

    // Tell the new player who is here.
    conn.send(JSON.stringify({
      type: 'hello',
      yourId: conn.id,
      roomId: id,
      players: players.map((c) => c.id),
    }));

    // Tell everyone else someone joined.
    room.broadcast(
      JSON.stringify({ type: 'player-join', playerId: conn.id }),
      [conn.id]
    );

    // Open Match: pair the first two players and send them to a play room.
    if (id.startsWith('match-') && players.length === 2) {
      const playRoomId = `play-${crypto.randomUUID().slice(0, 8)}`;
      room.broadcast(JSON.stringify({
        type: 'matched',
        playRoomId,
        gameId: id.slice('match-'.length),
      }));
    }
  },

  async onMessage(message, sender, room) {
    // Re-broadcast every message to the rest of the room.
    room.broadcast(
      JSON.stringify({
        type: 'message',
        from: sender.id,
        data: typeof message === 'string' ? safeParse(message) : message,
      }),
      [sender.id]
    );
  },

  async onClose(conn, room) {
    room.broadcast(
      JSON.stringify({ type: 'player-leave', playerId: conn.id })
    );
  },
};

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
