import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { RequireAuth, RequireCapability } from './auth/RequireAuth.js';
import { AppShell } from './components/AppShell.js';
import { ComingSoon, Dashboard } from './pages/Dashboard.js';
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
            <Route path="projects" element={<ComingSoon title="Projects" module="module 3" />} />
            <Route path="contracts" element={<ComingSoon title="Contracts" module="module 2" />} />
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
