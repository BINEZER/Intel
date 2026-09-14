/**
 * Application chrome: navigation filtered by role, and a header that always
 * shows today in both calendars.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { Logo } from './Logo.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can, type Capability } from '../auth/roles.js';
import { formatEthiopian, formatGregorianShort, utcDateToEthiopian } from '../lib/ethiopic.js';

interface NavItem {
  to: string;
  label: string;
  capability: Capability;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Seventeen destinations in one flat column is a list to be searched, not a menu
 * to be used. Grouped by the question being asked — what needs me today, what
 * are we building, where is the money, who is doing it — so finding a page is
 * recall rather than reading.
 *
 * A group whose every item is hidden by role disappears with it, so a viewer
 * does not get an empty "Money" heading.
 */
const NAV: NavGroup[] = [
  {
    label: 'Today',
    items: [
      { to: '/', label: 'Dashboard', capability: 'read' },
      { to: '/alerts', label: 'Alerts', capability: 'read' },
      { to: '/priority', label: 'Priority', capability: 'read' },
      { to: '/finish-next', label: 'Finish next', capability: 'read' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { to: '/projects', label: 'Projects', capability: 'read' },
      { to: '/programs', label: 'Programs', capability: 'read' },
      { to: '/units', label: 'Lifts', capability: 'read' },
      { to: '/boards', label: 'Boards', capability: 'useBoards' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/finance', label: 'Finance', capability: 'viewFinancials' },
      { to: '/collections', label: 'Collections', capability: 'viewFinancials' },
      { to: '/payouts', label: 'Payouts', capability: 'viewFinancials' },
      { to: '/reports', label: 'Reports', capability: 'viewFinancials' },
    ],
  },
  {
    label: 'People & partners',
    items: [
      { to: '/clients', label: 'Clients', capability: 'read' },
      { to: '/contracts', label: 'Contracts', capability: 'read' },
      { to: '/performance', label: 'Performance', capability: 'read' },
      { to: '/incentives', label: 'Incentives', capability: 'read' },
    ],
  },
  {
    label: 'Setup',
    items: [{ to: '/settings', label: 'Settings', capability: 'manageConfig' }],
  },
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
          <Logo height={28} />
          <span className="muted brand-sub">PCM</span>
        </div>
        <TodayBadge />
        <div className="account">
          <span className="muted">{user?.email}</span>
          <span className="role-chip">{role ?? 'no role'}</span>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Sections">
          {NAV.map((group) => {
            const visible = group.items.filter((item) => can(role, item.capability));
            if (visible.length === 0) return null;

            return (
              <div key={group.label} className="nav-section">
                <p className="nav-group">{group.label}</p>
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
