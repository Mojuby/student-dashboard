const test = require('node:test');
const assert = require('node:assert');
const { requireRole, requirePasswordChanged } = require('../src/middleware/roles');

const mockRes = () => ({
  statusCode: null, body: null,
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});

test('401 when unauthenticated', () => {
  const res = mockRes();
  requireRole('admin')({}, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 401);
});

test('403 when role is wrong (facilitator cannot reach admin)', () => {
  const res = mockRes();
  requireRole('admin')({ user: { role: 'facilitator' } }, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 403);
});

test('passes when role matches', () => {
  let called = false;
  requireRole('admin')({ user: { role: 'admin' } }, mockRes(), () => { called = true; });
  assert.equal(called, true);
});

test('blocks users who must change their password', () => {
  const res = mockRes();
  requirePasswordChanged({ user: { mustChangePassword: true } }, res, () => assert.fail('should not pass'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'PASSWORD_CHANGE_REQUIRED');
});