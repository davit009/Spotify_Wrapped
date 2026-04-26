let currentTrackInfo = null;

let isReauthenticatingTracking = false;
async function checkCurrentlyPlaying() {
    // ── Rate limit global ──────────────────────────────────────────────
    if (typeof SpotifyRL !== 'undefined' && !SpotifyRL.canRequest()) {
        console.info('⏳ Polling pausado: rate limit activo.');
        return;
    }

    // Obtenemos la sesión
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    // Obtener token válido a través de TokenManager (refresca automáticamente si es necesario)
    const token = typeof TokenManager !== 'undefined' ? await TokenManager.getToken(session) : session.provider_token;
    if (!token) return;

    try {
        // Consultar a Spotify qué se está reproduciendo ahora mismo
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Si el token de Spotify expiró (dura 1 hora), parar el tracking silenciosamente
        // 401/400 = expirado, 403 = inválido/sin permisos. No redirigir: destruiría la sesión.
        if ((response.status === 401 || response.status === 400 || response.status === 403) && !isReauthenticatingTracking) {
            isReauthenticatingTracking = true;
            console.warn(`Token de Spotify expirado o inválido (HTTP ${response.status}). El rastreo se pausará hasta la próxima sesión.`);
            hideNowPlaying();
            return;
        }

        // 429 → registrar en rate limiter global
        if (response.status === 429) {
            if (typeof SpotifyRL !== 'undefined') SpotifyRL.register429(response);
            console.error('🚨 429 en currently-playing. Polling pausado según Retry-After.');
            hideNowPlaying();
            return;
        }

        // 204 significa que Spotify está pausado o apagado
        if (response.status === 204 || response.status > 400) {
            hideNowPlaying();
            // IMPORTANTE: Ya no guardamos la canción ni la borramos de memoria al pausar.
            // Así, si le da play a la misma canción, el sistema sabrá que sigue siendo la misma y no la duplicará.
            return;
        }

        const data = await response.json();

        if (data && data.item && data.item.type === 'track') {
            const track = data.item;

            // Cachar en localStorage para que dashboard_stats.js no tenga que pedirlo de nuevo
            try { localStorage.setItem('spotify_track_' + track.id, JSON.stringify(track)); } catch (e) { }

            const isPlaying = data.is_playing;
            const currentProgress = data.progress_ms;

            showNowPlaying(track, isPlaying, currentProgress);

            if (isPlaying) {
                if (!currentTrackInfo) {
                    currentTrackInfo = { id: track.id, duration_ms: track.duration_ms, progress_ms: currentProgress };
                } else {
                    if (currentTrackInfo.id !== track.id) {
                        await saveTrackToDB(currentTrackInfo, session.user.id);
                        currentTrackInfo = { id: track.id, duration_ms: track.duration_ms, progress_ms: currentProgress };
                    } else {
                        if (currentProgress < 15000 && currentTrackInfo.progress_ms > (track.duration_ms / 2)) {
                            await saveTrackToDB(currentTrackInfo, session.user.id);
                        }
                        currentTrackInfo.progress_ms = currentProgress;
                    }
                }
            }
        } else {
            hideNowPlaying();
        }
    } catch (error) {
        console.error("Error tracking Spotify:", error);
    }
}

async function saveTrackToDB(trackInfo, userId) {
    const playedAt = new Date().toISOString();
    const { error } = await supabaseClient
        .from('listening_sessions')
        .insert({
            user_id: userId,
            track_id: trackInfo.id,
            duration_ms: trackInfo.duration_ms,
            played_at: playedAt,
            source: 'realtime'
        });
    if (error) console.error("Error guardando track en Supabase:", error.message);
    else document.dispatchEvent(new Event('trackSaved'));
}

async function getSpotifyToken() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    if (typeof TokenManager !== 'undefined') {
        return await TokenManager.getToken(session);
    }
    return session.provider_token || null;
}

