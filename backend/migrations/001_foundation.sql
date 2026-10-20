create extension if not exists citext;
create type user_role as enum ('learner','facilitator','admin');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text not null,
  role user_role not null,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

create table cohorts (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  name text not null,
  timezone text not null default 'Africa/Lagos',
  week1_class_date date not null,
  default_open_offset_days integer not null default 0,
  default_due_offset_days integer not null default 8,
  reminders_enabled boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_active_cohort on cohorts ((true)) where is_active;

create table stacks (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table learners (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  cohort_id uuid not null references cohorts(id),
  stack_id uuid not null references stacks(id),
  full_name text not null,
  email citext not null,
  created_at timestamptz not null default now(),
  unique (cohort_id, email)
);
create index learners_email_idx on learners (email);

create table facilitator_assignments (
  id uuid primary key default gen_random_uuid(),
  facilitator_id uuid not null references profiles(id) on delete cascade,
  cohort_id uuid not null references cohorts(id),
  stack_id uuid not null references stacks(id),
  created_at timestamptz not null default now(),
  unique (facilitator_id, cohort_id, stack_id)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  role user_role not null check (role in ('learner','facilitator')),
  email citext not null,
  full_name text not null,
  cohort_id uuid references cohorts(id),
  stack_id uuid references stacks(id),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index invites_one_open on invites (email, role) where used_at is null;

create table login_attempts (
  id bigserial primary key,
  scope text not null,
  email_key text not null,
  ip text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_email_idx on login_attempts (scope, email_key, created_at desc);
create index login_attempts_ip_idx on login_attempts (scope, ip, created_at desc);

create table audit_log (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  week_number smallint not null check (week_number between 1 and 6),
  title text not null,
  max_score numeric(6,2) not null check (max_score > 0),
  opens_at timestamptz not null,
  due_at timestamptz not null,
  is_enabled boolean not null default true,
  unique (cohort_id, week_number),
  check (due_at > opens_at)
);

-- Deny by default: all access goes through the Express API.
alter table profiles enable row level security;
alter table cohorts enable row level security;
alter table stacks enable row level security;
alter table learners enable row level security;
alter table facilitator_assignments enable row level security;
alter table invites enable row level security;
alter table login_attempts enable row level security;
alter table audit_log enable row level security;
alter table assessments enable row level security;