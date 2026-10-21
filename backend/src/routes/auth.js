const router = require('express').Router();
const { z } = require('zod');
const { admin, anon } = require('../supabase');
const { query, tx } = require('../db');
const { checkLockout, recordAttempt, emailKey } = require('../lib/attempts');
const { codeMatches } = require('../lib/codes');
const { audit } = require('../lib/audit');
const { wrap, httpError, emailField } = require('../lib/http');
const { requireAuth, setSessionCookies, clearSessionCookies } = require('../middleware/auth');

const loginSchema = z.object({ email: emailField, password: z.string().min(1).max(200) });
const claimSchema = z.object({ email: emailField, code: z.string().trim().min(6).max(32), password: z.string().min(10).max(128) });
const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(128) });
const LOCKED = { error: 'Too many attempts. Please try again later.' };

const publicUser = (p) => ({ id: p.id, email: p.email, fullName: p.full_name, role: p.role, mustChangePassword: p.must_change_password });

function makeLogin(scope) {
  return wrap(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Email and password are required');
    const { email, password } = parsed.data;
    const ip = req.ip || 'unknown';

    const lock = await checkLockout(scope, email, ip);
    if (lock.locked) {
      if (scope === 'admin') await audit({ action: 'auth.admin.locked', details: { emailKey: emailKey(email) }, ip });
      res.set('Retry-After', String(lock.retryAfterSeconds));
      return res.status(429).json(LOCKED);
    }

    // Same response for unknown email, wrong password, or wrong portal.
    const fail = async () => {
      await recordAttempt(scope, email, ip, false);
      if (scope === 'admin') await audit({ action: 'auth.admin.login_failed', details: { emailKey: emailKey(email) }, ip });
      return res.status(401).json({ error: 'Invalid email or password' });
    };

    const { data, error } = await anon().auth.signInWithPassword({ email, password });
    if (error || !data.session) return fail();

    const { rows: [p] } = await query(
      'select id, email, full_name, role, is_active, must_change_password from profiles where id = $1', [data.user.id]
    );
    if (!p || !p.is_active || p.role !== scope) return fail();

    if (scope === 'learner') {
      // Learners can only log in if they're in the ACTIVE cohort. Also links returning learners.
      const { rows: [l] } = await query(
        `update learners l set profile_id = coalesce(l.profile_id, $2)
         from cohorts c where c.id = l.cohort_id and c.is_active and l.email = $1 returning l.id`,
        [email, p.id]
      );
      if (!l) {
        await recordAttempt(scope, email, ip, true);
        return res.status(403).json({ error: 'Your cohort is not currently active. Please contact FUSE Varsity.' });
      }
    }

    setSessionCookies(res, data.session, p.role);
    await recordAttempt(scope, email, ip, true);
    if (scope !== 'learner') await audit({ actorId: p.id, action: 'auth.login', details: { role: scope }, ip });
    res.json({ user: publicUser(p) });
  });
}

router.post('/learner/login', makeLogin('learner'));
router.post('/facilitator/login', makeLogin('facilitator'));
router.post('/admin/login', makeLogin('admin'));

// Account activation: learners and facilitators, via an admin-issued invite code.
router.post('/claim', wrap(async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Enter your email, invite code, and a password of at least 10 characters');
  const { email, code, password } = parsed.data;
  const ip = req.ip || 'unknown';

  const lock = await checkLockout('claim', email, ip);
  if (lock.locked) { res.set('Retry-After', String(lock.retryAfterSeconds)); return res.status(429).json(LOCKED); }
  const invalid = async () => {
    await recordAttempt('claim', email, ip, false);
    return res.status(400).json({ error: 'Invalid or expired invite code' });
  };

  const { rows: [invite] } = await query(
    `select * from invites where email = $1 and used_at is null and expires_at > now() order by created_at desc limit 1`, [email]
  );
  if (!invite || !codeMatches(code, invite.code_hash)) return invalid();
  if (password.toLowerCase() === email) throw httpError(400, 'Choose a password that is not your email');

  // Consume the invite atomically so a code can't be used twice.
  const consumed = await query('update invites set used_at = now() where id = $1 and used_at is null', [invite.id]);
  if (!consumed.rowCount) return invalid();

  let userId = null;
  try {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
    await tx(async (c) => {
      await c.query(`insert into profiles (id, email, full_name, role) values ($1,$2,$3,$4)`, [userId, email, invite.full_name, invite.role]);
      if (invite.role === 'facilitator') {
        await c.query(
          `insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3) on conflict do nothing`,
          [userId, invite.cohort_id, invite.stack_id]
        );
      } else {
        await c.query('update learners set profile_id = $1 where email = $2 and profile_id is null', [userId, email]);
      }
    });
  } catch (e) {
    console.error('claim failed:', e.message);
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    await query('update invites set used_at = null where id = $1', [invite.id]);
    return res.status(400).json({ error: 'Could not create the account. If you already have one, please log in.' });
  }

  await recordAttempt('claim', email, ip, true);
  await audit({ actorId: userId, action: 'auth.claim', entityType: 'invite', entityId: invite.id, details: { role: invite.role }, ip });
  res.status(201).json({ ok: true, role: invite.role });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'New password must be at least 10 characters');
  const { currentPassword, newPassword } = parsed.data;
  if (newPassword === currentPassword) throw httpError(400, 'Choose a different password');
  const ip = req.ip || 'unknown';
  const scope = req.user.role;

  const lock = await checkLockout(scope, req.user.email, ip);
  if (lock.locked) { res.set('Retry-After', String(lock.retryAfterSeconds)); return res.status(429).json(LOCKED); }

  const { error } = await anon().auth.signInWithPassword({ email: req.user.email, password: currentPassword });
  if (error) { await recordAttempt(scope, req.user.email, ip, false); throw httpError(401, 'Current password is incorrect'); }

  const { error: upErr } = await admin.auth.admin.updateUserById(req.user.id, { password: newPassword });
  if (upErr) throw httpError(400, 'That password was rejected. Try a longer or less common one.');
  await query('update profiles set must_change_password = false where id = $1', [req.user.id]);
  await audit({ actorId: req.user.id, action: 'auth.password_changed', ip });
  clearSessionCookies(res); // force a fresh login with the new password
  res.json({ ok: true });
}));

router.post('/logout', wrap(async (req, res) => {
  const at = req.cookies.fv_at;
  if (at) await admin.auth.admin.signOut(at).catch(() => {});
  clearSessionCookies(res);
  res.json({ ok: true });
}));

module.exports = router;