import { supabaseClient } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Guard: si supabaseClient no se pudo inicializar
    if (!supabaseClient) {
        console.error('Supabase client no disponible. Revisa que el CDN esté cargado.');
        showLoginCard();
        return;
    }

    // 1. Verificar si ya estamos logueados
    let session = null;
    try {
        const { data } = await supabaseClient.auth.getSession();
        session = data.session;
    } catch (e) {
        console.error('Error al verificar sesión:', e);
    }

    // Si hay sesión activa, redirigir al dashboard
    if (session) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Mostrar la UI de login
    showLoginCard();

    // 2. Botón de Login con Spotify
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            // Deshabilitar botón para evitar doble click
            loginBtn.disabled = true;
            loginBtn.style.opacity = '0.7';
            loginBtn.textContent = 'Conectando...';

            const urlParams = new URLSearchParams(window.location.search);
            const invite = urlParams.get('invite');
            const redirectTo = invite
                ? `${window.location.origin}/social.html?invite=${invite}`
                : window.location.origin;

            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'spotify',
                options: {
                    scopes: 'user-read-currently-playing user-modify-playback-state user-read-playback-state user-read-recently-played user-read-email user-read-private',
                    redirectTo: redirectTo
                }
            });

            if (error) {
                console.error('Error en el login:', error.message);
                alert('Hubo un error al conectar con Spotify: ' + error.message);
                // Restaurar botón si hay error
                loginBtn.disabled = false;
                loginBtn.style.opacity = '1';
                loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15.001 10.62 18.661 12.9c.42.18.6.78.3 1.14zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.721 1.62.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Entrar con Spotify`;
            }
        });
    }
});

function showLoginCard() {
    const loginCard = document.getElementById('login-card');
    if (loginCard) {
        loginCard.classList.add('visible');
    }
}
