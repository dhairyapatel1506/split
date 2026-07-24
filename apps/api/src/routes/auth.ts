import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import { db } from '../db.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
const signupBody = credentials.extend({
  name: z.string().trim().min(1).max(100),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/signup', async (req, reply) => {
    const body = signupBody.parse(req.body);
    const email = body.email.toLowerCase();
    const passwordHash = await hashPassword(body.password);
    let user;
    const client = await db.connect();
    try {
      // One transaction: the account and its invite redemptions land
      // together or not at all.
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3) RETURNING id, email, name`,
        [email, body.name, passwordHash],
      );
      user = rows[0];
      // Redeem pending group invites for this email (live groups only),
      // then clear them — they are single-use by design.
      await client.query(
        `INSERT INTO group_members (group_id, user_id)
         SELECT i.group_id, $2
           FROM group_invites i
           JOIN groups g ON g.id = i.group_id AND g.deleted_at IS NULL
          WHERE i.email = $1
         ON CONFLICT DO NOTHING`,
        [email, user.id],
      );
      await client.query('DELETE FROM group_invites WHERE email = $1', [
        email,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // 23505 = unique_violation on users.email
      if ((err as { code?: string }).code === '23505') {
        return reply
          .code(409)
          .send({ error: 'An account with this email already exists' });
      }
      throw err;
    } finally {
      client.release();
    }
    await createSession(reply, user.id);
    return reply.code(201).send(user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = credentials.parse(req.body);
    const { rows } = await db.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [body.email.toLowerCase()],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    await createSession(reply, user.id);
    return { id: user.id, email: user.email, name: user.name };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const { rows } = await db.query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [req.userId],
    );
    return rows[0];
  });
};
