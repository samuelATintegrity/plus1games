// useGameSession — decides which network transport (if any) the pong
// component should use.
//
// Priority:
//   1. `?room=<code>` in the URL → open a one-off Session in `room-<code>`
//      and wrap it in a `sessionTransport`. Closed on unmount. This wins
//      over buddy so that a buddy-paired user can still drop into a
//      specific room without leaving their buddy pass.
//   2. Buddy pass is active and connected → return `buddyTransport(buddy)`.
//      The pong component multiplexes pong-* kinds on the existing buddy
//      channel. Note: we trust the BuddyProvider context rather than
//      reading `?buddy=` from the URL, because the provider strips that
//      param on mount.
//   3. Neither → return `{ mode: 'local', transport: null }` for pure
//      hotseat play.
//
// The hook returns { mode, transport, ready } where `mode` is one of
// 'local' | 'buddy' | 'room', `transport` is the object passed to
// PongNetController (or null for local), and `ready` is false until the
// room-code session has finished its initial handshake.

import { useEffect, useRef, useState } from 'react';
import { createRoom, joinRoom } from '../../multiplayer/roomCode.js';
import { buddyTransport, sessionTransport } from './net.js';

export function useGameSession({ buddy, searchParams }) {
  const [state, setState] = useState({ mode: 'local', transport: null, ready: true });
  const roomSessionRef = useRef(null);

  const roomParam = searchParams.get('room');

  useEffect(() => {
    // Case 1: room code route (explicit opt-in wins over buddy)
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

    // Case 2: buddy pass is active and connected
    if (buddy.isActive && buddy.isConnected) {
      setState({ mode: 'buddy', transport: buddyTransport(buddy), ready: true });
      return () => {};
    }
    // Buddy is active but not yet connected — hold waiting.
    if (buddy.isActive && !buddy.isConnected) {
      setState({ mode: 'buddy', transport: null, ready: false });
      return () => {};
    }

    // Case 3: pure local hotseat
    setState({ mode: 'local', transport: null, ready: true });
    return () => {};
    // Re-run when buddy connection state or room query param change.
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
