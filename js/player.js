import { supabaseClient, getSessionResilient } from './supabase.js';
import { getValidToken } from './token_manager.js';

const TRACK_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%23282828'/%3E%3Ctext x='75' y='95' font-size='64' text-anchor='middle' fill='%231DB954'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E";

let currentUserId = null;
let player = null;
let deviceId = null;
let isPlaying = false;
let selectedTrack = null; // { uri, name, artist, art }

document.addEventListener('DOMContentLoaded', () => {
    // Dropdown de perfil
    const menu = document.getElementById('profile-dropdown');
    const toggleMenu = (e) => { e.stopPropagation(); menu.classList.toggle('active'); };
    document.getElementById('profile-btn')?.addEventListener('click', toggleMenu);
    document.getElementById('profile-btn-mobile')?.addEventListener('click', toggleMenu);
    document.addEventListener('click', () => menu?.classList.remove('active'));

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    bootstrap();
});

async function bootstrap() {
    const session = await getSessionResilient();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    currentUserId = session.user.id;
    document.getElementById('user-name').textContent = (session.user.user_metadata.full_name || 'Usuario').split(' ')[0];
    const avatarUrl = session.user.user_metadata.avatar_url || '';
    if (avatarUrl) {
        document.getElementById('user-avatar').src = avatarUrl;
        document.getElementById('user-avatar-mobile').src = avatarUrl;
    }

    setupSearch();
    setupPlayerControls();
    await initSpotifyPlayer();
}

// ============================================================
// SPOTIFY WEB PLAYBACK SDK
// ============================================================
function waitForSdk() {
    return new Promise(resolve => {
        if (window.__spotifySdkReady) return resolve();
        window.addEventListener('spotify-sdk-ready', () => resolve(), { once: true });
    });
}

function setStatus(text, state) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');
    if (label) label.textContent = text;
    if (dot) dot.className = 'status-dot flex-shrink-0' + (state ? ` ${state}` : '');
}

async function initSpotifyPlayer() {
    await waitForSdk();

    player = new Spotify.Player({
        name: 'Playcount (prueba)',
        getOAuthToken: async cb => {
            const token = await getValidToken(currentUserId);
            cb(token || '');
        },
        volume: 0 // Silenciado por default — la idea es probar el conteo, no escuchar
    });

    player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        setStatus('Listo — elige una canción para probar', 'ready');
    });

    player.addListener('not_ready', () => {
        setStatus('Dispositivo desconectado', 'error');
    });

    player.addListener('initialization_error', ({ message }) => {
        console.error('Spotify SDK init error:', message);
        setStatus('Tu navegador no soporta el reproductor de Spotify', 'error');
    });

    player.addListener('authentication_error', ({ message }) => {
        console.error('Spotify SDK auth error:', message);
        setStatus('Necesitas reconectar tu cuenta de Spotify (permiso nuevo) — cierra sesión y vuelve a conectar con Spotify', 'error');
    });

    player.addListener('account_error', ({ message }) => {
        console.error('Spotify SDK account error:', message);
        setStatus('Se requiere Spotify Premium para usar este reproductor', 'error');
    });

    player.addListener('playback_error', ({ message }) => {
        console.error('Spotify SDK playback error:', message);
        setStatus('Error al reproducir — intenta de nuevo', 'error');
    });

    player.addListener('player_state_changed', (state) => {
        if (!state) return;
        isPlaying = !state.paused;
        updatePlayToggleIcon();
    });

    const connected = await player.connect();
    if (!connected) setStatus('No se pudo conectar con Spotify', 'error');
}

// ============================================================
// BÚSQUEDA
// ============================================================
function setupSearch() {
    const input = document.getElementById('track-search');
    const results = document.getElementById('search-results');
    let timeout;

    input?.addEventListener('input', () => {
        clearTimeout(timeout);
        const query = input.value.trim();
        if (query.length < 2) { results.innerHTML = ''; return; }
        timeout = setTimeout(() => searchTracks(query), 400);
    });
}

