const { moderate } = require('./moderation');

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isVisible = (q, answers, byPos) => {
  if (!q.show_if) return true;
  const dep = byPos.get(q.show_if.position);
  return !!dep && answers[dep.id]?.v === q.show_if.equals;
};

// Checks a learner's answers against the survey's questions. Questions hidden by their condition are ignored (never
// required, never stored). Returns { clean: Map(questionId -> stored value), errors: [message], moderation: Map }.
function validateAnswers(questions, raw, { photoExists = false } = {}) {
  const qs = [...questions].sort((a, b) => a.position - b.position);
  const byPos = new Map(qs.map((q) => [q.position, q]));
  const seen = {}; // normalised answers used to evaluate conditions
  const clean = new Map();
  const mod = new Map();
  const errors = [];
  const fail = (q, msg) => errors.push(`Question ${q.position}: ${msg}`);

  for (const q of qs) {
    if (!isVisible(q, seen, byPos)) continue;
    const a = raw?.[q.id];
    if (q.kind === 'photo') continue; // uploaded separately
    if (q.kind === 'rating') {
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= 5) { seen[q.id] = { v: n }; clean.set(q.id, { n }); } else if (q.required) fail(q, 'choose a rating from 1 to 5');
    } else if (q.kind === 'yesno') {
      if (a === 'yes' || a === 'no') { seen[q.id] = { v: a }; clean.set(q.id, { v: a }); } else if (q.required) fail(q, 'choose Yes or No');
    } else if (q.kind === 'choice_text') {
      const allowed = new Set(q.options?.choices || []);
      const picked = [...new Set((Array.isArray(a?.choices) ? a.choices : []).filter((c) => allowed.has(c)))];
      const t = str(a?.text, 1000);
      if (picked.length || t) { seen[q.id] = { v: picked }; clean.set(q.id, { choices: picked, text: t }); } else if (q.required) fail(q, 'choose at least one option or write an answer');
    } else if (q.kind === 'text') {
      const t = str(typeof a === 'string' ? a : a?.text, 3000);
      if (t) { seen[q.id] = { v: t }; clean.set(q.id, { text: t }); if (q.flag === 'instructor_note') mod.set(q.id, moderate(t).flagged ? 'flagged' : 'clean'); } else if (q.required) fail(q, 'please write an answer');
    } else if (q.kind === 'consent') {
      if (a === true) { seen[q.id] = { v: true }; clean.set(q.id, { v: true }); } else if (photoExists) fail(q, 'tick the consent box to submit your photo, or remove the photo');
    }
  }
  return { clean, errors, moderation: mod };
}

module.exports = { validateAnswers, isVisible };
