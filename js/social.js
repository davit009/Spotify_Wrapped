import { supabaseClient } from './supabase.js';

let activeChallenges = [];

/**
 * Inicializa la lógica social
 */
export async function initSocial(currentUser) {
    const searchInput = document.getElementById('user-search-input');
    const searchResults = document.getElementById('user-search-results');

    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) { searchResults.innerHTML = ''; return; }
            searchTimeout = setTimeout(async () => {
                const { data } = await supabaseClient
                    .from('users').select('id, display_name, avatar_url')
                    .ilike('display_name', `%${query}%`).neq('id', currentUser.id).limit(10);
                renderSearchResults(data, currentUser.id);
            }, 400);
        });
    }

    loadPendingRequests(currentUser.id);
}

/**
 * Carga el contenido dinámico de la página Social
 */
export async function loadSocialPage(userId) {
    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active');

    activeChallenges = challenges || [];
    renderArenaCarousel(userId);
    loadCommonTracks(userId);
    renderLeaders(userId);
}

/**
 * Renderiza el carrusel de comparativas (Arena)
 */
async function renderArenaCarousel(userId) {
    const container = document.getElementById('arena-carousel');
    if (!container) return;

    if (activeChallenges.length === 0) {
        container.innerHTML = `
            <div class="arena-card flex flex-col items-center justify-center glass rounded-[3rem] p-20 text-center">
                <h3 class="text-xl font-black italic text-white mb-2">Sin duelos activos</h3>
                <p class="text-xs text-neutral-500">Invita a alguien desde el menú de perfil.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    
    for (const ch of activeChallenges) {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

        const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
        const dayFilter = new Date(Math.max(startOfToday, new Date(ch.start_date))).toISOString();

        const [myTime, friendTime] = await Promise.all([
            getListeningTime(userId, dayFilter),
            getListeningTime(opponentId, dayFilter)
        ]);

        const myMins = Math.floor(myTime / 60000);
        const friendMins = Math.floor(friendTime / 60000);
        const isWinning = myTime >= friendTime;
        
        // CÁLCULO DE PROGRESO CORREGIDO
        // Si ambos tienen 0, la barra está al 50%. Si uno tiene más, la barra se inclina.
        const total = myTime + friendTime;
        const myPercent = total === 0 ? 50 : (myTime / total) * 100;
        const barColor = isWinning ? '#1DB954' : '#ef4444';

        const card = document.createElement('div');
        card.className = "arena-card glass rounded-[3rem] p-10 flex flex-col gap-8 relative overflow-hidden";
        card.innerHTML = `
            <div class="flex justify-between items-center relative z-10 px-4">
                <div class="flex flex-col items-center gap-4 flex-1">
                    <img src="${document.getElementById('user-avatar')?.src || ''}" class="w-16 h-16 rounded-full border-4 border-white/5 shadow-2xl">
                    <div class="text-center"><p class="text-2xl font-black italic">${myMins}<span class="text-[10px] font-normal opacity-50 ml-1">m</span></p></div>
                </div>
                <div class="flex flex-col items-center px-4"><div class="text-[10px] font-black opacity-20 uppercase tracking-widest">VS</div></div>
                <div class="flex flex-col items-center gap-4 flex-1">
                    <img src="${otherUser.avatar_url || ''}" class="w-16 h-16 rounded-full border-4 border-white/5 shadow-2xl">
                    <div class="text-center"><p class="text-2xl font-black italic">${friendMins}<span class="text-[10px] font-normal opacity-50 ml-1">m</span></p></div>
                </div>
            </div>

            <div class="space-y-4 px-4">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill shadow-[0_0_20px_rgba(29,185,84,0.1)]" 
                         style="width: ${myPercent}%; background-color: ${barColor}">
                    </div>
                </div>
                <p class="text-center text-[10px] font-black uppercase tracking-[0.2em] ${isWinning ? 'text-[#1DB954]' : 'text-red-500'}">
                    ${isWinning ? '¡Vas ganando hoy!' : 'Te van ganando'}
                </p>
            </div>

            <button class="cancel-duel-btn absolute top-6 right-6 text-neutral-800 hover:text-red-500 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        `;
        container.appendChild(card);
        
        card.querySelector('.cancel-duel-btn').addEventListener('click', () => {
            if(confirm("¿Cancelar este duelo anual?")) respondChallenge(ch.id, 'finished', userId);
        });
    }
}

async function renderLeaders(userId) {
    const container = document.getElementById('leader-cards');
    if (!container) return;
    container.innerHTML = '';
    if (activeChallenges.length === 0) return;

    const ch = activeChallenges[0];
    const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
    const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const dayFilter = new Date(Math.max(startOfToday, new Date(ch.start_date))).toISOString();
    const [myDay, friendDay] = await Promise.all([getListeningTime(userId, dayFilter), getListeningTime(opponentId, dayFilter)]);
    container.innerHTML += renderLeaderCard('Líder del Día', otherUser, myDay, friendDay);

    const challengeAgeDays = (Date.now() - new Date(ch.start_date)) / (1000 * 60 * 60 * 24);
    if (challengeAgeDays >= 7) {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        const weekFilter = new Date(Math.max(weekAgo, new Date(ch.start_date))).toISOString();
        const [myWeek, friendWeek] = await Promise.all([getListeningTime(userId, weekFilter), getListeningTime(opponentId, weekFilter)]);
        container.innerHTML += renderLeaderCard('Líder de la Semana', otherUser, myWeek, friendWeek);
    }
}

