-- 003: successive/concurrent cohorts, onboarding states, import batches, invitation delivery tracking,
-- grade publishing, announcements and orientation.
--
-- ADDITIVE. Preconditions: 001 and 002 applied. Nothing is dropped except the one-active-cohort index.
-- The business rule that index enforced ("only one cohort may log in at a time") is replaced by an explicit
-- cohort lifecycle (cohorts.status). is_active is kept as a mirror of status = 'active' (enforced by a check
-- constraint) so existing queries keep working.
-- Postconditions: every existing cohort/learner/grade row is preserved; learners with accounts are 'active' and
-- are not sent through orientation; grades that learners could already see stay visible (published).
-- Forward recovery: all changes are additive columns/tables; to back out, deploy the previous code (it ignores
-- the new columns) and, if the one-active rule must return, recreate the index after setting status/is_active.

-- ---------------------------------------------------------------- cohort lifecycle
alter table cohorts
  add column status text not null default 'upcoming' check (status in ('upcoming', 'active', 'completed', 'archived')),
  add column archived_at timestamptz;

-- Active stays active. An inactive cohort that has not started yet is upcoming; otherwise it is completed.
update cohorts set status = case
  when is_active then 'active'
  when week1_class_date > current_date then 'upcoming'
  else 'completed' end;

alter table cohorts add constraint cohorts_active_matches_status check (is_active = (status = 'active'));
drop index if exists one_active_cohort;
create index cohorts_status_idx on cohorts (status);

-- ---------------------------------------------------------------- learner enrolment / onboarding state
-- Three separate concepts: account state (profiles.is_active), cohort state (cohorts.status) and this enrolment state.
--   enrolled -> invited -> activated -> orientation -> active -> completed | withdrawn
-- "Registered / awaiting verification" are not modelled here: eligibility and payment are checked outside the LMS and
-- a learner's presence in the registration sheet is what creates the enrolment.
alter table learners
  add column status text not null default 'enrolled'
    check (status in ('enrolled', 'invited', 'activated', 'orientation', 'active', 'completed', 'withdrawn')),
  add column invited_at timestamptz,
  add column activated_at timestamptz,
  add column orientation_completed_at timestamptz,
  add column withdrawn_at timestamptz;

update learners l set
  status = case
    when l.profile_id is not null then 'active'
    when exists (select 1 from invites i where i.email = l.email and i.role = 'learner') then 'invited'
    else 'enrolled' end,
  activated_at = case when l.profile_id is not null then l.created_at end,
  orientation_completed_at = case when l.profile_id is not null then l.created_at end,
  invited_at = (select min(i.created_at) from invites i where i.email = l.email and i.role = 'learner');

create index learners_cohort_stack_idx on learners (cohort_id, stack_id);
create index learners_cohort_status_idx on learners (cohort_id, status);
create index learners_profile_idx on learners (profile_id) where profile_id is not null;

create table orientation_progress (
  learner_id uuid not null references learners(id) on delete cascade,
  item_key text not null,
  completed_at timestamptz not null default now(),
  primary key (learner_id, item_key)
);

-- ---------------------------------------------------------------- invitations: bound to an enrolment, delivery tracked
alter table invites
  add column learner_id uuid references learners(id) on delete set null,
  add column delivery_status text not null default 'not_sent' check (delivery_status in ('not_sent', 'sent', 'dry_run', 'failed')),
  add column delivery_attempts integer not null default 0,
  add column delivery_error text,
  add column sent_at timestamptz;
create index invites_learner_idx on invites (learner_id);

-- ---------------------------------------------------------------- registration import batches
create table stack_aliases (
  alias citext primary key,
  stack_id uuid not null references stacks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id),
  source text not null default 'google_sheet',
  source_tab text,
  status text not null check (status in ('previewed', 'committed', 'failed', 'superseded')),
  summary jsonb not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index import_batches_cohort_idx on import_batches (cohort_id, created_at desc);

create table import_rows (
  id bigserial primary key,
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_number integer not null,
  email citext,
  full_name text,
  stack_raw text,
  stack_id uuid references stacks(id),
  action text not null check (action in ('create', 'update', 'unchanged', 'skipped', 'error')),
  requires_confirmation boolean not null default false,
  message text,
  applied_at timestamptz
);
create index import_rows_batch_idx on import_rows (batch_id, row_number);

-- ---------------------------------------------------------------- grades: draft vs published, with history
alter table grades
  add column published_at timestamptz,
  add column published_by uuid references profiles(id);
-- Anything a learner could already see stays visible.
update grades set published_at = graded_at where published_at is null;

create table grade_revisions (
  id bigserial primary key,
  grade_id uuid not null references grades(id) on delete cascade,
  score numeric(6, 2) not null,
  feedback text,
  published boolean not null,
  changed_by uuid not null references profiles(id),
  changed_at timestamptz not null default now()
);
create index grade_revisions_grade_idx on grade_revisions (grade_id, changed_at desc);

-- ---------------------------------------------------------------- announcements
create table announcements (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  stack_id uuid references stacks(id),
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index announcements_cohort_idx on announcements (cohort_id, created_at desc);

-- ---------------------------------------------------------------- indexes for demonstrated hot filters
create index submissions_learner_idx on submissions (learner_id);
create index deadline_extensions_idx on deadline_extensions (assessment_id, learner_id);
create index learner_flags_learner_idx on learner_flags (learner_id) where resolved_at is null;
create index events_cohort_start_idx on events (cohort_id, starts_at);
create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);

alter table orientation_progress enable row level security;
alter table stack_aliases enable row level security;
alter table import_batches enable row level security;
alter table import_rows enable row level security;
alter table grade_revisions enable row level security;
alter table announcements enable row level security;
