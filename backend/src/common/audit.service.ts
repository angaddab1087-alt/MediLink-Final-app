import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Db } from '../db/db.service';
import { AuthUser } from './auth';

export interface AuditEntry {
  action: string;
  detail?: string;
  patientId?: number | null;
  hospitalId?: number | null;
}

/** Append-only audit log. Every row stores the SHA-256 hash of the previous row, so any edit breaks the chain. */
@Injectable()
export class AuditService {
  constructor(private db: Db) {}

  async log(user: Partial<AuthUser> | null, e: AuditEntry) {
    await this.db.tx(async (c) => {
      await c.query('LOCK TABLE audit_log IN SHARE ROW EXCLUSIVE MODE');
      const last = await c.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
      const prev = last.rows[0]?.hash ?? 'GENESIS';
      const at = new Date().toISOString();
      const payload = JSON.stringify({ at, u: user?.id ?? null, r: user?.role ?? null, d: user?.desk ?? null, h: e.hospitalId ?? user?.hospitalId ?? null, p: e.patientId ?? null, a: e.action, x: e.detail ?? '' });
      const hash = createHash('sha256').update(prev + payload).digest('hex');
      await c.query(
        `INSERT INTO audit_log (at, user_id, role, desk, hospital_id, patient_id, action, detail, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [at, user?.id ?? null, user?.role ?? null, user?.desk ?? null, e.hospitalId ?? user?.hospitalId ?? null, e.patientId ?? null, e.action, e.detail ?? '', prev, hash],
      );
    });
  }

  async verify(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    const rows = await this.db.q('SELECT * FROM audit_log ORDER BY id');
    let prev = 'GENESIS';
    for (const r of rows) {
      const at = new Date(r.at).toISOString();
      const payload = JSON.stringify({ at, u: r.user_id, r: r.role, d: r.desk, h: r.hospital_id, p: r.patient_id, a: r.action, x: r.detail ?? '' });
      const hash = createHash('sha256').update(prev + payload).digest('hex');
      if (r.prev_hash !== prev || r.hash !== hash) return { ok: false, checked: rows.length, brokenAt: r.id };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  }
}
