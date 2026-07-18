import cookie from '@fastify/cookie';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { redis } from './redis.js';
import { authRoutes } from './routes/auth.js';
import { expenseRoutes } from './routes/expenses.js';
import { groupRoutes } from './routes/groups.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cookie, { secret: config.cookieSecret });
  app.decorateRequest('userId', '');

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        issues: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.log.error(err);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(status).send({
      error: status === 500 ? 'Internal server error' : err.message,
    });
  });

  app.get('/api/health', async (_req, reply) => {
    const checks = { db: false, redis: false };
    try {
      await db.query('SELECT 1');
      checks.db = true;
    } catch {}
    try {
      checks.redis = (await redis.ping()) === 'PONG';
    } catch {}

    const ok = checks.db && checks.redis;
    reply.code(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks, uptime: process.uptime() };
  });

  app.register(authRoutes);
  app.register(groupRoutes);
  app.register(expenseRoutes);

  app.addHook('onClose', async () => {
    await db.end();
    redis.disconnect();
  });

  return app;
}
