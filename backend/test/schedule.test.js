const test = require('node:test');
const assert = require('node:assert');
const { buildAssessmentSchedule } = require('../src/lib/schedule');

test('builds 5 assessments with weights 5/10/10/10/10 and no week 6', () => {
  const s = buildAssessmentSchedule({ week1ClassDate: '2026-11-07' });
  assert.deepEqual(s.map((a) => a.maxScore), [5, 10, 10, 10, 10]);
  assert.equal(s.length, 5);
});

test('week 1 opens Saturday 00:00 WAT and is due Sunday 23:59:59 WAT eight days after class', () => {
  const [w1, w2] = buildAssessmentSchedule({ week1ClassDate: '2026-11-07' });
  assert.equal(w1.opensAt.toISOString(), '2026-11-06T23:00:00.000Z');
  assert.equal(w1.dueAt.toISOString(), '2026-11-15T22:59:59.999Z');
  assert.equal(w2.opensAt.toISOString(), '2026-11-13T23:00:00.000Z');
  assert.equal(w2.dueAt.toISOString(), '2026-11-22T22:59:59.999Z');
});

test('rejects a week 1 date that is not a Saturday', () => {
  assert.throws(() => buildAssessmentSchedule({ week1ClassDate: '2026-11-08' }), /Saturday/);
});

test('rejects an invalid timezone', () => {
  assert.throws(() => buildAssessmentSchedule({ week1ClassDate: '2026-11-07', timezone: 'Nope/Zone' }), /Invalid/);
});