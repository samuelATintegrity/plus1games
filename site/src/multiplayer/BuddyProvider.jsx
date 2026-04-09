// BuddyProvider — owns the singleton buddy Session for the whole app.
//
// Responsibilities:
//   • Read pairId from URL (?buddy=...) or localStorage.
//   • Open/close a single Session against `buddy-<pairId>`.
//   • Track remote presence state (position, nickname, gameId, interpolation
//     buffer) as a Map keyed by PartySocket client id.
//   • Expose createBuddyPass / leaveBuddyPass / setNickname / notifyEnterGame /
//     notifyLeaveGame.
//   • Enforce a 2-player cap: if a third client joins, mark the pass as
//     "full" and close the session.
//
// The provider is mounted once at the root of App. Every component that
// needs buddy state uses the `useBuddy()` hook.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Session } from './session.js';
import {
  KIND,
  buddyRoomFromPairId,
  generatePairId,
  makeBuddyMeta,
  makeEnterGame,
  makeLeaveGame,
  pairIdToShortCode,
  parseShortCode,
} from './netProtocol.js';

const STORAGE_PAIR = 'plus1:buddyPass';
const STORAGE_NICK = 'plus1:nickname';

const BuddyContext = createContext(null);

function loadStoredPair() {
  try {
    const raw = localStorage.getItem(STORAGE_PAIR);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj.pairId === 'string') return obj;
  } catch {}
  return null;
}

function storeP(obj) {
  try { localStorage.setItem(STORAGE_PAIR, JSON.stringify(obj)); } catch {}
}

function clearStoredPair() {
  try { localStorage.removeItem(STORAGE_PAIR); } catch {}
}

function loadNickname() {
  try { return localStorage.getItem(STORAGE_NICK) || ''; } catch { return ''; }
}

function storeNickname(n) {
  try { localStorage.setItem(STORAGE_NICK, n); } catch {}
}

function defaultNickname() {
  // Ephemeral default if the user skips. "P" + 3 random digits.
  return `P${Math.floor(100 + Math.random() * 900)}`;
}

