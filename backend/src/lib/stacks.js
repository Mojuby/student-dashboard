// Matching registration-sheet stack names to the managed stacks list.
// Exact (case/spacing/punctuation-insensitive) matches and admin-defined aliases resolve automatically.
// Typos are only SUGGESTED, never applied: a learner is never silently placed in a guessed stack.
const stackKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// stacks: [{id, name}], aliases: [{alias, stack_id}]
function buildStackResolver(stacks, aliases = []) {
  const byKey = new Map();
  for (const s of stacks) byKey.set(stackKey(s.name), { id: s.id, name: s.name });
  const byId = new Map(stacks.map((s) => [s.id, s]));
  for (const a of aliases) {
    const target = byId.get(a.stack_id);
    if (target) byKey.set(stackKey(a.alias), { id: target.id, name: target.name });
  }
  return function resolve(raw) {
    const key = stackKey(raw);
    if (!key) return { stack: null, suggestion: null };
    const hit = byKey.get(key);
    if (hit) return { stack: hit, suggestion: null };
    let best = null;
    for (const s of stacks) {
      const d = levenshtein(key, stackKey(s.name));
      if (d <= 2 && (!best || d < best.d)) best = { d, name: s.name };
    }
    return { stack: null, suggestion: best ? best.name : null };
  };
}

module.exports = { stackKey, buildStackResolver, levenshtein };
