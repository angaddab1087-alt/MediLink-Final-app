import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles, requireDesk } from '../common/auth';
import { int, oneOf, str } from '../common/dto';
import { notify } from '../common/notify';
import { storeFile } from '../common/files';
import { textPdf } from '../common/pdf';
import { VisitsService } from './visits.service';

const today = () => new Date().toISOString().slice(0, 10);
const dateOnly = (v: unknown, label: string) => {
  const s = str(v, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s).getTime())) throw new BadRequestException(`${label} must be a date (YYYY-MM-DD).`);
  return s;
};
const FU_COLS = `f.*, to_char(f.due_date,'YYYY-MM-DD') AS due, coalesce(m.name, p.full_name) AS patient_name, p.medilink_id, coalesce(m.sex, p.sex) AS sex,
  date_part('year', age(coalesce(m.dob, p.dob)))::int AS age, d.name AS doctor_name, d.email AS doctor_email, dep.name AS department,
  to_char(f.created_at, 'DD Mon') AS set_at`;
const FU_FROM = `FROM follow_ups f JOIN patient_profiles p ON p.user_id=f.patient_id LEFT JOIN family_members m ON m.id=f.member_id
  JOIN users d ON d.id=f.doctor_id LEFT JOIN doctor_profiles dp ON dp.user_id=d.id LEFT JOIN departments dep ON dep.id=dp.department_id`;

/* ---------------- Patient: family members, follow-ups ---------------- */
@Controller('me')
@Roles('patient', 'doctor')
export class PatientExtrasController {
  constructor(private db: Db, private audit: AuditService) {}

  @Get('family')
  family(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT id, name, relation, to_char(dob,'YYYY-MM-DD') AS dob, sex, date_part('year', age(dob))::int AS age FROM family_members WHERE patient_id=$1 ORDER BY id`, [u.id]);
  }

  @Post('family')
  async addFamily(@CurrentUser() u: AuthUser, @Body() b: any) {
    const n = await this.db.one('SELECT count(*)::int AS n FROM family_members WHERE patient_id=$1', [u.id]);
    if (n!.n >= 8) throw new BadRequestException('You can add up to 8 family members.');
    const dob = b.dob ? dateOnly(b.dob, 'Date of birth') : null;
    if (dob && dob > today()) throw new BadRequestException('Date of birth cannot be in the future.');
    const m = await this.db.one(`INSERT INTO family_members (patient_id, name, relation, dob, sex) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, relation, to_char(dob,'YYYY-MM-DD') AS dob, sex`,
      [u.id, str(b.name, 'Name', { min: 2, max: 100 }), oneOf(b.relation, 'Relation', ['Parent', 'Child', 'Spouse', 'Sibling', 'Grandparent', 'Other'] as const), dob, b.sex ? oneOf(b.sex, 'Sex', ['Male', 'Female', 'Other'] as const) : null]);
    await this.audit.log(u, { action: 'FAMILY_MEMBER_ADDED', patientId: u.id, detail: m!.relation });
    return m;
  }

  @Get('follow-ups')
  followUps(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT ${FU_COLS}, h.name AS hospital_name ${FU_FROM} JOIN hospitals h ON h.id=f.hospital_id WHERE f.patient_id=$1 ORDER BY f.due_date`, [u.id]);
  }
}

/* ---------------- Doctor: follow-up, treatment completion ---------------- */
@Controller('doctor')
@Roles('doctor')
export class DoctorExtrasController {
  constructor(private db: Db, private audit: AuditService) {}

  private async myVisit(u: AuthUser, id: string) {
    const v = await this.db.one('SELECT * FROM visits WHERE id=$1', [int(id, 'Visit')]);
    if (!v || v.doctor_id !== u.id) throw new NotFoundException('This patient is not in your queue.');
    return v;
  }

