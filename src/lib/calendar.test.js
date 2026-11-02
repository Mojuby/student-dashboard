import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, groupByDay, isPast, monthCells, monthLabel, timeLabel, typeStyle } from './calendar.js';

test('days are grouped in the COHORT timezone, so a late class never lands on the wrong date', () => {
  // 23:30 UTC on the 7th is already 00:30 on the 8th in Lagos (UTC+1).
  assert.equal(dayKey('2026-11-07T23:30:00Z', 'Africa/Lagos'), '2026-11-08');
  assert.equal(dayKey('2026-11-07T23:30:00Z', 'UTC'), '2026-11-07');
  assert.equal(dayKey('2026-11-07T08:30:00Z', 'Africa/Lagos'), '2026-11-07');
  assert.match(timeLabel('2026-11-07T08:30:00Z', 'Africa/Lagos'), /9:30\s?am/i);
});

test('month grid: 6 weeks starting on a Sunday, flags days outside the month', () => {
  const cells = monthCells(2026, 10); // November 2026 (month index 10)
  assert.equal(cells.length, 42);
  assert.equal(new Date(`${cells[0].key}T12:00:00Z`).getUTCDay(), 0, 'starts on Sunday');
  assert.equal(cells.filter((c) => c.inMonth).length, 30);
  assert.equal(cells.find((c) => c.inMonth).day, 1);
  assert.equal(cells.find((c) => c.key === '2026-11-07').inMonth, true);
  const jan = monthCells(2027, 0); // year boundary
  assert.equal(jan.filter((c) => c.inMonth).length, 31);
  assert.ok(jan[0].key.startsWith('2026-12'), 'leading days come from December');
  assert.equal(monthLabel(2026, 10), 'November 2026');
});

test('events are sorted and grouped by local day; past events are detected by their END time', () => {
  const evs = [
    { title: 'late', startsAt: '2026-11-07T23:30:00Z' }, { title: 'early', startsAt: '2026-11-07T08:30:00Z' }, { title: 'next day', startsAt: '2026-11-09T08:30:00Z' },
  ];
  const g = groupByDay(evs, 'Africa/Lagos');
  assert.deepEqual([...g.keys()], ['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.deepEqual(g.get('2026-11-07').map((e) => e.title), ['early']);
  const now = new Date('2026-11-07T09:00:00Z');
  assert.equal(isPast({ startsAt: '2026-11-07T08:30:00Z', endsAt: '2026-11-07T10:00:00Z' }, now), false, 'still running');
  assert.equal(isPast({ startsAt: '2026-11-07T08:30:00Z', endsAt: '2026-11-07T08:45:00Z' }, now), true);
  assert.equal(isPast({ startsAt: '2026-11-07T08:30:00Z' }, now), true, 'no end time: judged by start');
  assert.equal(isPast({ startsAt: '2026-11-08T08:30:00Z' }, now), false);
});

test('unknown event types fall back to a neutral style', () => {
  assert.ok(typeStyle('class').includes('blue'));
  assert.equal(typeStyle('something-new'), typeStyle('other'));
});
