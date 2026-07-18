import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type BinnedGroup, type Group } from '../api.js';
import { usePoll } from '../hooks.js';
import { RefreshIcon, TrashIcon } from '../icons.js';

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [bin, setBin] = useState<BinnedGroup[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<Group[]>('/api/groups'),
      api.get<BinnedGroup[]>('/api/groups/bin'),
    ])
      .then(([g, b]) => {
        setGroups(g);
        setBin(b);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, []);
  useEffect(load, [load]);
  usePoll(load, 10_000);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/groups', { name });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create');
    }
  };

  const binGroup = async (group: Group) => {
    if (!window.confirm(`Move "${group.name}" to the bin?`)) return;
    setError(null);
    try {
      await api.del(`/api/groups/${group.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to bin group');
    }
  };

  const restore = async (id: string) => {
    setError(null);
    try {
      await api.post(`/api/groups/${id}/restore`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to restore');
    }
  };

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Your groups</h1>
        <button className="ghost icon" title="Refresh" onClick={load}>
          <RefreshIcon />
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <form className="row" onSubmit={create}>
          <input
            placeholder="New group name (e.g. Goa Trip)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ flex: 1 }}
          />
          <button>Create</button>
        </form>
      </div>
      <div className="card">
        {groups === null ? (
          <p className="muted">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="muted">
            No groups yet — create one above and invite your friends.
          </p>
        ) : (
          <ul className="list">
            {groups.map((g) => (
              <li key={g.id}>
                <Link to={`/groups/${g.id}`} style={{ fontWeight: 600, flex: 1 }}>
                  {g.name}
                </Link>
                <span className="muted">
                  {g.member_count} member{g.member_count === 1 ? '' : 's'}
                </span>
                <button
                  className="danger icon"
                  title="Move to bin"
                  aria-label={`Move ${g.name} to bin`}
                  onClick={() => binGroup(g)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {bin.length > 0 && (
        <div className="card">
          <h2>Bin</h2>
          <ul className="list">
            {bin.map((g) => (
              <li key={g.id}>
                <span>
                  {g.name}
                  <br />
                  <span className="muted">
                    deletes forever in {daysUntil(g.purge_at)} day
                    {daysUntil(g.purge_at) === 1 ? '' : 's'}
                  </span>
                </span>
                <button className="ghost" onClick={() => restore(g.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
}
