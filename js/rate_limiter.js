/**
 * rate_limiter.js
 * Gestor global de Rate Limit de Spotify.
 * Todos los módulos (tracking.js, dashboard_stats.js) deben llamar a
 * SpotifyRL.canRequest() antes de hacer fetch a la API de Spotify.
 */
const SpotifyRL = (() => {
    const KEY_BLOCKED_UNTIL = 'spotify_rl_blocked_until';

    function getBlockedUntil() {
        const raw = localStorage.getItem(KEY_BLOCKED_UNTIL);
        return raw ? parseInt(raw, 10) : 0;
    }

    function setBlockedUntil(ms) {
        localStorage.setItem(KEY_BLOCKED_UNTIL, String(ms));
        console.warn(`🚦 Spotify bloqueado hasta ${new Date(ms).toLocaleTimeString()}. Todas las peticiones pausadas.`);
        // Mostrar banner en UI si existe
        const banner = document.getElementById('rl-banner');
        if (banner) {
            const secs = Math.ceil((ms - Date.now()) / 1000);
            banner.textContent = `⏳ Límite de Spotify activo. Reintentando en ${secs}s...`;
            banner.classList.remove('hidden');
            // Actualizar countdown cada segundo
            const iv = setInterval(() => {
                const remaining = Math.ceil((getBlockedUntil() - Date.now()) / 1000);
                if (remaining <= 0) {
                    banner.classList.add('hidden');
                    clearInterval(iv);
                } else {
                    banner.textContent = `⏳ Límite de Spotify activo. Reintentando en ${remaining}s...`;
                }
            }, 1000);
        }
    }

    return {
        /**
         * Devuelve true si la app puede hacer peticiones ahora.
         */
        canRequest() {
            return Date.now() > getBlockedUntil();
        },

        /**
         * Registra un 429. Usa el header Retry-After (segundos) o un mínimo de 30s.
         * @param {Response|null} res - La respuesta fetch (opcional)
         */
        register429(res = null) {
            let waitSecs = 30; // mínimo seguro
            if (res) {
                const header = res.headers.get('Retry-After');
                if (header) waitSecs = Math.max(parseInt(header, 10), waitSecs);
            }
            // Añadir margen del 20% para no volver a golpear el límite de inmediato
            const blockedUntil = Date.now() + waitSecs * 1000 * 1.2;
            setBlockedUntil(blockedUntil);
        },

        /**
         * Cuántos milisegundos faltan para poder volver a hacer requests.
         */
        msUntilUnblock() {
            return Math.max(0, getBlockedUntil() - Date.now());
        },

        /**
         * EMERGENCY RESET: Llama SpotifyRL.reset() desde la consola del browser
         * si quieres forzar el desbloqueo manualmente.
         */
        reset() {
            localStorage.removeItem(KEY_BLOCKED_UNTIL);
            const banner = document.getElementById('rl-banner');
            if (banner) banner.classList.add('hidden');
            console.log('✅ Rate limit reseteado manualmente. Ya puedes hacer peticiones.');
        }
    };
})();

// Helper de emergencia accesible desde la consola:
// SpotifyRL.reset()   → desbloquear manualmente
// SpotifyRL.canRequest()  → true si no hay bloqueo activo
