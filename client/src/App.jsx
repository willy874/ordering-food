import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import NewGroup from './pages/NewGroup.jsx';
import Group from './pages/Group.jsx';
import Stores from './pages/Stores.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<NewGroup />} />
      <Route path="/g/:joinCode" element={<Group />} />
      <Route path="/stores" element={<Stores />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
