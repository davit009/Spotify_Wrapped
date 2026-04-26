import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let lastTrackId = null;

/**
 * Verifica qué está escuchando el usuario actualmente en Spotify
 */
export async function checkCurrentlyPlaying(session) {
    try {
        const token = await getValidToken(session.user.id);
        if (!token) return;

        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const npCard = document.getElementById('now-playing-card');

        if (response.status === 204 || response.status > 400) {
            if (npCard) npCard.classList.add('hidden');
            return;
        }

        const data = await response.json();
        
        if (data && data.item) {
            const track = data.item;
            const isPlaying = data.is_playing;

            if (npCard) {
                npCard.classList.remove('hidden');
                
                // Actualizar UI
                document.getElementById('np-title').textContent = track.name;
                document.getElementById('np-artist').textContent = track.artists.map(a => a.name).join(', ');
                document.getElementById('np-image').src = track.album.images[0].url;
                
                // Progreso
                const progress = (data.progress_ms / track.duration_ms) * 100;
                const bar = document.getElementById('np-progress-bar');
                if (bar) bar.style.width = `${progress}%`;
                
                document.getElementById('np-current-time').textContent = formatMs(data.progress_ms);
                document.getElementById('np-duration').textContent = formatMs(track.duration_ms);

                // Cambiar fondo dinámico si es una canción nueva
                if (track.id !== lastTrackId) {
                    lastTrackId = track.id;
                    updateDynamicBackground(track.album.images[0].url);
                    // Guardar en Supabase si es necesario (lógica de guardado de sesiones)
                    saveListeningSession(session.user.id, track, data.timestamp);
                }
            }
        } else {
            if (npCard) npCard.classList.add('hidden');
        }
    } catch (error) {
        console.error("Error en checkCurrentlyPlaying:", error);
    }
}

function formatMs(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(0);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateDynamicBackground(imgUrl) {
    const bg = document.getElementById('album-bg');
    if (bg) {
        bg.style.backgroundImage = `url(${imgUrl})`;
        bg.classList.add('visible');
    }
}

async function saveListeningSession(userId, track, playedAt) {
    try {
        await supabaseClient.from('listening_sessions').upsert({
            user_id: userId,
            track_id: track.id,
            duration_ms: track.duration_ms,
            played_at: new Date(playedAt).toISOString()
        }, { onConflict: 'user_id,played_at' });
    } catch (e) {
        console.error("Error guardando sesión:", e);
    }
}

/**
 * Sincroniza el historial reciente (offline) de Spotify
 */
export async function syncOfflineHistory(session) {
    try {
        const token = await getValidToken(session.user.id);
        const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.items) {
            for (const item of data.items) {
                await saveListeningSession(session.user.id, item.track, item.played_at);
            }
        }
    } catch (e) {
        console.error("Error en syncOfflineHistory:", e);
    }
}
