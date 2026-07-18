import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

// Without a listener, a down Redis crashes the process via an unhandled
// 'error' event; the health endpoint surfaces connectivity instead.
redis.on('error', () => {});
