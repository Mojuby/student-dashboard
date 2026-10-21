const test = require('node:test');
const assert = require('node:assert');
const { weeklyMetrics, funnel } = require('../src/lib/analytics');

const now = new Date('2026-12-01T00:00:00Z');
const past = '2026-11-15T00:00:00Z';
const mk = (submitted, score = null) => ({ cells: [{ assessmentId: 'a1', submitted, score, maxScore: 10, dueAt: past }] });
const learners = [mk(true, 8), mk(true, 3), mk(true), mk(false)];

test('weekly metrics are internally consistent', () => {
  const [w] = weeklyMetrics({ assessments: [{ id: 'a1', weekNumber: 1 }], learners, now, lowScorePct: 50 });
  assert.equal(w.enrolled, 4);
  assert.equal(w.submitted, 3);
  assert.equal(w.missing, 1);
  assert.equal(w.awaitingGrading, 1);
  assert.equal(w.graded, 2);
  assert.equal(w.submissionRate, 75);
  assert.equal(w.gradingRate, 66.7);
  assert.equal(w.completionRate, 50);
  assert.equal(w.avgScorePct, 55);
  assert.equal(w.lowScores, 1);
});

test('funnel stages', () => {
  const f = funnel({ learners, now });
  assert.deepEqual(f.map((s) => s.count), [4, 3, 2, 3]);
});