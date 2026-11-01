-- MediLink database schema (PostgreSQL 14+)

CREATE TABLE IF NOT EXISTS hospitals (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  area TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Government','Private','Trust')),
  phone TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  has_emergency BOOLEAN NOT NULL DEFAULT TRUE,
  on_medilink BOOLEAN NOT NULL DEFAULT TRUE,
  qr_version INT NOT NULL DEFAULT 1,
  extra_fields JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('clinical','diagnostic')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (hospital_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('patient','doctor','staff','admin','owner')),
  name TEXT NOT NULL,
  hospital_id INT REFERENCES hospitals(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id INT PRIMARY KEY REFERENCES users(id),
  medilink_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  dob DATE,
  sex TEXT,
  phone TEXT,
  address TEXT,
  blood_group TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  allergies TEXT[] NOT NULL DEFAULT '{}',
  insurance JSONB,
  abha_linked BOOLEAN NOT NULL DEFAULT FALSE,
  aadhaar_verified BOOLEAN NOT NULL DEFAULT FALSE,
  declaration_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id INT PRIMARY KEY REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  department_id INT NOT NULL REFERENCES departments(id),
  registration_no TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('Male','Female','Other')),
  on_leave BOOLEAN NOT NULL DEFAULT FALSE,
  is_gp BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  doctor_id INT NOT NULL REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  clock_in TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS staff_desks (
  user_id INT NOT NULL REFERENCES users(id),
  desk TEXT NOT NULL,            -- 'Reception' or a diagnostic department name
  PRIMARY KEY (user_id, desk)
);

CREATE TABLE IF NOT EXISTS visits (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  doctor_id INT REFERENCES users(id),
  department_id INT REFERENCES departments(id),
  token_no TEXT NOT NULL,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  symptoms TEXT NOT NULL,
  duration TEXT,
  severity TEXT,
  extra_answers JSONB NOT NULL DEFAULT '{}',
  assignment TEXT NOT NULL CHECK (assignment IN ('auto','chosen')),
  priority BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'Requested'
    CHECK (status IN ('Requested','Approved','Arrived','Called','InConsultation','Completed','NoShow','Referred','Cancelled')),
  emergency BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS visits_queue_idx ON visits (hospital_id, visit_date, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS token_counters (
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  day DATE NOT NULL,
  last_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY (hospital_id, day)
);

CREATE TABLE IF NOT EXISTS consents (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  scope TEXT NOT NULL DEFAULT 'Profile, allergies, visits, prescriptions, reports',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id SERIAL PRIMARY KEY,
  visit_id INT NOT NULL REFERENCES visits(id),
  patient_id INT NOT NULL REFERENCES users(id),
  doctor_id INT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  follow_up TEXT,
  supersedes INT REFERENCES prescriptions(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_orders (
  id SERIAL PRIMARY KEY,
  visit_id INT NOT NULL REFERENCES visits(id),
  patient_id INT NOT NULL REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  department TEXT NOT NULL,
  test_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Advised'
    CHECK (status IN ('Advised','Booked','CheckedIn','SampleCollected','ReportReady','Sent','Cancelled')),
  advised_by INT REFERENCES users(id),
  booked_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  hospital_id INT REFERENCES hospitals(id),
  test_order_id INT REFERENCES test_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('report','prescription','upload')),
  department TEXT,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_versions (
  id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id),
  version INT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  reason TEXT,
  critical_note TEXT,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  visit_id INT NOT NULL REFERENCES visits(id),
  patient_id INT NOT NULL REFERENCES users(id),
  from_doctor INT NOT NULL REFERENCES users(id),
  to_hospital_id INT NOT NULL REFERENCES hospitals(id),
  to_department TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed','Accepted','Declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id SERIAL PRIMARY KEY,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  name TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  eta_minutes INT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_reports (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  category TEXT NOT NULL,
  happened_on DATE NOT NULL,
  place TEXT,
  note TEXT NOT NULL,
  witness TEXT,
  reported_by INT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Dismissed','UsedInAlert')),
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conduct_alerts (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  review_date DATE NOT NULL,
  set_by INT NOT NULL REFERENCES users(id),
  approved_by INT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PendingApproval' CHECK (status IN ('PendingApproval','Active','Lifted','Expired')),
  lifted_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id INT,
  role TEXT,
  desk TEXT,
  hospital_id INT,
  patient_id INT,
  action TEXT NOT NULL,
  detail TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

-- Permanent records: clinical rows and audit entries can never be updated or deleted.
CREATE OR REPLACE FUNCTION medilink_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MediLink: % on % is not allowed (permanent record). Create a new version instead.', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescriptions','document_versions','audit_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION medilink_reject_change()', t, t);
  END LOOP;
END $$;

-- Incident reports may change status, but their facts can never be edited and rows never deleted.
CREATE OR REPLACE FUNCTION medilink_incident_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MediLink: incident reports cannot be deleted'; END IF;
  IF NEW.note <> OLD.note OR NEW.category <> OLD.category OR NEW.patient_id <> OLD.patient_id THEN
    RAISE EXCEPTION 'MediLink: incident report facts cannot be edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS incident_guard ON incident_reports;
CREATE TRIGGER incident_guard BEFORE UPDATE OR DELETE ON incident_reports FOR EACH ROW EXECUTE FUNCTION medilink_incident_guard();

-- ---------- Platform owner (MediLink company) ----------
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS connector_mode TEXT NOT NULL DEFAULT 'MediLink Lite';
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'Standard';
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hospitals DROP CONSTRAINT IF EXISTS hospitals_status_check;
ALTER TABLE hospitals ADD CONSTRAINT hospitals_status_check CHECK (status IN ('active','suspended'));

CREATE TABLE IF NOT EXISTS emergency_searches (
  id SERIAL PRIMARY KEY,
  ring_km INT,
  results INT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Low','Medium','High','Critical')),
  personal_data BOOLEAN NOT NULL DEFAULT FALSE,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  certin_reported_at TIMESTAMPTZ,
  dpb_reported_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Contained','Closed')),
  created_by INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS support_access_grants (
  id SERIAL PRIMARY KEY,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  requested_by INT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  hours INT NOT NULL CHECK (hours BETWEEN 1 AND 72),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Expired')),
  approved_by INT REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  hospital_id INT REFERENCES hospitals(id),
  sent_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_requests (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('export','erasure')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Done','Refused (legal hold)')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_hospital_idx ON audit_log (hospital_id, id DESC);
CREATE INDEX IF NOT EXISTS visits_patient_idx ON visits (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS visits_doctor_day_idx ON visits (doctor_id, visit_date, status);
CREATE INDEX IF NOT EXISTS test_orders_hosp_idx ON test_orders (hospital_id, department, status);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC);

-- ---------- Stitching: follow-ups, treatment completion, family, sessions, hospital setup ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bookings_open BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{"slotMinutes":15,"walkInSharePct":30,"graceMinutes":15,"fee":500}';

CREATE TABLE IF NOT EXISTS family_members (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  dob DATE,
  sex TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS member_id INT REFERENCES family_members(id);

CREATE TABLE IF NOT EXISTS follow_ups (
  id SERIAL PRIMARY KEY,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  patient_id INT NOT NULL REFERENCES users(id),
  member_id INT REFERENCES family_members(id),
  visit_id INT REFERENCES visits(id),
  doctor_id INT NOT NULL REFERENCES users(id),
  due_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Checked in','Missed','Cancelled')),
  call_attempts INT NOT NULL DEFAULT 0,
  rescheduled INT NOT NULL DEFAULT 0,
  checkin_visit_id INT REFERENCES visits(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follow_ups_hosp_idx ON follow_ups (hospital_id, status, due_date);

CREATE TABLE IF NOT EXISTS closures (
  id SERIAL PRIMARY KEY,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  visit_id INT NOT NULL REFERENCES visits(id),
  patient_id INT NOT NULL REFERENCES users(id),
  doctor_id INT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending approval' CHECK (status IN ('Pending approval','Approved','Returned to doctor')),
  decided_by INT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS data_requests_status_check;
ALTER TABLE data_requests ADD CONSTRAINT data_requests_status_check CHECK (status IN ('Pending','In review','Done','Refused (legal hold)'));
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS data_requests_kind_check;
ALTER TABLE data_requests ADD CONSTRAINT data_requests_kind_check CHECK (kind IN ('export','erasure','correction'));
ALTER TABLE test_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
