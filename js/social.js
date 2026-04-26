import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let activeChallenges = [];
let currentFilter = 'today';

export async function initSocial(currentUser) {
    // Configurar botones de filtro
    const filters = ['today', 'week', 'month'];
    filters.forEach(f => {
        document.getElementById(`filter-${f}`)?.addEventListener('click', () => {
            currentFilter = f;
            updateFilterUI();
            loadSocialPage(currentUser.id);
        });
    });

    // Configurar buscador de amigos (Boton Buscar Amigos -> Modal)
    document.getElementById('add-friend-btn')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.remove('hidden');
        loadPendingRequests(currentUser.id);
    });
    document.getElementById('close-friend-modal')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.add('hidden');
    });

    // Buscador de amigos real
    const searchInput = document.getElementById('friend-search-input');
    const searchResults = document.getElementById('friend-results');
    if (searchInput) {
        let timeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            const query = e.target.value.trim();
            if (query.length < 2) { searchResults.innerHTML = ''; return; }
            timeout = setTimeout(async () => {
                const { data } = await supabaseClient.from('users').select('*').ilike('display_name', `%${query}%`).neq('id', currentUser.id).limit(5);
                renderSearchResults(data, currentUser.id);
            }, 400);
        });
    }

    loadPendingRequests(currentUser.id);
}

function updateFilterUI() {
    ['today', 'week', 'month'].forEach(f => {
        const btn = document.getElementById(`filter-${f}`);
        if (f === currentFilter) {
            btn.classList.add('bg-[#1DB954]', 'text-black');
            btn.classList.remove('text-neutral-400');
        } else {
            btn.classList.remove('bg-[#1DB954]', 'text-black');
            btn.classList.add('text-neutral-400');
        }
    });
}

export async function loadSocialPage(userId) {
    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active');

    activeChallenges = challenges || [];
    renderArena(userId);
    updateStreakAndMatch(userId);
}

async function renderArena(userId) {
    const container = document.getElementById('arena-container');
    if (!container) return;
    container.innerHTML = '';

    if (activeChallenges.length === 0) {
        container.innerHTML = `<div class="glass p-10 rounded-[3rem] w-full text-center py-20 text-neutral-500 italic">No tienes duelos activos. ¡Busca a un amigo!</div>`;
        return;
    }

    for (const ch of activeChallenges) {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

        // Calcular tiempos según el filtro
        const now = new Date();
        let startDate = new Date();
        if (currentFilter === 'today') startDate.setHours(0,0,0,0);
        else if (currentFilter === 'week') startDate.setDate(now.getDate() - 7);
        else if (currentFilter === 'month') startDate.setMonth(now.getMonth() - 1);

        const [myTime, friendTime] = await Promise.all([
            getListeningTime(userId, startDate.toISOString()),
            getListeningTime(opponentId, startDate.toISOString())
        ]);

        const myMins = Math.floor(myTime / 60000);
        const friendMins = Math.floor(friendTime / 60000);
        const total = myTime + friendTime;
        const myPercent = total === 0 ? 50 : (myTime / total) * 100;
        const friendPercent = 100 - myPercent;

        // Historial de los últimos 7 días (Puntitos)
        const historyDots = await getWinHistory(userId, opponentId);

        const card = document.createElement('div');
        card.className = "glass p-8 rounded-[3.5rem] min-w-[320px] sm:min-w-[450px] snap-center relative border-[#1DB954]/5";
        card.innerHTML = `
            <div class="flex justify-between items-center mb-8">
                <div class="flex flex-col items-center gap-2">
                    <img src="${document.getElementById('user-avatar')?.src || ''}" class="w-16 h-16 rounded-full border-2 ${myMins >= friendMins ? 'border-[#1DB954]' : 'border-white/5'}">
                    <p class="text-[8px] font-black uppercase text-[#1DB954]">Tú</p>
                    <p class="text-2xl font-black italic">${myMins}m</p>
                </div>
                <div class="text-[10px] font-black opacity-10">VS</div>
                <div class="flex flex-col items-center gap-2">
                    <img src="${otherUser.avatar_url || ''}" class="w-16 h-16 rounded-full border-2 ${friendMins > myMins ? 'border-red-500' : 'border-white/5'}">
                    <p class="text-[8px] font-black uppercase text-red-500">${otherUser.display_name.split(' ')[0]}</p>
                    <p class="text-2xl font-black italic">${friendMins}m</p>
                </div>
            </div>

            <!-- BARRA TIRA Y AFLOJA -->
            <div class="mb-6">
                <div class="h-3 bg-white/5 rounded-full flex overflow-hidden">
                    <div class="h-full bg-[#1DB954] transition-all duration-1000" style="width: ${myPercent}%"></div>
                    <div class="h-full bg-red-500/80 transition-all duration-1000" style="width: ${friendPercent}%"></div>
                </div>
            </div>

            <!-- CALENDARIO DE VICTORIAS (ÚLTIMOS 7 DÍAS) -->
            <div class="flex justify-center gap-2 mb-4">
                ${historyDots}
            </div>

            <p class="text-center text-[9px] font-black uppercase tracking-[0.2em] ${myMins >= friendMins ? 'text-[#1DB954]' : 'text-red-500'}">
                ${myMins >= friendMins ? '¡Vas ganando!' : '¡Te van ganando!'}
            </p>
        `;
        container.appendChild(card);
    }
}

