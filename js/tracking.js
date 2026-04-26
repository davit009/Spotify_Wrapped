import { supabaseClient } from './supabase.js';

let currentTrackInfo = null;
let isReauthenticatingTracking = false;

/**
 * Monitorea lo que el usuario escucha y lo sincroniza con Supabase
 */
export async function checkCurrentlyPlaying(session) {
    if (document.hidden) return; // No poll si la pestaña no está activa
    
    // ── Rate limit global ──────────────────────────────────────────────
    if (typeof SpotifyRL !== 'undefined' && !SpotifyRL.canRequest()) {
        console.info('⏳ Polling pausado: rate limit activo.');
        return;
    }

    // Obtener token válido a través de TokenManager (refresca automáticamente si es necesario)
    const token = (typeof TokenManager !== 'undefined') ? await TokenManager.getToken(session) : session.provider_token;
    if (!token) return;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 204 || response.status === 404) {
            updateNowPlayingUI(null);
            return;
        }

        if (response.status === 401 && !isReauthenticatingTracking) {
            isReauthenticatingTracking = true;
            await TokenManager.refresh(session);
            isReauthenticatingTracking = false;
            return;
        }

        const data = await response.json();
        if (!data || !data.item) {
            updateNowPlayingUI(null);
            return;
        }

        const track = data.item;
        const progressMs = data.progress_ms;
        const isPlaying = data.is_playing;

        // Actualizar UI
        updateNowPlayingUI(data);

        // Guardar en Supabase si ha pasado suficiente tiempo o es track nuevo
        if (!currentTrackInfo || currentTrackInfo.id !== track.id) {
            currentTrackInfo = { id: track.id, startTime: Date.now() - progressMs };
            await saveListeningSession(session.user.id, track, progressMs);
        }

    } catch (error) {
        console.error('Error en tracking:', error);
    }
}

/**
 * Sincroniza el historial que Spotify tiene guardado (por si escuchaste en otro lado)
 */
export async function syncOfflineHistory(session) {
    const token = (typeof TokenManager !== 'undefined') ? await TokenManager.getToken(session) : session.provider_token;
    if (!token) return;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return;

        const data = await response.json();
        const items = data.items;

        for (const item of items) {
            const playedAt = new Date(item.played_at).toISOString();
            const track = item.track;

            // Upsert en Supabase para evitar duplicados (combinación user_id + played_at es única)
            await supabaseClient.from('listening_sessions').upsert({
                user_id: session.user.id,
                track_id: track.id,
                duration_ms: track.duration_ms,
                played_at: playedAt
            }, { onConflict: 'user_id,played_at' });
        }
    } catch (e) {
        console.error('Error sincronizando offline:', e);
    }
}

async function saveListeningSession(userId, track, progressMs) {
    await supabaseClient.from('listening_sessions').upsert({
        user_id: userId,
        track_id: track.id,
        duration_ms: track.duration_ms,
        played_at: new Date().toISOString()
    }, { onConflict: 'user_id,played_at' });
    
    // Disparar evento para que el dashboard se entere
    document.dispatchEvent(new CustomEvent('trackSaved'));
}

function updateNowPlayingUI(data) {
    const card = document.getElementById('now-playing-card');
    if (!data || !data.is_playing) {
        if (card) card.classList.add('hidden');
        document.getElementById('recommendation-card')?.classList.remove('hidden');
        return;
    }

    card?.classList.remove('hidden');
    document.getElementById('recommendation-card')?.classList.add('hidden');

    const track = data.item;
    document.getElementById('np-title').textContent = track.name;
    document.getElementById('np-artist').textContent = track.artists.map(a => a.name).join(', ');
    document.getElementById('np-image').src = track.album.images[0]?.url;
    
    // Background dinámico
    const bg = document.getElementById('album-bg');
    if (bg) {
        bg.style.backgroundImage = `url(${track.album.images[0]?.url})`;
        bg.classList.add('visible');
    }

    // Progreso
    const progress = (data.progress_ms / track.duration_ms) * 100;
    const bar = document.getElementById('np-progress-bar');
    if (bar) bar.style.width = `${progress}%`;
    
    const curTime = document.getElementById('np-current-time');
    const durTime = document.getElementById('np-duration');
    if (curTime) curTime.textContent = formatMs(data.progress_ms);
    if (durTime) durTime.textContent = formatMs(track.duration_ms);
}

function formatMs(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Iniciar polling
export function startPolling(session) {
    setInterval(() => checkCurrentlyPlaying(session), 5000);
}
