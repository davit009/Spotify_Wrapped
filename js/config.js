// Configuración global — Supabase Anon Key (pública por diseño, protegida por RLS)
const _0x = [
    'aHR0cHM6Ly9xaXlobGhtaHhnaW1iY3ZvbXF2dS5zdXBhYmFzZS5jbw==',
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5GcGVXaHNhRzFvZUdkcGJXSmpkbTl0Y1haMUlpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTnpjd05UUTVNelVzSW1WNGNDSTZNakE1TWpZek1Ea3pOWDAuRVVjMDlScHVCWTdSX05ZQ29GbDN6bW12eGhoZkRhV2l3emFDSjM2cVpCdw=='
];
const SUPABASE_URL = atob(_0x[0]);
const SUPABASE_ANON_KEY = atob(_0x[1]);

// Inicializar cliente Supabase.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
