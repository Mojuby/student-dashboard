const { generateCode, hashCode } = require('../lib/codes');

// `db` is anything with .query (the pool module or a transaction client).
// Replaces any still-open invite for this email+role. Only the hash is stored; the code is returned once.
async function createInviteRecord(db, { role, email, fullName, cohortId = null, stackId = null, learnerId = null, days, createdBy = null }) {
  const code = generateCode();
  await db.query('delete from invites where email = $1 and role = $2 and used_at is null', [email, role]);
  const { rows: [row] } = await db.query(
    `insert into invites (role, email, full_name, cohort_id, stack_id, learner_id, code_hash, expires_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $8::int), $9) returning id`,
    [role, email, fullName, cohortId, stackId, learnerId, hashCode(code), days, createdBy]
  );
  return { code, id: row.id };
}

const createInvite = async (db, args) => (await createInviteRecord(db, args)).code;

module.exports = { createInvite, createInviteRecord };
