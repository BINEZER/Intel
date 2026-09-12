/**
 * Auth context: the signed-in user, their role, and the sign-in/out actions.
 *
 * The role comes from the ID token's custom claims. `refreshRole()` forces a
 * token refresh, needed right after an admin changes someone's role — otherwise
 * the old claim persists until the token expires (up to an hour).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { ensureProfile } from '../data/users.js';
import { isRole, type Role } from './roles.js';

export interface AuthState {
  user: User | null;
  role: Role | null;
  /** Deactivated accounts keep their login but lose all access. */
  active: boolean;
  /** True until the first auth state resolves — render a spinner, not the sign-in page. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function readClaims(user: User | null, forceRefresh = false) {
  if (user === null) return { role: null, active: false };
  const token = await user.getIdTokenResult(forceRefresh);
  const role = isRole(token.claims['role']) ? token.claims['role'] : null;
  return { role, active: token.claims['active'] === true };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onIdTokenChanged rather than onAuthStateChanged alone: it also fires on
    // token refresh, so a role change propagates without a re-login.
    const unsubscribe = onIdTokenChanged(auth, (next) => {
      void (async () => {
        setUser(next);
        const claims = await readClaims(next);
        setRole(claims.role);
        setActive(claims.active);
        setLoading(false);

        // Create the directory entry on first sign-in, so an administrator has
        // a record to act on rather than a uid they must be told by phone.
        // Deliberately non-fatal: a user holding a valid claim must still be
        // able to work if this write is refused.
        if (next !== null) {
          try {
            await ensureProfile(next);
          } catch (error) {
            console.warn('[auth] could not write user profile', error);
          }
        }
      })();
    });
    return unsubscribe;
  }, []);

  useEffect(() => onAuthStateChanged(auth, () => {}), []); // keeps the SDK's session warm

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  const refreshRole = useCallback(async () => {
    const claims = await readClaims(auth.currentUser, true);
    setRole(claims.role);
    setActive(claims.active);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, role, active, loading, signIn, signOut, refreshRole }),
    [user, role, active, loading, signIn, signOut, refreshRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
