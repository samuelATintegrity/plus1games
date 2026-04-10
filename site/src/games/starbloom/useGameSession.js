// useGameSession — decides which network transport (if any) the Starbloom
// component should use. Identical pattern to Pong's hook.
//
// Priority:
//   1. ?room=<code> in URL -> one-off Session + sessionTransport
//   2. Buddy pass active + connected -> buddyTransport
//   3. Neither -> { mode: 'local', transport: null }

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

    // Case 2: buddy pass active + connected
    if (buddy.isActive && buddy.isConnected) {
      setState({ mode: 'buddy', transport: buddyTransport(buddy), ready: true });
      return () => {};
    }
    if (buddy.isActive && !buddy.isConnected) {
      setState({ mode: 'buddy', transport: null, ready: false });
      return () => {};
    }

    // Case 3: pure local hotseat
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
