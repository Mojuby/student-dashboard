-- ROLLBACK for 005. NOT run automatically. Back up first. DROPS all recorded attendance and saved report drafts.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f 005_rollback.sql
drop table if exists attendance_records, attendance_sessions, cohort_reports cascade;
delete from schema_migrations where name = '005_attendance_reports.sql';
