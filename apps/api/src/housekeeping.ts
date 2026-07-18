import type { FastifyBaseLogger } from 'fastify';
import { db } from './db.js';

export const BIN_RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Permanently deletes groups whose bin retention has expired. Runs at boot
// and every few hours; ON DELETE CASCADE removes the group's expenses,
// members, and settlements with it.
export function startHousekeeping(log: FastifyBaseLogger): () => void {
  const sweep = async () => {
    try {
      const res = await db.query(
        `DELETE FROM groups
          WHERE deleted_at < now() - make_interval(days => $1)`,
        [BIN_RETENTION_DAYS],
      );
      if (res.rowCount) {
        log.info({ purged: res.rowCount }, 'purged expired binned groups');
      }
    } catch (err) {
      log.error({ err }, 'bin purge sweep failed');
    }
  };
  void sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  return () => clearInterval(timer);
}
