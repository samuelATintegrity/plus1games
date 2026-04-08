import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';

export default function Layout() {
  return (
    <div className="min-h-full flex flex-col bg-gb-darkest text-gb-lightest">
      <NavBar />
      <main className="flex-1 p-4">
        <Outlet />
      </main>
      <footer className="p-3 text-xs text-gb-light border-t border-gb-dark">
        plus1.games — two-player co-op
      </footer>
    </div>
  );
}
