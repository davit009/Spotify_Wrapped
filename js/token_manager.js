import { supabaseClient } from './supabase.js';

/**
 * Obtiene un token de acceso válido de Spotify.
 * Si el token ha expirado, intenta refrescarlo automáticamente.
 */
export async function getValidToken(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('user_tokens')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            console.error("No se encontraron tokens para el usuario:", userId);
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        // Si el token expira en menos de 5 minutos, lo refrescamos
        if (data.expires_at < now + 300) {
            console.log("Token expirado o cerca de expirar. Refrescando...");
            return await refreshSpotifyToken(userId, data.refresh_token);
        }

        return data.access_token;
    } catch (e) {
        console.error("Error en getValidToken:", e);
        return null;
    }
}

/**
 * Refresca el token de Spotify usando el refresh_token guardado
 */
async function refreshSpotifyToken(userId, refreshToken) {
    try {
        // En un entorno real, esto debería pasar por un servidor o una Edge Function de Supabase
        // para proteger el Client Secret. Aquí asumimos que la lógica de refresco está centralizada.
        
        // Buscamos las credenciales en la tabla de configuración o variables de entorno
        // Para este proyecto, el refresco suele hacerse vía Supabase Auth o una tabla de config.
        
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                // Nota: Aquí se necesitaría el Client ID y Secret en Base64 si no se usa un proxy
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: 'TU_CLIENT_ID' // Esto debería venir de config.js o Supabase
            })
        });

        const data = await response.json();
        
        if (data.access_token) {
            const now = Math.floor(Date.now() / 1000);
            await supabaseClient
                .from('user_tokens')
                .update({
                    access_token: data.access_token,
                    expires_at: now + data.expires_in
                })
                .eq('user_id', userId);
            
            return data.access_token;
        }
        return null;
    } catch (e) {
        console.error("Error refrescando token:", e);
        return null;
    }
}
