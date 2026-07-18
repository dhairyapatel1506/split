import { buildApp } from './app.js';
import { config } from './config.js';
import { startHousekeeping } from './housekeeping.js';

const app = buildApp();
const stopHousekeeping = startHousekeeping(app.log);

// Docker sends SIGTERM on `docker stop`; closing cleanly lets in-flight
// requests finish and releases DB connections instead of dropping them.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    stopHousekeeping();
    await app.close();
    process.exit(0);
  });
}

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
