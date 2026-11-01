import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth';
import { notify } from '../common/notify';
import { routeSymptoms } from '../common/routing';
import { int } from '../common/dto';

export const ACTIVE = ['Requested', 'Approved', 'Arrived', 'Called', 'InConsultation'];

/** Arrival rule: a booked patient has GRACE_MINUTES (from booking) to scan the hospital QR. Miss it and the place is given up:
 *  people who are physically present (walk-ins, on-time patients) are served first, and a late patient re-joins behind them when they do arrive. */
export const GRACE_MINUTES = 30;
/** Booked, still not at the hospital, window over. */
export const lateSql = (a: string) => `(${a}.status IN ('Requested','Approved') AND ${a}.created_at < now() - interval '${GRACE_MINUTES} minutes')`;
/** The time a visit holds its place in the queue: booking time, or arrival time if they arrived after the window. */
export const placeSql = (a: string) => `(CASE WHEN ${a}.arrived_at IS NOT NULL AND ${a}.arrived_at - ${a}.created_at > interval '${GRACE_MINUTES} minutes' THEN ${a}.arrived_at ELSE ${a}.created_at END)`;

@Injectable()
export class VisitsService {
  constructor(private db: Db, private audit: AuditService) {}

  async activeAlert(patientId: number, hospitalId: number) {
    await this.db.q(`UPDATE conduct_alerts SET status='Expired' WHERE status='Active' AND review_date < CURRENT_DATE`);
    return this.db.one(`SELECT id, category FROM conduct_alerts WHERE patient_id=$1 AND hospital_id=$2 AND status='Active'`, [patientId, hospitalId]);
  }

  /** Picks a doctor. Auto mode: a General Physician first (who can refer to a specialist). */
  async pickDoctor(hospitalId: number, opts: { doctorId?: number; preferFemale?: boolean; department?: string }) {
    if (opts.doctorId) {
      const d = await this.db.one(
        `SELECT u.id, dp.department_id FROM users u JOIN doctor_profiles dp ON dp.user_id=u.id
         WHERE u.id=$1 AND dp.hospital_id=$2 AND u.active AND NOT dp.on_leave AND dp.bookings_open`, [opts.doctorId, hospitalId]);
      if (!d) throw new BadRequestException('This doctor is not taking bookings right now. Please choose another doctor.');
      return { doctorId: d.id, departmentId: d.department_id, femaleNote: null as string | null };
    }
    // Auto-assign: doctors of the department the symptoms point to; if none is available, a General Physician.
    const pool = (dept: string | null) => this.db.q(
      `SELECT u.id, dp.department_id, dp.gender,
              EXISTS (SELECT 1 FROM shifts s WHERE s.doctor_id=u.id AND s.clock_out IS NULL) AS on_duty,
              (SELECT count(*) FROM visits v WHERE v.doctor_id=u.id AND v.visit_date=CURRENT_DATE AND v.status = ANY($2)) AS load
       FROM users u JOIN doctor_profiles dp ON dp.user_id=u.id
       JOIN departments d ON d.id=dp.department_id
       WHERE dp.hospital_id=$1 AND u.active AND NOT dp.on_leave AND dp.bookings_open AND (($3::text IS NULL AND dp.is_gp) OR d.name=$3)
       ORDER BY on_duty DESC, load ASC, u.id`, [hospitalId, ACTIVE, dept]);
    let candidates = opts.department && opts.department !== 'General Physician' ? await pool(opts.department) : [];
    if (!candidates.length) candidates = await pool(null);
    if (!candidates.length) throw new BadRequestException('No General Physician is available at this hospital right now. Please choose a doctor.');
    let femaleNote: string | null = null;
    let pick = candidates[0];
    if (opts.preferFemale) {
      const f = candidates.find((c) => c.gender === 'Female');
      if (f) pick = f; else femaleNote = 'No female doctor is available in this department right now, so the next available doctor was assigned.';
    }
    return { doctorId: pick.id, departmentId: pick.department_id, femaleNote };
  }

  async nextToken(hospitalId: number, letter: string) {
    const r = await this.db.one(
      `INSERT INTO token_counters (hospital_id, day, last_no) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (hospital_id, day) DO UPDATE SET last_no = token_counters.last_no + 1 RETURNING last_no`, [hospitalId]);
    return `${letter}-${String(r.last_no).padStart(2, '0')}`;
  }

