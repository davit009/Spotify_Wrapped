document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    // Revisar si ya tiene estadísticas guardadas
    checkSavedStats(session);

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-upload');

    dropzone.addEventListener('click', (e) => {
        if (e.target.id !== 'file-upload') fileInput.click();
    });
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-[#1DB954]', 'bg-[#1DB954]/5');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-[#1DB954]', 'bg-[#1DB954]/5'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-[#1DB954]', 'bg-[#1DB954]/5');
        if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files, session);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) processFiles(e.target.files, session);
    });
});

async function checkSavedStats(session) {
    const { data, error } = await supabaseClient
        .from('users')
        .select('historical_stats')
        .eq('id', session.user.id)
        .single();
        
    if (data && data.historical_stats) {
        document.getElementById('upload-section').classList.add('hidden');
        renderStats(data.historical_stats, session);
    }
}

async function processFiles(files, session) {
    let allData = [];
    document.getElementById('dropzone').querySelector('h3').textContent = 'Procesando y analizando datos...';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith('.json')) {
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                if (Array.isArray(json)) allData = allData.concat(json);
            } catch (err) {
                console.error("Error leyendo", file.name);
            }
        }
    }

    if (allData.length === 0) return;

    // Calcular estadísticas
    let totalMs = 0;
    const artistsCount = {};
    const tracksCount = {};

    allData.forEach(item => {
        const ms = item.ms_played || item.msPlayed || 0;
        const artist = item.master_metadata_album_artist_name || item.artistName;
        const track = item.master_metadata_track_name || item.trackName;
        const uri = item.spotify_track_uri;

        if (ms < 30000 || !artist || !track) return;

        totalMs += ms;
        artistsCount[artist] = (artistsCount[artist] || 0) + ms;
        
        // Guardamos el URI de spotify si existe para poder buscar la foto luego
        const trackKey = `${track} - ${artist}`;
        if (!tracksCount[trackKey]) {
            tracksCount[trackKey] = { ms: 0, uri: uri, trackName: track, artistName: artist };
        }
        tracksCount[trackKey].ms += ms;
    });

    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    const sortedArtists = Object.entries(artistsCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => ({ name: x[0], ms: x[1] }));
    const sortedTracks = Object.values(tracksCount).sort((a, b) => b.ms - a.ms).slice(0, 10);

    const statsObj = {
        hours,
        totalUniqueArtists: Object.keys(artistsCount).length,
        totalUniqueTracks: Object.keys(tracksCount).length,
        topArtists: sortedArtists,
        topTracks: sortedTracks
    };

    // Guardar en la base de datos
    const { error: saveError } = await supabaseClient
        .from('users')
        .update({ historical_stats: statsObj })
        .eq('id', session.user.id);
        
    if (saveError) console.error("Error al guardar en BD:", saveError);

    document.getElementById('upload-section').classList.add('hidden');
    renderStats(statsObj, session);
}

// Variables para reproducir música
let currentAudio = null;
let currentPlayingBtn = null;

