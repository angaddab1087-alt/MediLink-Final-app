# MediLink API (base: `/api`)

All endpoints except those marked **public** need `Authorization: Bearer <token>`.

## Public
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/hospitals?q=&type=` | List / search hospitals |
| GET | `/hospitals/:id` | Hospital with departments, doctors, extra form fields |
| POST | `/qr/resolve` | Resolve a scanned hospital QR `{ code, lat?, lng? }` |
| POST | `/symptoms/route` | Suggest a department `{ text, bodyArea? }` (never a diagnosis) |
| GET | `/symptoms/body-areas` | Body picker areas |
| GET | `/emergency/nearby?lat=&lng=` | Nearest open emergency hospitals in 5/10/25/50 km rings |
| POST | `/emergency/inform` | Tell a MediLink hospital a patient is on the way |

## Auth
| POST | `/auth/signup` | `{ name, email, password, pin }` |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → token, or `{ needsPin, pinToken }` |
| POST | `/auth/pin` | `{ pinToken, pin }` → token |
| GET | `/auth/me` | Current user |
| POST | `/auth/desk` | Staff: choose today's desk `{ desk }` |

## Patient (`/me`, roles: patient, doctor)
`GET/PUT profile` · `POST verify` (mock Aadhaar/ABHA) · `POST visits` (register) · `GET visits` · `GET visits/:id` · `POST visits/:id/cancel` · `GET visit-qr` · `GET drive` · `GET files/:versionId` · `GET consents` · `POST consents/:id/revoke` · `GET access-history` · `GET notifications` · `POST notifications/read` · `GET referrals` · `POST referrals/:id/respond`

## Doctor (`/doctor`)
`GET status` · `POST clock-in {code}` · `POST clock-out` · `GET queue` · `POST scan {code}` · `POST visits/:id/status` · `POST visits/:id/prescription` · `POST visits/:id/tests` · `POST visits/:id/refer`

## Reception (`/reception`, staff at Reception desk)
`GET board` · `POST visits/:id/{approve|arrive|noshow|priority}` · `POST walk-in` · `GET lookup?q=` · `POST visits/:id/vitals` · `POST tests/:id/{book|checkin}`

## Diagnostics (`/diagnostics`, staff at a diagnostic desk)
`GET worklist` · `POST tests/:id/advance` · `POST tests/:id/send` · `POST documents/:id/correct`

## Incidents
`POST /incidents` (doctor, staff, admin)

## Admin (`/admin`)
`GET overview` · `GET/POST people` · `POST people/:id/active` · `POST people/:id/desks` · `GET doctors` · `POST doctors/:id/leave` · `GET audit` · `GET audit/verify` · `GET audit/export.csv` · `GET patients` · `POST patients/:id/record {reason}` · `GET incidents` · `POST incidents/:id/dismiss` · `GET/POST alerts` · `POST alerts/:id/{approve|lift}` · `GET tests` · `GET qr` · `POST qr/rotate`

## Demo mode (`DEMO_MODE=true` only)
`GET /demo/duty-qr` (doctor) · `GET /demo/patient-qr/:visitId` (doctor, own queue only) — return the signed codes a camera would read, so the prototype's simulated *Scan* buttons still go through the real checks.

## Patient data rights

| Method | Path | What it does |
|---|---|---|
| POST | `/me/data-requests` `{kind:"export"}` | Returns all of the patient's data as JSON and records the request. |
| POST | `/me/data-requests` `{kind:"erasure"}` | Records an erasure request; medical records stay under legal hold. |

## Hospital admin: support access and messages

| Method | Path | What it does |
|---|---|---|
| GET | `/admin/support-requests` | MediLink support access requests for this hospital (approved ones expire automatically). |
| POST | `/admin/support-requests/:id/approve` or `/reject` | Decide on a request. |
| GET | `/admin/notifications` | Messages for the admin (support requests, announcements). |
| GET | `/admin/data-requests` | Patients' data requests at this hospital. |

## Owner Console (`role: owner`, metadata only)

| Method | Path | What it does |
|---|---|---|
| GET | `/platform/overview` | Hospitals, patients, registrations today, reports sent, emergency searches, incidents, system status. |
| GET / POST | `/platform/hospitals` | List hospitals / add a hospital (creates departments, the first admin with a one-time password, and both signed QR codes). |
| GET | `/platform/hospitals/:id` | 14-day usage, storage, staff counts, admins, connector health, support requests. |
| POST | `/platform/hospitals/:id/status` `{status, reason}` | Suspend (blocks sign-in, booking and QR scans; keeps all data) or reactivate. |
| POST | `/platform/hospitals/:id/support-access` `{reason, hours}` | Ask the hospital admin for time-limited support access. |
| GET | `/platform/health` | API, database, file storage and integration status. |
| GET / PUT | `/platform/settings` | Quotas, retention and feature switches. |
| GET | `/platform/compliance` | Incidents with CERT-In 6-hour and DPDP 72-hour deadlines, data requests, consents, keys, audit chain. |
| POST | `/platform/incidents`, `/platform/incidents/:id/update` | Open an incident; mark CERT-In / Board reported, contained, closed. |
| GET | `/platform/audit`, `/platform/audit/verify` | Platform activity without patient details; verify the hash chain. |
| GET / POST | `/platform/announcements` | Messages to hospital admins and staff. |

## Stitched features

| Method | Path | Who | What it does |
|---|---|---|---|
| GET / POST | `/me/family` | Patient | Family members on the account; `memberId` on `POST /me/visits` books for one of them. |
| GET | `/me/follow-ups` | Patient | My follow-ups. |
| POST | `/doctor/visits/:id/follow-up` `{date, reason}` | Doctor | Set a follow-up. |
| POST | `/doctor/visits/:id/close-treatment` `{note}` | Doctor | Ask the admin to approve treatment completion. |
| GET / POST | `/doctor/closures`, `/doctor/closures/:id/ack` | Doctor | My completion requests and the admin's answers. |
| GET | `/reception/follow-ups` | Reception | Follow-up desk. |
| POST | `/reception/follow-ups/:id/checkin`, `/call`, `/missed`, `/reschedule {date}` | Reception | Check-in creates a priority token with the same doctor. |
| GET | `/reception/display` | Reception | Waiting-room screen (tokens only, no names). |
| GET / POST | `/admin/closures`, `/admin/closures/:id/approve` or `/return` | Admin | Approving puts a summary PDF in the patient's Drive. |
| GET | `/admin/follow-ups`, `/admin/test-orders` | Admin | Follow-up tracker; every test order with report versions. |
| POST | `/admin/people/:id/logout`, `/admin/people/:id/reset-password` | Admin | End all sessions; one-time password. |
| POST | `/admin/doctors/:id/bookings {open}`, `/admin/doctors/:id/department {department}` | Admin | Pause bookings; change department. |
| GET / PUT | `/admin/setup` | Admin | Slot length, walk-in share, grace, fee, custom fields, departments. |
| POST | `/admin/departments`, `/admin/departments/:id/active` | Admin | Add or (de)activate a department. |
| POST | `/admin/alerts/:id/renew`, `/admin/data-requests/:id/advance` | Admin | Renew an alert after review; move a data request on. |
