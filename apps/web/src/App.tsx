import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { api, type User } from './api.js';
import { AccountPage } from './pages/AccountPage.js';
import { AuthPage } from './pages/AuthPage.js';
import { GroupPage } from './pages/GroupPage.js';
import { GroupsPage } from './pages/GroupsPage.js';

export function App() {
  const [me, setMe] = useState<User | null | 'loading'>('loading');

  useEffect(() => {
    api
      .get<User>('/api/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === 'loading') {
    return <div className="auth-wrap muted">Loading…</div>;
  }

  if (!me) {
    return <AuthPage onAuth={setMe} />;
  }

  const logout = async () => {
    await api.post('/api/auth/logout');
    setMe(null);
  };

  return (
    <BrowserRouter>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/logo.png" alt="Split" className="brand-logo" />
        </Link>
        <span className="user">
          <Link to="/account" className="muted">
            {me.name}
          </Link>
          <button className="ghost" onClick={logout}>
            Log out
          </button>
        </span>
      </header>
      <Routes>
        <Route path="/" element={<GroupsPage />} />
        <Route path="/groups/:groupId" element={<GroupPage me={me} />} />
        <Route
          path="/account"
          element={<AccountPage me={me} onDeleted={() => setMe(null)} />}
        />
      </Routes>
    </BrowserRouter>
  );
}
