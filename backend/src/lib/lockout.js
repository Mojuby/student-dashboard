const THRESHOLDS = { admin: 3, facilitator: 5, learner: 5, claim: 5, invite_request: 3, password_reset: 5 };
const IP_THRESHOLD = 30;

function lockoutDecision({
  emailFailures = 0, lastEmailFailureAt = null, ipFailures = 0, lastIpFailureAt = null,
  emailThreshold = 5, now = new Date(),
}) {
  let unlockAt = 0;
  if (emailFailures >= emailThreshold && lastEmailFailureAt) {
    const minutes = Math.min(60, 5 * 2 ** Math.min(emailFailures - emailThreshold, 4));
    unlockAt = new Date(lastEmailFailureAt).getTime() + minutes * 60000;
  }
  if (ipFailures >= IP_THRESHOLD && lastIpFailureAt) {
    unlockAt = Math.max(unlockAt, new Date(lastIpFailureAt).getTime() + 15 * 60000);
  }
  const retryAfterSeconds = Math.max(0, Math.ceil((unlockAt - now.getTime()) / 1000));
  return { locked: retryAfterSeconds > 0, retryAfterSeconds };
}

module.exports = { lockoutDecision, THRESHOLDS };
