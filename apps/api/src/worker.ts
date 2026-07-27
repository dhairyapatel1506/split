// The worker process: consumes jobs the API (or the scheduler) produces.
// Runs alongside the API as a separate process so slow work — emails, OCR,
// sweeps — never blocks an HTTP request.
import { Worker } from 'bullmq';
import { pino } from 'pino';
import { db } from './db.js';
import { sendEmail } from './email.js';
import {
  enqueueDebtReminders,
  purgeBinnedGroups,
  purgeOldBugReports,
  sendBugReportEmail,
} from './jobs.js';
import {
  closeQueues,
  createQueueConnection,
  housekeepingQueue,
  type BugReportJob,
  type EmailJob,
} from './queue.js';

const log = pino();

// Idempotent: upserting the same scheduler id updates it rather than
// duplicating it, so restarts are safe.
await housekeepingQueue.upsertJobScheduler(
  'purge-binned-groups',
  { every: 6 * 60 * 60 * 1000 },
  { name: 'purge-binned-groups' },
);
await housekeepingQueue.upsertJobScheduler(
  'debt-reminders',
  { pattern: '0 9 * * 1', tz: 'Asia/Kolkata' }, // Mondays 9:00 IST
  { name: 'debt-reminders' },
);
await housekeepingQueue.upsertJobScheduler(
  'purge-bug-reports',
  { every: 24 * 60 * 60 * 1000 },
  { name: 'purge-bug-reports' },
);

const emailWorker = new Worker<EmailJob | BugReportJob>(
  'emails',
  async (job) => {
    if (job.name === 'bug-report') {
      await sendBugReportEmail((job.data as BugReportJob).reportId);
    } else {
      await sendEmail(job.data as EmailJob);
    }
  },
  { connection: createQueueConnection() },
);

const housekeepingWorker = new Worker(
  'housekeeping',
  async (job) => {
    switch (job.name) {
      case 'purge-binned-groups': {
        const purged = await purgeBinnedGroups();
        if (purged > 0) log.info({ purged }, 'purged expired binned groups');
        break;
      }
      case 'debt-reminders': {
        const queued = await enqueueDebtReminders();
        log.info({ queued }, 'queued debt reminder emails');
        break;
      }
      case 'purge-bug-reports': {
        const purged = await purgeOldBugReports();
        if (purged > 0) log.info({ purged }, 'purged old bug reports');
        break;
      }
      default:
        log.warn({ name: job.name }, 'unknown housekeeping job');
    }
  },
  { connection: createQueueConnection() },
);

for (const worker of [emailWorker, housekeepingWorker]) {
  worker.on('failed', (job, err) => {
    log.error(
      { queue: worker.name, jobId: job?.id, jobName: job?.name, err: err.message },
      'job failed',
    );
  });
}

log.info('worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log.info({ signal }, 'worker shutting down');
    // close() waits for in-flight jobs to finish before resolving.
    await Promise.all([emailWorker.close(), housekeepingWorker.close()]);
    await closeQueues();
    await db.end();
    process.exit(0);
  });
}
