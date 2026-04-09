// RoomCodePanel — the "Play with a friend" fallback shown on a game page
// when no buddy pass is active and no ?room= is set.
//
// Clicking "Create room" generates a fresh 4-digit code and appends
// `?room=<code>` to the URL. `useGameSession` picks that up on the next
// render and opens the actual `room-<code>` PartyKit session. Clicking
// "Join with code" asks for a code and does the same.
//
// By keeping session creation inside `useGameSession`, both the creator
// and the joiner go through exactly the same code path — the room is
// symmetric on the PartyKit side, so there's no need for an extra "host"
// pre-opened Session on the creator's side.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function randomRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function RoomCodePanel() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('idle'); // 'idle' | 'joining'
  const [input, setInput] = useState('');
  const [err, setErr] = useState(null);

  const createRoom = () => {
    const code = randomRoomCode();
    navigate(`?room=${code}`);
  };

  const joinRoom = () => {
    if (!/^\d{4}$/.test(input)) {
      setErr('Code must be 4 digits');
      return;
    }
    navigate(`?room=${input}`);
  };

  if (mode === 'idle') {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-2 bg-gb-darkest border border-gb-dark">
        <span className="text-[9px] text-gb-light tracking-widest">PLAY WITH A FRIEND</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={createRoom}
            className="text-[10px] px-2 py-1 bg-gb-dark text-gb-lightest border border-gb-light hover:bg-gb-light hover:text-gb-darkest"
          >
            CREATE ROOM
          </button>
          <button
            type="button"
            onClick={() => { setMode('joining'); setErr(null); }}
            className="text-[10px] px-2 py-1 bg-gb-dark text-gb-lightest border border-gb-light hover:bg-gb-light hover:text-gb-darkest"
          >
            JOIN WITH CODE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 px-3 py-2 bg-gb-darkest border border-gb-dark">
      <span className="text-[9px] text-gb-light tracking-widest">ENTER ROOM CODE</span>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          maxLength={4}
          value={input}
          onChange={(e) => { setInput(e.target.value.replace(/[^0-9]/g, '')); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') joinRoom(); }}
          placeholder="0000"
          className="w-16 text-[11px] text-center px-1 py-1 bg-gb-dark text-gb-lightest border border-gb-light focus:outline-none"
        />
        <button
          type="button"
          onClick={joinRoom}
          className="text-[10px] px-2 py-1 bg-gb-dark text-gb-lightest border border-gb-light hover:bg-gb-light hover:text-gb-darkest"
        >
          JOIN
        </button>
        <button
          type="button"
          onClick={() => { setMode('idle'); setInput(''); setErr(null); }}
          className="text-[10px] px-2 py-1 text-gb-light hover:text-gb-lightest"
        >
          CANCEL
        </button>
      </div>
      {err && <span className="text-[9px] text-gb-lightest">{err}</span>}
    </div>
  );
}
