import { Throttle } from '@nestjs/throttler';
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles, requireDesk } from '../common/auth';
import { int, oneOf, str } from '../common/dto';
import { notify } from '../common/notify';
import { storeFile } from '../common/files';
import { ACTIVE, VisitsService, lateSql, placeSql } from './visits.service';

/** Reception desk: people, queues and routing. No access to any clinical document. */
@Controller('reception')
@Roles('staff')
export class ReceptionController {
  constructor(private db: Db, private audit: AuditService, private visits: VisitsService) {}

  private async visitHere(u: AuthUser, id: string) {
    requireDesk(u, 'Reception');
    const v = await this.db.one('SELECT * FROM visits WHERE id=$1 AND hospital_id=$2', [int(id, 'Visit'), u.hospitalId]);
    if (!v) throw new NotFoundException('Visit not found at this hospital.');
    return v;
  }

  @Get('board')
  async board(@CurrentUser() u: AuthUser) {
    requireDesk(u, 'Reception');
    const queue = await this.db.q(
      `SELECT v.id, v.patient_id, v.member_id, v.token_no, v.status, v.priority, v.emergency, v.created_at, ${lateSql('v')} AS late, v.assignment, coalesce(m.name || ' (for ' || p.full_name || ')', p.full_name) AS full_name, p.medilink_id, coalesce(m.sex, p.sex) AS sex,
              right(coalesce(p.phone,''),4) AS phone_last4, d.name AS doctor_name,
              EXISTS (SELECT 1 FROM conduct_alerts c WHERE c.patient_id=v.patient_id AND c.hospital_id=v.hospital_id AND c.status='Active') AS conduct_alert
       FROM visits v JOIN patient_profiles p ON p.user_id=v.patient_id LEFT JOIN family_members m ON m.id=v.member_id LEFT JOIN users d ON d.id=v.doctor_id
       WHERE v.hospital_id=$1 AND v.visit_date=CURRENT_DATE AND v.status = ANY($2) ORDER BY v.priority DESC, ${lateSql('v')}, ${placeSql('v')}`, [u.hospitalId, ACTIVE]);
    const testsToBook = await this.db.q(
      `SELECT t.id, t.patient_id, t.test_name, t.department, t.status, p.full_name, p.medilink_id, p.sex, p.dob FROM test_orders t JOIN patient_profiles p ON p.user_id=t.patient_id
       WHERE t.hospital_id=$1 AND t.status IN ('Advised','Booked') ORDER BY t.id`, [u.hospitalId]);
    const alerts = await this.db.q(`SELECT * FROM emergency_alerts WHERE hospital_id=$1 AND created_at > now() - interval '6 hours' ORDER BY id DESC`, [u.hospitalId]);
    const doctors = await this.db.q(`SELECT u.id, u.name, d.name AS department FROM users u JOIN doctor_profiles dp ON dp.user_id=u.id JOIN departments d ON d.id=dp.department_id WHERE dp.hospital_id=$1 AND u.active ORDER BY u.name`, [u.hospitalId]);
    return { queue, testsToBook, alerts, doctors };
  }

  @Post('visits/:id/vitals')
  async vitals(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const v = await this.visitHere(u, id);
    const vitals = { bp: b.bp || null, pulse: b.pulse || null, temp: b.temp || null, spo2: b.spo2 || null, weight: b.weight || null, at: new Date().toISOString() };
    await this.db.q(`UPDATE visits SET extra_answers = extra_answers || jsonb_build_object('vitals', $2::jsonb) WHERE id=$1`, [v.id, JSON.stringify(vitals)]);
    await this.audit.log(u, { action: 'VITALS_RECORDED', patientId: v.patient_id });
    return { ok: true };
  }

