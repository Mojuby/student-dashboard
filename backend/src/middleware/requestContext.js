const crypto = require('crypto');
const logger = require('../lib/logger');

// Assigns a request id (echoed to the client and in every log line) and writes one structured access-log line.
// Only method, path (no query string), status, duration and user id are logged: never headers, cookies or bodies.
function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const path = req.originalUrl.split('?')[0];
    const level = path === '/api/health' ? 'debug' : res.statusCode >= 500 ? 'error' : 'info';
    logger[level]('request', { requestId: req.id, method: req.method, path, status: res.statusCode, ms: Math.round(ms), userId: req.user?.id });
  });
  next();
}

module.exports = { requestContext };
