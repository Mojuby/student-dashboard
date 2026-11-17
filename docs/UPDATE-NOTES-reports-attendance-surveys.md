# Update notes: reports, attendance, assessment resources, surveys

Applies on top of branch `cohort10-stabilization` at commit `300c94b`. Read Part 1 before releasing.

## Part 1. Deploy order

1. **Back up the database.**
2. **Install the new dependency** (the report download needs it). In `backend`: `npm.cmd install` (or `npm.cmd ci`). Also run `npm.cmd install` in the project root for the frontend.
3. **Run the migrations** from `backend` with `DATABASE_URL` set: `npm.cmd run migrate`. It applies two files, both **additive** (new tables only, nothing existing is changed):
   - `005_attendance_reports.sql` (attendance and saved report drafts)
   - `006_resources_requests_surveys.sql` (assessment resources, change requests, surveys)
   Rollbacks: `backend/migrations/rollback/005_rollback.sql` and `006_rollback.sql`.
4. **Deploy the backend, then the frontend** (same commit).
5. **Scheduled job.** If you already run a Render Cron Job for `npm run reminders`, nothing to change: it now also emails learners when a published survey opens. If you do not run one yet, create it (hourly) so scheduled surveys are emailed automatically. (The "Open now and email learners" button works without it.)
6. **Storage.** A second **private** Supabase Storage bucket, `survey-photos`, is created automatically the first time a learner uploads a survey photo. Nothing to set up.

## Part 2. What is new

| Request | What you get |
|---|---|
| **Cohort report** | Admin → **Reports**. Pick a cohort, tick which computed sections to include (overview, enrolment, performance, assessments, attendance, follow-up counts, capstone, feedback, facilitators, optional learner table), and write the parts only you know: executive summary, activities held, risks, lessons learned, recommendations, and your own headed sections. **Save draft** as often as you like (two people editing the same draft cannot overwrite each other), **Preview figures**, then **Download Word document**. |
| **Attendance** | Admin → **Attendance**. The six weekly classes exist automatically (dated on the class Saturdays). Mark each learner Present / Late / Absent / Excused with an optional note, or "Mark shown as present" then fix exceptions. **Add an extra class** (whole cohort or one stack) only to record attendance. An Overview grid shows every learner across every class with their rate. |
| **Past deadline** | Extending a learner's deadline now requires a date in the future (checked on screen and on the server). |
| **Resources** | When creating an assessment, add resource links (title, https link, note). Also manageable later under **Manage**. Learners see them on the assessment. |
| **Facilitator view and requests** | Facilitator → **Assessments and resources**: every week's assessment for their stacks with instructions, files and resources, read-only. **Request a change** sends it to the admin. Admin → Assessments shows an inbox (with a count badge): make the change on the assessment (live for learners immediately), then **Mark as done** or **Decline** with a note. The facilitator sees the status. |
| **Surveys** | Admin → **Surveys**. Create the **Mid-bootcamp** or **Final** survey from the built-in templates (your exact questions), set when it opens and closes, publish. **Open now and email learners**, or let the scheduled job email learners when it opens. Learners see it under **Surveys** (and a card on their dashboard). Admin gets a **Dashboard** (charts per question, by stack), **Responses** (with names) and **Setup**. |
| **Instructor notes** | The "note for your instructor" answers appear for facilitators under **Student feedback**: anonymous, filtered for respectfulness, only after the survey closes. |
| **Final survey photo** | Optional photo upload (PNG/JPG, 5 MB) that is kept only if the learner answers Yes **and** ticks the consent statement. Otherwise it is deleted. Only admins can view consented photos. |

## Part 3. Decisions to confirm

1. **Survey answer options were not in your list.** For the "areas of the bootcamp" questions I used sensible defaults (e.g. Live classes, Assessments and assignments, Facilitator support, Learning resources, Capstone project, Community, Career sessions, Quizzes; and for challenges: Understanding class content, Deadlines, Learning platform, Communication channels, Workload, Joining online classes, Group work, Getting help). **Edit them under Surveys → Setup before you open the survey**; they lock once the first response arrives. The rating labels (1 = ..., 5 = ...) are also editable.
2. **"Rude feedback filtered".** A word-based filter holds back notes containing insults or profanity (including disguised spellings) from the facilitator. It is a simple filter, not a judge of tone: it will miss some rudeness and may hold back harmless notes. Nothing is deleted. Admins see every note with a flag and can **Release** or **Hide** it.
3. **Anonymity for facilitators.** No names, dates or order clues. A stack's notes appear only once **at least 3** learners in it have responded, and only after the survey closes, so one learner cannot be identified. Say if you want a different number.
4. **Survey eligibility.** Only learners in the cohort with an activated account and not withdrawn are emailed and counted in the response rate.
5. **Attendance does not change grades.** It is recorded and reported only. Learners' attendance points still come from the grading sheet, as before. Tell me if you want present = full weekly points to flow into the grade.
6. **Report grades** are the same totals learners see (grading sheet + published platform grades + quiz scores). The report does not label anyone "passed" or "failed", only the grade spread.
7. **Resources** are visible to learners as soon as the assessment is listed (study material), unlike instructions and files, which appear when it opens.
8. **A bug fixed on the way:** reminder emails were also going to **withdrawn** learners. They no longer do (covered by a test).
9. **Not built:** a free-form survey builder. Surveys come from the two templates, with editable wording and options.

## Part 4. Verification checklist (try on staging first)

- [ ] `npm.cmd run migrate` prints `Applying 005...` and `Applying 006...`; Cohort 9 learners still see everything as before.
- [ ] Reports: create a report, write a risk and a lesson, save the draft, reload the page, download the Word file and open it.
- [ ] Attendance: open Attendance; mark a weekly class; add an extra class and mark it; check the Overview grid.
- [ ] Extend a learner's deadline to a past date: refused. A future date: accepted.
- [ ] Create an assessment with two resource links; a learner in that stack sees them; a learner in another stack does not.
- [ ] As a facilitator, request a change; the admin sees it with a badge, edits the assessment, marks it done; the facilitator sees "Done".
- [ ] Create a Mid-bootcamp survey, **Open now and email learners** (use two test learners). As a learner, fill it in: answering "No" to the expectations question requires a reason. Check the Dashboard and Responses.
- [ ] Final survey: upload a photo, say Yes without ticking consent (blocked), then tick it (accepted). A learner who says No has no photo kept.
- [ ] After a survey closes, the facilitator's **Student feedback** tab shows anonymous notes (once 3 learners in the stack responded).

## Part 5. Not verified

Real Supabase Storage (survey photos), real Resend email delivery, and a real browser (layouts, file pickers, the Word file opened in Word). The automated tests use test doubles for those.
