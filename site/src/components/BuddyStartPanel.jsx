// BuddyStartPanel — small "Create or join buddy pass" widget shown in the
// arcade when no buddy session is active. Offers both flows: creation (which
// generates a pairId and opens a session) and joining (inline 6-char input).

import { useState } from 'react';
import { useBuddy } from '../multiplayer/BuddyProvider.jsx';

export default function BuddyStartPanel() {
  const buddy = useBuddy();
  const [mode, setMode] = useState('idle'); // 'idle' | 'joining'
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  // Don't render if a buddy session is already active.
  if (buddy.isActive) return null;

  const handleCreate = () => {
    setError('');
    buddy.createBuddyPass();
  };

  const handleJoin = (e) => {
    e?.preventDefault?.();
    setError('');
    const ok = buddy.joinBuddyPass(code);
    if (!ok) setError('Invalid code.');
    else setMode('idle');
  };

  return (
    <div className="p-3 bg-gb-darkest text-gb-lightest border border-gb-light text-[10px] flex flex-col gap-2 max-w-[220px]">
      <div className="tracking-widest">PLAY WITH A BUDDY</div>
      <p className="text-gb-light leading-snug">
        Pair up to browse the arcade and join games together over the internet.
      </p>

      {mode === 'idle' && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleCreate}
            className="px-2 py-1 bg-gb-dark border border-gb-light hover:bg-gb-light hover:text-gb-darkest"
          >
            CREATE BUDDY PASS
          </button>
          <button
            type="button"
            onClick={() => setMode('joining')}
            className="px-2 py-1 border border-gb-light hover:bg-gb-dark"
          >
            JOIN WITH CODE
          </button>
        </div>
      )}

      {mode === 'joining' && (
        <form onSubmit={handleJoin} className="flex flex-col gap-1">
          <input
            autoFocus
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC234"
            className="px-2 py-1 bg-gb-dark text-gb-lightest border border-gb-light tracking-[0.3em] text-center"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              className="flex-1 px-2 py-1 bg-gb-dark border border-gb-light hover:bg-gb-light hover:text-gb-darkest"
            >
              JOIN
            </button>
            <button
              type="button"
              onClick={() => { setMode('idle'); setCode(''); setError(''); }}
              className="px-2 py-1 border border-gb-light hover:bg-gb-dark"
            >
              ×
            </button>
          </div>
          {error && <span className="text-gb-light">{error}</span>}
        </form>
      )}
    </div>
  );
}
