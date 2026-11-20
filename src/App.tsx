import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { RequireAuth, RequireCapability } from './auth/RequireAuth.js';
import { AppShell } from './components/AppShell.js';
import { Dashboard } from './pages/Dashboard.js';
import { SignIn } from './pages/SignIn.js';
import { Projects } from './pages/Projects.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { Settings } from './pages/Settings.js';

export function App() {
  return <AuthProvider><BrowserRouter><Routes>
    <Route path="/signin" element={<SignIn />} />
    <Route element={<RequireAuth><AppShell /></RequireAuth>}>
      <Route index element={<Dashboard />} />
      <Route path="projects" element={<RequireCapability capability="read"><Projects /></RequireCapability>} />
      <Route path="settings" element={<Settings />} />
      <Route path="projects/:projectId" element={<RequireCapability capability="read"><ProjectDetail /></RequireCapability>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></BrowserRouter></AuthProvider>;
}
