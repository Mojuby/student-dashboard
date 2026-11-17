-- ROLLBACK for 003_multi_cohort_onboarding.sql. NOT run automatically (it lives in a sub-folder the migrator ignores).
-- Use it only if you must go back to the previous code release. Take a backup first.
--
-- 1) Make sure AT MOST ONE cohort is active. The old release only allowed one. Example (keep Cohort 10 active):
--      update cohorts set status = 'completed', is_active = false where is_active and number <> 10;
-- 2) Run this file inside a transaction:   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f 003_rollback.sql
--
-- What it does: restores the one-active-cohort rule the old code expects and removes the check constraint that would make
-- the old "Make active" button fail. It deliberately KEEPS the new columns and tables (they are additive and ignored by the
-- old code), so no learner, grade, invitation or audit data is lost. Dropping them is optional and destructive: see the end.

alter table cohorts drop constraint if exists cohorts_active_matches_status;
create unique index if not exists one_active_cohort on cohorts (is_active) where is_active;
delete from schema_migrations where name = '003_multi_cohort_onboarding.sql';

-- OPTIONAL and DESTRUCTIVE (only if you will never re-apply 003 and you accept losing this data):
--   drop table if exists orientation_progress, stack_aliases, import_rows, import_batches, grade_revisions, announcements cascade;
--   alter table grades drop column if exists published_at, drop column if exists published_by;
--   alter table invites drop column if exists learner_id, drop column if exists delivery_status, drop column if exists delivery_attempts,
--     drop column if exists delivery_error, drop column if exists sent_at;
--   alter table learners drop column if exists status, drop column if exists invited_at, drop column if exists activated_at,
--     drop column if exists orientation_completed_at, drop column if exists withdrawn_at;
--   alter table cohorts drop column if exists status, drop column if exists archived_at;
