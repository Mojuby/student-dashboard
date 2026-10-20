const test = require('node:test');
const assert = require('node:assert');
const { generateCode, hashCode, codeMatches } = require('../src/lib/codes');

const pepper = 'test-pepper';

test('codes are 10 chars from the unambiguous alphabet', () => {
  assert.match(generateCode(), /^[A-HJ-NP-Z2-9]{10}$/);
});

test('matching is case and punctuation insensitive; wrong codes fail', () => {
  const stored = hashCode('ABCD-EFGH-JK', pepper);
  assert.equal(codeMatches('abcdefghjk', stored, pepper), true);
  assert.equal(codeMatches('ABCDEFGHJM', stored, pepper), false);
  assert.equal(codeMatches('ABCDEFGHJK', 'nothex', pepper), false);
});