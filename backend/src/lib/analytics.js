const pctOf = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

const DEFINITIONS = {
  submissionRate: 'Learners who submitted this week / learners enrolled.',
  gradingRate: 'Submissions that have a grade / submissions received.',
  completionRate: 'Learners whose submission is graded / learners enrolled.',
  missing: 'Not submitted and the deadline (including any extension) has passed.',
  pending: 'Not submitted and the deadline has not passed yet.',
  fallingBehind: 'Learners with at least one missed deadline.',
  completedAll: 'Learners who submitted every assessment whose deadline has passed.',
  note: 'A missed assessment is a follow-up signal. It does not mean a learner has dropped out.',
};

// assessments: [{ id, weekNumber }], learners: [{ cells: [{ assessmentId, submitted, score, maxScore, dueAt }] }]
function weeklyMetrics({ assessments, learners, now = new Date(), lowScorePct = 50 }) {
  return assessments.map((a) => {
    const cells = learners.map((l) => l.cells.find((c) => c.assessmentId === a.id)).filter(Boolean);
    const enrolled = learners.length;
    const submitted = cells.filter((c) => c.submitted).length;
    const gradedCells = cells.filter((c) => c.score != null);
    const pcts = gradedCells.map((c) => (c.score / c.maxScore) * 100);
    return {
      assessmentId: a.id,
      weekNumber: a.weekNumber,
      enrolled,
      submitted,
      notSubmitted: enrolled - submitted,
      missing: cells.filter((c) => !c.submitted && new Date(c.dueAt) < now).length,
      pending: cells.filter((c) => !c.submitted && new Date(c.dueAt) >= now).length,
      awaitingGrading: submitted - gradedCells.length,
      graded: gradedCells.length,
      submissionRate: pctOf(submitted, enrolled),
      gradingRate: pctOf(gradedCells.length, submitted),
      completionRate: pctOf(gradedCells.length, enrolled),
      avgScorePct: pcts.length ? Math.round((pcts.reduce((x, y) => x + y, 0) / pcts.length) * 10) / 10 : null,
      lowScores: pcts.filter((p) => p < lowScorePct).length,
    };
  });
}

function funnel({ learners, now = new Date() }) {
  const enrolled = learners.length;
  const stage = (key, label, count) => ({ key, label, count, pct: pctOf(count, enrolled) });
  const duePast = (l) => l.cells.filter((c) => new Date(c.dueAt) < now);
  return [
    stage('enrolled', 'Enrolled', enrolled),
    stage('submitted', 'Submitted at least one', learners.filter((l) => l.cells.some((c) => c.submitted)).length),
    stage('graded', 'Graded at least one', learners.filter((l) => l.cells.some((c) => c.score != null)).length),
    stage('completed', 'Submitted every due assessment', learners.filter((l) => duePast(l).length > 0 && duePast(l).every((c) => c.submitted)).length),
  ];
}

module.exports = { weeklyMetrics, funnel, DEFINITIONS, pctOf };