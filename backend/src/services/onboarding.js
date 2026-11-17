const { query, tx } = require('../db');
const { httpError } = require('../lib/http');

const ORIENTATION_ITEMS = [
  { key: 'confirm_details', label: 'Confirm your name, email and stack are correct' },
  { key: 'review_schedule', label: 'Review your class schedule and assessment deadlines' },
  { key: 'read_expectations', label: 'Read the programme expectations: attendance, assessments and the capstone' },
  { key: 'join_community', label: 'Join your cohort community channel' },
];

async function getOrientation(learnerId) {
  const { rows } = await query('select item_key, completed_at from orientation_progress where learner_id = $1', [learnerId]);
  const done = new Map(rows.map((r) => [r.item_key, r.completed_at]));
  const items = ORIENTATION_ITEMS.map((i) => ({ ...i, completedAt: done.get(i.key) || null }));
  return { items, completed: items.filter((i) => i.completedAt).length, total: items.length };
}

// First item moves activated -> orientation; the last moves orientation -> active. Idempotent.
async function completeOrientationItem(learnerId, key) {
  if (!ORIENTATION_ITEMS.some((i) => i.key === key)) throw httpError(400, 'Unknown orientation item');
  await tx(async (c) => {
    await c.query('select 1 from learners where id = $1 for update', [learnerId]);
    await c.query('insert into orientation_progress (learner_id, item_key) values ($1,$2) on conflict do nothing', [learnerId, key]);
    const { rows: [n] } = await c.query('select count(*)::int as n from orientation_progress where learner_id = $1', [learnerId]);
    if (n.n >= ORIENTATION_ITEMS.length) {
      await c.query(
        `update learners set status = 'active', orientation_completed_at = coalesce(orientation_completed_at, now())
         where id = $1 and status in ('activated','orientation')`, [learnerId]);
    } else {
      await c.query(`update learners set status = 'orientation' where id = $1 and status = 'activated'`, [learnerId]);
    }
  });
  return getOrientation(learnerId);
}

// Admin onboarding monitor: status counts plus a searchable, paginated list with invitation delivery state.
async function onboardingOverview({ cohortId, stackId = null, q = null, status = null, page = 1, pageSize = 50 }) {
  const params = [cohortId, stackId, q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null, status];
  const filter = `l.cohort_id = $1 and ($2::uuid is null or l.stack_id = $2)
    and ($3::text is null or l.full_name ilike $3 or l.email::text ilike $3) and ($4::text is null or l.status = $4)`;
  const [counts, total, list] = await Promise.all([
    query('select status, count(*)::int as n from learners where cohort_id = $1 group by status', [cohortId]),
    query(`select count(*)::int as n from learners l where ${filter}`, params),
    query(
      `select l.id, l.full_name, l.email, s.name as stack, l.status, l.invited_at, l.activated_at, l.orientation_completed_at,
              i.delivery_status, i.delivery_error, i.delivery_attempts, i.expires_at as invite_expires_at, i.sent_at,
              (i.id is not null and i.used_at is null and i.expires_at <= now()) as invite_expired
       from learners l join stacks s on s.id = l.stack_id
       left join lateral (select * from invites i where i.learner_id = l.id order by i.created_at desc limit 1) i on true
       where ${filter} order by l.full_name limit $5 offset $6`, [...params, pageSize, (page - 1) * pageSize]),
  ]);
  return {
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    total: total.rows[0].n, page, pageSize,
    learners: list.rows,
  };
}

module.exports = { ORIENTATION_ITEMS, getOrientation, completeOrientationItem, onboardingOverview };
