import { supabaseClient, getSessionResilient } from './supabase.js';

// ── Helpers de navegación entre estados ──────────────────────────────────────
function goToState(id) {
    document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
}

function showLoginCard() {
    const card = document.getElementById('login-card');
    if (card) card.classList.add('visible');
}

function showError(msg) {
    const el = document.getElementById('form-error');
    if (el) { el.textContent = msg; el.classList.add('visible'); }
}

function hideError() {
    const el = document.getElementById('form-error');
    if (el) el.classList.remove('visible');
}

// ── Flujo OAuth directo (para usuarios ya aprobados) ─────────────────────────
async function doSpotifyLogin() {
    if (!supabaseClient) return;

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
        console.error('Error OAuth:', error.message);
        alert('Hubo un error al conectar con Spotify: ' + error.message);
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

    // Guard: Supabase disponible
    if (!supabaseClient) {
        console.error('Supabase client no disponible.');
        showLoginCard();
        return;
    }

    // 1. Verificar si ya hay sesión activa → redirigir al dashboard
    try {
        const session = await getSessionResilient();
        if (session) {
            window.location.href = 'dashboard.html';
            return;
        }
    } catch (e) {
        console.error('Error al verificar sesión:', e);
    }

    // 2. Mostrar la card
    showLoginCard();

    // ── Botón "Solicitar acceso anticipado" → ir al formulario ──
    document.getElementById('btn-request-access')?.addEventListener('click', () => {
        goToState('state-form');
    });

    // ── Botón "Volver" → regresar al home ──
    document.getElementById('btn-back-home')?.addEventListener('click', () => {
        hideError();
        goToState('state-home');
    });

    // ── Links "Ya tengo acceso" → login directo con Spotify ──
    document.getElementById('btn-already-access')?.addEventListener('click', doSpotifyLogin);
    document.getElementById('btn-already-access-2')?.addEventListener('click', doSpotifyLogin);

    // ── Formulario de lista de espera ──
    document.getElementById('btn-submit-waitlist')?.addEventListener('click', async () => {
        hideError();

        const nameEl  = document.getElementById('input-name');
        const emailEl = document.getElementById('input-email');
        const btn     = document.getElementById('btn-submit-waitlist');

        const name  = nameEl.value.trim();
        const email = emailEl.value.trim().toLowerCase();

        // Validación
        if (!name) {
            showError('Por favor ingresa tu nombre.');
            nameEl.focus();
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError('Ingresa un email válido de tu cuenta Spotify.');
            emailEl.focus();
            return;
        }

        // Deshabilitar botón
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        try {
            const { error } = await supabaseClient
                .from('waitlist')
                .insert({ name, spotify_email: email });

            if (error) {
                console.error('Error al guardar en waitlist:', error);
                showError('Ocurrió un error. Intenta de nuevo en un momento.');
                btn.disabled = false;
                btn.textContent = 'Unirme a la lista de espera';
                return;
            }

            // Éxito → pasar al estado de espera
            goToState('state-waiting');

        } catch (e) {
            console.error('Error inesperado:', e);
            showError('Ocurrió un error inesperado. Intenta de nuevo.');
            btn.disabled = false;
            btn.textContent = 'Unirme a la lista de espera';
        }
    });

    // ── Soporte para Enter en los inputs ──
    ['input-name', 'input-email'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('btn-submit-waitlist')?.click();
            }
        });
    });
});
