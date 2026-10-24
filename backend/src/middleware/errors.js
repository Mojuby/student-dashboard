const logger = require('../lib/logger');

const notFound = (req, res) => res.status(404).json({ error: 'Not found', requestId: req.id });

// One response shape for every failure: { error, code?, requestId }. Internals (SQL, stack traces) go to the
// server log only, never to the client.
function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  let code = err.errorCode;
  if (err.type === 'entity.parse.failed') { status = 400; message = 'Request body is not valid JSON'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request body is too large'; }
  else if (err.name === 'ZodError') { status = 400; message = 'Invalid request'; }
  else if (err.code === '23505') { status = 409; message = 'That record already exists'; }
  else if (err.code === '23503') { status = 409; message = 'That record is linked to other data'; }
  else if (err.code === '23514' || err.code === '22P02' || err.code === '22003') { status = 400; message = 'A value is invalid or out of range'; }
  else if (err.code === '57014') { status = 503; message = 'The request took too long. Please try again.'; }
  if (status >= 500) {
    logger.error('request.error', { requestId: req.id, path: req.originalUrl.split('?')[0], message: err.message, pgCode: err.code, stack: err.stack });
    message = 'Server error';
  }
  res.status(status).json({ error: message, ...(code ? { code } : {}), requestId: req.id });
}

module.exports = { notFound, errorHandler };
