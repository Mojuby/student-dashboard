require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickAppUrl } = require('../src/lib/appUrl');
const { gradeQuiz, quizSchema, publicQuestion } = require('../src/lib/quiz');
const { defaultCalendar } = require('../src/services/calendar');
const { selectReminderTargets, cohortWeek, isConsolidatedWeek } = require('../src/lib/reminderTargets');
const { describeFile, MAX_BYTES } = require('../src/services/storage');

test('emailed links use APP_URL, and never fall back to an old *.vercel.app address when a custom domain is allowed', () => {
  assert.equal(pickAppUrl({ appUrl: 'https://cohort.fusevarsity.com/', origins: ['https://old.vercel.app'] }), 'https://cohort.fusevarsity.com');
  assert.equal(pickAppUrl({ origins: ['https://student-dashboard-x.vercel.app', 'https://cohort.fusevarsity.com'] }), 'https://cohort.fusevarsity.com');
  assert.equal(pickAppUrl({ origins: ['https://only.vercel.app'] }), 'https://only.vercel.app', 'last resort');
  assert.equal(pickAppUrl({ appUrl: '  ', origins: ['not a url', 'https://cohort.fusevarsity.com'] }), 'https://cohort.fusevarsity.com');
  assert.equal(pickAppUrl({}), '');
});

const q = (over = {}) => ({ prompt: 'Which?', qtype: 'single', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: ['a'], ...over });

test('quiz validation rejects unusable questions', () => {
  assert.ok(quizSchema.safeParse({ questions: [q()] }).success);
  assert.ok(!quizSchema.safeParse({ questions: [] }).success, 'at least one question');
  assert.ok(!quizSchema.safeParse({ questions: [q({ correct: ['z'] })] }).success, 'correct must be an option');
  assert.ok(!quizSchema.safeParse({ questions: [q({ correct: ['a', 'b'] })] }).success, 'single = one answer');
  assert.ok(!quizSchema.safeParse({ questions: [q({ options: [{ id: 'a', text: 'A' }] })] }).success, 'two options minimum');
  assert.ok(!quizSchema.safeParse({ questions: [q({ options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] })] }).success, 'unique ids');
  assert.ok(quizSchema.safeParse({ questions: [q({ qtype: 'multiple', correct: ['a', 'b'] })] }).success);
});

test('quiz grading is all-or-nothing per question and scales to the max score', () => {
  const qs = [
    { id: '1', points: 1, correct: ['a'] },
    { id: '2', points: 3, correct: ['a', 'c'] },
  ];
  assert.deepEqual(gradeQuiz(qs, { 1: ['a'], 2: ['c', 'a'] }, 10), { earned: 4, total: 4, score: 10 });
  assert.equal(gradeQuiz(qs, { 1: ['a'], 2: ['a'] }, 10).score, 2.5, 'half-right multiple choice earns nothing for that question');
  assert.equal(gradeQuiz(qs, { 1: ['a', 'b'], 2: ['a', 'c'] }, 10).score, 7.5, 'extra selection is wrong');
  assert.equal(gradeQuiz(qs, {}, 10).score, 0, 'unanswered is zero, not an error');
  assert.equal(gradeQuiz(qs, { 1: 'a' }, 10).score, 0, 'malformed answers do not crash');
  assert.equal(gradeQuiz([], {}, 10).score, 0);
  assert.ok(!('correct' in publicQuestion({ id: '1', position: 1, prompt: 'p', qtype: 'single', options: [], correct: ['a'], points: '1.00' })), 'answers are never exposed');
});

