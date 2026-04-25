let currentTrackInfo = null;

async function checkCurrentlyPlaying() {
    // Obtenemos la sesión para conseguir el token de Spotify
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    
    // Si no hay sesión o falta el token de Spotify, no hacemos nada
    if (!session || !session.provider_token) return;

    try {
        // Consultar a Spotify qué se está reproduciendo ahora mismo
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${session.provider_token}` }
        });

        // 204 significa que Spotify está pausado o apagado
        if (response.status === 204 || response.status > 400) {
            hideNowPlaying();
            // Si acabamos de pausar, guardamos la canción que estábamos escuchando
            if (currentTrackInfo) {
                await saveTrackToDB(currentTrackInfo, session.user.id);
                currentTrackInfo = null;
            }
            return;
        }

        const data = await response.json();
        
        if (data && data.is_playing && data.item && data.item.type === 'track') {
            const track = data.item;
            showNowPlaying(track);

            // Si cambió de canción, guardamos la canción ANTERIOR en la base de datos
            if (currentTrackInfo && currentTrackInfo.id !== track.id) {
                await saveTrackToDB(currentTrackInfo, session.user.id);
            }
            
            // Actualizamos la canción que estamos monitoreando actualmente
            currentTrackInfo = {
                id: track.id,
                duration_ms: track.duration_ms
            };
        } else {
            hideNowPlaying();
            if (currentTrackInfo) {
                await saveTrackToDB(currentTrackInfo, session.user.id);
                currentTrackInfo = null;
            }
        }
    } catch (error) {
        console.error("Error tracking Spotify:", error);
    }
}

async function saveTrackToDB(trackInfo, userId) {
    const playedAt = new Date().toISOString();
    
    const { error } = await window.supabaseClient
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
