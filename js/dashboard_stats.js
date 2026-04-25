let globalStats = {
    today: [],
    week: [],
    recent: [],
    spotifyCache: {}
};

async function loadDynamicStats(session) {
    const userId = session.user.id;

    // Intentar token de sesión primero (disponible justo tras OAuth, sin necesitar BD)
    let token = session.provider_token || null;

    // Si no hay token en sesión, intentar leerlo de la BD una sola vez
    if (!token) {
        try {
            const { data: uData, error: tokenError } = await supabaseClient
                .from('users')
                .select('spotify_access_token')
                .eq('id', userId)
                .single();

            if (tokenError) {
                console.warn('No se pudo leer el token de Spotify de la BD:', tokenError.message,
                    '\n→ Si ves errores 400, ejecuta la migración SQL de Supabase primero.');
            } else {
                token = uData?.spotify_access_token || null;
            }
        } catch (e) {
            console.warn('Error de red al leer token:', e.message);
        }
    }

    if (!token) {
        console.warn('No hay token de Spotify disponible. El historial dinámico requiere iniciar sesión nuevamente.');
        document.getElementById('recent-tracks-list').innerHTML =
            '<p class="text-neutral-500 text-sm py-4">Inicia sesión nuevamente para ver el historial en tiempo real.</p>';
        return;
    }


    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: recentSessions, error } = await supabaseClient
        .from('listening_sessions')
        .select('track_id, duration_ms, played_at')
        .eq('user_id', userId)
        .gte('played_at', weekAgo.toISOString())
        .order('played_at', { ascending: false });

    if (error) {
        console.error('Error leyendo listening_sessions:', JSON.stringify(error));
        document.getElementById('recent-tracks-list').innerHTML =
            '<p class="text-neutral-500 text-sm py-4">Error al leer el historial.</p>';
        return;
    }

    if (!recentSessions || recentSessions.length === 0) {
        document.getElementById('recent-tracks-list').innerHTML =
            '<p class="text-neutral-500 text-sm py-4">No hay historial reciente. Escucha algo en Spotify.</p>';
        return;
    }


    // Guardar para modal
    globalStats.recent = recentSessions.slice(0, 20); // Limitamos a 20 para no saturar la API
    
    const today = new Date();
    today.setHours(0,0,0,0);
    const todaySessions = recentSessions.filter(s => new Date(s.played_at) >= today);
    
    globalStats.today = getTopTracks(todaySessions, 5);
    globalStats.week = getTopTracks(recentSessions, 5);

    // Recolectar IDs iniciales (Top 5 día, Top 5 semana, y las últimas 5)
    const idsToFetch = new Set();
    globalStats.recent.slice(0, 5).forEach(s => idsToFetch.add(s.track_id));
    globalStats.today.forEach(t => idsToFetch.add(t.id));
    globalStats.week.forEach(t => idsToFetch.add(t.id));

    // Consultar API de Spotify inicial
    await fetchTracksFromSpotify(Array.from(idsToFetch), token);

    // Renderizar Vistas Iniciales
    renderRecentList(globalStats.recent.slice(0, 5));
    
    if (globalStats.today.length > 0 && globalStats.spotifyCache[globalStats.today[0].id]) {
        renderTopCard('card-top-today', globalStats.spotifyCache[globalStats.today[0].id], globalStats.today[0].ms);
    } else {
        document.getElementById('card-top-today').innerHTML = '<p class="text-xs text-neutral-600 italic">No hay datos de hoy.</p>';
    }

    if (globalStats.week.length > 0 && globalStats.spotifyCache[globalStats.week[0].id]) {
        renderTopCard('card-top-week', globalStats.spotifyCache[globalStats.week[0].id], globalStats.week[0].ms);
    }

    // Configurar Modales
    setupModals(token);
}

function getTopTracks(sessionsArray, limit = 5) {
    if (sessionsArray.length === 0) return [];
    const counts = {};
    sessionsArray.forEach(s => {
        counts[s.track_id] = (counts[s.track_id] || 0) + s.duration_ms;
    });
    return Object.keys(counts)
        .map(id => ({ id, ms: counts[id] }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, limit);
}

async function fetchTracksFromSpotify(ids, token) {
    const fetchPromises = ids.filter(id => !globalStats.spotifyCache[id]).map(async (id) => {
        try {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const trackData = await res.json();
                globalStats.spotifyCache[trackData.id] = trackData;
            } else if (res.status === 401 || res.status === 400) {
                // Token expirado: loguear sin redirigir. El usuario refrescará sesión naturalmente.
                console.warn(`Token de Spotify expirado al obtener track ${id}. Omitiendo.`);
            }
        } catch(e) {}
    });
    await Promise.all(fetchPromises);
}

function renderRecentList(sessions, containerId = 'recent-tracks-list') {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    sessions.forEach((sessionItem) => {
        const t = globalStats.spotifyCache[sessionItem.track_id];
        if (!t) return;
        const timeAgo = getTimeAgo(new Date(sessionItem.played_at));
        container.innerHTML += `
            <div class="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors border-b border-neutral-800/50 last:border-0">
                <img src="${t.album.images[0]?.url}" class="w-10 h-10 rounded-md object-cover">
                <div class="flex-1 overflow-hidden">
                    <p class="text-sm font-bold text-white truncate">${t.name}</p>
                    <p class="text-xs text-neutral-400 truncate">${t.artists[0].name}</p>
                </div>
                <span class="text-xs text-neutral-500 shrink-0">${timeAgo}</span>
            </div>
        `;
    });
}