  @Post('visits/:id/follow-up')
  async followUp(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const v = await this.myVisit(u, id);
    const date = dateOnly(b.date, 'Follow-up date');
    if (date < today()) throw new BadRequestException('Pick a follow-up date from today onwards.');
    const f = await this.db.one(`INSERT INTO follow_ups (hospital_id, patient_id, member_id, visit_id, doctor_id, due_date, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [v.hospital_id, v.patient_id, v.member_id, v.id, u.id, date, str(b.reason, 'Reason', { optional: true, max: 300 }) || 'Follow-up review']);
    await this.audit.log(u, { action: 'FOLLOWUP_SET', patientId: v.patient_id, hospitalId: v.hospital_id, detail: date });
    await notify(this.db, v.patient_id, `Follow-up booked with ${u.name}`, `${date}. Show your MediLink ID at reception.`);
    return f;
  }

  @Post('visits/:id/close-treatment')
  async close(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const v = await this.myVisit(u, id);
    const note = str(b.note, 'Closing summary', { min: 10, max: 1000 });
    const c = await this.db.one(`INSERT INTO closures (hospital_id, visit_id, patient_id, doctor_id, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [v.hospital_id, v.id, v.patient_id, u.id, note]);
    await this.db.q(`UPDATE visits SET status='Completed', completed_at=now() WHERE id=$1 AND status <> 'Completed'`, [v.id]);
    await this.audit.log(u, { action: 'TREATMENT_COMPLETE_REQUESTED', patientId: v.patient_id, hospitalId: v.hospital_id });
    await notify(this.db, v.patient_id, `${u.name} marked your treatment complete`, 'Waiting for hospital approval. Your summary will reach your Drive.');
    return c;
  }

  @Get('closures')
  closures(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT c.*, p.full_name AS patient_name, v.token_no FROM closures c JOIN patient_profiles p ON p.user_id=c.patient_id JOIN visits v ON v.id=c.visit_id
      WHERE c.doctor_id=$1 AND NOT c.acknowledged ORDER BY c.id DESC`, [u.id]);
  }

  @Post('closures/:id/ack')
  async ack(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.db.q('UPDATE closures SET acknowledged=TRUE WHERE id=$1 AND doctor_id=$2', [int(id, 'Closure'), u.id]);
    return { ok: true };
  }
}

/* ---------------- Reception: follow-up desk, waiting-room display ---------------- */
@Controller('reception')
@Roles('staff')
export class ReceptionExtrasController {
  constructor(private db: Db, private audit: AuditService, private visits: VisitsService) {}

  @Get('follow-ups')
  list(@CurrentUser() u: AuthUser) {
    requireDesk(u, 'Reception');
    return this.db.q(`SELECT ${FU_COLS} ${FU_FROM} WHERE f.hospital_id=$1 AND (f.status='Scheduled' OR f.created_at > now() - interval '2 days' OR f.due_date >= CURRENT_DATE - 1) ORDER BY f.due_date`, [u.hospitalId]);
  }

  @Post('follow-ups/:id/:action')
  async act(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('action') action: string, @Body() b: any) {
    requireDesk(u, 'Reception');
    const a = oneOf(action, 'Action', ['checkin', 'call', 'missed', 'reschedule'] as const);
    const f = await this.db.one('SELECT * FROM follow_ups WHERE id=$1 AND hospital_id=$2', [int(id, 'Follow-up'), u.hospitalId]);
    if (!f) throw new NotFoundException('Follow-up not found.');
    if (a !== 'call' && f.status !== 'Scheduled') throw new BadRequestException(`This follow-up is already ${f.status.toLowerCase()}.`);
    if (a === 'call') {
      await this.db.q('UPDATE follow_ups SET call_attempts=call_attempts+1 WHERE id=$1', [f.id]);
      await this.audit.log(u, { action: 'FOLLOWUP_CALL_ATTEMPT', patientId: f.patient_id });
      return { ok: true };
    }
    if (a === 'missed') {
      await this.db.q(`UPDATE follow_ups SET status='Missed' WHERE id=$1`, [f.id]);
      await this.audit.log(u, { action: 'FOLLOWUP_MISSED', patientId: f.patient_id });
      return { ok: true };
    }
    if (a === 'reschedule') {
      const date = dateOnly(b.date, 'New date');
      if (date < today()) throw new BadRequestException('Pick a date from today onwards.');
      await this.db.q('UPDATE follow_ups SET due_date=$2, rescheduled=rescheduled+1 WHERE id=$1', [f.id, date]);
      await this.audit.log(u, { action: 'FOLLOWUP_RESCHEDULED', patientId: f.patient_id, detail: date });
      await notify(this.db, f.patient_id, 'Follow-up moved', `Your follow-up is now on ${date}.`);
      return { ok: true };
    }
    // Check-in: a priority visit with the same doctor, straight into the doctor's queue.
    const dept = await this.db.one('SELECT department_id FROM doctor_profiles WHERE user_id=$1', [f.doctor_id]);
    const token = await this.visits.nextToken(u.hospitalId!, 'F');
    const v = await this.db.one(`INSERT INTO visits (patient_id, hospital_id, doctor_id, department_id, token_no, symptoms, assignment, priority, status, arrived_at, approved_at, member_id)
      VALUES ($1,$2,$3,$4,$5,$6,'chosen',TRUE,'Arrived',now(),now(),$7) RETURNING id, token_no`,
      [f.patient_id, f.hospital_id, f.doctor_id, dept?.department_id ?? null, token, 'Follow-up: ' + f.reason, f.member_id]);
    await this.db.q(`UPDATE follow_ups SET status='Checked in', checkin_visit_id=$2 WHERE id=$1`, [f.id, v!.id]);
    await this.audit.log(u, { action: 'FOLLOWUP_CHECKED_IN', patientId: f.patient_id, detail: token });
    await notify(this.db, f.patient_id, `Checked in · token ${token}`, 'Your follow-up visit is in the doctor\'s queue.');
    return { ok: true, token, visitId: v!.id };
  }

  /** Waiting-room screen: tokens being called now and the next ones. Names are not shown. */
  @Get('display')
  async display(@CurrentUser() u: AuthUser) {
    const rows = await this.db.q(`SELECT v.token_no, v.status, d.name AS doctor_name, dep.name AS department FROM visits v LEFT JOIN users d ON d.id=v.doctor_id LEFT JOIN departments dep ON dep.id=v.department_id
      WHERE v.hospital_id=$1 AND v.visit_date=CURRENT_DATE AND v.status IN ('Called','InConsultation','Arrived') ORDER BY (v.status='Called') DESC, (v.status='InConsultation') DESC, v.priority DESC, v.created_at LIMIT 12`, [u.hospitalId]);
    return { calling: rows.filter((r) => r.status !== 'Arrived'), next: rows.filter((r) => r.status === 'Arrived').slice(0, 6) };
  }
}

/* ---------------- Hospital admin: approvals, follow-ups, sessions, setup, requests ---------------- */
@Controller('admin')
@Roles('admin')
export class AdminExtrasController {
  constructor(private db: Db, private audit: AuditService) {}

  @Get('follow-ups')
  followUps(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT ${FU_COLS} ${FU_FROM} WHERE f.hospital_id=$1 ORDER BY f.due_date DESC LIMIT 300`, [u.hospitalId]);
  }

