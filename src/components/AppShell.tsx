/**
 * Application chrome: navigation filtered by role, and a header that always
 * shows today in both calendars.
 */

import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const toggle = useRef<HTMLButtonElement>(null);

  // Going somewhere closes the drawer. A menu still covering the page you just
  // asked for is the commonest bug in every hand-rolled mobile nav.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // Escape closes it, and the focus goes back to the button that opened it
  // rather than to the top of the document.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNavOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          ref={toggle}
          className="nav-toggle"
          aria-expanded={navOpen}
          aria-controls="app-nav"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span className="nav-toggle-bars" aria-hidden="true"><span /><span /><span /></span>
        </button>

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
        {/* The overlay is a button so dismissing by tapping outside is a real,
            announced action rather than a click handler on a div. */}
        <button
          type="button"
          className="nav-scrim"
          tabIndex={navOpen ? 0 : -1}
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />

        <nav className="sidebar" id="app-nav" aria-label="Sections">
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
