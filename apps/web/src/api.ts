export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export type User = { id: string; email: string; name: string };
export type Group = {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
};
export type BinnedGroup = {
  id: string;
  name: string;
  deleted_at: string;
  purge_at: string;
};
export type Member = { id: string; name: string; email: string };
export type Invite = { email: string; created_at: string };
export type GroupDetail = {
  id: string;
  name: string;
  created_at: string;
  members: Member[];
  invites: Invite[];
};
export type Share = { user_id: string; share_cents: number };
export type Expense = {
  id: string;
  description: string;
  amount_cents: number;
  currency: string;
  paid_by: string;
  paid_by_name: string;
  spent_at: string;
  created_at: string;
  updated_at: string | null;
  shares: Share[];
};
export type Balances = {
  balances: { userId: string; name: string; netCents: number }[];
  suggestedSettlements: {
    fromUserId: string;
    toUserId: string;
    amountCents: number;
  }[];
};

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
});

export function formatMoney(cents: number): string {
  return inr.format(cents / 100);
}
