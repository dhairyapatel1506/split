import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { emailsQueue } from '../queue.js';
import { redis } from '../redis.js';

// Abuse limits, layered: sign-in required, 5 reports/user/day, ≤3 images
// of ≤2MB each (cut off mid-stream, not buffered), and files must *be*
// images — the first bytes are checked, the filename is not trusted.
const DAILY_LIMIT = 5;
const RATE_WINDOW_S = 24 * 60 * 60;

// Every image format opens with a fixed signature ("magic bytes"). This is
// what the file is, regardless of what it is called. PNG and JPEG only:
// Brevo rejects .webp attachments outright, and a format we accept here
// but can't deliver would fail silently after the reporter has moved on.
function sniffImageType(buf: Buffer): string | null {
  if (
    buf.length > 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export const bugReportRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/bug-reports',
    { preHandler: requireAuth },
    async (req, reply) => {
      // Check the quota before touching the upload — a rate-limited user
      // shouldn't get to stream megabytes at us first.
      const rlKey = `bugreports:${req.userId}`;
      if (Number((await redis.get(rlKey)) ?? 0) >= DAILY_LIMIT) {
        return reply.code(429).send({
          error: 'Report limit reached for today — please try again tomorrow',
        });
      }
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'Expected a multipart upload' });
      }

      let description = '';
      const images: { contentType: string; bytes: Buffer }[] = [];
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            const bytes = await part.toBuffer();
            if (bytes.length === 0) continue; // empty file input submitted
            const contentType = sniffImageType(bytes);
            if (!contentType) {
              return reply.code(400).send({
                error: 'Screenshots must be PNG or JPEG images',
              });
            }
            images.push({ contentType, bytes });
          } else if (part.fieldname === 'description') {
            description = String(part.value).trim();
          }
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply
            .code(413)
            .send({ error: 'Each screenshot must be 2 MB or smaller' });
        }
        if (code === 'FST_FILES_LIMIT') {
          return reply
            .code(400)
            .send({ error: 'At most 3 screenshots per report' });
        }
        throw err;
      }

      if (description.length < 10 || description.length > 2000) {
        return reply.code(400).send({
          error: 'Please describe the bug in 10–2000 characters',
        });
      }

      let reportId: string;
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO bug_reports (user_id, description, user_agent)
           VALUES ($1, $2, $3) RETURNING id`,
          [req.userId, description, req.headers['user-agent'] ?? null],
        );
        reportId = rows[0].id;
        for (const img of images) {
          await client.query(
            `INSERT INTO bug_report_images (report_id, content_type, bytes)
             VALUES ($1, $2, $3)`,
            [reportId, img.contentType, img.bytes],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Count against the quota only after a report actually lands.
      const count = await redis.incr(rlKey);
      if (count === 1) await redis.expire(rlKey, RATE_WINDOW_S);

      await emailsQueue.add('bug-report', { reportId });
      return reply.code(201).send({ ok: true });
    },
  );
};
