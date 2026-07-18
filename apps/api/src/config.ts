// All environment-dependent values live here (12-factor style): the code is
// identical in dev and prod; only the environment injects different values.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://split:split@localhost:5432/split',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  cookieSecret: process.env.COOKIE_SECRET ?? 'dev-only-insecure-secret',
  isProd: process.env.NODE_ENV === 'production',
  brevoApiKey: process.env.BREVO_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'split@dhairya.cloud',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5173',
};
