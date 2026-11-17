# FUSE Varsity Platform: Go-Live and Operations Guide

This guide takes you from "the code is in a zip file" to "Cohort 10 learners and facilitators are signing in". Follow it top to bottom the first time. After that, jump to **Part 7 (running a cohort)** each cohort.

> **Keep secrets out of chats, tickets and screenshots.** Anything called a key, password, token, private key or database URL goes only into Render's Environment tab, never into this repo, Vercel, or a message to anyone (including me).

---

## Part 0. What is different in this release (plain language)

| Before | Now |
|---|---|
| Only one cohort could be "active" at a time. Activating Cohort 10 locked Cohort 9 out. | Any number of cohorts can run at once. Each cohort has its own status: **upcoming → active → completed → archived**. Changing one never touches another. |
| Importing learners created accounts' codes in one click with no review. | **Preview → fix problems → apply.** Every row is explained. Re-running never makes duplicates. |
| You handed out invite codes by hand. | The platform **emails each learner a personal activation link** (once Resend is set up). If email is off or fails, it shows you the codes to hand over, and you can retry safely. |
| Expired code = dead end. | The learner can press **"Email me a new invitation"** on the activation page. |
| Grades appeared the moment a facilitator saved them. | Facilitators **save a draft, then publish**. Learners only see published grades. Missing scores show "—", never 0. |
| Facilitators could only see their assignment. | Facilitators can **see their own learners, review submissions, grade, give feedback and publish**, limited strictly to their cohort and stack. |
| Several admin pages and the learner "Assessments" page were not reachable. | All wired up: Setup, Onboarding, Learners, Facilitators, Capstone groups, Schedule, Analytics, Activity log. |
| No password reset. | **Forgot password** works by email. |

Your existing data (including **Cohort 9**) is kept exactly as it is. The database change is additive, and an automated test proves Cohort 9's rows are identical before and after.

---

## Part 1. Accounts you need

1. **Render** (backend) and **Vercel** (frontend): you already have these.
2. **Supabase** (login accounts + database): you already have this.
3. **Google Cloud service account** with access to your registration/grading sheet: you already have this (it is the `GOOGLE_CLIENT_EMAIL` in Render).
4. **Resend** (sends the invitation emails): **new, see Part 3.**
5. A **domain name** you control (e.g. `fusevarsity.com`) so emails come from your own address. Without it, emails from a free address go to spam or are rejected.

---

## Part 2. One-time release steps (do these in this order)

The order matters: the new code expects the new database columns.

### 2.1 Back up the database
In Supabase: **Project Settings → Database → Backups** (use a point-in-time/daily backup if your plan has it), **or** from your computer:

```
pg_dump "YOUR_DATABASE_URL" --no-owner -Fc -f fuse-before-release.dump
```

Keep that file. This is your safety net.

### 2.2 Try it on a copy first (strongly recommended)
Do not test a new release on live data. Create a **second Supabase project** (free) and a **second Render service** with the same code, point both at each other, and run through Part 8 there. See "Staging" in Part 9, because `vercel.json` sends every Vercel deployment, including previews, to your **production** Render URL.

### 2.3 Apply the database migration (production)
From your computer, in the `backend` folder:

```
npm ci
DATABASE_URL="YOUR_DATABASE_URL" npm run migrate
```

(Windows PowerShell: `$env:DATABASE_URL="..." ; npm run migrate`.) You should see `Applying 003_multi_cohort_onboarding.sql` then `Migrations up to date.` It is safe to run twice. It only adds things; nothing is deleted and Cohort 9 stays active.

### 2.4 Set the new Render environment variables
See the table in **Part 6**. At minimum add `APP_URL` and `ACTIVE_COHORT_NUMBER`. Leave `MAIL_DRY_RUN=true` until Part 3 is finished.

### 2.5 Deploy the backend
Push this code to the branch Render deploys (usually `main`). In Render, confirm:
- Root directory: `backend`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/api/health`

When it is live, open `https://YOUR-RENDER-URL/api/ready`. You want `"ok": true`, `database.ok: true`, `auth.ok: true`. The `registration.activeCohortNumber` should show your cohort number, and `mail` shows whether email is switched on.

### 2.6 Deploy the frontend
Push the same code for Vercel to build. Nothing to configure: the site talks to the backend through `vercel.json`.

### 2.7 Create or confirm your admin login
If you already have an admin, skip this. Otherwise, from the `backend` folder with the production environment set:
```
ADMIN_EMAIL="you@yourdomain.com" ADMIN_INITIAL_PASSWORD="a-long-temporary-password" npm run seed:admin
```
You will be forced to change the password at first login. Afterwards, remove `ADMIN_INITIAL_PASSWORD` from wherever you set it.

---

## Part 3. Set up email with Resend

