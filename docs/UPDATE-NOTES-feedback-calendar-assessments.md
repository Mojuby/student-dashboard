# Update notes: feedback, calendars, assessments, links

Applies on top of branch `cohort10-stabilization` at commit `2aa2020`. Read **Part 1 (deploy order)** before releasing.

## Part 1. Deploy order (do not skip steps)

1. **Back up the database** (Supabase backups, or `pg_dump`).
2. **Run the migration** from your computer, in `backend`: `npm.cmd ci` then `npm.cmd run migrate` with `DATABASE_URL` set (PowerShell: `$env:DATABASE_URL="..."`). It applies `004_feedback_calendar_assessments.sql`. It only **adds** things, with one constraint swap (see Part 4). Cohort 9 and Cohort 10 rows are not modified. Rollback: `backend/migrations/rollback/004_rollback.sql` (instructions inside).
3. **Render environment:** set `APP_URL` = `https://cohort.fusevarsity.com` (no trailing slash). Check `ALLOWED_ORIGINS` includes `https://cohort.fusevarsity.com`. Save (Render restarts).
4. **Supabase → Authentication → URL Configuration:** Site URL = `https://cohort.fusevarsity.com`, and Redirect URLs include `https://cohort.fusevarsity.com/reset-password`. (Password-reset emails are sent by Supabase and use these settings, not the Render variable.)
5. **Supabase → Storage:** make sure Storage is enabled for the project (it is by default). The backend creates a **private** bucket named `assessment-files` the first time a file is uploaded. Nothing else to set up.
6. **Deploy the backend, then the frontend** (same commit).
7. **After deploy, once per live cohort (Cohort 9 and Cohort 10):**
   - **Admin → Learners → "Sync capstone qualification from the sheet".** Until you do, no learner is confirmed as capstone-qualified, so **learners will not see existing capstone events** (this is deliberate: unconfirmed counts as not qualified).
   - **Cohort 10 only, if it has no weekly calendar yet:** **Admin → Schedule → "Default calendar for this cohort"**, tick its stacks, set the class start time, create. Safe to repeat; it never duplicates or overwrites edits.

## Part 2. What changed, by feedback item

| Item | Behaviour now |
|---|---|
| **General: mobile** | Calendar shows dots + a day list on phones; tables scroll sideways inside their card; 16px form text (stops iPhone auto-zoom); larger tap targets; auth card and cards use smaller padding on small screens; wide text wraps instead of overflowing. |
| **General: padding/spacing** | Consistent page container (`px-4 sm:px-6`), consistent card padding, space reserved for the floating feedback button. Keyboard focus outlines were being removed globally; they are now visible for keyboard users. Browser tab title is now "FUSE Varsity". |
| **General: feedback widget** | Learners see a floating "Report a problem" button on the dashboard, schedule and assessments pages. Name, email, stack and cohort are attached **by the server from the session**, so they cannot be typed or faked. Limit: 5 messages per learner per hour. |
| **Admin: feedback section** | New **Feedback** page: Open / Resolved / All, optional resolution note, reopen, and a count badge in the navigation. |
| **Facilitator: grey out past events** | Past events are greyed (and marked "past") in calendar and list views, for facilitators and learners. |
| **Facilitator: calendar or list** | A Calendar / List switch on the facilitator Schedule tab (and the learner schedule). Assessment open/due dates appear too. |
| **Admin: default calendar per stack** | Creating a cohort now asks which stacks run and the class start time, and creates a weekly class (Weeks 1-6, on the class Saturday) for every ticked stack, plus a cohort-start marker. All editable. Can also be generated later for an existing cohort. |
| **Admin: monthly calendar** | The Schedule page shows a monthly calendar: click an event to edit, click a day to start a new event there, filter by stack. |
| **Admin: stack assessments and quizzes** | New **Assessments** page. For any week 1-6 and any stack (or all stacks): create an **assignment** (instructions + uploaded files) or a **quiz** (multiple choice, single or multiple answers, auto-graded, one attempt). |
| **Admin: frozen navbar** | The admin navigation bar is fixed at the top while the page scrolls. |
| **Admin: delete facilitators** | On **Facilitators**, pick a cohort; anyone with no stack in that cohort shows a **Delete** button. See decision 3. |
| **Admin: reminders** | Weeks 1-5: one email per open assessment the learner hasn't submitted (unchanged). Week 6: one consolidated email, only to learners who still have unsubmitted, still-open work. Submitted-but-ungraded work never triggers a reminder. |
| **Admin: capstone calendar audience** | Capstone events are always limited to learners marked **capstone-qualified** plus facilitators. Unqualified (or unconfirmed) learners never see them. |
| **Learner: editable until the deadline** | A saved submission can be changed until the deadline, even after it was graded or published. See decision 1. |
| **Learner: schedule** | New **Schedule** page with Calendar/List, their stack's classes, assessment dates and events. |
| **Learner: links** | Invitation, reminder and password-reset links now use `APP_URL`. If `APP_URL` is not set, any `*.vercel.app` origin is skipped in favour of the custom domain. |

