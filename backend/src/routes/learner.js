const router = require('express').Router();
const { query } = require('../db');
const { wrap, httpError } = require('../lib/http');
const { fetchCohortRows, buildDashboard } = require('../services/sheets');

// The learner is identified by their session, never by an id sent from the browser.
router.get('/dashboard', wrap(async (req, res) => {
  const { rows: [l] } = await query(
    `select l.email, c.number from learners l join cohorts c on c.id = l.cohort_id
     where l.profile_id = $1 and c.is_active`, [req.user.id]
  );
  if (!l) throw httpError(403, 'Your cohort is not currently active.');
  const rows = await fetchCohortRows(l.number);
  const row = rows.find((r) => r[1]?.toLowerCase().trim() === l.email.toLowerCase());
  if (!row) throw httpError(404, 'Your grades are not available yet.');
  res.json(buildDashboard(row, l.number));
}));

module.exports = router;