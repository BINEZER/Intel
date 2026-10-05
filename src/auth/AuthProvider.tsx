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
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { ensureProfile } from '../data/users.js';
import { isRole, type Role } from './roles.js';
import {
  looksLikeEmail,
  MALFORMED_EMAIL_OUTCOME,
  MISSING_EMAIL_OUTCOME,
  resetOutcomeFor,
  shouldRetryWithoutReturnLink,
  type ResetOutcome,
} from './password-reset.js';

export interface AuthState {
  user: User | null;
  role: Role | null;
  /** Deactivated accounts keep their login but lose all access. */
  active: boolean;
  /** True until the first auth state resolves — render a spinner, not the sign-in page. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Email a password-reset link. Never throws: it returns what the screen should
   * do, because the right answer to "no such account" is the same as to success.
   */
  requestPasswordReset: (email: string) => Promise<ResetOutcome>;
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

  const requestPasswordReset = useCallback(async (email: string): Promise<ResetOutcome> => {
    const address = email.trim();
    if (address === '') return MISSING_EMAIL_OUTCOME;
    // Caught here rather than left to the server: an emulator or an older
    // project answers a malformed address as if it were merely unknown, which
    // would tell somebody a link is coming to an address that cannot receive one.
    if (!looksLikeEmail(address)) return MALFORMED_EMAIL_OUTCOME;
    try {
      try {
        // The link in the email sends the person back to the app afterwards,
        // rather than leaving them on a bare "password changed" page.
        await sendPasswordResetEmail(auth, address, { url: `${window.location.origin}/signin` });
      } catch (error) {
        if (!shouldRetryWithoutReturnLink(error)) throw error;
        // A domain that is not authorised for the return link must not stop the
        // reset itself: see `shouldRetryWithoutReturnLink`.
        await sendPasswordResetEmail(auth, address);
      }
      return { kind: 'requested' };
    } catch (error) {
      return resetOutcomeFor(error);
    }
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
    () => ({ user, role, active, loading, signIn, requestPasswordReset, signOut, refreshRole }),
    [user, role, active, loading, signIn, requestPasswordReset, signOut, refreshRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
