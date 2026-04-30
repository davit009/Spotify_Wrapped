import { supabaseClient } from './supabase.js';

/**
 * Obtiene un token de acceso válido de Spotify.
 * Prioridad: DB → session.provider_token (fallback para usuarios nuevos)
 */
export async function getValidToken(userId) {
    try {
        // Intento 1: leer desde la DB
        const { data, error } = await supabaseClient
            .from('users')
            .select('spotify_access_token')
            .eq('id', userId)
            .single();

        if (!error && data?.spotify_access_token) {
            return data.spotify_access_token;
        }

        // Intento 2: usar provider_token de la sesión activa (usuarios nuevos)
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const providerToken = sessionData?.session?.provider_token;
        if (providerToken) {
            // Persistir en DB para próximas llamadas
            await supabaseClient.from('users')
                .update({ spotify_access_token: providerToken })
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
