import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { FirebaseError } from 'firebase/app';
import { useAuth } from '../auth/AuthProvider.js';
import { TodayBadge } from '../components/AppShell.js';
import {
  RESET_REQUESTED_MESSAGE,
  secondsUntilResend,
} from '../auth/password-reset.js';

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
  const { user, loading, signIn, requestPasswordReset } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Which of two faces the card is showing.
   *
   * The same email box serves both: somebody who has typed their address and
   * then remembered they do not know the password should not have to type it
   * again. That is why this is a mode on one form rather than a separate page.
   */
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [notice, setNotice] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Ticks only while a cooldown is running, so an idle sign-in page does not
  // re-render every second for nothing.
  const cooldown = secondsUntilResend(requestedAt, now);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  if (loading) return <div className="centered muted">Loading…</div>;
  if (user !== null) {
    const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  async function onReset(event: FormEvent) {
    event.preventDefault();
    if (cooldown > 0) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const outcome = await requestPasswordReset(email);
      if (outcome.kind === 'requested') {
        setNotice(RESET_REQUESTED_MESSAGE);
        const at = Date.now();
        setRequestedAt(at);
        setNow(at);
      } else {
        setError(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function switchTo(next: 'signin' | 'reset') {
    setMode(next);
    setError(null);
    setNotice(null);
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

  if (mode === 'reset') {
    return (
      <div className="centered">
        <form className="card signin" onSubmit={(e) => void onReset(e)}>
          <h1>Reset your password</h1>
          <p className="muted signin-lede">
            Enter the email address you sign in with and we will send you a link to choose a new
            password.
          </p>

          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            // Focused on arrival, but only if there is nothing typed yet: on a
            // phone, jumping the keyboard up over an address already filled in
            // is just noise.
            autoFocus={email === ''}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}

          <button type="submit" className="primary" disabled={busy || cooldown > 0}>
            {busy
              ? 'Sending…'
              : cooldown > 0
                ? `Send again in ${cooldown}s`
                : requestedAt === null
                  ? 'Send the reset link'
                  : 'Send it again'}
          </button>
          <button type="button" className="signin-secondary" onClick={() => switchTo('signin')}>
            Back to sign in
          </button>
        </form>
      </div>
    );
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
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
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
        {notice && <p className="notice" role="status">{notice}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="signin-secondary" onClick={() => switchTo('reset')}>
          Forgot your password?
        </button>
      </form>
    </div>
  );
}
