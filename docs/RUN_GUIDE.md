# MediLink — run guide and troubleshooting

## For an AI coding agent (e.g. Google Antigravity)

Run exactly these steps; no code changes are needed.

1. Make sure Node.js 20+ and PostgreSQL 14+ are installed (or Docker).
2. **With Docker:** `docker compose up --build` from the repo root, then open http://localhost:5173.
3. **Without Docker:**
   - `psql -U postgres -c "CREATE USER medilink WITH PASSWORD 'medilink';"`
   - `psql -U postgres -c "CREATE DATABASE medilink OWNER medilink;"`
   - `cd backend && cp .env.example .env && npm install && npm run db:setup && npm start`
   - In a second terminal: `cd frontend && npm install && npm run dev`
4. Verify: `curl http://localhost:4000/api/health` returns `{"ok":true,...}`; then `node backend/scripts/smoke-test.mjs` prints `83 passed, 0 failed`. A minute later, `node backend/scripts/security-test.mjs` prints `35 passed, 0 failed`.

> Run the smoke test on a fresh database (it registers new visits for today). To reset: drop and recreate the `medilink` database, then `npm run db:setup` again.

## Common problems

| Problem | Fix |
|---|---|
| `password authentication failed for user "medilink"` | Create the user/database as above, or change `DATABASE_URL` in `backend/.env`. |
| `ECONNREFUSED 5432` | PostgreSQL is not running. Start it (or use Docker). |
| Login opens the offline demo instead of the live server | Start the backend (`npm start` in `backend`). On a phone, tap **Server:** under the Log in button and enter your computer's Wi-Fi address, e.g. `http://192.168.1.5:4000/api`. |
| Phone cannot connect | Phone and computer must be on the same Wi-Fi; allow port 4000 through the firewall. |
| App looks unstyled | The prototype loads Tailwind, icons and fonts from the internet (CDN). Make sure the device is online. |
| Map is grey | The map tiles need internet. The hospital list and buttons still work. |
| Port already in use | Change `PORT` in `backend/.env`, or stop the other program. |

## Reset demo data

```bash
psql -U postgres -c "DROP DATABASE medilink;" -c "CREATE DATABASE medilink OWNER medilink;"
cd backend && npm run db:setup
```

### Quick database reset

```bash
psql postgres://medilink:medilink@localhost:5432/medilink -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
cd backend && npm run db:setup
```

### "Too many requests" while testing

Login, sign-up and PIN are limited to 10 attempts a minute per address. Wait a minute, or for local testing start the API with `AUTH_RATE_LIMIT_PER_MINUTE=60 RATE_LIMIT_PER_MINUTE=1000 npm start`.
