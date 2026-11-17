-- 006: assessment resources, facilitator change requests, and learner surveys (with photo upload and consent).
-- ADDITIVE ONLY: new tables, nothing existing is altered. Preconditions: 001-005 applied.
-- Rollback: backend/migrations/rollback/006_rollback.sql

create table assessment_resources (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  url text not null check (url ~ '^https://'),
  note text check (char_length(note) <= 500),
  position integer not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index assessment_resources_idx on assessment_resources (assessment_id, position);

-- Facilitators cannot edit assessments; they ask the admin, who makes the change and marks the request done.
create table assessment_change_requests (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  cohort_id uuid not null references cohorts(id) on delete cascade,
  requested_by uuid not null references profiles(id),
  message text not null check (char_length(message) between 5 and 2000),
  status text not null default 'open' check (status in ('open', 'implemented', 'declined')),
  admin_note text check (char_length(admin_note) <= 1000),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index change_requests_status_idx on assessment_change_requests (status, created_at desc);
create index change_requests_requester_idx on assessment_change_requests (requested_by, created_at desc);

create table surveys (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  kind text not null check (kind in ('mid', 'final', 'custom')),
  title text not null check (char_length(title) between 2 and 160),
  intro text check (char_length(intro) <= 2000),
  published boolean not null default false,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  notified_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index surveys_cohort_idx on surveys (cohort_id, opens_at desc);

create table survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  position smallint not null,
  kind text not null check (kind in ('rating', 'yesno', 'choice_text', 'text', 'photo', 'consent')),
  prompt text not null check (char_length(prompt) between 3 and 1000),
  help text check (char_length(help) <= 1000),
  options jsonb not null default '{}',
  required boolean not null default true,
  show_if jsonb,                                            -- e.g. {"position": 9, "equals": "no"}
  flag text check (flag in ('instructor_note')),            -- answers shown (anonymised, filtered) to facilitators
  unique (survey_id, position)
);

create table survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  stack_id uuid references stacks(id),
  submitted_at timestamptz not null default now(),
  unique (survey_id, learner_id)
);
create index survey_responses_survey_idx on survey_responses (survey_id);

create table survey_answers (
  response_id uuid not null references survey_responses(id) on delete cascade,
  question_id uuid not null references survey_questions(id) on delete cascade,
  value jsonb not null,
  moderation text not null default 'clean' check (moderation in ('clean', 'flagged')),
  released boolean not null default false,                  -- an admin released a flagged note to facilitators
  primary key (response_id, question_id)
);

create table survey_photos (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  size_bytes integer not null check (size_bytes > 0),
  consented boolean not null default false,
  created_at timestamptz not null default now(),
  unique (survey_id, learner_id)
);

create table survey_notifications (
  survey_id uuid not null references surveys(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  status text not null check (status in ('sent', 'dry_run', 'failed')),
  error text,
  sent_at timestamptz not null default now(),
  primary key (survey_id, learner_id)
);

alter table assessment_resources enable row level security;
alter table assessment_change_requests enable row level security;
alter table surveys enable row level security;
alter table survey_questions enable row level security;
alter table survey_responses enable row level security;
alter table survey_answers enable row level security;
alter table survey_photos enable row level security;
alter table survey_notifications enable row level security;
