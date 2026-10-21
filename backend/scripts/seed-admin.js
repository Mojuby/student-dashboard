require('../src/config');
const { admin } = require('../src/supabase');
const { query, pool } = require('../src/db');

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (!email || password.length < 12) {
    console.error('Set ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD (12+ chars) in .env');
    process.exit(1);
  }
  const exists = await query('select 1 from profiles where email = $1', [email]);
  if (exists.rowCount) { console.log('Admin already exists. Nothing changed.'); return pool.end(); }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) { console.error('Could not create admin:', error.message); process.exit(1); }
  await query(
    `insert into profiles (id, email, full_name, role, must_change_password) values ($1,$2,'FUSE Varsity Admin','admin',true)`,
    [data.user.id, email]
  );
  console.log('Admin created. You must change the password on first login. Remove ADMIN_INITIAL_PASSWORD from your env now.');
  await pool.end();
})();