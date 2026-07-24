import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type User } from '../api.js';

export function AccountPage({
  me,
  onDeleted,
}: {
  me: User;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !window.confirm(
        'Delete your account? This cannot be undone. Groups where you are ' +
          'the only member will be deleted too.',
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/auth/delete-account', { password });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Account</h1>
        <Link to="/" className="muted">
          ← All groups
        </Link>
      </div>

      <div className="card">
        <ul className="list">
          <li>
            <span className="muted">Name</span>
            <span>{me.name}</span>
          </li>
          <li>
            <span className="muted">Email</span>
            <span>{me.email}</span>
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>Delete account</h2>
        <p className="muted">
          You need to be settled up in all your groups first. Your past
          expenses stay in their groups, shown as “Deleted user” — balances
          never change behind anyone's back.
        </p>
        {!confirming ? (
          <button className="danger" onClick={() => setConfirming(true)}>
            Delete my account…
          </button>
        ) : (
          <form className="stack" onSubmit={submit}>
            <input
              type="password"
              placeholder="Confirm your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button className="danger" disabled={busy}>
                Permanently delete my account
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setConfirming(false);
                  setPassword('');
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
