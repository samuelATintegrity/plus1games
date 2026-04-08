import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ArcadeView from './arcade/ArcadeView.jsx';
import ListView from './list/ListView.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/list" replace />} />
        <Route path="/list" element={<ListView />} />
        <Route path="/arcade" element={<ArcadeView />} />
      </Route>
    </Routes>
  );
}
