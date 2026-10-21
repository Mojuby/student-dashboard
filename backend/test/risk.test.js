const test = require('node:test');
const assert = require('node:assert');
const { evaluateRisk } = require('../src/lib/risk');

const now = new Date('2026-12-01T00:00:00Z');
const past = '2026-11-15T00:00:00Z';
const future = '2026-12-20T00:00:00Z';
const cell = (weekNumber, o = {}) => ({ weekNumber, maxScore: 10, dueAt: past, submitted: false, score: null, ...o });

test('an ungraded submission is never a risk signal', () => {
  const r = evaluateRisk({ cells: [cell(1, { submitted: true })], now });
  assert.equal(r.status, 'on_track');
});

test('missed deadlines give explicit reasons, including consecutive weeks', () => {
  const r = evaluateRisk({ cells: [cell(1), cell(2), cell(3, { dueAt: future })], now });
  const codes = r.reasons.map((x) => x.code);
  assert.ok(codes.includes('missed_deadline'));
  assert.ok(codes.includes('consecutive_missing'));
  assert.ok(r.reasons.some((x) => x.text === 'Missed Week 1 deadline.'));
  assert.equal(r.potentiallyDisengaged, true);
});

test('a single missed week is flagged but not "disengaged"', () => {
  const r = evaluateRisk({ cells: [cell(1, { submitted: true, score: 8 }), cell(2)], now });
  assert.equal(r.status, 'at_risk');
  assert.equal(r.potentiallyDisengaged, false);
});

test('low and declining scores', () => {
  const low = evaluateRisk({ cells: [cell(1, { submitted: true, score: 2 })], now, lowScorePct: 50 });
  assert.ok(low.reasons.some((x) => x.code === 'low_score'));
  const dec = evaluateRisk({ cells: [cell(1, { submitted: true, score: 9 }), cell(2, { submitted: true, score: 5 })], now });
  assert.ok(dec.reasons.some((x) => x.code === 'declining'));
});

test('high performer needs two graded assessments averaging 85%+', () => {
  const r = evaluateRisk({ cells: [cell(1, { submitted: true, score: 9 }), cell(2, { submitted: true, score: 9 })], now });
  assert.equal(r.highPerformer, true);
});