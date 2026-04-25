let currentTrackInfo = null;

let isReauthenticatingTracking = false;
async function checkCurrentlyPlaying() {
    // Obtenemos la sesión
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    // Recuperar token real de BD (fresco)
    const { data: userData } = await supabaseClient.from('users').select('spotify_access_token').eq('id', session.user.id).single();
    const token = userData?.spotify_access_token || session.provider_token;
    
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
        
        if (data && data.is_playing && data.item && data.item.type === 'track') {
            const track = data.item;
            const currentProgress = data.progress_ms;
            showNowPlaying(track);

            if (!currentTrackInfo) {
                // Primera vez que detectamos una canción en esta sesión
                currentTrackInfo = { id: track.id, duration_ms: track.duration_ms, progress_ms: currentProgress };
            } else {
                if (currentTrackInfo.id !== track.id) {
                    // Cambió de canción, guardamos la ANTERIOR
                    await saveTrackToDB(currentTrackInfo, session.user.id);
                    currentTrackInfo = { id: track.id, duration_ms: track.duration_ms, progress_ms: currentProgress };
                } else {
                    // Sigue siendo la misma canción. Verificamos si se reinició (hizo Loop).
                    // Si el progreso actual es menor a 15 segundos pero antes iba por la mitad o más...
                    if (currentProgress < 15000 && currentTrackInfo.progress_ms > (track.duration_ms / 2)) {
                        console.log("Loop detectado. Guardando vuelta anterior...");
                        await saveTrackToDB(currentTrackInfo, session.user.id);
                    }
                    // Actualizamos el progreso en memoria
                    currentTrackInfo.progress_ms = currentProgress;
                }
            }
        } else {
            hideNowPlaying();
            // Ya no la matamos aquí tampoco por si acaso
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
        
    if (error) {
        console.error("Error guardando track en Supabase:", error.message);
    } else {
        console.log("¡Canción guardada en Supabase exitosamente!", trackInfo.id);
        // Opcional: Avisar a otras partes de la app que actualicen las estadísticas
        document.dispatchEvent(new Event('trackSaved'));
    }
}

function showNowPlaying(track) {
    const card = document.getElementById('now-playing-card');
    const title = document.getElementById('np-title');
    const artist = document.getElementById('np-artist');
    const image = document.getElementById('np-image');

    if (!card) return;

    title.textContent = track.name;
    artist.textContent = track.artists.map(a => a.name).join(', ');
    if (track.album.images.length > 0) {
        image.src = track.album.images[0].url;
    }

    card.classList.remove('hidden');
}

function hideNowPlaying() {
    document.getElementById('now-playing').classList.add('hidden');
    currentTrackInfo = null; // Reseteamos si no hay nada
}

// Iniciar el rastreo cada 5 segundos
setInterval(checkCurrentlyPlaying, 5000);

// Novedad: Sincronización "Catch-Up" al abrir la app
async function syncOfflineHistory(session) {
    try {
        const { data: userData } = await supabaseClient.from('users').select('spotify_access_token').eq('id', session.user.id).single();
        const token = userData?.spotify_access_token || session.provider_token;
        if (!token) return;

        // 1. Obtener la fecha de la última canción en Supabase
        const { data: lastSession } = await supabaseClient
            .from('listening_sessions')
            .select('played_at')
            .eq('user_id', session.user.id)
            .order('played_at', { ascending: false })
            .limit(1);

        let afterTimestamp = 0;
        if (lastSession && lastSession.length > 0) {
            afterTimestamp = new Date(lastSession[0].played_at).getTime();
        } else {
            afterTimestamp = Date.now() - (24 * 60 * 60 * 1000); // Últimas 24h por defecto
        }

        // 2. Consultar Spotify (limitado a las canciones después de afterTimestamp)
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

            // 3. Insertar las faltantes
            const { error } = await supabaseClient.from('listening_sessions')
                .upsert(sessionsToInsert, { onConflict: 'user_id, played_at', ignoreDuplicates: true });
            
            if (!error) {
                console.log(`¡Catch-Up exitoso! Se sincronizaron ${sessionsToInsert.length} canciones en offline.`);
                document.dispatchEvent(new CustomEvent('trackSaved'));
            }
        }
    } catch(e) {
        console.error("Error en sync offline:", e);
    }
}

// Iniciar polling cuando la página cargue
document.addEventListener('DOMContentLoaded', () => {
    // Dar un par de segundos para que la sesión se establezca y revisar
    setTimeout(checkCurrentlyPlaying, 2000);
    // Revisar a Spotify cada 30 segundos de forma invisible
    setInterval(checkCurrentlyPlaying, 30000);
});
