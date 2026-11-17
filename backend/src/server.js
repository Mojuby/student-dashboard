const app = require('./app');
const config = require('./config');
const { pool } = require('./db');
const logger = require('./lib/logger');

if (config.isProd && config.databaseSsl !== 'verify') {
  logger.warn('config.database_ssl', { message: 'DATABASE_SSL is not "verify": the database certificate is not being checked' });
}

const server = app.listen(config.port, () => logger.info('server.listening', { port: config.port }));

let closing = false;
function shutdown(reason, exitCode = 0) {
  if (closing) return;
  closing = true;
  logger.info('server.shutdown', { reason });
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(exitCode);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { message: String(reason?.message || reason), stack: reason?.stack }));
process.on('uncaughtException', (err) => { logger.error('uncaughtException', { message: err.message, stack: err.stack }); shutdown('uncaughtException', 1); });
