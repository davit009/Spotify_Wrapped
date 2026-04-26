import { supabaseClient } from './supabase.js';

let activeChallenges = [];
let currentFilter = 'today';
let currentUserData = null;

export async function initSocial(currentUser) {
    currentUserData = currentUser;
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

function formatTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}<span class="text-[10px] opacity-20 ml-0.5">H</span> ${minutes}<span class="text-[10px] opacity-20 ml-0.5">M</span>`;
}

function getAvatarHTML(url, name, sizeClass = "w-20 h-20", isRobot = false) {
    if (isRobot) return `<div class="${sizeClass} rounded-full bg-white/5 flex items-center justify-center text-3xl border border-white/10">🤖</div>`;
    if (url && url.trim() !== '') return `<img src="${url}" class="${sizeClass} rounded-full border border-white/10 object-cover">`;
    const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '??';
    return `<div class="${sizeClass} rounded-full avatar-fallback text-sm tracking-widest">${initials}</div>`;
}

function switchTab(tabName, userId) {
    ['search', 'requests', 'manage'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const section = document.getElementById(`section-${t}`);
        if (t === tabName) {
            btn.classList.add('text-spotify-green', 'border-spotify-green', 'border-b-2');
            btn.classList.remove('text-neutral-500');
            section.classList.remove('hidden');
        } else {
            btn.classList.remove('text-spotify-green', 'border-spotify-green', 'border-b-2');
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
            btn.classList.add('bg-spotify-green', 'text-black');
            btn.classList.remove('text-neutral-500');
        } else {
            btn.classList.remove('bg-spotify-green', 'text-black');
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
        container.innerHTML = `<div class="bg-card p-20 rounded-[3rem] w-full text-center border border-white/5"><p class="text-[10px] font-black uppercase tracking-widest text-neutral-600">Sin datos de comparativa activos</p></div>`;
        return;
    }

    const ch = activeChallenges[0];
    const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
    const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

    const startDate = new Date();
    if (currentFilter === 'today') startDate.setHours(0,0,0,0);
    else if (currentFilter === 'week') startDate.setDate(startDate.getDate() - 7);
    else if (currentFilter === 'month') startDate.setMonth(startDate.getMonth() - 1);

    const finalStart = new Date(Math.max(startDate, new Date(ch.start_date))).toISOString();

    const [myTime, friendTime] = await Promise.all([
        getListeningTimeInRange(userId, finalStart, new Date().toISOString()),
        getListeningTimeInRange(opponentId, finalStart, new Date().toISOString())
    ]);

    const myPercent = (myTime + friendTime) === 0 ? 50 : (myTime / (myTime + friendTime)) * 100;
    const friendPercent = 100 - myPercent;

    let winHistoryHTML = '';
    if (currentFilter === 'week') {
        const historyLines = await getWinHistoryOptimized(userId, opponentId, ch.start_date);
        winHistoryHTML = `<div class="w-full max-w-xs flex gap-1.5 h-1 mb-8">${historyLines}</div>`;
    }

    const userAvatar = getAvatarHTML(currentUserData?.user_metadata?.avatar_url, "Tú", "w-20 h-20");
    const friendAvatar = getAvatarHTML(otherUser.avatar_url, otherUser.display_name, "w-20 h-20", otherUser.display_name.toUpperCase().includes('ROBOT'));

    container.innerHTML = `
        <div class="bg-card w-full rounded-[4rem] p-10 sm:p-16 border border-white/5 relative overflow-hidden">
            <div class="flex items-center justify-center gap-12 sm:gap-20 mb-16">
                <div class="flex flex-col items-center gap-4">
                    ${userAvatar}
                    <div class="text-center">
                        <p class="text-[9px] font-black uppercase text-spotify-green tracking-widest mb-2">Tú</p>
                        <p class="text-3xl font-black italic tracking-tighter">${formatTime(myTime)}</p>
                    </div>
                </div>
                <div class="text-[10px] font-black text-white/5 uppercase tracking-widest">vs</div>
                <div class="flex flex-col items-center gap-4">
                    ${friendAvatar}
                    <div class="text-center">
                        <p class="text-[9px] font-black uppercase text-neutral-500 tracking-widest mb-2">${otherUser.display_name.split(' ')[0]}</p>
                        <p class="text-3xl font-black italic tracking-tighter">${formatTime(friendTime)}</p>
                    </div>
                </div>
            </div>

            <div class="space-y-4 ${currentFilter === 'week' ? 'mb-4' : 'mb-12'}">
                <div class="h-2 bg-black/40 rounded-full flex overflow-hidden border border-white/5">
                    <div class="h-full bg-spotify-green transition-all duration-1000" style="width: ${myPercent}%"></div>
                    <div class="h-full bg-neutral-800 transition-all duration-1000" style="width: ${friendPercent}%"></div>
                </div>
                <div class="flex justify-between px-2 text-[8px] font-black text-neutral-600 uppercase tracking-widest">
                    <span>${Math.round(myPercent)}%</span>
                    <span>${Math.round(friendPercent)}%</span>
                </div>
            </div>

            <div class="flex flex-col items-center">
                ${winHistoryHTML}
                <div class="py-3 px-8 bg-white/[0.02] rounded-2xl border border-white/5">
                    <p class="text-center text-[9px] font-black uppercase tracking-[0.4em] text-neutral-400">
                        ${myTime >= friendTime ? 'Tiempo de escucha superior' : 'Tiempo de escucha inferior'}
                    </p>
                </div>
            </div>
        </div>
    `;
}

async function getWinHistoryOptimized(userId, friendId, challengeStart) {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); sevenDaysAgo.setHours(0,0,0,0);
    const startDate = new Date(Math.max(sevenDaysAgo, new Date(challengeStart)));
    const { data: mySessions } = await supabaseClient.from('listening_sessions').select('duration_ms, played_at').eq('user_id', userId).gte('played_at', startDate.toISOString());
    const { data: friSessions } = await supabaseClient.from('listening_sessions').select('duration_ms, played_at').eq('user_id', friendId).gte('played_at', startDate.toISOString());
    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0);
        const dayStr = d.toDateString();
        const myD = (mySessions || []).filter(s => new Date(s.played_at).toDateString() === dayStr).reduce((acc, s) => acc + s.duration_ms, 0);
        const friD = (friSessions || []).filter(s => new Date(s.played_at).toDateString() === dayStr).reduce((acc, s) => acc + s.duration_ms, 0);
        if (d < new Date(challengeStart)) html += `<div class="win-line bg-transparent border border-white/5"></div>`;
        else if (myD === 0 && friD === 0) html += `<div class="win-line win-none"></div>`;
        else if (myD >= friD) html += `<div class="win-line win-user"></div>`;
        else html += `<div class="win-line win-friend"></div>`;
    }
    return html;
}

async function updateStreakAndMatch(userId) {
    if (activeChallenges.length === 0) return;
    const ch = activeChallenges[0];
    const friendId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;
    const streakCard = document.getElementById('streak-card');

    let streakCount = 0;
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    for (let i = 1; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
        if (d < new Date(ch.start_date)) break;
        const [myT, friT] = await Promise.all([getListeningTimeInRange(userId, d.toISOString(), new Date(d).setHours(23,59,59,999)), getListeningTimeInRange(friendId, d.toISOString(), new Date(d).setHours(23,59,59,999))]);
        if (myT > friT) streakCount++; else break;
    }

    if (streakCount > 0) {
        streakCard.classList.remove('hidden');
        document.getElementById('streak-days').textContent = streakCount;
    } else streakCard.classList.add('hidden');

    const { data: myS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', startOfToday.toISOString());
    const { data: friS } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', friendId).gte('played_at', startOfToday.toISOString());
    const myTracks = new Set((myS || []).map(s => s.track_id));
    const common = (friS || []).filter(s => myTracks.has(s.track_id));
    const matchCard = document.getElementById('match-card');
    if (common.length > 0) { matchCard.classList.remove('hidden'); document.getElementById('match-count').textContent = common.length; }
    else matchCard.classList.add('hidden');
}

async function getListeningTimeInRange(userId, start, end) {
    const { data } = await supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId).gte('played_at', start).lte('played_at', end);
    return (data || []).reduce((acc, s) => acc + s.duration_ms, 0);
}

async function loadPendingRequests(userId) {
    const container = document.getElementById('friend-requests');
    const { data: requests } = await supabaseClient.from('challenges').select(`*, creator:creator_id (display_name, avatar_url)`).eq('opponent_id', userId).eq('status', 'pending');
    container.innerHTML = (requests || []).length === 0 ? '<p class="text-center text-neutral-600 text-[10px] py-10 italic uppercase tracking-widest">Sin solicitudes</p>' : '';
    requests?.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-black/20 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${req.creator.avatar_url || ''}" class="w-8 h-8 rounded-full"><span class="text-xs font-bold text-white">${req.creator.display_name}</span></div><button class="bg-white text-black text-[10px] font-black px-5 py-2 rounded-full">Aceptar</button>`;
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
    list.innerHTML = activeChallenges.length === 0 ? '<p class="text-center text-neutral-600 text-[10px] py-10 italic uppercase tracking-widest">Sin comparativas activas</p>' : '';
    activeChallenges.forEach(ch => {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-black/20 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${otherUser.avatar_url || ''}" class="w-10 h-10 rounded-full border border-white/10"><div><p class="text-sm font-bold text-white">${otherUser.display_name}</p><p class="text-[8px] text-neutral-500 uppercase tracking-widest font-black">Activo</p></div></div><button class="text-[9px] font-black text-neutral-600 hover:text-red-500 uppercase">Remover</button>`;
        list.appendChild(div);
        div.querySelector('button').addEventListener('click', () => { if(confirm(`¿Remover comparativa con ${otherUser.display_name}?`)) respondChallenge(ch.id, 'finished', userId); });
    });
}

function renderSearchResults(users, currentUserId) {
    const container = document.getElementById('friend-results');
    container.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-black/20 rounded-2xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3"><img src="${u.avatar_url || ''}" class="w-10 h-10 rounded-full border border-white/10"><span class="text-sm font-bold text-white">${u.display_name}</span></div><button class="bg-white text-black text-[10px] font-black px-5 py-2 rounded-full">Invitar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', async () => {
            const start = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 1);
            await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: u.id, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
            alert("Invitación enviada.");
        });
    });
}