  @Get('closures')
  closures(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT c.*, p.full_name AS patient_name, p.sex, date_part('year', age(p.dob))::int AS age, v.token_no, d.name AS doctor_name, dep.name AS department, a.email AS decided_by_email
      FROM closures c JOIN patient_profiles p ON p.user_id=c.patient_id JOIN visits v ON v.id=c.visit_id JOIN users d ON d.id=c.doctor_id
      LEFT JOIN doctor_profiles dp ON dp.user_id=d.id LEFT JOIN departments dep ON dep.id=dp.department_id LEFT JOIN users a ON a.id=c.decided_by
      WHERE c.hospital_id=$1 ORDER BY c.id DESC LIMIT 100`, [u.hospitalId]);
  }

  @Post('closures/:id/:decision')
  async decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('decision') decision: string) {
    const d = oneOf(decision, 'Decision', ['approve', 'return'] as const);
    const c = await this.db.one(`UPDATE closures SET status=$3, decided_by=$4, decided_at=now() WHERE id=$1 AND hospital_id=$2 AND status='Pending approval' RETURNING *`,
      [int(id, 'Closure'), u.hospitalId, d === 'approve' ? 'Approved' : 'Returned to doctor', u.id]);
    if (!c) throw new NotFoundException('Request not found or already decided.');
    if (d === 'approve') {
      const info = await this.db.one(`SELECT p.full_name, p.medilink_id, h.name AS hospital, doc.name AS doctor, to_char(now(),'DD Mon YYYY') AS day FROM patient_profiles p, hospitals h, users doc WHERE p.user_id=$1 AND h.id=$2 AND doc.id=$3`, [c.patient_id, c.hospital_id, c.doctor_id]);
      const pdf = textPdf('Treatment completion summary', [`Patient: ${info!.full_name} (${info!.medilink_id})`, `Hospital: ${info!.hospital}`, `Doctor: ${info!.doctor}`, `Approved: ${info!.day}`, '', c.note]);
      const f = storeFile('treatment-summary.pdf', pdf.toString('base64'));
      await this.db.tx(async (cl) => {
        const doc = await cl.query(`INSERT INTO documents (patient_id, hospital_id, kind, department, title) VALUES ($1,$2,'report','Discharge Summary','Treatment completion summary') RETURNING id`, [c.patient_id, c.hospital_id]);
        await cl.query(`INSERT INTO document_versions (document_id, version, file_name, mime, size_bytes, sha256, storage_path, created_by) VALUES ($1,1,'treatment-summary.pdf',$2,$3,$4,$5,$6)`, [doc.rows[0].id, f.mime, f.size, f.sha256, f.path, u.id]);
      });
      await notify(this.db, c.patient_id, 'Treatment completed', 'Your closing summary is in your Drive.');
    } else {
      await notify(this.db, c.doctor_id, 'Treatment completion returned', 'The hospital admin asked you to review it.');
    }
    await this.audit.log(u, { action: d === 'approve' ? 'TREATMENT_APPROVED' : 'TREATMENT_RETURNED', patientId: c.patient_id });
    return { ok: true };
  }

  @Post('doctors/:id/bookings')
  async bookings(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.db.q('UPDATE doctor_profiles SET bookings_open=$3 WHERE user_id=$1 AND hospital_id=$2 RETURNING user_id', [int(id, 'Doctor'), u.hospitalId, !!b.open]);
    if (!r.length) throw new NotFoundException('Doctor not found.');
    await this.audit.log(u, { action: b.open ? 'DOCTOR_BOOKINGS_OPENED' : 'DOCTOR_BOOKINGS_PAUSED', detail: id });
    return { ok: true };
  }

  private async mine(u: AuthUser, id: string) {
    const p = await this.db.one('SELECT id, email, role FROM users WHERE id=$1 AND hospital_id=$2', [int(id, 'Account'), u.hospitalId]);
    if (!p) throw new NotFoundException('Account not found at your hospital.');
    return p;
  }

  @Post('people/:id/logout')
  async logout(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.mine(u, id);
    await this.db.q('UPDATE users SET token_version=token_version+1 WHERE id=$1', [p.id]);
    await this.audit.log(u, { action: 'FORCE_LOGOUT', detail: p.email });
    return { ok: true };
  }

  @Post('people/:id/reset-password')
  async reset(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.mine(u, id);
    if (p.id === u.id) throw new ForbiddenException('Use your own profile to change your password.');
    const temp = 'ML-' + randomBytes(5).toString('hex');
    await this.db.q('UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1', [p.id, await bcrypt.hash(temp, 10)]);
    await this.audit.log(u, { action: 'PASSWORD_RESET', detail: p.email });
    return { ok: true, temporaryPassword: temp, note: 'Share this once. All of their sessions have ended.' };
  }

  @Get('setup')
  async setup(@CurrentUser() u: AuthUser) {
    const h = await this.db.one('SELECT id, name, settings, extra_fields, qr_version FROM hospitals WHERE id=$1', [u.hospitalId]);
    const departments = await this.db.q('SELECT id, name, kind, active FROM departments WHERE hospital_id=$1 ORDER BY kind, name', [u.hospitalId]);
    return { ...h, departments };
  }

  @Put('setup')
  async saveSetup(@CurrentUser() u: AuthUser, @Body() b: any) {
    const n = (k: string, min: number, max: number) => { const v = Number(b[k]); if (!(v >= min && v <= max)) throw new BadRequestException(`${k} must be between ${min} and ${max}.`); return v; };
    const settings = { slotMinutes: n('slotMinutes', 5, 60), walkInSharePct: n('walkInSharePct', 0, 100), graceMinutes: n('graceMinutes', 0, 60), fee: n('fee', 0, 100000) };
    const fields = Array.isArray(b.extraFields) ? b.extraFields.slice(0, 12).map((f: unknown) => str(f, 'Field', { max: 60 })) : undefined;
    await this.db.q(`UPDATE hospitals SET settings=$2${fields ? ', extra_fields=$3' : ''} WHERE id=$1`, fields ? [u.hospitalId, settings, JSON.stringify(fields)] : [u.hospitalId, settings]);
    await this.audit.log(u, { action: 'HOSPITAL_SETUP_CHANGED', detail: JSON.stringify(settings) });
    return this.setup(u);
  }

  @Post('departments')
  async addDept(@CurrentUser() u: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Department name', { min: 2, max: 60 });
    const kind = oneOf(b.kind || 'clinical', 'Kind', ['clinical', 'diagnostic'] as const);
    if (await this.db.one('SELECT 1 FROM departments WHERE hospital_id=$1 AND lower(name)=lower($2)', [u.hospitalId, name])) throw new BadRequestException('This department already exists.');
    const d = await this.db.one('INSERT INTO departments (hospital_id, name, kind) VALUES ($1,$2,$3) RETURNING *', [u.hospitalId, name, kind]);
    await this.audit.log(u, { action: 'DEPARTMENT_ADDED', detail: name });
    return d;
  }

  @Post('departments/:id/active')
  async deptActive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.db.one('UPDATE departments SET active=$3 WHERE id=$1 AND hospital_id=$2 RETURNING name', [int(id, 'Department'), u.hospitalId, !!b.active]);
    if (!r) throw new NotFoundException('Department not found.');
    await this.audit.log(u, { action: b.active ? 'DEPARTMENT_ENABLED' : 'DEPARTMENT_DISABLED', detail: r.name });
    return { ok: true };
  }

  /** Every test order with its patient and timings, for the Tests & reports tab. */
  @Get('test-orders')
  testOrders(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT t.id, t.patient_id, t.test_name, t.department, t.status, t.created_at, t.updated_at, p.full_name, p.medilink_id, p.sex, p.dob,
        d.name AS advised_by_name,
        (SELECT json_agg(json_build_object('id', dv.id, 'version', dv.version, 'file', dv.file_name, 'reason', dv.reason, 'critical', dv.critical_note, 'at', dv.created_at, 'by', cu.email) ORDER BY dv.version)
           FROM documents doc JOIN document_versions dv ON dv.document_id=doc.id LEFT JOIN users cu ON cu.id=dv.created_by WHERE doc.test_order_id=t.id) AS versions
      FROM test_orders t JOIN patient_profiles p ON p.user_id=t.patient_id LEFT JOIN users d ON d.id=t.advised_by WHERE t.hospital_id=$1 ORDER BY t.id DESC LIMIT 300`, [u.hospitalId]);
  }

  @Post('alerts/:id/renew')
  async renew(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.one(`UPDATE conduct_alerts SET status='Active', review_date=CURRENT_DATE + 90 WHERE id=$1 AND hospital_id=$2 AND status IN ('Active','Expired') RETURNING patient_id`, [int(id, 'Alert'), u.hospitalId]);
    if (!r) throw new NotFoundException('Alert not found.');
    await this.audit.log(u, { action: 'CONDUCT_ALERT_RENEWED', patientId: r.patient_id, detail: '90 days after a fresh review' });
    return { ok: true };
  }

  @Post('doctors/:id/department')
  async department(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const dep = await this.db.one(`SELECT id, name FROM departments WHERE hospital_id=$1 AND kind='clinical' AND name=$2`, [u.hospitalId, str(b.department, 'Department')]);
    if (!dep) throw new BadRequestException('This hospital has no such clinical department.');
    const r = await this.db.q('UPDATE doctor_profiles SET department_id=$3, is_gp=$4 WHERE user_id=$1 AND hospital_id=$2 RETURNING user_id', [int(id, 'Doctor'), u.hospitalId, dep.id, dep.name === 'General Physician']);
    if (!r.length) throw new NotFoundException('Doctor not found.');
    await this.audit.log(u, { action: 'DOCTOR_DEPARTMENT_ASSIGNED', detail: `doctor ${id}: ${dep.name}` });
    return { ok: true };
  }

  @Post('data-requests/:id/advance')
  async advance(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.one(`SELECT r.* FROM data_requests r WHERE r.id=$1 AND EXISTS (SELECT 1 FROM visits v WHERE v.patient_id=r.patient_id AND v.hospital_id=$2)`, [int(id, 'Request'), u.hospitalId]);
    if (!r) throw new NotFoundException('Request not found.');
    const next = r.status === 'Pending' ? 'In review' : r.status === 'In review' ? 'Done' : null;
    if (!next) throw new BadRequestException('This request is already closed.');
    await this.db.q('UPDATE data_requests SET status=$2 WHERE id=$1', [r.id, next]);
    await this.audit.log(u, { action: 'DATA_REQUEST_' + next.toUpperCase().replace(' ', '_'), patientId: r.patient_id });
    if (next === 'Done') await notify(this.db, r.patient_id, 'Your data request is complete', `Request #${r.id} has been completed by the hospital.`);
    return { ok: true, status: next };
  }
}
