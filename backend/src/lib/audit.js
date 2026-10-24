const { query } = require('../db');
const logger = require('./logger');

// Never put passwords, codes, or tokens in `details`.
// Pass `db` (a transaction client) to make the audit row commit or roll back together with the change it describes.
async function audit({ actorId = null, action, entityType = null, entityId = null, details = {}, ip = null, db = null }) {
  const run = db ? db.query.bind(db) : query;
  const sql = 'insert into audit_log (actor_id, action, entity_type, entity_id, details, ip) values ($1,$2,$3,$4,$5,$6)';
  const params = [actorId, action, entityType, entityId, JSON.stringify(details), ip];
  if (db) { await run(sql, params); return; } // inside a transaction a failure must abort it
  try { await run(sql, params); } catch (e) { logger.error('audit.failed', { action, message: e.message }); }
}

module.exports = { audit };
