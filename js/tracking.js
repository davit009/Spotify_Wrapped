import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let lastTrackId = null;

export async function checkCurrentlyPlaying(session) {
    try {
        const token = await getValidToken(session.user.id);
        if (!token) return { active: false, trackChanged: false };

        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const npCard = document.getElementById('now-playing-card');
        if (response.status === 204 || response.status > 400) {
            // Nada sonando ahora mismo (pausado hace rato, o sin dispositivo activo).
            // A propósito NO tocamos npCard ni el fondo aquí: se quedan mostrando la
            // última canción que sí vimos reproduciéndose, para no perder el estilo
            // de la app (se veía en negro al ocultar la tarjeta). Y a propósito NO
            // consultamos /recently-played para "adivinar" qué mostrar — esa canción
            // podría no ser la misma que estaba pausada (aunque Spotify tarde en
            // registrarla ahí, o el usuario haya cambiado de canción sin que llegara
            // a sonar), lo que pondría una portada que no corresponde.
            const playIcon = document.getElementById('play-icon');
            if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>'; // Icono Play (pausado)
            return { active: false, trackChanged: false };
        }

        const data = await response.json();
        if (data && data.item) {
            const track = data.item;
            let trackChanged = false;
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
                    trackChanged = true;
                    updateDynamicBackground(track.album.images[0].url);
                }
            }
            return { active: true, trackChanged, track };
        } else {
            // Mismo caso que arriba (200 sin item) — dejamos la tarjeta como está.
            const playIcon = document.getElementById('play-icon');
            if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
            return { active: false, trackChanged: false };
        }
    } catch (error) { 
        console.error("Error en checkCurrentlyPlaying:", error); 
        return { active: false, trackChanged: false };
    }
}

/**
 * Controles de reproducción
 * La API requiere: scope user-modify-playback-state y un dispositivo activo.
 */
export async function spotifyControl(action, session) {
    const token = await getValidToken(session.user.id);
    if (!token) { console.warn('spotifyControl: sin token'); return; }

    try {
        // Primero verificar que hay un dispositivo activo
        const stateRes = await fetch('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // 204 = no hay dispositivo activo, no se puede controlar
        if (stateRes.status === 204 || !stateRes.ok) {
            console.warn('spotifyControl: no hay dispositivo activo en Spotify');
            return;
        }

        const state = await stateRes.json();
        if (!state?.device) { console.warn('spotifyControl: device undefined'); return; }

        let url    = 'https://api.spotify.com/v1/me/player/';
        let method = 'POST';

        if (action === 'next') {
            url += 'next';
        } else if (action === 'prev') {
            url += 'previous';
        } else if (action === 'play') {
            // Toggle play/pause según estado actual
            if (state.is_playing) {
                url   += 'pause';
                method = 'PUT';
            } else {
                url   += 'play';
                method = 'PUT';
            }
        }

        const res = await fetch(url, {
            method,
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // 204 = éxito sin cuerpo (normal para estos endpoints)
        if (!res.ok && res.status !== 204) {
            const err = await res.text();
            console.error(`spotifyControl ${action} error ${res.status}:`, err);
        }

        // Refrescar UI tras la acción (con doble reintento para dar tiempo a Spotify)
        setTimeout(() => checkCurrentlyPlaying(session), 400);
        setTimeout(() => checkCurrentlyPlaying(session), 1200);

    } catch (e) {
        console.error('spotifyControl exception:', e);
    }
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

export async function syncOfflineHistory(session) {
    // FIX PERF #1: Un único batch upsert en lugar de 50 roundtrips secuenciales.
    // FIX PERF #4: Sin SELECT previo — el trigger SQL maneja el acumulado;
    //              los duplicados los descarta el onConflict del upsert.
    try {
        const token = await getValidToken(session.user.id);
        if (!token) return;

        const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            // Visibilidad: sin esto, un 401 (token vencido) o 429 (rate limit,
            // ver Retry-After en la doc de Spotify) fallaba en silencio y las
            // canciones de esa ronda de sondeo simplemente no se guardaban.
            console.warn(`syncOfflineHistory: recently-played respondió ${response.status}`);
            return;
        }

        const data = await response.json();
        if (!data.items?.length) return;

        // Construir el batch completo de filas
        const rows = data.items.map(item => ({
            user_id:       session.user.id,
            track_id:      item.track.id,
            duration_ms:   item.track.duration_ms,
            played_at:     new Date(item.played_at).toISOString(),
            track_name:    item.track.name || null,
            artist_name:   item.track.artists?.map(a => a.name).join(', ') || null,
            album_art_url: item.track.album?.images?.[0]?.url || null
        }));

        // Un solo roundtrip a Supabase — el trigger SQL suma el acumulado
        // solo para las filas realmente nuevas (INSERT), no para duplicados (UPDATE).
        const { error } = await supabaseClient
            .from('listening_sessions')
            .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true });

        // Antes este error se descartaba en silencio: si el upsert fallaba
        // (RLS, o el constraint único de user_id+played_at no existe en la BD),
        // no se guardaba ninguna canción nueva y el conteo de tiempo/top tracks
        // quedaba desactualizado sin ningún aviso.
        if (error) console.error('syncOfflineHistory: error al guardar listening_sessions:', error);

    } catch (e) { console.error("Error en syncOfflineHistory:", e); }
}
