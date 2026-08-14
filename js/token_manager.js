import { supabaseClient } from './supabase.js';

// Margen de seguridad: refrescar un poco antes de que Spotify lo rechace,
// para no perder la llamada que está a punto de hacerse.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Obtiene un token de acceso válido de Spotify.
 * Prioridad: DB (refrescando si venció) → session.provider_token (fallback para usuarios nuevos)
 */
export async function getValidToken(userId) {
    try {
        // Intento 1: leer desde la DB
        const { data, error } = await supabaseClient
            .from('users')
            .select('spotify_access_token, spotify_token_expires_at')
            .eq('id', userId)
            .single();

        if (!error && data?.spotify_access_token) {
            const expiresAt = data.spotify_token_expires_at ? new Date(data.spotify_token_expires_at).getTime() : 0;
            if (expiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
                return data.spotify_access_token;
            }

            // Token vencido (o sin fecha registrada, ej. cuentas de antes de este fix):
            // pedirle a la Edge Function que lo refresque con el refresh_token guardado,
            // en vez de obligar al usuario a reconectar Spotify a mano.
            const refreshed = await refreshSpotifyToken();
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
            // Persistir en DB para próximas llamadas
            await supabaseClient.from('users')
                .update({
                    spotify_access_token: providerToken,
                    spotify_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
                })
                .eq('id', userId);
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
 * Pide un access_token nuevo a la Edge Function refresh-spotify-token,
 * que usa el refresh_token guardado en BD (el client-side nunca debe
 * tener el client_secret de Spotify para hacer esto directamente).
 */
async function refreshSpotifyToken() {
    try {
        const { data, error } = await supabaseClient.functions.invoke('refresh-spotify-token');
        if (error) {
            console.warn('No se pudo refrescar el token de Spotify:', error);
            return null;
        }
        return data?.access_token || null;
    } catch (e) {
        console.warn('Error al refrescar el token de Spotify:', e);
        return null;
    }
}
