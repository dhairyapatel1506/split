import Fastify from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { config } from './config.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  const db = new pg.Pool({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  // Without a listener, a down Redis would crash the process via an
  // unhandled 'error' event; the health check reports it instead.
  redis.on('error', (err) => app.log.debug({ err }, 'redis connection error'));

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

  app.addHook('onClose', async () => {
    await db.end();
    redis.disconnect();
  });

  return app;
}
