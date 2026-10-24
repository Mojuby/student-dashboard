require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { stackKey, buildStackResolver } = require('../src/lib/stacks');
const { planImport } = require('../src/lib/importPlan');
const { findCohortTab, cell, buildDashboard } = require('../src/services/sheets');
const { computeTotals } = require('../src/lib/grading');
const { inviteEmail } = require('../src/services/invitations');
const logger = require('../src/lib/logger');
const { sslOption } = require('../src/lib/dbssl');
const { lockoutDecision, THRESHOLDS } = require('../src/lib/lockout');

const stacks = [{ id: 'pm', name: 'Product Management' }, { id: 'da', name: 'Data Analysis' }, { id: 'dm', name: 'Digital Marketing & SEO' }];

test('stack names match regardless of case, spacing and ampersands; typos are only suggested', () => {
  assert.equal(stackKey('  Digital   Marketing & SEO '), stackKey('digital marketing and seo'));
  const r = buildStackResolver(stacks, [{ alias: 'Data Analyis', stack_id: 'da' }]);
  assert.equal(r('product management').stack.id, 'pm');
  assert.equal(r('Data Analyis ').stack.id, 'da', 'admin alias resolves the sheet spelling');
  const typo = buildStackResolver(stacks)('Data Analyis');
  assert.equal(typo.stack, null); assert.equal(typo.suggestion, 'Data Analysis', 'suggested, never applied');
  assert.deepEqual(buildStackResolver(stacks)('Underwater Basketry'), { stack: null, suggestion: null });
  assert.equal(buildStackResolver(stacks)('Digital Marketing').stack, null, 'a different stack is not silently merged');
});

const resolve = buildStackResolver(stacks);
const plan = (rows, existing = new Map()) => planImport({ rows, resolve, existing });

test('import plan: new, unchanged, name update and stack change needing confirmation', () => {
  const existing = new Map([
    ['a@x.test', { full_name: 'Ann One', stack_id: 'pm', status: 'active', profile_id: 'p1', has_submissions: true }],
    ['b@x.test', { full_name: 'Bee Two', stack_id: 'pm', status: 'enrolled' }],
    ['c@x.test', { full_name: 'Cee Three', stack_id: 'pm', status: 'enrolled' }],
    ['w@x.test', { full_name: 'Wil Four', stack_id: 'pm', status: 'withdrawn' }],
  ]);
  const { items, summary } = plan([
    ['Ann One', 'A@x.test', 'Product Management'], ['Bee  Two', 'b@x.test', 'product management'],
    ['Cee Three', 'c@x.test', 'Data Analysis'], ['New Person', 'n@x.test', 'Data Analysis'], ['Wil Four', 'w@x.test', 'Product Management'],
  ], existing);
  assert.deepEqual(items.map((i) => i.action), ['unchanged', 'unchanged', 'update', 'create', 'skipped']);
  assert.equal(items[2].requiresConfirmation, true); assert.equal(summary.needsConfirmation, 1);
  assert.match(items[4].message, /withdrawn/);
});

test('import plan: bad rows are errors, spacer rows vanish, duplicates are handled without guessing', () => {
  const { items, summary } = plan([
    ['No Mail', '', 'Product Management'], ['Bad Mail', 'nope', 'Product Management'], ['', 'noname@x.test', 'Product Management'],
    ['No Stack', 'ns@x.test', ''], [], ['', '', ''],
    ['Dup Same', 'd@x.test', 'Product Management'], ['Dup Same', 'D@x.test', 'Product Management'],
    ['Conflict', 'k@x.test', 'Product Management'], ['Conflict', 'k@x.test', 'Data Analysis'],
  ]);
  assert.equal(items.length, 8, 'blank rows ignored');
  assert.deepEqual(items.map((i) => i.action), ['error', 'error', 'error', 'error', 'create', 'skipped', 'error', 'error']);
  assert.match(items[5].message, /Duplicate of row 8/);
  assert.match(items[6].message, /different stacks/);
  assert.equal(summary.error, 6);
  assert.equal(items[0].rowNumber, 2, 'row numbers match the sheet (header is row 1)');
});

