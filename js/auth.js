document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verificar si ya estamos logueados
    const { data: { session } } = await supabase.auth.getSession();
    
    // Si hay sesión activa en el index, redirigir al dashboard
    if (session && window.location.pathname.endsWith('index.html')) {
        window.location.href = 'dashboard.html';
        return;
    }

    // 2. Botón de Login
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'spotify',
                options: {
                    // Scopes requeridos por SpotiDuel
                    scopes: 'user-read-currently-playing user-read-recently-played user-read-email user-read-private',
                    // Redirigir siempre al dashboard después del login
                    redirectTo: window.location.origin + window.location.pathname.replace('index.html', 'dashboard.html')
                }
            });
            
            if (error) {
                console.error('Error en el login:', error.message);
                alert('Hubo un error al conectar con Spotify: ' + error.message);
            }
        });
    }
});