  @Post('visits/:id/:action')
  async act(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('action') action: string) {
    const v = await this.visitHere(u, id);
    const a = oneOf(action, 'Action', ['approve', 'arrive', 'noshow', 'priority'] as const);
    const sql = {
      approve: `UPDATE visits SET status='Approved', approved_at=now() WHERE id=$1 AND status='Requested' RETURNING id`,
      arrive: `UPDATE visits SET status='Arrived', arrived_at=now(), approved_at=coalesce(approved_at, now()) WHERE id=$1 AND status IN ('Requested','Approved') RETURNING id`,
      noshow: `UPDATE visits SET status='NoShow' WHERE id=$1 AND status IN ('Requested','Approved') RETURNING id`,
      priority: `UPDATE visits SET priority=NOT priority WHERE id=$1 RETURNING id`,
    }[a];
    const r = await this.db.q(sql, [v.id]);
    if (!r.length) throw new BadRequestException('This visit is not in a state where that is possible.');
    await this.audit.log(u, { action: `VISIT_${a.toUpperCase()}`, patientId: v.patient_id, hospitalId: v.hospital_id });
    if (a === 'approve') await notify(this.db, v.patient_id, `Token ${v.token_no} approved`, 'Reception has approved your registration.');
    return { ok: true };
  }

  /** Walk-in or emergency registration for patients without the app. Creates a MediLink profile they can claim later. */
  @Post('walk-in')
  async walkIn(@CurrentUser() u: AuthUser, @Body() b: any) {
    requireDesk(u, 'Reception');
    const emergency = !!b.emergency;
    const name = emergency ? (str(b.name, 'Name', { optional: true }) || 'Unknown patient') : str(b.name, 'Name', { min: 2 });
    const phone = str(b.phone, 'Phone', { optional: true });
    if (phone) {
      const dup = await this.db.one(`SELECT p.medilink_id, p.full_name FROM patient_profiles p WHERE p.phone=$1`, [phone]);
      if (dup && !b.confirmNew) return { duplicate: true, existing: dup, message: `A profile with this phone already exists (${dup.full_name}, ${dup.medilink_id}). Use it, or confirm a new profile.` };
    }
    const result = await this.db.tx(async (c) => {
      const email = `walkin.${Date.now()}.${randomBytes(3).toString('hex')}@walkin.medilink.local`;
      const ur = await c.query(`INSERT INTO users (email, password_hash, role, name) VALUES ($1,$2,'patient',$3) RETURNING id`, [email, await bcrypt.hash(randomBytes(12).toString('hex'), 8), name]);
      const pid = ur.rows[0].id;
      await c.query(`INSERT INTO patient_profiles (user_id, medilink_id, full_name, phone, sex) VALUES ($1,$2,$3,$4,$5)`,
        [pid, 'ML-' + String(100000 + pid).slice(-6), name, phone || null, b.sex || null]);
      await c.query('INSERT INTO consents (patient_id, hospital_id, scope) VALUES ($1,$2,$3)', [pid, u.hospitalId, 'Walk-in registration at reception']);
      return pid;
    });
    const pick = await this.visits.pickDoctor(u.hospitalId!, { doctorId: b.doctorId ? int(b.doctorId, 'Doctor') : undefined });
    const token = await this.visits.nextToken(u.hospitalId!, emergency ? 'E' : 'W');
    const v = await this.db.one(`INSERT INTO visits (patient_id, hospital_id, doctor_id, department_id, token_no, symptoms, assignment, priority, status, emergency, arrived_at, approved_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Arrived',$9, now(), now()) RETURNING *`,
      [result, u.hospitalId, pick.doctorId, pick.departmentId, token, str(b.symptoms, 'Reason', { optional: true }) || (emergency ? 'Emergency' : 'Walk-in'), b.doctorId ? 'chosen' : 'auto', emergency, emergency]);
    await this.audit.log(u, { action: emergency ? 'EMERGENCY_REGISTRATION' : 'WALKIN_REGISTRATION', patientId: result, detail: token });
    return { visit: v, token };
  }

  @Get('lookup')
  async lookup(@CurrentUser() u: AuthUser, @Query('q') q: string) {
    requireDesk(u, 'Reception');
    const term = str(q, 'Search', { min: 2 });
    return this.db.q(
      `SELECT p.user_id AS id, p.full_name, p.medilink_id, p.sex, date_part('year', age(p.dob))::int AS age, right(coalesce(p.phone,''),4) AS phone_last4,
              EXISTS (SELECT 1 FROM conduct_alerts c WHERE c.patient_id=p.user_id AND c.hospital_id=$2 AND c.status='Active') AS conduct_alert,
              (SELECT v.token_no FROM visits v WHERE v.patient_id=p.user_id AND v.hospital_id=$2 AND v.visit_date=CURRENT_DATE AND v.status NOT IN ('Cancelled','NoShow') ORDER BY v.id DESC LIMIT 1) AS today_token
       FROM patient_profiles p WHERE p.full_name ILIKE '%'||$1||'%' OR p.medilink_id ILIKE $1 OR p.phone LIKE '%'||$1
          OR EXISTS (SELECT 1 FROM visits t WHERE t.patient_id=p.user_id AND t.hospital_id=$2 AND t.visit_date=CURRENT_DATE AND t.token_no ILIKE $1)
       ORDER BY p.full_name LIMIT 20`, [term, u.hospitalId]);
  }

