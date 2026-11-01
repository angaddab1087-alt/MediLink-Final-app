import { ALL_CLINICAL } from '../db/specialists';
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { statSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { EMAIL_RE, int, oneOf, str } from '../common/dto';
import { dutyQr, hospitalQr } from '../common/qr';
import { config } from '../config';

const DEFAULT_SETTINGS = {
  patientQuotaMb: 1024, maxFileMb: 50, retentionYears: 10, auditLogRetentionDays: 180,
  features: { emergencyFinder: true, voiceInput: true, referrals: true, insuranceCards: true, smsFallback: false },
  plans: ['Standard', 'Government (free)', 'Network'],
};
const SLUG_RE = /^[a-z0-9-]{3,30}$/;

/**
 * Owner Console API (MediLink company team). Works on metadata only: there is no endpoint here
 * that returns patient names, records, prescriptions or reports.
 */
@Controller('platform')
@Roles('owner')
export class PlatformController {
  constructor(private db: Db, private audit: AuditService) {}

  private n = async (sql: string, p: unknown[] = []) => (await this.db.one(sql, p))!.n as number;

  @Get('overview')
  async overview() {
    const health = await this.health();
    return {
      hospitals: await this.n(`SELECT count(*)::int AS n FROM hospitals WHERE on_medilink`),
      suspended: await this.n(`SELECT count(*)::int AS n FROM hospitals WHERE on_medilink AND status='suspended'`),
      patients: await this.n(`SELECT count(*)::int AS n FROM users WHERE role='patient'`),
      registrationsToday: await this.n(`SELECT count(*)::int AS n FROM visits WHERE visit_date=CURRENT_DATE`),
      documentsSent: await this.n(`SELECT count(*)::int AS n FROM document_versions`),
      emergencySearches: await this.n(`SELECT count(*)::int AS n FROM emergency_searches`),
      emergencySearchesToday: await this.n(`SELECT count(*)::int AS n FROM emergency_searches WHERE at::date=CURRENT_DATE`),
      openIncidents: await this.n(`SELECT count(*)::int AS n FROM incidents WHERE status <> 'Closed'`),
      pendingSupport: await this.n(`SELECT count(*)::int AS n FROM support_access_grants WHERE status='Pending'`),
      systemStatus: health.services.every((s) => s.status === 'up') ? 'All systems normal' : 'Attention needed',
    };
  }

  @Get('hospitals')
  hospitals() {
    return this.db.q(`
      SELECT h.id, h.slug, h.name, h.area, h.type, h.status, h.connector_mode, h.plan, h.created_at,
        (SELECT count(*)::int FROM visits v WHERE v.hospital_id=h.id AND v.visit_date > CURRENT_DATE - 30) AS registrations_30d,
        (SELECT count(*)::int FROM documents d WHERE d.hospital_id=h.id) AS documents,
        (SELECT count(*)::int FROM users u WHERE u.hospital_id=h.id AND u.role IN ('doctor','staff','admin') AND u.active) AS active_staff,
        (SELECT max(at) FROM audit_log a WHERE a.hospital_id=h.id) AS last_activity
      FROM hospitals h WHERE h.on_medilink ORDER BY h.id`);
  }

  /** Add-hospital wizard: creates the tenant, default departments, the admin account and both QR codes. */
  @Post('hospitals')
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Hospital name', { min: 3, max: 120 });
    const slug = str(b.slug, 'Short name (slug)').toLowerCase();
    if (!SLUG_RE.test(slug)) throw new BadRequestException('Short name must be 3-30 lower-case letters, numbers or dashes.');
    if (await this.db.one('SELECT 1 FROM hospitals WHERE slug=$1', [slug])) throw new BadRequestException('This short name is already used.');
    const type = oneOf(b.type, 'Type', ['Government', 'Private', 'Trust'] as const);
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!(lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98)) throw new BadRequestException('Location must be inside India (latitude 6-37, longitude 68-98).');
    const connector = oneOf(b.connectorMode || 'MediLink Lite', 'Connector', ['MediLink Lite', 'FHIR/REST', 'HL7 v2', 'File-drop agent'] as const);
    const adminEmail = str(b.adminEmail, 'Admin email').toLowerCase();
    if (!EMAIL_RE.test(adminEmail)) throw new BadRequestException('Please enter a valid admin email.');
    if (await this.db.one('SELECT 1 FROM users WHERE email=$1', [adminEmail])) throw new BadRequestException('This admin email is already in use.');
    const tempPassword = 'ML-' + randomBytes(5).toString('hex');
    const id = await this.db.tx(async (c) => {
      const h = await c.query(`INSERT INTO hospitals (slug, name, address, area, type, phone, lat, lng, connector_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [slug, name, str(b.address, 'Address', { optional: true }) || str(b.area, 'Area'), str(b.area, 'Area'), type, str(b.phone, 'Phone', { optional: true }) || 'Not set', lat, lng, connector]);
      const hid = h.rows[0].id;
      for (const d of ALL_CLINICAL) await c.query(`INSERT INTO departments (hospital_id, name, kind) VALUES ($1,$2,'clinical')`, [hid, d]);
      for (const d of ['Pathology/Blood Tests', 'Radiology', 'Cardiology Diagnostics']) await c.query(`INSERT INTO departments (hospital_id, name, kind) VALUES ($1,$2,'diagnostic')`, [hid, d]);
      await c.query(`INSERT INTO users (email, password_hash, role, name, hospital_id) VALUES ($1,$2,'admin',$3,$4)`, [adminEmail, await bcrypt.hash(tempPassword, 10), str(b.adminName, 'Admin name', { optional: true }) || 'Hospital Admin', hid]);
      return hid;
    });
    await this.audit.log(u, { action: 'PLATFORM_HOSPITAL_CREATED', hospitalId: id, detail: `${name} (${slug}), ${connector}` });
    return { id, slug, hospitalQr: hospitalQr(id, 1), dutyQr: dutyQr(id, 1), admin: { email: adminEmail, temporaryPassword: tempPassword, note: 'Share this once. The admin should change it at first login.' } };
  }

  @Get('hospitals/:id')
  async detail(@Param('id') id: string) {
    const hid = int(id, 'Hospital');
    const h = await this.db.one(`SELECT id, slug, name, address, area, type, status, connector_mode, plan, created_at, qr_version FROM hospitals WHERE id=$1 AND on_medilink`, [hid]);
    if (!h) throw new NotFoundException('Hospital not found.');
    const usage = await this.db.q(`SELECT d::date AS day, (SELECT count(*)::int FROM visits v WHERE v.hospital_id=$1 AND v.visit_date=d::date) AS registrations
      FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d ORDER BY d`, [hid]);
    const storage = await this.db.one(`SELECT coalesce(sum(dv.size_bytes),0)::bigint AS bytes FROM document_versions dv JOIN documents d ON d.id=dv.document_id WHERE d.hospital_id=$1`, [hid]);
    const admins = await this.db.q(`SELECT id, name, email, active FROM users WHERE hospital_id=$1 AND role='admin' ORDER BY id`, [hid]);
    const counts = await this.db.one(`SELECT
      (SELECT count(*)::int FROM users WHERE hospital_id=$1 AND role='doctor' AND active) AS doctors,
      (SELECT count(*)::int FROM users WHERE hospital_id=$1 AND role='staff' AND active) AS staff,
      (SELECT count(*)::int FROM visits WHERE hospital_id=$1) AS registrations,
      (SELECT count(*)::int FROM test_orders WHERE hospital_id=$1) AS tests,
      (SELECT count(*)::int FROM documents WHERE hospital_id=$1) AS documents`, [hid]);
    const support = await this.db.q(`SELECT g.id, g.reason, g.hours, g.status, g.expires_at, g.created_at, a.name AS approved_by_name FROM support_access_grants g
      LEFT JOIN users a ON a.id=g.approved_by WHERE g.hospital_id=$1 ORDER BY g.id DESC LIMIT 10`, [hid]);
    const connector = h.connector_mode === 'MediLink Lite'
      ? { mode: h.connector_mode, note: 'Uses MediLink screens directly. No integration to monitor.', lastSuccess: null, errorRate: 0, retryQueue: 0 }
      : { mode: h.connector_mode, note: 'Demo: connector delivery is simulated.', lastSuccess: new Date().toISOString(), errorRate: 0, retryQueue: 0 };
    return { ...h, usage, storageBytes: Number(storage.bytes), admins, counts, support, connector };
  }

  @Post('hospitals/:id/status')
  async setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const status = oneOf(b.status, 'Status', ['active', 'suspended'] as const);
    const r = await this.db.q(`UPDATE hospitals SET status=$2 WHERE id=$1 AND on_medilink RETURNING name`, [int(id, 'Hospital'), status]);
    if (!r.length) throw new NotFoundException('Hospital not found.');
    await this.audit.log(u, { action: status === 'suspended' ? 'PLATFORM_HOSPITAL_SUSPENDED' : 'PLATFORM_HOSPITAL_REACTIVATED', hospitalId: Number(id), detail: str(b.reason, 'Reason', { optional: true }) });
    return { ok: true, message: status === 'suspended' ? `${r[0].name} is suspended. New activity is blocked; all data is kept.` : `${r[0].name} is active again.` };
  }

  /** Break-glass: the owner can only ASK. The hospital admin decides, and access expires. */
  @Post('hospitals/:id/support-access')
  async support(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const hid = int(id, 'Hospital');
    const hours = Math.min(Math.max(Number(b.hours) || 4, 1), 72);
    const g = await this.db.one(`INSERT INTO support_access_grants (hospital_id, requested_by, reason, hours) VALUES ($1,$2,$3,$4) RETURNING *`,
      [hid, u.id, str(b.reason, 'Reason', { min: 10, max: 500 }), hours]);
    const admins = await this.db.q(`SELECT id FROM users WHERE hospital_id=$1 AND role='admin' AND active`, [hid]);
    for (const a of admins) await this.db.q(`INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)`, [a.id, 'MediLink support access request', `Reason: ${g.reason}. Approve or reject in Admin → Requests.`]);
    await this.audit.log(u, { action: 'PLATFORM_SUPPORT_ACCESS_REQUESTED', hospitalId: hid, detail: g.reason });
    return g;
  }

  @Get('health')
  async health() {
    const t0 = Date.now();
    let db = 'up'; try { await this.db.q('SELECT 1'); } catch { db = 'down'; }
    const dbMs = Date.now() - t0;
    let storage = 'up';
    try { const dir = resolve(config.uploadDir); mkdirSync(dir, { recursive: true }); const f = join(dir, '.health'); writeFileSync(f, 'ok'); statSync(f); unlinkSync(f); } catch { storage = 'down'; }
    const mem = process.memoryUsage();
    const errors24h = await this.n(`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE '%DENIED%' AND at > now() - interval '24 hours'`).catch(() => 0);
    return {
      services: [
        { name: 'API', status: 'up', detail: `Uptime ${Math.round(process.uptime() / 60)} min · memory ${Math.round(mem.rss / 1048576)} MB` },
        { name: 'Database (PostgreSQL)', status: db, detail: `${dbMs} ms query time` },
        { name: 'File storage', status: storage, detail: config.uploadDir },
        { name: 'Maps (OpenStreetMap / Google)', status: 'up', detail: 'Called from the app; hospital list served by MediLink' },
        { name: 'ABDM, DigiLocker, SMS, NHCX', status: 'up', detail: 'Mock adapters (demo mode)' },
      ],
      queueDepth: await this.n(`SELECT count(*)::int AS n FROM visits WHERE visit_date=CURRENT_DATE AND status IN ('Requested','Approved','Arrived')`),
      deniedAccess24h: errors24h,
      checkedAt: new Date().toISOString(),
    };
  }

  @Get('settings')
  async settings() {
    const rows = await this.db.q(`SELECT key, value FROM platform_settings`);
    const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  @Put('settings')
  async saveSettings(@CurrentUser() u: AuthUser, @Body() b: any) {
    const next: Record<string, unknown> = {};
    const num = (k: string, min: number, max: number) => { if (b[k] !== undefined) { const v = Number(b[k]); if (!(v >= min && v <= max)) throw new BadRequestException(`${k} must be between ${min} and ${max}.`); next[k] = v; } };
    num('patientQuotaMb', 100, 102400); num('maxFileMb', 1, 500); num('retentionYears', 3, 30); num('auditLogRetentionDays', 180, 3650);
    if (b.features && typeof b.features === 'object') next.features = Object.fromEntries(Object.entries(b.features).filter(([k]) => k in DEFAULT_SETTINGS.features).map(([k, v]) => [k, !!v]));
    for (const [k, v] of Object.entries(next)) await this.db.q(`INSERT INTO platform_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [k, JSON.stringify(v)]);
    await this.audit.log(u, { action: 'PLATFORM_SETTINGS_CHANGED', detail: Object.keys(next).join(', ') });
    return this.settings();
  }

  /** Incident register with the CERT-In 6-hour and DPDP Board 72-hour reporting clocks. */
  @Get('compliance')
  async compliance() {
    const incidents = (await this.db.q(`SELECT * FROM incidents ORDER BY id DESC LIMIT 50`)).map((i) => ({
      ...i,
      certinDeadline: new Date(new Date(i.detected_at).getTime() + 6 * 3600e3).toISOString(),
      dpbDeadline: i.personal_data ? new Date(new Date(i.detected_at).getTime() + 72 * 3600e3).toISOString() : null,
    }));
    const requests = await this.db.q(`SELECT kind, status, count(*)::int AS n FROM data_requests GROUP BY kind, status`);
    const consents = await this.db.one(`SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active, count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM consents`);
    return {
      incidents, requests, consents,
      keys: [
        { name: 'JWT_SECRET', protects: 'Login sessions', rotation: 'Every 90 days or after an incident' },
        { name: 'QR_SECRET', protects: 'Hospital, duty and patient QR codes', rotation: 'Every 90 days; rotating hospital QR codes also changes their version' },
        { name: 'Database password', protects: 'PostgreSQL', rotation: 'Every 90 days' },
      ],
      auditChain: await this.audit.verify(),
    };
  }

  @Post('incidents')
  async incident(@CurrentUser() u: AuthUser, @Body() b: any) {
    const i = await this.db.one(`INSERT INTO incidents (title, kind, severity, personal_data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [str(b.title, 'Title', { min: 5, max: 200 }), oneOf(b.kind, 'Type', ['Security breach', 'Data leak', 'Outage', 'Malware', 'Other'] as const),
        oneOf(b.severity, 'Severity', ['Low', 'Medium', 'High', 'Critical'] as const), !!b.personalData, u.id]);
    await this.audit.log(u, { action: 'PLATFORM_INCIDENT_OPENED', detail: i.title });
    return i;
  }

  @Post('incidents/:id/update')
  async updateIncident(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const field = oneOf(b.action, 'Action', ['certin', 'dpb', 'contain', 'close'] as const);
    const sql = { certin: `certin_reported_at=now()`, dpb: `dpb_reported_at=now()`, contain: `status='Contained'`, close: `status='Closed'` }[field];
    const r = await this.db.q(`UPDATE incidents SET ${sql} WHERE id=$1 RETURNING id`, [int(id, 'Incident')]);
    if (!r.length) throw new NotFoundException('Incident not found.');
    await this.audit.log(u, { action: 'PLATFORM_INCIDENT_' + field.toUpperCase(), detail: `incident ${id}` });
    return { ok: true };
  }

  /** Platform audit: who did what, without patient identifiers. */
  @Get('audit')
  auditLog(@Query('action') action?: string, @Query('hospitalId') hospitalId?: string) {
    return this.db.q(`SELECT a.id, a.at, a.role, a.desk, a.action, a.hospital_id, h.name AS hospital_name, x.email AS user_email
      FROM audit_log a LEFT JOIN users x ON x.id=a.user_id LEFT JOIN hospitals h ON h.id=a.hospital_id
      WHERE ($1::text IS NULL OR a.action ILIKE '%'||$1||'%') AND ($2::int IS NULL OR a.hospital_id=$2) ORDER BY a.id DESC LIMIT 200`,
      [action || null, hospitalId && /^\d+$/.test(hospitalId) ? Number(hospitalId) : null]);
  }

  @Get('audit/verify')
  verify() { return this.audit.verify(); }

  @Get('announcements')
  announcements() { return this.db.q(`SELECT a.*, h.name AS hospital_name FROM announcements a LEFT JOIN hospitals h ON h.id=a.hospital_id ORDER BY a.id DESC LIMIT 30`); }

  @Post('announcements')
  async announce(@CurrentUser() u: AuthUser, @Body() b: any) {
    const title = str(b.title, 'Title', { min: 3, max: 120 }), body = str(b.body, 'Message', { min: 3, max: 500 });
    const hospitalId = b.hospitalId ? int(b.hospitalId, 'Hospital') : null;
    const a = await this.db.one(`INSERT INTO announcements (title, body, hospital_id, sent_by) VALUES ($1,$2,$3,$4) RETURNING *`, [title, body, hospitalId, u.id]);
    const recipients = await this.db.q(`SELECT id FROM users WHERE role IN ('admin','staff') AND active AND ($1::int IS NULL OR hospital_id=$1)`, [hospitalId]);
    for (const r of recipients) await this.db.q(`INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)`, [r.id, `MediLink: ${title}`, body]);
    await this.audit.log(u, { action: 'PLATFORM_ANNOUNCEMENT_SENT', hospitalId, detail: `${title} → ${recipients.length} people` });
    return { ...a, recipients: recipients.length };
  }
}