export function BuddyProvider({ children }) {
  const [pairId, setPairId] = useState(null);
  const [nickname, setNicknameState] = useState(() => loadNickname() || defaultNickname());
  const [isConnected, setIsConnected] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [, bumpRender] = useState(0);
  const sessionRef = useRef(null);
  const remotePlayersRef = useRef(new Map()); // id → {x,y,nickname,gameId,curT,prevX,prevY,prevT}
  const localGameIdRef = useRef(null);
  const enterGameListenersRef = useRef(new Set());
  const messageListenersRef = useRef(new Set());
  const playerLeaveListenersRef = useRef(new Set());

  // Persist nickname
  useEffect(() => { storeNickname(nickname); }, [nickname]);

  // Close any active session
  const closeSession = useCallback(() => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch {}
      sessionRef.current = null;
    }
    remotePlayersRef.current.clear();
    setIsConnected(false);
  }, []);

  // Open a session against the given pair id.
  const openSession = useCallback((id, { onFull } = {}) => {
    closeSession();
    const s = new Session('buddyPass', buddyRoomFromPairId(id), { buddyId: id });
    sessionRef.current = s;

    s.on('open', () => {
      setIsConnected(true);
      // Announce nickname once on open
      s.send(makeBuddyMeta(nicknameRef.current));
    });

    s.on('hello', (hello) => {
      // If 3+ players already here (including us), this pass is full.
      if ((hello.players?.length || 0) > 2) {
        setIsFull(true);
        if (onFull) onFull();
        closeSession();
      }
    });

    s.on('player-join', () => {
      // Re-announce meta so the new peer gets our nickname.
      s.send(makeBuddyMeta(nicknameRef.current));
      // Enforce the cap: if we now have >1 other player, close.
      if (s.players.length > 1) {
        setIsFull(true);
        if (onFull) onFull();
        closeSession();
      }
    });

    s.on('player-leave', ({ playerId }) => {
      remotePlayersRef.current.delete(playerId);
      bumpRender((n) => n + 1);
      // Forward to any subscribers (e.g. PongNetController)
      for (const cb of playerLeaveListenersRef.current) cb({ playerId });
    });

    s.on('close', () => {
      setIsConnected(false);
    });

    s.on('message', ({ from, data }) => {
      if (!data || !data.kind) return;
      // Forward to any "raw message" subscribers first (used by pong net ctrl)
      for (const cb of messageListenersRef.current) cb({ from, data });

      switch (data.kind) {
        case KIND.BUDDY_META: {
          const r = remotePlayersRef.current.get(from) || newRemote();
          r.nickname = data.nickname || r.nickname || 'Buddy';
          remotePlayersRef.current.set(from, r);
          bumpRender((n) => n + 1);
          break;
        }
        case KIND.PRESENCE: {
          const r = remotePlayersRef.current.get(from) || newRemote();
          // Shift current → prev for interpolation
          r.prevX = r.curX ?? data.x;
          r.prevY = r.curY ?? data.y;
          r.prevT = r.curT ?? (performance.now() - 16);
          r.curX = data.x;
          r.curY = data.y;
          r.curT = performance.now();
          if (data.nickname) r.nickname = data.nickname;
          r.gameId = data.gameId ?? null;
          remotePlayersRef.current.set(from, r);
          break;
        }
        case KIND.ENTER_GAME: {
          const r = remotePlayersRef.current.get(from) || newRemote();
          r.gameId = data.gameId;
          if (data.nickname) r.nickname = data.nickname;
          remotePlayersRef.current.set(from, r);
          // Fire enter-game listeners (for the toast)
          for (const cb of enterGameListenersRef.current) {
            cb({
              from,
              gameId: data.gameId,
              gameRoute: data.gameRoute,
              nickname: data.nickname || r.nickname,
            });
          }
          bumpRender((n) => n + 1);
          break;
        }
        case KIND.LEAVE_GAME: {
          const r = remotePlayersRef.current.get(from);
          if (r) {
            r.gameId = null;
            remotePlayersRef.current.set(from, r);
          }
          bumpRender((n) => n + 1);
          break;
        }
        default:
          break;
      }
    });
  }, [closeSession]);

  // A ref that tracks the latest nickname without re-running openSession
  const nicknameRef = useRef(nickname);
  useEffect(() => { nicknameRef.current = nickname; }, [nickname]);

  // Bootstrap: check URL then localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlBuddy = params.get('buddy');
    const stored = loadStoredPair();

    let nextPairId = null;

    if (urlBuddy) {
      const clean = parseShortCode(urlBuddy);
      if (clean) {
        nextPairId = clean;
        // Strip the param from the URL
        params.delete('buddy');
        const qs = params.toString();
        const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
        window.history.replaceState({}, '', newUrl);
        storeP({ pairId: clean, role: 'joiner', createdAt: Date.now() });
      }
    } else if (stored) {
      nextPairId = stored.pairId;
    }

    if (nextPairId) {
      setPairId(nextPairId);
      openSession(nextPairId, {
        onFull: () => { clearStoredPair(); setPairId(null); },
      });
    }

    return () => closeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create a fresh buddy pass
  const createBuddyPass = useCallback(() => {
    const newId = generatePairId();
    storeP({ pairId: newId, role: 'creator', createdAt: Date.now() });
    setIsFull(false);
    setPairId(newId);
    openSession(newId, {
      onFull: () => { clearStoredPair(); setPairId(null); },
    });
  }, [openSession]);

  // Join an existing pass by short code
  const joinBuddyPass = useCallback((rawCode) => {
    const clean = parseShortCode(rawCode);
    if (!clean) return false;
    storeP({ pairId: clean, role: 'joiner', createdAt: Date.now() });
    setIsFull(false);
    setPairId(clean);
    openSession(clean, {
      onFull: () => { clearStoredPair(); setPairId(null); },
    });
    return true;
  }, [openSession]);

  // Leave and clear
  const leaveBuddyPass = useCallback(() => {
    clearStoredPair();
    setPairId(null);
    setIsFull(false);
    closeSession();
  }, [closeSession]);

  // Set nickname (and broadcast)
  const setNickname = useCallback((n) => {
    const next = (n || '').slice(0, 16) || defaultNickname();
    setNicknameState(next);
    nicknameRef.current = next;
    if (sessionRef.current) sessionRef.current.send(makeBuddyMeta(next));
  }, []);

  // Notify buddies that we entered a game
  const notifyEnterGame = useCallback((gameId, gameRoute) => {
    localGameIdRef.current = gameId;
    if (sessionRef.current) {
      sessionRef.current.send(makeEnterGame({
        gameId, gameRoute, nickname: nicknameRef.current,
      }));
    }
  }, []);

  const notifyLeaveGame = useCallback((gameId) => {
    localGameIdRef.current = null;
    if (sessionRef.current) {
      sessionRef.current.send(makeLeaveGame({ gameId }));
    }
  }, []);

  // Subscribe to enter-game events (used by BuddyToast)
  const onEnterGame = useCallback((cb) => {
    enterGameListenersRef.current.add(cb);
    return () => enterGameListenersRef.current.delete(cb);
  }, []);

  // Subscribe to raw session messages (used by PongNetController to
  // multiplex pong-* kinds on the buddy channel)
  const onRawMessage = useCallback((cb) => {
    messageListenersRef.current.add(cb);
    return () => messageListenersRef.current.delete(cb);
  }, []);

  // Subscribe to player-leave events on the buddy session (used by
  // PongNetController for disconnect overlays).
  const onBuddyLeave = useCallback((cb) => {
    playerLeaveListenersRef.current.add(cb);
    return () => playerLeaveListenersRef.current.delete(cb);
  }, []);

  // Passthrough send (used by PongNetController)
  const sendBuddyMessage = useCallback((data) => {
    if (sessionRef.current) sessionRef.current.send(data);
  }, []);

  // Safe getter for the current session id (populated after hello).
  const getSessionId = useCallback(() => sessionRef.current?.id ?? null, []);

  // Derived
  const shareCode = pairId ? pairIdToShortCode(pairId) : null;
  const shareUrl = pairId
    ? `${window.location.origin}/?buddy=${pairId}`
    : null;

  const value = useMemo(() => ({
    // state
    session: sessionRef.current,
    isActive: !!pairId,
    isConnected,
    isFull,
    pairId,
    shareUrl,
    shareCode,
    nickname,
    remotePlayers: remotePlayersRef.current,
    // actions
    createBuddyPass,
    joinBuddyPass,
    leaveBuddyPass,
    setNickname,
    notifyEnterGame,
    notifyLeaveGame,
    // subscriptions
    onEnterGame,
    onRawMessage,
    onBuddyLeave,
    sendBuddyMessage,
    getSessionId,
  }), [
    pairId, isConnected, isFull, shareUrl, shareCode, nickname,
    createBuddyPass, joinBuddyPass, leaveBuddyPass, setNickname,
    notifyEnterGame, notifyLeaveGame,
    onEnterGame, onRawMessage, onBuddyLeave, sendBuddyMessage, getSessionId,
  ]);

  return <BuddyContext.Provider value={value}>{children}</BuddyContext.Provider>;
}

export function useBuddy() {
  const ctx = useContext(BuddyContext);
  if (!ctx) throw new Error('useBuddy() must be used inside <BuddyProvider>');
  return ctx;
}

function newRemote() {
  return {
    curX: null, curY: null, curT: null,
    prevX: null, prevY: null, prevT: null,
    nickname: 'Buddy',
    gameId: null,
  };
}
