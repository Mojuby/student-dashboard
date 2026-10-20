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

module.exports = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3001),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 2),
  allowedOrigins: process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
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