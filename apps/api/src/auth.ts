import {
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { redis } from './redis.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

// scrypt is a deliberately slow, memory-hard hash: brute-forcing stolen
// hashes is expensive. Stored as "salt:hash" so each user gets a unique salt.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const hash = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE = 'sid';

export async function createSession(
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const sid = randomUUID();
  await redis.set(`sess:${sid}`, userId, 'EX', SESSION_TTL_S);
  reply.setCookie(SESSION_COOKIE, sid, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: SESSION_TTL_S,
  });
}

export async function destroySession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sid = readSid(req);
  if (sid) await redis.del(`sess:${sid}`);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readSid(req: FastifyRequest): string | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const { valid, value } = req.unsignCookie(raw);
  return valid && value ? value : null;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

// preHandler hook: rejects unauthenticated requests, attaches userId.
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sid = readSid(req);
  const userId = sid ? await redis.get(`sess:${sid}`) : null;
  if (!userId) {
    return reply.code(401).send({ error: 'Not signed in' });
  }
  req.userId = userId;
}
