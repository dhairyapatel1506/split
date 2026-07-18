import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';

export const groupParams = z.object({ groupId: z.string().uuid() });

export async function isMember(
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
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
        WHERE m.user_id = $1
        ORDER BY g.created_at DESC`,
      [req.userId],
    );
    return rows;
  });

  app.get('/api/groups/:groupId', async (req, reply) => {
    const { groupId } = groupParams.parse(req.params);
    // Membership check folded into the fetch; non-members get the same 404
    // as a nonexistent group so group ids leak nothing.
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.created_at
         FROM groups g
         JOIN group_members m ON m.group_id = g.id
        WHERE g.id = $1 AND m.user_id = $2`,
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
    await db.query(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [groupId, rows[0].id],
    );
    return reply.code(201).send({ ok: true });
  });
};
