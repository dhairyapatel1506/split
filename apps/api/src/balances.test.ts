import { describe, expect, it } from 'vitest';
import {
  equalSplit,
  netBalances,
  simplifyDebts,
  type MemberTotals,
} from './balances.js';

const totals = (
  userId: string,
  paid = 0,
  owed = 0,
  sent = 0,
  received = 0,
): MemberTotals => ({
  userId,
  paidCents: paid,
  owedCents: owed,
  sentCents: sent,
  receivedCents: received,
});

describe('equalSplit', () => {
  it('divides evenly when possible', () => {
    expect(equalSplit(300, ['a', 'b', 'c'])).toEqual([
      { userId: 'a', shareCents: 100 },
      { userId: 'b', shareCents: 100 },
      { userId: 'c', shareCents: 100 },
    ]);
  });

  it('distributes remainder cents and always sums to the total', () => {
    const shares = equalSplit(100, ['a', 'b', 'c']);
    expect(shares.map((s) => s.shareCents)).toEqual([34, 33, 33]);
    expect(shares.reduce((sum, s) => sum + s.shareCents, 0)).toBe(100);
  });

  it('handles a single participant', () => {
    expect(equalSplit(999, ['a'])).toEqual([{ userId: 'a', shareCents: 999 }]);
  });
});

describe('netBalances', () => {
  it('sums to zero across the group', () => {
    const net = netBalances([
      totals('a', 300000, 175000),
      totals('b', 50000, 175000),
    ]);
    expect(net.get('a')).toBe(125000);
    expect(net.get('b')).toBe(-125000);
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('settlements move balances toward zero', () => {
    const net = netBalances([
      totals('a', 300000, 175000, 0, 125000),
      totals('b', 50000, 175000, 125000, 0),
    ]);
    expect(net.get('a')).toBe(0);
    expect(net.get('b')).toBe(0);
  });
});

describe('simplifyDebts', () => {
  it('returns nothing when everyone is even', () => {
    expect(simplifyDebts(new Map([['a', 0], ['b', 0]]))).toEqual([]);
  });

  it('matches a single debtor with a single creditor', () => {
    const transfers = simplifyDebts(new Map([['a', 500], ['b', -500]]));
    expect(transfers).toEqual([
      { fromUserId: 'b', toUserId: 'a', amountCents: 500 },
    ]);
  });

  it('needs at most members-1 transfers and conserves every balance', () => {
    const net = new Map([
      ['a', 700],
      ['b', -200],
      ['c', -500],
      ['d', 300],
      ['e', -300],
    ]);
    const transfers = simplifyDebts(net);
    expect(transfers.length).toBeLessThanOrEqual(4);

    const applied = new Map([...net].map(([k]) => [k, 0]));
    for (const t of transfers) {
      applied.set(t.fromUserId, applied.get(t.fromUserId)! - t.amountCents);
      applied.set(t.toUserId, applied.get(t.toUserId)! + t.amountCents);
    }
    // The transfers exactly reproduce each member's net position:
    // debtors pay out their debt, creditors receive their credit.
    for (const [userId, amount] of net) {
      expect(applied.get(userId)).toBe(amount);
    }
  });
});
