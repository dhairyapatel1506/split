import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

// BullMQ requires maxRetriesPerRequest: null — it manages its own blocking
// commands and reconnection, unlike our request/response redis client.
export function createQueueConnection(): Redis {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

const connection = createQueueConnection();

export type EmailJob = { to: string; subject: string; text: string };

export const emailsQueue = new Queue<EmailJob>('emails', {
  connection,
  defaultJobOptions: {
    // Transient failures (mail provider down) retry with exponential
    // backoff: 5s, 10s, 20s — then land in the failed set for inspection.
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  },
});

export const housekeepingQueue = new Queue('housekeeping', { connection });

export async function closeQueues(): Promise<void> {
  await emailsQueue.close();
  await housekeepingQueue.close();
  await connection.quit();
}
