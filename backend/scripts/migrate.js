const fs = require('fs');
const path = require('path');

// Applies every unapplied migration in filename order, each in its own transaction.
// A Postgres advisory lock stops two deploys from migrating at once.
async function runMigrations(client, { dir = path.join(__dirname, '..', 'migrations'), log = console.log } = {}) {
  await client.query('select pg_advisory_lock(727274)');
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    const applied = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      log(`Applying ${file}`);
      try {
        await client.query('begin');
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {});
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  require('dotenv').config();
  const { Client } = require('pg');
  const { sslOption } = require('../src/lib/dbssl');
  (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslOption() });
    await client.connect();
    try {
      await runMigrations(client);
      console.log('Migrations up to date.');
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  })();
}
