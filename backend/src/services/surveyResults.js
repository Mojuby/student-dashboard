const { query } = require('../db');
const { mean } = require('../lib/stats');

const statusOf = (s, now = new Date()) => (!s.published ? 'draft' : new Date(s.opens_at) > now ? 'scheduled' : new Date(s.closes_at) <= now ? 'closed' : 'open');

// Aggregates one survey for the admin dashboard. Free-text answers are listed WITHOUT names; the separate "responses" view
// is where an admin sees who said what.
async function buildResults(surveyId) {
  const { rows: [s] } = await query('select id, cohort_id, kind, title, published, opens_at, closes_at from surveys where id = $1', [surveyId]);
  if (!s) return null;
  const [qs, eligible, resp, ans, photos] = await Promise.all([
    query('select id, position, kind, prompt, options, required, show_if, flag from survey_questions where survey_id = $1 order by position', [surveyId]),
    query(`select st.name as stack, count(*)::int as n from learners l join stacks st on st.id = l.stack_id where l.cohort_id = $1 and l.status <> 'withdrawn' group by st.name`, [s.cohort_id]),
    query('select r.id, st.name as stack from survey_responses r left join stacks st on st.id = r.stack_id where r.survey_id = $1', [surveyId]),
    query(`select a.response_id, a.question_id, a.value, a.moderation, a.released from survey_answers a join survey_responses r on r.id = a.response_id where r.survey_id = $1`, [surveyId]),
    query(`select p.id, l.full_name as name, st.name as stack, p.file_name from survey_photos p join learners l on l.id = p.learner_id join stacks st on st.id = l.stack_id where p.survey_id = $1 and p.consented order by l.full_name`, [surveyId]),
  ]);
  const stackOf = new Map(resp.rows.map((r) => [r.id, r.stack || 'No stack']));
  const stacks = [...new Set([...eligible.rows.map((e) => e.stack), ...resp.rows.map((r) => r.stack || 'No stack')])].sort();
  const totalEligible = eligible.rows.reduce((n, e) => n + e.n, 0);
  const byQ = new Map();
  for (const a of ans.rows) byQ.set(a.question_id, [...(byQ.get(a.question_id) || []), a]);

  const questions = qs.rows.map((q) => {
    const list = byQ.get(q.id) || [];
    const base = { id: q.id, position: q.position, kind: q.kind, prompt: q.prompt, required: q.required, flag: q.flag, n: list.length };
    if (q.kind === 'rating') {
      const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const a of list) counts[a.value.n]++;
      const nums = list.map((a) => a.value.n);
      return { ...base, low: q.options.low, high: q.options.high, counts, average: mean(nums),
        byStack: stacks.map((stack) => { const v = list.filter((a) => stackOf.get(a.response_id) === stack).map((a) => a.value.n); return { stack, n: v.length, average: mean(v) }; }) };
    }
    if (q.kind === 'yesno') return { ...base, yes: list.filter((a) => a.value.v === 'yes').length, no: list.filter((a) => a.value.v === 'no').length };
    if (q.kind === 'choice_text') {
      const counts = new Map((q.options.choices || []).map((c) => [c, 0]));
      for (const a of list) for (const c of a.value.choices || []) counts.set(c, (counts.get(c) || 0) + 1);
      return { ...base, options: [...counts.entries()].map(([label, count]) => ({ label, count })), other: list.filter((a) => a.value.text).map((a) => ({ text: a.value.text, stack: stackOf.get(a.response_id) })).slice(0, 200) };
    }
    if (q.kind === 'text') {
      const out = { ...base, responses: list.map((a) => ({ text: a.value.text, stack: stackOf.get(a.response_id) })).slice(0, 300) };
      if (q.flag === 'instructor_note') out.notes = list.map((a) => ({ id: a.response_id, text: a.value.text, stack: stackOf.get(a.response_id), flagged: a.moderation === 'flagged', released: a.released }));
      return out;
    }
    return base;
  });

  return {
    survey: { id: s.id, title: s.title, kind: s.kind, status: statusOf(s), published: s.published, opensAt: s.opens_at, closesAt: s.closes_at },
    eligible: totalEligible, responded: resp.rows.length, rate: totalEligible ? Math.round((resp.rows.length / totalEligible) * 1000) / 10 : null,
    byStack: stacks.map((stack) => ({ stack, eligible: eligible.rows.find((e) => e.stack === stack)?.n || 0, responded: resp.rows.filter((r) => (r.stack || 'No stack') === stack).length })),
    questions, photos: photos.rows,
  };
}

module.exports = { buildResults, statusOf };
