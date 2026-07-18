import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  equalSplit,
  netBalances,
  simplifyDebts,
  type MemberTotals,
} from '../balances.js';
import { db } from '../db.js';
import { groupParams, isMember, memberIds } from './groups.js';

const expenseBody = z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  paidBy: z.string().uuid().optional(), // defaults to the caller
  split: z.discriminatedUnion('type', [
    // equal: divide among userIds (default: every member)
    z.object({
      type: z.literal('equal'),
      userIds: z.array(z.string().uuid()).min(1).optional(),
    }),
    // exact: caller specifies each share; must sum to amountCents
    z.object({
      type: z.literal('exact'),
      shares: z
        .array(
          z.object({
            userId: z.string().uuid(),
            amountCents: z.number().int().positive(),
          }),
        )
        .min(1),
    }),
  ]),
});

const settlementBody = z.object({
  toUserId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  note: z.string().max(200).optional(),
});

export const expenseRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post('/api/groups/:groupId/expenses', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    const body = expenseBody.parse(req.body);
    const members = await memberIds(groupId);
    const paidBy = body.paidBy ?? req.userId;
    if (!members.has(paidBy)) {
      return reply.code(400).send({ error: 'Payer is not a group member' });
    }

    let shares: { userId: string; shareCents: number }[];
    if (body.split.type === 'equal') {
      const ids = body.split.userIds ?? [...members];
      if (!ids.every((id) => members.has(id))) {
        return reply
          .code(400)
          .send({ error: 'All participants must be group members' });
      }
      shares = equalSplit(body.amountCents, ids);
    } else {
      const ids = body.split.shares.map((s) => s.userId);
      if (new Set(ids).size !== ids.length) {
        return reply.code(400).send({ error: 'Duplicate user in shares' });
      }
      if (!ids.every((id) => members.has(id))) {
        return reply
          .code(400)
          .send({ error: 'All participants must be group members' });
      }
      const sum = body.split.shares.reduce((a, s) => a + s.amountCents, 0);
      if (sum !== body.amountCents) {
        return reply.code(400).send({
          error: `Shares add up to ${sum}, expected ${body.amountCents}`,
        });
      }
      shares = body.split.shares.map((s) => ({
        userId: s.userId,
        shareCents: s.amountCents,
      }));
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO expenses (group_id, description, amount_cents, paid_by, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, description, amount_cents, currency, paid_by, spent_at, created_at`,
        [groupId, body.description, body.amountCents, paidBy, req.userId],
      );
      for (const s of shares) {
        await client.query(
          `INSERT INTO expense_shares (expense_id, user_id, share_cents)
           VALUES ($1, $2, $3)`,
          [rows[0].id, s.userId, s.shareCents],
        );
      }
      await client.query('COMMIT');
      return reply.code(201).send({ ...rows[0], shares });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/api/groups/:groupId/expenses', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    const { rows: expenses } = await db.query(
      `SELECT e.id, e.description, e.amount_cents, e.currency, e.paid_by,
              u.name AS paid_by_name, e.spent_at, e.created_at
         FROM expenses e JOIN users u ON u.id = e.paid_by
        WHERE e.group_id = $1 ORDER BY e.created_at DESC`,
      [groupId],
    );
    const { rows: shares } = await db.query(
      `SELECT s.expense_id, s.user_id, s.share_cents
         FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.group_id = $1`,
      [groupId],
    );
    const byExpense = new Map<string, typeof shares>();
    for (const s of shares) {
      const list = byExpense.get(s.expense_id) ?? [];
      list.push(s);
      byExpense.set(s.expense_id, list);
    }
    return expenses.map((e) => ({ ...e, shares: byExpense.get(e.id) ?? [] }));
  });

  app.post('/api/groups/:groupId/settlements', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    const body = settlementBody.parse(req.body);
    if (body.toUserId === req.userId) {
      return reply.code(400).send({ error: 'Cannot settle with yourself' });
    }
    if (!(await isMember(groupId, body.toUserId))) {
      return reply
        .code(400)
        .send({ error: 'Recipient is not a group member' });
    }
    const { rows } = await db.query(
      `INSERT INTO settlements (group_id, from_user, to_user, amount_cents, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, from_user, to_user, amount_cents, note, created_at`,
      [groupId, req.userId, body.toUserId, body.amountCents, body.note ?? null],
    );
    return reply.code(201).send(rows[0]);
  });

  app.get('/api/groups/:groupId/balances', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.name,
              -- sum(bigint) yields numeric, which the driver returns as a
              -- string; cast back to bigint so it parses as a JS number.
              COALESCE(p.paid, 0)::bigint      AS paid_cents,
              COALESCE(o.owed, 0)::bigint      AS owed_cents,
              COALESCE(so.sent, 0)::bigint     AS sent_cents,
              COALESCE(si.received, 0)::bigint AS received_cents
         FROM group_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN (SELECT paid_by, sum(amount_cents) AS paid
                      FROM expenses WHERE group_id = $1 GROUP BY paid_by) p
                ON p.paid_by = u.id
         LEFT JOIN (SELECT s.user_id, sum(s.share_cents) AS owed
                      FROM expense_shares s
                      JOIN expenses e ON e.id = s.expense_id
                     WHERE e.group_id = $1 GROUP BY s.user_id) o
                ON o.user_id = u.id
         LEFT JOIN (SELECT from_user, sum(amount_cents) AS sent
                      FROM settlements WHERE group_id = $1 GROUP BY from_user) so
                ON so.from_user = u.id
         LEFT JOIN (SELECT to_user, sum(amount_cents) AS received
                      FROM settlements WHERE group_id = $1 GROUP BY to_user) si
                ON si.to_user = u.id
        WHERE m.group_id = $1`,
      [groupId],
    );
    const totals: MemberTotals[] = rows.map((r) => ({
      userId: r.user_id,
      paidCents: r.paid_cents,
      owedCents: r.owed_cents,
      sentCents: r.sent_cents,
      receivedCents: r.received_cents,
    }));
    const net = netBalances(totals);
    return {
      balances: rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        netCents: net.get(r.user_id) ?? 0,
      })),
      suggestedSettlements: simplifyDebts(net),
    };
  });
};
