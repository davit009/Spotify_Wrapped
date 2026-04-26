import { supabaseClient } from './supabase.js';

let activeChallenges = [];
let currentFilter = 'today';

export async function initSocial(currentUser) {
    const filters = ['today', 'week', 'month'];
    filters.forEach(f => {
        document.getElementById(`filter-${f}`)?.addEventListener('click', () => {
            currentFilter = f;
            updateFilterUI();
            loadSocialPage(currentUser.id);
        });
    });

    document.getElementById('add-friend-btn')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.remove('hidden');
        switchTab('search', currentUser.id);
    });

    document.getElementById('close-friend-modal')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.add('hidden');
    });

    document.getElementById('tab-search')?.addEventListener('click', () => switchTab('search', currentUser.id));
    document.getElementById('tab-requests')?.addEventListener('click', () => switchTab('requests', currentUser.id));
    document.getElementById('tab-manage')?.addEventListener('click', () => switchTab('manage', currentUser.id));

    const searchInput = document.getElementById('friend-search-input');
    if (searchInput) {
        let timeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            const query = e.target.value.trim();
            if (query.length < 2) return;
            timeout = setTimeout(async () => {
                const { data } = await supabaseClient.from('users').select('*').ilike('display_name', `%${query}%`).neq('id', currentUser.id).limit(5);
                renderSearchResults(data, currentUser.id);
            }, 400);
        });
    }
}

function getAvatarHTML(url, name, sizeClass = "w-20 h-20", isRobot = false) {
    if (isRobot) return `<div class="${sizeClass} rounded-full bg-orange-500/20 flex items-center justify-center text-4xl border-2 border-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.2)]">🤖</div>`;
    
    if (url && url.trim() !== '') {
        return `<img src="${url}" class="${sizeClass} rounded-full border-2 border-white/10 shadow-2xl object-cover">`;
    }
    
    const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '??';
    return `<div class="${sizeClass} rounded-full avatar-fallback text-xl">${initials}</div>`;
}

