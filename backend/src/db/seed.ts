import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { config } from '../config';
import { migrate } from './migrate';
import { ALL_CLINICAL, specialistsFor } from './specialists';

/**
 * Demo data. Every demo account uses the password  MediLink@2026  (and PIN 1234 where a PIN is asked).
 * Hospitals are real Mumbai hospitals with approximate real coordinates. All people are fictional.
 */
export const DEMO_PASSWORD = 'MediLink@2026';

const HOSPITALS = [
  { slug: 'kokilaben', name: 'Kokilaben Dhirubhai Ambani Hospital', address: 'Rao Saheb Achutrao Patwardhan Marg, Four Bungalows, Andheri West, Mumbai 400053', area: 'Andheri West', type: 'Private', phone: '+912230999999', lat: 19.1310, lng: 72.8253 },
  { slug: 'lilavati', name: 'Lilavati Hospital and Research Centre', address: 'A-791, Bandra Reclamation, Bandra West, Mumbai 400050', area: 'Bandra West', type: 'Trust', phone: '+912268658000', lat: 19.0510, lng: 72.8290 },
  { slug: 'nanavati', name: 'Nanavati Max Super Speciality Hospital', address: 'S.V. Road, Vile Parle West, Mumbai 400056', area: 'Vile Parle West', type: 'Private', phone: '+912226267500', lat: 19.0960, lng: 72.8400 },
  { slug: 'hinduja', name: 'P. D. Hinduja Hospital', address: 'Veer Savarkar Marg, Mahim West, Mumbai 400016', area: 'Mahim', type: 'Private', phone: '+912224452222', lat: 19.0333, lng: 72.8389 },
  { slug: 'kem', name: 'KEM Hospital (King Edward Memorial)', address: 'Acharya Donde Marg, Parel, Mumbai 400012', area: 'Parel', type: 'Government', phone: '+912224107000', lat: 19.0025, lng: 72.8420 },
];
// Emergency-capable hospitals that are not on MediLink (shown in the Emergency finder with a "Call hospital" button).
const OTHER_EMERGENCY = [
  { slug: 'sion', name: 'Lokmanya Tilak Municipal General Hospital (Sion)', address: 'Sion West, Mumbai 400022', area: 'Sion', type: 'Government', phone: '+912224076381', lat: 19.0390, lng: 72.8610 },
  { slug: 'cooper', name: 'Dr. R. N. Cooper Municipal General Hospital', address: 'Juhu, Vile Parle West, Mumbai 400056', area: 'Juhu', type: 'Government', phone: '+912226207254', lat: 19.1070, lng: 72.8370 },
  { slug: 'bhabha', name: 'Bhabha Municipal Hospital', address: 'Bandra West, Mumbai 400050', area: 'Bandra West', type: 'Government', phone: '+912226422775', lat: 19.0558, lng: 72.8342 },
  { slug: 'shatabdi', name: 'Shatabdi Hospital (Kandivali)', address: 'Kandivali West, Mumbai 400067', area: 'Kandivali', type: 'Government', phone: '+912228052100', lat: 19.2050, lng: 72.8450 },
];
const DOCTOR_FULL_NAMES: Record<string, string> = {
  A: 'Dr. Arvind Raman', B: 'Dr. Anaya Kapoor', C: 'Dr. Chirag Mehta', D: 'Dr. Divya Sharma', E: 'Dr. Eshwar Nair',
  F: 'Dr. Farhan Shaikh', G: 'Dr. Gayatri Joshi', H: 'Dr. Harish Rao', I: 'Dr. Isha Kulkarni', J: 'Dr. Jayant Deshmukh',
  K: 'Dr. Meera Deshmukh', L: 'Dr. Laxman Patil', M: 'Dr. Manish Gupta', N: 'Dr. Nitin Agarwal', O: 'Dr. Omkar Bhatt',
  P: 'Dr. Priya Sen', Q: 'Dr. Qasim Khan', R: 'Dr. Rakesh Verma', S: 'Dr. Sunita Rao', T: 'Dr. Tanvi Shah',
  U: 'Dr. Uday Hegde', V: 'Dr. Vandana Pillai', W: 'Dr. Wasim Akram', X: "Dr. Xavier D'Souza", Y: 'Dr. Yashodhara Rane',
};

// Matches the prototype exactly: each hospital has General Physician, Orthopaedics, Cardiology, Paediatrics and one more.
const FIFTH_DEPTS = ['Gynaecology', 'ENT', 'Dermatology', 'Dental', 'Ophthalmology'];
const DIAGNOSTIC = ['Radiology', 'Pathology/Blood Tests', 'Cardiology Diagnostics'];

