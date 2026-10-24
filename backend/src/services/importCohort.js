const { query, tx } = require('../db');
const { httpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const logger = require('../lib/logger');
const { fetchCohortRows } = require('./sheets');
const { buildStackResolver } = require('../lib/stacks');
const { planImport } = require('../lib/importPlan');

// Step 1: read the registration sheet and store a PREVIEW. Nothing about learners changes.
async function previewImport(cohort, actorId) {
  let rows;
  try {
    rows = await fetchCohortRows(cohort.number);
  } catch (e) {
    logger.error('import.sheet_read_failed', { cohort: cohort.number, message: e.message, pgCode: e.code });
    throw httpError(e.code === 'TAB_NOT_FOUND' ? 404 : 502, e.code === 'TAB_NOT_FOUND'
      ? `There is no sheet tab for Cohort ${cohort.number}. Expected a tab named "Cohort ${cohort.number} Grading".`
      : 'Could not read the registration sheet. Check the sheet is shared with the service account and try again.');
  }
  const [stacks, aliases, existingRows] = await Promise.all([
    query('select id, name from stacks where is_active'),
    query('select alias, stack_id from stack_aliases'),
    query(
      `select l.email::text as email, l.full_name, l.stack_id, l.status, l.profile_id,
              exists (select 1 from submissions s where s.learner_id = l.id) as has_submissions
       from learners l where l.cohort_id = $1`, [cohort.id]),
  ]);
  const existing = new Map(existingRows.rows.map((r) => [r.email.toLowerCase(), r]));
  const { items, summary } = planImport({ rows: rows.slice(1), startRow: 2, resolve: buildStackResolver(stacks.rows, aliases.rows), existing });

  const unmatched = [...new Map(items.filter((i) => i.action === 'error' && i.message.startsWith('Unknown stack'))
    .map((i) => [i.stackRaw, { stack: i.stackRaw, suggestion: i.suggestion }])).values()];

  const batchId = await tx(async (c) => {
    await c.query(`update import_batches set status = 'superseded' where cohort_id = $1 and status = 'previewed'`, [cohort.id]);
    const { rows: [b] } = await c.query(
      `insert into import_batches (cohort_id, source_tab, status, summary, created_by)
       values ($1, $2, 'previewed', $3, $4) returning id`, [cohort.id, `Cohort ${cohort.number} Grading`, JSON.stringify({ ...summary, unmatchedStacks: unmatched }), actorId]);
    for (const it of items) {
      await c.query(
        `insert into import_rows (batch_id, row_number, email, full_name, stack_raw, stack_id, action, requires_confirmation, message)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [b.id, it.rowNumber, it.email || null, it.fullName || null, it.stackRaw || null, it.stackId, it.action, it.requiresConfirmation, it.message]);
    }
    return b.id;
  });
  return { batchId, summary: { ...summary, unmatchedStacks: unmatched }, rows: items };
}

// Step 2: apply a previewed batch. Idempotent per batch (a committed batch cannot be applied twice) and safe to
// repeat with a fresh preview: unchanged data produces only "unchanged" rows. Stack changes need explicit confirmation.
async function commitImport(batchId, actorId, { confirmStackChanges = false } = {}) {
  const result = await tx(async (c) => {
    const { rows: [b] } = await c.query('select * from import_batches where id = $1 for update', [batchId]);
    if (!b) throw httpError(404, 'Import preview not found');
    if (b.status === 'committed') throw httpError(409, 'This import has already been applied');
    if (b.status !== 'previewed') throw httpError(409, 'This preview is out of date. Run a new preview.');
    const { rows } = await c.query(
      `select * from import_rows where batch_id = $1 and action in ('create','update') order by row_number`, [batchId]);
    const applied = { created: 0, updated: 0, heldBack: 0 };
    for (const r of rows) {
      if (r.action === 'create') {
        const ins = await c.query(
          `insert into learners (cohort_id, stack_id, full_name, email) values ($1,$2,$3,$4)
           on conflict (cohort_id, email) do nothing returning id`, [b.cohort_id, r.stack_id, r.full_name, r.email]);
        if (ins.rowCount) applied.created++;
      } else {
        if (r.requires_confirmation && !confirmStackChanges) { applied.heldBack++; continue; }
        const up = await c.query(
          `update learners set full_name = $3, stack_id = $4 where cohort_id = $1 and email = $2 and status <> 'withdrawn'`,
          [b.cohort_id, r.email, r.full_name, r.stack_id]);
        if (up.rowCount) applied.updated++;
      }
      await c.query('update import_rows set applied_at = now() where id = $1', [r.id]);
    }
    const summary = { ...b.summary, applied };
    await c.query(`update import_batches set status = 'committed', committed_at = now(), summary = $2 where id = $1`, [batchId, JSON.stringify(summary)]);
    await audit({ db: c, actorId, action: 'cohort.import_commit', entityType: 'import_batch', entityId: batchId, details: { cohortId: b.cohort_id, ...applied, confirmStackChanges } });
    return { cohortId: b.cohort_id, applied, summary };
  });
  return result;
}

module.exports = { previewImport, commitImport };
