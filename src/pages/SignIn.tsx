import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { FirebaseError } from 'firebase/app';
import { useAuth } from '../auth/AuthProvider.js';
import { TodayBadge } from '../components/AppShell.js';

/** Firebase auth codes are not for end users; map the ones staff will actually hit. */
function friendlyAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a few minutes and try again.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact an administrator.';
      case 'auth/network-request-failed':
        return 'Cannot reach the server. Check your connection.';
      default:
        return 'Sign-in failed. Try again, or contact an administrator.';
    }
  }
  return 'Sign-in failed. Try again.';
}

export function SignIn() {
  const { user, loading, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="centered muted">Loading…</div>;
  if (user !== null) {
    const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <form className="card signin" onSubmit={(e) => void onSubmit(e)}>
        <h1>IntelMotion <span className="muted">PCM</span></h1>
        <TodayBadge />

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="error" role="alert">{error}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
