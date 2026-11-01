# Architecture

```
 Phone / browser: original prototype UI (www/index.html) + connector scripts, Capacitor Android
        │  HTTPS / JSON (JWT bearer token)
        ▼
 NestJS API  ── rate limits, security headers, safe errors; guards: role + desk + consent checks
   ├─ auth        (bcrypt, JWT, PIN step, desk selection)
   ├─ public      (hospitals, QR resolve, symptom routing, emergency)
   ├─ patient     (profile, visits, Drive, consents, referrals)
   ├─ doctor      (duty QR clock-in, patient QR scan, prescriptions, tests, referrals)
   ├─ reception   (queue, walk-in/emergency registration, vitals, test booking)
   ├─ diagnostics (worklist, report upload with content checks, versioned corrections)
   ├─ admin       (overview, people, audit + verify, reason-gated view, conduct alerts, QR, support requests)
   ├─ platform    (Owner Console: hospitals, health, settings, compliance, announcements; metadata only)
   └─ audit       (SHA-256 hash chain)
        │
        ▼
 PostgreSQL  ── triggers make prescriptions, report versions and audit entries permanent
 File storage (uploads/) ── SHA-256 per file
```

**Tech stack (as built):** Backend: TypeScript · NestJS 11 · PostgreSQL 16 (`pg`) · Jest. App: the original prototype (HTML, Tailwind CSS, JavaScript, Lucide icons, Leaflet maps) + connector scripts (`medilink-live.js`, `medilink-sync.js`, `medilink-owner.js`) · Capacitor 6 (Android). Delivery: Docker Compose · GitHub Actions.

**Planned for production (see the black book):** Keycloak (passkeys/MFA), Redis, MinIO with object lock, ClamAV, Kubernetes/Helm, real ABDM/DigiLocker/SMS/NHCX adapters, OpenTelemetry/Prometheus/Grafana.
