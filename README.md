# FUSE Varsity Cohort Platform

Learner, facilitator and admin dashboard for FUSE Varsity bootcamps.

| Part | Technology | Where it runs |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind | Vercel (proxies `/api` to the backend, see `vercel.json`) |
| API | Express (CommonJS), zod validation | Render (`backend/`) |
| Identity | Supabase Auth (httpOnly cookie sessions) | Supabase |
| Data | PostgreSQL (migrations in `backend/migrations`) | Supabase |
| Registration + legacy grades | Google Sheets (read-only) | Google |
| Email | Resend | Resend |

## Read these first
- **`docs/GO-LIVE-GUIDE.md`**: how to deploy, set up Resend/Supabase/Google, onboard learners and facilitators, run a cohort, smoke-test and roll back.
- **`docs/ENGINEERING-REPORT.md`**: what was broken, what changed, what was tested, what was not, open decisions.
- **`backend/.env.example`**: every environment variable, explained.

## Roles and entry points
| Who | Sign in | Activate account |
|---|---|---|
| Learner | `/login` | `/claim` (the emailed link opens it pre-filled) |
| Facilitator | `/facilitator/login` | `/facilitator/signup` |
| Admin | `/admin/login` | created with `npm run seed:admin` |

## Key ideas
- **Several cohorts can run at once.** Cohort status is `upcoming → active → completed → archived`; changing one never affects another. `ACTIVE_COHORT_NUMBER` (Render) pins which cohort's sheet tab registrations are imported from.
- **Enrolment states:** `enrolled → invited → activated → orientation → active → completed | withdrawn`.
- **Grades are draft until a facilitator publishes them.** A missing score is shown as "—", never 0.
- **Imports are preview → confirm.** Nothing is guessed: unknown stacks, conflicting duplicates and stack moves need a human decision.

## Develop locally
```bash
npm ci                          # frontend
cd backend && npm ci            # API
cp backend/.env.example backend/.env   # fill in with NON-production values
npm run dev                     # API (from backend/)
npm run dev                     # frontend (from the repo root); Vite proxies /api, see vite.config.js
```

## Tests
```bash
cd backend && npm test                                   # unit tests, no database needed
createdb fuse_test                                       # a LOCAL, throwaway database whose name contains "test"
TEST_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/fuse_test npm run test:integration
npx eslint . && npm run build                            # from the repo root
```
The integration suite **wipes the `public` schema** of `TEST_DATABASE_URL` and refuses to run unless it is a local database with `test` in its name. It uses a fake Supabase Auth, a captured email provider and a stubbed Google Sheet, so it needs no credentials. It needs a Postgres role allowed to `create extension citext`.

## Migrations
`cd backend && npm run migrate` applies any unapplied files in `backend/migrations` in order (advisory-locked, one transaction each). Rollback notes for `003` are in `backend/migrations/rollback/`.
