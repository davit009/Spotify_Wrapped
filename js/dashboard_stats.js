let globalStats = {
    today: [],
    week: [],
    recent: [],
    spotifyCache: {}
};
let _session = null; // módulo-level para que fetchTracksFromSpotify pueda refrescar

async function loadDynamicStats(session) {
    _session = session;
    const userId = session.user.id;

    // Inicializar TokenManager (cachea token de OAuth o BD)
    const token = await TokenManager.init(session);

    if (!token) {
        console.warn('No hay token de Spotify. Intentando refresh...');
        const refreshed = await TokenManager.refresh(session);
        if (!refreshed) {
            showTokenExpiredUI();
            return;
        }
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
    globalStats.recent = recentSessions.slice(0, 20);

    const today = new Date();
    today.setHours(0,0,0,0);
    const todaySessions = recentSessions.filter(s => new Date(s.played_at) >= today);

    globalStats.today = getTopTracks(todaySessions, 5);
    globalStats.week = getTopTracks(recentSessions, 5);

    // Recolectar IDs iniciales
    const idsToFetch = new Set();
    globalStats.recent.slice(0, 5).forEach(s => idsToFetch.add(s.track_id));
    globalStats.today.forEach(t => idsToFetch.add(t.id));
    globalStats.week.forEach(t => idsToFetch.add(t.id));

    // Consultar API de Spotify en batch (usa TokenManager internamente)
    await fetchTracksFromSpotify(Array.from(idsToFetch));

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
    setupModals();
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

/**
 * Muestra un aviso visual amigable cuando el token de Spotify expiró.
 * El token de Spotify dura ~1 hora; el usuario debe re-autenticarse con OAuth.
 */
function showTokenExpiredUI() {
    const reloginBtn = `
        <div class="flex flex-col items-center gap-3 py-6 text-center">
            <svg class="w-10 h-10 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
            <p class="text-neutral-400 text-sm">Tu sesión de Spotify expiró (tokens duran ~1 hora).</p>
            <a href="index.html"
               class="mt-1 bg-[#1DB954] text-black text-sm font-bold px-5 py-2 rounded-full hover:bg-[#1ed760] transition-colors">
                Volver a conectar Spotify
            </a>
        </div>`;

    const els = ['recent-tracks-list', 'card-top-today', 'card-top-week'];
    els.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = reloginBtn;
    });
}

/**
 * Obtiene datos de tracks de Spotify usando el endpoint BATCH /tracks?ids=...
 * Usa TokenManager para obtener/refrescar el token automáticamente.
 * Reintenta UNA VEZ si recibe 401/403 (token expirado).
 */
async function fetchTracksFromSpotify(ids) {
    // Filtrar los que ya están en caché
    const missingIds = ids.filter(id => {
        if (globalStats.spotifyCache[id]) return false;
        try {
            const cached = localStorage.getItem('spotify_track_' + id);
            if (cached) {
                globalStats.spotifyCache[id] = JSON.parse(cached);
                return false;
            }
        } catch(e) {}
        return true;
    });

    if (missingIds.length === 0) return;

    // Verificar rate limit
    if (typeof SpotifyRL !== 'undefined' && !SpotifyRL.canRequest()) {
        const waitMs = SpotifyRL.msUntilUnblock();
        console.warn(`⏳ Rate limit activo. Esperando ${Math.ceil(waitMs / 1000)}s.`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
        const batch = missingIds.slice(i, i + BATCH_SIZE);

        if (typeof SpotifyRL !== 'undefined' && !SpotifyRL.canRequest()) break;

        // Obtener token válido (refresca si es necesario)
        const token = _session ? await TokenManager.getToken(_session) : TokenManager.getCached();
        if (!token) { showTokenExpiredUI(); break; }

        try {
            const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                (data.tracks || []).forEach(trackData => {
                    if (!trackData) return;
                    globalStats.spotifyCache[trackData.id] = trackData;
                    try { localStorage.setItem('spotify_track_' + trackData.id, JSON.stringify(trackData)); } catch(e) {}
                });
            } else if (res.status === 401 || res.status === 400 || res.status === 403) {
                console.warn(`🔒 Token inválido (${res.status}). Intentando refresh automático...`);
                TokenManager.invalidate();
                if (!_session) { showTokenExpiredUI(); break; }

                const newToken = await TokenManager.refresh(_session);
                if (!newToken) { showTokenExpiredUI(); break; }

                // Reintentar este batch con el token nuevo
                const retry = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, {
                    headers: { 'Authorization': `Bearer ${newToken}` }
                });
                if (retry.ok) {
                    const data = await retry.json();
                    (data.tracks || []).forEach(trackData => {
                        if (!trackData) return;
                        globalStats.spotifyCache[trackData.id] = trackData;
                        try { localStorage.setItem('spotify_track_' + trackData.id, JSON.stringify(trackData)); } catch(e) {}
                    });
                } else {
                    showTokenExpiredUI(); break;
                }
            } else if (res.status === 429) {
                if (typeof SpotifyRL !== 'undefined') SpotifyRL.register429(res);
                console.error('🚨 429 - Abortando batch de tracks.');
                break;
            }

            if (i + BATCH_SIZE < missingIds.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        } catch(e) {
            console.error('Error en batch de tracks:', e);
        }
    }
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
function setupModals() {
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
        await fetchTracksFromSpotify(idsToFetch);

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
