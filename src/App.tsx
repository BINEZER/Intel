import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { RequireAuth, RequireCapability } from './auth/RequireAuth.js';
import { AppShell } from './components/AppShell.js';
import { ComingSoon, Dashboard } from './pages/Dashboard.js';
import { Clients } from './pages/Clients.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { Projects } from './pages/Projects.js';
import { Contracts } from './pages/Contracts.js';
import { Priority } from './pages/Priority.js';
import { SignIn } from './pages/SignIn.js';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="priority" element={<Priority />} />
            <Route
              path="projects"
              element={
                <RequireCapability capability="read">
                  <Projects />
                </RequireCapability>
              }
            />
            <Route
              path="projects/:projectId"
              element={
                <RequireCapability capability="read">
                  <ProjectDetail />
                </RequireCapability>
              }
            />
            <Route
              path="clients"
              element={
                <RequireCapability capability="read">
                  <Clients />
                </RequireCapability>
              }
            />
            <Route
              path="contracts"
              element={
                <RequireCapability capability="read">
                  <Contracts />
                </RequireCapability>
              }
            />
            <Route
              path="finance"
              element={
                <RequireCapability capability="viewFinancials">
                  <ComingSoon title="Finance" module="modules 4-5" />
                </RequireCapability>
              }
            />
            <Route
              path="boards"
              element={
                <RequireCapability capability="useBoards">
                  <ComingSoon title="Boards" module="module 6" />
                </RequireCapability>
              }
            />
            <Route
              path="settings"
              element={
                <RequireCapability capability="manageConfig">
                  <ComingSoon title="Settings" module="module 2" />
                </RequireCapability>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
