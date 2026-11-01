# MediLink

**One-profile hospital registration, referral and emergency access platform for India.**
A patient registers once; the same profile works at every MediLink hospital. Scan the hospital QR, confirm, describe symptoms, get a doctor and a token, and follow the visit live. Doctors open records only by scanning the patient's rotating QR. Reception and Diagnostics work from separate desks. A no-login **Emergency** button finds the nearest open emergency hospital and opens 112 / 108.

T.Y.B.Sc. Computer Science project — Angad Dabholkar, ZSCT's Thakur Shyamnarayan Degree College, 2026–27.

---

## What is inside

| Folder | What it is |
|---|---|
| `backend/` | API — **NestJS + TypeScript + PostgreSQL**. Auth, roles and desks, hospitals, QR codes, symptom routing, tokens and queue, doctor mode, test orders, report upload with versions, referrals, consents, admin panel, conduct alerts, hash-chained audit log. |
| `frontend/www/index.html` | The app UI — **your original MediLink prototype, unchanged** (every screen, colour, font and animation). |
| `frontend/www/medilink-live.js` | Connector part 1: log in, sign-up, tokens, reception, doctor mode, layout. Links the prototype's screens to the real API. If the server is offline, the prototype keeps working with its demo data. |
| `frontend/www/medilink-sync.js` | Connector part 2: test orders, Diagnostics desks, report sending and corrections, patient Drive, hospital admin KPIs, people and audit. |
| `frontend/www/medilink-device.js` | Device features: real location for Emergency (nearest hospitals and road routes from OpenStreetMap), camera QR scanning, voice-to-text, the checked 8-step sign-up, doctors for all ten departments, and the demo **view switcher** (the ⇄ button beside the read-aloud button; remove before release). |
| `frontend/www/medilink-stitch.js` | Connector part 3: family members, follow-ups, treatment completion, consents, referrals, profile edit, reception follow-up desk, lookup, vitals, waiting display, every admin tab, and one set of rules for the Back button (on screen, browser and Android). |
| `frontend/www/medilink-owner.js` | The **MediLink Owner Console** (company team), built from the prototype's own admin-panel styles. |
| `frontend/android/` | **Capacitor** Android project (builds the APK). |
| `.github/workflows/` | `android-apk.yml` builds the APK on GitHub; `ci.yml` runs all tests on every push. |
| `docker-compose.yml` | Runs database + API + app with one command. |
| `docs/` | Run guide, API list, architecture, security (the 20-point pre-release list), compliance, design decisions. |

## Run it — option A: Docker (easiest)

Needs Docker Desktop.

```bash
docker compose up --build
```

Open **http://localhost:5173** (app) — API is at http://localhost:4000/api. The first start creates the tables and demo data.

## Run it — option B: without Docker

Needs **Node.js 20+** and **PostgreSQL 14+**.

```bash
# 1. Create the database (once)
psql -U postgres -c "CREATE USER medilink WITH PASSWORD 'medilink';"
psql -U postgres -c "CREATE DATABASE medilink OWNER medilink;"

# 2. Backend
cd backend
cp .env.example .env          # edit DATABASE_URL if your Postgres is different
npm install
npm run db:setup              # builds, creates tables, loads demo data
npm start                     # API on http://localhost:4000/api

# 3. App (new terminal)
cd frontend
npm install
npm run dev                   # app on http://localhost:5173 (computers show a phone-width column; phones fill the screen)
```

## Demo accounts

Password for every account: **MediLink@2026** · PIN (patients, doctors and owner): **1234**

| Role | Email |
|---|---|
| Patient | `aarav@demo.in` (also `meera@demo.in`, `rohan@demo.in`) |
| Doctor | `drA.kokilaben@gmail.com` … `drY.kem@gmail.com` (Dr. A to Dr. Y), plus specialists so every hospital has all ten departments, e.g. `dr.priya.kokilaben@gmail.com` (Dermatology) |
| Reception desk | `reception.kokilaben@gmail.com` |
| Radiology desk | `radiology.kokilaben@gmail.com` |
| Pathology desk | `pathology.kokilaben@gmail.com` |
| Staff view (desk chooser: Reception, Radiology, Pathology) | `staff.kokilaben@gmail.com` |
| Hospital admin | `admin.kokilaben@gmail.com` |
| MediLink owner (company console) | `owner.medilink@gmail.com` |