test('sheet tab lookup tolerates stray whitespace and matches the exact cohort number', () => {
  const tabs = ['ALUMNI', 'Cohort 1 Grading', 'Cohort 10 Grading ', 'Cohort 2 Grading ', 'FE - AI'];
  assert.equal(findCohortTab(tabs, 10), 'Cohort 10 Grading ', 'trailing space in the real tab name');
  assert.equal(findCohortTab(tabs, 1), 'Cohort 1 Grading', 'cohort 1 never matches cohort 10');
  assert.equal(findCohortTab(tabs, 11), null);
});

test('blank, N/A and dash cells mean "not recorded"; real zeros stay zero', () => {
  for (const v of [undefined, null, '', '  ', 'N/A', '-', 'abc']) assert.equal(cell(v), null, String(v));
  assert.equal(cell('0'), 0); assert.equal(cell(' 4.5 '), 4.5); assert.equal(cell(5), 5);
});

test('a row nobody has graded yet shows no result, even though the sheet pre-fills FAIL / NOT QUALIFIED', () => {
  const blank = buildDashboard(['Test Person', 't@x.test', 'Product Management', ...Array(14).fill(''), '0', 'FAIL', 'NOT QUALIFIED'], 10);
  assert.equal(blank.hasScores, false); assert.equal(blank.finalGrade, ''); assert.equal(blank.qualifiedForCapstone, null);
  assert.equal(blank.totals.total, null); assert.equal(blank.totals.grade, null); assert.equal(blank.attendance.class1, null);
  const real = buildDashboard(['Test Person', 't@x.test', 'Product Management', '5', '5', '0', ...Array(12).fill(''), 'A', 'QUALIFIED'], 10);
  assert.equal(real.attendance.class3, 0, 'a recorded zero is a zero');
  assert.equal(real.hasScores, true); assert.equal(real.totals.total, '10.00'); assert.equal(real.qualifiedForCapstone, true);
});

test('totals: nothing recorded gives no grade; a partial record still totals what exists', () => {
  const none = { attendance: { a: null }, assessments: { w1: null }, softSkillBonus: null, linkedinBonus: null, capstone: null };
  assert.deepEqual(computeTotals(none), { attendance: null, assessment: null, bonus: null, total: null, grade: null, hasScores: false });
  const some = computeTotals({ ...none, assessments: { w1: 4 }, capstone: 16 });
  assert.equal(some.total, '20.00'); assert.equal(some.grade, 'Fail');
});

test('invitation email carries a code in the URL fragment and never a password', () => {
  const m = inviteEmail({ fullName: 'Ada <b>Tester', email: 'ada+1@x.test', code: 'ABCDEFGH23', appUrl: 'https://app.test', cohortName: 'Cohort 10' });
  assert.match(m.text, /https:\/\/app\.test\/claim\?email=ada%2B1%40x\.test#code=ABCDEFGH23/);
  assert.ok(!/password\s*[:=]/i.test(m.text + m.html));
  assert.ok(!m.html.includes('<b>Tester'), 'names are HTML-escaped');
  assert.match(m.subject, /Cohort 10/);
});

test('logger redacts secrets by key and never throws on odd values', () => {
  const out = logger.clean({ password: 'p', token: 't', nested: { authorization: 'Bearer x', ok: 1 }, list: [{ code_hash: 'h' }], err: new Error('boom') });
  assert.equal(out.password, '[redacted]'); assert.equal(out.token, '[redacted]');
  assert.equal(out.nested.authorization, '[redacted]'); assert.equal(out.nested.ok, 1); assert.equal(out.list[0].code_hash, '[redacted]');
  assert.equal(out.err.message, 'boom');
});

test('database TLS mode: verify / no-verify / disable, anything else is rejected', () => {
  assert.deepEqual(sslOption('verify'), { rejectUnauthorized: true });
  assert.deepEqual(sslOption('no-verify'), { rejectUnauthorized: false });
  assert.equal(sslOption('disable'), false);
  assert.throws(() => sslOption('maybe'));
});

test('lockout knows every scope used by the API', () => {
  for (const s of ['admin', 'facilitator', 'learner', 'claim', 'invite_request', 'password_reset']) assert.ok(THRESHOLDS[s] > 0, s);
  const d = lockoutDecision({ emailFailures: 3, lastEmailFailureAt: new Date(), emailThreshold: THRESHOLDS.invite_request });
  assert.equal(d.locked, true);
});
