function letterGrade(total) {
  if (total >= 70) return 'A';
  if (total >= 50) return 'B';
  if (total >= 40) return 'C';
  return 'Fail';
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Cells may be null (blank / "N/A" in the source = not recorded). A missing score is NOT a zero:
// if nothing at all has been recorded there is no total and no grade.
function computeTotals(d) {
  const parts = [...Object.values(d.attendance), ...Object.values(d.assessments), d.softSkillBonus, d.linkedinBonus, d.capstone];
  if (!parts.some(isNum)) return { attendance: null, assessment: null, bonus: null, total: null, grade: null, hasScores: false };
  const sum = (o) => Object.values(o).reduce((a, b) => a + (isNum(b) ? b : 0), 0);
  const attendance = sum(d.attendance);
  const assessment = sum(d.assessments);
  const bonus = (isNum(d.linkedinBonus) ? d.linkedinBonus : 0) + (isNum(d.softSkillBonus) ? d.softSkillBonus : 0);
  const total = attendance + assessment + bonus + (isNum(d.capstone) ? d.capstone : 0);
  return { attendance, assessment, bonus, total: total.toFixed(2), grade: letterGrade(total), hasScores: true };
}

module.exports = { letterGrade, computeTotals };
