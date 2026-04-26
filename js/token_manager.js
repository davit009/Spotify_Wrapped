import { supabaseClient } from './supabase.js';

/**
 * Gestiona el acceso a los tokens de Spotify, refrescándolos si es necesario.
 */
export const TokenManager = {
    _token: null,

    async init(session) {
        if (this._token) return this._token;
        
        // 1. Intentar obtener de la sesión actual
        if (session.provider_token) {
            this._token = session.provider_token;
            return this._token;
        }

        // 2. Fallback: Base de Datos
        const { data, error } = await supabaseClient
            .from('users')
            .select('spotify_access_token')
            .eq('id', session.user.id)
            .single();

        if (data?.spotify_access_token) {
            this._token = data.spotify_access_token;
            return this._token;
        }

        return null;
    },

    async getToken(session) {
        return await this.init(session);
    },

    async refresh(session) {
        console.log('🔄 Refrescando token de Spotify...');
        
        // Obtener el refresh token de la BD
        const { data: user } = await supabaseClient
            .from('users')
            .select('spotify_refresh_token')
            .eq('id', session.user.id)
            .single();

        if (!user?.spotify_refresh_token) {
            console.error('No hay refresh token disponible.');
            return null;
        }

        try {
            // Llamar a la Edge Function de Supabase para refrescar
            const { data, error } = await supabaseClient.functions.invoke('refresh-spotify-token', {
                body: { refresh_token: user.spotify_refresh_token, user_id: session.user.id }
            });

            if (error) throw error;

            if (data?.access_token) {
                this._token = data.access_token;
                // Actualizar token en la sesión local para que otros componentes lo vean
                session.provider_token = data.access_token;
                return data.access_token;
            }
        } catch (e) {
            console.error('Error al refrescar token:', e);
            return null;
        }
        return null;
    }
};

// Exponer globalmente también por si scripts legacy lo necesitan
if (typeof window !== 'undefined') {
    window.TokenManager = TokenManager;
}
