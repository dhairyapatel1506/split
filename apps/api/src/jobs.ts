// Job implementations executed by the worker process.
import { config } from './config.js';
import { db } from './db.js';
import { emailsQueue } from './queue.js';

export const BIN_RETENTION_DAYS = 30;

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
});

export async function purgeBinnedGroups(): Promise<number> {
  const res = await db.query(
    'DELETE FROM groups WHERE deleted_at < now() - make_interval(days => $1)',
    [BIN_RETENTION_DAYS],
  );
  return res.rowCount ?? 0;
}

// Weekly sweep: compute every member's net position per live group and
// enqueue one summary email per user who owes money anywhere. This job
// only fans out email jobs — actual sending (and its retries) stays in
// the emails queue.
export async function enqueueDebtReminders(): Promise<number> {
  const { rows } = await db.query(
    `SELECT m.group_id, g.name AS group_name, m.user_id, u.email,
            u.name AS user_name,
            COALESCE(p.paid, 0)::bigint      AS paid_cents,
            COALESCE(o.owed, 0)::bigint      AS owed_cents,
            COALESCE(so.sent, 0)::bigint     AS sent_cents,
            COALESCE(si.received, 0)::bigint AS received_cents
       FROM group_members m
       JOIN groups g ON g.id = m.group_id AND g.deleted_at IS NULL
       JOIN users u ON u.id = m.user_id
       LEFT JOIN (SELECT group_id, paid_by, sum(amount_cents) AS paid
                    FROM expenses GROUP BY group_id, paid_by) p
              ON p.group_id = m.group_id AND p.paid_by = m.user_id
       LEFT JOIN (SELECT e.group_id, s.user_id, sum(s.share_cents) AS owed
                    FROM expense_shares s
                    JOIN expenses e ON e.id = s.expense_id
                   GROUP BY e.group_id, s.user_id) o
              ON o.group_id = m.group_id AND o.user_id = m.user_id
       LEFT JOIN (SELECT group_id, from_user, sum(amount_cents) AS sent
                    FROM settlements GROUP BY group_id, from_user) so
              ON so.group_id = m.group_id AND so.from_user = m.user_id
       LEFT JOIN (SELECT group_id, to_user, sum(amount_cents) AS received
                    FROM settlements GROUP BY group_id, to_user) si
              ON si.group_id = m.group_id AND si.to_user = m.user_id`,
  );

  type Debtor = {
    email: string;
    name: string;
    debts: { groupName: string; amountCents: number }[];
  };
  const debtors = new Map<string, Debtor>();
  for (const r of rows) {
    const net =
      r.paid_cents - r.owed_cents + r.sent_cents - r.received_cents;
    if (net >= 0) continue;
    const d: Debtor = debtors.get(r.user_id) ?? {
      email: r.email,
      name: r.user_name,
      debts: [],
    };
    d.debts.push({ groupName: r.group_name, amountCents: -net });
    debtors.set(r.user_id, d);
  }

  for (const d of debtors.values()) {
    const total = d.debts.reduce((sum, x) => sum + x.amountCents, 0);
    const lines = d.debts
      .map((x) => `• ${x.groupName}: you owe ${inr.format(x.amountCents / 100)}`)
      .join('\n');
    await emailsQueue.add('send', {
      to: d.email,
      subject: `Reminder: you owe ${inr.format(total / 100)} on Split`,
      text:
        `Hi ${d.name},\n\nA quick weekly reminder of your open balances:\n\n` +
        `${lines}\n\nSettle up: ${config.appBaseUrl}\n\n— Split`,
    });
  }
  return debtors.size;
}
