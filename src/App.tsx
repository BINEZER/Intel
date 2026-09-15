import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { RequireAuth, RequireCapability } from './auth/RequireAuth.js';
import { AppShell } from './components/AppShell.js';
import { Dashboard } from './pages/Dashboard.js';
import { Boards } from './pages/Boards.js';
import { Clients } from './pages/Clients.js';
import { FinishNextRoute } from './pages/FinishNext.js';
import { Performance } from './pages/Performance.js';
import { Settings } from './pages/Settings.js';
import { Finance } from './pages/Finance.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { Projects } from './pages/Projects.js';
import { Contracts } from './pages/Contracts.js';
import { Priority } from './pages/Priority.js';
import { Alerts } from './pages/Alerts.js';
import { Collections } from './pages/Collections.js';
import { Payouts } from './pages/Payouts.js';
import { Incentives } from './pages/Incentives.js';
import { Programs, ProgramDetail } from './pages/Programs.js';
import { Units, UnitDetail } from './pages/Units.js';
import { CeoReport } from './pages/CeoReport.js';
import { Import } from './pages/Import.js';
import { People } from './pages/People.js';
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
            <Route path="alerts" element={<Alerts />} />
            <Route
              path="collections"
              element={<RequireCapability capability="viewFinancials"><Collections /></RequireCapability>}
            />
            <Route
              path="payouts"
              element={<RequireCapability capability="viewFinancials"><Payouts /></RequireCapability>}
            />
            <Route
              path="incentives"
              element={<RequireCapability capability="read"><Incentives /></RequireCapability>}
            />
            <Route
              path="programs"
              element={<RequireCapability capability="read"><Programs /></RequireCapability>}
            />
            <Route
              path="programs/:programId"
              element={<RequireCapability capability="read"><ProgramDetail /></RequireCapability>}
            />
            <Route
              path="units"
              element={<RequireCapability capability="read"><Units /></RequireCapability>}
            />
            <Route
              path="units/:unitId"
              element={<RequireCapability capability="read"><UnitDetail /></RequireCapability>}
            />
            <Route path="finish-next" element={<FinishNextRoute />} />
            <Route
              path="performance"
              element={
                <RequireCapability capability="read">
                  <Performance />
                </RequireCapability>
              }
            />
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
              path="finance/*"
              element={
                <RequireCapability capability="viewFinancials">
                  <Finance />
                </RequireCapability>
              }
            />
            <Route
              path="reports"
              element={
                <RequireCapability capability="viewFinancials">
                  <CeoReport />
                </RequireCapability>
              }
            />
            <Route
              path="boards"
              element={
                <RequireCapability capability="useBoards">
                  <Boards />
                </RequireCapability>
              }
            />
            <Route
              path="people"
              element={
                <RequireCapability capability="read">
                  <People />
                </RequireCapability>
              }
            />
            <Route
              path="import"
              element={
                <RequireCapability capability="manageConfig">
                  <Import />
                </RequireCapability>
              }
            />
            <Route
              path="settings"
              element={
                <RequireCapability capability="manageConfig">
                  <Settings />
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