function renderLeaderCard(title, otherUser, myTime, friendTime) {
    const isWinning = myTime >= friendTime;
    const diffMins = Math.floor(Math.abs(myTime - friendTime) / 60000);
    return `<div class="glass p-6 rounded-[2rem] flex items-center gap-4"><img src="${otherUser.avatar_url || ''}" class="w-10 h-10 rounded-full border-2 ${isWinning ? 'border-[#1DB954]' : 'border-red-500'}"><div class="flex-1 min-w-0"><h4 class="text-[10px] font-black uppercase text-neutral-500 tracking-widest mb-1">${title}</h4><p class="text-sm font-bold text-white truncate">${isWinning ? '¡Vas ganando!' : otherUser.display_name + ' lidera'}</p><p class="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">${diffMins} min de ventaja</p></div></div>`;
}

async function loadPendingRequests(userId) {
    const container = document.getElementById('container-requests');
    const badge = document.getElementById('request-badge-count');
    const dot = document.getElementById('request-dot');
    const { data: requests } = await supabaseClient.from('challenges').select(`*, creator:creator_id (display_name, avatar_url)`).eq('opponent_id', userId).eq('status', 'pending');
    if (requests && requests.length > 0) {
        if(badge) { badge.textContent = requests.length; badge.classList.remove('hidden'); }
        if(dot) dot.classList.remove('hidden');
        container.innerHTML = '';
        requests.forEach(req => {
            const div = document.createElement('div');
            div.className = "p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between mb-2";
            div.innerHTML = `<div class="flex items-center gap-3"><img src="${req.creator.avatar_url || ''}" class="w-8 h-8 rounded-full"><div><h4 class="text-sm font-bold text-white">${req.creator.display_name}</h4><p class="text-[9px] text-amber-500 font-black uppercase">Invitación</p></div></div><div class="flex gap-2"><button class="accept-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full">Aceptar</button><button class="decline-btn p-2 text-neutral-600 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"></path></svg></button></div>`;
            container.appendChild(div);
            div.querySelector('.accept-btn').addEventListener('click', () => respondChallenge(req.id, 'active', userId));
            div.querySelector('.decline-btn').addEventListener('click', () => respondChallenge(req.id, 'declined', userId));
        });
    } else { if(badge) badge.classList.add('hidden'); if(dot) dot.classList.add('hidden'); container.innerHTML = '<p class="text-center text-neutral-600 text-xs py-10 italic">No hay solicitudes.</p>'; }
}

async function respondChallenge(challengeId, status, userId) {
    await supabaseClient.from('challenges').update({ status }).eq('id', challengeId);
    loadSocialPage(userId);
    loadPendingRequests(userId);
}

async function getListeningTime(userId, sinceIso) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', sinceIso);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

async function loadCommonTracks(userId) {
    const container = document.getElementById('common-tracks-list');
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const { data: mySessions } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', startOfToday.toISOString());
    const myTrackIds = new Set((mySessions || []).map(s => s.track_id));
    if (myTrackIds.size === 0) return;
    const { data: challenges } = await supabaseClient.from('challenges').select('creator_id, opponent_id').or(`creator_id.eq.${userId},opponent_id.eq.${userId}`).eq('status', 'active');
    const opponentIds = (challenges || []).map(ch => ch.creator_id === userId ? ch.opponent_id : ch.creator_id);
    if (opponentIds.length === 0) return;
    const { data: friendSessions } = await supabaseClient.from('listening_sessions').select('track_id, user_id, users(display_name)').in('user_id', opponentIds).gte('played_at', startOfToday.toISOString());
    const common = (friendSessions || []).filter(fs => myTrackIds.has(fs.track_id));
    if (common.length === 0) { container.innerHTML = '<p class="text-[10px] text-neutral-600 italic">Sin coincidencias hoy.</p>'; return; }
    container.innerHTML = '';
    const uniqueCommon = Array.from(new Map(common.map(item => [item.track_id, item])).values());
    for (const item of uniqueCommon) {
        const cached = localStorage.getItem('spotify_track_' + item.track_id);
        const track = cached ? JSON.parse(cached) : null;
        const div = document.createElement('div');
        div.className = "flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/5";
        div.innerHTML = `<img src="${track?.album?.images[0]?.url || ''}" class="w-10 h-10 rounded-lg object-cover"><div class="flex-1 min-w-0"><p class="text-xs font-bold text-white truncate">${track?.name || 'Match'}</p><p class="text-[9px] text-neutral-500 uppercase tracking-tighter truncate">Con ${item.users.display_name}</p></div>`;
        container.appendChild(div);
    }
}

function renderSearchResults(users, currentUserId) {
    const searchResults = document.getElementById('user-search-results');
    searchResults.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${user.avatar_url || ''}" class="w-10 h-10 rounded-full"><span class="text-sm font-bold text-white">${user.display_name}</span></div><button class="challenge-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full">Retar</button>`;
        searchResults.appendChild(div);
        div.querySelector('.challenge-btn').addEventListener('click', () => createChallenge(user.id, currentUserId));
    });
}

async function createChallenge(opponentId, currentUserId) {
    const start = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 1);
    const { error } = await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: opponentId, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
    if (error) alert("Invitación ya enviada."); else alert("¡Reto anual enviado!");
}
