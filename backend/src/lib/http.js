const { z } = require('zod');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const emailField = z.string().trim().toLowerCase().email().max(254);
const uuid = (v) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(v))) throw httpError(400, 'Invalid id');
  return v;
};

module.exports = { httpError, wrap, emailField, uuid };