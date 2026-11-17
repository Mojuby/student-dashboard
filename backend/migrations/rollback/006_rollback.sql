-- ROLLBACK for 006. NOT run automatically. Back up first.
-- DROPS all assessment resources, change requests, surveys, survey responses and photo records.
-- Uploaded photos in the 'survey-photos' storage bucket are NOT removed; delete them in the Supabase dashboard if wanted.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f 006_rollback.sql
drop table if exists survey_notifications, survey_photos, survey_answers, survey_responses, survey_questions, surveys,
  assessment_change_requests, assessment_resources cascade;
delete from schema_migrations where name = '006_resources_requests_surveys.sql';
