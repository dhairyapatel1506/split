import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  formatMoney,
  type Balances,
  type Expense,
  type GroupDetail,
  type User,
} from '../api.js';
import { usePoll } from '../hooks.js';
import { RefreshIcon, TrashIcon, XIcon } from '../icons.js';

export function GroupPage({ me }: { me: User }) {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!groupId) return;
    Promise.all([
      api.get<GroupDetail>(`/api/groups/${groupId}`),
      api.get<Expense[]>(`/api/groups/${groupId}/expenses`),
      api.get<Balances>(`/api/groups/${groupId}/balances`),
    ])
      .then(([g, e, b]) => {
        setGroup(g);
        setExpenses(e);
        setBalances(b);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [groupId]);
  useEffect(load, [load]);
  usePoll(load, 5_000);

  if (error) {
    return (
      <main className="container">
        <div className="error">{error}</div>
        <Link to="/">← Back to groups</Link>
      </main>
    );
  }
  if (!group || !balances) {
    return <main className="container muted">Loading…</main>;
  }

  const memberName = (id: string) =>
    group.members.find((m) => m.id === id)?.name ?? '?';

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{group.name}</h1>
        <span className="row">
          <button className="ghost icon" title="Refresh" onClick={load}>
            <RefreshIcon />
          </button>
          <Link to="/" className="muted">
            ← All groups
          </Link>
        </span>
      </div>

      <BalancesCard
        me={me}
        balances={balances}
        memberName={memberName}
        groupId={group.id}
        onChanged={load}
      />
      <AddExpenseCard me={me} group={group} onAdded={load} />
      <ExpensesCard expenses={expenses} groupId={group.id} onChanged={load} />
      <MembersCard me={me} group={group} onChanged={load} />
    </main>
  );
}