async function renderStats(stats, session) {
    document.getElementById('stat-hours').textContent = `${stats.hours}h`;
    document.getElementById('stat-artists').textContent = stats.totalUniqueArtists.toLocaleString();
    document.getElementById('stat-tracks').textContent = stats.totalUniqueTracks.toLocaleString();

    document.getElementById('results').classList.remove('hidden');

    const trackList = document.getElementById('list-tracks');
    const artistList = document.getElementById('list-artists');
    trackList.innerHTML = '<p class="text-neutral-500 text-center py-4 animate-pulse">Cargando portadas desde Spotify...</p>';
    artistList.innerHTML = '<p class="text-neutral-500 text-center py-4 animate-pulse">Buscando artistas...</p>';

    // 1. Obtener datos de Spotify para Canciones (Búsqueda por nombre)
    trackList.innerHTML = '';
    const trackPromises = stats.topTracks.map(async (track, index) => {
        const m = Math.floor(track.ms / (1000 * 60));
        let imgUrl = 'https://via.placeholder.com/150/181818/1DB954?text=🎵';
        let previewUrl = null;
        
        try {
            const query = `${track.trackName} ${track.artistName}`;
            const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, {
                headers: { 'Authorization': `Bearer ${session.provider_token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.tracks && data.tracks.items.length > 0) {
                    const sTrack = data.tracks.items[0];
                    if (sTrack.album.images.length > 0) imgUrl = sTrack.album.images[0].url;
                    previewUrl = sTrack.preview_url;
                }
            }
        } catch (e) {}

        return { index, html: `
            <li class="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors border-b border-neutral-800/50 last:border-0">
                <span class="text-neutral-500 font-bold w-4 text-center flex-shrink-0">${index + 1}</span>
                <div class="relative w-12 h-12 flex-shrink-0 group ${previewUrl ? 'cursor-pointer' : ''}" onclick="togglePlay('${previewUrl}', this)">
                    <img src="${imgUrl}" class="w-12 h-12 rounded-md object-cover shadow-lg ${previewUrl ? 'group-hover:opacity-50 transition-opacity' : ''}">
                    ${previewUrl ? `
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="text-white text-2xl play-icon">▶</span>
                        </div>
                    ` : ''}
                </div>
                <div class="flex flex-col flex-1 overflow-hidden">
                    <span class="font-bold text-white text-sm md:text-base truncate">${track.trackName}</span>
                    <span class="text-xs text-neutral-400 truncate">${track.artistName}</span>
                </div>
                <span class="text-xs font-bold text-[#1DB954] bg-[#1DB954]/10 px-3 py-1 rounded-full flex-shrink-0">${m}m</span>
            </li>
        `};
    });

    const trackResults = await Promise.all(trackPromises);
    trackResults.sort((a, b) => a.index - b.index).forEach(res => {
        trackList.innerHTML += res.html;
    });

    // 2. Obtener datos de Spotify para Artistas (Búsqueda en paralelo)
    artistList.innerHTML = '';
    
    // Promesas para buscar artistas
    const artistPromises = stats.topArtists.map(async (artist, index) => {
        const h = Math.floor(artist.ms / (1000 * 60 * 60));
        let imgUrl = 'https://via.placeholder.com/150/181818/1DB954?text=🎙️';
        
        try {
            const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(artist.name)}&type=artist&limit=1`, {
                headers: { 'Authorization': `Bearer ${session.provider_token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.artists.items.length > 0 && data.artists.items[0].images.length > 0) {
                    imgUrl = data.artists.items[0].images[0].url;
                }
            }
        } catch (e) {}

        return { index, html: `
            <li class="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors border-b border-neutral-800/50 last:border-0">
                <span class="text-neutral-500 font-bold w-4 text-center flex-shrink-0">${index + 1}</span>
                <img src="${imgUrl}" class="w-12 h-12 rounded-full object-cover shadow-lg flex-shrink-0">
                <span class="font-bold text-white text-sm md:text-base flex-1 truncate">${artist.name}</span>
                <span class="text-xs font-bold text-[#1DB954] bg-[#1DB954]/10 px-3 py-1 rounded-full flex-shrink-0">${h}h</span>
            </li>
        `};
    });

    // Esperar a que todos terminen y dibujarlos en orden
    const artistResults = await Promise.all(artistPromises);
    artistResults.sort((a, b) => a.index - b.index).forEach(res => {
        artistList.innerHTML += res.html;
    });
}

// Reproductor de Previas
window.togglePlay = function(previewUrl, containerElement) {
    if (!previewUrl || previewUrl === 'null') return;

    const iconElement = containerElement.querySelector('.play-icon');

    // Si ya está sonando este mismo audio, pausarlo
    if (currentAudio && currentAudio.src === previewUrl) {
        if (!currentAudio.paused) {
            currentAudio.pause();
            iconElement.textContent = '▶';
            return;
        } else {
            currentAudio.play();
            iconElement.textContent = '⏸';
            return;
        }
    }

    // Detener audio anterior si existe
    if (currentAudio) {
        currentAudio.pause();
        if (currentPlayingBtn) currentPlayingBtn.textContent = '▶';
    }

    // Iniciar nuevo audio
    currentAudio = new Audio(previewUrl);
    currentAudio.volume = 0.5;
    currentAudio.play();
    
    iconElement.textContent = '⏸';
    currentPlayingBtn = iconElement;

    // Al terminar de sonar
    currentAudio.onended = () => {
        iconElement.textContent = '▶';
    };
};
