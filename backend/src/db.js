const { Pool } = require('pg');
const config = require('./config');
const logger = require('./lib/logger');
const { sslOption } = require('./lib/dbssl');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslOption(config.databaseSsl),
  max: config.dbPoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 20000, // no request may hold a connection on a runaway query
});
// An idle client erroring (e.g. DB restart) must not crash the process.
pool.on('error', (e) => logger.error('pg.pool.error', { message: e.message }));

const query = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const result = await fn(c);
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function healthCheck() {
  const t0 = Date.now();
  await pool.query('select 1');
  return { latencyMs: Date.now() - t0, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } };
}

module.exports = { pool, query, tx, healthCheck };
