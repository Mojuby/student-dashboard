const crypto = require('crypto');
const { query } = require('../db');
const { lockoutDecision, THRESHOLDS } = require('./lockout');

const emailKey = (email) => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');

async function checkLockout(scope, email, ip) {
  if (!(scope in THRESHOLDS)) throw new Error(`Unknown lockout scope: ${scope}`);
  const { rows: [r] } = await query(
    `select
      (select count(*) from login_attempts where scope=$1 and email_key=$2 and not succeeded and created_at > now() - interval '60 minutes') as ef,
      (select max(created_at) from login_attempts where scope=$1 and email_key=$2 and not succeeded and created_at > now() - interval '60 minutes') as el,
      (select count(*) from login_attempts where scope=$1 and ip=$3 and not succeeded and created_at > now() - interval '60 minutes') as xf,
      (select max(created_at) from login_attempts where scope=$1 and ip=$3 and not succeeded and created_at > now() - interval '60 minutes') as xl`,
    [scope, emailKey(email), ip]
  );
  return lockoutDecision({
    emailFailures: Number(r.ef), lastEmailFailureAt: r.el,
    ipFailures: Number(r.xf), lastIpFailureAt: r.xl,
    emailThreshold: THRESHOLDS[scope],
  });
}

async function recordAttempt(scope, email, ip, succeeded) {
  const key = emailKey(email);
  await query('insert into login_attempts (scope, email_key, ip, succeeded) values ($1,$2,$3,$4)', [scope, key, ip, succeeded]);
  if (succeeded) {
    await query('delete from login_attempts where scope=$1 and email_key=$2 and not succeeded', [scope, key]);
  } else if (Math.random() < 0.02) {
    await query(`delete from login_attempts where created_at < now() - interval '2 days'`);
  }
}

module.exports = { checkLockout, recordAttempt, emailKey };