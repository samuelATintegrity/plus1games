import { NavLink } from 'react-router-dom';

const linkClass = ({ isActive }) =>
  `px-3 py-1 border border-gb-light ${
    isActive ? 'bg-gb-light text-gb-darkest' : 'text-gb-lightest hover:bg-gb-dark'
  }`;

export default function NavBar() {
  return (
    <nav className="flex items-center gap-3 p-3 border-b border-gb-dark">
      <span className="text-lg font-bold tracking-widest">PLUS+1</span>
      <div className="flex-1" />
      <NavLink to="/list" className={linkClass}>List</NavLink>
      <NavLink to="/arcade" className={linkClass}>Arcade</NavLink>
    </nav>
  );
}
