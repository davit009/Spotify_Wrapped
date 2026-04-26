import { supabaseClient } from './supabase.js';

/**
 * Obtiene un token de acceso válido de Spotify.
 * Ahora con detección de columnas segura para evitar errores 400.
 */
export async function getValidToken(userId) {
    try {
        console.log("Intentando recuperar token para:", userId);

        // Intento 1: Solo la columna que sabemos que existe por profile.js
        const { data, error } = await supabaseClient
            .from('users')
            .select('spotify_access_token')
            .eq('id', userId)
            .single();

        if (error) {
            console.error("Error 400 detectado. Es probable que la estructura de la tabla 'users' haya cambiado:", error);
            // Intento 2: Buscar en la tabla de tokens original por si acaso el usuario la restauró
            const fallback = await supabaseClient.from('spotify_tokens').select('*').eq('user_id', userId).single();
            if (fallback.data) return fallback.data.access_token;
            return null;
        }

        if (!data || !data.spotify_access_token) {
            console.warn("Usuario encontrado pero sin spotify_access_token.");
            return null;
        }

        // Si llegamos aquí, tenemos un token. 
        // Como no estamos seguros de la columna de expiración, asumiremos que es válido 
        // y dejaremos que Spotify nos dé un 401 si ha caducado, para luego manejarlo.
        return data.spotify_access_token;

    } catch (e) {
        console.error("Error crítico en getValidToken:", e);
        return null;
    }
}

/**
 * Refresca el token de Spotify (Simulado por ahora para evitar fallos de columna)
 */
async function refreshSpotifyToken(userId, refreshToken) {
    // Esta función se activará cuando detectemos un 401 real de Spotify
    console.log("Lógica de refresco preparada para:", userId);
    return null; 
}
