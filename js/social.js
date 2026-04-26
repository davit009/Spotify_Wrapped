import { supabaseClient } from './supabase.js';

let activeChallenges = [];
let currentIndex = 0;

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
            if (query.length < 2) {
                searchResults.innerHTML = '';
                return;
            }
            searchTimeout = setTimeout(async () => {
                const { data } = await supabaseClient
                    .from('users').select('id, display_name, avatar_url')
                    .ilike('display_name', `%${query}%`).neq('id', currentUser.id).limit(10);
                renderSearchResults(data, currentUser.id);
            }, 400);
        });
    }

    loadPendingRequests(currentUser.id);
    setupCarouselNav();
}

/**
 * Carga el contenido dinámico de la página Social
 */
export async function loadSocialPage(userId) {
    // 1. Obtener Dúos Activos (Aceptados)
    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select(`*, creator:creator_id (display_name, avatar_url), opponent:opponent_id (display_name, avatar_url)`)
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    activeChallenges = challenges || [];
    renderArenaCarousel(userId);
    loadCommonTracks(userId);
}

/**
 * Renderiza el carrusel de comparativas (La Arena)
 */
async function renderArenaCarousel(userId) {
    const container = document.getElementById('arena-carousel');
    if (!container) return;

    if (activeChallenges.length === 0) {
        container.innerHTML = `
            <div class="arena-card flex flex-col items-center justify-center glass rounded-[3rem] p-20 text-center">
                <div class="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                    <svg class="w-10 h-10 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                </div>
                <h3 class="text-xl font-black italic text-white mb-2">No tienes duelos activos</h3>
                <p class="text-sm text-neutral-500 max-w-xs mx-auto">Busca a un amigo en el menú de perfil para empezar a comparar vuestra música.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    
    for (const ch of activeChallenges) {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

        // Cálculos de tiempo hoy
        const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
        const actualStart = new Date(ch.start_date);
        const dayFilter = new Date(Math.max(startOfToday, actualStart)).toISOString();

        const [myTime, friendTime] = await Promise.all([
            getListeningTime(userId, dayFilter),
            getListeningTime(opponentId, dayFilter)
        ]);

        const total = myTime + friendTime || 1;
        const myPercent = (myTime / total) * 100;
        const friendPercent = (friendTime / total) * 100;

        const myMins = Math.floor(myTime / 60000);
        const friendMins = Math.floor(friendTime / 60000);

        const card = document.createElement('div');
        card.className = "arena-card glass rounded-[3rem] p-8 sm:p-12 flex flex-col gap-10 relative overflow-hidden";
        card.innerHTML = `
            <div class="flex justify-between items-center relative z-10">
                <div class="flex flex-col items-center gap-4 flex-1">
                    <img src="${localStorage.getItem('user_avatar') || ''}" class="w-20 h-20 rounded-full border-4 border-white/5 shadow-2xl user-avatar-placeholder">
                    <div class="text-center">
                        <p class="text-xs font-black uppercase tracking-widest text-[#1DB954]">Tú</p>
                        <p class="text-3xl font-black italic">${myMins}<span class="text-sm font-normal text-neutral-500 ml-1">min</span></p>
                    </div>
                </div>

                <div class="flex flex-col items-center gap-2">
                    <div class="px-4 py-1 bg-white/5 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-neutral-500">VS</div>
                    <div class="h-12 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"></div>
                </div>

                <div class="flex flex-col items-center gap-4 flex-1">
                    <img src="${otherUser.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-20 h-20 rounded-full border-4 border-white/5 shadow-2xl">
                    <div class="text-center">
                        <p class="text-xs font-black uppercase tracking-widest text-neutral-400">${otherUser.display_name}</p>
                        <p class="text-3xl font-black italic">${friendMins}<span class="text-sm font-normal text-neutral-500 ml-1">min</span></p>
                    </div>
                </div>
            </div>

            <div class="space-y-4 relative z-10">
                <div class="flex justify-between text-[10px] font-black uppercase tracking-widest text-neutral-500 px-2">
                    <span>Tu Ritmo</span>
                    <span>Su Ritmo</span>
                </div>
                <div class="progress-bar-bg flex">
                    <div class="progress-bar-fill bg-[#1DB954] shadow-[0_0_15px_rgba(29,185,84,0.3)]" style="width: ${myPercent}%"></div>
                    <div class="progress-bar-fill bg-white/10" style="width: ${friendPercent}%"></div>
                </div>
                <p class="text-center text-sm font-black italic text-white pt-4">
                    ${myTime > friendTime ? '¡Vas liderando hoy!' : myTime < friendTime ? otherUser.display_name + ' te va ganando' : '¡Empate técnico!'}
                </p>
            </div>

            <div class="absolute top-4 right-4">
                <button class="cancel-duel-btn p-3 text-neutral-700 hover:text-red-500 transition-colors" title="Cancelar Duelo">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
        container.appendChild(card);
        
        card.querySelector('.cancel-duel-btn').addEventListener('click', () => {
            if(confirm("¿Seguro que quieres terminar este duelo anual?")) respondChallenge(ch.id, 'finished', userId);
        });
    }

    // Actualizar avatares propios que falten
    document.querySelectorAll('.user-avatar-placeholder').forEach(img => {
        const globalAvatar = document.getElementById('user-avatar')?.src;
        if (globalAvatar) img.src = globalAvatar;
    });
}

