import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let lastTrackId = null;

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
            
            // Si no hay nada sonando, intentar poner el fondo de la última canción escuchada
            const recentRes = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (recentRes.ok) {
                const recentData = await recentRes.json();
                if (recentData.items && recentData.items.length > 0) {
                    updateDynamicBackground(recentData.items[0].track.album.images[0].url);
                }
            }
            return;
        }

        const data = await response.json();
        if (data && data.item) {
            const track = data.item;
            if (npCard) {
                npCard.classList.remove('hidden');
                document.getElementById('np-title').textContent = track.name;
                document.getElementById('np-artist').textContent = track.artists.map(a => a.name).join(', ');
                document.getElementById('np-image').src = track.album.images[0].url;
                
                const progress = (data.progress_ms / track.duration_ms) * 100;
                const bar = document.getElementById('np-progress-bar');
                if (bar) bar.style.width = `${progress}%`;
                
                document.getElementById('np-current-time').textContent = formatMs(data.progress_ms);
                document.getElementById('np-duration').textContent = formatMs(track.duration_ms);

                // Actualizar icono de play/pausa
                const playIcon = document.getElementById('play-icon');
                if (playIcon) {
                    playIcon.innerHTML = data.is_playing 
                        ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' // Icono Pausa
                        : '<path d="M8 5v14l11-7z"/>'; // Icono Play
                }

                if (track.id !== lastTrackId) {
                    lastTrackId = track.id;
                    updateDynamicBackground(track.album.images[0].url);
                    saveListeningSession(session.user.id, track, data.timestamp);
                }
            }
        } else if (npCard) {
            npCard.classList.add('hidden');
        }
    } catch (error) { console.error("Error en checkCurrentlyPlaying:", error); }
}

/**
 * Controles de reproducción
 */
export async function spotifyControl(action, session) {
    const token = await getValidToken(session.user.id);
    if (!token) return;

    let url = 'https://api.spotify.com/v1/me/player/';
    let method = 'POST';

    if (action === 'next') url += 'next';
    else if (action === 'prev') url += 'previous';
    else if (action === 'play') {
        // Necesitamos saber si está pausado o no
        const stateRes = await fetch('https://api.spotify.com/v1/me/player', { headers: {'Authorization': `Bearer ${token}`} });
        if (stateRes.ok) {
            const state = await stateRes.json();
            url += state.is_playing ? 'pause' : 'play';
            method = 'PUT';
        }
    }

    await fetch(url, { method, headers: {'Authorization': `Bearer ${token}`} });
    setTimeout(() => checkCurrentlyPlaying(session), 500); // Refrescar rápido tras acción
}

function formatMs(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(0);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateDynamicBackground(imgUrl) {
    const bg = document.getElementById('album-bg');
    if (bg) { bg.style.backgroundImage = `url(${imgUrl})`; bg.classList.add('visible'); }
}

async function saveListeningSession(userId, track, playedAt) {
    try {
        await supabaseClient.from('listening_sessions').upsert({
            user_id: userId,
            track_id: track.id,
            duration_ms: track.duration_ms,
            played_at: new Date(playedAt).toISOString()
        }, { onConflict: 'user_id,played_at' });
    } catch (e) { console.error("Error guardando sesión:", e); }
}

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
    } catch (e) { console.error("Error en syncOfflineHistory:", e); }
}
