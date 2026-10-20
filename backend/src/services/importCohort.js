const { query, tx } = require('../db');
const { httpError } = require('../lib/http');
const { fetchCohortRows } = require('./sheets');
const { createInvite } = require('./invites');

async function importLearners(cohort, actorId) {
  let rows;
  try {
    rows = (await fetchCohortRows(cohort.number)).slice(1); // skip header
  } catch (e) {
    console.error('sheet read failed:', e.message);
    throw httpError(400, `Could not read the sheet tab "Cohort ${cohort.number} Grading"`);
  }
  const { rows: stackRows } = await query('select id, name from stacks where is_active');
  const stackMap = new Map(stackRows.map((s) => [s.name.toLowerCase(), s.id]));

  const valid = [];
  const unmatched = new Set();
  let skipped = 0;
  for (const r of rows) {
    const email = (r[1] || '').trim().toLowerCase();
    const name = (r[0] || '').trim();
    if (!email.includes('@') || !name) continue;
    const stackName = (r[2] || '').trim();
    const stackId = stackMap.get(stackName.toLowerCase());
    if (!stackId) { unmatched.add(stackName || '(blank)'); skipped++; continue; }
    valid.push({ name, email, stackId, stackName });
  }

  const codes = await tx(async (c) => {
    const out = [];
    for (const l of valid) {
      await c.query(
        `insert into learners (cohort_id, stack_id, full_name, email) values ($1,$2,$3,$4)
         on conflict (cohort_id, email) do update set full_name = excluded.full_name, stack_id = excluded.stack_id`,
        [cohort.id, l.stackId, l.name, l.email]
      );
      // Never rotate a code that's still usable, and skip people who already have accounts.
      const has = await c.query(
        `select 1 from profiles where email = $1
         union all
         select 1 from invites where email = $1 and role = 'learner' and used_at is null and expires_at > now()`,
        [l.email]
      );
      if (has.rowCount) continue;
      const code = await createInvite(c, { role: 'learner', email: l.email, fullName: l.name, days: 30, createdBy: actorId });
      out.push({ name: l.name, email: l.email, stack: l.stackName, code });
    }
    return out;
  });

  return { imported: valid.length, skipped, unmatchedStacks: [...unmatched], codes };
}

module.exports = { importLearners };