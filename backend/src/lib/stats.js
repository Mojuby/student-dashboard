const { letterGrade } = require('./grading');

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (a) => (a.length ? round1(a.reduce((s, x) => s + x, 0) / a.length) : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
// null (never 0) when there is nothing to divide by: "no data" must not read as "0%".
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null);
const distribution = (totals) => {
  const d = { A: 0, B: 0, C: 0, Fail: 0 };
  for (const t of totals) d[letterGrade(t)]++;
  return d;
};
// Attendance: present and late count as attended; excused learners are left out of the rate; unmarked is not counted.
const attended = (c) => (c.present || 0) + (c.late || 0);
const counted = (c) => attended(c) + (c.absent || 0);
const attendanceRate = (c) => pct(attended(c), counted(c));

module.exports = { round1, mean, median, pct, distribution, attended, counted, attendanceRate };
