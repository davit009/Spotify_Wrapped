let currentTrackInfo = null;

let isReauthenticatingTracking = false;
async function checkCurrentlyPlaying() {
    // Obtenemos la sesión
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    // Intentar token de sesión primero, luego la BD
    let token = session.provider_token || null;
    if (!token) {
        try {
            const { data: userData, error: tokenErr } = await supabaseClient
                .from('users').select('spotify_access_token').eq('id', session.user.id).single();
            if (!tokenErr) token = userData?.spotify_access_token || null;
        } catch (e) { /* red sin disponibilidad, silencioso */ }
    }

    if (!token) return;

    try {
        // Consultar a Spotify qué se está reproduciendo ahora mismo
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Si el token de Spotify expiró (dura 1 hora), parar el tracking silenciosamente
        // NO redirigir: eso destruiría la sesión del usuario en medio de la navegación
        if ((response.status === 401 || response.status === 400) && !isReauthenticatingTracking) {
            isReauthenticatingTracking = true;
            console.warn("Token de Spotify expirado. El rastreo se pausará hasta la próxima sesión.");
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
    let token = session.provider_token || null;
    if (!token) {
        try {
            const { data: userData } = await supabaseClient
                .from('users').select('spotify_access_token').eq('id', session.user.id).single();
            token = userData?.spotify_access_token || null;
        } catch (e) {}
    }
    return token;
}

async function spotifyPlayerAction(action, method = 'POST') {
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
        const { data: userData } = await supabaseClient.from('users').select('spotify_access_token').eq('id', session.user.id).single();
        const token = userData?.spotify_access_token || session.provider_token;
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

        if (!response.ok) return;
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const sessionsToInsert = data.items.map(item => ({
                user_id: session.user.id,
                track_id: item.track.id,
                duration_ms: item.track.duration_ms,
                played_at: item.played_at
            }));
            const { error } = await supabaseClient.from('listening_sessions')
                .upsert(sessionsToInsert, { onConflict: 'user_id, played_at', ignoreDuplicates: true });
            if (!error) document.dispatchEvent(new CustomEvent('trackSaved'));
        }
    } catch(e) { console.error("Error en sync offline:", e); }
}

// Polling intervals
setInterval(checkCurrentlyPlaying, 5000);

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
