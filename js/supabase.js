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

/**
 * Igual que supabaseClient.auth.getSession(), pero con un reintento antes
 * de darse por vencido. En celular, al reabrir la pestaña justo cuando la
 * conexión de datos todavía se está reestableciendo, la primera lectura de
 * sesión puede fallar en silencio aunque el usuario sí tenga una sesión
 * guardada — sin esto, esa carrera se traducía en "me manda al login".
 */
export async function getSessionResilient() {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) return data.session;

    await new Promise(resolve => setTimeout(resolve, 1200));

    const { data: retryData } = await supabaseClient.auth.getSession();
    return retryData.session;
}