async function spotifyPlayerAction(action, method = 'POST') {
    if (typeof SpotifyRL !== 'undefined' && !SpotifyRL.canRequest()) {
        console.info('⏳ Acción de player bloqueada por rate limit.');
        return;
    }
    const token = await getSpotifyToken();
    if (!token) return;
    try {
        const res = await fetch(`https://api.spotify.com/v1/me/player/${action}`, {
            method: method,
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            setTimeout(checkCurrentlyPlaying, 500);
        } else if (res.status === 403) {
            console.warn("Control de reproducción requiere Spotify Premium.");
        } else if (res.status === 429) {
            if (typeof SpotifyRL !== 'undefined') SpotifyRL.register429(res);
        }
    } catch (e) {
        console.error(`Error en acción ${action}:`, e);
    }
}

let localProgressInterval = null;
let lastKnownProgress = 0;
let lastKnownDuration = 0;

function formatMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateProgressUI(progress, duration) {
    const bar = document.getElementById('np-progress-bar');
    const currentEl = document.getElementById('np-current-time');
    const durationEl = document.getElementById('np-duration');

    if (bar && duration > 0) {
        const pct = Math.min((progress / duration) * 100, 100);
        bar.style.width = `${pct}%`;
    }
    if (currentEl) currentEl.textContent = formatMs(progress);
    if (durationEl) durationEl.textContent = formatMs(duration);
}

function startLocalProgress() {
    if (localProgressInterval) clearInterval(localProgressInterval);
    localProgressInterval = setInterval(() => {
        lastKnownProgress += 1000;
        if (lastKnownProgress > lastKnownDuration) lastKnownProgress = lastKnownDuration;
        updateProgressUI(lastKnownProgress, lastKnownDuration);
    }, 1000);
}

function stopLocalProgress() {
    if (localProgressInterval) clearInterval(localProgressInterval);
    localProgressInterval = null;
}

function showNowPlaying(track, isPlaying = true, progressMs = 0) {
    const card = document.getElementById('now-playing-card');
    const title = document.getElementById('np-title');
    const artist = document.getElementById('np-artist');
    const image = document.getElementById('np-image');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');

    if (!card) return;

    title.textContent = track.name;
    artist.textContent = track.artists.map(a => a.name).join(', ');

    lastKnownProgress = progressMs;
    lastKnownDuration = track.duration_ms;
    updateProgressUI(lastKnownProgress, lastKnownDuration);

    if (isPlaying) {
        playIcon?.classList.add('hidden');
        pauseIcon?.classList.remove('hidden');
        startLocalProgress();
    } else {
        playIcon?.classList.remove('hidden');
        pauseIcon?.classList.add('hidden');
        stopLocalProgress();
    }

    if (track.album.images.length > 0) {
        const albumUrl = track.album.images[0].url;
        image.src = albumUrl;
        const bg = document.getElementById('album-bg');
        if (bg) {
            const currentBg = bg.style.backgroundImage;
            const newBg = `url(${albumUrl})`;
            if (currentBg !== newBg) bg.style.backgroundImage = newBg;
            bg.classList.add('visible');
        }
    }
    card.classList.remove('hidden');
}

function hideNowPlaying() {
    const card = document.getElementById('now-playing-card');
    if (card) card.classList.add('hidden');
    const bg = document.getElementById('album-bg');
    if (bg) bg.classList.remove('visible');
    currentTrackInfo = null;
    stopLocalProgress();
}

async function syncOfflineHistory(session) {
    try {
        if (typeof SpotifyRL !== 'undefined' && !SpotifyRL.canRequest()) return;
        const token = typeof TokenManager !== 'undefined' ? await TokenManager.getToken(session) : session.provider_token;
        if (!token) return;

        const { data: lastSession } = await supabaseClient
            .from('listening_sessions')
            .select('played_at')
            .eq('user_id', session.user.id)
            .order('played_at', { ascending: false })
            .limit(1);

        let afterTimestamp = 0;
        if (lastSession && lastSession.length > 0) afterTimestamp = new Date(lastSession[0].played_at).getTime();
        else afterTimestamp = Date.now() - (24 * 60 * 60 * 1000);

        const response = await fetch(`https://api.spotify.com/v1/me/player/recently-played?limit=50&after=${afterTimestamp}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                if (typeof TokenManager !== 'undefined') {
                    TokenManager.invalidate();
                    // Refresca para el próximo tick
                    TokenManager.refresh(session);
                }
            } else if (response.status === 429) {
                if (typeof SpotifyRL !== 'undefined') SpotifyRL.register429(response);
            }
            return;
        }
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const sessionsToInsert = data.items.map(item => {
                // Guardar track en caché local para evitar error 429 en el dashboard
                try {
                    localStorage.setItem('spotify_track_' + item.track.id, JSON.stringify(item.track));
                } catch (e) { }

                return {
                    user_id: session.user.id,
                    track_id: item.track.id,
                    duration_ms: item.track.duration_ms,
                    played_at: item.played_at
                };
            });
            const { error } = await supabaseClient.from('listening_sessions')
                .upsert(sessionsToInsert, { onConflict: 'user_id, played_at', ignoreDuplicates: true });
            if (!error) document.dispatchEvent(new CustomEvent('trackSaved'));
        }
    } catch (e) { console.error("Error en sync offline:", e); }
}

// Polling interval: 15 segundos para evitar saturar el rate limit de Spotify.
// (la canción dura mínimo ~30s, este intervalo es suficiente para detectar cambios)
setInterval(checkCurrentlyPlaying, 15000);

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkCurrentlyPlaying, 2000);

    document.getElementById('player-play-pause')?.addEventListener('click', async () => {
        const token = await getSpotifyToken();
        if (!token) return;
        const res = await fetch('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 200) {
            const data = await res.json();
            if (data.is_playing) await spotifyPlayerAction('pause', 'PUT');
            else await spotifyPlayerAction('play', 'PUT');
        } else {
            await spotifyPlayerAction('play', 'PUT');
        }
    });

    document.getElementById('player-prev')?.addEventListener('click', () => spotifyPlayerAction('previous', 'POST'));
    document.getElementById('player-next')?.addEventListener('click', () => spotifyPlayerAction('next', 'POST'));
});
