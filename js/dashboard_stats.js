import { supabaseClient } from './supabase.js';

let dailyTracks = [];
let weeklyTracks = [];

/**
 * Inicializa las estadísticas del dashboard
 */
export async function initDashboard(session) {
    const userId = session.user.id;
    
    // Cargar datos en paralelo para velocidad
    await Promise.all([
        loadTotalTime(userId),
        loadTops(userId),
        loadRecentHistory(userId)
    ]);

    // Configurar eventos de clic para los marcadores
    setupClickHandlers();
}

async function loadTotalTime(userId) {
    const { data } = await supabaseClient
        .from('listening_sessions')
        .select('duration_ms')
        .eq('user_id', userId);
    
    const totalMs = (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    
    const el = document.getElementById('stats-total-hours');
    if (el) el.innerHTML = `${hours}<span class="text-lg opacity-40 ml-1">h</span> ${minutes}<span class="text-lg opacity-40 ml-1">m</span>`;
}

async function loadTops(userId) {
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);

    const [todayData, weekData] = await Promise.all([
        getTopTracks(userId, startOfToday.toISOString()),
        getTopTracks(userId, startOfWeek.toISOString())
    ]);

    dailyTracks = todayData;
    weeklyTracks = weekData;

    renderTopCard('card-top-today', todayData[0]);
    renderTopCard('card-top-week', weekData[0]);
}

async function getTopTracks(userId, sinceIso) {
    const { data } = await supabaseClient
        .from('listening_sessions')
        .select('track_id')
        .eq('user_id', userId)
        .gte('played_at', sinceIso);

    if (!data || data.length === 0) return [];

    // Contar ocurrencias
    const counts = {};
    data.forEach(s => counts[s.track_id] = (counts[s.track_id] || 0) + 1);

    // Ordenar y tomar Top 5
    const sortedIds = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(entry => entry[0]);

    // Obtener detalles de Spotify (o caché local)
    const tracks = [];
    for (const id of sortedIds) {
        const cached = localStorage.getItem('spotify_track_' + id);
        if (cached) {
            tracks.push({ ...JSON.parse(cached), play_count: counts[id] });
        } else {
            // Si no está en caché, podrías hacer un fetch a Spotify aquí
            tracks.push({ id, name: "Cargando...", play_count: counts[id] });
        }
    }
    return tracks;
}

function renderTopCard(elementId, track) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (!track) {
        el.innerHTML += `<p class="text-[10px] text-neutral-600 italic">Sin datos aún.</p>`;
        return;
    }

    const imgUrl = track.album?.images[0]?.url || '';
    el.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), transparent), url(${imgUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';

    const content = document.createElement('div');
    content.className = "relative z-10";
    content.innerHTML = `
        <p class="text-xs font-black text-white truncate w-full">${track.name}</p>
        <p class="text-[9px] text-[#1DB954] font-bold uppercase tracking-widest">${track.play_count} veces</p>
    `;
    el.appendChild(content);
}

function setupClickHandlers() {
    document.getElementById('card-top-today')?.addEventListener('click', () => {
        showListModal("Top de Hoy", dailyTracks);
    });
    document.getElementById('card-top-week')?.addEventListener('click', () => {
        showListModal("Top Semanal", weeklyTracks);
    });
}

function showListModal(title, tracks) {
    const modal = document.getElementById('list-modal');
    const body = document.getElementById('list-modal-body');
    const titleEl = document.getElementById('list-modal-title');
    
    if (!modal || !body) return;

    titleEl.textContent = title;
    body.innerHTML = '';

    if (tracks.length === 0) {
        body.innerHTML = '<p class="text-center text-neutral-500 py-10 italic text-sm">No hay canciones registradas en este periodo.</p>';
    } else {
        tracks.forEach((track, index) => {
            const div = document.createElement('div');
            div.className = "flex items-center gap-4 p-3 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors";
            div.innerHTML = `
                <span class="text-xl font-black text-neutral-700 w-6">${index + 1}</span>
                <img src="${track.album?.images[0]?.url || ''}" class="w-12 h-12 rounded-lg shadow-lg">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-white truncate">${track.name}</p>
                    <p class="text-xs text-neutral-500 truncate">${track.artists?.map(a => a.name).join(', ') || ''}</p>
                </div>
                <div class="text-right">
                    <p class="text-xs font-black text-[#1DB954]">${track.play_count}</p>
                    <p class="text-[8px] text-neutral-600 uppercase font-bold">Escuchas</p>
                </div>
            `;
            body.appendChild(div);
        });
    }

    modal.classList.remove('hidden');
}

async function loadRecentHistory(userId) {
    const { data } = await supabaseClient
        .from('listening_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(10);

    const list = document.getElementById('recent-tracks-list');
    if (!list) return;
    list.innerHTML = '';

    if (!data || data.length === 0) {
        list.innerHTML = '<p class="text-center text-neutral-600 py-10 italic">Escucha algo en Spotify para empezar.</p>';
        return;
    }

    data.forEach(session => {
        const cached = localStorage.getItem('spotify_track_' + session.track_id);
        const track = cached ? JSON.parse(cached) : { name: "Canción", artists: [{name: "Artista"}], album: {images:[{url:''}]} };
        
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all group";
        div.innerHTML = `
            <img src="${track.album?.images[0]?.url || ''}" class="w-12 h-12 rounded-xl shadow-lg">
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-white truncate group-hover:text-[#1DB954] transition-colors">${track.name}</p>
                <p class="text-xs text-neutral-500 truncate">${track.artists[0].name}</p>
            </div>
            <div class="text-right shrink-0">
                <p class="text-[10px] font-mono text-neutral-600">${new Date(session.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
        `;
        list.appendChild(div);
    });
}
