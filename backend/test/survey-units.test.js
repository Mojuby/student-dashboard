require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { moderate } = require('../src/lib/moderation');
const { validateAnswers } = require('../src/lib/surveyValidate');
const { build } = require('../src/lib/surveyTemplates');
const { describePhoto } = require('../src/services/storage');
const { mean, median, pct, attendanceRate } = require('../src/lib/stats');
const { fileNameFor, clean } = require('../src/services/reportDoc');

test('the respectful-feedback filter holds back rude notes (including disguised ones) and lets normal criticism through', () => {
  for (const rude of ['You are an idiot', 'this class is sh1t', 'F U C K this', 'stuuuupid teacher', 'what a waste of space', 'He is USELESS', 'shut up already']) {
    assert.equal(moderate(rude).flagged, true, rude);
  }
  for (const ok of ['The pace was too fast for me, please slow down.', 'Great explanations, I would like more examples.', 'Thanks for the patience with my questions', 'Dickson was helpful', '']) {
    assert.equal(moderate(ok).flagged, false, ok);
  }
});

const mid = build('mid', { number: 10, name: 'Cohort 10' });
const final = build('final', { number: 10, name: 'Cohort 10' });
const qsOf = (t) => t.questions.map((q, i) => ({ ...q, id: `q${i + 1}`, position: i + 1 }));

test('templates carry the exact questions, in order, with conditions that point at earlier questions', () => {
  assert.equal(mid.questions.length, 14); assert.equal(final.questions.length, 12);
  assert.match(mid.questions[0].prompt, /smoothness of your learning journey/);
  assert.equal(mid.questions[12].flag, 'instructor_note');
  assert.deepEqual(mid.questions[9].show_if, { position: 9, equals: 'no' });
  assert.match(final.questions[0].prompt, /Cohort 10 Bootcamp/);
  assert.match(final.questions[9].prompt, /Cohort 10 experience/);
  assert.equal(final.questions[10].kind, 'photo'); assert.equal(final.questions[11].kind, 'consent');
  for (const t of [mid, final]) for (const [i, q] of t.questions.entries()) if (q.show_if) assert.ok(q.show_if.position < i + 1, 'a condition must refer to an earlier question');
});

test('answers are validated per question type, hidden questions are ignored, required ones enforced', () => {
  const qs = qsOf(mid);
  const base = { q1: 5, q2: { choices: ['Live classes', 'Not an option'], text: ' great ' }, q3: 4, q4: 3, q5: 2, q6: { text: 'Internet' }, q8: 5, q9: 'yes', q11: 4, q12: 5 };
  const ok = validateAnswers(qs, base);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.clean.get('q2'), { choices: ['Live classes'], text: 'great' }, 'unknown options are dropped, text trimmed');
  assert.equal(ok.clean.has('q10'), false, 'the "If No, why?" question is hidden after a Yes');
  assert.ok(validateAnswers(qs, { ...base, q1: 6 }).errors[0].startsWith('Question 1'));
  assert.ok(validateAnswers(qs, { ...base, q1: 3.5 }).errors.length, 'whole numbers only');
  assert.ok(validateAnswers(qs, { ...base, q9: 'no' }).errors[0].startsWith('Question 10'), 'No makes the reason required');
  assert.deepEqual(validateAnswers(qs, { ...base, q9: 'no', q10: 'Pace' }).errors, []);
  assert.equal(validateAnswers(qs, { ...base, q9: 'yes', q10: 'ignored' }).clean.has('q10'), false);
  assert.ok(validateAnswers(qs, { ...base, q2: { choices: [], text: '' } }).errors[0].startsWith('Question 2'));
  const note = validateAnswers(qs, { ...base, q13: 'You are an idiot' });
  assert.equal(note.moderation.get('q13'), 'flagged');
  assert.equal(validateAnswers(qs, { ...base, q13: 'Please slow down' }).moderation.get('q13'), 'clean');
});

test('photo consent: a photo needs the consent box ticked, and only when the learner said Yes to sharing', () => {
  const qs = qsOf(final);
  const base = { q1: 5, q2: { choices: ['Live classes'] }, q4: 4, q5: 4, q6: 3, q7: 5, q8: 'yes', q10: 'yes' };
  assert.ok(validateAnswers(qs, base, { photoExists: true }).errors[0].startsWith('Question 12'), 'photo without consent');
  assert.deepEqual(validateAnswers(qs, { ...base, q12: true }, { photoExists: true }).errors, []);
  assert.deepEqual(validateAnswers(qs, { ...base, q10: 'no' }, { photoExists: true }).errors, [], 'said No: consent question is hidden, the photo will be dropped');
  assert.deepEqual(validateAnswers(qs, base, { photoExists: false }).errors, [], 'photo is optional');
});

test('photo uploads must really be PNG or JPEG images of 5 MB or less', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50)]);
  assert.equal(describePhoto('me.PNG', png).contentType, 'image/png'); assert.equal(describePhoto('me.jpeg', jpg).contentType, 'image/jpeg');
  assert.match(describePhoto('me.gif', png).error, /PNG or JPG/);
  assert.match(describePhoto('me.png', Buffer.from('<html>')).error, /not a valid image/);
  assert.match(describePhoto('me.png', jpg).error, /not a valid image/, 'extension must match the real type');
  assert.match(describePhoto('me.png', Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)])).error, /5 MB/);
  assert.match(describePhoto('me.png', Buffer.alloc(0)).error, /5 MB/);
});

test('report helpers: statistics never turn "no data" into zero; file names and text are made safe', () => {
  assert.equal(mean([]), null); assert.equal(median([]), null); assert.equal(pct(1, 0), null);
  assert.equal(median([1, 2, 3, 10]), 2.5); assert.equal(mean([87, 16, 52]), 51.7);
  assert.equal(attendanceRate({ present: 1, late: 1, absent: 1, excused: 5 }), 66.7, 'excused is left out');
  assert.equal(attendanceRate({ excused: 3 }), null);
  assert.equal(fileNameFor('Cohort 10: Q4 "final" report/../x'), 'Cohort-10-Q4-final-reportx.docx');
  assert.equal(fileNameFor('///'), 'Cohort-Report.docx');
  assert.equal(clean('a\u0001b\u0000c\td'), 'abc\td');
});
