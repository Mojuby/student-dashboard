const { google } = require('googleapis');
const config = require('../config');
const { computeTotals } = require('../lib/grading');

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: config.google.clientEmail,
    private_key: config.google.privateKey.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets('v4');
const cache = new Map();
const TTL_MS = 30000; // protects the Sheets API quota

async function fetchCohortRows(cohortNumber) {
  const hit = cache.get(cohortNumber);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const res = await sheets.spreadsheets.values.get({
    auth: await auth.getClient(),
    spreadsheetId: config.google.sheetId,
    range: `'Cohort ${cohortNumber} Grading'!A:T`,
  });
  const rows = res.data.values || [];
  cache.set(cohortNumber, { at: Date.now(), rows });
  return rows;
}

function buildDashboard(row, cohortNumber) {
  const n = (i) => { const v = parseFloat(row[i]); return Number.isFinite(v) ? v : 0; };
  const data = {
    name: row[0] || 'Student',
    email: row[1],
    stack: row[2] || '',
    attendance: { class1: n(3), class2: n(4), class3: n(5), class4: n(6), class5: n(7), class6: n(8) },
    assessments: { w1: n(9), w2: n(10), w3: n(11), w4: n(12), w5: n(13) },
    softSkillBonus: n(14),
    linkedinBonus: n(15),
    capstone: n(16),
    totalGrade: n(17),
    finalGrade: row[18] || '',
    qualifiedForCapstone: row[19]?.toUpperCase().trim() === 'QUALIFIED',
    cohortNumber: String(cohortNumber),
  };
  return { ...data, totals: computeTotals(data) };
}

module.exports = { fetchCohortRows, buildDashboard };