Hospital slugs: `kokilaben`, `lilavati`, `nanavati`, `hinduja`, `kem`.

## Try the full flow (5 minutes)

1. **Patient** — Log in (`aarav@demo.in`, PIN 1234) → find a hospital or scan its QR → describe symptoms → book. The token number on *Token Reserved* comes from the server.
2. **Reception** — Log in as `reception.kokilaben@gmail.com` → the new token appears on the arrivals board → *Check in*.
3. **Doctor** — Log in as the doctor on the token (e.g. `drA.kokilaben@gmail.com`) → *Clock in* → *Scan patient QR* → in *Tests* choose *Chest X-ray* → *Advise* → type a prescription → finish.
4. **Reception again** — the advised test appears under tests to book → *Book* → *Check in*.
5. **Radiology** — Log in as `staff.kokilaben@gmail.com` → choose *Radiology* → *Scan done* → *Report ready* → *Send report* → pick a file (or *use a sample file*) → *Send*. Then *Correct* it with a reason: version 2 is added, version 1 stays.
6. **Patient again** — *Drive* shows the prescription and both report versions; opening one downloads the real file from the server.
7. **Admin** — `admin.kokilaben@gmail.com` → Overview shows live counts; *Activity & audit* lists the server's log and *Verify integrity* checks its hash chain; *Requests* shows MediLink support access requests to approve or reject.
8. **Owner** — `owner.medilink@gmail.com` (PIN 1234) → Owner Console: platform numbers, *Hospitals* → *Add hospital* (prints the hospital and duty QR codes and a one-time admin password), suspend/reactivate, hospital usage and connector health, ask for support access, system health, settings, compliance (CERT-In 6-hour and DPDP 72-hour clocks), audit and announcements. It never shows patient records.

This is the final app layout: no demo workspace bar, no phone mockup and no fake status bar. On a phone the app fills the screen; on a computer it shows the same phone-shaped layout as a centred column; the Admin panel uses the full width. Staff and Admin log out with the button at the top right; patients and doctors log out from Profile.

### What is live

Every screen reads from and writes to the server. Nothing a user does is kept only in the browser.

| Role | Live from the server |
|---|---|
| Patient | Sign-up, log in with PIN, family members ("Someone else"), token booking for self or a family member, live queue, real rotating QR, notifications, Drive (prescriptions, report versions, treatment summaries), follow-ups, consents (withdraw) and access history, referrals (accept, decline, get a token), profile edit, data requests |
| Doctor | Duty QR clock-in, live queue (with family members' names), QR-checked record, prescription, test advice, follow-up, treatment completion (and the admin's answer), referral to another hospital, incident report, notifications |
| Reception | Arrivals and check-in, follow-up desk (check in creates a token, call log, reschedule, missed), test booking and check-in, patient lookup, vitals, waiting-room display, incident report, emergency arrivals |
| Radiology / Pathology / Cardiology | Worklist, scan done, report ready, send, corrections |
| Hospital admin | Overview, people (desks, deactivate, end sessions, one-time password, new accounts), doctors (leave, pause bookings, department), patients (reason-gated record), conduct alerts (dismiss, place, approve, lift, renew), tests and reports, setup (fees, slots, departments, custom fields, QR rotation), reports, data requests, treatment approvals, follow-up tracker, audit and verification, support requests |
| MediLink owner | Every Owner Console tab |

Kept on purpose as demo-only: the admin's "Demo clock: skip 91 days" button and "Demo: hospital deletes its own copy" (they show how expiry and record retention behave). ABDM, DigiLocker, SMS and payments are simulated (see below).

### Back button

