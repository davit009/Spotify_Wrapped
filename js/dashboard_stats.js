async function loadDynamicStats(session) {
    const userId = session.user.id;
    const token = session.provider_token;

    // 1. Obtener todas las sesiones recientes (de los últimos 7 días)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const { data: recentSessions, error } = await supabaseClient
        .from('listening_sessions')
        .select('track_id, duration_ms, played_at')
        .gte('played_at', weekAgo.toISOString())
        .order('played_at', { ascending: false });

    if (error || !recentSessions) return;

    // 2. Extraer las últimas 5 canciones (Historial Inmediato)
    const last5 = recentSessions.slice(0, 5);
    
    // 3. Calcular la más escuchada de HOY
    const today = new Date();
    today.setHours(0,0,0,0);
    const todaySessions = recentSessions.filter(s => new Date(s.played_at) >= today);
    const topTodayTrackId = getTopTrackId(todaySessions);

    // 4. Calcular la más escuchada de la SEMANA
    const topWeekTrackId = getTopTrackId(recentSessions);

    // Recolectar todos los IDs únicos que necesitamos consultar a Spotify
    const idsToFetch = new Set();
    last5.forEach(s => idsToFetch.add(s.track_id));
    if (topTodayTrackId) idsToFetch.add(topTodayTrackId);
    if (topWeekTrackId) idsToFetch.add(topWeekTrackId);

    if (idsToFetch.size === 0) {
        document.getElementById('recent-tracks-list').innerHTML = '<p class="text-neutral-500 text-sm py-4">No hay historial reciente.</p>';
        return;
    }

    // 5. Consultar API de Spotify (uno por uno para evitar el error 403 de Multi-Get de Spotify 2024)
    let spotifyTracks = {};
    try {
        const fetchPromises = Array.from(idsToFetch).map(async (id) => {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const trackData = await res.json();
                spotifyTracks[trackData.id] = trackData;
            }
        });
        
        await Promise.all(fetchPromises);
    } catch (e) {
        console.error("Error al obtener info de Spotify", e);
    }

    // 6. Renderizar Últimas 5
    const recentList = document.getElementById('recent-tracks-list');
    recentList.innerHTML = '';
    last5.forEach((sessionItem) => {
        const t = spotifyTracks[sessionItem.track_id];
        if (!t) return;
        
        const timeAgo = getTimeAgo(new Date(sessionItem.played_at));
        
        recentList.innerHTML += `
            <div class="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors border-b border-neutral-800/50 last:border-0">
                <img src="${t.album.images[0]?.url}" class="w-10 h-10 rounded-md object-cover">
                <div class="flex-1 overflow-hidden">
                    <p class="text-sm font-bold text-white truncate">${t.name}</p>
                    <p class="text-xs text-neutral-400 truncate">${t.artists[0].name}</p>
                </div>
                <span class="text-xs text-neutral-500">${timeAgo}</span>
            </div>
        `;
    });

    // 7. Renderizar Top del Día
    if (topTodayTrackId && spotifyTracks[topTodayTrackId]) {
        renderTopCard('card-top-today', spotifyTracks[topTodayTrackId]);
    }

    // 8. Renderizar Top de la Semana
    if (topWeekTrackId && spotifyTracks[topWeekTrackId]) {
        renderTopCard('card-top-week', spotifyTracks[topWeekTrackId]);
    }
}

function getTopTrackId(sessionsArray) {
    if (sessionsArray.length === 0) return null;
    const counts = {};
    sessionsArray.forEach(s => {
        counts[s.track_id] = (counts[s.track_id] || 0) + s.duration_ms;
    });
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

function renderTopCard(elementId, trackObj) {
    const container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = `
        <div class="flex items-center gap-4 mt-2">
            <img src="${trackObj.album.images[0]?.url}" class="w-14 h-14 rounded-md shadow-lg object-cover">
            <div class="flex-1 overflow-hidden">
                <p class="text-base font-bold text-white truncate">${trackObj.name}</p>
                <p class="text-sm text-neutral-400 truncate">${trackObj.artists[0].name}</p>
            </div>
        </div>
    `;
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m";
    return Math.floor(seconds) + "s";
}
