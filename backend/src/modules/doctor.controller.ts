import { Throttle } from '@nestjs/throttler';
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { parseSigned, parseVisitQr } from '../common/qr';
import { int, oneOf, str } from '../common/dto';
import { notify } from '../common/notify';
import { ACTIVE, lateSql, placeSql } from './visits.service';

@Controller('doctor')
@Roles('doctor')
export class DoctorController {
  constructor(private db: Db, private audit: AuditService) {}

  private async onDuty(u: AuthUser) {
    const s = await this.db.one('SELECT * FROM shifts WHERE doctor_id=$1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1', [u.id]);
    if (!s) throw new ForbiddenException('Please clock in by scanning the hospital duty QR first.');
    return s;
  }

  private async myVisit(u: AuthUser, id: string) {
    const v = await this.db.one('SELECT * FROM visits WHERE id=$1', [int(id, 'Visit')]);
    if (!v || v.doctor_id !== u.id) throw new NotFoundException('This patient is not in your queue.');
    return v;
  }

  @Get('status')
  async status(@CurrentUser() u: AuthUser) {
    const shift = await this.db.one('SELECT * FROM shifts WHERE doctor_id=$1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1', [u.id]);
    const profile = await this.db.one(`SELECT dp.*, d.name AS department, h.name AS hospital_name FROM doctor_profiles dp
      JOIN departments d ON d.id=dp.department_id JOIN hospitals h ON h.id=dp.hospital_id WHERE dp.user_id=$1`, [u.id]);
    return { onDuty: !!shift, shift, profile };
  }

  @Post('clock-in')
  async clockIn(@CurrentUser() u: AuthUser, @Body() b: any) {
    const parsed = parseSigned(str(b.code, 'Duty QR'), 'ML-D');
    if (!parsed) throw new BadRequestException('This is not a valid MediLink duty QR.');
    const dp = await this.db.one('SELECT hospital_id FROM doctor_profiles WHERE user_id=$1', [u.id]);
    if (!dp || dp.hospital_id !== parsed.hospitalId) throw new ForbiddenException('This duty QR belongs to a different hospital.');
    const h = await this.db.one('SELECT qr_version FROM hospitals WHERE id=$1', [parsed.hospitalId]);
    if (h.qr_version !== parsed.version) throw new BadRequestException('This duty QR is old. Please scan the current one.');
    const open = await this.db.one('SELECT id FROM shifts WHERE doctor_id=$1 AND clock_out IS NULL', [u.id]);
    if (open) return { ok: true, message: 'You are already clocked in.' };
    await this.db.q('INSERT INTO shifts (doctor_id, hospital_id) VALUES ($1,$2)', [u.id, parsed.hospitalId]);
    await this.audit.log(u, { action: 'CLOCK_IN', hospitalId: parsed.hospitalId });
    return { ok: true, message: 'Clocked in. Doctor mode is on.' };
  }

  @Post('clock-out')
  async clockOut(@CurrentUser() u: AuthUser) {
    await this.db.q('UPDATE shifts SET clock_out=now() WHERE doctor_id=$1 AND clock_out IS NULL', [u.id]);
    await this.audit.log(u, { action: 'CLOCK_OUT' });
    return { ok: true };
  }

  @Get('queue')
  async queue(@CurrentUser() u: AuthUser) {
    return this.db.q(
      `SELECT v.id, v.patient_id, v.member_id, v.token_no, v.status, v.symptoms, v.priority, v.created_at, coalesce(m.name, p.full_name) AS full_name, coalesce(m.sex, p.sex) AS sex, coalesce(m.dob, p.dob) AS dob, p.medilink_id,
              CASE WHEN m.id IS NOT NULL THEN m.relation || ' of ' || p.full_name END AS member_note, ${lateSql('v')} AS late,
              EXISTS (SELECT 1 FROM conduct_alerts c WHERE c.patient_id=v.patient_id AND c.hospital_id=v.hospital_id AND c.status='Active') AS conduct_alert
       FROM visits v JOIN patient_profiles p ON p.user_id=v.patient_id LEFT JOIN family_members m ON m.id=v.member_id
       WHERE v.doctor_id=$1 AND v.visit_date=CURRENT_DATE AND v.status = ANY($2)
       ORDER BY v.priority DESC, ${lateSql('v')}, ${placeSql('v')}`, [u.id, ACTIVE]);
  }

