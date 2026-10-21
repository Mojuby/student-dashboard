alter table cohorts
  add column risk_low_score_pct integer not null default 50 check (risk_low_score_pct between 1 and 100),
  add column risk_missing_threshold integer not null default 2 check (risk_missing_threshold >= 1),
  add column reminder_hour smallint not null default 9 check (reminder_hour between 0 and 23);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  url text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, learner_id)
);

create table submission_revisions (
  id bigserial primary key,
  submission_id uuid not null references submissions(id) on delete cascade,
  url text not null,
  saved_at timestamptz not null default now()
);

create table grades (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references submissions(id) on delete cascade,
  score numeric(6,2) not null check (score >= 0),
  feedback text,
  graded_by uuid not null references profiles(id),
  graded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deadline_extensions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  new_due_at timestamptz not null,
  reason text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table capstone_groups (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  stack_id uuid references stacks(id),
  name text not null,
  whatsapp_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cohort_id, name)
);

-- learner_id is unique: one group per learner (a learner row is per cohort).
create table capstone_members (
  group_id uuid not null references capstone_groups(id) on delete cascade,
  learner_id uuid not null unique references learners(id) on delete cascade,
  primary key (group_id, learner_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  stack_id uuid references stacks(id),
  title text not null,
  description text,
  event_type text not null check (event_type in ('cohort_start','class','assessment','capstone_milestone','demo_day','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  link_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table learner_flags (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references learners(id) on delete cascade,
  kind text not null check (kind in ('support','high_performer')),
  reason text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table reminder_log (
  id bigserial primary key,
  assessment_id uuid not null references assessments(id) on delete cascade,
  learner_id uuid not null references learners(id) on delete cascade,
  slot date not null,
  status text not null check (status in ('pending','sent','failed','dry_run')),
  attempts integer not null default 1,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, learner_id, slot)
);

alter table submissions enable row level security;
alter table submission_revisions enable row level security;
alter table grades enable row level security;
alter table deadline_extensions enable row level security;
alter table capstone_groups enable row level security;
alter table capstone_members enable row level security;
alter table events enable row level security;
alter table learner_flags enable row level security;
alter table reminder_log enable row level security;