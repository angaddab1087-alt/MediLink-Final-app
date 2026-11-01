# MediLink security

This file covers three things: the 20-point "before release" checklist and where each point is handled, the layers of protection, and every secret key with its rotation. Run the attack tests yourself with `node backend/scripts/security-test.mjs` (35 checks; the API must be running).

## The 20-point pre-release checklist

| # | Check | Status | Where |
|---|---|---|---|
| 1 | Rate limiting on every route, stricter on login, sign-up, PIN, QR and uploads | Done | `@nestjs/throttler` global guard (`RATE_LIMIT_PER_MINUTE`, default 120/min/IP); login, sign-up and PIN `AUTH_RATE_LIMIT_PER_MINUTE` (default 10; 60 in demo mode so the view switcher works during a presentation); QR resolve and scan 30; report upload and correction 20. Tested: 100 rapid logins end in HTTP 429. |
| 2 | No secrets in code or git | Done | `JWT_SECRET` and `QR_SECRET` come only from the environment. The API refuses to start without them unless `DEMO_MODE=true`. `.env` is git-ignored; `.env.example` holds placeholders. |
| 3 | Passwords hashed, never stored or returned | Done | bcrypt (cost 10). No endpoint returns `password_hash` or `pin_hash` (tested). |
| 4 | Second factor on login, and sessions that can be ended | Done | 4-digit PIN step for patients, doctors and the owner; the PIN step uses a short-lived token that cannot call any other route. Every request re-checks the account: deactivating it, an admin "end all sessions" or a password reset signs it out at once. |
| 5 | Every route needs a valid session unless deliberately public | Done | Global `AuthGuard`; only `@Public()` routes (health, hospital list, QR resolve, symptoms, emergency) skip it. Tested: protected routes return 401 without a token or with a tampered token. |
| 6 | Role checks on the server, not only in the UI | Done | `@Roles(...)` on every controller; staff desks enforced with `requireDesk`. Tested: patients cannot open doctor, reception, admin or owner routes; reception cannot open diagnostics. |
| 7 | Users only reach their own data (no IDOR) | Done | Patients only see their own visits, files and history; file downloads check the owner. Tested with a second patient. |
| 8 | Hospitals only reach their own data (tenant isolation) | Done | Every staff/admin query is filtered by the hospital in the signed token, never by a value from the request. Tested across two hospitals. |
| 9 | No mass assignment | Done | Every body field is picked and validated one by one (`common/dto.ts`); unknown fields such as `role` or `hospitalId` on sign-up are ignored (tested). |
| 10 | SQL injection impossible | Done | Only parameterised queries (`$1, $2…`). Tested with classic payloads on login, search and filters. |
| 11 | Input validation with clear limits | Done | Length, type, list and range checks on every field; IDs must be whole numbers; JSON bodies capped at 25 MB. |
| 12 | Uploads checked by content, not file name | Done | PDF, JPEG, PNG and DICOM are recognised by their magic bytes; anything else is refused, size capped at 15 MB. Tested with an `.exe` renamed to `.pdf`. A real malware scanner (ClamAV) is not included; see "Not built" below. |
| 13 | Errors never leak internals | Done | Global error filter: plain messages and a request ID; database errors become 400/409; stack traces only go to the server log. Tested. |
| 14 | Security headers | Done | `helmet` (CSP, HSTS, frame, sniffing and referrer headers); `X-Powered-By` removed. Tested. |
| 15 | CORS limited to the app | Done (configurable) | `CORS_ORIGIN` allow-list. The demo default `*` is for local testing; set your domain in production. |
| 16 | HTTPS everywhere | Ready, set at deploy | Put the API behind a TLS 1.3 reverse proxy (nginx, Caddy, cloud load balancer). `trust proxy` is on so rate limits see real client IPs. The Android app allows plain HTTP only so it can reach a laptop on the same Wi-Fi during the demo. |
| 17 | Signed, expiring QR codes | Done | Hospital and duty QRs are HMAC-SHA256 signed with a version (rotation cancels old prints); the patient visit QR changes every 30 seconds. Tested with a forged code. |
| 18 | Tamper-evident audit log | Done | SHA-256 hash chain; database triggers block edits and deletes of audit entries, prescriptions and report versions. Admin and owner can verify the chain. |
| 19 | Dependency audit | Done | `npm audit --omit=dev` reports 0 known vulnerabilities in backend and app; CI runs it on every push. (Some test-only packages such as Jest have advisories that never ship to users.) |
| 20 | Simulation switches off in production | Done | `DEMO_MODE=false` disables the `/demo/*` endpoints that stand in for the camera, and makes secrets mandatory. |

## Layers

1. **Edge:** rate limits per IP and per route, body size limit.
2. **Transport:** TLS at the reverse proxy (deployment step), HSTS header from the API.
3. **Identity:** bcrypt passwords, PIN step, 12-hour signed JWT sessions, suspended hospitals cannot sign in.
4. **Input:** field-by-field validation, parameterised SQL, content-checked uploads.
5. **Access:** roles, desks, hospital isolation, patient consent per hospital, doctors view but cannot download, admin record views need a reason and are shown to the patient.
6. **Data:** files stored outside the web root with SHA-256 checksums; raw Aadhaar numbers are never stored.
7. **Audit:** hash-chained log of every sensitive action, verifiable on demand; the Owner Console counts blocked access attempts.

## Keys

| Key | Protects | Rotation |
|---|---|---|
| `JWT_SECRET` | Login sessions | Every 90 days or after any incident. Changing it signs everyone out. |
| `QR_SECRET` | Hospital, duty and patient QR codes | Every 90 days. Hospital QR codes can also be rotated one by one from the admin panel (the version number changes and old prints stop working). |
| Database password (`DATABASE_URL`) | PostgreSQL | Every 90 days. |

Generate strong values with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

## Not built (stated honestly)

These are in the production brief but are not part of this build: Keycloak/passkeys and refresh-token rotation, Argon2id (bcrypt is used), PostgreSQL row-level security (isolation is enforced in the API and tested), field-level AES-256-GCM encryption and a key-management service, ClamAV malware scanning, a WAF/CDN, Redis-backed distributed rate limits, MinIO object storage, and Kubernetes. The code is structured so each can be added without changing the app.
