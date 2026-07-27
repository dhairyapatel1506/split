// Loads the repo-root .env into process.env if present; silently a no-op
// when the file doesn't exist. Production supplies real env vars instead.
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname });

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
  // Google OAuth credentials; when unset, Google sign-in returns 503.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  // Where bug reports land. Fixed server-side on purpose: user input can
  // never choose an email recipient.
  bugReportEmail:
    process.env.BUG_REPORT_EMAIL ?? 'dhairyapatel.cloud@gmail.com',
};
