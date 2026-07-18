// All environment-dependent values live here (12-factor style): the code is
// identical in dev and prod; only the environment injects different values.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://split:split@localhost:5432/split',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
};
