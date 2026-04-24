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
            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'spotify',
                options: {
                    // Scopes requeridos por SpotiDuel
                    scopes: 'user-read-currently-playing user-read-recently-played user-read-email user-read-private',
                    // Redirigir a la raíz para evitar problemas de rutas en Vercel
                    redirectTo: window.location.origin
                }
            });
            
            if (error) {
                console.error('Error en el login:', error.message);
                alert('Hubo un error al conectar con Spotify: ' + error.message);
            }
        });
    }
});
