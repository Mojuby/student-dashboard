const round1 = (n) => Math.round(n * 10) / 10;
const WEIGHTS = { consecutive_missing: 3, multiple_missing: 2, missed_deadline: 1, low_score: 1, declining: 1 };
const severity = (reasons) => reasons.reduce((s, r) => s + (WEIGHTS[r.code] || 1), 0);

// Transparent rules only. An ungraded submission is never a risk signal.
// cells: [{ weekNumber, maxScore, dueAt, submitted, score }] sorted by week, enabled assessments only.
function evaluateRisk({ cells, now = new Date(), lowScorePct = 50, missingThreshold = 2 }) {
  const reasons = [];
  const missed = cells.filter((c) => !c.submitted && new Date(c.dueAt) < now);

  for (const c of missed) {
    reasons.push({ code: 'missed_deadline', week: c.weekNumber, text: `Missed Week ${c.weekNumber} deadline.`, action: `Check in about the missed Week ${c.weekNumber} deadline.` });
  }
  const consecutive = missed.some((c, i) => missed[i + 1] && missed[i + 1].weekNumber === c.weekNumber + 1);
  if (consecutive) {
    reasons.push({ code: 'consecutive_missing', text: 'Two consecutive assessments missing.', action: 'Contact the learner: they have fallen behind the schedule.' });
  } else if (missed.length >= missingThreshold) {
    reasons.push({ code: 'multiple_missing', text: `${missed.length} assessments missing.`, action: 'Contact the learner: they have fallen behind the schedule.' });
  }

  const graded = cells.filter((c) => c.score != null).map((c) => ({ week: c.weekNumber, pct: (c.score / c.maxScore) * 100 }));
  for (const g of graded) {
    if (g.pct < lowScorePct) {
      reasons.push({ code: 'low_score', week: g.week, text: `Week ${g.week} score (${round1(g.pct)}%) is below the ${lowScorePct}% threshold.`, action: 'Review the low score and offer support.' });
    }
  }
  if (graded.length >= 2) {
    const [a, b] = graded.slice(-2);
    if (a.pct - b.pct >= 20) {
      reasons.push({ code: 'declining', week: b.week, text: `Score declined from ${round1(a.pct)}% (Week ${a.week}) to ${round1(b.pct)}% (Week ${b.week}).`, action: 'Check in about the drop in performance.' });
    }
  }

  const avgPct = graded.length ? round1(graded.reduce((s, g) => s + g.pct, 0) / graded.length) : null;
  return {
    status: reasons.length ? 'at_risk' : 'on_track',
    reasons,
    avgPct,
    missedCount: missed.length,
    highPerformer: graded.length >= 2 && avgPct >= 85,
    // "Potentially disengaged" is a label for follow-up, never a conclusion that someone dropped out.
    potentiallyDisengaged: missed.length >= missingThreshold && !cells.some((c) => c.submitted),
  };
}

module.exports = { evaluateRisk, severity };