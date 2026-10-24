const router = require('express').Router();
const { z } = require('zod');
const { admin, anon } = require('../supabase');
const { query, tx } = require('../db');
const config = require('../config');
const logger = require('../lib/logger');
const { checkLockout, recordAttempt, emailKey } = require('../lib/attempts');
const { codeMatches } = require('../lib/codes');
const { audit } = require('../lib/audit');
const { wrap, httpError, emailField } = require('../lib/http');
const { requireAuth, setSessionCookies, clearSessionCookies } = require('../middleware/auth');
const { issueInvitation } = require('../services/invitations');

const loginSchema = z.object({ email: emailField, password: z.string().min(1).max(200) });
const claimSchema = z.object({ email: emailField, code: z.string().trim().min(6).max(32), password: z.string().min(10).max(128) });
const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(128) });
const LOCKED = { error: 'Too many attempts. Please try again later.' };
const INVITE_COOLDOWN_MINUTES = 10;

const publicUser = (p) => ({ id: p.id, email: p.email, fullName: p.full_name, role: p.role, mustChangePassword: p.must_change_password });
const locked = (req, res, lock) => { res.set('Retry-After', String(lock.retryAfterSeconds)); return res.status(429).json({ ...LOCKED, requestId: req.id }); };

function makeLogin(scope) {
  return wrap(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Email and password are required');
    const { email, password } = parsed.data;
    const ip = req.ip || 'unknown';

    const lock = await checkLockout(scope, email, ip);
    if (lock.locked) {
      if (scope === 'admin') await audit({ action: 'auth.admin.locked', details: { emailKey: emailKey(email) }, ip });
      return locked(req, res, lock);
    }

    // Same response for unknown email, wrong password, or wrong portal.
    const fail = async () => {
      await recordAttempt(scope, email, ip, false);
      if (scope === 'admin') await audit({ action: 'auth.admin.login_failed', details: { emailKey: emailKey(email) }, ip });
      return res.status(401).json({ error: 'Invalid email or password', requestId: req.id });
    };

    const { data, error } = await anon().auth.signInWithPassword({ email, password });
    if (error || !data.session) return fail();

    const { rows: [p] } = await query(
      'select id, email, full_name, role, is_active, must_change_password from profiles where id = $1', [data.user.id]
    );
    if (!p || !p.is_active || p.role !== scope) return fail();

    if (scope === 'learner') {
      // A learner may sign in if they hold an enrolment in ANY active cohort (several can run at once).
      // Signing in also links the account to enrolments created after activation (returning learners).
      const { rows: [l] } = await query(
        `update learners l set profile_id = coalesce(l.profile_id, $2),
           status = case when l.status in ('enrolled','invited') then 'activated' else l.status end,
           activated_at = coalesce(l.activated_at, now())
         from cohorts c where c.id = l.cohort_id and c.status = 'active' and l.status <> 'withdrawn'
           and l.email = $1 and (l.profile_id is null or l.profile_id = $2) returning l.id`,
        [email, p.id]
      );
      if (!l) {
        await recordAttempt(scope, email, ip, true);
        return res.status(403).json({ error: 'Your cohort is not currently active. Please contact FUSE Varsity.', requestId: req.id });
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

const isAlreadyRegistered = (e) => e && (e.code === 'email_exists' || /already (been )?registered|already exists/i.test(e.message || ''));

// Rare recovery path only: finds an auth user left behind by an interrupted activation (no profile row).
async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

// Account activation: learners and facilitators, via an invite code. Codes are single-use, expire, are bound to the
// invited email (and, for learners, to an enrolment in an open cohort) and are stored only as an HMAC hash.
router.post('/claim', wrap(async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Enter your email, invite code, and a password of at least 10 characters');
  const { email, code, password } = parsed.data;
  const ip = req.ip || 'unknown';

  const lock = await checkLockout('claim', email, ip);
  if (lock.locked) return locked(req, res, lock);
  const invalid = async () => {
    await recordAttempt('claim', email, ip, false);
    // Deliberately identical for wrong / used / expired so codes cannot be probed; `code` lets the UI offer recovery.
    return res.status(400).json({ error: 'Invalid or expired invite code', code: 'INVITE_INVALID', requestId: req.id });
  };

  const { rows: [invite] } = await query(
    `select * from invites where email = $1 and used_at is null and expires_at > now() order by created_at desc limit 1`, [email]
  );
  if (!invite || !codeMatches(code, invite.code_hash)) return invalid();
  if (password.toLowerCase() === email) throw httpError(400, 'Choose a password that is not your email');

  if (invite.role === 'learner') {
    const { rows: [open] } = await query(
      `select 1 from learners l join cohorts c on c.id = l.cohort_id
       where l.email = $1 and l.status <> 'withdrawn' and c.status in ('upcoming','active') limit 1`, [email]);
    if (!open) return invalid(); // enrolment withdrawn or cohort closed since the invite was issued
  }

  // Consume atomically so concurrent attempts with the same code can only succeed once.
  const consumed = await query('update invites set used_at = now() where id = $1 and used_at is null', [invite.id]);
  if (!consumed.rowCount) return invalid();

  let userId = null;
  let createdHere = false;
  try {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error && !isAlreadyRegistered(error)) throw error;
    if (error) {
      // The email already exists in Auth. With a profile this is a normal account; without one it is the debris of an
      // interrupted activation, and the valid invite proves ownership, so finish the job instead of stranding them.
      if ((await query('select 1 from profiles where email = $1', [email])).rowCount) {
        await audit({ action: 'auth.claim_existing_account', entityType: 'invite', entityId: invite.id, details: { role: invite.role }, ip });
        return res.status(409).json({ error: 'You already have an account. Please log in.', code: 'ACCOUNT_EXISTS', requestId: req.id });
      }
      const existing = await findAuthUserByEmail(email);
      if (!existing) throw error;
      const { error: upErr } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (upErr) throw upErr;
      userId = existing.id;
    } else {
      userId = data.user.id;
      createdHere = true;
    }
    await tx(async (c) => {
      await c.query(`insert into profiles (id, email, full_name, role) values ($1,$2,$3,$4) on conflict (id) do nothing`, [userId, email, invite.full_name, invite.role]);
      if (invite.role === 'facilitator') {
        await c.query(
          `insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3) on conflict do nothing`,
          [userId, invite.cohort_id, invite.stack_id]
        );
      } else {
        await c.query(
          `update learners l set profile_id = $1, status = case when l.status in ('enrolled','invited') then 'activated' else l.status end,
             activated_at = coalesce(l.activated_at, now())
           from cohorts c where c.id = l.cohort_id and l.email = $2 and l.profile_id is null and l.status <> 'withdrawn' and c.status <> 'archived'`,
          [userId, email]
        );
      }
      await audit({ db: c, actorId: userId, action: 'auth.claim', entityType: 'invite', entityId: invite.id, details: { role: invite.role, recovered: !createdHere }, ip });
    });
  } catch (e) {
    // Leave a recoverable, auditable state: the invite is usable again and no half-made account remains.
    logger.error('claim.failed', { inviteId: invite.id, message: e.message, requestId: req.id });
    if (createdHere && userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    await query('update invites set used_at = null where id = $1', [invite.id]);
    await audit({ action: 'auth.claim_failed', entityType: 'invite', entityId: invite.id, details: { role: invite.role }, ip });
    return res.status(400).json({ error: 'Could not create the account. Please try again, or contact FUSE Varsity if this keeps happening.', code: 'CLAIM_FAILED', requestId: req.id });
  }

  await recordAttempt('claim', email, ip, true);
  res.status(201).json({ ok: true, role: invite.role });
}));

// Recovery for an expired or lost invitation. The response is identical whether or not the email is enrolled, so it
// cannot be used to discover who is registered. The new code is only ever emailed to the address on file.
router.post('/request-invite', wrap(async (req, res) => {
  const parsed = z.object({ email: emailField }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Enter a valid email address');
  const { email } = parsed.data;
  const ip = req.ip || 'unknown';
  const lock = await checkLockout('invite_request', email, ip);
  if (lock.locked) return locked(req, res, lock);
  await recordAttempt('invite_request', email, ip, false); // every request counts toward the limit

  const { rows: [l] } = await query(
    `select l.id,
            exists (select 1 from invites i where i.learner_id = l.id and i.delivery_status = 'sent' and i.used_at is null and i.expires_at > now()
                    and i.created_at > now() - make_interval(mins => $2::int)) as recent
     from learners l join cohorts c on c.id = l.cohort_id
     where l.email = $1 and l.profile_id is null and l.status in ('enrolled','invited') and c.status in ('upcoming','active')
       and not exists (select 1 from profiles p where p.email = l.email)
     order by l.created_at desc limit 1`, [email, INVITE_COOLDOWN_MINUTES]);
  if (l && !l.recent) {
    try { await issueInvitation({ learnerId: l.id, source: 'self_service' }); } catch (e) { logger.error('request_invite.failed', { message: e.message, requestId: req.id }); }
  }
  res.status(202).json({ ok: true, message: 'If this email is registered for an open cohort, a new invitation has been sent. Check your inbox and spam folder.' });
}));

// Password recovery through Supabase Auth's email. Always answers the same way.
router.post('/forgot-password', wrap(async (req, res) => {
  const parsed = z.object({ email: emailField }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Enter a valid email address');
  const { email } = parsed.data;
  const ip = req.ip || 'unknown';
  const lock = await checkLockout('password_reset', email, ip);
  if (lock.locked) return locked(req, res, lock);
  await recordAttempt('password_reset', email, ip, false);
  const { rows: [p] } = await query('select id from profiles where email = $1 and is_active', [email]);
  if (p) {
    try { await anon().auth.resetPasswordForEmail(email, { redirectTo: `${config.app.url}/reset-password` }); }
    catch (e) { logger.error('forgot_password.failed', { message: e.message, requestId: req.id }); }
  }
  res.status(202).json({ ok: true, message: 'If an account exists for this email, a reset link has been sent.' });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const parsed = z.object({ accessToken: z.string().min(20).max(4096), newPassword: z.string().min(10).max(128) }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Choose a new password of at least 10 characters');
  const ip = req.ip || 'unknown';
  const lock = await checkLockout('password_reset', 'reset', ip);
  if (lock.locked) return locked(req, res, lock);
  const bad = async () => { await recordAttempt('password_reset', 'reset', ip, false); return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.', code: 'RESET_INVALID', requestId: req.id }); };

  const { data, error } = await admin.auth.getUser(parsed.data.accessToken);
  if (error || !data.user) return bad();
  const { rows: [p] } = await query('select id, is_active from profiles where id = $1', [data.user.id]);
  if (!p || !p.is_active) return bad();
  const { error: upErr } = await admin.auth.admin.updateUserById(p.id, { password: parsed.data.newPassword });
  if (upErr) throw httpError(400, 'That password was rejected. Try a longer or less common one.');
  await query('update profiles set must_change_password = false where id = $1', [p.id]);
  await audit({ actorId: p.id, action: 'auth.password_reset', ip });
  clearSessionCookies(res);
  res.json({ ok: true });
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
  if (lock.locked) return locked(req, res, lock);

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