  async register(user: AuthUser, b: any) {
    const hospitalId = int(b.hospitalId, 'Hospital');
    const h = await this.db.one('SELECT id, name, status FROM hospitals WHERE id=$1 AND active AND on_medilink', [hospitalId]);
    if (!h) throw new BadRequestException('Hospital not found.');
    if (h.status !== 'active') throw new BadRequestException('This hospital is not taking MediLink registrations right now. Please go to the counter.');
    const symptoms = String(b.symptoms || '').trim();
    if (symptoms.length < 3 && !b.bodyArea) throw new BadRequestException('Please describe your symptoms or choose where it hurts.');
    // Booking for a family member: the member must belong to this account.
    let memberId: number | null = null;
    if (b.memberId) {
      memberId = int(b.memberId, 'Family member');
      if (!(await this.db.one('SELECT 1 FROM family_members WHERE id=$1 AND patient_id=$2', [memberId, user.id]))) throw new BadRequestException('This family member is not on your account.');
    }
    const route = routeSymptoms(symptoms, b.bodyArea);
    if (route.emergency) return { emergency: true, message: route.note, matched: route.matched };
    if (await this.activeAlert(user.id, hospitalId)) {
      throw new ForbiddenException('Please visit the hospital desk to book. Emergency care is always available.');
    }
    const existing = await this.db.one(`SELECT id, token_no FROM visits WHERE patient_id=$1 AND hospital_id=$2 AND visit_date=CURRENT_DATE AND status = ANY($3) AND member_id IS NOT DISTINCT FROM $4`, [user.id, hospitalId, ACTIVE, memberId]);
    if (existing) throw new BadRequestException(`${memberId ? 'This family member already has' : 'You already have'} token ${existing.token_no} at this hospital today.`);
    const mode = b.doctorId ? 'chosen' : 'auto';
    const pick = await this.pickDoctor(hospitalId, { doctorId: b.doctorId ? int(b.doctorId, 'Doctor') : undefined, preferFemale: !!b.preferFemale, department: route.department });
    const doc = await this.db.one('SELECT name FROM users WHERE id=$1', [pick.doctorId]);
    const token = await this.nextToken(hospitalId, (doc.name.replace(/^Dr\.?\s*/i, '')[0] || 'A').toUpperCase());
    const v = await this.db.one(
      `INSERT INTO visits (patient_id, hospital_id, doctor_id, department_id, token_no, symptoms, duration, severity, extra_answers, assignment, priority, member_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [user.id, hospitalId, pick.doctorId, pick.departmentId, token, symptoms || `Pain area: ${b.bodyArea}`, b.duration || null, b.severity || null,
        JSON.stringify(b.extraAnswers || {}), mode, !!b.priority, memberId]);
    if (!(await this.db.one('SELECT 1 FROM consents WHERE patient_id=$1 AND hospital_id=$2 AND revoked_at IS NULL', [user.id, hospitalId]))) {
      await this.db.q('INSERT INTO consents (patient_id, hospital_id) VALUES ($1,$2)', [user.id, hospitalId]);
    }
    await this.audit.log(user, { action: 'VISIT_REQUESTED', hospitalId, patientId: user.id, detail: `token ${token}` });
    await notify(this.db, user.id, `Token ${token} reserved`, `${h.name}: your request has been sent to reception.`);
    return { emergency: false, visit: v, suggestedDepartment: route.department, note: route.note, femaleNote: pick.femaleNote, doctorName: doc.name };
  }

  async detail(visitId: number) {
    const v = await this.db.one(
      `SELECT v.*, h.name AS hospital_name, u.name AS doctor_name, d.name AS department_name, p.full_name AS patient_name, fm.name AS member_name, fm.relation AS member_relation
       FROM visits v JOIN hospitals h ON h.id=v.hospital_id LEFT JOIN users u ON u.id=v.doctor_id LEFT JOIN family_members fm ON fm.id=v.member_id
       LEFT JOIN departments d ON d.id=v.department_id JOIN patient_profiles p ON p.user_id=v.patient_id WHERE v.id=$1`, [visitId]);
    if (!v) return null;
    // People ahead = those physically here (or still inside their window) who hold an earlier place. Late no-shows never block anyone.
    const mine = await this.db.one(`SELECT ${placeSql('v')} AS place, ${lateSql('v')} AS late FROM visits v WHERE v.id=$1`, [v.id]);
    const ahead = await this.db.one(
      `SELECT count(*)::int AS n FROM visits w WHERE w.doctor_id=$1 AND w.visit_date=$2 AND w.status IN ('Requested','Approved','Arrived')
         AND NOT ${lateSql('w')}
         AND (w.priority::int > $3::int OR (w.priority = $4 AND (${mine.late ? 'true' : 'false'} OR ${placeSql('w')} < $5::timestamptz))) AND w.id <> $6`,
      [v.doctor_id, v.visit_date, v.priority ? 1 : 0, v.priority, mine.place, v.id]);
    const graceMinutesLeft = ['Requested', 'Approved'].includes(v.status) ? Math.max(0, Math.ceil(GRACE_MINUTES - (Date.now() - new Date(v.created_at).getTime()) / 60000)) : null;
    const tests = await this.db.q('SELECT id, department, test_name, status, updated_at FROM test_orders WHERE visit_id=$1 ORDER BY id', [visitId]);
    return { ...v, ahead: ahead.n, estimatedWaitMinutes: ahead.n * 10, late: !!mine.late, graceMinutesLeft, graceMinutes: GRACE_MINUTES, tests };
  }
}
