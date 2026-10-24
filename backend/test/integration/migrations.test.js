const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
require('../helpers/env');
const { assertSafeTestDb } = require('../helpers/harness');
const { runMigrations } = require('../../scripts/migrate');

const url = process.env.TEST_DATABASE_URL;
const skip = !url && 'TEST_DATABASE_URL not set (needs a LOCAL Postgres whose name contains "test")';
const ADMIN = '00000000-0000-0000-0000-000000000001';
const L9 = '00000000-0000-0000-0000-000000000002';

async function fresh() {
  assertSafeTestDb(url);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth;');
  await c.query('create table auth.users (id uuid primary key default gen_random_uuid(), email text)');
  return c;
}

test('migration 003 upgrades legacy data without altering it, and is repeatable', { skip }, async () => {
  const c = await fresh();
  try {
    // Apply ONLY 001 + 002 first, as production had them before this change.
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of ['001_foundation.sql', '002_assessments_groups_calendar.sql']) fs.copyFileSync(path.join(__dirname, '../../migrations', f), path.join(legacyDir, f));
    assert.deepEqual(await runMigrations(c, { dir: legacyDir, log: () => {} }), ['001_foundation.sql', '002_assessments_groups_calendar.sql']);

    // Representative legacy data: an ACTIVE "Cohort 9" with an account holder, a pending learner, a submission and a grade;
    // plus a finished old cohort and a not-yet-started one.
    await c.query(`insert into auth.users (id,email) values ('${ADMIN}','admin@t.test'),('${L9}','l9@t.test')`);
    await c.query(`insert into profiles (id,email,full_name,role) values ('${ADMIN}','admin@t.test','Admin','admin'),('${L9}','l9@t.test','Learner Nine','learner')`);
    await c.query(`insert into cohorts (number,name,week1_class_date,is_active) values (7,'Cohort 7','2024-01-01',false),(9,'Cohort 9','2026-08-01',true),(11,'Cohort 11','2099-01-01',false)`);
    await c.query(`insert into stacks (name) values ('Product Management')`);
    await c.query(`insert into learners (cohort_id,stack_id,full_name,email,profile_id) select c.id,s.id,'Learner Nine','l9@t.test','${L9}' from cohorts c, stacks s where c.number=9`);
    await c.query(`insert into learners (cohort_id,stack_id,full_name,email) select c.id,s.id,'Pending Person','p@t.test' from cohorts c, stacks s where c.number=9`);
    await c.query(`insert into assessments (cohort_id,week_number,title,max_score,opens_at,due_at) select id,1,'W1',10,now()-interval '5 day',now()-interval '1 day' from cohorts where number=9`);
    await c.query(`insert into submissions (assessment_id,learner_id,url) select a.id,l.id,'https://docs.google.com/document/d/x' from assessments a, learners l where l.email='l9@t.test'`);
    await c.query(`insert into grades (submission_id,score,feedback,graded_by) select id,8,'good','${ADMIN}' from submissions`);

    const snap = async () => ({
      cohorts: (await c.query('select number,name,timezone,week1_class_date::text,is_active from cohorts order by number')).rows,
      learners: (await c.query('select email,full_name,profile_id,cohort_id,stack_id from learners order by email')).rows,
      grades: (await c.query('select submission_id,score::text,feedback,graded_by,graded_at from grades')).rows,
      submissions: (await c.query('select assessment_id,learner_id,url from submissions')).rows,
    });
    const before = await snap();
    assert.ok(before.cohorts.length === 3 && before.learners.length === 2 && before.grades.length === 1, 'snapshot must not be empty');

    assert.deepEqual(await runMigrations(c, { log: () => {} }), ['003_multi_cohort_onboarding.sql']);
    assert.deepEqual(await snap(), before, 'legacy columns must be identical after the upgrade');

    const st = Object.fromEntries((await c.query('select number,status,is_active from cohorts')).rows.map((r) => [r.number, r]));
    assert.equal(st[9].status, 'active'); assert.equal(st[9].is_active, true);          // Cohort 9 stays active
    assert.equal(st[7].status, 'completed'); assert.equal(st[11].status, 'upcoming');   // inactive cohorts classified by date
    const ls = Object.fromEntries((await c.query('select email,status,orientation_completed_at is not null as oriented from learners')).rows.map((r) => [r.email, r]));
    assert.equal(ls['l9@t.test'].status, 'active'); assert.equal(ls['l9@t.test'].oriented, true); // existing users skip orientation
    assert.equal(ls['p@t.test'].status, 'enrolled');
    assert.ok((await c.query('select published_at from grades')).rows[0].published_at, 'existing grades stay visible to learners');

    assert.deepEqual(await runMigrations(c, { log: () => {} }), [], 'second run applies nothing');
  } finally { await c.end(); }
});

test('schema constraints enforce the cohort, enrolment and state rules', { skip }, async () => {
  const c = await fresh();
  try {
    await runMigrations(c, { log: () => {} });
    await c.query(`insert into stacks (name) values ('Product Management')`);
    await c.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (9,'C9','2026-08-01','active',true),(10,'C10','2026-11-01','active',true)`);
    assert.equal((await c.query('select count(*)::int n from cohorts where is_active')).rows[0].n, 2, 'several cohorts may be active at once');

    await assert.rejects(c.query(`update cohorts set is_active=false where number=10`), /cohorts_active_matches_status/, 'is_active cannot drift from status');
    await assert.rejects(c.query(`update cohorts set status='nonsense' where number=10`), /status_check|violates check/);
    await assert.rejects(c.query(`insert into cohorts (number,name,week1_class_date) values (10,'dup','2026-11-01')`), /duplicate key/, 'cohort numbers stay unique');

    const ids = (await c.query(`select (select id from cohorts where number=9) c9, (select id from cohorts where number=10) c10, (select id from stacks limit 1) s`)).rows[0];
    await c.query(`insert into learners (cohort_id,stack_id,full_name,email) values ($1,$2,'A','a@t.test')`, [ids.c9, ids.s]);
    await c.query(`insert into learners (cohort_id,stack_id,full_name,email) values ($1,$2,'A','A@T.TEST')`.replace('A@T.TEST', 'a2@t.test'), [ids.c10, ids.s]);
    // the same person may be enrolled in a later cohort (history is kept)...
    await c.query(`insert into learners (cohort_id,stack_id,full_name,email) values ($1,$2,'A','a@t.test')`, [ids.c10, ids.s]);
    // ...but never twice in the same cohort, regardless of letter case.
    await assert.rejects(c.query(`insert into learners (cohort_id,stack_id,full_name,email) values ($1,$2,'A again','A@T.TEST')`, [ids.c10, ids.s]), /duplicate key/);
    await assert.rejects(c.query(`insert into learners (cohort_id,stack_id,full_name,email) values ($1,'00000000-0000-0000-0000-0000000000ff','X','x@t.test')`, [ids.c10]), /foreign key/, 'stack must exist');
    await assert.rejects(c.query(`update learners set status='registered' where email='a@t.test'`), /violates check/);
  } finally { await c.end(); }
});
