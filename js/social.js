import { supabaseClient } from './supabase.js';

/**
 * Inicializa la lógica social y de desafíos
 */
export async function initSocial(currentUser) {
    const searchInput = document.getElementById('user-search-input');
    const searchResults = document.getElementById('user-search-results');
    const activeChallengesList = document.getElementById('social-tab-active');

    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) {
                searchResults.innerHTML = '<p class="text-center text-neutral-600 text-xs py-4">Busca por nombre...</p>';
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

    // Cargar retos al inicio
    loadActiveChallenges(currentUser.id);
}

/**
 * Carga todo el contenido dinámico de la página Social
 */
export async function loadSocialPage(userId) {
    // 1. Cargar marcadores (Líder día/semana)
    // Reutilizamos la lógica que antes estaba en dashboard_stats
    loadSocialSummaries(userId);

    // 2. Cargar Historial en Común
    loadCommonTracks(userId);
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
    
    // Obtener mis canciones de hoy
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const { data: mySessions } = await supabaseClient
        .from('listening_sessions')
        .select('track_id')
        .eq('user_id', userId)
        .gte('played_at', startOfToday.toISOString());

    const myTrackIds = new Set((mySessions || []).map(s => s.track_id));
    if (myTrackIds.size === 0) return;

    // Obtener retos activos para ver con quién comparar
    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select('creator_id, opponent_id')
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active');

    const opponentIds = (challenges || []).map(ch => ch.creator_id === userId ? ch.opponent_id : ch.creator_id);
    if (opponentIds.length === 0) return;

    // Obtener canciones de hoy de los oponentes
    const { data: friendSessions } = await supabaseClient
        .from('listening_sessions')
        .select('track_id, user_id, users(display_name)')
        .in('user_id', opponentIds)
        .gte('played_at', startOfToday.toISOString());

    // Encontrar coincidencias
    const common = (friendSessions || []).filter(fs => myTrackIds.has(fs.track_id));
    
    if (common.length === 0) return;

    container.innerHTML = '';
    // Eliminar duplicados de la misma canción
    const uniqueCommon = Array.from(new Map(common.map(item => [item.track_id, item])).values());

    for (const item of uniqueCommon) {
        const cached = localStorage.getItem('spotify_track_' + item.track_id);
        const track = cached ? JSON.parse(cached) : null;
        
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors";
        div.innerHTML = `
            <img src="${track?.album?.images[0]?.url || ''}" class="w-14 h-14 rounded-xl object-cover">
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-white truncate">${track?.name || 'Canción en común'}</p>
                <p class="text-[10px] text-neutral-500 font-bold uppercase tracking-widest truncate">Escuchada por ti y ${item.users.display_name}</p>
            </div>
            <div class="bg-[#1DB954] text-black text-[10px] font-black px-3 py-1 rounded-full">MATCH</div>
        `;
        container.appendChild(div);
    }
}

async function loadActiveChallenges(userId) {
    const activeChallengesList = document.getElementById('social-tab-active');
    if (!activeChallengesList) return;

    const { data: challenges, error } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .neq('status', 'declined')
        .neq('status', 'finished')
        .order('created_at', { ascending: false });

    if (error || !challenges || challenges.length === 0) {
        activeChallengesList.innerHTML = '<div class="text-center py-6 text-neutral-600 text-xs italic">No hay retos activos.</div>';
        return;
    }

    activeChallengesList.innerHTML = '';
    challenges.forEach(ch => {
        const isCreator = ch.creator_id === userId;
        const otherUser = isCreator ? ch.opponent : ch.creator;
        const isPending = ch.status === 'pending';
        
        const div = document.createElement('div');
        div.className = "p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between";
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${otherUser.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-10 h-10 rounded-full">
                <div>
                    <h4 class="text-sm font-bold text-white">${otherUser.display_name}</h4>
                    <p class="text-[10px] ${isPending ? 'text-amber-500' : 'text-[#1DB954]'} uppercase font-black tracking-widest">${isPending ? 'Pendiente' : 'Activo'}</p>
                </div>
            </div>
            <div class="flex gap-2">
                ${!isCreator && isPending ? `
                    <button class="accept-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full">Aceptar</button>
                ` : `
                    <button class="view-btn bg-neutral-800 text-white text-[10px] font-black py-2 px-4 rounded-full hover:bg-neutral-700">${isPending ? 'Esperando' : 'Ver Dúo'}</button>
                `}
                <button class="cancel-btn p-2 text-neutral-600 hover:text-red-500 transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
        activeChallengesList.appendChild(div);

        div.querySelector('.accept-btn')?.addEventListener('click', () => respondChallenge(ch.id, 'active', userId));
        div.querySelector('.cancel-btn')?.addEventListener('click', () => {
            if(confirm("¿Terminar este Dúo?")) respondChallenge(ch.id, 'finished', userId);
        });
        div.querySelector('.view-btn')?.addEventListener('click', () => {
            if (!isPending) window.location.href = `duel.html?id=${ch.id}`;
        });
    });
}

async function respondChallenge(challengeId, status, userId) {
    await supabaseClient.from('challenges').update({ status }).eq('id', challengeId);
    loadActiveChallenges(userId);
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

    const { error } = await supabaseClient
        .from('challenges')
        .insert({
            creator_id: currentUserId,
            opponent_id: opponentId,
            start_date: start.toISOString(),
            end_date: end.toISOString(),
            status: 'pending'
        });

    if (error) {
        alert("Ya existe una invitación pendiente.");
    } else {
        alert("¡Invitación enviada!");
        loadActiveChallenges(currentUserId);
    }
}
