const { query } = require('../db');

// Never put passwords, codes, or tokens in `details`.
async function audit({ actorId = null, action, entityType = null, entityId = null, details = {}, ip = null }) {
  try {
    await query(
      'insert into audit_log (actor_id, action, entity_type, entity_id, details, ip) values ($1,$2,$3,$4,$5,$6)',
      [actorId, action, entityType, entityId, JSON.stringify(details), ip]
    );
  } catch (e) {
    console.error('audit failed:', e.message);
  }
}

module.exports = { audit };