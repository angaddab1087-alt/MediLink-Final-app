import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  async q<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query<T>(sql, params as any[]);
    return r.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.q<T>(sql, params))[0];
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
