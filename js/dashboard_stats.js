import { supabaseClient } from './supabase.js';

let globalStats = {
    today: [],
    week: [],
    recent: [],
    spotifyCache: {}
};
let _session = null;

/**
 * Inicializa el Dashboard cargando todas las estadísticas
 */
export async function initDashboard(session) {
    _session = session;
    const userId = session.user.id;

    // Inicializar Token de Spotify (vía TokenManager global)
    if (typeof TokenManager !== 'undefined') {
        const token = await TokenManager.init(session);
        if (!token) {
            const refreshed = await TokenManager.refresh(session);
            if (!refreshed) return;
        }
    }

    await loadStats(userId);
    setupModals();
}

async function loadStats(userId) {
    // 1. Obtener Historial Reciente de Supabase
    const { data: recentSessions, error } = await supabaseClient
        .from('listening_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(20);

    if (error) return;

    globalStats.recent = recentSessions;
    
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todaySessions = recentSessions.filter(s => new Date(s.played_at) >= startOfToday);
    
    globalStats.today = getTopTracks(todaySessions, 5);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekSessions = recentSessions.filter(s => new Date(s.played_at) >= weekAgo);
    globalStats.week = getTopTracks(weekSessions, 5);

    // Consultar Metadata de Spotify (con caché local)
    const idsToFetch = new Set();
    globalStats.recent.slice(0, 5).forEach(s => idsToFetch.add(s.track_id));
    globalStats.today.forEach(t => idsToFetch.add(t.id));
    globalStats.week.forEach(t => idsToFetch.add(t.id));

    // Usamos el token disponible en la sesión o BD
    const { data: userData } = await supabaseClient.from('users').select('spotify_access_token').eq('id', userId).single();
    const token = userData?.spotify_access_token || _session.provider_token;

    await fetchTracksFromSpotify(Array.from(idsToFetch), token);

    // Renderizado UI
    renderRecentList(globalStats.recent.slice(0, 5));
    loadSocialSummaries(userId);
    
    if (globalStats.today.length > 0 && globalStats.spotifyCache[globalStats.today[0].id]) {
        renderTopCard('card-top-today', globalStats.spotifyCache[globalStats.today[0].id], globalStats.today[0].ms);
    }
    if (globalStats.week.length > 0 && globalStats.spotifyCache[globalStats.week[0].id]) {
        renderTopCard('card-top-week', globalStats.spotifyCache[globalStats.week[0].id], globalStats.week[0].ms);
    }

    let totalMs = recentSessions.reduce((acc, s) => acc + s.duration_ms, 0);
    const totalHoursEl = document.getElementById('stats-total-hours');
    if (totalHoursEl) totalHoursEl.innerHTML = `${Math.floor(totalMs / 3600000)}<span class="text-lg font-normal text-neutral-600 ml-1">h</span>`;
}

async function loadSocialSummaries(userId) {
    const todayContent = document.getElementById('social-today-content');
    const weekContent = document.getElementById('social-week-content');

    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active')
        .limit(1);

    if (!challenges || challenges.length === 0) return;

    const ch = challenges[0];
    const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
    const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);
    const actualStart = new Date(ch.start_date);

    const dayFilter = new Date(Math.max(startOfToday, actualStart)).toISOString();
    const weekFilter = new Date(Math.max(startOfWeek, actualStart)).toISOString();

    const [myDay, friendDay, myWeek, friendWeek] = await Promise.all([
        getListeningTime(userId, dayFilter),
        getListeningTime(opponentId, dayFilter),
        getListeningTime(userId, weekFilter),
        getListeningTime(opponentId, weekFilter)
    ]);

    if (todayContent) renderSocialCard(todayContent, otherUser, myDay, friendDay);
    if (weekContent) renderSocialCard(weekContent, otherUser, myWeek, friendWeek);
}

async function getListeningTime(userId, sinceIso) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', sinceIso);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

function renderSocialCard(container, otherUser, myTime, friendTime) {
    const isWinning = myTime >= friendTime;
    const diffMins = Math.floor(Math.abs(myTime - friendTime) / 60000);
    container.innerHTML = `
        <img src="${otherUser.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-10 h-10 rounded-full border ${isWinning ? 'border-[#1DB954]' : 'border-red-500'}">
        <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-white truncate">${isWinning ? 'Vas ganando' : 'Te van ganando'}</p>
            <p class="text-[10px] text-neutral-500 uppercase font-bold tracking-widest">${diffMins} min de diferencia</p>
        </div>
    `;
}

function getTopTracks(sessions, limit) {
    const counts = {};
    sessions.forEach(s => {
        counts[s.track_id] = (counts[s.track_id] || 0) + s.duration_ms;
    });
    return Object.entries(counts)
        .map(([id, ms]) => ({ id, ms }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, limit);
}

async function fetchTracksFromSpotify(ids, token) {
    const missingIds = ids.filter(id => !globalStats.spotifyCache[id]);
    for (const id of missingIds) {
        const local = localStorage.getItem('spotify_track_' + id);
        if (local) {
            globalStats.spotifyCache[id] = JSON.parse(local);
            continue;
        }
        try {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                globalStats.spotifyCache[id] = data;
                localStorage.setItem('spotify_track_' + id, JSON.stringify(data));
            }
        } catch (e) {}
    }
}

function renderRecentList(sessions, containerId = 'recent-tracks-list') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = sessions.map(s => {
        const t = globalStats.spotifyCache[s.track_id];
        if (!t) return '';
        return `
            <div class="flex items-center gap-4 p-2 hover:bg-white/5 rounded-xl transition-colors">
                <img src="${t.album.images[0]?.url}" class="w-10 h-10 rounded shadow-lg">
                <div class="flex-1 overflow-hidden">
                    <p class="text-sm font-bold text-white truncate">${t.name}</p>
                    <p class="text-xs text-neutral-500 truncate">${t.artists[0].name}</p>
                </div>
            </div>
        `;
    }).join('');
}

function renderTopCard(id, track, ms) {
    const container = document.getElementById(id);
    if (!container) return;
    const mins = Math.floor(ms / 60000);
    container.innerHTML = `
        <h3 class="text-[10px] font-black uppercase text-neutral-500 mb-4 tracking-widest">${id.includes('today') ? 'Más escuchada (Hoy)' : 'Más escuchada (Semana)'}</h3>
        <div class="flex items-center gap-3">
            <img src="${track.album.images[0]?.url}" class="w-12 h-12 rounded-lg shadow-xl">
            <div class="flex-1 overflow-hidden">
                <p class="text-sm font-bold text-white truncate">${track.name}</p>
                <p class="text-[10px] text-[#1DB954] font-black uppercase">${mins} MINUTOS</p>
            </div>
        </div>
    `;
}

function setupModals() {
    const listModal = document.getElementById('list-modal');
    if (!listModal) return;
    
    document.getElementById('recent-history-card')?.addEventListener('click', () => {
        const body = document.getElementById('list-modal-body');
        document.getElementById('list-modal-title').textContent = "Historial Completo";
        renderRecentList(globalStats.recent, 'list-modal-body');
        listModal.classList.remove('hidden');
    });

    document.getElementById('close-list-modal')?.addEventListener('click', () => listModal.classList.add('hidden'));
}
