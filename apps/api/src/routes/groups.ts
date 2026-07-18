import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { BIN_RETENTION_DAYS } from '../jobs.js';
import { emailsQueue } from '../queue.js';

export const groupParams = z.object({ groupId: z.string().uuid() });

// Membership in a *live* group — binned groups behave as if deleted
// everywhere except the bin/restore endpoints.
export async function isMember(
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1
       FROM group_members m
       JOIN groups g ON g.id = m.group_id
      WHERE m.group_id = $1 AND m.user_id = $2 AND g.deleted_at IS NULL`,
    [groupId, userId],
  );
  return rows.length > 0;
}

export async function memberIds(groupId: string): Promise<Set<string>> {
  const { rows } = await db.query(
    'SELECT user_id FROM group_members WHERE group_id = $1',
    [groupId],
  );
  return new Set(rows.map((r) => r.user_id));
}

const createGroupBody = z.object({ name: z.string().trim().min(1).max(100) });
const addMemberBody = z.object({ email: z.string().email() });

export const groupRoutes: FastifyPluginAsync = async (app) => {
  // Applies to every route registered in this plugin.
  app.addHook('preHandler', requireAuth);

  app.post('/api/groups', async (req, reply) => {
    const { name } = createGroupBody.parse(req.body);
    const client = await db.connect();
    try {
      // Transaction: a group without its creator as member must not exist.
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO groups (name, created_by)
         VALUES ($1, $2) RETURNING id, name, created_at`,
        [name, req.userId],
      );
      await client.query(
        'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
        [rows[0].id, req.userId],
      );
      await client.query('COMMIT');
      return reply.code(201).send(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/api/groups', async (req) => {
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.created_at,
              (SELECT count(*)::int FROM group_members m2
                WHERE m2.group_id = g.id) AS member_count
         FROM groups g
         JOIN group_members m ON m.group_id = g.id
        WHERE m.user_id = $1 AND g.deleted_at IS NULL
        ORDER BY g.created_at DESC`,
      [req.userId],
    );
    return rows;
  });

  // Static route: registered besides /api/groups/:groupId, and the router
  // always prefers the static match, so a group named "bin" can't shadow it.
  app.get('/api/groups/bin', async (req) => {
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.deleted_at,
              g.deleted_at + make_interval(days => $2) AS purge_at
         FROM groups g
         JOIN group_members m ON m.group_id = g.id
        WHERE m.user_id = $1 AND g.deleted_at IS NOT NULL
        ORDER BY g.deleted_at DESC`,
      [req.userId, BIN_RETENTION_DAYS],
    );
    return rows;
  });

  app.delete('/api/groups/:groupId', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    await db.query(
      'UPDATE groups SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [groupId],
    );
    return { ok: true };
  });

  // Only binned groups can be permanently deleted — going through the bin
  // first means no single click can irreversibly destroy a live group.
  app.delete('/api/groups/:groupId/permanent', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    const { rows } = await db.query(
      `DELETE FROM groups g
        WHERE g.id = $1 AND g.deleted_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM group_members m
                       WHERE m.group_id = g.id AND m.user_id = $2)
        RETURNING g.id`,
      [groupId, req.userId],
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Group not found in bin' });
    }
    return { ok: true };
  });

  app.post('/api/groups/:groupId/restore', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    const { rows } = await db.query(
      `UPDATE groups g
          SET deleted_at = NULL
        WHERE g.id = $1 AND g.deleted_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM group_members m
                       WHERE m.group_id = g.id AND m.user_id = $2)
        RETURNING g.id`,
      [groupId, req.userId],
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Group not found in bin' });
    }
    return { ok: true };
  });

  app.get('/api/groups/:groupId', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    // Membership check folded into the fetch; non-members get the same 404
    // as a nonexistent group so group ids leak nothing.
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.created_at
         FROM groups g
         JOIN group_members m ON m.group_id = g.id
        WHERE g.id = $1 AND m.user_id = $2 AND g.deleted_at IS NULL`,
      [groupId, req.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Group not found' });
    const members = await db.query(
      `SELECT u.id, u.name, u.email
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 ORDER BY m.joined_at`,
      [groupId],
    );
    return { ...rows[0], members: members.rows };
  });

  app.delete('/api/groups/:groupId/members/:userId', async (req, reply) => {
    const { groupId, userId } = z
      .object({ groupId: z.string().uuid(), userId: z.string().uuid() })
      .parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    if (!(await isMember(groupId, userId))) {
      return reply.code(404).send({ error: 'Not a member of this group' });
    }

    // Removal never rewrites history: past expenses stay. To guarantee no
    // money disappears with the member, they must be fully settled first.
    const { rows } = await db.query(
      `SELECT (
         COALESCE((SELECT sum(amount_cents) FROM expenses
                    WHERE group_id = $1 AND paid_by = $2), 0)
       - COALESCE((SELECT sum(s.share_cents) FROM expense_shares s
                    JOIN expenses e ON e.id = s.expense_id
                    WHERE e.group_id = $1 AND s.user_id = $2), 0)
       + COALESCE((SELECT sum(amount_cents) FROM settlements
                    WHERE group_id = $1 AND from_user = $2), 0)
       - COALESCE((SELECT sum(amount_cents) FROM settlements
                    WHERE group_id = $1 AND to_user = $2), 0)
       )::bigint AS net`,
      [groupId, userId],
    );
    const net = rows[0].net as number;
    if (net !== 0) {
      return reply.code(409).send({
        error:
          net > 0
            ? 'They are still owed money in this group — settle up before removing them'
            : 'They still owe money in this group — settle up before removing them',
      });
    }

    const { rows: countRows } = await db.query(
      'SELECT count(*)::int AS n FROM group_members WHERE group_id = $1',
      [groupId],
    );
    if (countRows[0].n <= 1) {
      return reply
        .code(400)
        .send({ error: 'A group needs at least one member — bin the group instead' });
    }

    await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId],
    );
    return { ok: true };
  });

  app.post('/api/groups/:groupId/members', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    if (!(await isMember(groupId, req.userId))) {
      return reply.code(404).send({ error: 'Group not found' });
    }
    const { email } = addMemberBody.parse(req.body);
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    if (!rows[0]) {
      return reply
        .code(404)
        .send({ error: 'No account with that email — ask them to sign up first' });
    }
    const inserted = await db.query(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [groupId, rows[0].id],
    );

    // Notify the new member — but never fail the request over a
    // notification: the queue add is best-effort.
    if (inserted.rowCount) {
      try {
        const [group, inviter] = await Promise.all([
          db.query('SELECT name FROM groups WHERE id = $1', [groupId]),
          db.query('SELECT name FROM users WHERE id = $1', [req.userId]),
        ]);
        await emailsQueue.add('send', {
          to: email.toLowerCase(),
          subject: `${inviter.rows[0].name} added you to "${group.rows[0].name}" on Split`,
          text:
            `${inviter.rows[0].name} added you to the group ` +
            `"${group.rows[0].name}" on Split.\n\n` +
            `See what's shared: ${config.appBaseUrl}/groups/${groupId}\n\n— Split`,
        });
      } catch (err) {
        req.log.error({ err }, 'failed to enqueue invite email');
      }
    }
    return reply.code(201).send({ ok: true });
  });
};