function switchTab(tabName, userId) {
    ['search', 'requests', 'manage'].forEach(t => {
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
            btn.classList.remove('text-neutral-500');
        } else {
            btn.classList.remove('bg-[#1DB954]', 'text-black');
            btn.classList.add('text-neutral-500');
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
    const container = document.getElementById('arena-main-container');
    if (!container) return;

    if (activeChallenges.length === 0) {
        container.innerHTML = `<div class="bg-card p-20 rounded-[3rem] w-full text-center border border-white/5"><p class="text-neutral-500 italic">No hay duelos activos. ¡Busca a un amigo!</p></div>`;
        return;
    }

    const ch = activeChallenges[0]; // Mostramos el duelo principal
    const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
    const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

    const startDate = new Date();
    if (currentFilter === 'today') startDate.setHours(0,0,0,0);
    else if (currentFilter === 'week') startDate.setDate(startDate.getDate() - 7);
    else if (currentFilter === 'month') startDate.setMonth(startDate.getMonth() - 1);

    const [myTime, friendTime] = await Promise.all([
        getListeningTimeInRange(userId, startDate.toISOString(), new Date().toISOString()),
        getListeningTimeInRange(opponentId, startDate.toISOString(), new Date().toISOString())
    ]);

    const myMins = Math.floor(myTime / 60000);
    const friendMins = Math.floor(friendTime / 60000);
    const total = myTime + friendTime;
    const myPercent = total === 0 ? 50 : (myTime / total) * 100;
    const friendPercent = 100 - myPercent;

    const historyDots = await getWinHistory(userId, opponentId);
    const userAvatar = getAvatarHTML(document.getElementById('user-avatar')?.src, "Tú", "w-24 h-24");
    const friendAvatar = getAvatarHTML(otherUser.avatar_url, otherUser.display_name, "w-24 h-24", otherUser.display_name.toUpperCase().includes('ROBOT'));

    container.innerHTML = `
        <div class="bg-card w-full rounded-[4rem] p-10 sm:p-16 border border-white/5 relative overflow-hidden shadow-2xl">
            <!-- CABECERA DEL DUELO -->
            <div class="flex items-center justify-center gap-8 sm:gap-16 mb-12">
                <div class="flex flex-col items-center gap-4">
                    <div class="relative">
                        ${userAvatar}
                        ${myMins >= friendMins && myMins > 0 ? '<span class="absolute -top-3 -right-3 bg-spotify-green text-black text-[9px] font-black px-3 py-1 rounded-full shadow-lg">GANANDO</span>' : ''}
                    </div>
                    <div class="text-center">
                        <p class="text-[10px] font-black uppercase text-spotify-green tracking-widest mb-1">Tú</p>
                        <p class="text-4xl font-black italic tracking-tighter">${myMins}<span class="text-xs font-bold opacity-30 ml-1">M</span></p>
                    </div>
                </div>

                <div class="text-xl font-black text-white/10 italic">VS</div>

                <div class="flex flex-col items-center gap-4">
                    <div class="relative">
                        ${friendAvatar}
                        ${friendMins > myMins ? '<span class="absolute -top-3 -right-3 bg-red-500 text-white text-[9px] font-black px-3 py-1 rounded-full shadow-lg">LÍDER</span>' : ''}
                    </div>
                    <div class="text-center">
                        <p class="text-[10px] font-black uppercase text-red-500 tracking-widest mb-1">${otherUser.display_name.split(' ')[0]}</p>
                        <p class="text-4xl font-black italic tracking-tighter">${friendMins}<span class="text-xs font-bold opacity-30 ml-1">M</span></p>
                    </div>
                </div>
            </div>

            <!-- BARRA DE PROGRESO FULL WIDTH -->
            <div class="space-y-4 mb-8">
                <div class="h-4 bg-black/40 rounded-full flex overflow-hidden border border-white/5 p-0.5">
                    <div class="h-full bg-spotify-green rounded-full transition-all duration-1000 shadow-[0_0_15px_rgba(29,185,84,0.4)]" style="width: ${myPercent}%"></div>
                    <div class="h-full bg-red-600 rounded-full transition-all duration-1000" style="width: ${friendPercent}%"></div>
                </div>
                <div class="flex justify-between px-2">
                    <span class="text-[10px] font-black text-spotify-green">${Math.round(myPercent)}%</span>
                    <span class="text-[10px] font-black text-red-500">${Math.round(friendPercent)}%</span>
                </div>
            </div>

            <!-- HISTORIAL Y ESTADO -->
            <div class="flex flex-col items-center gap-6">
                <div class="flex gap-2.5 bg-black/20 p-3 rounded-2xl border border-white/5">
                    ${historyDots}
                </div>
                
                <div class="py-3 px-8 bg-white/5 rounded-full border border-white/10">
                    <p class="text-center text-[11px] font-black uppercase tracking-[0.4em] ${myMins >= friendMins ? 'text-spotify-green' : 'text-red-500'}">
                        ${myMins >= friendMins ? '¡VAS GANANDO!' : '¡VAS PERDIENDO!'}
                    </p>
                </div>
            </div>
        </div>
    `;
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
        else if (myT >= friT) dots += `<div class="win-dot win-user" title="Victoria"></div>`;
        else dots += `<div class="win-dot win-friend" title="Derrota"></div>`;
    }
    return dots;
}

async function updateStreakAndMatch(userId) {
    if (activeChallenges.length === 0) return;
    const ch = activeChallenges[0];
    const friendId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

    // Racha
    let streakCount = 0;
    for (let i = 0; i < 30; i++) {
        const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
        const end = new Date(start); end.setHours(23,59,59,999);
        const [myT, friT] = await Promise.all([getListeningTimeInRange(userId, start.toISOString(), end.toISOString()), getListeningTimeInRange(friendId, start.toISOString(), end.toISOString())]);
        if (myT > friT) streakCount++; else if (i === 0) continue; else break;
    }
    document.getElementById('streak-days').textContent = streakCount;

    // Match
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const { data: myS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', startOfToday.toISOString());
    const { data: friS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', friendId).gte('played_at', startOfToday.toISOString());
    const myTracks = new Set((myS || []).map(s => s.track_id));
    const common = (friS || []).filter(s => myTracks.has(s.track_id));
    
    const matchCard = document.getElementById('match-card');
    if (common.length > 0) {
        matchCard.classList.remove('hidden');
        document.getElementById('match-count').textContent = common.length;
    } else matchCard.classList.add('hidden');
}

async function getListeningTimeInRange(userId, start, end) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', start).lte('played_at', end);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

async function loadPendingRequests(userId) {
    const container = document.getElementById('friend-requests');
    const { data: requests } = await supabaseClient.from('challenges').select(`*, creator:creator_id (display_name, avatar_url)`).eq('opponent_id', userId).eq('status', 'pending');
    container.innerHTML = (requests || []).length === 0 ? '<p class="text-center text-neutral-600 text-xs py-10 italic">No hay solicitudes pendientes.</p>' : '';
    requests?.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-black/20 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${req.creator.avatar_url || ''}" class="w-10 h-10 rounded-full border border-white/10"><span class="text-sm font-bold text-white">${req.creator.display_name}</span></div><button class="bg-spotify-green text-black text-[10px] font-black px-5 py-2.5 rounded-full shadow-lg">Aceptar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', () => respondChallenge(req.id, 'active', userId));
    });
}

async function respondChallenge(challengeId, status, userId) {
    await supabaseClient.from('challenges').update({ status }).eq('id', challengeId);
    loadSocialPage(userId);
}

async function loadActiveChallengesList(userId) {
    const list = document.getElementById('active-duels-list');
    list.innerHTML = activeChallenges.length === 0 ? '<p class="text-center text-neutral-600 text-xs py-10 italic">No hay duelos activos.</p>' : '';
    activeChallenges.forEach(ch => {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-black/20 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${otherUser.avatar_url || ''}" class="w-10 h-10 rounded-full border border-white/10"><div><p class="text-sm font-bold text-white">${otherUser.display_name}</p><p class="text-[8px] text-neutral-500 uppercase tracking-widest font-black">Duelo Activo</p></div></div><button class="text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase">Terminar</button>`;
        list.appendChild(div);
        div.querySelector('button').addEventListener('click', () => { if(confirm(`¿Terminar duelo con ${otherUser.display_name}?`)) respondChallenge(ch.id, 'finished', userId); });
    });
}

function renderSearchResults(users, currentUserId) {
    const container = document.getElementById('friend-results');
    container.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-black/20 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${u.avatar_url || ''}" class="w-10 h-10 rounded-full border border-white/10"><span class="text-sm font-bold text-white">${u.display_name}</span></div><button class="bg-spotify-green text-black text-[10px] font-black px-5 py-2.5 rounded-full shadow-lg">Retar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', async () => {
            const start = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 1);
            await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: u.id, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
            alert("¡Invitación enviada!");
        });
    });
}
