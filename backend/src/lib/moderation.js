// A simple, transparent filter for the note learners leave for their instructor. It does NOT delete anything: a flagged
// note is held back from the facilitator's view until an admin releases it. It will miss some rudeness and may hold back
// some harmless notes; that is why an admin can always review and release.
const SUBST = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const normalise = (t) => String(t ?? '').toLowerCase()
  .replace(/[013457@$!]/g, (c) => SUBST[c])
  .replace(/(.)\1{2,}/g, '$1') // "stuuuupid" -> "stupid"
  .replace(/[^a-z\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, '')); // "f u c k" -> "fuck

const PATTERN = new RegExp(`\\b(?:${[
  'fuck\\w*', 'shit\\w*', 'bitch\\w*', 'bastard\\w*', 'asshole\\w*', 'piss\\w*', 'bullshit',
  'idiot\\w*', 'stupid\\w*', 'moron\\w*', 'dumb\\w*', 'imbecile\\w*', 'clown\\w*', 'fool\\w*', 'loser\\w*',
  'useless', 'worthless', 'incompetent', 'pathetic', 'trash',
  'hate you', 'shut up', 'waste of space', 'go to hell',
].join('|')})\\b`);

function moderate(text) {
  const n = normalise(text);
  return { flagged: PATTERN.test(n) };
}

module.exports = { moderate, normalise };
