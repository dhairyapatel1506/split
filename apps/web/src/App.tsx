import { useEffect, useState } from 'react';

type Health = {
  status: 'ok' | 'degraded';
  checks: { db: boolean; redis: boolean };
  uptime: number;
};

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Split</h1>
      <p>Share expenses with friends, settle up without the awkward math.</p>
      <h2>System status</h2>
      {error && <p>API unreachable: {error}</p>}
      {health && (
        <ul>
          <li>API: {health.status}</li>
          <li>Database: {health.checks.db ? 'up' : 'down'}</li>
          <li>Redis: {health.checks.redis ? 'up' : 'down'}</li>
        </ul>
      )}
      {!health && !error && <p>Checking…</p>}
    </main>
  );
}
