import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../config';

export async function migrate(pool: Pool) {
  const candidates = [join(__dirname, 'schema.sql'), join(__dirname, '../../src/db/schema.sql')];
  const file = candidates.find((f) => { try { readFileSync(f); return true; } catch { return false; } });
  if (!file) throw new Error('schema.sql not found');
  await pool.query(readFileSync(file, 'utf8'));
}

if (require.main === module) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  migrate(pool)
    .then(() => { console.log('Database schema is up to date.'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
