/**
 * token_manager.js
 * Maneja el ciclo de vida del access token de Spotify automáticamente.
 * - Cachea el token en memoria para no ir a BD en cada request.
 * - Refresca automáticamente via Edge Function cuando expira (sin redirect).
 * - Deduplica llamadas: si ya hay un refresh en curso, los demás esperan el mismo.
 */
const TokenManager = (() => {
    // URL de la Edge Function de Supabase
    const REFRESH_URL = `${SUPABASE_URL}/functions/v1/refresh-spotify-token`;

    // Caché en memoria
    let _token       = null;
    let _expiresAt   = 0;          // timestamp ms cuando expira el token cacheado
    let _refreshing  = null;       // Promise compartida para evitar refreshes duplicados
    const BUFFER_MS  = 2 * 60 * 1000; // refrescar 2 min antes de que expire

    return {
        /**
         * Inicializa el token desde la sesión o la BD.
         * Llamar una vez al montar el dashboard.
         */
        async init(session) {
            // Token fresco recién llegado de OAuth
            if (session.provider_token) {
                _token     = session.provider_token;
                _expiresAt = Date.now() + 55 * 60 * 1000; // Spotify da 3600s, usamos 55min
                return _token;
            }
            // Fallback: leer de BD (sesiones previas)
            try {
                const { data } = await supabaseClient
                    .from('users')
                    .select('spotify_access_token')
                    .eq('id', session.user.id)
                    .single();
                if (data?.spotify_access_token) {
                    _token = data.spotify_access_token;
                    // Expiry desconocido → lo tratamos como "válido por ahora, refrescar en 5min"
                    _expiresAt = Date.now() + 5 * 60 * 1000;
                }
            } catch(e) { /* sin red */ }
            return _token;
        },

        /** Devuelve el token cacheado actual (sin llamadas a red). */
        getCached() { return _token; },

        /** True si el token cacheado todavía es válido. */
        isValid() { return !!_token && Date.now() < _expiresAt - BUFFER_MS; },

        /**
         * Refresca el token via Edge Function.
         * Múltiples llamadas simultáneas comparten la misma Promise.
         * @param {object} session - Sesión activa de Supabase (necesita session.access_token)
         * @returns {string|null} - Nuevo access_token, o null si falló.
         */
        async refresh(session) {
            if (_refreshing) return _refreshing; // ya hay un refresh en curso

            console.log('🔄 Refrescando token de Spotify...');
            _refreshing = fetch(REFRESH_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json',
                },
            })
            .then(async res => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    console.error('❌ Refresh falló:', res.status, err);
                    _token = null; _expiresAt = 0;
                    return null;
                }
                const { access_token, expires_in } = await res.json();
                _token     = access_token;
                _expiresAt = Date.now() + (expires_in ?? 3600) * 1000;
                console.log('✅ Token de Spotify renovado automáticamente.');
                return access_token;
            })
            .catch(e => {
                console.error('Error de red en refresh:', e);
                return null;
            })
            .finally(() => { _refreshing = null; });

            return _refreshing;
        },

        /**
         * Obtiene un token válido. Si expiró, lo refresca automáticamente.
         * Usar esto en lugar de acceder al token directamente.
         * @param {object} session - Sesión activa de Supabase
         */
        async getToken(session) {
            if (this.isValid()) return _token;
            const fresh = await this.refresh(session);
            if (fresh) return fresh;
            // Si el refresh falla, devolver el token viejo como último intento
            return _token;
        },

        /** Invalida el caché (llamar tras un 401/403 inesperado). */
        invalidate() {
            _token     = null;
            _expiresAt = 0;
        },
    };
})();