The on-screen Back button, the browser's Back button and Android's back gesture follow the same rules: Back goes to the screen you came from, never back into login, sign-up, payment, the scanner or a finished booking. Bottom-bar tabs go back to Home, Home is the end of the line (Android then leaves the app), and an open sheet or dialog closes first.

## Get the Android APK

You do not need Android Studio. Push this repo to GitHub, then:

**GitHub → your repo → Actions → "Build Android APK" → the latest run → Artifacts → `MediLink-apk`** (download, unzip, install `MediLink.apk` on the phone).

On the phone, open **Log in** and tap the **Server:** line under the button and enter your computer's Wi-Fi address, e.g. `http://192.168.1.5:4000/api` (phone and computer on the same Wi-Fi, backend running). The Android emulator can use the default `http://10.0.2.2:4000/api`.

To build it yourself instead: `cd frontend && npm install && npm run android:sync && cd android && ./gradlew assembleDebug` (needs JDK 17 and the Android SDK). The APK appears at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

## Tests

```bash
cd backend
npm test                              # unit tests: routing, QR signing, distance
node scripts/smoke-test.mjs           # 83 end-to-end checks against the running API
node scripts/security-test.mjs        # 35 attack tests (wait one minute after the smoke test: rate limits)
npm audit --omit=dev                  # known vulnerabilities in what ships: 0
```

The smoke test covers sign-up, QR resolution, red-flag routing, registration, reception, doctor clock-in and QR scan, prescriptions, test booking, report upload (and rejecting disguised files), versioned corrections, admin audit verification, reason-gated admin access, conduct-alert safety and the Owner Console. The security test tries tampered tokens, role and desk bypass, other patients' data (IDOR), other hospitals' data, SQL injection, oversized and malformed input, forged QR codes, leaked password hashes or stack traces, and brute-force login (blocked by rate limiting). See `docs/SECURITY.md`.

## Design rules built into the code

- **No diagnosis.** Symptom routing is a rule-based keyword index (English, Hindi, Marathi) that suggests one department; red-flag words send the patient to Emergency.
- **Records are permanent.** Database triggers block `UPDATE`/`DELETE` on prescriptions, report versions and the audit log. Corrections are new versions with a reason.
- **Tamper-evident audit.** Every action is chained with SHA-256; *Verify integrity* re-computes the chain.
- **Signed, rotating QR codes.** Hospital and duty QRs are HMAC-signed and can be rotated; the patient's visit QR changes every 30 seconds, so a screenshot will not work.
- **Separate desks.** Reception never sees clinical documents; Diagnostics sees only its own department. Enforced on the server, not just hidden in the UI.
- **Fair conduct alerts.** Need an incident report and an admin decision (second admin when there is more than one), expire at a review date, apply to one hospital only, and never block Emergency, treatment or the patient's own records.
- **Privacy.** Consent per hospital (revocable), access history visible to the patient, raw Aadhaar numbers never stored.

## Simulated parts (demo mode)

ABDM/ABHA, DigiLocker, SMS, payments and NHCX insurance are **simulated** (they need government sandbox approval). The prototype's *Scan* buttons simulate the camera: with `DEMO_MODE=true` the server hands the app the same signed code a camera would read, so all real checks still run. Set `DEMO_MODE=false` in production. Maps use OpenStreetMap; "Navigate" opens Google Maps. The structure is ready for the real services.

See `docs/RUN_GUIDE.md` for troubleshooting and `docs/API.md` for every endpoint.

## Phone features

- **Location:** Emergency uses the phone's real location (GPS in the Android app, the browser's location elsewhere), finds hospitals around you from MediLink and OpenStreetMap (widening 5, 10, 25 and 50 km), ranks the closest by real driving time (OSRM) and draws the road route. *Navigate* opens Google Maps from where you are. Browsers only share location on https or localhost.
- **Camera:** Scan buttons open the real camera (permission is asked) and read the QR. The patient's token shows the real QR that changes every 30 seconds. On a laptop with no QR to point at, tap *Use demo code* (demo mode only).
- **Voice:** the mic button types what you say (English, Hindi or Marathi). Works in Chrome and in the Android app.
- **Sign-up:** empty fields, checks on every step (email, Indian mobile, strong password, matching PIN, Aadhaar/ABHA format, PIN code, date of birth), *Use my current location* for the address, and a summary of your answers.