function setupCarouselNav() {
    const container = document.getElementById('arena-carousel');
    document.getElementById('prev-duel')?.addEventListener('click', () => {
        container.scrollBy({ left: -container.offsetWidth, behavior: 'smooth' });
    });
    document.getElementById('next-duel')?.addEventListener('click', () => {
        container.scrollBy({ left: container.offsetWidth, behavior: 'smooth' });
    });
}

/**
 * Carga las solicitudes PENDIENTES recibidas
 */
async function loadPendingRequests(userId) {
    const container = document.getElementById('container-requests');
    const badge = document.getElementById('request-badge-count');
    const dot = document.getElementById('request-dot');

    const { data: requests } = await supabaseClient
        .from('challenges').select(`*, creator:creator_id (display_name, avatar_url)`)
        .eq('opponent_id', userId).eq('status', 'pending');

    if (requests && requests.length > 0) {
        badge.textContent = requests.length;
        badge.classList.remove('hidden');
        dot.classList.remove('hidden');
        container.innerHTML = '';
        requests.forEach(req => {
            const div = document.createElement('div');
            div.className = "p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <img src="${req.creator.avatar_url || ''}" class="w-10 h-10 rounded-full">
                    <div><h4 class="text-sm font-bold text-white">${req.creator.display_name}</h4><p class="text-[9px] text-amber-500 uppercase font-black tracking-widest">Nueva Invitación</p></div>
                </div>
                <div class="flex gap-2">
                    <button class="accept-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full">Aceptar</button>
                    <button class="decline-btn p-2 text-neutral-600 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
            `;
            container.appendChild(div);
            div.querySelector('.accept-btn').addEventListener('click', () => respondChallenge(req.id, 'active', userId));
            div.querySelector('.decline-btn').addEventListener('click', () => respondChallenge(req.id, 'declined', userId));
        });
    } else {
        badge.classList.add('hidden');
        dot.classList.add('hidden');
        container.innerHTML = '<p class="text-center text-neutral-600 text-xs py-10 italic">No hay solicitudes.</p>';
    }
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
    if (common.length === 0) {
        container.innerHTML = '<p class="text-[10px] text-neutral-600 italic">Sin coincidencias hoy.</p>';
        return;
    }
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
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${user.avatar_url || ''}" class="w-10 h-10 rounded-full">
                <span class="text-sm font-bold text-white">${user.display_name}</span>
            </div>
            <button class="challenge-btn bg-[#1DB954] text-black text-[10px] font-black py-2 px-4 rounded-full">Retar</button>
        `;
        searchResults.appendChild(div);
        div.querySelector('.challenge-btn').addEventListener('click', () => createChallenge(user.id, currentUserId));
    });
}

async function createChallenge(opponentId, currentUserId) {
    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1); // <--- RETO ANUAL
    const { error } = await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: opponentId, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
    if (error) alert("Invitación ya enviada.");
    else alert("¡Reto anual enviado!");
}
