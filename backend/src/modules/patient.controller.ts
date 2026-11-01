import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Res } from '@nestjs/common';
import { Response } from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { parseSigned, visitQr } from '../common/qr';
import { notify } from '../common/notify';
import { int, oneOf, str } from '../common/dto';
import { VisitsService } from './visits.service';

@Controller('me')
@Roles('patient', 'doctor')
export class PatientController {
  constructor(private db: Db, private audit: AuditService, private visits: VisitsService) {}

  @Get('profile')
  async profile(@CurrentUser() u: AuthUser) {
    let p = await this.db.one('SELECT * FROM patient_profiles WHERE user_id=$1', [u.id]);
    if (!p) { // doctors also have a patient profile for Patient mode
      await this.db.q('INSERT INTO patient_profiles (user_id, medilink_id, full_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, 'ML-' + String(100000 + u.id).slice(-6), u.name]);
      p = await this.db.one('SELECT * FROM patient_profiles WHERE user_id=$1', [u.id]);
    }
    return p;
  }

  @Put('profile')
  async update(@CurrentUser() u: AuthUser, @Body() b: any) {
    const sex = b.sex ? oneOf(b.sex, 'Sex', ['Male', 'Female', 'Other'] as const) : null;
    const allergies = Array.isArray(b.allergies) ? b.allergies.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 30) : [];
    if (b.phone && !/^\+?\d[\d\s-]{8,14}$/.test(b.phone)) throw new BadRequestException('Please enter a valid phone number.');
    await this.profile(u);
    const p = await this.db.one(
      `UPDATE patient_profiles SET full_name=$2, dob=$3, sex=$4, phone=$5, address=$6, blood_group=$7, emergency_contact_name=$8,
         emergency_contact_phone=$9, allergies=$10, insurance=$11, declaration_at=COALESCE(declaration_at, CASE WHEN $12 THEN now() END), updated_at=now()
       WHERE user_id=$1 RETURNING *`,
      [u.id, str(b.fullName, 'Full name', { min: 2, max: 100 }), b.dob || null, sex, b.phone || null, b.address || null, b.bloodGroup || null,
        b.emergencyContactName || null, b.emergencyContactPhone || null, allergies, b.insurance ? JSON.stringify(b.insurance) : null, !!b.declaration]);
    await this.audit.log(u, { action: 'PROFILE_UPDATED', patientId: u.id });
    return p;
  }

  /** Mock ABDM / DigiLocker verification. Raw Aadhaar numbers are never stored. */
  @Post('verify')
  async verify(@CurrentUser() u: AuthUser, @Body() b: any) {
    const kind = oneOf(b.kind, 'Verification', ['aadhaar', 'abha'] as const);
    await this.db.q(`UPDATE patient_profiles SET ${kind === 'aadhaar' ? 'aadhaar_verified' : 'abha_linked'}=TRUE WHERE user_id=$1`, [u.id]);
    await this.audit.log(u, { action: kind === 'aadhaar' ? 'AADHAAR_VERIFIED_MOCK' : 'ABHA_LINKED_MOCK', patientId: u.id });
    return { ok: true, note: 'Demo mode: verification is simulated. Real ABDM/DigiLocker integration needs sandbox approval.' };
  }

  @Post('visits')
  register(@CurrentUser() u: AuthUser, @Body() b: any) { return this.visits.register(u, b); }

  @Get('visits')
  async myVisits(@CurrentUser() u: AuthUser) {
    const ids = await this.db.q('SELECT id FROM visits WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 30', [u.id]);
    return Promise.all(ids.map((r) => this.visits.detail(r.id)));
  }

