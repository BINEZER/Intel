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
      { to: '/follow-ups', label: 'Follow-ups', capability: 'read' },
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
      { to: '/people', label: 'People', capability: 'read' },
      { to: '/contracts', label: 'Contracts', capability: 'read' },
      { to: '/performance', label: 'Performance', capability: 'read' },
      { to: '/incentives', label: 'Incentives', capability: 'read' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/import', label: 'Import data', capability: 'manageConfig' },
      { to: '/settings', label: 'Settings', capability: 'manageConfig' },
    ],
  },
];

/** Today in both calendars, for the header. */
export function TodayBadge() {
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return (
    <div className="today">
      <strong>{formatGregorianShort(utcToday)}</strong>
      <span className="muted"> · {formatEthiopian(utcDateToEthiopian(utcToday))} EC</span>
    </div>
  );
}

const NAV_KEY = 'intelmotion.nav.open';

/** Is this a screen where the sidebar sits beside the page rather than over it? */
function isWideScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches;
}

export function AppShell() {
  const { user, role, signOut } = useAuth();
  const location = useLocation();
  const toggle = useRef<HTMLButtonElement>(null);

  /**
   * One state, two behaviours.
   *
   * On a wide screen the sidebar sits in the layout and collapsing it hands the
   * room to the page — which is the point on a table twelve columns wide. On a
   * narrow one it is a drawer over the content. Either way the same button
   * controls it, so there is never a size at which the menu cannot be put away.
   *
   * The choice is remembered, because a sidebar that reappears on every
   * navigation is not collapsible in any useful sense.
   */
  const [navOpen, setNavOpen] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(NAV_KEY);
      if (stored !== null) return stored === 'true';
    } catch {
      // Private browsing and blocked site data both throw here. Not a reason
      // to fail to render an application.
    }
    return isWideScreen();
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_KEY, String(navOpen));
    } catch { /* see above */ }
  }, [navOpen]);

  // Going somewhere closes the DRAWER. On a wide screen the sidebar is part of
  // the layout, so closing it there would undo the user's choice on every click.
  useEffect(() => {
    if (!isWideScreen()) setNavOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer, and focus goes back to the button that opened it
  // rather than to the top of the document. Only where it IS a drawer: Escape
  // should not collapse a sidebar somebody is reading.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isWideScreen()) return;
      setNavOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    /*
     * The rail runs the FULL height of the window and carries the brand; the
     * top bar sits only over the content beside it. A top bar spanning the
     * whole width above a sidebar is the 2010 admin-template shape — it cuts
     * the page into two stacked strips and puts the logo in a bar that has
     * nothing else to do.
     */
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
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
        <div className="rail-head">
          {/* The mark only. The wordmark inside logo.svg is dark indigo, which
              is invisible on the rail — so the name is HTML text here and its
              colour is ours to set. */}
          <div className="brand">
            <Logo height={26} withWordmark={false} />
            <span className="brand-word">IntelMotion</span>
            <span className="brand-sub">PCM</span>
          </div>
        </div>

        <div className="rail-nav">
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
        </div>

        <div className="rail-foot">
          <p className="rail-user" title={user?.email ?? ''}>{user?.email}</p>
          <span className="role-chip">{role ?? 'no role'}</span>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            ref={toggle}
            className="nav-toggle"
            aria-expanded={navOpen}
            aria-controls="app-nav"
            aria-label={navOpen ? 'Hide menu' : 'Show menu'}
            title={navOpen ? 'Hide the menu' : 'Show the menu'}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span className="nav-toggle-bars" aria-hidden="true"><span /><span /><span /></span>
          </button>

          <TodayBadge />

          <div className="account">
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
