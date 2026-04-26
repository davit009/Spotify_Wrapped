import { supabaseClient } from './supabase.js';

/**
 * Obtiene un token de acceso válido de Spotify.
 * Si el token ha expirado, intenta refrescarlo automáticamente.
 */
export async function getValidToken(userId) {
    try {
        // Intentamos buscar en 'spotify_tokens' que es el nombre estándar para este proyecto
        let { data, error } = await supabaseClient
            .from('spotify_tokens')
            .select('*')
            .eq('user_id', userId)
            .single();

        // Si falla (404), intentamos con 'user_tokens' por si acaso
        if (error && error.code === 'PGRST116' || error?.status === 404) {
             const fallback = await supabaseClient
                .from('user_tokens')
                .select('*')
                .eq('user_id', userId)
                .single();
             data = fallback.data;
             error = fallback.error;
        }

        if (error || !data) {
            console.warn("No se encontraron tokens en spotify_tokens ni user_tokens. Verifica la base de datos.");
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        if (data.expires_at < now + 300) {
            console.log("Token cerca de expirar. Refrescando...");
            return await refreshSpotifyToken(userId, data.refresh_token);
        }

        return data.access_token;
    } catch (e) {
        console.error("Error crítico en getValidToken:", e);
        return null;
    }
}

/**
 * Refresca el token de Spotify
 */
async function refreshSpotifyToken(userId, refreshToken) {
    try {
        // Intentamos obtener el Client ID de la configuración global
        const clientId = window.SPOTIFY_CLIENT_ID || 'TU_CLIENT_ID'; 

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId
            })
        });

        const data = await response.json();
        
        if (data.access_token) {
            const now = Math.floor(Date.now() / 1000);
            // Actualizamos en ambas posibles tablas para mayor seguridad
            await supabaseClient.from('spotify_tokens').update({
                access_token: data.access_token,
                expires_at: now + data.expires_in
            }).eq('user_id', userId);

            return data.access_token;
        }
        return null;
    } catch (e) {
        console.error("Error en refreshSpotifyToken:", e);
        return null;
    }
}
