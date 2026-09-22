import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { RequireAuth, RequireCapability } from './auth/RequireAuth.js';
import { AppShell } from './components/AppShell.js';

/*
 * WHY THE PAGES ARE LOADED LAZILY
 *
 * Every page used to be imported here, so opening the dashboard downloaded the
 * CEO report, the import wizard, the lift register, Settings and twenty-three
 * others before anything appeared — one 1.28 MB script, 370 kB over the wire,
 * parsed and executed before the first pixel. On a connection that is not a
 * data centre's, that is the wait.
 *
 * Each route now arrives as its own file, fetched when somebody actually goes
 * there. The two ways INTO the app — the sign-in screen and the dashboard —
 * stay eager: making them lazy would only add a second round trip to the one
 * path every session starts with.
 */
import { Dashboard } from './pages/Dashboard.js';
import { SignIn } from './pages/SignIn.js';

const Boards = lazy(() => import('./pages/Boards.js').then((m) => ({ default: m.Boards })));
const Clients = lazy(() => import('./pages/Clients.js').then((m) => ({ default: m.Clients })));
const FinishNextRoute = lazy(() => import('./pages/FinishNext.js').then((m) => ({ default: m.FinishNextRoute })));
const Performance = lazy(() => import('./pages/Performance.js').then((m) => ({ default: m.Performance })));
const Settings = lazy(() => import('./pages/Settings.js').then((m) => ({ default: m.Settings })));
const Finance = lazy(() => import('./pages/Finance.js').then((m) => ({ default: m.Finance })));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.js').then((m) => ({ default: m.ProjectDetail })));
const Projects = lazy(() => import('./pages/Projects.js').then((m) => ({ default: m.Projects })));
const Contracts = lazy(() => import('./pages/Contracts.js').then((m) => ({ default: m.Contracts })));
const Priority = lazy(() => import('./pages/Priority.js').then((m) => ({ default: m.Priority })));
const Alerts = lazy(() => import('./pages/Alerts.js').then((m) => ({ default: m.Alerts })));
const Collections = lazy(() => import('./pages/Collections.js').then((m) => ({ default: m.Collections })));
const Payouts = lazy(() => import('./pages/Payouts.js').then((m) => ({ default: m.Payouts })));
const Incentives = lazy(() => import('./pages/Incentives.js').then((m) => ({ default: m.Incentives })));
const Programs = lazy(() => import('./pages/Programs.js').then((m) => ({ default: m.Programs })));
const ProgramDetail = lazy(() => import('./pages/Programs.js').then((m) => ({ default: m.ProgramDetail })));
const Units = lazy(() => import('./pages/Units.js').then((m) => ({ default: m.Units })));
const UnitDetail = lazy(() => import('./pages/Units.js').then((m) => ({ default: m.UnitDetail })));
const CeoReport = lazy(() => import('./pages/CeoReport.js').then((m) => ({ default: m.CeoReport })));
const Import = lazy(() => import('./pages/Import.js').then((m) => ({ default: m.Import })));
const People = lazy(() => import('./pages/People.js').then((m) => ({ default: m.People })));
const FollowUps = lazy(() => import('./pages/FollowUps.js').then((m) => ({ default: m.FollowUps })));

/**
 * Shown while a page's own file is in flight.
 *
 * Deliberately plain and deliberately NOT a spinner that flashes on a fast
 * connection: the rail and the top bar are already on screen, so the only
 * thing missing is the panel, and a word is less jarring than a spinner that
 * appears and vanishes in 80ms.
 */
function PageLoading() {
  return <p className="muted page-loading">Loading…</p>;
}

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
            <Route path="follow-ups" element={<FollowUps />} />
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
