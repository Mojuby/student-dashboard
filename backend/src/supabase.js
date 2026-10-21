const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('./config');

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(supabase.url, supabase.serviceKey, opts);
// Fresh client per use so sessions never leak between users.
const anon = () => createClient(supabase.url, supabase.anonKey, opts);

module.exports = { admin, anon };