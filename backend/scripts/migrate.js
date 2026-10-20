require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(__dirname, '..', 'migrations');
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    console.log('Applying', file);
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      console.error('Failed:', e.message);
      process.exit(1);
    }
  }
  await client.end();
  console.log('Migrations up to date.');
})();