import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { closeQueues, emailsQueue, housekeepingQueue } from './queue.js';
import { redis } from './redis.js';
import { authRoutes } from './routes/auth.js';
import { bugReportRoutes } from './routes/bug-reports.js';
import { expenseRoutes } from './routes/expenses.js';
import { googleAuthRoutes } from './routes/google.js';
import { groupRoutes } from './routes/groups.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cookie, { secret: config.cookieSecret });
  // Upload limits are enforced while the request streams in — an oversized
  // file is cut off at 2MB, never buffered whole.
  app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024, files: 3, fields: 5 },
  });
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
  app.register(googleAuthRoutes);
  app.register(groupRoutes);
  app.register(expenseRoutes);
  app.register(bugReportRoutes);

  // Dev-only queue dashboard at /admin/queues. Guarded out of production
  // builds entirely — admin tooling on a public server needs real auth.
  if (!config.isProd) {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath('/admin/queues');
    createBullBoard({
      queues: [
        new BullMQAdapter(emailsQueue),
        new BullMQAdapter(housekeepingQueue),
      ],
      serverAdapter,
    });
    app.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues' });
  }

  app.addHook('onClose', async () => {
    await closeQueues();
    await db.end();
    redis.disconnect();
  });

  return app;
}
