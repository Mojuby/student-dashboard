require('../src/config');
const { pool } = require('../src/db');
const { runReminders } = require('../src/services/reminders');
const { runSurveyNotifications } = require('../src/services/surveyNotify');

runReminders()
  .then(async (summary) => { const surveys = await runSurveyNotifications(); console.log(JSON.stringify({ ...summary, surveys })); return pool.end(); })
  .catch((e) => { console.error('Reminder run failed:', e.message); process.exit(1); });