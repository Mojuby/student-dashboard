const test = require('node:test');
const assert = require('node:assert');
const { reminderSlot } = require('../src/lib/reminderSchedule');
const { toUtcDate, toLocalInput } = require('../src/lib/tz');

const cfg = { timezone: 'Africa/Lagos', week1ClassDate: '2026-11-07', reminderHour: 9 };

test('Wednesday 09:30 WAT in week 1 is a reminder slot', () => {
  const r = reminderSlot({ ...cfg, now: new Date('2026-11-11T08:30:00Z') });
  assert.equal(r.slot, '2026-11-11');
  assert.equal(r.weekNumber, 1);
});
test('Friday in week 2 is a slot', () => {
  assert.equal(reminderSlot({ ...cfg, now: new Date('2026-11-20T09:00:00Z') }).weekNumber, 2);
});
test('no reminders on other days, outside the hour window, or after week 6', () => {
  assert.equal(reminderSlot({ ...cfg, now: new Date('2026-11-12T08:30:00Z') }), null); // Thursday
  assert.equal(reminderSlot({ ...cfg, now: new Date('2026-11-11T14:00:00Z') }), null); // 15:00 WAT
  assert.equal(reminderSlot({ ...cfg, now: new Date('2026-12-23T08:30:00Z') }), null); // week 7
});
test('cohort-local date/time conversion round-trips', () => {
  const d = toUtcDate('2026-11-15T23:59', 'Africa/Lagos');
  assert.equal(d.toISOString(), '2026-11-15T22:59:00.000Z');
  assert.equal(toLocalInput(d, 'Africa/Lagos'), '2026-11-15T23:59');
});