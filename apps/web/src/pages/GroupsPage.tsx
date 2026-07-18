import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Group } from '../api.js';

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .get<Group[]>('/api/groups')
      .then(setGroups)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  };
  useEffect(load, []);

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

  return (
    <main className="container">
      <h1>Your groups</h1>
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
                <Link to={`/groups/${g.id}`} style={{ fontWeight: 600 }}>
                  {g.name}
                </Link>
                <span className="muted">
                  {g.member_count} member{g.member_count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