function renderTopCard(elementId, trackObj, ms) {
    const container = document.getElementById(elementId);
    if (!container) return;
    const mins = Math.floor(ms / 60000);
    container.innerHTML = `
        <div class="flex items-center gap-4 mt-2 w-full">
            <img src="${trackObj.album.images[0]?.url}" class="w-14 h-14 rounded-md shadow-lg object-cover">
            <div class="flex-1 overflow-hidden">
                <p class="text-base font-bold text-white truncate">${trackObj.name}</p>
                <p class="text-sm text-neutral-400 truncate">${trackObj.artists[0].name}</p>
            </div>
            <div class="text-right shrink-0">
                <span class="text-xs font-black text-[#1DB954] bg-[#1DB954]/10 px-2 py-1 rounded-md">${mins}m</span>
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

// Lógica de Modales
function setupModals(token) {
    const listModal = document.getElementById('list-modal');
    const modalContent = document.getElementById('list-modal-content');
    const modalTitle = document.getElementById('list-modal-title');
    const modalSubtitle = document.getElementById('list-modal-subtitle');
    const modalBody = document.getElementById('list-modal-body');

    function openModal(title, subtitle = '') {
        modalTitle.textContent = title;
        if (subtitle) {
            modalSubtitle.textContent = subtitle;
            modalSubtitle.classList.remove('hidden');
        } else {
            modalSubtitle.classList.add('hidden');
        }
        modalBody.innerHTML = '<p class="text-center text-neutral-500 py-8 animate-pulse">Cargando...</p>';
        listModal.classList.remove('hidden');
        setTimeout(() => {
            modalContent.classList.remove('scale-95', 'opacity-0');
            modalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
    }

    document.getElementById('close-list-modal').addEventListener('click', () => {
        modalContent.classList.remove('scale-100', 'opacity-100');
        modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => listModal.classList.add('hidden'), 150);
    });

    // Clic Historial Reciente
    document.getElementById('recent-history-card').addEventListener('click', async () => {
        openModal('Historial Completo', 'Tus últimas 20 canciones escuchadas');
        
        const idsToFetch = globalStats.recent.map(s => s.track_id);
        await fetchTracksFromSpotify(idsToFetch, token);
        
        modalBody.innerHTML = '';
        renderRecentList(globalStats.recent, 'list-modal-body');
    });

    // Clic Top Hoy
    document.getElementById('top-today-card').addEventListener('click', () => {
        openModal('Obsesión de Hoy', 'Lo que no pudiste dejar de escuchar');
        renderTopListInModal(globalStats.today, 'Hoy');
    });

    // Clic Top Semana
    document.getElementById('top-week-card').addEventListener('click', () => {
        openModal('Rey de la Semana', 'Tus himnos de los últimos 7 días');
        renderTopListInModal(globalStats.week, 'Semana');
    });
}

function renderTopListInModal(topArray, typeName) {
    const modalBody = document.getElementById('list-modal-body');
    modalBody.innerHTML = '';
    
    if (topArray.length === 0) {
        modalBody.innerHTML = '<p class="text-neutral-500">No hay datos suficientes.</p>';
        return;
    }

    // Top 1 (Destacado)
    const t1 = globalStats.spotifyCache[topArray[0].id];
    const mins1 = Math.floor(topArray[0].ms / 60000);
    
    modalBody.innerHTML += `
        <div class="bg-gradient-to-br from-[#1DB954]/20 to-black p-6 rounded-2xl border border-[#1DB954]/50 text-center mb-6 shadow-2xl">
            <p class="text-[#1DB954] font-black text-xs uppercase tracking-widest mb-4">👑 #1 MÁS ESCUCHADA</p>
            <img src="${t1.album.images[0]?.url}" class="w-32 h-32 mx-auto rounded-xl shadow-2xl mb-4 object-cover">
            <h3 class="text-2xl font-bold text-white mb-1">${t1.name}</h3>
            <p class="text-neutral-400 mb-4">${t1.artists[0].name}</p>
            <div class="inline-flex items-center justify-center gap-2 bg-[#1DB954] text-black px-4 py-2 rounded-full font-bold">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Escuchada por ${mins1} minutos
            </div>
            <p class="text-xs text-neutral-500 mt-3">Es tu obsesión principal porque ha sido la canción que más tiempo dejaste reproducir ininterrumpidamente durante ${typeName === 'Hoy' ? 'el día de hoy' : 'los últimos 7 días'}.</p>
        </div>
    `;

    // Runners up
    if (topArray.length > 1) {
        modalBody.innerHTML += '<h4 class="font-bold text-neutral-400 uppercase tracking-widest text-xs mb-3 pl-2">Pisándole los talones:</h4>';
        
        topArray.slice(1).forEach((item, index) => {
            const t = globalStats.spotifyCache[item.id];
            if(!t) return;
            const mins = Math.floor(item.ms / 60000);
            
            modalBody.innerHTML += `
                <div class="flex items-center gap-4 p-3 bg-[#181818] rounded-xl border border-neutral-800">
                    <span class="text-neutral-600 font-black w-4 text-center">#${index + 2}</span>
                    <img src="${t.album.images[0]?.url}" class="w-12 h-12 rounded-md object-cover">
                    <div class="flex-1 overflow-hidden">
                        <p class="text-sm font-bold text-white truncate">${t.name}</p>
                        <p class="text-xs text-neutral-400 truncate">${t.artists[0].name}</p>
                    </div>
                    <span class="text-xs font-bold text-neutral-300 bg-neutral-800 px-2 py-1 rounded-md shrink-0">${mins}m</span>
                </div>
            `;
        });
    }
}
