import { supabaseClient } from './supabase.js';

/**
 * Inicializa la lógica social y de desafíos
 */
export async function initSocial(currentUser) {
    const searchInput = document.getElementById('user-search-input');
    const searchResults = document.getElementById('user-search-results');

    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) {
                searchResults.innerHTML = '';
                return;
            }

            searchTimeout = setTimeout(async () => {
                const { data, error } = await supabaseClient
                    .from('users')
                    .select('id, display_name, avatar_url')
                    .ilike('display_name', `%${query}%`)
                    .neq('id', currentUser.id)
                    .limit(10);

                if (error) return;
                renderSearchResults(data, currentUser.id);
            }, 400);
        });
    }

    // Cargar datos sociales al inicio
    loadActiveChallenges(currentUser.id);
    loadPendingRequests(currentUser.id);
}

/**
 * Carga todo el contenido dinámico de la página Social
 */
export async function loadSocialPage(userId) {
    loadSocialSummaries(userId);
    loadCommonTracks(userId);
}

/**
 * Carga solo los Dúos que ya están ACEPTADOS (Active)
 */
async function loadActiveChallenges(userId) {
    const container = document.getElementById('social-tab-active');
    if (!container) return;

    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (!challenges || challenges.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-neutral-600 text-[10px] uppercase font-black tracking-widest italic">No tienes dúos activos aún.</div>';
        return;
    }

    container.innerHTML = '';
    challenges.forEach(ch => {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const div = document.createElement('div');
        div.className = "p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between hover:bg-white/10 transition-colors cursor-pointer group";
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${otherUser.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-10 h-10 rounded-full shadow-lg">
                <div>
                    <h4 class="text-sm font-bold text-white group-hover:text-[#1DB954] transition-colors">${otherUser.display_name}</h4>
                    <p class="text-[9px] text-[#1DB954] uppercase font-black tracking-widest">En Dúo</p>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <button class="view-btn bg-white/5 text-white text-[10px] font-black py-2 px-4 rounded-full hover:bg-white/20">Ver Arena</button>
                <button class="cancel-btn p-2 text-neutral-600 hover:text-red-500 transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
        container.appendChild(div);

        div.querySelector('.view-btn').addEventListener('click', () => window.location.href = `duel.html?id=${ch.id}`);
        div.querySelector('.cancel-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if(confirm("¿Terminar este Dúo?")) respondChallenge(ch.id, 'finished', userId);
        });
    });
}

/**
 * Carga las solicitudes PENDIENTES recibidas
 */
async function loadPendingRequests(userId) {
    const container = document.getElementById('container-requests');
    if (!container) return;

    const { data: requests } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url)`)
        .eq('opponent_id', userId)
        .eq('status', 'pending');

    const badge = document.getElementById('request-badge');
    if (requests && requests.length > 0) {
        badge?.classList.remove('hidden');
        container.innerHTML = '';
        requests.forEach(req => {
            const div = document.createElement('div');
            div.className = "p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <img src="${req.creator.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-10 h-10 rounded-full">
                    <div>
                        <h4 class="text-sm font-bold text-white">${req.creator.display_name}</h4>
                        <p class="text-[9px] text-amber-500 uppercase font-black tracking-widest">Te invitó a un Dúo</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button class="accept-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full">Aceptar</button>
                    <button class="decline-btn bg-white/10 text-white text-[10px] font-black py-2 px-2 rounded-full hover:bg-red-500/20 hover:text-red-500">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            `;
            container.appendChild(div);

            div.querySelector('.accept-btn').addEventListener('click', () => respondChallenge(req.id, 'active', userId));
            div.querySelector('.decline-btn').addEventListener('click', () => respondChallenge(req.id, 'declined', userId));
        });
    } else {
        badge?.classList.add('hidden');
        container.innerHTML = '<p class="text-center text-neutral-600 text-xs py-10">No tienes solicitudes pendientes.</p>';
    }
}

async function respondChallenge(challengeId, status, userId) {
    await supabaseClient.from('challenges').update({ status }).eq('id', challengeId);
    loadActiveChallenges(userId);
    loadPendingRequests(userId);
}

// ... (Resto de funciones loadSocialSummaries, loadCommonTracks, etc. se mantienen igual)
async function loadSocialSummaries(userId) {
    const todayContent = document.getElementById('social-today-content');
    const weekContent = document.getElementById('social-week-content');

    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active')
        .limit(1);

    if (!challenges || challenges.length === 0) {
        if (todayContent) todayContent.innerHTML = '<p class="text-xs text-neutral-600 italic">No tienes retos activos hoy.</p>';
        return;
    }

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
        <img src="${otherUser.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-12 h-12 rounded-full border-2 ${isWinning ? 'border-[#1DB954]' : 'border-red-500'} shadow-lg">
        <div class="flex-1 min-w-0">
            <p class="text-sm font-black text-white truncate">${isWinning ? '¡Vas ganando!' : otherUser.display_name + ' lidera'}</p>
            <p class="text-[10px] text-neutral-500 uppercase font-bold tracking-widest">${diffMins} min de ventaja</p>
        </div>
    `;
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
    if (common.length === 0) {
        container.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-neutral-600 italic text-center"><p>No hay coincidencias hoy todavía.</p></div>';
        return;
    }
    container.innerHTML = '';
    const uniqueCommon = Array.from(new Map(common.map(item => [item.track_id, item])).values());
    for (const item of uniqueCommon) {
        const cached = localStorage.getItem('spotify_track_' + item.track_id);
        const track = cached ? JSON.parse(cached) : null;
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors";
        div.innerHTML = `<img src="${track?.album?.images[0]?.url || ''}" class="w-14 h-14 rounded-xl object-cover"><div class="flex-1 min-w-0"><p class="text-sm font-bold text-white truncate">${track?.name || 'Canción en común'}</p><p class="text-[10px] text-neutral-500 font-bold uppercase tracking-widest truncate">Escuchada por ti y ${item.users.display_name}</p></div><div class="bg-[#1DB954] text-black text-[10px] font-black px-3 py-1 rounded-full">MATCH</div>`;
        container.appendChild(div);
    }
}

function renderSearchResults(users, currentUserId) {
    const searchResults = document.getElementById('user-search-results');
    searchResults.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors";
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${user.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-10 h-10 rounded-full">
                <span class="text-sm font-bold text-white">${user.display_name}</span>
            </div>
            <button class="challenge-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full hover:scale-105 transition-transform">Retar</button>
        `;
        searchResults.appendChild(div);
        div.querySelector('.challenge-btn').addEventListener('click', () => createChallenge(user.id, currentUserId));
    });
}

async function createChallenge(opponentId, currentUserId) {
    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 10);
    const { error } = await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: opponentId, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
    if (error) alert("Ya existe una invitación pendiente.");
    else { alert("¡Invitación enviada!"); loadPendingRequests(currentUserId); }
}