Without this, everything still works, but the platform shows you each learner's code to hand over yourself instead of emailing it.

1. Go to **resend.com**, create an account.
2. **Domains → Add Domain.** Enter your domain (for example `fusevarsity.com`). Resend shows DNS records (SPF, DKIM, and optionally DMARC). Add them where you manage your domain's DNS (Namecheap, GoDaddy, Cloudflare, etc.). Click **Verify**; it can take minutes to a few hours.
3. **API Keys → Create API Key**, permission **Sending access**. Copy it once. It starts with `re_`.
4. In **Render → your backend service → Environment**, set:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `FUSE Varsity <no-reply@fusevarsity.com>` (the address must be on the domain you verified)
   - `MAIL_DRY_RUN` = `false`
   - `APP_URL` = your site address, e.g. `https://student-dashboard.vercel.app` (so the email's link opens your site)
5. Save. Render restarts the service.
6. **Test with yourself first:** put your own email in a test row of the cohort's registration tab (with a valid stack), then Admin → **Onboarding → Preview → Apply → Send invitations**. Confirm the email arrives, the button opens the activation page with your email and code already filled in, and activation works. Remove the test learner afterwards with **Withdraw**.
7. **Check Resend's current free-plan limits** on their pricing page (daily and monthly caps change). If your cohort is bigger than the daily cap, press **Send invitations** again the next day: it only sends to people not yet successfully invited.

**Also use Resend for password-reset emails (recommended):** Supabase sends those, and its built-in email service is heavily limited. In **Supabase → Authentication → Emails → SMTP Settings**, enable custom SMTP using Resend's SMTP details (host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, sender = the same `no-reply@...` address).

---

## Part 4. Supabase settings (2 minutes)

1. **Authentication → URL Configuration**
   - **Site URL:** your frontend address.
   - **Redirect URLs:** add `https://YOUR-FRONTEND/reset-password`. Without this, password-reset links fail.
2. **Authentication → Providers → Email:** turn **off** "Allow new users to sign up". Accounts are created only by the platform from invitations. Leaving sign-up on lets strangers create login accounts.
3. Keep **Confirm email** as you have it (the platform creates accounts already confirmed).

---

## Part 5. Google Sheet settings

- Share the sheet with the service account email (`GOOGLE_CLIENT_EMAIL`) as **Viewer**. (Viewer is enough: the platform only reads.)
- `SHEET_ID` in Render is the long ID in the sheet's address, between `/d/` and `/edit`.
- Each cohort has a tab named **`Cohort N Grading`** (a trailing space in the tab name, like `Cohort 10 Grading `, is fine).
- For registration, the first three columns of that tab must be: **A: full registered name, B: email, C: stack.** Row 1 is the header. Blank spacer rows are ignored.
- Stack names should match your **Stacks** list in Setup. Different capitalisation and spacing are fine. If the sheet says "Data Analyis" (typo), the import will **not** guess: it shows the row as a problem and lets you say "this means Data Analysis" once, which is remembered.
- Grades columns D to T stay as they are today. For learners, the platform reads attendance, assessment, bonus and capstone from there, **plus** any grades facilitators publish in the platform (a published platform grade replaces that week's assessment cell).

### Pulling learners from the active cohort named in Render
Set **`ACTIVE_COHORT_NUMBER=10`** in Render. Then:
- The registration import will **only** read the `Cohort 10 Grading` tab, and refuses any other cohort (so nobody imports last cohort's tab by mistake).
- The admin pages open on Cohort 10 by default.
- When Cohort 11 starts: change the value to `11` in Render, create Cohort 11 in Setup, and import.
- Leave it empty if you ever need to import any cohort.

Learners always see the grades from **their own cohort's** tab, so Cohort 9 learners keep seeing Cohort 9 while Cohort 10 runs.

---

## Part 6. Render environment variables

Set in Render → service → **Environment**. (A template with comments is in `backend/.env.example`.)

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Supabase connection string (use the pooler URL on Render) |
| `SUPABASE_URL` | yes | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Secret.** Server only. Never in Vercel or the frontend |
| `INVITE_PEPPER` | yes | 24+ random characters. **Do not change it after codes are issued**, or unused codes stop working |
| `SHEET_ID` | yes | Google Sheet ID |
| `GOOGLE_CLIENT_EMAIL` | yes | Service account email |
| `GOOGLE_PRIVATE_KEY` | yes | Service account private key (keep the `\n`s, wrap in quotes) |
| `ALLOWED_ORIGINS` | yes | Your frontend address(es), comma-separated |
| `NODE_ENV` | recommended | `production` (makes cookies secure) |
| `APP_URL` | recommended | Frontend address used in email links |
| `ACTIVE_COHORT_NUMBER` | recommended | e.g. `10`. See Part 5 |
| `DATABASE_SSL` | recommended | `verify` once you have confirmed it connects; `no-verify` is the previous behaviour. If the app cannot reach the database after you set `verify`, set it back to `no-verify` |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | See Part 3 |
| `MAIL_DRY_RUN` | for email | `false` to really send (default `true` = send nothing) |
| `LOG_LEVEL` | optional | `info` (default) |

---

## Part 7. Running a cohort: the runbook (use this every cohort)

### A. Before registration closes
1. **Admin → Setup → Cohorts → Create cohort.** Enter the number and the **Saturday** of the first class. The weekly assessments and their open/due dates are created automatically from that date. The cohort starts as **upcoming**.
2. **Setup → Stacks:** make sure every stack for this cohort is listed and ticked (active).
3. In Render, set `ACTIVE_COHORT_NUMBER` to this cohort's number.
4. Learners register as you do today; their full registered name, email and stack land in the `Cohort N Grading` tab. (Payment/scholarship checks stay outside the platform: only people who are in the sheet get enrolled.)

### B. Enrol and invite learners
1. **Admin → Onboarding →** pick the cohort → **Preview import from sheet.**
2. Read the summary:
   - **New**: will be enrolled. **Unchanged**: already there. **Duplicates skipped**: the same email twice with the same stack.
   - **Problems** (filter "problems"): missing/invalid email, unknown stack, or the same email with two different stacks. These rows are **left out** until fixed. Fix the sheet and preview again, or use the "this means…" box for a stack spelling.
   - **Stack changes** for existing learners are never applied unless you tick the confirmation box.
3. **Apply this import.** Run it as often as you like; it never duplicates anyone.
4. **Send invitations.** Each learner gets an email with a personal link. The table shows status per learner: *Not invited → Emailed → Account created*.
   - If the email provider is off/unreachable: the screen lists the codes for you to hand over (WhatsApp/DM individually), and the learner stays "not invited" so you can press the button again later.
   - **Resend** per learner is available in the table.
5. Learners can activate their accounts **while the cohort is still "upcoming"**, but cannot sign in until it is active.

### C. Open the cohort
When classes start: **Setup → Cohorts → change this cohort's status to `active`.** Other cohorts are not affected. (If a learner says "your cohort is not currently active", this is the reason.)

### D. What learners see and do
1. Open the link in their email → choose a password (10+ characters) → sign in at `/login`.
2. A **Get started** checklist (4 items). Finishing it moves them from *Activated → Orientation → Active*.
3. Dashboard: next class link, announcements, work still to submit, grades (shown as "—" until recorded).
4. **Weekly assessments** page: paste a Google Docs/Drive link before the deadline. Graded work is locked.

### E. Onboard facilitators
1. **Admin → Facilitators → Invite a new facilitator:** name, email, cohort, stack. You get a code (shown once).
2. Send the code privately and ask them to open **`https://YOUR-SITE/facilitator/signup`**, enter their email, the code and a password.
3. Already have a facilitator (for example, teaching a second stack or cohort)? Use **Assign an existing facilitator.** Remove an assignment with the **×**; access ends immediately.
4. To invite many at once, create the file `backend/scripts/facilitators.local.json` containing a list like `[{"fullName":"Ada Example","email":"ada@example.com","stack":"Product Management"}]` (your **FE - AI** tab is the source of this list), then run `npm run seed:facilitators -- --cohort 10` from `backend` with the production environment set. Codes print once; send them privately. The file is git-ignored; do not commit it.

### F. Facilitators grade
Facilitator → **Grading** → choose the week → for each learner enter score + feedback → **Save draft** or **Save and publish**. **Publish N saved grades** releases all drafts at once. Corrections are allowed any time and every change is recorded in **Admin → Activity log**.

### G. Admin oversight
- **Onboarding:** who is stuck (not invited, email failed, invite expired, not activated).
- **Learners:** search, per-learner detail, progress, flags. **Withdraw/Reinstate** (with a reason) in Onboarding.
- **Analytics:** learners needing follow-up.
- **Schedule:** assessment dates, class events (with the join link learners see), deadline extensions, reminders.
- **Announcements:** Setup page; to everyone in the cohort or one stack.
- **Activity log:** grade changes, imports, invitations, cohort changes.

### H. Reminder emails (optional)
Create a **Render Cron Job** (same repo, root `backend`) with command `npm run reminders`, running hourly. Each reminder is recorded so repeats are safe. Use **Schedule → reminders preview** first. Reminders only send when `MAIL_DRY_RUN=false`.

### I. When the cohort ends
Set status to **completed** (learners can no longer sign in; admin and facilitator history stay). Later set **archived** (read-only). Nothing is ever deleted.

---

## Part 8. Smoke test to run yourself (about 20 minutes)

I could not drive a real browser against your real services from my environment, so please run this once on staging and once after go-live. Tick each box; any failure, send me the step number plus what you saw (and the `requestId` shown in any error response, if there is one).

1. [ ] `/api/ready` shows `ok: true`.
2. [ ] Admin logs in at `/admin/login`. All eight menu items open.
3. [ ] Setup: create a **test** cohort (a future Saturday) and see it as *upcoming*. Change a second cohort's status and confirm Cohort 9 stayed *active*.
4. [ ] Onboarding: **Preview import.** Summary appears; problem rows are explained; **Apply** works; pressing preview again shows everything *Unchanged*.
5. [ ] **Send invitations** (use two test emails you own). Emails arrive; the link pre-fills your email and code.
6. [ ] Activate one test learner. Status shows *Account created*. Try the same code again: it is refused.
7. [ ] Make the test cohort **active**, sign in as the test learner, finish the 4 checklist items.
8. [ ] Open an assessment, submit a Google Docs link (the first assessment must be open: edit its dates in Schedule).
9. [ ] Invite and activate a test facilitator for that stack. Grade the submission as **draft**: the learner must **not** see it. **Publish**: the learner now sees score + feedback.
10. [ ] As the facilitator, you must **not** see learners from other stacks.
11. [ ] Learner presses **Forgot password**, receives the email, resets, signs in.
12. [ ] Let an invite expire (or use an old code): the **Email me a new invitation** button works.
13. [ ] Phone check: open the learner dashboard and the assessments page on a phone.
14. [ ] Cohort 9 learners can still sign in and see their grades.
15. [ ] Activity log shows the grade, import and invitation events.

---

## Part 9. Safety, staging and rollback

### Staging (do not skip)
`vercel.json` points every Vercel deployment, **including preview deployments**, at the production Render URL. Opening a preview link therefore talks to **production data**. To test safely:
1. Create a second Supabase project, run `npm run migrate` against it, and a second Render service with its own variables.
2. Create a second Vercel project from a `staging` branch whose `vercel.json` has the staging Render URL in the first rewrite.
3. Use only fake learners with email addresses you own.

### Rollback
- **Code:** in Render and Vercel, redeploy the previous deployment.
- **Database:** the migration only added things, so the old code keeps working with it, with **one exception**: the old "Make active" button would error. To go fully back, first make sure only one cohort is active, then run `backend/migrations/rollback/003_rollback.sql` (instructions inside; it keeps all data). Last resort: restore the backup from step 2.1.

### Things I want you to know about
- **Two admins at once** is fine. **Two people pressing "Apply" on the same preview:** the second gets "already applied".
- **Changing `INVITE_PEPPER`** invalidates all unused invitation codes (just press Resend).
- **Learner of a completed cohort cannot sign in** (same as before). If you want alumni to view their results, that is a product decision to make.
- **Facilitator invites are handed over, not emailed.**
- **Attendance** is still read from the sheet. It is not yet recorded in the platform (see the engineering report).
- **Re-sending to someone who already has an account** is skipped automatically; they use Forgot password.

---

## Part 10. Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| "There is no sheet tab for Cohort N" | The tab must be named `Cohort N Grading`. Check spelling, and that the sheet is shared with the service account. |
| "Could not read the registration sheet" | `SHEET_ID`, `GOOGLE_CLIENT_EMAIL` or `GOOGLE_PRIVATE_KEY` wrong, or the sheet is not shared with that email. |
| "This platform is set to import registrations for Cohort X only" | `ACTIVE_COHORT_NUMBER` in Render differs from the cohort you picked. Change it, or clear it. |
| "Unknown stack …" on rows | Add the stack in Setup, or use the "this means…" box to map the sheet's spelling. |
| Email 'Email failed' in Onboarding | Check Resend: domain verified? `EMAIL_FROM` on that domain? API key valid? Daily limit reached? Then press **Send invitations** again. |
| Learner: "Invalid or expired invite code" | They typed it wrong, used it already, or it expired. Use **Email me a new invitation** or **Resend**. After 5 wrong tries they are paused for a while (by design). |
| Learner: "Your cohort is not currently active" | Cohort is still *upcoming* (or completed). Set it to *active*. |
| Learner dashboard: "Your grade record has not been set up yet" | Their email is not in that cohort's grading tab yet. Add the row. |
| "Your grades are temporarily unavailable" | Google Sheets could not be reached. Retry in a minute. The rest of the dashboard still works. |
| "Too many attempts" | Built-in protection. Wait, or ask them to use Forgot password. |
| Reset link says invalid | Redirect URL missing in Supabase (Part 4), or the link is older than its expiry. Request a new one. |
| Any error with a `requestId` | Send me that id. It matches one line in the Render logs. |

**Reading logs:** Render → service → Logs. Each line is JSON with `requestId`, `status`, `path`, `ms`. Passwords, codes, tokens and cookies are never logged.
