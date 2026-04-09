import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';
import BuddyChip from './BuddyChip.jsx';
import BuddyToast from './BuddyToast.jsx';
import { useLayoutModeValue } from '../layout/LayoutModeContext.jsx';

export default function Layout() {
  const mode = useLayoutModeValue();
  const fullscreen = mode === 'fullscreen';

  return (
    <div className="min-h-full flex flex-col bg-gb-darkest text-gb-lightest">
      {!fullscreen && <NavBar />}
      <main className={fullscreen ? 'flex-1 p-0 relative overflow-hidden' : 'flex-1 p-4'}>
        <Outlet />
      </main>
      {!fullscreen && (
        <footer className="p-3 text-xs text-gb-light border-t border-gb-dark">
          plus1.games — two-player co-op
        </footer>
      )}
      {/* Persistent overlays */}
      <BuddyChip />
      <BuddyToast />
    </div>
  );
}
