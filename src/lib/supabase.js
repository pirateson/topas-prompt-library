const SUPABASE_URL = 'https://yhrxfnjpgurchgzvjtqw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlocnhmbmpwZ3VyY2hnenZqdHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTU4MjQsImV4cCI6MjA4ODE3MTgyNH0.ig6y9DCHNX-nyN3Rt48Dp7FGA-ZpAqMkFjSmzsAKREw';

// The library is loaded globally via CDN script tag in index.html
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
