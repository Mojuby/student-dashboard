require('dotenv').config();

const REQUIRED = [
  'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'INVITE_PEPPER', 'SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'ALLOWED_ORIGINS',
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd && process.env.INVITE_PEPPER.length < 24) {
  console.error('INVITE_PEPPER must be at least 24 characters in production');
  process.exit(1);
}

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
if (process.env.ACTIVE_COHORT_NUMBER && !Number.isInteger(Number(process.env.ACTIVE_COHORT_NUMBER))) {
  console.error('ACTIVE_COHORT_NUMBER must be a whole number such as 10');
  process.exit(1);
}
const dbSsl = (process.env.DATABASE_SSL || 'no-verify').toLowerCase();

module.exports = {
  isProd,
  port: Number(process.env.PORT || 3001),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 2),
  allowedOrigins,
  // Optional. When set (Render env var), registrations are imported ONLY for this cohort's sheet tab ("Cohort N Grading")
  // and the admin UI preselects it. Unset = any cohort may be imported.
  activeCohortNumber: process.env.ACTIVE_COHORT_NUMBER ? Number(process.env.ACTIVE_COHORT_NUMBER) : null,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: dbSsl,
  dbPoolMax: Number(process.env.DB_POOL_MAX || 10),
  // Public URL of the frontend, used in emailed links.
  app: { url: (process.env.APP_URL || allowedOrigins[0] || '').replace(/\/$/, '') },
  // Nothing is sent unless MAIL_DRY_RUN=false (REMINDERS_DRY_RUN is the legacy name) AND both keys below are set.
  mail: {
    resendKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || '',
    sendDelayMs: Number(process.env.MAIL_SEND_DELAY_MS ?? 600), // stays under the provider's rate limit
    dryRun: String(process.env.MAIL_DRY_RUN ?? process.env.REMINDERS_DRY_RUN ?? 'true').toLowerCase() !== 'false',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  google: {
    sheetId: process.env.SHEET_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
  },
};
