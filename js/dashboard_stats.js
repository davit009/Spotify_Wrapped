import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let dailyTracks = [];
let weeklyTracks = [];

export async function initDashboard(session) {
    const userId = session.user.id;
    await Promise.all([
        loadTotalTime(userId),
        loadTops(userId, session),
        loadRecentHistory(userId, session)
    ]);
    setupClickHandlers();
}

/**
 * Carga el tiempo total sumando historial JSON y sesiones en vivo si está habilitado
 */
async function loadTotalTime(userId) {
    // Obtenemos preferencias e historial del usuario
    const { data: user } = await supabaseClient
        .from('users')
        .select('historical_stats, preferences')
        .eq('id', userId)
        .single();

    // Obtenemos sesiones en vivo (tiempo real)
    const { data: realtime } = await supabaseClient
        .from('listening_sessions')
        .select('duration_ms')
        .eq('user_id', userId);
    
    let totalMs = (realtime || []).reduce((acc, s) => acc + s.duration_ms, 0);

    // Si el usuario quiere fusionar el historial (Settings), sumamos los milisegundos del JSON
    if (user?.preferences?.merge_history && user?.historical_stats) {
        const jsonMs = user.historical_stats.totalMsPlayed || 0;
        totalMs += jsonMs;
    }
    
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    
    const el = document.getElementById('stats-total-hours');
    if (el) el.innerHTML = `${hours}<span class="text-xl sm:text-2xl opacity-40 ml-1">h</span> ${minutes}<span class="text-xl sm:text-2xl opacity-40 ml-1">m</span>`;
}

async function loadTops(userId, session) {
    const today = new Date(); today.setHours(0,0,0,0);
    const week = new Date(); week.setDate(week.getDate() - 7);
    const [todayData, weekData] = await Promise.all([
        getTopTracks(userId, today.toISOString(), session),
        getTopTracks(userId, week.toISOString(), session)
    ]);
    dailyTracks = todayData;
    weeklyTracks = weekData;
    renderTopCard('card-top-today', todayData[0]);
    renderTopCard('card-top-week', weekData[0]);
}

async function getTopTracks(userId, sinceIso, session) {
    const { data } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', sinceIso);
    if (!data || data.length === 0) return [];
    const counts = {};
    data.forEach(s => counts[s.track_id] = (counts[s.track_id] || 0) + 1);
    const sortedIds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const tracks = [];
    const token = await getValidToken(userId);

    for (const id of sortedIds) {
        let track = JSON.parse(localStorage.getItem('spotify_track_' + id));
        if (!track && token) {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: {'Authorization': `Bearer ${token}`} });
            if (res.ok) {
                track = await res.json();
                localStorage.setItem('spotify_track_' + id, JSON.stringify(track));
            }
        }
        if (track) tracks.push({ ...track, play_count: counts[id] });
    }
    return tracks;
}

function renderTopCard(elementId, track) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!track) { 
        const title = elementId === 'card-top-today' ? 'Hoy' : 'Semanal';
        el.innerHTML = `<h3 class="text-[8px] font-black uppercase text-neutral-500 mb-1 tracking-widest absolute top-5 left-5">${title}</h3><p class="text-[9px] text-neutral-600 italic">Sin datos.</p>`; 
        return; 
    }
    const imgUrl = track.album?.images[0]?.url || '';
    el.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), transparent), url(${imgUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    
    // Mantener el título arriba
    const titleText = elementId === 'card-top-today' ? 'Hoy' : 'Semanal';
    el.innerHTML = `<h3 class="text-[8px] font-black uppercase text-white/50 mb-1 tracking-widest absolute top-5 left-5">${titleText}</h3>`;
    
    const content = document.createElement('div');
    content.className = "relative z-10";
    content.innerHTML = `<p class="text-[10px] font-black text-white truncate w-full">${track.name}</p><p class="text-[8px] text-[#1DB954] font-bold uppercase tracking-widest">${track.play_count} escuchas</p>`;
    el.appendChild(content);
}

function setupClickHandlers() {
    document.getElementById('card-top-today')?.addEventListener('click', () => showListModal("Top de Hoy", dailyTracks));
    document.getElementById('card-top-week')?.addEventListener('click', () => showListModal("Top Semanal", weeklyTracks));
}

function showListModal(title, tracks) {
    const modal = document.getElementById('list-modal');
    const body = document.getElementById('list-modal-body');
    const titleEl = document.getElementById('list-modal-title');
    if (!modal || !body) return;
    titleEl.textContent = title;
    body.innerHTML = tracks.length === 0 ? '<p class="text-center text-neutral-500 py-10 italic text-xs">Aún no hay datos para mostrar.</p>' : '';
    tracks.forEach((track, index) => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-3 p-2.5 bg-white/5 rounded-2xl border border-white/5";
        div.innerHTML = `<span class="text-lg font-black text-neutral-800 w-5">${index + 1}</span><img src="${track.album?.images[0]?.url || ''}" class="w-10 h-10 rounded-lg shadow-lg"><div class="flex-1 min-w-0"><p class="text-xs font-bold text-white truncate">${track.name}</p><p class="text-[10px] text-neutral-500 truncate">${track.artists[0].name}</p></div><div class="text-right"><p class="text-xs font-black text-[#1DB954]">${track.play_count}</p></div>`;
        body.appendChild(div);
    });
    modal.classList.remove('hidden');
}

async function loadRecentHistory(userId, session) {
    const { data } = await supabaseClient.from('listening_sessions').select('*').eq('user_id', userId).order('played_at', { ascending: false }).limit(5);
    const list = document.getElementById('recent-tracks-list');
    if (!list) return;
    list.innerHTML = '';
    const token = await getValidToken(userId);

    for (const sessionItem of (data || [])) {
        let track = JSON.parse(localStorage.getItem('spotify_track_' + sessionItem.track_id));
        if (!track && token) {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${sessionItem.track_id}`, { headers: {'Authorization': `Bearer ${token}`} });
            if (res.ok) {
                track = await res.json();
                localStorage.setItem('spotify_track_' + sessionItem.track_id, JSON.stringify(track));
            }
        }
        if (!track) continue;
        const div = document.createElement('div');
        div.className = "flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-all";
        div.innerHTML = `<img src="${track.album?.images[0]?.url || ''}" class="w-10 h-10 rounded-lg shadow-lg"><div class="flex-1 min-w-0"><p class="text-xs font-bold text-white truncate">${track.name}</p><p class="text-[10px] text-neutral-500 truncate">${track.artists[0].name}</p></div><div class="text-right"><p class="text-[9px] font-mono text-neutral-600">${new Date(sessionItem.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>`;
        list.appendChild(div);
    }
}
