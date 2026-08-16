import { supabaseClient } from './supabase.js';

// Margen de seguridad: refrescar un poco antes de que Spotify lo rechace,
// para no perder la llamada que está a punto de hacerse.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Los tokens de Spotify viven en su propia tabla (con RLS "solo tu propia
// fila") en vez de en `users`, que cualquier usuario autenticado puede leer
// para buscar amigos/duelos. `users` se deja como respaldo temporal por si
// la migración SQL todavía no se corrió — ver supabase/split_spotify_tokens_*.sql.
const TOKENS_TABLE = 'user_spotify_tokens';
const LEGACY_TABLE = 'users';

/**
 * Obtiene un token de acceso válido de Spotify.
 * Prioridad: DB (refrescando si venció) → session.provider_token (fallback para usuarios nuevos)
 */
export async function getValidToken(userId) {
    try {
        const data = await readTokenRow(userId);

        if (data?.spotify_access_token) {
            const expiresAt = data.spotify_token_expires_at ? new Date(data.spotify_token_expires_at).getTime() : 0;
            if (expiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
                return data.spotify_access_token;
            }

            // Token vencido (o sin fecha registrada, ej. cuentas de antes de este fix):
            // pedirle a la Edge Function que lo refresque con el refresh_token guardado,
            // en vez de obligar al usuario a reconectar Spotify a mano.
            const refreshed = await refreshSpotifyToken(userId);
            if (refreshed) return refreshed;

            // Si el refresh falla (p.ej. todavía no hay refresh_token guardado para
            // esta cuenta), devolvemos el token viejo como último recurso — puede que
            // la fecha de expiración fuera solo una estimación y el token siga sirviendo.
            return data.spotify_access_token;
        }

        // Intento 2: usar provider_token de la sesión activa (usuarios nuevos)
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const providerToken = sessionData?.session?.provider_token;
        if (providerToken) {
            await writeTokenRow(userId, {
                spotify_access_token: providerToken,
                spotify_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
            });
            return providerToken;
        }

        console.warn('No se encontró token de Spotify para:', userId);
        return null;
    } catch (e) {
        console.error('Error crítico en getValidToken:', e);
        return null;
    }
}

/**
 * Guarda el access_token y refresh_token que llegan de Supabase justo después
 * del login con Spotify (session.provider_token / provider_refresh_token).
 * Lo llama dashboard.html al iniciar sesión.
 */
export async function persistSpotifyLoginTokens(userId, { accessToken, refreshToken }) {
    if (!accessToken) return;
    const payload = {
        // Spotify emite access_tokens con vida de 3600s (1h) — ver su doc de OAuth.
        spotify_access_token: accessToken,
        spotify_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
    };
    // provider_refresh_token solo viene presente en el login inicial (no en
    // sesiones restauradas), así que solo lo pisamos cuando existe.
    if (refreshToken) payload.spotify_refresh_token = refreshToken;
    await writeTokenRow(userId, payload);
}

/**
 * Pide un access_token nuevo a la Edge Function refresh-spotify-token,
 * que usa el refresh_token guardado en BD (el client-side nunca debe
 * tener el client_secret de Spotify para hacer esto directamente).
 */
async function refreshSpotifyToken(userId) {
    try {
        const { data, error } = await supabaseClient.functions.invoke('refresh-spotify-token');
        if (error) {
            console.warn('No se pudo refrescar el token de Spotify:', error);
            return null;
        }
        if (!data?.access_token) return null;

        // Guardamos la expiración también desde el cliente: así este mecanismo
        // funciona igual aunque la Edge Function desplegada sea una versión
        // anterior que no persiste spotify_token_expires_at por su cuenta
        // (esa versión vieja ya devolvía expires_in en su respuesta).
        const expiresIn = data.expires_in ?? 3600;
        await writeTokenRow(userId, {
            spotify_access_token: data.access_token,
            spotify_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString()
        });

        return data.access_token;
    } catch (e) {
        console.warn('Error al refrescar el token de Spotify:', e);
        return null;
    }
}

/**
 * Lee el token guardado, prefiriendo user_spotify_tokens. Si esa tabla
 * todavía no existe o no tiene fila para este usuario (p.ej. la migración
 * SQL no se ha corrido todavía), cae de vuelta a las columnas viejas en
 * `users` para que la app siga funcionando mientras tanto.
 */
async function readTokenRow(userId) {
    const { data, error } = await supabaseClient
        .from(TOKENS_TABLE)
        .select('spotify_access_token, spotify_token_expires_at')
        .eq('id', userId)
        .maybeSingle();

    if (!error && data?.spotify_access_token) return data;

    const { data: legacyData } = await supabaseClient
        .from(LEGACY_TABLE)
        .select('spotify_access_token, spotify_token_expires_at')
        .eq('id', userId)
        .maybeSingle();

    return legacyData;
}

/**
 * Guarda el token en user_spotify_tokens. Si esa tabla todavía no existe,
 * cae de vuelta a escribir en `users` (mismo motivo que readTokenRow) para
 * no romper el login/tracking mientras no se haya corrido la migración.
 */
async function writeTokenRow(userId, payload) {
    const { error } = await supabaseClient
        .from(TOKENS_TABLE)
        .upsert({ id: userId, ...payload });

    if (!error) return;

    await supabaseClient.from(LEGACY_TABLE).update(payload).eq('id', userId);
}
