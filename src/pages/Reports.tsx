import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';

export function Settings() {
  const { user, role, active, requestPasswordReset } = useAuth();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function resetPassword() {
    if (!user?.email || busy) return;
    setBusy(true);
    setMessage('');
    const result = await requestPasswordReset(user.email);
    setBusy(false);
    setMessage(result.kind === 'requested'
      ? `If an account exists for ${user.email}, a reset link is on its way. Check your inbox and spam folder.`
      : result.message);
  }

  return <div className="settings-page">
    <div className="page-head">
      <div><p className="eyebrow">INTELMOTION · ACCOUNT</p><h1>Settings</h1>
        <p className="muted">Your sign-in details and account access.</p></div>
    </div>
    <section className="card settings-card">
      <h2>Account</h2>
      <dl className="detail-grid">
        <div><dt>Email</dt><dd>{user?.email ?? '—'}</dd></div>
        <div><dt>Role</dt><dd>{role ?? 'No role assigned'}</dd></div>
        <div><dt>Account status</dt><dd>{active ? 'Active' : 'Inactive'}</dd></div>
      </dl>
      <div className="settings-action">
        <div><strong>Password</strong><p className="muted">Request a password reset link by email.</p></div>
        <button type="button" className="primary" onClick={() => void resetPassword()} disabled={!user?.email || busy}>{busy ? 'Sending…' : 'Send password reset link'}</button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
    </section>
    <p className="muted settings-note">User roles and account activation are managed by an administrator. Project phases and progress weights are edited within each project.</p>
  </div>;
}
