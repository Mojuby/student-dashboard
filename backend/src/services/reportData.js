const { query } = require('../db');
const logger = require('../lib/logger');
const { computeTotals } = require('../lib/grading');
const { mean, median, pct, distribution, attended, counted, attendanceRate } = require('../lib/stats');
const { fetchCohortRows, buildDashboard } = require('./sheets');
const { loadProgress } = require('./progress');

// Everything the SYSTEM knows about a cohort. Only the parts the admin switched on are computed, so a report without
// performance / learner table never reads the grading sheet. Nothing is estimated: missing data is null and says so.
async function gatherReportData(cohortId, sections, now = new Date()) {
  const { rows: [cohort] } = await query(
    `select id, number, name, status, timezone, week1_class_date::text as week1, (week1_class_date + 35)::text as last_class from cohorts where id = $1`, [cohortId]);
  if (!cohort) return null;
  const data = { generatedAt: now.toISOString(), cohort, notices: [] };

  const { rows: learners } = await query(
    `select l.id, l.full_name as name, l.email::text as email, l.status, l.stack_id, s.name as stack, l.capstone_qualified
     from learners l join stacks s on s.id = l.stack_id where l.cohort_id = $1 order by s.name, l.full_name`, [cohortId]);
  const active = learners.filter((l) => l.status !== 'withdrawn');
  const stackNames = [...new Set(learners.map((l) => l.stack))].sort();
  data.overview = { enrolled: learners.length, active: active.length, withdrawn: learners.length - active.length, stacks: stackNames };

  if (sections.enrolment || sections.overview) {
    const byStatus = {}; const byStack = {};
    for (const l of learners) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      byStack[l.stack] = byStack[l.stack] || { total: 0, withdrawn: 0 };
      byStack[l.stack].total++;
      if (l.status === 'withdrawn') byStack[l.stack].withdrawn++;
    }
    data.enrolment = { byStatus, byStack };
  }

  const progress = (sections.assessments || sections.risk || sections.learnerTable) ? await loadProgress({ cohortId, now }) : null;
  const activeIds = new Set(active.map((l) => l.id));
  const progressLearners = (progress?.learners || []).filter((l) => activeIds.has(l.id)); // withdrawn learners are not in the figures
  const progressById = new Map(progressLearners.map((l) => [l.id, l]));

  // ---- performance: the same totals learners see (grading sheet + published platform grades + quiz scores) ----
  let perf = null;
  if (sections.performance || sections.learnerTable) {
    let rows = null;
    try { rows = await fetchCohortRows(cohort.number); } catch (e) {
      logger.warn('report.sheet_unavailable', { cohort: cohort.number, message: e.message });
      data.notices.push('The grading sheet could not be read, so grades and the performance section are not available in this report.');
    }
    if (rows) {
      const sheet = new Map(rows.slice(1).map((r) => [String(r[1] || '').trim().toLowerCase(), r]));
      const { rows: overrides } = await query(
        `select s.learner_id, a.week_number, g.score from grades g join submissions s on s.id = g.submission_id
           join assessments a on a.id = s.assessment_id where a.cohort_id = $1 and g.published_at is not null
         union all
         select qa.learner_id, a.week_number, qa.score from quiz_attempts qa join assessments a on a.id = qa.assessment_id where a.cohort_id = $1`, [cohortId]);
      const ovBy = new Map();
      for (const o of overrides) ovBy.set(o.learner_id, [...(ovBy.get(o.learner_id) || []), o]);
      perf = new Map();
      for (const l of active) {
        const row = sheet.get(l.email.toLowerCase());
        if (!row) { perf.set(l.id, { total: null, grade: null, hasScores: false }); continue; }
        const d = buildDashboard(row, cohort.number);
        for (const o of ovBy.get(l.id) || []) d.assessments[`w${o.week_number}`] = Number(o.score);
        const t = computeTotals(d);
        perf.set(l.id, { total: t.hasScores ? Number(t.total) : null, grade: t.grade, hasScores: t.hasScores });
      }
    }
  }
  if (sections.performance && perf) {
    const scored = active.filter((l) => perf.get(l.id)?.hasScores);
    const totals = scored.map((l) => perf.get(l.id).total);
    data.performance = {
      learners: active.length, scored: scored.length, notYetScored: active.length - scored.length,
      mean: mean(totals), median: median(totals), distribution: distribution(totals),
      byStack: stackNames.map((stack) => {
        const t = scored.filter((l) => l.stack === stack).map((l) => perf.get(l.id).total);
        return { stack, learners: active.filter((l) => l.stack === stack).length, scored: t.length, mean: mean(t), distribution: distribution(t) };
      }),
      noteSheet: 'Totals combine the grading sheet with grades published in the platform and quiz scores.',
    };
  }

  if (sections.assessments && progress) {
    const meta = new Map(progress.assessments.map((a) => [a.id, a]));
    const stackName = new Map(learners.map((l) => [l.stack_id, l.stack]));
    const agg = new Map();
    for (const l of progressLearners) {
      for (const c of l.cells) {
        if (!c.isEnabled || new Date(c.opensAt) > now) continue;
        const a = agg.get(c.assessmentId) || { eligible: 0, submitted: 0, scored: 0, pcts: [] };
        a.eligible++;
        if (c.submitted) a.submitted++;
        if (c.score != null) { a.scored++; a.pcts.push((c.score / c.maxScore) * 100); }
        agg.set(c.assessmentId, a);
      }
    }
    data.assessments = [...agg.entries()].map(([id, a]) => {
      const m = meta.get(id);
      return { week: m.weekNumber, title: m.title, kind: m.kind, stack: m.stackId ? stackName.get(m.stackId) || 'One stack' : 'All stacks', maxScore: m.maxScore,
        eligible: a.eligible, submitted: a.submitted, submissionRate: pct(a.submitted, a.eligible), scored: a.scored, meanScorePct: mean(a.pcts) };
    }).sort((x, y) => x.week - y.week || x.stack.localeCompare(y.stack));
  }

  let attByLearner = null;
  if (sections.attendance || sections.learnerTable) {
    const { rows: sessions } = await query(
      `select s.id, s.kind, s.week_number, s.title, s.held_on::text as held_on, st.name as stack,
              count(r.*) filter (where r.status = 'present')::int as present, count(r.*) filter (where r.status = 'late')::int as late,
              count(r.*) filter (where r.status = 'absent')::int as absent, count(r.*) filter (where r.status = 'excused')::int as excused,
              (select count(*)::int from learners l where l.cohort_id = s.cohort_id and l.status <> 'withdrawn' and (s.stack_id is null or l.stack_id = s.stack_id)) as eligible
       from attendance_sessions s left join stacks st on st.id = s.stack_id
       left join (select r.* from attendance_records r join learners l on l.id = r.learner_id and l.status <> 'withdrawn') r on r.session_id = s.id
       where s.cohort_id = $1 group by s.id, st.name order by s.held_on, s.created_at`, [cohortId]);
    const { rows: per } = await query(
      `select l.id as learner_id, count(r.*) filter (where r.status = 'present')::int as present, count(r.*) filter (where r.status = 'late')::int as late,
              count(r.*) filter (where r.status = 'absent')::int as absent, count(r.*) filter (where r.status = 'excused')::int as excused
       from learners l left join attendance_records r on r.learner_id = l.id and r.session_id in (select id from attendance_sessions where cohort_id = l.cohort_id)
       where l.cohort_id = $1 and l.status <> 'withdrawn' group by l.id`, [cohortId]);
    attByLearner = new Map(per.map((p) => [p.learner_id, p]));
    const total = { present: 0, late: 0, absent: 0, excused: 0 };
    for (const s of sessions) for (const k of Object.keys(total)) total[k] += s[k];
    data.attendance = {
      sessions: sessions.map((s) => ({ ...s, rate: attendanceRate(s), unmarked: Math.max(0, s.eligible - (s.present + s.late + s.absent + s.excused)) })),
      overallRate: attendanceRate(total), counted: counted(total), attended: attended(total),
      byStack: stackNames.map((stack) => {
        const t = { present: 0, late: 0, absent: 0, excused: 0 };
        for (const l of active.filter((x) => x.stack === stack)) { const p = attByLearner.get(l.id); if (p) for (const k of Object.keys(t)) t[k] += p[k]; }
        return { stack, rate: attendanceRate(t), counted: counted(t) };
      }),
      note: 'Present and late count as attended. Excused learners are left out of the rate. Learners not yet marked are not counted.',
    };
  }

  if (sections.risk && progress) {
    const reasonCounts = {};
    let atRisk = 0; let high = 0; let disengaged = 0;
    for (const l of progressLearners) {
      if (l.risk.status === 'at_risk') atRisk++;
      if (l.risk.highPerformer) high++;
      if (l.risk.potentiallyDisengaged) disengaged++;
      for (const r of l.risk.reasons) reasonCounts[r.code] = (reasonCounts[r.code] || 0) + 1;
    }
    data.risk = { learners: progressLearners.length, atRisk, onTrack: progressLearners.length - atRisk, highPerformers: high, potentiallyDisengaged: disengaged, reasonCounts };
  }

  if (sections.capstone) {
    const q = { qualified: 0, notQualified: 0, notConfirmed: 0 };
    for (const l of active) { if (l.capstone_qualified === true) q.qualified++; else if (l.capstone_qualified === false) q.notQualified++; else q.notConfirmed++; }
    const { rows: [g] } = await query('select count(*)::int as n from capstone_groups where cohort_id = $1', [cohortId]);
    data.capstone = { ...q, groups: g.n };
  }
  if (sections.feedback) {
    const { rows } = await query('select category, status, count(*)::int as n from feedback where cohort_id = $1 group by category, status', [cohortId]);
    data.feedback = { total: rows.reduce((s, r) => s + r.n, 0), open: rows.filter((r) => r.status === 'open').reduce((s, r) => s + r.n, 0), byCategory: rows.reduce((m, r) => ({ ...m, [r.category]: (m[r.category] || 0) + r.n }), {}) };
  }
  if (sections.facilitators) {
    // stacks.name is citext, whose array type the driver returns as a string: cast to text so it arrives as a real array.
    const { rows } = await query(
      `select p.full_name as name, array_agg(s.name::text order by s.name) as stacks from facilitator_assignments fa
       join profiles p on p.id = fa.facilitator_id join stacks s on s.id = fa.stack_id where fa.cohort_id = $1 group by p.id, p.full_name order by p.full_name`, [cohortId]);
    data.facilitators = rows;
  }
  if (sections.learnerTable) {
    data.learnerTable = active.map((l) => {
      const p = progressById.get(l.id); const pf = perf?.get(l.id); const at = attByLearner?.get(l.id);
      return { name: l.name, stack: l.stack, status: l.status, total: pf?.total ?? null, grade: pf?.grade ?? null, attendanceRate: at ? attendanceRate(at) : null, completionPct: p ? p.completionPct : null, followUp: p ? p.risk.status === 'at_risk' : null };
    });
  }
  return data;
}

module.exports = { gatherReportData };