## Changelog

### v1.7.0
- Reception patient search: each result starts with MediLink ID, patient name and the hospital's ID for today's visit (the token). Search also matches that token. Server returns `today_token` from `/reception/lookup`.
- Symptom "analysing" screen shortened to about 1.3 seconds.

### v1.6.0
- Registration symptom step: the long body-part list is replaced by ONE drop-down of common symptoms, or the patient describes it in their own words (English, Hindi, Marathi). One of the two is required; Next does nothing until then.
- New "Analysing your symptoms" screen before the department suggestion; red-flag words (English, Hindi, Marathi) go straight to Emergency.
- A signed-in patient can no longer get a locally invented specialist token (it vanished on the next server refresh). Referral tokens come from the server only.
- After a consultation, the patient's Home and Flow show the follow-up the doctor set.

### v1.5.0
- Arrival rule: a booked patient has 30 minutes (from booking) to scan the hospital QR. After that the place is given up: patients who are present are seen first, and a late patient joins behind them on arrival. Enforced on the server (queue order, "patients ahead", doctor queue, reception board); the patient sees a countdown, a warning popup at 5 minutes left, and a "place given up" notice. Change `GRACE_MINUTES` in `visits.service.ts` (and in `index.html`) to tune it.
- Flow wording: "1 patient ahead", "You are next"; countdown refreshes every 20s.

### v1.4.0
- Patient Flow follows the real stages: Waiting -> Called (doctor presses "Call patient") -> In consultation (doctor scans the QR) -> Completed. A finished visit stays on Flow as "Completed" for the day instead of vanishing.
- Doctor off duty: confirmation dialog, stays signed in, can use MediLink as a patient; going back on duty always requires scanning the desk QR.
- `npm run db:reset-demo -- --yes` (backend) wipes every record, account and upload and reloads only the demo data. In Docker: `docker compose exec api npm run db:reset-demo -- --yes`.

### v1.3.0
- Popups and toasts are always the topmost layer (above the sidebar and the top-right buttons); toasts are centred instead of full-width.
- Sidebar: rounded on every corner (hidden scrollbar was clipping the bottom), gold glow and accents replaced with the app's teal.
- Animated queue popups: checked in, almost your turn (2 or fewer ahead), token called, consultation started.
- Reception refreshes every 5s and pops up when a new patient arrives; patient Home/Flow refresh every 5s.

### v1.2.0
- One source of truth for the patient's visit: Home, Flow, token, help sheet and the scanned flag all derive from the visit list. Flow no longer asks you to scan when you already hold a token.
- Scan = arrival: it checks in the token you hold (same token number); a walk-in gets a new one. Signed in, this is saved on the server first (new `POST /me/visits/:id/checkin`, requires the signed hospital QR).
- Booking saves on the server before the token is shown; failures keep you on the screen with the real reason.
- Flow uses the same five stages as Home; demo-only controls hidden when signed in.
- Desktop: popups pinned to the window above the sidebar; page scrolls to top when the view changes.
- Fixed `/auth/desk` crash (`db.run`).

### v1.1.0
- **Staff view.** Hospital staff now enter through one "Staff" role. After login the screen says "You're joining as staff" and lists the desks on the account (Reception, Radiology, Pathology/Blood Tests). Single-desk accounts see their one desk and tap to join it. The demo "Switch view" list shows one Staff entry instead of three separate desk entries; `staff.<hospital>@gmail.com` now has all three desks.
- **Phone and desktop layouts.** Doctors, hospital staff and doctors in patient mode can switch between a phone layout and a desktop layout (button in the top bar; the choice is remembered on the device). Patients without a doctor account stay phone-only. Hospital admin and MediLink owner stay desktop-only. New file: `frontend/www/medilink-layout.js`.
- Audit log device label now says "Desktop web" for non-admin desktop sessions.
