import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ArcadeView from './arcade/ArcadeView.jsx';
import ListView from './list/ListView.jsx';
import { LayoutModeProvider } from './layout/LayoutModeContext.jsx';
import { BuddyProvider } from './multiplayer/BuddyProvider.jsx';

const PongBeachVolleyball = lazy(() => import('./games/pong-beach-volleyball/index.jsx'));
const Starbloom = lazy(() => import('./games/starbloom/index.jsx'));
const StackDuo = lazy(() => import('./games/stack-duo/index.jsx'));
const Zookeepers = lazy(() => import('./games/zookeepers/index.jsx'));

export default function App() {
  return (
    <LayoutModeProvider>
      <BuddyProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<ArcadeView />} />
            <Route path="/arcade" element={<ArcadeView />} />
            <Route path="/list" element={<ListView />} />
            <Route
              path="/games/pong-beach-volleyball"
              element={
                <Suspense fallback={<div className="text-gb-light text-xs">Loading…</div>}>
                  <PongBeachVolleyball />
                </Suspense>
              }
            />
            <Route
              path="/games/starbloom"
              element={
                <Suspense fallback={<div className="text-gb-light text-xs">Loading…</div>}>
                  <Starbloom />
                </Suspense>
              }
            />
            <Route
              path="/games/stack-duo"
              element={
                <Suspense fallback={<div className="text-gb-light text-xs">Loading…</div>}>
                  <StackDuo />
                </Suspense>
              }
            />
            <Route
              path="/games/zookeepers"
              element={
                <Suspense fallback={<div className="text-gb-light text-xs">Loading…</div>}>
                  <Zookeepers />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </BuddyProvider>
    </LayoutModeProvider>
  );
}
