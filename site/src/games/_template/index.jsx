import { useEffect, useState } from 'react';
import { connect } from '../../multiplayer';

export default function GameTemplate() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    // Replace with the connection type appropriate for the game.
    connect({ type: 'roomCode', code: '0000' })
      .then(setSession)
      .catch((err) => console.error(err));
    return () => session?.close?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4">
      <h2 className="text-lg">Game Template</h2>
      <p className="text-xs text-gb-light">Replace this with your game.</p>
    </div>
  );
}
