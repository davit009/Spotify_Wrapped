let currentTrackInfo = null;

async function checkCurrentlyPlaying() {
    // Obtenemos la sesión para conseguir el token de Spotify
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    // Si no hay sesión o falta el token de Spotify, no hacemos nada
    if (!session || !session.provider_token) return;

    try {
        // Consultar a Spotify qué se está reproduciendo ahora mismo
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${session.provider_token}` }
        });

        // Si el token de Spotify expiró (dura 1 hora), re-autenticamos automáticamente
        if (response.status === 401) {
            console.log("Token de Spotify expirado. Refrescando automáticamente...");
            await supabaseClient.auth.signInWithOAuth({
                provider: 'spotify',
                options: {
                    scopes: 'user-read-currently-playing user-read-recently-played user-read-email user-read-private',
                    redirectTo: window.location.origin + '/dashboard.html'
                }
            });
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
    const card = document.getElementById('now-playing-card');
    if (card) card.classList.add('hidden');
}

// Iniciar polling cuando la página cargue
document.addEventListener('DOMContentLoaded', () => {
    // Dar un par de segundos para que la sesión se establezca y revisar
    setTimeout(checkCurrentlyPlaying, 2000);
    // Revisar a Spotify cada 30 segundos de forma invisible
    setInterval(checkCurrentlyPlaying, 30000);
});
