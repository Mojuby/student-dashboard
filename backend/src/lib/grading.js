function letterGrade(total) {
  if (total >= 70) return 'A';
  if (total >= 50) return 'B';
  if (total >= 40) return 'C';
  return 'Fail';
}

function computeTotals(d) {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const attendance = sum(d.attendance);
  const assessment = sum(d.assessments);
  const bonus = d.linkedinBonus + d.softSkillBonus;
  const total = attendance + assessment + bonus + d.capstone;
  return { attendance, assessment, bonus, total: total.toFixed(2), grade: letterGrade(total) };
}

module.exports = { letterGrade, computeTotals };