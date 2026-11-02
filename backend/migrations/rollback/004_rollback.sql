-- ROLLBACK for 004_feedback_calendar_assessments.sql. NOT run automatically. Take a backup first.
-- Run inside a transaction: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f 004_rollback.sql
--
-- Restoring the old unique (cohort_id, week_number) FAILS if any stack-specific assessment exists for a week that also has
-- a cohort-wide one (or two stacks share a week). Delete or re-week those stack-specific assessments first.
-- Quiz attempts, quiz questions, assessment files and feedback are DROPPED by this script (they only exist in 004).
-- Uploaded files in the 'assessment-files' storage bucket are not touched; remove them in the Supabase dashboard if wanted.

drop index if exists assessments_cohort_week_stack_uniq;
alter table assessments add constraint assessments_cohort_id_week_number_key unique (cohort_id, week_number);
drop table if exists feedback, quiz_attempts, quiz_questions, assessment_files, cohort_stacks cascade;
alter table assessments drop column if exists stack_id, drop column if exists kind, drop column if exists instructions, drop column if exists created_by;
drop index if exists events_default_key_uniq;
alter table events drop column if exists audience, drop column if exists default_key;
alter table learners drop column if exists capstone_qualified;
delete from schema_migrations where name = '004_feedback_calendar_assessments.sql';
