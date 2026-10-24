// Safe, fake configuration for tests. Nothing here points at a real service.
Object.assign(process.env, {
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_SSL: 'disable',
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://unused:unused@127.0.0.1:1/fuse_unit_test',
  SUPABASE_URL: 'http://supabase.invalid', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  INVITE_PEPPER: 'test-pepper-test-pepper-1234', SHEET_ID: 'sheet-test', GOOGLE_CLIENT_EMAIL: 'sa@test.invalid', GOOGLE_PRIVATE_KEY: 'x',
  ALLOWED_ORIGINS: 'https://app.test', APP_URL: 'https://app.test',
  RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'FUSE <no-reply@test.invalid>', MAIL_DRY_RUN: 'false', MAIL_SEND_DELAY_MS: '0',
});
