// BuddyToast — notification toast that appears when a remote buddy enters a
// game. Offers a "Join" button that navigates to the same game URL with the
// buddy param so the two clients land in the same multiplexed session.
//
// Rendered by <Layout> as a fixed overlay; lives as long as the active pass.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuddy } from '../multiplayer/BuddyProvider.jsx';

const AUTO_DISMISS_MS = 12000;

export default function BuddyToast() {
  const buddy = useBuddy();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null); // { gameId, gameRoute, nickname }

  // Subscribe to enter-game events
  useEffect(() => {
    if (!buddy.isActive) return;
    return buddy.onEnterGame((evt) => {
      setToast({ gameId: evt.gameId, gameRoute: evt.gameRoute, nickname: evt.nickname });
    });
  }, [buddy.isActive, buddy.onEnterGame]);

  // Auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast) return null;

  const handleJoin = () => {
    const route = toast.gameRoute;
    const sep = route.includes('?') ? '&' : '?';
    navigate(`${route}${sep}buddy=${buddy.pairId}`);
    setToast(null);
  };

  const gameName = prettyGameName(toast.gameId);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gb-darkest text-gb-lightest border border-gb-light text-[11px] flex items-center gap-3 shadow-dsi">
      <span>
        <strong>{toast.nickname}</strong> jumped into <strong>{gameName}</strong>.
      </span>
      <button
        type="button"
        onClick={handleJoin}
        className="px-3 py-1 bg-gb-light text-gb-darkest hover:bg-gb-lightest"
      >
        JOIN
      </button>
      <button
        type="button"
        onClick={() => setToast(null)}
        className="text-gb-light hover:text-gb-lightest"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

function prettyGameName(gameId) {
  if (!gameId) return 'a game';
  return gameId
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
