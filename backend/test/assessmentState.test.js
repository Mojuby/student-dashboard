const test = require('node:test');
const assert = require('node:assert');
const { learnerStatus, effectiveDue } = require('../src/lib/assessmentState');

const opensAt = new Date('2026-11-06T23:00:00Z');
const dueAt = new Date('2026-11-15T22:59:59Z');
const base = { opensAt, dueAt, isEnabled: true, hasSubmission: false, isGraded: false };

test('locked before opening, even for a manipulated client', () => {
  assert.equal(learnerStatus({ ...base, now: new Date('2026-11-05T10:00:00Z') }), 'locked');
});
test('open inside the window', () => {
  assert.equal(learnerStatus({ ...base, now: new Date('2026-11-10T10:00:00Z') }), 'open');
});
test('closed without submission after the deadline', () => {
  assert.equal(learnerStatus({ ...base, now: new Date('2026-11-16T10:00:00Z') }), 'closed');
});
test('submitted while open, awaiting grading after the deadline, graded when graded', () => {
  assert.equal(learnerStatus({ ...base, hasSubmission: true, now: new Date('2026-11-10T10:00:00Z') }), 'submitted');
  assert.equal(learnerStatus({ ...base, hasSubmission: true, now: new Date('2026-11-16T10:00:00Z') }), 'awaiting_grading');
  assert.equal(learnerStatus({ ...base, hasSubmission: true, isGraded: true, now: new Date('2026-11-16T10:00:00Z') }), 'graded');
});
test('an extension can only move the deadline later', () => {
  assert.equal(effectiveDue(dueAt, new Date('2026-11-20T00:00:00Z')).toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(effectiveDue(dueAt, new Date('2026-11-01T00:00:00Z')).toISOString(), dueAt.toISOString());
  assert.equal(effectiveDue(dueAt, null).toISOString(), dueAt.toISOString());
});