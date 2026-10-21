const effectiveDue = (dueAt, extensionDueAt) =>
  new Date(Math.max(new Date(dueAt).getTime(), extensionDueAt ? new Date(extensionDueAt).getTime() : 0));

function windowState({ now, opensAt, dueAt, isEnabled }) {
  if (!isEnabled) return 'disabled';
  if (now < new Date(opensAt)) return 'locked';
  if (now > new Date(dueAt)) return 'closed';
  return 'open';
}

// locked | open | submitted | awaiting_grading | graded | closed ("closed without submission")
function learnerStatus({ now, opensAt, dueAt, isEnabled, hasSubmission, isGraded }) {
  if (isGraded) return 'graded';
  const w = windowState({ now, opensAt, dueAt, isEnabled });
  if (hasSubmission) return w === 'closed' || w === 'disabled' ? 'awaiting_grading' : 'submitted';
  if (w === 'open') return 'open';
  if (w === 'closed') return 'closed';
  return 'locked';
}

module.exports = { effectiveDue, windowState, learnerStatus };