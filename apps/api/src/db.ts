import pg from 'pg';
import { config } from './config.js';

// Postgres returns bigint (int8) as a string because it can exceed
// Number.MAX_SAFE_INTEGER. Our money amounts can't, so parse to number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export const db = new pg.Pool({ connectionString: config.databaseUrl });
