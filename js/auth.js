import { supabaseClient } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verificar si ya estamos logueados
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    // Si hay sesión activa, redirigir al dashboard
    if (session) {
        window.location.href = 'dashboard.html';
        return;
    }

    // 2. Botón de Login
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const invite = urlParams.get('invite');
            const redirectTo = invite 
                ? `${window.location.origin}/social.html?invite=${invite}` 
                : window.location.origin;

            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'spotify',
                options: {
                    // Scopes requeridos por SpotiDuel
                    scopes: 'user-read-currently-playing user-modify-playback-state user-read-playback-state user-read-recently-played user-read-email user-read-private',
                    redirectTo: redirectTo
                }
            });
            
            if (error) {
                console.error('Error en el login:', error.message);
                alert('Hubo un error al conectar con Spotify: ' + error.message);
            }
        });
    }
});
