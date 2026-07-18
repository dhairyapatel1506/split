// Pure balance math — no I/O, fully unit-tested.

export type MemberTotals = {
  userId: string;
  paidCents: number;
  owedCents: number;
  sentCents: number;
  receivedCents: number;
};

export type Transfer = {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
};

// Split an amount equally, distributing leftover cents to the first
// participants so the shares always sum exactly to the total
// (e.g. 100 across 3 people -> 34, 33, 33).
export function equalSplit(
  amountCents: number,
  userIds: string[],
): { userId: string; shareCents: number }[] {
  const base = Math.floor(amountCents / userIds.length);
  const remainder = amountCents - base * userIds.length;
  return userIds.map((userId, i) => ({
    userId,
    shareCents: base + (i < remainder ? 1 : 0),
  }));
}

// Net position per member: positive = the group owes them money.
// Settling (sending cash) raises your net; receiving cash lowers it.
export function netBalances(rows: MemberTotals[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const r of rows) {
    net.set(r.userId, r.paidCents - r.owedCents + r.sentCents - r.receivedCents);
  }
  return net;
}

// Greedy debt simplification: repeatedly match the largest debtor with the
// largest creditor. Produces at most (members - 1) transfers instead of a
// web of pairwise debts.
export function simplifyDebts(net: Map<string, number>): Transfer[] {
  const creditors: { userId: string; amount: number }[] = [];
  const debtors: { userId: string; amount: number }[] = [];
  for (const [userId, amount] of net) {
    if (amount > 0) creditors.push({ userId, amount });
    else if (amount < 0) debtors.push({ userId, amount: -amount });
  }
  const byAmountDesc = (
    a: { userId: string; amount: number },
    b: { userId: string; amount: number },
  ) => b.amount - a.amount || a.userId.localeCompare(b.userId);
  creditors.sort(byAmountDesc);
  debtors.sort(byAmountDesc);

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    transfers.push({
      fromUserId: debtors[d].userId,
      toUserId: creditors[c].userId,
      amountCents: amount,
    });
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d++;
    if (creditors[c].amount === 0) c++;
  }
  return transfers;
}
