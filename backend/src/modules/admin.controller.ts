import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { EMAIL_RE, int, oneOf, str } from '../common/dto';
import { dutyQr, hospitalQr } from '../common/qr';

/** Hospital Admin: reads and configures. There is deliberately no endpoint here that edits or deletes clinical records. */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private db: Db, private audit: AuditService) {}

  @Get('overview')
  async overview(@CurrentUser() u: AuthUser) {
    const h = u.hospitalId;
    const one = async (sql: string) => (await this.db.one(sql, [h]))!.n;
    const byStatus = await this.db.q(`SELECT status, count(*)::int AS n FROM visits WHERE hospital_id=$1 AND visit_date=CURRENT_DATE GROUP BY status`, [h]);
    return {
      hospital: await this.db.one('SELECT id, name, address FROM hospitals WHERE id=$1', [h]),
      registrationsToday: await one(`SELECT count(*)::int AS n FROM visits WHERE hospital_id=$1 AND visit_date=CURRENT_DATE`),
      waiting: await one(`SELECT count(*)::int AS n FROM visits WHERE hospital_id=$1 AND visit_date=CURRENT_DATE AND status IN ('Requested','Approved','Arrived','Called')`),
      averageWaitMinutes: await one(`SELECT coalesce(round(avg(extract(epoch FROM (coalesce(completed_at, now()) - created_at))/60))::int, 0) AS n FROM visits WHERE hospital_id=$1 AND visit_date=CURRENT_DATE`),
      testsPending: await one(`SELECT count(*)::int AS n FROM test_orders WHERE hospital_id=$1 AND status NOT IN ('Sent','Cancelled')`),
      reportsSent: await one(`SELECT count(*)::int AS n FROM documents WHERE hospital_id=$1 AND kind='report'`),
      doctorsOnDuty: await one(`SELECT count(*)::int AS n FROM shifts WHERE hospital_id=$1 AND clock_out IS NULL`),
      pendingIncidents: await one(`SELECT count(*)::int AS n FROM incident_reports WHERE hospital_id=$1 AND status='Pending'`),
      activeAlerts: await one(`SELECT count(*)::int AS n FROM conduct_alerts WHERE hospital_id=$1 AND status='Active'`),
      byStatus,
      emergencyAlerts: await this.db.q(`SELECT * FROM emergency_alerts WHERE hospital_id=$1 ORDER BY id DESC LIMIT 5`, [h]),
    };
  }

  @Get('people')
  people(@CurrentUser() u: AuthUser) {
    return this.db.q(
      `SELECT x.id, x.name, x.email, x.role, x.active, x.created_at,
              (SELECT array_agg(desk ORDER BY desk) FROM staff_desks WHERE user_id=x.id) AS desks,
              (SELECT d.name FROM doctor_profiles dp JOIN departments d ON d.id=dp.department_id WHERE dp.user_id=x.id) AS department,
              (SELECT max(at) FROM audit_log a WHERE a.user_id=x.id AND a.action='LOGIN') AS last_login
       FROM users x WHERE x.hospital_id=$1 AND x.role IN ('doctor','staff','admin') ORDER BY x.role, x.name`, [u.hospitalId]);
  }

  @Post('people')
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const role = oneOf(b.role, 'Role', ['doctor', 'staff', 'admin'] as const);
    const email = str(b.email, 'Email').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('Please enter a valid email.');
    if (await this.db.one('SELECT 1 FROM users WHERE email=$1', [email])) throw new BadRequestException('This email is already in use.');
    const name = str(b.name, 'Name', { min: 2 });
    const password = str(b.password, 'Temporary password', { min: 8 });
    const id = await this.db.tx(async (c) => {
      const r = await c.query(`INSERT INTO users (email, password_hash, pin_hash, role, name, hospital_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [email, await bcrypt.hash(password, 10), role === 'doctor' ? await bcrypt.hash('1234', 10) : null, role, name, u.hospitalId]);
      const nid = r.rows[0].id;
      if (role === 'staff') {
        const desks: string[] = Array.isArray(b.desks) ? b.desks : [];
        if (!desks.length) throw new BadRequestException('Assign at least one desk.');
        for (const d of desks) await c.query('INSERT INTO staff_desks (user_id, desk) VALUES ($1,$2)', [nid, d]);
      }
      if (role === 'doctor') {
        const dep = await c.query(`SELECT id, name FROM departments WHERE id=$1 AND hospital_id=$2 AND kind='clinical'`, [int(b.departmentId, 'Department'), u.hospitalId]);
        if (!dep.rows.length) throw new BadRequestException('Choose a clinical department.');
        await c.query(`INSERT INTO doctor_profiles (user_id, hospital_id, department_id, registration_no, gender, is_gp) VALUES ($1,$2,$3,$4,$5,$6)`,
          [nid, u.hospitalId, dep.rows[0].id, str(b.registrationNo, 'Registration number'), oneOf(b.gender, 'Gender', ['Male', 'Female', 'Other'] as const), dep.rows[0].name === 'General Physician']);
      }
      return nid;
    });
    await this.audit.log(u, { action: 'ACCOUNT_CREATED', detail: `${role} ${email}` });
    return { ok: true, id };
  }

  /** Accounts are deactivated, never deleted. */
  @Post('people/:id/active')
  async setActive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const uid = int(id, 'Account');
    if (uid === u.id) throw new BadRequestException('You cannot deactivate your own account.');
    const r = await this.db.q(`UPDATE users SET active=$3 WHERE id=$1 AND hospital_id=$2 AND role <> 'owner' RETURNING id`, [uid, u.hospitalId, !!b.active]);
    if (!r.length) throw new NotFoundException('Account not found.');
    await this.audit.log(u, { action: b.active ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_DEACTIVATED', detail: `user ${uid}` });
    return { ok: true };
  }

  @Post('people/:id/desks')
  async desks(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const uid = int(id, 'Account');
    const ok = await this.db.one(`SELECT 1 FROM users WHERE id=$1 AND hospital_id=$2 AND role='staff'`, [uid, u.hospitalId]);
    if (!ok) throw new NotFoundException('Staff account not found.');
    const desks: string[] = Array.isArray(b.desks) ? b.desks : [];
    if (!desks.length) throw new BadRequestException('Assign at least one desk.');
    await this.db.tx(async (c) => {
      await c.query('DELETE FROM staff_desks WHERE user_id=$1', [uid]);
      for (const d of desks) await c.query('INSERT INTO staff_desks (user_id, desk) VALUES ($1,$2)', [uid, d]);
    });
    await this.audit.log(u, { action: 'DESKS_ASSIGNED', detail: `user ${uid}: ${desks.join(', ')}` });
    return { ok: true };
  }

  @Get('doctors')
  doctors(@CurrentUser() u: AuthUser) {
    return this.db.q(
      `SELECT x.id, x.name, x.email, d.name AS department, dp.on_leave, dp.bookings_open, dp.gender,
              (SELECT clock_in FROM shifts s WHERE s.doctor_id=x.id ORDER BY id DESC LIMIT 1) AS last_clock_in,
              (SELECT clock_out FROM shifts s WHERE s.doctor_id=x.id ORDER BY id DESC LIMIT 1) AS last_clock_out,
              EXISTS (SELECT 1 FROM shifts s WHERE s.doctor_id=x.id AND s.clock_out IS NULL) AS on_duty,
              (SELECT count(*)::int FROM visits v WHERE v.doctor_id=x.id AND v.visit_date=CURRENT_DATE) AS patients_today
       FROM users x JOIN doctor_profiles dp ON dp.user_id=x.id JOIN departments d ON d.id=dp.department_id
       WHERE dp.hospital_id=$1 ORDER BY x.name`, [u.hospitalId]);
  }

  @Post('doctors/:id/leave')
  async leave(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.db.q('UPDATE doctor_profiles SET on_leave=$3 WHERE user_id=$1 AND hospital_id=$2 RETURNING user_id', [int(id, 'Doctor'), u.hospitalId, !!b.onLeave]);
    if (!r.length) throw new NotFoundException('Doctor not found.');
    await this.audit.log(u, { action: b.onLeave ? 'DOCTOR_ON_LEAVE' : 'DOCTOR_BACK', detail: `doctor ${id}` });
    return { ok: true };
  }

  @Get('audit')
  auditList(@CurrentUser() u: AuthUser, @Query('action') action?: string, @Query('role') role?: string, @Query('patientId') patientId?: string) {
    return this.db.q(
      `SELECT a.id, a.at, a.role, a.desk, a.action, a.detail, a.patient_id, x.name AS user_name, x.email AS user_email FROM audit_log a LEFT JOIN users x ON x.id=a.user_id
       WHERE a.hospital_id=$1 AND ($2::text IS NULL OR a.action ILIKE '%'||$2||'%') AND ($3::text IS NULL OR a.role=$3) AND ($4::int IS NULL OR a.patient_id=$4)
       ORDER BY a.id DESC LIMIT 300`, [u.hospitalId, action || null, role || null, patientId && /^\d+$/.test(patientId) ? Number(patientId) : null]);
  }

  @Get('audit/verify')
  verify() { return this.audit.verify(); }

  @Get('audit/export.csv')
  async exportCsv(@CurrentUser() u: AuthUser, @Res() res: Response) {
    const rows = await this.auditList(u);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['id,at,user,role,desk,action,detail,patient_id', ...rows.map((r) => [r.id, new Date(r.at).toISOString(), r.user_email, r.role, r.desk, r.action, r.detail, r.patient_id].map(esc).join(','))].join('\n');
    await this.audit.log(u, { action: 'AUDIT_EXPORTED' });
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="medilink-audit.csv"'); res.send(csv);
  }

  @Get('patients')
  patients(@CurrentUser() u: AuthUser, @Query('q') q?: string) {
    return this.db.q(
      `SELECT DISTINCT p.user_id AS id, p.full_name, p.medilink_id, p.sex, (SELECT count(*)::int FROM visits v WHERE v.patient_id=p.user_id AND v.hospital_id=$1) AS visits
       FROM patient_profiles p JOIN visits v ON v.patient_id=p.user_id AND v.hospital_id=$1
       WHERE $2::text IS NULL OR p.full_name ILIKE '%'||$2||'%' OR p.medilink_id ILIKE $2 ORDER BY p.full_name LIMIT 50`, [u.hospitalId, q || null]);
  }

  /** Opening clinical content needs a recorded reason, is view-only, and shows in the patient's access history. */
  @Post('patients/:id/record')
  async record(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const pid = int(id, 'Patient');
    const reason = oneOf(b.reason, 'Reason', ['Patient complaint review', 'Quality audit', 'Legal or court request', 'Billing dispute', 'Data request from patient', 'Billing or insurance query', 'Legal or audit request', 'Patient asked for help'] as const);
    const visits = await this.db.q(`SELECT v.id, v.visit_date, v.token_no, v.status, v.symptoms, d.name AS doctor_name FROM visits v LEFT JOIN users d ON d.id=v.doctor_id WHERE v.patient_id=$1 AND v.hospital_id=$2 ORDER BY v.id DESC`, [pid, u.hospitalId]);
    if (!visits.length) throw new ForbiddenException('This patient has no visits at your hospital.');
    const prescriptions = await this.db.q(`SELECT p.text, p.created_at, d.name AS doctor_name FROM prescriptions p JOIN visits v ON v.id=p.visit_id JOIN users d ON d.id=p.doctor_id WHERE p.patient_id=$1 AND v.hospital_id=$2 ORDER BY p.id DESC`, [pid, u.hospitalId]);
    const tests = await this.db.q(`SELECT test_name, department, status, updated_at FROM test_orders WHERE patient_id=$1 AND hospital_id=$2 ORDER BY id DESC`, [pid, u.hospitalId]);
    await this.audit.log(u, { action: 'ADMIN_RECORD_VIEWED', patientId: pid, detail: reason });
    return { watermark: `Viewed by ${u.name} for: ${reason}. View only.`, visits, prescriptions, tests };
  }

  @Get('incidents')
  incidents(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT i.*, p.full_name, r.name AS reported_by_name FROM incident_reports i JOIN patient_profiles p ON p.user_id=i.patient_id
      JOIN users r ON r.id=i.reported_by WHERE i.hospital_id=$1 ORDER BY i.id DESC`, [u.hospitalId]);
  }

  @Post('incidents/:id/dismiss')
  async dismiss(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.db.q(`UPDATE incident_reports SET status='Dismissed', decision_reason=$3 WHERE id=$1 AND hospital_id=$2 AND status='Pending' RETURNING patient_id`,
      [int(id, 'Incident'), u.hospitalId, str(b.reason, 'Reason', { min: 3 })]);
    if (!r.length) throw new BadRequestException('Incident not found or already decided.');
    await this.audit.log(u, { action: 'INCIDENT_DISMISSED', patientId: r[0].patient_id });
    return { ok: true };
  }

  @Get('alerts')
  async alerts(@CurrentUser() u: AuthUser) {
    await this.db.q(`UPDATE conduct_alerts SET status='Expired' WHERE status='Active' AND review_date < CURRENT_DATE`);
    return this.db.q(`SELECT c.*, p.full_name, s.name AS set_by_name, a.name AS approved_by_name FROM conduct_alerts c JOIN patient_profiles p ON p.user_id=c.patient_id
      JOIN users s ON s.id=c.set_by LEFT JOIN users a ON a.id=c.approved_by WHERE c.hospital_id=$1 ORDER BY c.id DESC`, [u.hospitalId]);
  }

  /** Places a conduct alert from incident reports. If the hospital has more than one admin, a second admin must approve. */
  @Post('alerts')
  async placeAlert(@CurrentUser() u: AuthUser, @Body() b: any) {
    const incidentIds: number[] = (Array.isArray(b.incidentIds) ? b.incidentIds : []).map(Number);
    if (!incidentIds.length) throw new BadRequestException('An alert must be based on at least one incident report.');
    const inc = await this.db.q(`SELECT * FROM incident_reports WHERE id = ANY($1) AND hospital_id=$2 AND status='Pending'`, [incidentIds, u.hospitalId]);
    if (inc.length !== incidentIds.length) throw new BadRequestException('Some incident reports are missing or already decided.');
    const patientId = inc[0].patient_id;
    if (inc.some((i) => i.patient_id !== patientId)) throw new BadRequestException('All incident reports must be about the same patient.');
    const reviewDays = Math.min(Math.max(Number(b.reviewDays) || 90, 7), 365);
    const admins = await this.db.one(`SELECT count(*)::int AS n FROM users WHERE hospital_id=$1 AND role='admin' AND active`, [u.hospitalId]);
    const status = admins.n > 1 ? 'PendingApproval' : 'Active';
    const a = await this.db.one(`INSERT INTO conduct_alerts (patient_id, hospital_id, category, summary, review_date, set_by, status, approved_by)
      VALUES ($1,$2,$3,$4, CURRENT_DATE + $5::int, $6, $7, $8) RETURNING *`,
      [patientId, u.hospitalId, inc[0].category, str(b.summary, 'Summary', { min: 10, max: 500 }), reviewDays, u.id, status, status === 'Active' ? u.id : null]);
    await this.db.q(`UPDATE incident_reports SET status='UsedInAlert' WHERE id = ANY($1)`, [incidentIds]);
    await this.audit.log(u, { action: 'CONDUCT_ALERT_PLACED', patientId, detail: status });
    return a;
  }

  @Post('alerts/:id/approve')
  async approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const a = await this.db.one(`SELECT * FROM conduct_alerts WHERE id=$1 AND hospital_id=$2 AND status='PendingApproval'`, [int(id, 'Alert'), u.hospitalId]);
    if (!a) throw new NotFoundException('No alert waiting for approval.');
    if (a.set_by === u.id) throw new ForbiddenException('A second admin must approve this alert.');
    await this.db.q(`UPDATE conduct_alerts SET status='Active', approved_by=$2 WHERE id=$1`, [a.id, u.id]);
    await this.audit.log(u, { action: 'CONDUCT_ALERT_APPROVED', patientId: a.patient_id });
    return { ok: true };
  }

  @Post('alerts/:id/lift')
  async lift(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.q(`UPDATE conduct_alerts SET status='Lifted', lifted_by=$3 WHERE id=$1 AND hospital_id=$2 AND status IN ('Active','PendingApproval') RETURNING patient_id`, [int(id, 'Alert'), u.hospitalId, u.id]);
    if (!r.length) throw new NotFoundException('Alert not found.');
    await this.audit.log(u, { action: 'CONDUCT_ALERT_LIFTED', patientId: r[0].patient_id });
    return { ok: true };
  }

  @Get('tests')
  tests(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT department, status, count(*)::int AS n FROM test_orders WHERE hospital_id=$1 GROUP BY department, status ORDER BY department, status`, [u.hospitalId]);
  }

  /** The codes to print: the hospital registration QR and the doctors' duty QR. */
  @Get('qr')
  async qr(@CurrentUser() u: AuthUser) {
    const h = await this.db.one('SELECT id, name, qr_version FROM hospitals WHERE id=$1', [u.hospitalId]);
    return { hospital: h.name, version: h.qr_version, hospitalQr: hospitalQr(h.id, h.qr_version), dutyQr: dutyQr(h.id, h.qr_version) };
  }

  @Post('qr/rotate')
  async rotate(@CurrentUser() u: AuthUser) {
    await this.db.q('UPDATE hospitals SET qr_version=qr_version+1 WHERE id=$1', [u.hospitalId]);
    await this.audit.log(u, { action: 'QR_ROTATED' });
    return this.qr(u);
  }

  @Get('notifications')
  notifications(@CurrentUser() u: AuthUser) { return this.db.q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [u.id]); }

  /** Break-glass requests from MediLink support: this hospital's admin approves or rejects; approval expires. */
  @Get('support-requests')
  async supportRequests(@CurrentUser() u: AuthUser) {
    await this.db.q(`UPDATE support_access_grants SET status='Expired' WHERE status='Approved' AND expires_at < now()`);
    return this.db.q(`SELECT g.*, r.email AS requested_by_email FROM support_access_grants g JOIN users r ON r.id=g.requested_by WHERE g.hospital_id=$1 ORDER BY g.id DESC`, [u.hospitalId]);
  }

  @Post('support-requests/:id/:decision')
  async decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('decision') decision: string) {
    const d = oneOf(decision, 'Decision', ['approve', 'reject'] as const);
    const r = await this.db.one(`UPDATE support_access_grants SET status=$3, approved_by=$4, expires_at=CASE WHEN $3='Approved' THEN now() + make_interval(hours => hours) END
      WHERE id=$1 AND hospital_id=$2 AND status='Pending' RETURNING *`, [int(id, 'Request'), u.hospitalId, d === 'approve' ? 'Approved' : 'Rejected', u.id]);
    if (!r) throw new NotFoundException('Request not found or already decided.');
    await this.audit.log(u, { action: d === 'approve' ? 'SUPPORT_ACCESS_APPROVED' : 'SUPPORT_ACCESS_REJECTED', detail: r.reason });
    return r;
  }

  @Get('data-requests')
  dataRequests(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT r.*, p.full_name FROM data_requests r JOIN patient_profiles p ON p.user_id=r.patient_id
      WHERE EXISTS (SELECT 1 FROM visits v WHERE v.patient_id=r.patient_id AND v.hospital_id=$1) ORDER BY r.id DESC`, [u.hospitalId]);
  }
}
