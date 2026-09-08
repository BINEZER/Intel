/**
 * Route guards.
 *
 * These are a UX affordance, not a security boundary — the Firestore rules are.
 * A user who edits their way past this guard still cannot read or write
 * anything their role forbids.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.js';
import { can, type Capability } from './roles.js';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, active, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="centered muted">Loading…</div>;
  if (user === null) return <Navigate to="/signin" state={{ from: location }} replace />;

  if (!active) {
    return (
      <div className="centered">
        <h2>Account deactivated</h2>
        <p className="muted">
          Your account is signed in but not active. Ask an administrator to reactivate it.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { role } = useAuth();
  if (!can(role, capability)) {
    return (
      <div className="centered">
        <h2>Not available to your role</h2>
        <p className="muted">
          You are signed in as <strong>{role ?? 'no role'}</strong>, which does not have access
          to this section.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
