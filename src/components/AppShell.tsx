/**
 * Application chrome: navigation filtered by role, and a header that always
 * shows today in both calendars.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can, type Capability } from '../auth/roles.js';
import { formatEthiopian, formatGregorianShort, utcDateToEthiopian } from '../lib/ethiopic.js';

interface NavItem {
  to: string;
  label: string;
  capability: Capability;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', capability: 'read' },
  { to: '/priority', label: 'Priority', capability: 'read' },
  { to: '/finish-next', label: 'Finish next', capability: 'read' },
  { to: '/projects', label: 'Projects', capability: 'read' },
  { to: '/clients', label: 'Clients', capability: 'read' },
  { to: '/contracts', label: 'Contracts', capability: 'read' },
  { to: '/finance', label: 'Finance', capability: 'viewFinancials' },
  { to: '/reports', label: 'Reports', capability: 'viewFinancials' },
  { to: '/performance', label: 'Performance', capability: 'read' },
  { to: '/boards', label: 'Boards', capability: 'useBoards' },
  { to: '/settings', label: 'Settings', capability: 'manageConfig' },
];

/** Today in both calendars, for the header. */
export function TodayBadge() {
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return (
    <div className="today">
      <strong>{formatEthiopian(utcDateToEthiopian(utcToday))}</strong>
      <span className="muted"> EC · {formatGregorianShort(utcToday)}</span>
    </div>
  );
}

export function AppShell() {
  const { user, role, signOut } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          IntelMotion <span className="muted">PCM</span>
        </div>
        <TodayBadge />
        <div className="account">
          <span className="muted">{user?.email}</span>
          <span className="role-chip">{role ?? 'no role'}</span>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          {NAV.filter((item) => can(role, item.capability)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
