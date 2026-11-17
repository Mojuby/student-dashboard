const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ShadingType, Footer, PageNumber } = require('docx');

// Control characters that are not allowed in Word's XML would corrupt the file, so they are stripped from all text.
// eslint-disable-next-line no-control-regex
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
const dash = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);
const fmtDate = (iso, tz) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz || 'UTC' });
const fmtDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const STATUS_LABEL = { enrolled: 'Enrolled', invited: 'Invited', activated: 'Activated', orientation: 'In orientation', active: 'Active', completed: 'Completed', withdrawn: 'Withdrawn' };
const CATEGORY_LABEL = { bug: 'Something broken', content: 'Assessment or class problem', access: 'Cannot sign in / open something', suggestion: 'Suggestion', other: 'Other' };
const REASON_LABEL = { missed_deadline: 'Missed a deadline', consecutive_missing: 'Two consecutive assessments missing', multiple_missing: 'Several assessments missing', low_score: 'Low score', declining: 'Declining scores' };

const text = (t, opts = {}) => new TextRun({ text: clean(t), ...opts });
const lines = (t) => clean(t).split(/\r?\n/).map((l) => new Paragraph({ spacing: { after: 80 }, children: [text(l)] }));
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 }, children: [text(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [text(t)] });
const bullet = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [text(t)] });
const kv = (k, v) => new Paragraph({ spacing: { after: 40 }, children: [text(`${k}: `, { bold: true }), text(v)] });
const note = (t) => new Paragraph({ spacing: { after: 100 }, children: [text(t, { italics: true, color: '555555', size: 18 })] });
const cell = (value, { header = false, widthPct } = {}) => new TableCell({
  width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
  shading: header ? { type: ShadingType.CLEAR, fill: 'E3EAF7', color: 'auto' } : undefined,
  margins: { top: 50, bottom: 50, left: 80, right: 80 },
  children: [new Paragraph({ children: [text(dash(value), { bold: header, size: 19 })] })],
});
const table = (headers, rows, widths = []) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { header: true, widthPct: widths[i] })) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { widthPct: widths[i] })) }))],
});
const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] });

