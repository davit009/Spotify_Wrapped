import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let dailyTracks = [];
let weeklyTracks = [];
let currentFilter = 'total';

export async function initDashboard(session) {
    const userId = session.user.id;
    await Promise.all([
        loadTotalTime(userId),
        loadTops(userId, session),
        loadRecentHistory(userId, session)
    ]);
    setupClickHandlers(userId);
}

async function loadTotalTime(userId) {
    const { data: user } = await supabaseClient.from('users').select('historical_stats, preferences').eq('id', userId).single();
    
    let query = supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId);
    
    const now = new Date();
    if (currentFilter === 'today') {
        now.setHours(0,0,0,0);
        query = query.gte('played_at', now.toISOString());
    } else if (currentFilter === 'week') {
        now.setDate(now.getDate() - 7);
        query = query.gte('played_at', now.toISOString());
    } else if (currentFilter === 'month') {
        now.setDate(now.getDate() - 30);
        query = query.gte('played_at', now.toISOString());
    }

    const { data: realtime } = await query;
    
    let totalMs = (realtime || []).reduce((acc, s) => acc + s.duration_ms, 0);
    
    // Solo sumamos el historial histórico si el filtro es 'total'
    if (currentFilter === 'total' && user?.preferences?.merge_history && user?.historical_stats) {
        totalMs += user.historical_stats.totalMsPlayed || 0;
    }
    
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const el = document.getElementById('stats-total-hours');
    if (el) el.innerHTML = `${hours}<span class="text-xl text-white/50 ml-1 not-italic">h</span> ${minutes}<span class="text-xl text-white/50 ml-1 not-italic">m</span>`;
    
    const titleEl = document.getElementById('stats-title');
    if (titleEl) {
        const titles = { today: 'Tiempo Hoy', week: 'Tiempo Semanal', month: 'Tiempo Mensual', total: 'Tiempo Total' };
        titleEl.textContent = titles[currentFilter];
    }
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
    const titleText = elementId === 'card-top-today' ? 'Hoy' : 'Semanal';
    
    if (!track) { 
        el.innerHTML = `<h3 class="text-[8px] font-black uppercase text-white/40 mb-1 tracking-widest absolute top-5 left-5 z-20">${titleText}</h3><p class="text-[9px] text-neutral-600 italic relative z-10">Sin datos.</p>`; 
        return; 
    }

    const imgUrl = track.album?.images[0]?.url || '';
    // Doble degradado: uno abajo para los textos y uno arriba para que el título siempre se vea
    el.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 40%), linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%), url(${imgUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    
    el.innerHTML = `<h3 class="text-[8px] font-black uppercase text-white mb-1 tracking-widest absolute top-5 left-5 z-20 shadow-sm">${titleText}</h3>`;
    
    const content = document.createElement('div');
    content.className = "relative z-10";
    content.innerHTML = `<p class="text-[10px] font-black text-white truncate w-full mb-0.5">${track.name}</p><p class="text-[8px] text-[#1DB954] font-bold uppercase tracking-widest">${track.play_count} escuchas</p>`;
    el.appendChild(content);
}

function setupClickHandlers(userId) {
    const periods = ['today', 'week', 'month', 'total'];
    periods.forEach(p => {
        const btn = document.getElementById(`filter-${p}`);
        if (btn) {
            btn.onclick = () => {
                currentFilter = p;
                loadTotalTime(userId);
                
                // Actualizar UI de botones
                periods.forEach(id => {
                    const b = document.getElementById(`filter-${id}`);
                    if (id === currentFilter) {
                        b.classList.add('bg-[#1DB954]', 'text-black');
                        b.classList.remove('text-neutral-500');
                    } else {
                        b.classList.remove('bg-[#1DB954]', 'text-black');
                        b.classList.add('text-neutral-500');
                    }
                });
            };
        }
    });

    document.getElementById('card-top-today')?.addEventListener('click', () => showListModal("Top de Hoy", dailyTracks));
    document.getElementById('card-top-week')?.addEventListener('click', () => showListModal("Top Semanal", weeklyTracks));
}

function showListModal(title, tracks) {
    const modal = document.getElementById('list-modal');
    const body = document.getElementById('list-modal-body');
    const titleEl = document.getElementById('list-modal-title');
    if (!modal || !body) return;
    titleEl.textContent = title;
    body.innerHTML = tracks.length === 0 ? '<p class="text-center text-neutral-500 py-10 italic text-xs">Sin datos.</p>' : '';
    tracks.forEach((track, index) => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-3 p-2.5 bg-white/5 rounded-2xl border border-white/5";
        div.innerHTML = `<span class="text-lg font-black text-neutral-800 w-5">${index + 1}</span><img src="${track.album?.images[0]?.url || ''}" class="w-10 h-10 rounded-lg shadow-lg"><div class="flex-1 min-w-0"><p class="text-xs font-bold text-white truncate">${track.name}</p><p class="text-[10px] text-neutral-500 truncate">${track.artists[0].name}</p></div><div class="text-right"><p class="text-xs font-black text-[#1DB954]">${track.play_count}</p></div>`;
        body.appendChild(div);
    });
    modal.classList.remove('hidden');
}

async function loadRecentHistory(userId, session) {
    const { data } = await supabaseClient.from('listening_sessions').select('*').eq('user_id', userId).order('played_at', { ascending: false }).limit(20);
    const list = document.getElementById('recent-tracks-list');
    if (!list) return;
    list.innerHTML = '';
    const token = await getValidToken(userId);

    // Lógica de agrupación de canciones consecutivas
    const grouped = [];
    if (data && data.length > 0) {
        data.forEach(item => {
            const last = grouped[grouped.length - 1];
            if (last && last.track_id === item.track_id) {
                last.count = (last.count || 1) + 1;
            } else if (grouped.length < 5) {
                grouped.push({ ...item, count: 1 });
            }
        });
    }

    for (const sessionItem of grouped) {
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
        div.innerHTML = `
            <img src="${track.album?.images[0]?.url || ''}" class="w-10 h-10 rounded-lg shadow-lg">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <p class="text-xs font-bold text-white truncate">${track.name}</p>
                    ${sessionItem.count > 1 ? `<span class="bg-[#1DB954]/20 text-[#1DB954] text-[8px] font-black px-1.5 py-0.5 rounded-md">x${sessionItem.count}</span>` : ''}
                </div>
                <p class="text-[10px] text-neutral-500 truncate">${track.artists[0].name}</p>
            </div>
            <div class="text-right">
                <p class="text-[9px] font-mono text-neutral-600">${new Date(sessionItem.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>`;
        list.appendChild(div);
    }
}
