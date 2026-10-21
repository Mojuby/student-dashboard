require('../src/config');
const { pool } = require('../src/db');
const { runReminders } = require('../src/services/reminders');

runReminders()
  .then((summary) => { console.log(JSON.stringify(summary)); return pool.end(); })
  .catch((e) => { console.error('Reminder run failed:', e.message); process.exit(1); });