function buildChildren({ report, data, preparedBy }) {
  const S = report.sections; const N = report.narrative; const tz = data.cohort.timezone; const out = [];
  out.push(new Paragraph({ spacing: { before: 600, after: 120 }, children: [text(report.title, { bold: true, size: 44, color: '002C80' })] }));
  out.push(new Paragraph({ spacing: { after: 60 }, children: [text(`${data.cohort.name}`, { size: 28 })] }));
  out.push(kv('Generated', fmtDate(data.generatedAt, tz)));
  if (preparedBy) out.push(kv('Prepared by', preparedBy));
  out.push(kv('Status', report.status === 'final' ? 'Final' : 'Draft'));
  for (const n of data.notices) out.push(note(`Note: ${n}`));

  if (S.summary && N.summary.trim()) out.push(h1('Executive summary'), ...lines(N.summary));
  if (S.overview) {
    const o = data.overview;
    out.push(h1('Cohort overview'), kv('Cohort', `${data.cohort.name} (Cohort ${data.cohort.number})`),
      kv('Programme dates', `${fmtDay(data.cohort.week1)} to ${fmtDay(data.cohort.last_class)} (first to sixth class)`), kv('Status', data.cohort.status),
      kv('Learners', `${o.enrolled} enrolled, ${o.active} active, ${o.withdrawn} withdrawn`), kv('Stacks', o.stacks.length ? o.stacks.join(', ') : 'None recorded'));
  }
  if (S.enrolment && data.enrolment) {
    out.push(h1('Enrolment'), table(['Stack', 'Enrolled', 'Withdrawn'], Object.entries(data.enrolment.byStack).map(([k, v]) => [k, v.total, v.withdrawn]), [60, 20, 20]), spacer(), h2('Learners by status'));
    for (const [k, v] of Object.entries(data.enrolment.byStatus)) out.push(bullet(`${STATUS_LABEL[k] || k}: ${v}`));
  }
  if (S.performance) {
    out.push(h1('Learner performance'));
    const p = data.performance;
    if (!p) out.push(note('Not available: the grading sheet could not be read when this report was generated.'));
    else {
      out.push(kv('Learners with scores recorded', `${p.scored} of ${p.learners}`), kv('Average total', dash(p.mean, '%')), kv('Median total', dash(p.median, '%')), spacer(), h2('Grade distribution'),
        table(['Grade A (70+)', 'Grade B (50-69)', 'Grade C (40-49)', 'Below 40'], [[p.distribution.A, p.distribution.B, p.distribution.C, p.distribution.Fail]], [25, 25, 25, 25]), spacer(), h2('By stack'),
        table(['Stack', 'Learners', 'With scores', 'Average', 'A', 'B', 'C', 'Below 40'], p.byStack.map((s) => [s.stack, s.learners, s.scored, dash(s.mean, '%'), s.distribution.A, s.distribution.B, s.distribution.C, s.distribution.Fail]), [28, 12, 12, 12, 9, 9, 9, 9]), note(p.noteSheet));
      if (p.notYetScored) out.push(note(`${p.notYetScored} learner(s) have no scores recorded yet and are not included in the averages.`));
    }
  }
  if (S.assessments && data.assessments) {
    out.push(h1('Assessments'), table(['Week', 'Assessment', 'For', 'Submitted', 'Rate', 'Average score'],
      data.assessments.map((a) => [a.week, `${a.title}${a.kind === 'quiz' ? ' (quiz)' : ''}`, a.stack, `${a.submitted} of ${a.eligible}`, dash(a.submissionRate, '%'), dash(a.meanScorePct, '%')]), [8, 32, 16, 16, 12, 16]),
      note('Only assessments that have opened are shown. Average score is the mean of scored submissions as a percentage of the maximum.'));
  }
  if (S.attendance && data.attendance) {
    const a = data.attendance;
    out.push(h1('Attendance'));
    if (!a.sessions.length) out.push(note('No attendance has been recorded in the platform yet.'));
    else {
      out.push(kv('Overall attendance rate', a.overallRate === null ? 'Not enough marked attendance yet' : `${a.overallRate}% (${a.attended} attended of ${a.counted} counted)`), spacer(),
        table(['Class', 'Date', 'Present', 'Late', 'Absent', 'Excused', 'Not marked', 'Rate'],
          a.sessions.map((s) => [`${s.title}${s.stack ? ` (${s.stack})` : ''}${s.kind === 'extra' ? ' (extra)' : ''}`, fmtDay(s.held_on), s.present, s.late, s.absent, s.excused, s.unmarked, dash(s.rate, '%')]), [30, 14, 9, 8, 9, 10, 10, 10]),
        spacer(), h2('By stack'), table(['Stack', 'Attendance rate'], a.byStack.map((s) => [s.stack, dash(s.rate, '%')]), [60, 40]), note(a.note));
    }
  }
  if (S.risk && data.risk) {
    const r = data.risk;
    out.push(h1('Learners needing follow-up'), kv('Needing follow-up', `${r.atRisk} of ${r.learners}`), kv('On track', `${r.onTrack}`), kv('High performers', `${r.highPerformers}`), kv('Possibly disengaged', `${r.potentiallyDisengaged}`));
    const reasons = Object.entries(r.reasonCounts);
    if (reasons.length) { out.push(spacer(), h2('Why learners were flagged')); for (const [k, v] of reasons) out.push(bullet(`${REASON_LABEL[k] || k}: ${v} flag(s)`)); }
    out.push(note("Flags come from the platform's fixed follow-up rules (missed deadlines, low or declining scores). Work waiting to be graded is never counted against a learner."));
  }
  if (S.capstone && data.capstone) { const c = data.capstone; out.push(h1('Capstone'), kv('Qualified', `${c.qualified}`), kv('Not qualified', `${c.notQualified}`), kv('Not yet confirmed', `${c.notConfirmed}`), kv('Capstone groups', `${c.groups}`)); }
  if (S.feedback && data.feedback) {
    out.push(h1('Learner feedback received'), kv('Messages received', `${data.feedback.total} (${data.feedback.open} still open)`));
    for (const [k, v] of Object.entries(data.feedback.byCategory)) out.push(bullet(`${CATEGORY_LABEL[k] || k}: ${v}`));
  }
  if (S.facilitators && data.facilitators) out.push(h1('Facilitators'), table(['Facilitator', 'Stacks'], data.facilitators.map((f) => [f.name, f.stacks.join(', ')]), [40, 60]));
  if (S.learnerTable && data.learnerTable) {
    out.push(h1('Learner table'), table(['Learner', 'Stack', 'Total', 'Grade', 'Attendance', 'Completion', 'Follow-up'],
      data.learnerTable.map((l) => [l.name, l.stack, dash(l.total, '%'), dash(l.grade), dash(l.attendanceRate, '%'), dash(l.completionPct, '%'), l.followUp === null ? '—' : l.followUp ? 'Yes' : 'No']), [24, 20, 10, 10, 12, 12, 12]));
  }
  const acts = S.activities ? N.activities.filter((a) => a.title.trim() || a.description.trim()) : [];
  if (acts.length) out.push(h1('Activities held'), table(['Date', 'Activity', 'Details'], acts.map((a) => [a.date, a.title, a.description]), [16, 28, 56]));
  const risks = S.risks ? N.risks.filter((r) => r.risk.trim()) : [];
  if (risks.length) out.push(h1('Risks'), table(['Risk', 'Severity', 'How it is being handled'], risks.map((r) => [r.risk, r.severity[0].toUpperCase() + r.severity.slice(1), r.mitigation]), [40, 14, 46]));
  const lessons = S.lessons ? N.lessons.filter((l) => l.trim()) : [];
  if (lessons.length) { out.push(h1('Lessons learned')); for (const l of lessons) out.push(bullet(l)); }
  if (S.recommendations && N.recommendations.trim()) out.push(h1('Recommendations'), ...lines(N.recommendations));
  if (S.custom) for (const c of N.custom.filter((x) => x.heading.trim() && x.body.trim())) out.push(h1(c.heading), ...lines(c.body));
  return out;
}

async function buildReportDocx({ report, data, preparedBy }) {
  const doc = new Document({
    creator: 'FUSE Varsity', title: clean(report.title), styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 18, color: '666666' })] })] }) },
      children: buildChildren({ report, data, preparedBy }),
    }],
  });
  return Packer.toBuffer(doc);
}
const fileNameFor = (title) => `${clean(title).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'Cohort-Report'}.docx`;

module.exports = { buildReportDocx, fileNameFor, clean };
