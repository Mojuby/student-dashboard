const { generateCode, hashCode } = require('../lib/codes');

// `db` is anything with .query (the pool module or a transaction client).
async function createInvite(db, { role, email, fullName, cohortId = null, stackId = null, days, createdBy = null }) {
  const code = generateCode();
  await db.query('delete from invites where email = $1 and role = $2 and used_at is null', [email, role]);
  await db.query(
    `insert into invites (role, email, full_name, cohort_id, stack_id, code_hash, expires_at, created_by)
     values ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7::int), $8)`,
    [role, email, fullName, cohortId, stackId, hashCode(code), days, createdBy]
  );
  return code; // returned once; only the hash is stored
}

module.exports = { createInvite };