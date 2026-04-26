import { supabaseClient } from './supabase.js';

/**
 * Obtiene un token de acceso válido de Spotify desde la tabla 'users'.
 */
export async function getValidToken(userId) {
    try {
        console.log("Obteniendo token para usuario:", userId);
        
        // El token está en la tabla 'users', no en una tabla aparte
        const { data, error } = await supabaseClient
            .from('users')
            .select('spotify_access_token, spotify_refresh_token, spotify_token_expires_at')
            .eq('id', userId)
            .single();

        if (error || !data || !data.spotify_access_token) {
            console.warn("No se encontró spotify_access_token en la tabla 'users'.");
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        // Si no tenemos fecha de expiración o ya expiró, intentamos usar el actual o refrescar
        const expiresAt = data.spotify_token_expires_at || 0;

        if (expiresAt > 0 && expiresAt < now + 300) {
            if (data.spotify_refresh_token) {
                console.log("Token expirado. Refrescando...");
                return await refreshSpotifyToken(userId, data.spotify_refresh_token);
            }
        }

        return data.spotify_access_token;
    } catch (e) {
        console.error("Error crítico en getValidToken:", e);
        return null;
    }
}

/**
 * Refresca el token de Spotify y lo guarda en la tabla 'users'
 */
async function refreshSpotifyToken(userId, refreshToken) {
    try {
        // Buscamos el Client ID en la configuración global si existe
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
            await supabaseClient
                .from('users')
                .update({
                    spotify_access_token: data.access_token,
                    spotify_token_expires_at: now + data.expires_in
                })
                .eq('id', userId);
            
            return data.access_token;
        }
        return null;
    } catch (e) {
        console.error("Error en refreshSpotifyToken:", e);
        return null;
    }
}
