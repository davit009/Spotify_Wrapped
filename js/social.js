import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let activeChallenges = [];
let currentFilter = 'today';

export async function initSocial(currentUser) {
    // Configurar botones de filtro de la Arena
    const filters = ['today', 'week', 'month'];
    filters.forEach(f => {
        document.getElementById(`filter-${f}`)?.addEventListener('click', () => {
            currentFilter = f;
            updateFilterUI();
            loadSocialPage(currentUser.id);
        });
    });

    // Abrir Modal
    document.getElementById('add-friend-btn')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.remove('hidden');
        switchTab('search', currentUser.id);
    });

    // Cerrar Modal
    document.getElementById('close-friend-modal')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.add('hidden');
    });

    // Control de Pestañas del Modal
    document.getElementById('tab-search')?.addEventListener('click', () => switchTab('search', currentUser.id));
    document.getElementById('tab-requests')?.addEventListener('click', () => switchTab('requests', currentUser.id));
    document.getElementById('tab-manage')?.addEventListener('click', () => switchTab('manage', currentUser.id));

    // Buscador de amigos
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

function switchTab(tabName, userId) {
    const tabs = ['search', 'requests', 'manage'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const section = document.getElementById(`section-${t}`);
        if (t === tabName) {
            btn.classList.add('text-[#1DB954]', 'border-[#1DB954]', 'border-b-2');
            btn.classList.remove('text-neutral-500');
            section.classList.remove('hidden');
        } else {
            btn.classList.remove('text-[#1DB954]', 'border-[#1DB954]', 'border-b-2');
            btn.classList.add('text-neutral-500');
            section.classList.add('hidden');
        }
    });

    if (tabName === 'requests') loadPendingRequests(userId);
    if (tabName === 'manage') loadActiveChallengesList(userId);
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
            <div class="mb-6">
                <div class="h-3 bg-white/5 rounded-full flex overflow-hidden">
                    <div class="h-full bg-[#1DB954] transition-all duration-1000" style="width: ${myPercent}%"></div>
                    <div class="h-full bg-red-500/80 transition-all duration-1000" style="width: ${friendPercent}%"></div>
                </div>
            </div>
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

async function loadActiveChallengesList(userId) {
    const list = document.getElementById('active-duels-list');
    list.innerHTML = activeChallenges.length === 0 ? '<p class="text-center text-neutral-600 text-[10px] py-10 italic">No hay duelos activos.</p>' : '';
    
    activeChallenges.forEach(ch => {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10";
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${otherUser.avatar_url || ''}" class="w-10 h-10 rounded-full">
                <div>
                    <h4 class="text-xs font-bold text-white">${otherUser.display_name}</h4>
                    <p class="text-[8px] text-neutral-500 uppercase tracking-widest">Duelo Activo</p>
                </div>
            </div>
            <button class="text-[9px] font-black uppercase text-red-500/50 hover:text-red-500 transition-colors">Terminar</button>
        `;
        list.appendChild(div);
        div.querySelector('button').addEventListener('click', () => {
            if(confirm(`¿Seguro que quieres terminar el duelo con ${otherUser.display_name}?`)) respondChallenge(ch.id, 'finished', userId);
        });
    });
}

async function getWinHistory(userId, friendId) {
    let dots = '';
    for (let i = 6; i >= 0; i--) {
        const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
        const end = new Date(start); end.setHours(23,59,59,999);
        const [myT, friT] = await Promise.all([
            getListeningTimeInRange(userId, start.toISOString(), end.toISOString()),
            getListeningTimeInRange(friendId, start.toISOString(), end.toISOString())
        ]);
        if (myT === 0 && friT === 0) dots += `<div class="win-dot bg-white/5"></div>`;
        else if (myT >= friT) dots += `<div class="win-dot win-user"></div>`;
        else dots += `<div class="win-dot win-friend"></div>`;
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
    let streakCount = 0;
    for (let i = 0; i < 30; i++) {
        const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
        const end = new Date(start); end.setHours(23,59,59,999);
        const [myT, friT] = await Promise.all([getListeningTimeInRange(userId, start.toISOString(), end.toISOString()), getListeningTimeInRange(friendId, start.toISOString(), end.toISOString())]);
        if (myT > friT) streakCount++; else if (i === 0) continue; else break;
    }
    if (streakCount >= 2) { streakCard.classList.remove('hidden'); document.getElementById('streak-days').textContent = streakCount; }
    else streakCard.classList.add('hidden');
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const { data: myS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', startOfToday.toISOString());
    const { data: friS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', friendId).gte('played_at', startOfToday.toISOString());
    const myTracks = new Set((myS || []).map(s => s.track_id));
    const common = (friS || []).filter(s => myTracks.has(s.track_id));
    if (common.length > 0) { matchCard.classList.remove('hidden'); document.getElementById('match-count').textContent = common.length; }
    else matchCard.classList.add('hidden');
}

async function getListeningTime(userId, sinceIso) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', sinceIso);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

async function getListeningTimeInRange(userId, start, end) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', start).lte('played_at', end);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

async function loadPendingRequests(userId) {
    const container = document.getElementById('friend-requests');
    const dot = document.getElementById('req-dot');
    const { data: requests } = await supabaseClient.from('challenges').select(`*, creator:creator_id (display_name, avatar_url)`).eq('opponent_id', userId).eq('status', 'pending');
    if (requests?.length > 0) dot?.classList.remove('hidden'); else dot?.classList.add('hidden');
    container.innerHTML = (requests || []).length === 0 ? '<p class="text-center text-neutral-600 text-[10px] py-10 italic">Sin solicitudes pendientes.</p>' : '';
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
    loadActiveChallengesList(userId);
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
