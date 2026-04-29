// Módulo ES para Supabase — las claves se decodifican en runtime
const _k = [
    'aHR0cHM6Ly9xaXlobGhtaHhnaW1iY3ZvbXF2dS5zdXBhYmFzZS5jbw==',
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5GcGVXaHNhRzFvZUdkcGJXSmpkbTl0Y1haMUlpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTnpjd05UUTVNelVzSW1WNGNDSTZNakE1TWpZek1Ea3pOWDAuRVVjMDlScHVCWTdSX05ZQ29GbDN6bW12eGhoZkRhV2l3emFDSjM2cVpCdw=='
];
const _u = atob(_k[0]);
const _a = atob(_k[1]);

// Usar el objeto global si ya existe (para compatibilidad con scripts legacy) o crear uno nuevo
export const supabaseClient = (typeof supabase !== 'undefined') 
    ? supabase.createClient(_u, _a)
    : null; // Esto fallaría si el CDN no carga, pero es para ES Modules.

// Para que funcione en navegadores modernos sin el CDN global si se prefiere (opcional)
if (!supabaseClient && typeof window !== 'undefined') {
    console.error("Supabase CDN no encontrado. Asegúrate de incluir <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js'></script>");
}