function BalancesCard({
  me,
  balances,
  memberName,
  groupId,
  onChanged,
}: {
  me: User;
  balances: Balances;
  memberName: (id: string) => string;
  groupId: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const allEven = balances.balances.every((b) => b.netCents === 0);

  const settle = async (toUserId: string, amountCents: number) => {
    setError(null);
    try {
      await api.post(`/api/groups/${groupId}/settlements`, {
        toUserId,
        amountCents,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to settle');
    }
  };

  return (
    <div className="card">
      <h2>Balances</h2>
      {error && <div className="error">{error}</div>}
      <ul className="list">
        {balances.balances.map((b) => (
          <li key={b.userId}>
            <span>{b.userId === me.id ? 'You' : b.name}</span>
            {b.netCents === 0 ? (
              <span className="muted">settled up</span>
            ) : b.netCents > 0 ? (
              <span className="pos">gets back {formatMoney(b.netCents)}</span>
            ) : (
              <span className="neg">owes {formatMoney(-b.netCents)}</span>
            )}
          </li>
        ))}
      </ul>
      {!allEven && balances.suggestedSettlements.length > 0 && (
        <>
          <h2 style={{ marginTop: '1rem' }}>Settle up</h2>
          <ul className="list">
            {balances.suggestedSettlements.map((s, i) => (
              <li key={i}>
                <span>
                  {s.fromUserId === me.id ? 'You' : memberName(s.fromUserId)}{' '}
                  → {s.toUserId === me.id ? 'you' : memberName(s.toUserId)}:{' '}
                  <strong>{formatMoney(s.amountCents)}</strong>
                </span>
                {s.fromUserId === me.id && (
                  <button onClick={() => settle(s.toUserId, s.amountCents)}>
                    I paid this
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AddExpenseCard({
  me,
  group,
  onAdded,
}: {
  me: User;
  group: GroupDetail;
  onAdded: () => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(me.id);
  const [participants, setParticipants] = useState<Set<string>>(
    () => new Set(group.members.map((m) => m.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountCents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (participants.size === 0) {
      setError('Pick at least one participant');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/groups/${group.id}/expenses`, {
        description,
        amountCents,
        paidBy,
        split: { type: 'equal', userIds: [...participants] },
      });
      setDescription('');
      setAmount('');
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Add expense</h2>
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <input
            placeholder="What was it? (e.g. Dinner)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            style={{ flex: 2, minWidth: '10rem' }}
          />
          <input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="₹ 0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            style={{ flex: 1, minWidth: '6rem' }}
          />
        </div>
        <div className="row">
          <span className="muted">Paid by</span>
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {group.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === me.id ? 'You' : m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="muted">Split equally between</span>
          <div className="checks">
            {group.members.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={participants.has(m.id)}
                  onChange={() => toggle(m.id)}
                />
                {m.id === me.id ? 'You' : m.name}
              </label>
            ))}
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>Add expense</button>
      </form>
    </div>
  );
}

function ExpensesCard({
  expenses,
  groupId,
  onChanged,
}: {
  expenses: Expense[];
  groupId: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const remove = async (e: Expense) => {
    if (
      !window.confirm(
        `Delete "${e.description}" (${formatMoney(e.amount_cents)})? Balances will recalculate.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.del(`/api/groups/${groupId}/expenses/${e.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="card">
      <h2>Expenses</h2>
      {error && <div className="error">{error}</div>}
      {expenses.length === 0 ? (
        <p className="muted">Nothing yet — add the first expense above.</p>
      ) : (
        <ul className="list">
          {expenses.map((e) => (
            <li key={e.id}>
              <span style={{ flex: 1 }}>
                <strong>{e.description}</strong>
                <br />
                <span className="muted">
                  paid by {e.paid_by_name} · split {e.shares.length} way
                  {e.shares.length === 1 ? '' : 's'}
                </span>
              </span>
              <span style={{ fontWeight: 600 }}>
                {formatMoney(e.amount_cents)}
              </span>
              <button
                className="danger icon"
                title="Delete expense"
                aria-label={`Delete ${e.description}`}
                onClick={() => remove(e)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MembersCard({
  me,
  group,
  onChanged,
}: {
  me: User;
  group: GroupDetail;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ invited?: boolean }>(
        `/api/groups/${group.id}/members`,
        { email },
      );
      if (res.invited) {
        setNotice(
          `Invitation sent to ${email} — they'll join as soon as they sign up.`,
        );
      }
      setEmail('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add');
    }
  };

  const cancelInvite = async (inviteEmail: string) => {
    setError(null);
    setNotice(null);
    try {
      await api.del(
        `/api/groups/${group.id}/invites/${encodeURIComponent(inviteEmail)}`,
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  };

  const remove = async (m: { id: string; name: string }) => {
    const prompt =
      m.id === me.id
        ? `Leave "${group.name}"?`
        : `Remove ${m.name} from "${group.name}"?`;
    if (!window.confirm(prompt)) return;
    setError(null);
    try {
      await api.del(`/api/groups/${group.id}/members/${m.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove');
    }
  };

  return (
    <div className="card">
      <h2>Members</h2>
      <ul className="list">
        {group.members.map((m) => (
          <li key={m.id}>
            <span style={{ flex: 1 }}>
              {m.id === me.id ? 'You' : m.name}
            </span>
            <span className="muted">{m.email}</span>
            <button
              className="ghost icon"
              title={m.id === me.id ? 'Leave group' : `Remove ${m.name}`}
              aria-label={m.id === me.id ? 'Leave group' : `Remove ${m.name}`}
              onClick={() => remove(m)}
            >
              <XIcon />
            </button>
          </li>
        ))}
        {group.invites.map((inv) => (
          <li key={inv.email}>
            <span style={{ flex: 1 }} className="muted">
              {inv.email}
            </span>
            <span className="muted">invited — waiting for signup</span>
            <button
              className="ghost icon"
              title={`Cancel invite for ${inv.email}`}
              aria-label={`Cancel invite for ${inv.email}`}
              onClick={() => cancelInvite(inv.email)}
            >
              <XIcon />
            </button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={add} style={{ marginTop: '0.5rem' }}>
        <input
          type="email"
          placeholder="Invite by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ flex: 1 }}
        />
        <button className="ghost">Add member</button>
      </form>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