async function searchTracks(query) {
    const results = document.getElementById('search-results');
    const token = await getValidToken(currentUserId);
    if (!token) {
        results.innerHTML = '<li class="text-center text-red-400 text-xs py-4">No se pudo obtener el token de Spotify.</li>';
        return;
    }

    try {
        const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        const tracks = data.tracks?.items || [];

        if (tracks.length === 0) {
            results.innerHTML = '<li class="text-center text-neutral-600 text-xs py-4">Sin resultados.</li>';
            return;
        }

        results.innerHTML = '';
        tracks.forEach(t => {
            const art = t.album?.images?.[t.album.images.length - 1]?.url || TRACK_PLACEHOLDER;
            const artist = t.artists?.map(a => a.name).join(', ') || '';
            const li = document.createElement('li');
            li.className = 'flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl transition-colors cursor-pointer';
            li.innerHTML = `
                <img src="${art}" class="w-10 h-10 rounded object-cover shadow-md flex-shrink-0">
                <div class="flex-1 overflow-hidden min-w-0">
                    <span class="font-bold text-white text-sm block truncate">${t.name}</span>
                    <span class="text-neutral-400 text-xs block truncate">${artist}</span>
                </div>
                <svg class="w-4 h-4 text-[#1DB954] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            `;
            li.addEventListener('click', () => selectTrack({ uri: t.uri, name: t.name, artist, art }));
            results.appendChild(li);
        });
    } catch (e) {
        console.error('Error buscando canciones:', e);
        results.innerHTML = '<li class="text-center text-red-400 text-xs py-4">Error al buscar.</li>';
    }
}

// ============================================================
// REPRODUCCIÓN
// ============================================================
function selectTrack(track) {
    selectedTrack = track;
    document.getElementById('now-testing-card').classList.remove('hidden');
    document.getElementById('now-testing-art').src = track.art;
    document.getElementById('now-testing-name').textContent = track.name;
    document.getElementById('now-testing-artist').textContent = track.artist;
    playSelectedTrack();
}

async function playSelectedTrack() {
    if (!selectedTrack) return;
    if (!deviceId) { setStatus('El reproductor todavía no está listo, espera un momento e intenta de nuevo', 'error'); return; }

    const token = await getValidToken(currentUserId);
    if (!token) return;

    try {
        const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: [selectedTrack.uri] })
        });
        if (!res.ok && res.status !== 204) {
            const body = await res.text();
            console.error('Error al reproducir:', res.status, body);
            if (res.status === 403) setStatus('Se requiere Spotify Premium para reproducir', 'error');
            else setStatus('No se pudo iniciar la reproducción', 'error');
            return;
        }
        isPlaying = true;
        updatePlayToggleIcon();
        setStatus('Reproduciendo — esto ya está contando en Spotify', 'ready');
    } catch (e) {
        console.error('Error al reproducir:', e);
        setStatus('No se pudo iniciar la reproducción', 'error');
    }
}

function updatePlayToggleIcon() {
    const icon = document.getElementById('play-toggle-icon');
    if (!icon) return;
    icon.innerHTML = isPlaying
        ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' // Pausa
        : '<path d="M8 5v14l11-7z"/>'; // Play
}

function setupPlayerControls() {
    document.getElementById('play-toggle-btn')?.addEventListener('click', async () => {
        if (!player) return;
        if (!selectedTrack) return;
        await player.togglePlay();
    });

    const volumeSlider = document.getElementById('volume-slider');
    const volumeLabel = document.getElementById('volume-label');
    volumeSlider?.addEventListener('input', async () => {
        const val = parseInt(volumeSlider.value, 10);
        if (volumeLabel) volumeLabel.textContent = val === 0 ? 'MUTE' : `${val}%`;
        if (player) await player.setVolume(val / 100);
    });
}
