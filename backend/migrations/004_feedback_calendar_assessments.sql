-- 004: learner feedback, cohort stacks + default calendar, stack-specific assessments (assignments and quizzes, with
-- instructions and files), and capstone-qualified audiences for calendar events.
--
-- ADDITIVE. Preconditions: 001-003 applied. The ONE constraint changed is assessments' unique (cohort_id, week_number):
-- it is replaced by a unique index on (cohort_id, week_number, stack) so one cohort can hold a cohort-wide assessment AND
-- stack-specific ones for the same week. Every existing assessment keeps stack_id NULL (cohort-wide), so every existing
-- row is still unique under the new index and nothing about Cohort 9 / Cohort 10 changes.
-- Postconditions: all existing rows preserved; existing assessments are kind 'assignment'; existing events are audience
-- 'everyone'; existing learners have capstone_qualified NULL (unknown) until an admin syncs it from the sheet.
-- Rollback: backend/migrations/rollback/004_rollback.sql

-- ---------------------------------------------------------------- which stacks run in which cohort
create table cohort_stacks (
  cohort_id uuid not null references cohorts(id) on delete cascade,
  stack_id uuid not null references stacks(id),
  created_at timestamptz not null default now(),
  primary key (cohort_id, stack_id)
);
insert into cohort_stacks (cohort_id, stack_id) select distinct cohort_id, stack_id from learners on conflict do nothing;
insert into cohort_stacks (cohort_id, stack_id) select distinct cohort_id, stack_id from facilitator_assignments on conflict do nothing;

-- ---------------------------------------------------------------- events: audience + idempotent default calendar
alter table events
  add column audience text not null default 'everyone' check (audience in ('everyone', 'capstone')),
  add column default_key text;
create unique index events_default_key_uniq on events (cohort_id, default_key) where default_key is not null;

alter table learners add column capstone_qualified boolean; -- NULL = not yet synced / unknown

-- ---------------------------------------------------------------- stack-specific assessments, quizzes, files
alter table assessments
  add column stack_id uuid references stacks(id),
  add column kind text not null default 'assignment' check (kind in ('assignment', 'quiz')),
  add column instructions text,
  add column created_by uuid references profiles(id);

-- Drop the old unique (cohort_id, week_number) whatever it was named, then enforce uniqueness per stack instead.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'assessments'::regclass and contype = 'u'
     and (select array_agg(attname::text order by attname::text) from pg_attribute
           where attrelid = conrelid and attnum = any (conkey)) = array['cohort_id', 'week_number'];
  if c is not null then execute format('alter table assessments drop constraint %I', c); end if;
end $$;
create unique index assessments_cohort_week_stack_uniq
  on assessments (cohort_id, week_number, coalesce(stack_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index assessments_cohort_stack_idx on assessments (cohort_id, stack_id);

create table assessment_files (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index assessment_files_assessment_idx on assessment_files (assessment_id);

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  position smallint not null,
  prompt text not null,
  qtype text not null check (qtype in ('single', 'multiple')),
  options jsonb not null,
  correct jsonb not null,
  points numeric(6, 2) not null default 1 check (points > 0),
  unique (assessment_id, position)
);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  answers jsonb not null,
  points_earned numeric(6, 2) not null,
  points_total numeric(6, 2) not null,
  score numeric(6, 2) not null,
  submitted_at timestamptz not null default now(),
  unique (assessment_id, learner_id)
);
create index quiz_attempts_learner_idx on quiz_attempts (learner_id);

-- ---------------------------------------------------------------- learner feedback
-- name/email/stack/cohort are SNAPSHOTS taken server-side from the signed-in learner, so they cannot be spoofed and stay
-- correct even if the learner is later withdrawn or the stack is renamed.
create table feedback (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid references learners(id) on delete set null,
  profile_id uuid references profiles(id) on delete set null,
  cohort_id uuid references cohorts(id) on delete set null,
  name text not null,
  email citext not null,
  stack text,
  cohort_name text,
  category text not null check (category in ('bug', 'content', 'access', 'suggestion', 'other')),
  message text not null check (char_length(message) between 5 and 2000),
  page_url text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index feedback_status_idx on feedback (status, created_at desc);
create index feedback_learner_idx on feedback (learner_id, created_at desc);

alter table cohort_stacks enable row level security;
alter table assessment_files enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;
alter table feedback enable row level security;
