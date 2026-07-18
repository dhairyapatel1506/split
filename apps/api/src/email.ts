import { pino } from 'pino';
import { config } from './config.js';
import type { EmailJob } from './queue.js';

const log = pino();

// One send function, two transports: without a BREVO_API_KEY every email is
// just logged (dev), with one it goes out via Brevo's HTTP API (prod).
// A thrown error propagates to BullMQ, which retries the job.
export async function sendEmail(msg: EmailJob): Promise<void> {
  if (!config.brevoApiKey) {
    log.info(
      { to: msg.to, subject: msg.subject, text: msg.text },
      'email (dev transport — set BREVO_API_KEY to send for real)',
    );
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: config.emailFrom, name: 'Split' },
      to: [{ email: msg.to }],
      subject: msg.subject,
      textContent: msg.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
  }
}
