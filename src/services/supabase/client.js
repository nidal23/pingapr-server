// src/services/supabase/client.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../../config');

// Create Supabase client with SERVICE_ROLE key
// This should bypass RLS
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Public client uses anon key (subject to RLS)
const publicSupabase = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

module.exports = {
  supabase,
  publicSupabase
};