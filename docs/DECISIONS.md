# Design decisions

| Decision | Why |
|---|---|
| The app UI is the original prototype file, unchanged, plus connector scripts | The brief was to keep the exact screens, colours and theme. The connector scripts (`medilink-live.js`, `medilink-sync.js`, `medilink-owner.js`) wrap the prototype's own functions and fill its own data lists, so the design cannot drift. |
| NestJS modular monolith instead of microservices | One deployable service is far easier to run for a college project and a first hospital; modules (auth, patient, doctor, reception, diagnostics, admin, platform) keep clear boundaries and can be split later. |
| PostgreSQL with plain SQL (`pg`) instead of Prisma | Prisma's engine binaries could not be downloaded in the build environment; plain parameterised SQL is also easier to review for security. The schema is one file (`backend/src/db/schema.sql`). |
| Immutability in the database (triggers), not only in code | A bug or a careless admin script still cannot change a prescription, report version or audit entry. |
| SHA-256 hash-chained audit log | Any edit to an old entry breaks the chain, and anyone with access can verify it. |
| bcrypt + PIN instead of Keycloak/passkeys | Keeps the demo self-contained; the auth module is small enough to swap for Keycloak later. |
| Rule-based symptom routing, never a diagnosis | Safe, explainable and works offline in English, Hindi and Marathi. Red-flag words always go to Emergency. |
| `DEMO_MODE` endpoints for the camera | The prototype's Scan buttons have no camera; the server hands the app the same signed code a camera would read, so every real check still runs. Switched off in production. |
| Owner Console sees metadata only, support access is "ask, admin approves, expires" | The company running MediLink should never be able to read patient records on its own (break-glass with the hospital's consent). |
| Capacitor for Android, APK built on GitHub Actions | One code base for web and Android; the APK builds without Android Studio. |
| Rate limits kept in memory | Enough for one server. With several servers, switch the throttler storage to Redis. |
