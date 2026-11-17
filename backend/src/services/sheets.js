const { google } = require('googleapis');
const config = require('../config');
const { computeTotals } = require('../lib/grading');

const TAB_TTL_MS = 5 * 60 * 1000;
const ROWS_TTL_MS = 30 * 1000; // protects the Sheets API quota
const rowsCache = new Map();
let tabCache = null;

// Real tab titles can carry stray whitespace (e.g. "Cohort 10 Grading "), so match on a normalised title
// instead of building the range from a template.
function findCohortTab(titles, cohortNumber) {
  const want = `cohort ${Number(cohortNumber)} grading`;
  return titles.find((t) => String(t).trim().replace(/\s+/g, ' ').toLowerCase() === want) || null;
}
const quoteTab = (title) => `'${title.replace(/'/g, "''")}'`;

let authClient = null;
async function client() {
  if (!authClient) {
    authClient = new google.auth.GoogleAuth({
      credentials: { client_email: config.google.clientEmail, private_key: config.google.privateKey.replace(/\\n/g, '\n') },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  return authClient.getClient();
}

async function realFetch(cohortNumber) {
  const hit = rowsCache.get(cohortNumber);
  if (hit && Date.now() - hit.at < ROWS_TTL_MS) return hit.rows;
  const sheets = google.sheets('v4');
  const auth = await client();
  if (!tabCache || Date.now() - tabCache.at > TAB_TTL_MS) {
    const meta = await sheets.spreadsheets.get({ auth, spreadsheetId: config.google.sheetId, fields: 'sheets.properties.title' });
    tabCache = { at: Date.now(), titles: (meta.data.sheets || []).map((s) => s.properties.title) };
  }
  const tab = findCohortTab(tabCache.titles, cohortNumber);
  if (!tab) { tabCache = null; throw Object.assign(new Error(`No sheet tab found for Cohort ${cohortNumber}`), { code: 'TAB_NOT_FOUND' }); }
  const res = await sheets.spreadsheets.values.get({ auth, spreadsheetId: config.google.sheetId, range: `${quoteTab(tab)}!A:T` });
  const rows = res.data.values || [];
  rowsCache.set(cohortNumber, { at: Date.now(), rows, tab });
  return rows;
}

// Indirection so tests can replace the network call without touching production code paths.
const source = { fetch: realFetch };
const fetchCohortRows = (cohortNumber) => source.fetch(cohortNumber);

// Blank, "N/A", "-" and other non-numeric cells mean "not recorded" (null), never zero.
function cell(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function buildDashboard(row, cohortNumber) {
  const n = (i) => cell(row[i]);
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
    cohortNumber: String(cohortNumber),
  };
  const totals = computeTotals(data);
  // Spreadsheets pre-fill "FAIL / NOT QUALIFIED" on rows nobody has graded yet; don't pass that off as a result.
  const recorded = totals.hasScores;
  return {
    ...data,
    finalGrade: recorded ? (row[18] || '') : '',
    qualifiedForCapstone: recorded ? String(row[19] ?? '').toUpperCase().trim() === 'QUALIFIED' : null,
    hasScores: recorded,
    totals,
  };
}

module.exports = { fetchCohortRows, buildDashboard, findCohortTab, cell, source };
