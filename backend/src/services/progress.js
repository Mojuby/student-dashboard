const { query } = require('../db');
const { effectiveDue, learnerStatus } = require('../lib/assessmentState');
const { evaluateRisk } = require('../lib/risk');

// One loader feeds the learner, facilitator, admin and analytics views, so numbers always agree.
// facilitatorId limits to that facilitator's assigned (cohort, stack) pairs. learnerId limits to one learner.
async function loadProgress({ cohortId, facilitatorId = null, learnerId = null, now = new Date() }) {
  const { rows: [cohort] } = await query(
    `select id, number, timezone, week1_class_date::text as week1_class_date, risk_low_score_pct, risk_missing_threshold
     from cohorts where id = $1`, [cohortId]);
  if (!cohort) return null;

  const [asm, lrn, sub, ext, flg] = await Promise.all([
    query('select id, week_number, title, max_score, opens_at, due_at, is_enabled from assessments where cohort_id = $1 order by week_number', [cohortId]),
    query(
      `select l.id, l.profile_id, l.full_name, l.email, l.stack_id, s.name as stack, g.id as group_id, g.name as group_name
       from learners l
       join stacks s on s.id = l.stack_id
       left join capstone_members m on m.learner_id = l.id
       left join capstone_groups g on g.id = m.group_id
       where l.cohort_id = $1
         and ($2::uuid is null or exists (select 1 from facilitator_assignments fa
              where fa.facilitator_id = $2 and fa.cohort_id = l.cohort_id and fa.stack_id = l.stack_id))
         and ($3::uuid is null or l.id = $3)
       order by s.name, l.full_name`, [cohortId, facilitatorId, learnerId]),
    query(
      `select sub.id, sub.assessment_id, sub.learner_id, sub.url, sub.submitted_at, sub.updated_at, gr.score, gr.feedback, gr.graded_at
       from submissions sub join assessments a on a.id = sub.assessment_id
       left join grades gr on gr.submission_id = sub.id where a.cohort_id = $1`, [cohortId]),
    query(
      `select e.assessment_id, e.learner_id, max(e.new_due_at) as due
       from deadline_extensions e join assessments a on a.id = e.assessment_id
       where a.cohort_id = $1 group by 1, 2`, [cohortId]),
    query(
      `select f.id, f.learner_id, f.kind, f.reason, f.created_at, p.full_name as by_name
       from learner_flags f join profiles p on p.id = f.created_by join learners l on l.id = f.learner_id
       where l.cohort_id = $1 and f.resolved_at is null order by f.created_at desc`, [cohortId]),
  ]);

  const assessments = asm.rows.map((a) => ({
    id: a.id, weekNumber: a.week_number, title: a.title, maxScore: Number(a.max_score),
    opensAt: a.opens_at, dueAt: a.due_at, isEnabled: a.is_enabled,
  }));
  const subMap = new Map(sub.rows.map((s) => [`${s.assessment_id}:${s.learner_id}`, s]));
  const extMap = new Map(ext.rows.map((e) => [`${e.assessment_id}:${e.learner_id}`, e.due]));
  const flagMap = new Map();
  for (const f of flg.rows) flagMap.set(f.learner_id, [...(flagMap.get(f.learner_id) || []), f]);

  const learners = lrn.rows.map((l) => {
    const cells = assessments.map((a) => {
      const s = subMap.get(`${a.id}:${l.id}`);
      const dueAt = effectiveDue(a.dueAt, extMap.get(`${a.id}:${l.id}`));
      const graded = !!s && s.score != null;
      return {
        assessmentId: a.id, weekNumber: a.weekNumber, title: a.title, maxScore: a.maxScore,
        opensAt: a.opensAt, dueAt, baseDueAt: a.dueAt, isEnabled: a.isEnabled,
        submitted: !!s, submissionId: s?.id ?? null, url: s?.url ?? null,
        submittedAt: s?.submitted_at ?? null, updatedAt: s?.updated_at ?? null,
        score: graded ? Number(s.score) : null, feedback: s?.feedback ?? null, gradedAt: s?.graded_at ?? null,
        status: learnerStatus({ now, opensAt: a.opensAt, dueAt, isEnabled: a.isEnabled, hasSubmission: !!s, isGraded: graded }),
      };
    });
    const enabled = cells.filter((c) => c.isEnabled);
    const gradedCells = enabled.filter((c) => c.score != null);
    const earned = gradedCells.reduce((t, c) => t + c.score, 0);
    const possible = gradedCells.reduce((t, c) => t + c.maxScore, 0);
    const last = gradedCells[gradedCells.length - 1];
    const activity = enabled.flatMap((c) => [c.submittedAt, c.updatedAt]).filter(Boolean).map((d) => new Date(d).getTime());
    return {
      id: l.id, profileId: l.profile_id, name: l.full_name, email: l.email, stack: l.stack, stackId: l.stack_id,
      group: l.group_name ? { id: l.group_id, name: l.group_name } : null,
      cells,
      risk: evaluateRisk({ cells: enabled, now, lowScorePct: cohort.risk_low_score_pct, missingThreshold: cohort.risk_missing_threshold }),
      completionPct: enabled.length ? Math.round((enabled.filter((c) => c.submitted).length / enabled.length) * 100) : 0,
      scorePct: possible ? Math.round((earned / possible) * 1000) / 10 : null,
      latestScore: last ? { week: last.weekNumber, score: last.score, max: last.maxScore } : null,
      lastActivityAt: activity.length ? new Date(Math.max(...activity)).toISOString() : null,
      flags: flagMap.get(l.id) || [],
    };
  });

  return { cohort, assessments, learners };
}

module.exports = { loadProgress };