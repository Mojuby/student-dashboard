-- 005: class attendance (weekly classes + admin-created extra classes) and saved cohort-report drafts.
-- ADDITIVE ONLY: new tables, nothing existing is altered. Preconditions: 001-004 applied.
-- Attendance is recorded and reported here; it does NOT change the sheet-based attendance points in learners' grades.
-- "Unmarked" is the absence of a row, never "absent". Rollback: backend/migrations/rollback/005_rollback.sql

create table attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  stack_id uuid references stacks(id),
  kind text not null check (kind in ('weekly', 'extra')),
  week_number smallint check (week_number between 1 and 6),
  title text not null check (char_length(title) between 2 and 120),
  held_on date not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'weekly') = (week_number is not null))
);
create unique index attendance_weekly_uniq on attendance_sessions (cohort_id, week_number) where kind = 'weekly';
create index attendance_sessions_cohort_idx on attendance_sessions (cohort_id, held_on);

create table attendance_records (
  session_id uuid not null references attendance_sessions(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  status text not null check (status in ('present', 'late', 'absent', 'excused')),
  note text check (char_length(note) <= 300),
  marked_by uuid references profiles(id),
  marked_at timestamptz not null default now(),
  primary key (session_id, learner_id)
);
create index attendance_records_learner_idx on attendance_records (learner_id);

create table cohort_reports (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  status text not null default 'draft' check (status in ('draft', 'final')),
  sections jsonb not null default '{}',
  narrative jsonb not null default '{}',
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_downloaded_at timestamptz
);
create index cohort_reports_cohort_idx on cohort_reports (cohort_id, updated_at desc);

alter table attendance_sessions enable row level security;
alter table attendance_records enable row level security;
alter table cohort_reports enable row level security;