  @Post('tests/:id/:action')
  async test(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('action') action: string) {
    requireDesk(u, 'Reception');
    const a = oneOf(action, 'Action', ['book', 'checkin'] as const);
    const t = await this.db.one(`UPDATE test_orders SET status=$3, booked_by=$4, updated_at=now() WHERE id=$1 AND hospital_id=$2 AND status=$5 RETURNING *`,
      [int(id, 'Test'), u.hospitalId, a === 'book' ? 'Booked' : 'CheckedIn', u.id, a === 'book' ? 'Advised' : 'Booked']);
    if (!t) throw new BadRequestException('This test cannot be updated now.');
    await this.audit.log(u, { action: a === 'book' ? 'TEST_BOOKED' : 'TEST_CHECKED_IN', patientId: t.patient_id });
    if (a === 'book') await notify(this.db, t.patient_id, 'Test booked', `${t.test_name} is booked at ${t.department}.`);
    return t;
  }
}

/** Diagnostics desk: only the worklist of the staff member's own department. */
@Controller('diagnostics')
@Roles('staff')
export class DiagnosticsController {
  constructor(private db: Db, private audit: AuditService) {}

  private dept(u: AuthUser) {
    if (!u.desk || u.desk === 'Reception') throw new ForbiddenException('Please choose a diagnostics desk first.');
    requireDesk(u, u.desk);
    return u.desk;
  }

  @Get('worklist')
  async worklist(@CurrentUser() u: AuthUser) {
    const dept = this.dept(u);
    const open = await this.db.q(
      `SELECT t.*, p.full_name, p.medilink_id, p.sex, date_part('year', age(p.dob))::int AS age,
              EXISTS (SELECT 1 FROM conduct_alerts c WHERE c.patient_id=t.patient_id AND c.hospital_id=t.hospital_id AND c.status='Active') AS conduct_alert
       FROM test_orders t JOIN patient_profiles p ON p.user_id=t.patient_id
       WHERE t.hospital_id=$1 AND t.department=$2 AND t.status IN ('CheckedIn','SampleCollected','ReportReady') ORDER BY t.id`, [u.hospitalId, dept]);
    const sent = await this.db.q(
      `SELECT d.id AS document_id, d.patient_id, d.title, d.test_order_id, p.full_name, p.sex, p.dob, dv.version, dv.file_name, dv.mime, dv.created_at, dv.id AS version_id FROM documents d
       JOIN document_versions dv ON dv.document_id=d.id AND dv.version=(SELECT max(version) FROM document_versions WHERE document_id=d.id)
       JOIN patient_profiles p ON p.user_id=d.patient_id WHERE d.hospital_id=$1 AND d.department=$2 ORDER BY dv.created_at DESC LIMIT 30`, [u.hospitalId, dept]);
    return { department: dept, open, sent };
  }