async function getWinHistory(userId, friendId) {
    let dots = '';
    for (let i = 6; i >= 0; i--) {
        const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
        const end = new Date(start); end.setHours(23,59,59,999);
        
        const [myTime, friendTime] = await Promise.all([
            getListeningTimeInRange(userId, start.toISOString(), end.toISOString()),
            getListeningTimeInRange(friendId, start.toISOString(), end.toISOString())
        ]);

        if (myTime === 0 && friendTime === 0) {
            dots += `<div class="win-dot bg-white/5"></div>`;
        } else if (myTime >= friendTime) {
            dots += `<div class="win-dot win-user" title="Ganaste este día"></div>`;
        } else {
            dots += `<div class="win-dot win-friend" title="Perdiste este día"></div>`;
        }
    }
    return dots;
}

async function updateStreakAndMatch(userId) {
    const extraSection = document.getElementById('extra-stats-section');
    const streakCard = document.getElementById('streak-card');
    const matchCard = document.getElementById('match-card');
    
    if (activeChallenges.length === 0) { extraSection.classList.add('hidden'); return; }
    extraSection.classList.remove('hidden');

    const ch = activeChallenges[0];
    const friendId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

    // 1. Calcular Racha
    let streakCount = 0;
    for (let i = 0; i < 30; i++) {
        const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
        const end = new Date(start); end.setHours(23,59,59,999);
        const [myT, friT] = await Promise.all([
            getListeningTimeInRange(userId, start.toISOString(), end.toISOString()),
            getListeningTimeInRange(friendId, start.toISOString(), end.toISOString())
        ]);
        if (myT > friT) streakCount++;
        else if (i === 0) continue; // Hoy aún no termina
        else break;
    }

    if (streakCount >= 2) {
        streakCard.classList.remove('hidden');
        document.getElementById('streak-days').textContent = streakCount;
    } else {
        streakCard.classList.add('hidden');
    }

    // 2. Cargar Match Musical
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const { data: myS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', startOfToday.toISOString());
    const { data: friS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', friendId).gte('played_at', startOfToday.toISOString());
    
    const myTracks = new Set((myS || []).map(s => s.track_id));
    const common = (friS || []).filter(s => myTracks.has(s.track_id));
    
    if (common.length > 0) {
        matchCard.classList.remove('hidden');
        document.getElementById('match-count').textContent = common.length;
    } else {
        matchCard.classList.add('hidden');
    }
}

async function getListeningTime(userId, sinceIso) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', sinceIso);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

async function getListeningTimeInRange(userId, start, end) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', start).lte('played_at', end);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

// RESTO DE FUNCIONES DE AMIGOS
async function loadPendingRequests(userId) {
    const container = document.getElementById('friend-requests');
    const { data: requests } = await supabaseClient.from('challenges').select(`*, creator:creator_id (display_name, avatar_url)`).eq('opponent_id', userId).eq('status', 'pending');
    container.innerHTML = (requests || []).length === 0 ? '<p class="text-center text-neutral-600 text-[10px] py-4">Sin solicitudes.</p>' : '';
    requests?.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${req.creator.avatar_url || ''}" class="w-8 h-8 rounded-full"><span class="text-xs font-bold text-white">${req.creator.display_name}</span></div><button class="bg-[#1DB954] text-black text-[10px] font-black px-4 py-2 rounded-full">Aceptar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', () => respondChallenge(req.id, 'active', userId));
    });
}

async function respondChallenge(challengeId, status, userId) {
    await supabaseClient.from('challenges').update({ status }).eq('id', challengeId);
    loadSocialPage(userId);
}

function renderSearchResults(users, currentUserId) {
    const container = document.getElementById('friend-results');
    container.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${u.avatar_url || ''}" class="w-10 h-10 rounded-full"><span class="text-sm font-bold text-white">${u.display_name}</span></div><button class="bg-[#1DB954] text-black text-[10px] font-black px-4 py-2 rounded-full">Retar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', async () => {
            const start = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 1);
            await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: u.id, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
            alert("¡Invitación enviada!");
        });
    });
}
