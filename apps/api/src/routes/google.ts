import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { createSession } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { redeemInvites } from './auth.js';

// Server-side OAuth 2.0 authorization-code flow. The browser only ever
// carries a one-time code; the client secret and token exchange stay on
// the server. No OAuth library — the flow is two redirects and one POST.

const STATE_COOKIE = 'oauth_state';
const REDIRECT_PATH = '/api/auth/google/callback';

export const googleAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/auth/google', async (_req, reply) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      return reply
        .code(503)
        .send({ error: 'Google sign-in is not configured' });
    }
    // Random state, echoed back by Google and checked against this signed
    // cookie: the callback only accepts flows this server started (CSRF
    // protection for the login itself).
    const state = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      path: REDIRECT_PATH,
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: `${config.appBaseUrl}${REDIRECT_PATH}`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    );
  });

  app.get(REDIRECT_PATH, async (req, reply) => {
    // Any failure lands back on the login page with a generic marker —
    // this is a top-level browser navigation, not a fetch, so errors must
    // travel by redirect rather than JSON.
    const fail = () => reply.redirect(`${config.appBaseUrl}/?error=google`);

    const q = req.query as { code?: string; state?: string };
    const rawState = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: REDIRECT_PATH });
    const unsigned = rawState ? req.unsignCookie(rawState) : null;
    if (!q.code || !q.state || !unsigned?.valid || unsigned.value !== q.state) {
      return fail();
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: `${config.appBaseUrl}${REDIRECT_PATH}`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      req.log.error(
        { status: tokenRes.status, body: await tokenRes.text() },
        'google token exchange failed',
      );
      return fail();
    }
    const { id_token: idToken } = (await tokenRes.json()) as {
      id_token?: string;
    };
    if (!idToken) return fail();

    // The id_token arrived straight from Google over TLS in the exchange
    // above, so decoding its payload is sufficient — signature checks are
    // only needed for tokens received from an untrusted party (per
    // Google's own OpenID Connect docs).
    let claims: {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    try {
      claims = JSON.parse(
        Buffer.from(idToken.split('.')[1], 'base64url').toString(),
      );
    } catch {
      return fail();
    }
    if (!claims.sub || !claims.email || claims.email_verified !== true) {
      return fail();
    }
    const email = claims.email.toLowerCase();
    const name = claims.name?.trim() || email.split('@')[0];

    let user: { id: string };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // 1) Returning Google user — matched on Google's stable id.
      const bySub = await client.query(
        'SELECT id FROM users WHERE google_id = $1',
        [claims.sub],
      );
      if (bySub.rows[0]) {
        user = bySub.rows[0];
      } else {
        // 2) Existing password account with this email: link it. Safe
        // because Google has verified the address belongs to this person.
        const byEmail = await client.query(
          'UPDATE users SET google_id = $1 WHERE email = $2 RETURNING id',
          [claims.sub, email],
        );
        if (byEmail.rows[0]) {
          user = byEmail.rows[0];
        } else {
          // 3) Brand new user — no password, invites redeem exactly as in
          // password signup.
          const created = await client.query(
            `INSERT INTO users (email, name, google_id)
             VALUES ($1, $2, $3) RETURNING id`,
            [email, name, claims.sub],
          );
          user = created.rows[0];
          await redeemInvites(client, email, user.id);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error(err, 'google sign-in upsert failed');
      return fail();
    } finally {
      client.release();
    }

    await createSession(reply, user.id);
    return reply.redirect(`${config.appBaseUrl}/`);
  });
};