## Part 3. Decisions I made that you should confirm

1. **"Saved and published should still be editable until the deadline" (Learner).** I read this as the *learner's* saved/graded submission. Editing is allowed until the deadline even after a grade is published; the learner is told that, the facilitator sees an **"edited after grading"** flag, and the published grade stays visible until the facilitator re-grades. If you meant something else (for example facilitators editing published grades, which was already possible), tell me.
2. **Week-6 reminders.** The existing code already only reminded learners who had **not submitted**. I made week 6 explicit and consolidated. Note: with the default dates, every standard assessment (Weeks 1-5) is due by the Sunday of week 6, so on the Wednesday and Friday of week 6 only learners with a **deadline extension** or an **admin-created later assessment** (for example a Week 6 task) will be reminded. Overdue, closed work is not reminded about because it can no longer be submitted. If you want overdue-unsubmitted learners nudged too, say so; that needs a rule for whether late submissions are accepted.
3. **"Delete" for facilitators.** The account is **deactivated** (cannot sign in; pending invites cancelled), not erased, so the grades they gave and the activity log stay attributable. They can be restored from "Removed facilitators". Deletion is blocked if they still have a stack in this cohort **or** in any other non-archived cohort (the message names it).
4. **Capstone qualification** is copied from the sheet's "Qualified for capstone?" column, only for rows that already have scores (a blank row that is pre-filled "NOT QUALIFIED" stays "not confirmed"). You can override per learner. Anyone not confirmed is treated as not qualified.
5. **Default class time** is 10:00 unless you choose another when creating the cohort or generating the calendar. I did not assume your real class times.
6. **Quizzes:** one attempt per learner, all-or-nothing per question, score scaled to the quiz's maximum score. Correct answers are never sent to learners. Questions lock after the first attempt. Quiz scores flow into progress, analytics and the learner's grade page like other assessments.
7. **Files:** PDF, Word, PowerPoint, Excel, CSV, text, PNG/JPG, ZIP; 10 MB each; up to 10 per assessment. Anything a browser would render as a web page (HTML, SVG) is refused. Learners get a short-lived download link only after the assessment opens and only for their own stack.

## Part 4. The one constraint change (migration 004)

`assessments` had `unique (cohort_id, week_number)`: one assessment per week. Stack-specific assessments need one per week **per stack**, so it is replaced by a unique index on `(cohort_id, week_number, stack)`. Every existing assessment has no stack, so every existing row still satisfies it, and the same-week-twice rule still applies within a stack. The migration test proves this on Cohort 9-shaped data.

## Part 5. Verification checklist (please run on staging first)

- [ ] `npm.cmd run migrate` prints `Applying 004...` then `Migrations up to date.`
- [ ] Cohort 9 learners still see their dashboard and assessments exactly as before.
- [ ] Create a test cohort with two stacks: Schedule shows 13 events; edit one; press "Create default calendar" again: nothing duplicates and your edit remains.
- [ ] Admin Schedule shows a monthly calendar; clicking a day pre-fills a new event; clicking an event edits it.
- [ ] Create a capstone event: a learner not marked qualified cannot see it; after setting them qualified they can; a facilitator can.
- [ ] Create a stack-specific assignment with a PDF; a learner in that stack sees the instructions and can download the file once it opens; a learner in another stack cannot.
- [ ] Create a quiz, take it as a learner (score appears at once), confirm a second attempt is refused.
- [ ] Submit, have the facilitator grade and publish, then edit the submission before the deadline: allowed, and the facilitator sees "edited after grading".
- [ ] "Report a problem" as a learner; it appears under Admin → Feedback with name, email and stack; resolve it.
- [ ] Admin → Facilitators: a facilitator with no stack in the chosen cohort can be deleted and restored.
- [ ] The invitation email's button opens `https://cohort.fusevarsity.com/claim?...`.
- [ ] Phone check: dashboard, schedule (dots + day list), assessments, feedback button; admin nav stays fixed while scrolling.
- [ ] Admin, facilitator and learner can still be signed in side by side (the earlier session fix is untouched).

## Part 6. What was not verified

Real Supabase Storage and Supabase Auth emails, real Resend delivery, and a real browser (layouts, the file picker, console errors). The automated tests use test doubles for those.
