// Layout mode context — lets a route opt into a fullscreen edge-to-edge layout
// (no NavBar, no footer, no page padding) without requiring every route to know
// about the chrome it's suppressing.
//
// Usage:
//   <LayoutModeProvider>...<App/>...</LayoutModeProvider>   // at the root
//   useLayoutMode('fullscreen')                              // in a route
//
// The hook sets the mode on mount and resets to 'padded' on unmount, so routes
// that don't declare a mode get the default padded chrome.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const LayoutModeContext = createContext({
  mode: 'padded',
  setMode: () => {},
});

export function LayoutModeProvider({ children }) {
  const [mode, setModeState] = useState('padded');
  const setMode = useCallback((next) => setModeState(next), []);
  return (
    <LayoutModeContext.Provider value={{ mode, setMode }}>
      {children}
    </LayoutModeContext.Provider>
  );
}

// Read the current mode (useful for the <Layout> to pick chrome).
export function useLayoutModeValue() {
  return useContext(LayoutModeContext).mode;
}

// Declare that this route wants a specific layout mode. Resets to 'padded'
// on unmount so navigating away doesn't leave the fullscreen chrome stuck.
export function useLayoutMode(mode) {
  const { setMode } = useContext(LayoutModeContext);
  useEffect(() => {
    setMode(mode);
    return () => setMode('padded');
  }, [mode, setMode]);
}
