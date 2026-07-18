import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

// Applies migrations/*.sql in filename order, recording each in
// schema_migrations so re-runs are no-ops. Run from apps/api.
const MIGRATIONS_DIR = 'migrations';

async function main() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    // Session-level lock: if several instances deploy at once, only one
    // runs migrations; the rest wait here, then see everything applied.
    await client.query('SELECT pg_advisory_lock(715001)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
          file,
        ]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log(
      ran > 0 ? `applied ${ran} migration(s)` : 'already up to date',
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