  @Get('visits/:id')
  async visit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.visits.detail(int(id, 'Visit'));
    if (!v || v.patient_id !== u.id) throw new NotFoundException('Visit not found.');
    return v;
  }

  /** Patient scans the hospital's entrance QR: the token they already hold moves to "Arrived". Safe to repeat. */
  @Post('visits/:id/checkin')
  async checkin(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const visitId = int(id, 'Visit');
    const v = await this.db.one('SELECT id, hospital_id, status, token_no FROM visits WHERE id=$1 AND patient_id=$2', [visitId, u.id]);
    if (!v) throw new NotFoundException('Visit not found.');
    const parsed = parseSigned(String(b && b.code || ''), 'ML-H');
    if (!parsed) throw new BadRequestException('Please scan the hospital QR code to check in.');
    if (parsed.hospitalId !== v.hospital_id) throw new BadRequestException('This QR belongs to a different hospital than your token.');
    const h = await this.db.one('SELECT qr_version FROM hospitals WHERE id=$1 AND active', [v.hospital_id]);
    if (!h || h.qr_version !== parsed.version) throw new BadRequestException('This QR code is old. Please scan the current QR at the hospital.');
    if (v.status === 'Requested' || v.status === 'Approved') {
      await this.db.q(`UPDATE visits SET status='Arrived', arrived_at=now(), approved_at=coalesce(approved_at, now()) WHERE id=$1 AND status IN ('Requested','Approved')`, [visitId]);
      await this.audit.log(u, { action: 'PATIENT_QR_CHECKIN', hospitalId: v.hospital_id, patientId: u.id, detail: `token ${v.token_no}` });
      await notify(this.db, u.id, `Checked in: token ${v.token_no}`, 'You are in the queue. Please wait for your token to be called.');
    } else if (!['Arrived', 'Called', 'InConsultation'].includes(v.status)) {
      throw new BadRequestException('This visit can no longer be checked in.');
    }
    return this.visits.detail(visitId);
  }

  @Post('visits/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.q(`UPDATE visits SET status='Cancelled' WHERE id=$1 AND patient_id=$2 AND status IN ('Requested','Approved') RETURNING id`, [int(id, 'Visit'), u.id]);
    if (!r.length) throw new BadRequestException('This visit can no longer be cancelled.');
    await this.audit.log(u, { action: 'VISIT_CANCELLED', patientId: u.id });
    return { ok: true };
  }

  /** Short-lived rotating QR the doctor scans to open this patient's record. */
  @Get('visit-qr')
  qr(@CurrentUser() u: AuthUser) { return visitQr(u.id); }

  @Get('drive')
  async drive(@CurrentUser() u: AuthUser) {
    const prescriptions = await this.db.q(
      `SELECT p.id, p.text, p.follow_up, p.created_at, u.name AS doctor_name, h.name AS hospital_name FROM prescriptions p
       JOIN users u ON u.id=p.doctor_id JOIN visits v ON v.id=p.visit_id JOIN hospitals h ON h.id=v.hospital_id
       WHERE p.patient_id=$1 ORDER BY p.created_at DESC`, [u.id]);
    const documents = await this.db.q(
      `SELECT d.id, d.title, d.kind, d.department, d.created_at, h.name AS hospital_name,
         (SELECT json_agg(json_build_object('id', dv.id, 'version', dv.version, 'fileName', dv.file_name, 'mime', dv.mime, 'reason', dv.reason, 'createdAt', dv.created_at) ORDER BY dv.version DESC)
          FROM document_versions dv WHERE dv.document_id=d.id) AS versions
       FROM documents d LEFT JOIN hospitals h ON h.id=d.hospital_id WHERE d.patient_id=$1 ORDER BY d.created_at DESC`, [u.id]);
    return { prescriptions, documents };
  }

  @Get('files/:versionId')
  async file(@CurrentUser() u: AuthUser, @Param('versionId') vid: string, @Res() res: Response) {
    const f = await this.db.one(`SELECT dv.*, d.patient_id FROM document_versions dv JOIN documents d ON d.id=dv.document_id WHERE dv.id=$1`, [int(vid, 'File')]);
    if (!f || f.patient_id !== u.id) throw new NotFoundException('File not found.');
    const p = resolve(f.storage_path);
    if (!existsSync(p)) throw new NotFoundException('File is missing from storage.');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${f.file_name.replace(/"/g, '')}"`);
    res.sendFile(p);
  }

  @Get('consents')
  consents(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT c.*, h.name AS hospital_name FROM consents c JOIN hospitals h ON h.id=c.hospital_id WHERE c.patient_id=$1 ORDER BY c.granted_at DESC`, [u.id]);
  }

  @Post('consents/:id/revoke')
  async revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.q('UPDATE consents SET revoked_at=now() WHERE id=$1 AND patient_id=$2 AND revoked_at IS NULL RETURNING hospital_id', [int(id, 'Consent'), u.id]);
    if (!r.length) throw new BadRequestException('Consent not found or already revoked.');
    await this.audit.log(u, { action: 'CONSENT_REVOKED', patientId: u.id, hospitalId: r[0].hospital_id });
    return { ok: true };
  }

  /** Who opened my records, and why. */
  @Get('access-history')
  access(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT a.at, a.action, a.detail, a.role, x.name AS by_name FROM audit_log a LEFT JOIN users x ON x.id=a.user_id
      WHERE a.patient_id=$1 AND a.action IN ('RECORD_VIEWED','ADMIN_RECORD_VIEWED','EMERGENCY_RECORD_VIEWED') ORDER BY a.id DESC LIMIT 50`, [u.id]);
  }

  @Get('notifications')
  notifications(@CurrentUser() u: AuthUser) { return this.db.q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [u.id]); }

  @Post('notifications/read')
  async read(@CurrentUser() u: AuthUser) { await this.db.q('UPDATE notifications SET read=TRUE WHERE user_id=$1', [u.id]); return { ok: true }; }

  @Get('referrals')
  referrals(@CurrentUser() u: AuthUser) {
    return this.db.q(`SELECT r.*, h.name AS to_hospital_name, d.name AS from_doctor_name FROM referrals r JOIN hospitals h ON h.id=r.to_hospital_id
      JOIN users d ON d.id=r.from_doctor WHERE r.patient_id=$1 ORDER BY r.id DESC`, [u.id]);
  }

  @Post('referrals/:id/respond')
  async respond(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const status = oneOf(b.status, 'Response', ['Accepted', 'Declined'] as const);
    const r = await this.db.one(`UPDATE referrals SET status=$3 WHERE id=$1 AND patient_id=$2 AND status='Proposed' RETURNING *`, [int(id, 'Referral'), u.id, status]);
    if (!r) throw new ForbiddenException('Referral not found or already answered.');
    if (status === 'Accepted' && !(await this.db.one('SELECT 1 FROM consents WHERE patient_id=$1 AND hospital_id=$2 AND revoked_at IS NULL', [u.id, r.to_hospital_id]))) {
      await this.db.q('INSERT INTO consents (patient_id, hospital_id, scope) VALUES ($1,$2,$3)', [u.id, r.to_hospital_id, 'Referral: visit summary and reports']);
    }
    await this.audit.log(u, { action: `REFERRAL_${status.toUpperCase()}`, patientId: u.id, hospitalId: r.to_hospital_id });
    return r;
  }

  /** Data rights (DPDP Act): export returns a copy now; erasure is recorded but medical records are kept under legal hold. */
  @Post('data-requests')
  async dataRequest(@CurrentUser() u: AuthUser, @Body() b: any) {
    const kind = oneOf(b.kind, 'Request', ['export', 'erasure', 'correction'] as const);
    if (kind === 'correction') {
      const r = await this.db.one(`INSERT INTO data_requests (patient_id, kind, status, note) VALUES ($1,'correction','Pending',$2) RETURNING *`, [u.id, str(b.note, 'What should be corrected', { optional: true, max: 500 }) || 'Correction or explanation requested']);
      await this.audit.log(u, { action: 'DATA_REQUEST_FILED', patientId: u.id, detail: 'correction' });
      return r;
    }
    if (kind === 'export') {
      const profile = await this.profile(u);
      const data = { exportedAt: new Date().toISOString(), profile, visits: await this.myVisits(u), drive: await this.drive(u), consents: await this.consents(u) };
      await this.db.q(`INSERT INTO data_requests (patient_id, kind, status) VALUES ($1,'export','Done')`, [u.id]);
      await this.audit.log(u, { action: 'DATA_EXPORTED', patientId: u.id });
      return data;
    }
    const r = await this.db.one(`INSERT INTO data_requests (patient_id, kind, status, note) VALUES ($1,'erasure','Refused (legal hold)',$2) RETURNING *`,
      [u.id, 'Medical records must be kept for the legally required period (NMC/IMC rules). Your account details can be removed after that period.']);
    await this.audit.log(u, { action: 'ERASURE_REQUESTED', patientId: u.id });
    return r;
  }
}
