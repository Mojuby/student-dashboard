require('../src/config');
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/db');
const { createInvite } = require('../src/services/invites');

(async () => {
  const file = path.join(__dirname, 'facilitators.local.json');
  if (!fs.existsSync(file)) { console.error('Create scripts/facilitators.local.json first.'); process.exit(1); }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const i = process.argv.indexOf('--cohort');
  const { rows: [cohort] } = i > -1
    ? await query('select id, number from cohorts where number = $1', [Number(process.argv[i + 1])])
    : await query('select id, number from cohorts where is_active order by number desc limit 1');
  if (!cohort) { console.error('No cohort found. Create and activate one in /admin first.'); process.exit(1); }

  const out = [];
  for (const f of list) {
    const email = f.email.trim().toLowerCase();
    const { rows: [stack] } = await query(
      `insert into stacks (name) values ($1) on conflict (name) do update set name = stacks.name returning id`,
      [f.stack.trim()]
    );
    if ((await query('select 1 from profiles where email = $1', [email])).rowCount) {
      out.push({ name: f.fullName, stack: f.stack, email, code: '(already has an account)' });
      continue;
    }
    const code = await createInvite({ query }, {
      role: 'facilitator', email, fullName: f.fullName, cohortId: cohort.id, stackId: stack.id, days: 14,
    });
    out.push({ name: f.fullName, stack: f.stack, email, code });
  }
  console.log(`Invites for Cohort ${cohort.number} (shown once, send privately):`);
  console.table(out);
  await pool.end();
})();