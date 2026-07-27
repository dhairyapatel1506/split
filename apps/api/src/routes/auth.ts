import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import { db } from '../db.js';
import { redis } from '../redis.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
const signupBody = credentials.extend({
  name: z.string().trim().min(1).max(100),
});

// Adds the new user to every live group they were invited to, then clears
// the invites (single-use by design). Runs inside the caller's transaction
// so account + memberships land together — shared by password signup and
// Google sign-in.
export async function redeemInvites(
  client: pg.PoolClient,
  email: string,
  userId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO group_members (group_id, user_id)
     SELECT i.group_id, $2
       FROM group_invites i
       JOIN groups g ON g.id = i.group_id AND g.deleted_at IS NULL
      WHERE i.email = $1
     ON CONFLICT DO NOTHING`,
    [email, userId],
  );
  await client.query('DELETE FROM group_invites WHERE email = $1', [email]);
}

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
      await redeemInvites(client, email, user.id);
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
    // Google-only accounts have no password_hash at all.
    if (user && user.password_hash === null) {
      return reply.code(401).send({
        error: 'This account uses Google sign-in — use “Continue with Google”',
      });
    }
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
      `SELECT id, email, name,
              password_hash IS NOT NULL AS has_password
         FROM users WHERE id = $1`,
      [req.userId],
    );
    const u = rows[0];
    return { id: u.id, email: u.email, name: u.name, hasPassword: u.has_password };
  });

  app.post(
    '/api/auth/delete-account',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { password } = z
        .object({ password: z.string().optional() })
        .parse(req.body);
      const { rows: urows } = await db.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.userId],
      );
      if (!urows[0]) {
        return reply.code(401).send({ error: 'Not signed in' });
      }
      // Password accounts must re-prove the password. Google-only accounts
      // have none to prove — the live session plus the explicit confirm
      // step in the UI is the barrier there.
      if (
        urows[0].password_hash !== null &&
        !(await verifyPassword(password ?? '', urows[0].password_hash))
      ) {
        return reply.code(401).send({ error: 'Incorrect password' });
      }

      // Deletion must not make money vanish: every live group they're in
      // has to be at net zero for them first.
      const { rows: unsettled } = await db.query(
        `SELECT g.name
           FROM groups g
           JOIN group_members m ON m.group_id = g.id AND m.user_id = $1
          WHERE g.deleted_at IS NULL
            AND ( COALESCE((SELECT sum(e.amount_cents) FROM expenses e
                             WHERE e.group_id = g.id AND e.paid_by = $1), 0)
                - COALESCE((SELECT sum(s.share_cents) FROM expense_shares s
                             JOIN expenses e2 ON e2.id = s.expense_id
                            WHERE e2.group_id = g.id AND s.user_id = $1), 0)
                + COALESCE((SELECT sum(st.amount_cents) FROM settlements st
                             WHERE st.group_id = g.id AND st.from_user = $1), 0)
                - COALESCE((SELECT sum(st.amount_cents) FROM settlements st
                             WHERE st.group_id = g.id AND st.to_user = $1), 0)
                ) <> 0`,
        [req.userId],
      );
      if (unsettled.length) {
        return reply.code(409).send({
          error:
            `Settle up first — you have an outstanding balance in: ` +
            unsettled.map((g) => g.name).join(', '),
        });
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // Groups where they are the only member would become unreachable —
        // bin them so the purge job disposes of them normally.
        await client.query(
          `UPDATE groups g SET deleted_at = now()
            WHERE g.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM group_members m
                           WHERE m.group_id = g.id AND m.user_id = $1)
              AND NOT EXISTS (SELECT 1 FROM group_members m
                               WHERE m.group_id = g.id AND m.user_id <> $1)`,
          [req.userId],
        );
        await client.query('DELETE FROM group_members WHERE user_id = $1', [
          req.userId,
        ]);
        await client.query('DELETE FROM group_invites WHERE invited_by = $1', [
          req.userId,
        ]);

        // Accounts woven into shared history are anonymized, not removed:
        // other members' balances and expense records must never change
        // because someone else left. Untouched accounts delete outright.
        const { rows: refs } = await client.query(
          `SELECT EXISTS(SELECT 1 FROM groups WHERE created_by = $1)
               OR EXISTS(SELECT 1 FROM expenses WHERE paid_by = $1)
               OR EXISTS(SELECT 1 FROM expense_shares WHERE user_id = $1)
               OR EXISTS(SELECT 1 FROM settlements
                          WHERE from_user = $1 OR to_user = $1) AS referenced`,
          [req.userId],
        );
        if (refs[0].referenced) {
          await client.query(
            `UPDATE users
                SET email = 'deleted-' || id || '@users.split.invalid',
                    name = 'Deleted user',
                    password_hash = 'deleted',
                    google_id = NULL
              WHERE id = $1`,
            [req.userId],
          );
        } else {
          await client.query('DELETE FROM users WHERE id = $1', [req.userId]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Revoke every session this user has anywhere, not just this one.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          'sess:*',
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length) {
          const vals = await redis.mget(...keys);
          const mine = keys.filter((_, i) => vals[i] === req.userId);
          if (mine.length) await redis.del(...mine);
        }
      } while (cursor !== '0');
      await destroySession(req, reply);
      return { ok: true };
    },
  );
};
