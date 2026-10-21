const test = require('node:test');
const assert = require('node:assert');
const { lockoutDecision } = require('../src/lib/lockout');

const now = new Date('2026-11-01T10:00:00Z');

test('not locked below the threshold', () => {
  assert.equal(lockoutDecision({ emailFailures: 2, lastEmailFailureAt: now, emailThreshold: 3, now }).locked, false);
});

test('admin locks after 3 failures for 5 minutes', () => {
  const r = lockoutDecision({ emailFailures: 3, lastEmailFailureAt: new Date('2026-11-01T09:58:00Z'), emailThreshold: 3, now });
  assert.equal(r.locked, true);
  assert.equal(r.retryAfterSeconds, 180);
});

test('lock expires', () => {
  const r = lockoutDecision({ emailFailures: 3, lastEmailFailureAt: new Date('2026-11-01T09:50:00Z'), emailThreshold: 3, now });
  assert.equal(r.locked, false);
});

test('lock grows progressively and caps at 60 minutes', () => {
  const r = lockoutDecision({ emailFailures: 12, lastEmailFailureAt: now, emailThreshold: 5, now });
  assert.equal(r.retryAfterSeconds, 3600);
});

test('IP lock applies at 30 failures for 15 minutes', () => {
  const r = lockoutDecision({ ipFailures: 30, lastIpFailureAt: now, now });
  assert.equal(r.retryAfterSeconds, 900);
});