  /** Scanning the patient's rotating QR is the only way to open a record. Every view is audited. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('scan')
  async scan(@CurrentUser() u: AuthUser, @Body() b: any) {
    const shift = await this.onDuty(u);
    const patientId = parseVisitQr(str(b.code, 'Patient QR'));
    if (!patientId) throw new BadRequestException('This QR has expired or is not a MediLink patient QR. Ask the patient to show the live QR.');
    const consent = await this.db.one('SELECT 1 FROM consents WHERE patient_id=$1 AND hospital_id=$2 AND revoked_at IS NULL', [patientId, shift.hospital_id]);
    if (!consent) throw new ForbiddenException('The patient has not shared their record with this hospital.');
    const visit = await this.db.one(`SELECT * FROM visits WHERE patient_id=$1 AND doctor_id=$2 AND visit_date=CURRENT_DATE AND status = ANY($3) ORDER BY id DESC LIMIT 1`, [patientId, u.id, ACTIVE]);
    if (visit && visit.status !== 'InConsultation') await this.db.q(`UPDATE visits SET status='InConsultation' WHERE id=$1`, [visit.id]);
    await this.audit.log(u, { action: 'RECORD_VIEWED', patientId, hospitalId: shift.hospital_id, detail: 'Opened by scanning patient QR' });
    return this.record(patientId, visit?.id ?? null, shift.hospital_id);
  }

  private async record(patientId: number, visitId: number | null, hospitalId: number) {
    const profile = await this.db.one(`SELECT medilink_id, full_name, dob, sex, blood_group, allergies, phone, emergency_contact_name, emergency_contact_phone, insurance
      FROM patient_profiles WHERE user_id=$1`, [patientId]);
    const visits = await this.db.q(`SELECT v.id, v.visit_date, v.symptoms, v.status, h.name AS hospital_name, u.name AS doctor_name FROM visits v
      JOIN hospitals h ON h.id=v.hospital_id LEFT JOIN users u ON u.id=v.doctor_id WHERE v.patient_id=$1 ORDER BY v.id DESC LIMIT 20`, [patientId]);
    const prescriptions = await this.db.q(`SELECT p.id, p.text, p.follow_up, p.created_at, u.name AS doctor_name FROM prescriptions p JOIN users u ON u.id=p.doctor_id
      WHERE p.patient_id=$1 ORDER BY p.id DESC LIMIT 20`, [patientId]);
    const reports = await this.db.q(`SELECT d.id, d.title, d.department, d.created_at, (SELECT max(version) FROM document_versions dv WHERE dv.document_id=d.id) AS latest_version
      FROM documents d WHERE d.patient_id=$1 AND d.kind='report' ORDER BY d.id DESC LIMIT 20`, [patientId]);
    const alert = await this.db.one(`SELECT category FROM conduct_alerts WHERE patient_id=$1 AND hospital_id=$2 AND status='Active'`, [patientId, hospitalId]);
    return { patientId, visitId, profile, visits, prescriptions, reports, conductAlert: alert ? { category: alert.category, note: 'Please inform security if needed. Your duty of care is unchanged.' } : null, watermark: 'View only — access is logged' };
  }

  @Post('visits/:id/status')
  async setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    await this.onDuty(u);
    const v = await this.myVisit(u, id);
    const status = oneOf(b.status, 'Status', ['Called', 'InConsultation', 'Completed', 'NoShow'] as const);
    await this.db.q(`UPDATE visits SET status=$2, completed_at=CASE WHEN $2='Completed' THEN now() ELSE completed_at END WHERE id=$1`, [v.id, status]);
    await this.audit.log(u, { action: `VISIT_${status.toUpperCase()}`, patientId: v.patient_id, hospitalId: v.hospital_id });
    if (status === 'Called') await notify(this.db, v.patient_id, `Token ${v.token_no}: you are being called`, 'Please go to the doctor\'s room now.');
    return { ok: true };
  }

  @Post('visits/:id/prescription')
  async prescribe(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    await this.onDuty(u);
    const v = await this.myVisit(u, id);
    const text = str(b.text, 'Prescription', { min: 3, max: 4000 });
    const p = await this.db.one(`INSERT INTO prescriptions (visit_id, patient_id, doctor_id, text, follow_up) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [v.id, v.patient_id, u.id, text, str(b.followUp, 'Follow-up', { optional: true, max: 200 }) || null]);
    await this.audit.log(u, { action: 'PRESCRIPTION_CREATED', patientId: v.patient_id, hospitalId: v.hospital_id });
    await notify(this.db, v.patient_id, 'New prescription', `${u.name} added a prescription to your Drive.`);
    return p;
  }

  @Post('visits/:id/tests')
  async advise(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    await this.onDuty(u);
    const v = await this.myVisit(u, id);
    const department = str(b.department, 'Department');
    const dept = await this.db.one(`SELECT 1 FROM departments WHERE hospital_id=$1 AND name=$2 AND kind='diagnostic' AND active`, [v.hospital_id, department]);
    if (!dept) throw new BadRequestException('This hospital has no such diagnostic department.');
    const t = await this.db.one(`INSERT INTO test_orders (visit_id, patient_id, hospital_id, department, test_name, advised_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [v.id, v.patient_id, v.hospital_id, department, str(b.testName, 'Test name', { max: 120 }), u.id]);
    await this.audit.log(u, { action: 'TEST_ADVISED', patientId: v.patient_id, hospitalId: v.hospital_id, detail: t.test_name });
    await notify(this.db, v.patient_id, 'Test advised', `${t.test_name} (${department}). Reception will book it for you.`);
    return t;
  }

  @Post('visits/:id/refer')
  async refer(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    await this.onDuty(u);
    const v = await this.myVisit(u, id);
    const toHospitalId = int(b.toHospitalId, 'Hospital');
    const r = await this.db.one(`INSERT INTO referrals (visit_id, patient_id, from_doctor, to_hospital_id, to_department, reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [v.id, v.patient_id, u.id, toHospitalId, str(b.toDepartment, 'Department'), str(b.reason, 'Reason', { min: 3, max: 500 })]);
    await this.db.q(`UPDATE visits SET status='Referred' WHERE id=$1`, [v.id]);
    await this.audit.log(u, { action: 'REFERRAL_CREATED', patientId: v.patient_id, hospitalId: v.hospital_id });
    await notify(this.db, v.patient_id, 'Referral recommended', 'Your doctor has recommended a referral. Open Referrals to accept or decline.');
    return r;
  }
}
