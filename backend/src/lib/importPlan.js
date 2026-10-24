const { z } = require('zod');

const emailOk = z.string().email().max(254);
const clean = (v) => String(v ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();

// Turns registration-sheet rows into a per-row plan. Pure: no database, no network.
//   rows:      sheet rows WITHOUT the header (array of arrays: name, email, stack)
//   startRow:  sheet row number of rows[0] (header is row 1, so data starts at 2)
//   resolve:   from buildStackResolver
//   existing:  Map<lowercased email, { full_name, stack_id, status, profile_id, has_submissions }> for this cohort
// Actions: create | update | unchanged | skipped | error. Nothing is guessed: ambiguous rows are errors.
function planImport({ rows, startRow = 2, resolve, existing }) {
  const items = [];
  rows.forEach((r, i) => {
    const name = clean(r[0]);
    const emailRaw = clean(r[1]).toLowerCase();
    const stackRaw = clean(r[2]);
    if (!name && !emailRaw && !stackRaw) return; // blank spacer row
    items.push({ rowNumber: startRow + i, fullName: name, email: emailRaw, stackRaw, stackId: null, action: null, message: null, requiresConfirmation: false, suggestion: null });
  });

  for (const it of items) {
    if (!it.email) { it.action = 'error'; it.message = 'Missing email'; continue; }
    if (!emailOk.safeParse(it.email).success) { it.action = 'error'; it.message = 'Invalid email address'; continue; }
    if (!it.fullName) { it.action = 'error'; it.message = 'Missing name'; continue; }
    if (!it.stackRaw) { it.action = 'error'; it.message = 'Missing stack'; continue; }
    const { stack, suggestion } = resolve(it.stackRaw);
    if (!stack) {
      it.action = 'error';
      it.suggestion = suggestion;
      it.message = suggestion ? `Unknown stack "${it.stackRaw}" (did you mean "${suggestion}"? add an alias to accept it)` : `Unknown stack "${it.stackRaw}"`;
      continue;
    }
    it.stackId = stack.id;
  }

  // Duplicate emails inside the sheet: same stack -> first row wins; conflicting stacks -> all rows are errors.
  const groups = new Map();
  for (const it of items) {
    if (it.action) continue;
    groups.set(it.email, [...(groups.get(it.email) || []), it]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const rowsList = group.map((g) => g.rowNumber).join(', ');
    if (new Set(group.map((g) => g.stackId)).size > 1) {
      for (const g of group) { g.action = 'error'; g.message = `Same email appears in rows ${rowsList} with different stacks`; }
    } else {
      for (const g of group.slice(1)) { g.action = 'skipped'; g.message = `Duplicate of row ${group[0].rowNumber}`; }
    }
  }

  for (const it of items) {
    if (it.action) continue;
    const ex = existing.get(it.email);
    if (!ex) { it.action = 'create'; continue; }
    if (ex.status === 'withdrawn') { it.action = 'skipped'; it.message = 'Learner is withdrawn from this cohort; reinstate manually if intended'; continue; }
    const nameChanged = ex.full_name !== it.fullName;
    const stackChanged = ex.stack_id !== it.stackId;
    if (!nameChanged && !stackChanged) { it.action = 'unchanged'; continue; }
    it.action = 'update';
    const parts = [];
    if (nameChanged) parts.push(`name "${ex.full_name}" -> "${it.fullName}"`);
    if (stackChanged) {
      parts.push('stack changes');
      it.requiresConfirmation = true; // moving a learner between stacks is never applied silently
      if (ex.has_submissions || ex.profile_id) parts.push('learner already has an account or submissions');
    }
    it.message = parts.join('; ');
  }

  const summary = { create: 0, update: 0, unchanged: 0, skipped: 0, error: 0, needsConfirmation: 0 };
  for (const it of items) { summary[it.action]++; if (it.requiresConfirmation) summary.needsConfirmation++; }
  return { items, summary };
}

module.exports = { planImport, clean };