  @Post('tests/:id/advance')
  async advance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const dept = this.dept(u);
    const to = oneOf(b.status, 'Status', ['SampleCollected', 'ReportReady', 'Cancelled'] as const);
    const from = { SampleCollected: ['CheckedIn'], ReportReady: ['SampleCollected'], Cancelled: ['CheckedIn', 'SampleCollected', 'ReportReady'] }[to];
    const t = await this.db.one(`UPDATE test_orders SET status=$4, updated_at=now() WHERE id=$1 AND hospital_id=$2 AND department=$3 AND status = ANY($5) RETURNING *`,
      [int(id, 'Test'), u.hospitalId, dept, to, from]);
    if (!t) throw new BadRequestException('This test cannot move to that step.');
    await this.audit.log(u, { action: `TEST_${to.toUpperCase()}`, patientId: t.patient_id });
    return t;
  }

  /** Sends a report to the patient's Drive from a test order. Patient and department are locked by the order. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('tests/:id/send')
  async send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const dept = this.dept(u);
    const t = await this.db.one(`SELECT * FROM test_orders WHERE id=$1 AND hospital_id=$2 AND department=$3 AND status IN ('SampleCollected','ReportReady')`, [int(id, 'Test'), u.hospitalId, dept]);
    if (!t) throw new BadRequestException('This test is not ready to send.');
    if (b.critical && !str(b.criticalNote, 'Critical result note', { optional: true })) throw new BadRequestException('For a critical result, note who was informed and when.');
    const f = storeFile(str(b.fileName, 'File name'), str(b.dataBase64, 'File'));
    const docId = await this.db.tx(async (c) => {
      const d = await c.query(`INSERT INTO documents (patient_id, hospital_id, test_order_id, kind, department, title) VALUES ($1,$2,$3,'report',$4,$5) RETURNING id`,
        [t.patient_id, t.hospital_id, t.id, dept, t.test_name]);
      await c.query(`INSERT INTO document_versions (document_id, version, file_name, mime, size_bytes, sha256, storage_path, critical_note, created_by) VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
        [d.rows[0].id, b.fileName, f.mime, f.size, f.sha256, f.path, b.critical ? b.criticalNote : null, u.id]);
      await c.query(`UPDATE test_orders SET status='Sent', updated_at=now() WHERE id=$1`, [t.id]);
      return d.rows[0].id;
    });
    await this.audit.log(u, { action: 'REPORT_SENT', patientId: t.patient_id, detail: `${t.test_name}${b.critical ? ' (critical)' : ''}` });
    await notify(this.db, t.patient_id, 'New report in your Drive', `${t.test_name} from ${dept}.`);
    return { ok: true, documentId: docId };
  }

  /** Sent reports are final. A correction is a new version with a reason; the old version stays visible. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('documents/:id/correct')
  async correct(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const dept = this.dept(u);
    const d = await this.db.one(`SELECT * FROM documents WHERE id=$1 AND hospital_id=$2 AND department=$3`, [int(id, 'Report'), u.hospitalId, dept]);
    if (!d) throw new NotFoundException('Report not found for your department.');
    const reason = str(b.reason, 'Reason for correction', { min: 5, max: 500 });
    const f = storeFile(str(b.fileName, 'File name'), str(b.dataBase64, 'File'));
    const next = await this.db.one('SELECT coalesce(max(version),0)+1 AS v FROM document_versions WHERE document_id=$1', [d.id]);
    await this.db.q(`INSERT INTO document_versions (document_id, version, file_name, mime, size_bytes, sha256, storage_path, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.id, next.v, b.fileName, f.mime, f.size, f.sha256, f.path, reason, u.id]);
    await this.audit.log(u, { action: 'REPORT_CORRECTED', patientId: d.patient_id, detail: `v${next.v}: ${reason}` });
    await notify(this.db, d.patient_id, 'Report corrected', `${d.title} has a corrected version (v${next.v}).`);
    return { ok: true, version: next.v };
  }
}

/** Any doctor or staff member can report an incident. Only an admin decides on a conduct alert. */
@Controller('incidents')
@Roles('doctor', 'staff', 'admin')
export class IncidentsController {
  constructor(private db: Db, private audit: AuditService) {}

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const hospitalId = u.hospitalId ?? (await this.db.one('SELECT hospital_id FROM doctor_profiles WHERE user_id=$1', [u.id]))?.hospital_id;
    if (!hospitalId) throw new ForbiddenException('No hospital linked to your account.');
    const category = oneOf(b.category, 'Category', ['Abusive language', 'Threat or violence', 'Harassment', 'Property damage', 'Repeated disruption', 'Other'] as const);
    const r = await this.db.one(`INSERT INTO incident_reports (patient_id, hospital_id, category, happened_on, place, note, witness, reported_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [int(b.patientId, 'Patient'), hospitalId, category, b.date || new Date().toISOString().slice(0, 10), b.place || null, str(b.note, 'What happened', { min: 10, max: 1000 }), b.witness || null, u.id]);
    await this.audit.log({ ...u, hospitalId }, { action: 'INCIDENT_REPORTED', patientId: Number(b.patientId) });
    return { ok: true, id: r.id, message: 'Sent to the Admin. Nothing changes for the patient until the Admin decides.' };
  }
}
