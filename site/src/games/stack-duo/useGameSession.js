// useGameSession — decides which network transport (if any) the StackDuo
// component should use.
//
// Priority:
//   1. `?room=<code>` in the URL → open a Session in `room-<code>` and wrap
//      it in a sessionTransport.
//   2. Buddy pass is active and connected → return buddyTransport(buddy).
//   3. Neither → return { mode: 'local', transport: null } for pure local play.

import { useEffect, useRef, useState } from 'react';
import { createRoom, joinRoom } from '../../multiplayer/roomCode.js';
import { buddyTransport, sessionTransport } from './net.js';

export function useGameSession({ buddy, searchParams }) {
  const [state, setState] = useState({ mode: 'local', transport: null, ready: true });
  const roomSessionRef = useRef(null);

  const roomParam = searchParams.get('room');

  useEffect(() => {
    // Case 1: room code route
    if (roomParam) {
      let cancelled = false;
      setState({ mode: 'room', transport: null, ready: false });
      const promise = /^\d{4}$/.test(roomParam) ? joinRoom(roomParam) : null;
      if (!promise) {
        setState({ mode: 'local', transport: null, ready: true });
        return () => {};
      }
      promise
        .then((session) => {
          if (cancelled) { try { session.close(); } catch {} return; }
          roomSessionRef.current = session;
          setState({ mode: 'room', transport: sessionTransport(session), ready: true });
        })
        .catch(() => {
          if (!cancelled) setState({ mode: 'local', transport: null, ready: true });
        });
      return () => {
        cancelled = true;
        if (roomSessionRef.current) {
          try { roomSessionRef.current.close(); } catch {}
          roomSessionRef.current = null;
        }
      };
    }

    // Case 2: buddy pass active
    if (buddy.isActive && buddy.isConnected) {
      setState({ mode: 'buddy', transport: buddyTransport(buddy), ready: true });
      return () => {};
    }
    if (buddy.isActive && !buddy.isConnected) {
      setState({ mode: 'buddy', transport: null, ready: false });
      return () => {};
    }

    // Case 3: local
    setState({ mode: 'local', transport: null, ready: true });
    return () => {};
  }, [roomParam, buddy.isActive, buddy.isConnected, buddy.pairId]);

  // Clean up room session on unmount
  useEffect(() => {
    return () => {
      if (roomSessionRef.current) {
        try { roomSessionRef.current.close(); } catch {}
        roomSessionRef.current = null;
      }
    };
  }, []);

  return state;
}
