# Engineering Report: Cohort Platform Stabilisation (branch `cohort10-stabilization`)

Base: `main` at `cb11ee9`. Everything below was done in a working copy; **no production system, database, Supabase project, Render service or Google Sheet was touched**. No credentials were available to me, so all external services were replaced by test doubles (see section 6).

Legend used in the checklist: **PASS** = implemented and verified by an automated test I ran. **BUILT** = implemented, but only checkable against real external services or a real browser, which I could not do. **NOT DONE** = deliberately not implemented. **N/A** = does not apply.

---

## 1. What was broken (confirmed in the original code)

| # | Finding | Impact |
|---|---|---|
| 1 | `routes/adminOps.js` was never mounted. | Admin learners, groups, schedule, events, reminders and analytics endpoints returned 404. |
| 2 | `config.mail` and `config.app` did not exist, but the mailer, reminders and adminOps read them. | Reminder runs and admin reminder pages would crash with a TypeError. |
| 3 | A legacy `backend/server.js` (open CORS; "password" = the learner's stack name) sat beside the real server. | Dormant but one wrong start command from a serious data exposure. **Removed.** |
| 4 | A unique index allowed only one active cohort; learner login required "the" active cohort; "Make active" deactivated all others. | Cohort 10 could not run alongside Cohort 9. |
| 5 | `App.jsx` routed only `/admin`; `/assessments` and the admin sub-pages had no routes, and `components/ui.jsx` lacked `Banner`, `Card`, `CohortPicker`, `StatusBadge` which those pages import. | Whole areas were unreachable. The build was green only because unreachable code is dropped from the bundle. |
| 6 | The sheet reader built the range as `'Cohort N Grading'!A:T`. The real Cohort 10 tab is named `Cohort 10 Grading ` (trailing space). | Cohort 10 reads and imports would fail. |
| 7 | Blank/"N/A" grade cells were converted to `0`; the sheet pre-fills `FAIL / NOT QUALIFIED` on ungraded rows. | A Cohort 10 learner would see 0% and "Not qualified" before any grading. |
| 8 | Import: exact-match stack names only (sheet has `Data Analyis `, `Content writing`…), no preview, no row-level result, learners and invite codes created in one click. | Wrong or silently skipped enrolments. |
| 9 | No grade-writing endpoint existed; learners saw a grade the instant it was stored. | No facilitator grading, no draft/publish. |
| 10 | Claim consumed the invite *before* creating the identity; an interrupted activation left an orphaned Supabase user and a burned code. Unknown lockout scope silently never locked. | Stranded learners; weaker brute-force protection for any new scope. |
| 11 | No password recovery, no expired-invite recovery. | Support burden. |
| 12 | `ssl: { rejectUnauthorized: false }` hard-coded; no pool error handler; no request ids, readiness, graceful shutdown or unhandled-rejection handling. | Weak TLS, crash-on-idle-error, hard to diagnose. |
| 13 | CSRF origin check failed open when no `Origin` header was sent. | Weaker cookie-session protection. |
| 14 | ESLint linted backend CommonJS as browser code (202 of 205 baseline errors were `no-undef`). | Lint was useless as a signal. |
| 15 | Backend dependencies: `proxy-addr` (critical, IP spoofing, affects IP-keyed lockouts), `body-parser`, `qs`, `path-to-regexp` advisories. | Fixed with a non-breaking `npm audit fix`. |
| 16 | `vercel.json` sends **all** Vercel deployments, previews included, to the production Render URL. | A preview can read/write production data. Documented; not changed (see Part 9 of the guide). |

## 2. Data ownership and state model (as implemented)

| Data | Authoritative source |
|---|---|
| Identity / sessions | Supabase Auth |
| Profile, role, enrolment, stack, cohort status | PostgreSQL |
| Assessments, submissions, grades (draft/published), revisions, audit | PostgreSQL |
| Legacy grades, attendance, bonus, capstone scores | Google Sheet (read-only). A **published** platform grade overrides that week's assessment cell |
| Registration | Sheet tab `Cohort N Grading` → imported by an admin through preview/apply |
| Invitation state and delivery | PostgreSQL (`invites`), email via Resend |

**Three separate state machines** (no single overloaded boolean):
- Account: `profiles.is_active`.
- Cohort: `cohorts.status` = `upcoming → active → completed → archived` (`is_active` kept as a mirror, enforced by a check constraint).
- Enrolment: `learners.status` = `enrolled → invited → activated → orientation → active → completed | withdrawn`.
  *Mapping to the requested list:* "Registered / Awaiting verification" do not exist here because eligibility and payment are verified outside the platform and presence in the sheet creates the enrolment; "Invitation pending" = `enrolled` with delivery failed/not sent; "Invited" = `invited`; "Account activated" = `activated`; "Orientation in progress/complete" = `orientation`/`active`.

## 3. Files changed

**Database:** `backend/migrations/003_multi_cohort_onboarding.sql` (new), `backend/migrations/rollback/003_rollback.sql` (new, not auto-run).

**Backend (new):** `lib/logger.js`, `lib/dbssl.js`, `lib/stacks.js`, `lib/importPlan.js`, `middleware/requestContext.js`, `middleware/errors.js`, `services/invitations.js`, `services/onboarding.js`.
**Backend (rewritten/changed):** `config.js`, `db.js`, `app.js` (mounts adminOps, readiness, CSRF hardening), `server.js` (graceful shutdown), `routes/auth.js`, `routes/admin.js`, `routes/adminOps.js`, `routes/learner.js`, `routes/facilitator.js`, `services/sheets.js`, `services/importCohort.js`, `services/invites.js`, `services/mailer.js`, `services/progress.js`, `lib/grading.js`, `lib/lockout.js`, `lib/attempts.js`, `lib/audit.js`, `scripts/migrate.js`, `scripts/seed-facilitators.js`, `package.json` (+ lockfile via `npm audit fix`). **Removed:** `backend/server.js`.

**Frontend (new):** `pages/AdminOnboarding.jsx`, `AdminFacilitators.jsx`, `AdminActivity.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `components/CodesPanel.jsx`, `lib/csv.js`.
**Frontend (changed):** `App.jsx` (full route table), `api.js`, `auth/AuthProvider.jsx`, `components/ui.jsx`, `lib/useCohort.js`, `pages/AdminLayout.jsx`, `AdminHome.jsx`, `AdminLearners.jsx`, `AdminSchedule.jsx` (lint fix), `Claim.jsx`, `Login.jsx`, `LearnerDashboard.jsx`, `LearnerAssessments.jsx`, `FacilitatorHome.jsx`.

**Tests/tooling/docs:** `backend/test/platform-units.test.js`, `backend/test/integration/{journey,migrations}.test.js`, `backend/test/helpers/*`, `eslint.config.js`, `.gitignore` files, `backend/.env.example`, `README.md`, `docs/*`.

## 4. Database changes (`003`)

Additive only; the one thing dropped is the `one_active_cohort` index, whose business rule is replaced by `cohorts.status`.
- `cohorts`: `status`, `archived_at`; check `is_active = (status = 'active')`. Backfill: active stays active; inactive & future → `upcoming`; else `completed`.
- `learners`: `status`, `invited_at`, `activated_at`, `orientation_completed_at`, `withdrawn_at`; existing account holders backfilled to `active` (no forced orientation).
- `invites`: `learner_id` (binds to the enrolment), `delivery_status/attempts/error`, `sent_at`.
- `grades`: `published_at/by` (existing grades backfilled as published, so nothing a learner could see disappears). `grade_revisions` history.
- New: `import_batches`, `import_rows`, `stack_aliases`, `announcements`, `orientation_progress`; RLS enabled on all.
- Indexes for hot filters (learners by cohort/stack/status/profile, submissions, extensions, events, audit).

**Migration verification (real PostgreSQL 16, throwaway local DB):** upgrade from a legacy-shaped database with a live "Cohort 9" and a graded submission: all legacy columns byte-identical before/after; statuses backfilled as designed; second run applies nothing; two active cohorts allowed; drift constraint rejects `is_active` ≠ `status`; duplicate `(cohort, email)` (any letter case) rejected; unknown stack rejected; invalid enrolment status rejected. Rollback script tested inside a discarded transaction.

## 5. Requirements checklist

### Learner journey
| Requirement | Status | Evidence / note |
|---|---|---|
| Registration data imported from authorised source | **PASS** (sheet logic) / **BUILT** (live Google read) | Preview/apply tested with a stubbed sheet; the real Google call is unchanged code except tab resolution. |
| Matched to cohort and stack; no duplicates | **PASS** | Messy case/spacing, typo+alias, duplicate rows, conflicting stacks, re-import = 0 new rows. |
| Registration webhook / automatic sync | **N/A** | No webhook/API source identified; the sheet import is the interim workflow. **Manual step remaining: an admin presses Preview then Apply.** |
| Invitation: secure, hashed, expiring, single-use, bound to email+role+enrolment | **PASS** | Hash-only at rest; reuse refused; expiry; withdrawn-after-issue refused. |
| Invitation email delivered | **PASS** (code path vs captured provider) / **BUILT** (real Resend) | Provider outage keeps learner "enrolled", offers hand-delivery codes, retry succeeds. |
| Activation: concurrent-safe, no duplicates, recoverable | **PASS** | 6 parallel claims → 1 winner, 1 identity; injected failure leaves invite reusable; orphaned auth user recovered. |
| Expired-invite recovery | **PASS** | Non-enumerating "email me a new invitation", cooldown, rate limit. |
| Password recovery | **PASS** (API) / **BUILT** (Supabase email + redirect) | Needs the Supabase redirect URL and SMTP (guide Parts 3-4). |
| Onboarding statuses | **PASS** | Transitions tested end to end. |
| Orientation checklist | **PASS** | Idempotent; moves learner to active. |
| Dashboard: cohort, stack, next class, announcements, outstanding work, published grades, feedback, capstone group | **PASS** (API) / **BUILT** (UI in a browser) | |
| Missing grade never shown as zero; drafts hidden | **PASS** | Unit + integration. |
| Mobile/desktop layouts, console errors, session-expiry UX in a browser | **BUILT, not browser-tested** | See section 7. |
| Attendance summary | **PASS** (from sheet) | Platform does not record attendance (below). |

### Facilitator / admin
| Requirement | Status | Note |
|---|---|---|
| Facilitator sees only own cohort+stack learners; IDOR-proof | **PASS** | URL/body/query manipulation → 404; unassigned cohort → 404. |
| Review submissions, grade, feedback, publish, correct with history | **PASS** | Revisions + same-transaction audit. |
| Recording attendance in the platform | **NOT DONE** | Needs a decision: sheet vs database as the source of truth. Sheet attendance continues to display. |
| Teaching materials | **NOT DONE** | No data model exists; only class schedule/links. |
| Cohort config without accidental global changes | **PASS** | Per-cohort status; confirmation prompts. |
| Imports with preview, validation, confirm, summary | **PASS** | |
| Onboarding failures visible | **PASS** | Status + delivery per learner. |
| Facilitator management & assignment | **PASS** | Immediate effect on add/remove. |
| Learner search/profile, withdraw/reinstate | **PASS** | |
| Capstone groups / analytics | **BUILT** | Pre-existing pages now routed; endpoints reached in tests, deeper behaviour not re-verified. |
| Audit log + viewer | **PASS** | |
| Announcements | **PASS** | Cohort-wide or per stack. |

### Backend / database / ops
| Requirement | Status |
|---|---|
| Multi-cohort support; history retained; archive keeps data | **PASS** |
| Constraints (unique, FK, checks), indexes, transactions | **PASS** |
| Consistent error shape + request id; no internals leaked | **PASS** |
| Request validation (zod) on new routes | **PASS** |
| Liveness/readiness, structured logs, graceful shutdown, handlers | **PASS** (readiness 503 on DB failure tested; shutdown/handlers are code-reviewed, not signal-tested) |
| Error tracking service (Sentry etc.) | **NOT DONE** (needs an account/DSN). Structured logs with request ids are the substitute. |
| Rate limits | **PASS** on login, claim, invite request, forgot/reset. **Not added** for other routes (all are authenticated). |
| CORS/CSRF | **PASS** |
| Secrets not in frontend/logs/repo | **PASS** (key-based log redaction tested; `.env` now git-ignored; no secrets in source) |
| Dependency review | **PASS with 1 deferral**: remaining advisories only via `googleapis → uuid` (needs a breaking major upgrade I cannot validate without live Google access). |
| Backup/rollback documented and tested | **PASS** (rollback SQL tested; backup via `pg_dump`/Supabase) |
| Staging/production isolation | **BUILT / documentation only.** Not something code can establish; `vercel.json` caveat documented. |
| Cohort 9 unchanged | **PASS** (migration test and end-to-end canary compare every row) |
| Admin allow-list | **N/A** none exists in the product; admins can only be created by the seed script, never through the API. |
| Data retention | Documented behaviour: no deletion; archive/withdraw only. |

## 6. Tests actually executed (final run)

Environment: Node 22, PostgreSQL 16 on `127.0.0.1`, database `fuse_test`. The test harness **refuses to run** unless `TEST_DATABASE_URL` is a local host with `test` in the database name (verified by running it against a non-local host). Synthetic people only.

| Command | Result |
|---|---|
| `cd backend && npm test` (unit) | **49 / 49 pass** (38 pre-existing + 11 new) |
| `cd backend && TEST_DATABASE_URL=… npm run test:integration` | **52 / 52 pass** |
| `npx eslint .` | **0 errors** (baseline was 205) |
| `npm run build` | **success** (1738 modules; previously the admin pages were not in the bundle at all) |
| `npm audit --omit=dev` | frontend 0; backend reduced from critical/high to 1 deferred moderate-chain |

**Test doubles (test code only):** fake Supabase Auth (mirrors users into `auth.users` so real foreign keys apply), captured email provider (the real mailer code runs, `fetch` is intercepted), stubbed Sheets source. They prove *our* logic, not that Supabase/Resend/Google behave as modelled.

**One run history worth knowing:** the first integration run had 4 failures. Three were my own miscounted expectations; one was a real bug (the resend cooldown counted an expired invite as recent). Fixed, rerun, 52/52.

## 7. Not verified (be sure to run Part 8 of the guide)

- Any real Supabase, Resend or Google Sheets call. Connection settings, SMTP redirect URLs, domain verification, sheet sharing.
- Any real browser: layouts on phones, accessibility with a screen reader, console errors, the visual look of new pages. (Frontend is lint-clean and builds; interactions were not clicked through.)
- Render/Vercel deployment behaviour, TLS `DATABASE_SSL=verify` against Supabase's certificate.
- Signal handling (SIGTERM drain) and the unhandled-rejection handlers.
- Reminder emails with the changed config (the config keys now exist; run the Schedule preview first).
- Load/performance at scale (queries are indexed and bounded; no load test).

## 8. Decisions that are yours

1. **Source of truth for attendance and legacy grades** (sheet vs platform). Today: sheet for attendance/bonus/capstone, platform for published assessment grades.
2. **Should alumni of completed cohorts be able to sign in read-only?** Today: no (unchanged behaviour).
3. **Email facilitator invitations too?** Today: code handed over.
4. **`DATABASE_SSL=verify`:** switch once confirmed working.
5. **Upgrading `googleapis`** (breaking major) to clear the last advisory chain.

## 9. Deployment and rollback (summary; full steps in `docs/GO-LIVE-GUIDE.md`)

1. Back up. 2. Rehearse on staging. 3. `npm run migrate` against production. 4. Set env vars. 5. Deploy backend; check `/api/ready`. 6. Deploy frontend. 7. Run the smoke test. **Rollback:** redeploy previous Render/Vercel builds; optionally run `003_rollback.sql` (keeps all data); backup restore as last resort.