export async function seed(pool: Pool) {
  const exists = await pool.query('SELECT 1 FROM hospitals LIMIT 1');
  if (exists.rows.length) { console.log('Seed data already present - skipping.'); return; }
  const pw = await bcrypt.hash(DEMO_PASSWORD, 10);
  const pin = await bcrypt.hash('1234', 10);
  const extra = JSON.stringify([{ key: 'mobility', label: 'Do you need a wheelchair?', type: 'yesno' }, { key: 'language', label: 'Preferred language', type: 'select', options: ['English', 'हिंदी', 'मराठी'] }]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let letter = 0;
    for (const [hIdx, h] of HOSPITALS.entries()) {
      const CLINICAL = ['General Physician', 'Orthopaedics', 'Cardiology', 'Paediatrics', FIFTH_DEPTS[hIdx]];
      const hr = await c.query(`INSERT INTO hospitals (slug, name, address, area, type, phone, lat, lng, extra_fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [h.slug, h.name, h.address, h.area, h.type, h.phone, h.lat, h.lng, extra]);
      const hid = hr.rows[0].id;
      const dept: Record<string, number> = {};
      for (const d of ALL_CLINICAL) dept[d] = (await c.query(`INSERT INTO departments (hospital_id, name, kind) VALUES ($1,$2,'clinical') RETURNING id`, [hid, d])).rows[0].id;
      for (const d of DIAGNOSTIC) await c.query(`INSERT INTO departments (hospital_id, name, kind) VALUES ($1,$2,'diagnostic')`, [hid, d]);
      // 25 demo doctors, Dr. A to Dr. Y, five per hospital - same names, departments and genders as the prototype.
      for (const [i, dname] of CLINICAL.entries()) {
        const gender = (hIdx + i) % 2 === 1 ? 'Female' : 'Male';
        const L = String.fromCharCode(65 + letter++);
        const fullName = DOCTOR_FULL_NAMES[L] || `Dr. ${L}`;
        const u = await c.query(`INSERT INTO users (email, password_hash, pin_hash, role, name, hospital_id) VALUES ($1,$2,$3,'doctor',$4,$5) RETURNING id`,
          [`dr${L}.${h.slug}@gmail.com`.toLowerCase(), pw, pin, fullName, hid]);
        await c.query(`INSERT INTO doctor_profiles (user_id, hospital_id, department_id, registration_no, gender, is_gp) VALUES ($1,$2,$3,$4,$5,$6)`,
          [u.rows[0].id, hid, dept[dname], `MMC-201${hIdx}-${100 + i} (Demo)`, gender, dname === 'General Physician']);
      }
      for (const sp of specialistsFor(h.slug, hIdx, CLINICAL)) {
        const u = await c.query(`INSERT INTO users (email, password_hash, pin_hash, role, name, hospital_id) VALUES ($1,$2,$3,'doctor',$4,$5) RETURNING id`, [sp.email, pw, pin, sp.name, hid]);
        await c.query(`INSERT INTO doctor_profiles (user_id, hospital_id, department_id, registration_no, gender, is_gp) VALUES ($1,$2,$3,$4,$5,$6)`,
          [u.rows[0].id, hid, dept[sp.department], sp.reg, sp.gender, sp.department === 'General Physician']);
      }
      const staff: [string, string, string[]][] = [
        ['reception', 'Reception Desk', ['Reception']], ['radiology', 'Radiology Desk', ['Radiology']],
        ['pathology', 'Pathology Desk', ['Pathology/Blood Tests']], ['staff', 'Staff (all desks)', ['Reception', 'Radiology', 'Pathology/Blood Tests']],
      ];
      for (const [prefix, name, desks] of staff) {
        const u = await c.query(`INSERT INTO users (email, password_hash, role, name, hospital_id) VALUES ($1,$2,'staff',$3,$4) RETURNING id`, [`${prefix}.${h.slug}@gmail.com`, pw, `${name} (${h.area})`, hid]);
        for (const d of desks) await c.query('INSERT INTO staff_desks (user_id, desk) VALUES ($1,$2)', [u.rows[0].id, d]);
      }
      await c.query(`INSERT INTO users (email, password_hash, role, name, hospital_id) VALUES ($1,$2,'admin',$3,$4)`, [`admin.${h.slug}@gmail.com`, pw, `Admin (${h.area})`, hid]);
    }
    for (const h of OTHER_EMERGENCY) {
      await c.query(`INSERT INTO hospitals (slug, name, address, area, type, phone, lat, lng, on_medilink) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)`, [h.slug, h.name, h.address, h.area, h.type, h.phone, h.lat, h.lng]);
    }
    await c.query(`INSERT INTO users (email, password_hash, role, name) VALUES ('owner.medilink@gmail.com',$1,'owner','MediLink Platform Owner')`, [pw]);
    await c.query(`UPDATE users SET pin_hash=$1 WHERE email='owner.medilink@gmail.com'`, [pin]);

    // Demo patients
    const patients = [
      ['aarav@demo.in', 'Aarav Sharma', '1982-03-14', 'Male', '+919820144120', 'O+', ['Penicillin', 'Sulfa drugs']],
      ['meera@demo.in', 'Meera Nair', '1990-07-22', 'Female', '+919820155330', 'B+', []],
      ['rohan@demo.in', 'Rohan Kulkarni', '1975-11-02', 'Male', '+919820166440', 'A+', ['Dust']],
    ] as const;
    const pids: number[] = [];
    for (const [email, name, dob, sex, phone, bg, allergies] of patients) {
      const u = await c.query(`INSERT INTO users (email, password_hash, pin_hash, role, name) VALUES ($1,$2,$3,'patient',$4) RETURNING id`, [email, pw, pin, name]);
      const id = u.rows[0].id; pids.push(id);
      await c.query(`INSERT INTO patient_profiles (user_id, medilink_id, full_name, dob, sex, phone, address, blood_group, emergency_contact_name, emergency_contact_phone, allergies, declaration_at, abha_linked, aadhaar_verified)
        VALUES ($1,$2,$3,$4,$5,$6,'Andheri West, Mumbai',$7,'Family contact','+919820199000',$8, now(), TRUE, TRUE)`,
        [id, 'ML-' + String(100000 + id).slice(-6), name, dob, sex, phone, bg, allergies]);
    }
    // A test order waiting at Kokilaben Radiology, and one incident report, so every desk has something to show.
    const kokila = 1;
    const drA = (await c.query(`SELECT id FROM users WHERE email='dra.kokilaben@gmail.com'`)).rows[0].id;
    const gp = (await c.query(`SELECT department_id FROM doctor_profiles WHERE user_id=$1`, [drA])).rows[0].department_id;
    const v = await c.query(`INSERT INTO visits (patient_id, hospital_id, doctor_id, department_id, token_no, symptoms, assignment, status, visit_date, completed_at)
      VALUES ($1,$2,$3,$4,'A-01','Knee pain while climbing stairs for 2 weeks','auto','Completed', CURRENT_DATE - 1, now() - interval '1 day') RETURNING id`, [pids[2], kokila, drA, gp]);
    await c.query(`INSERT INTO consents (patient_id, hospital_id) VALUES ($1,$2)`, [pids[2], kokila]);
    await c.query(`INSERT INTO prescriptions (visit_id, patient_id, doctor_id, text, follow_up) VALUES ($1,$2,$3,'Tab. Paracetamol 500 mg - 1 tablet twice a day after food for 5 days. Knee exercises as shown.','Review in 2 weeks with X-ray')`, [v.rows[0].id, pids[2], drA]);
    await c.query(`INSERT INTO test_orders (visit_id, patient_id, hospital_id, department, test_name, status, advised_by) VALUES ($1,$2,$3,'Radiology','X-ray Left Knee (AP/Lateral)','CheckedIn',$4)`, [v.rows[0].id, pids[2], kokila, drA]);
    const rec = (await c.query(`SELECT id FROM users WHERE email='reception.kokilaben@gmail.com'`)).rows[0].id;
    await c.query(`INSERT INTO incident_reports (patient_id, hospital_id, category, happened_on, place, note, reported_by) VALUES ($1,$2,'Abusive language', CURRENT_DATE - 3, 'OPD reception', 'Patient shouted abuse at reception staff after being told the doctor was running late.', $3)`, [pids[2], kokila, rec]);
    // Follow-ups at Kokilaben (overdue, today, upcoming) and one family member, so the follow-up desk and "Someone else" have real data.
    await c.query(`INSERT INTO follow_ups (hospital_id, patient_id, visit_id, doctor_id, due_date, reason) VALUES
      ($1,$2,$3,$4, CURRENT_DATE - 1, 'BP recheck after medication change'),
      ($1,$2,$3,$4, CURRENT_DATE, 'Knee X-ray review'),
      ($1,$5,NULL,$4, CURRENT_DATE + 4, 'Review blood test results')`, [kokila, pids[2], v.rows[0].id, drA, pids[0]]);
    await c.query(`INSERT INTO family_members (patient_id, name, relation, dob, sex) VALUES ($1,'Meera Sharma','Parent','1955-08-02','Female')`, [pids[0]]);
    await c.query('COMMIT');
    console.log(`Seed complete. Demo password for every account: ${DEMO_PASSWORD} (PIN 1234).`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

if (require.main === module) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  migrate(pool).then(() => seed(pool)).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