test('default calendar: a class every week for every stack, at the chosen LOCAL time, stable keys', () => {
  const stacks = [{ id: 's1', name: 'Product Management' }, { id: 's2', name: 'Data Analysis' }];
  const ev = defaultCalendar({ week1ClassDate: '2026-11-07', timezone: 'Africa/Lagos', cohortName: 'Cohort 10', stacks, classTime: '09:30', durationMinutes: 90 });
  assert.equal(ev.length, 1 + 12);
  const w1 = ev.find((e) => e.defaultKey === 'default:class:w1:s1');
  assert.equal(w1.startsAt.toISOString(), '2026-11-07T08:30:00.000Z', '09:30 Lagos is 08:30 UTC');
  assert.equal(w1.endsAt - w1.startsAt, 90 * 60000);
  assert.equal(ev.find((e) => e.defaultKey === 'default:class:w6:s2').startsAt.toISOString(), '2026-12-12T08:30:00.000Z');
  assert.equal(new Set(ev.map((e) => e.defaultKey)).size, ev.length, 'keys are unique');
  assert.throws(() => defaultCalendar({ week1ClassDate: '2026-11-07', timezone: 'Africa/Lagos', cohortName: 'x', stacks, classTime: '9:30' }), /look like/);
  assert.throws(() => defaultCalendar({ week1ClassDate: '2026-11-09', timezone: 'Africa/Lagos', cohortName: 'x', stacks }), /Saturday/i);
  assert.equal(defaultCalendar({ week1ClassDate: '2026-11-07', timezone: 'Africa/Lagos', cohortName: 'x', stacks: [] }).length, 1, 'no stacks: only the cohort start');
});

test('reminders only target work that is open, unsubmitted and still submittable; ungraded never counts', () => {
  const now = new Date('2026-11-11T08:30:00Z');
  const cell = (o) => ({ isEnabled: true, submitted: false, opensAt: '2026-11-01T00:00:00Z', dueAt: '2026-11-14T00:00:00Z', weekNumber: 5, ...o });
  const learners = [
    { id: 'open', cells: [cell({})] },
    { id: 'submitted-ungraded', cells: [cell({ submitted: true })] },
    { id: 'closed', cells: [cell({ dueAt: '2026-11-08T00:00:00Z' })] },
    { id: 'not-open-yet', cells: [cell({ opensAt: '2026-11-12T00:00:00Z' })] },
    { id: 'disabled', cells: [cell({ isEnabled: false })] },
    { id: 'two', cells: [cell({ weekNumber: 5 }), cell({ weekNumber: 6 }), cell({ weekNumber: 4, submitted: true })] },
  ];
  const out = selectReminderTargets({ learners, now });
  assert.deepEqual(out.map((o) => o.learner.id), ['open', 'two']);
  assert.deepEqual(out[1].cells.map((c) => c.weekNumber), [5, 6]);
});

test('cohort week is counted from the first class Saturday in the cohort timezone; week 6 onward is consolidated', () => {
  assert.equal(cohortWeek(new Date('2026-10-04T23:30:00Z'), 'Africa/Lagos', '2026-10-03'), 1);
  assert.equal(cohortWeek(new Date('2026-10-21T08:30:00Z'), 'Africa/Lagos', '2026-10-03'), 3);
  assert.equal(cohortWeek(new Date('2026-11-11T08:30:00Z'), 'Africa/Lagos', '2026-10-03'), 6);
  assert.equal(isConsolidatedWeek(5), false); assert.equal(isConsolidatedWeek(6), true);
});

test('uploads: only listed types, 10 MB max, content type comes from the extension, names are sanitised', () => {
  assert.equal(describeFile('Brief.PDF', 1000).contentType, 'application/pdf');
  assert.match(describeFile('a.exe', 10).error, /not allowed/);
  assert.match(describeFile('x.html', 10).error, /not allowed/);
  assert.match(describeFile('x.svg', 10).error, /not allowed/);
  assert.match(describeFile('big.pdf', MAX_BYTES + 1).error, /10 MB/);
  assert.match(describeFile('empty.pdf', 0).error, /10 MB/);
  assert.equal(describeFile('../../etc/pass wd?.pdf', 10).safeName, 'pass wd_.pdf', 'no path tricks');
});
