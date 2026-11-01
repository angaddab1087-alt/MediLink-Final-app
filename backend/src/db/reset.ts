import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { config } from '../config';
import { migrate } from './migrate';
import { seed } from './seed';

/**
 * Back to a clean demo: removes EVERYTHING (every account, visit, record, audit entry and uploaded file,
 * including anything created while testing) and loads the demo hospitals, doctors, staff and patients again.
 *
 *   npm run db:reset-demo -- --yes
 *   docker compose exec api npm run db:reset-demo -- --yes
 */
async function main() {
  if (!process.argv.includes('--yes') && process.env.CONFIRM_RESET !== 'yes') {
    console.error('This deletes ALL data and reloads the demo data. Run again with  --yes  to continue.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await migrate(pool);
    const t = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    const names = t.rows.map((r) => '"' + r.tablename + '"').filter((n) => !/migrat/i.test(n));
    if (names.length) await pool.query(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`);
    console.log(`Cleared ${names.length} tables.`);
    const dir = path.resolve(config.uploadDir);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      console.log('Cleared uploaded files.');
    }
    await seed(pool);
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
