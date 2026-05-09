import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let activeChallenges = [];
let currentFilter = 'today';
let currentUserData = null;
let sharePickerOpen = false;

// ── Sistema de Toast Notifications ──
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icon = type === 'success'
        ? `<svg width="13" height="13" fill="none" stroke="#1DB954" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5"/></svg>`
        : `<svg width="13" height="13" fill="none" stroke="#ef4444" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${icon}<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 3000);
}

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

    // Nuevo listener para el botón dentro del perfil
    document.getElementById('open-friends-btn')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.remove('hidden');
        document.getElementById('profile-dropdown').classList.remove('active'); // Cerrar menú
        switchTab('search', currentUser.id);
    });

    document.getElementById('close-friend-modal')?.addEventListener('click', () => {
        document.getElementById('friend-modal').classList.add('hidden');
    });

    document.getElementById('tab-search')?.addEventListener('click', () => switchTab('search', currentUser.id));
    document.getElementById('tab-requests')?.addEventListener('click', () => switchTab('requests', currentUser.id));
    document.getElementById('tab-manage')?.addEventListener('click', () => switchTab('manage', currentUser.id));
    document.getElementById('tab-foryou')?.addEventListener('click', () => switchTab('foryou', currentUser.id));

    const searchInput = document.getElementById('friend-search-input');
    if (searchInput) {
        let timeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            const query = e.target.value.trim();
            if (query.length < 2) return;
            timeout = setTimeout(async () => {
                const { data } = await supabaseClient.from('users').select('id, display_name, avatar_url').ilike('display_name', `%${query}%`).neq('id', currentUser.id).limit(5);
                renderSearchResults(data, currentUser.id);
            }, 400);
        });
    }

    // Botón de copiar link de invitación
    document.getElementById('copy-invite-btn')?.addEventListener('click', () => {
        const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${currentUser.id}`;
        navigator.clipboard.writeText(inviteUrl).then(() => {
            const btn = document.getElementById('copy-invite-btn');
            const originalInner = btn.innerHTML;
            btn.innerHTML = '<span class="text-[8px]">¡COPIADO!</span>';
            setTimeout(() => btn.innerHTML = originalInner, 2000);
        });
    });

    // Manejar invitación entrante
    handleIncomingInvite(currentUser.id);
}

async function handleIncomingInvite(currentUserId) {
    const urlParams = new URLSearchParams(window.location.search);
    const inviterId = urlParams.get('invite');

    if (inviterId && inviterId !== currentUserId) {
        try {
            // Verificar si ya existe una relación
            const { data: existing } = await supabaseClient
                .from('challenges')
                .select('id')
                .or(`and(creator_id.eq.${inviterId},opponent_id.eq.${currentUserId}),and(creator_id.eq.${currentUserId},opponent_id.eq.${inviterId})`)
                .neq('status', 'finished');

            if (existing && existing.length > 0) {
                console.log('Ya existe una relación activa o pendiente.');
            } else {
                // Crear relación automática
                const start = new Date();
                const end = new Date();
                end.setFullYear(end.getFullYear() + 1);

                const { error } = await supabaseClient.from('challenges').insert({
                    creator_id: inviterId,
                    opponent_id: currentUserId,
                    start_date: start.toISOString(),
                    end_date: end.toISOString(),
                    status: 'active' // Lo ponemos directo como activo según la petición
                });

                if (!error) {
                    // Limpiar URL ANTES de recargar para no repetir el proceso
                    window.history.replaceState({}, document.title, window.location.pathname);
                    showToast('¡Nuevo amigo añadido!');
                    setTimeout(() => window.location.href = window.location.pathname, 1500);
                }
            }
        } catch (e) {
            console.error('Error al procesar invitación:', e);
        }
    }
}

function formatTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}<span class="text-[10px] text-white/60 ml-0.5 not-italic font-black uppercase tracking-tighter">h</span> ${minutes}<span class="text-[10px] text-white/60 ml-0.5 not-italic font-black uppercase tracking-tighter">m</span>`;
}

function getAvatarHTML(url, name, sizeClass = "w-20 h-20", isRobot = false) {
    if (isRobot) return `<div class="${sizeClass} rounded-full bg-white/5 flex items-center justify-center text-2xl sm:text-4xl border border-white/10 shadow-xl">🤖</div>`;
    if (url && url.trim() !== '') return `<img src="${url}" class="${sizeClass} rounded-full border border-white/20 shadow-2xl object-cover">`;
    // filter(Boolean) evita crash con strings vacios al hacer split
    const initials = name ? name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) : '??';
    return `<div class="${sizeClass} rounded-full avatar-fallback text-[10px] sm:text-sm tracking-widest border border-white/10">${initials}</div>`;
}

function switchTab(tabName, userId) {
    ['search', 'requests', 'manage', 'foryou'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const section = document.getElementById(`section-${t}`);
        if (!btn || !section) return;
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
    if (tabName === 'foryou') loadForYouTab(userId);
}

function updateFilterUI() {
    ['today', 'week', 'month'].forEach(f => {
        const btn = document.getElementById(`filter-${f}`);
        if (f === currentFilter) {
            btn.classList.add('bg-[#1DB954]', 'text-black');
            btn.classList.remove('text-neutral-400', 'text-neutral-500');
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
        container.innerHTML = `<div class="glass p-12 sm:p-20 rounded-[3rem] w-full text-center"><p class="text-[10px] font-black uppercase tracking-[0.3em] text-neutral-600">Sin comparativas activas</p></div>`;
        return;
    }

    const ch = activeChallenges[0];
    const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
    const opponentId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;

    // Null-guard: el amigo fue eliminado de la DB pero el challenge sigue activo
    if (!otherUser) {
        container.innerHTML = `<div class="glass p-12 sm:p-20 rounded-[3rem] w-full text-center"><p class="text-[10px] font-black uppercase tracking-[0.3em] text-neutral-600">El usuario ya no está disponible</p></div>`;
        return;
    }

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
        winHistoryHTML = `<div class="w-full max-w-xs flex gap-2 h-1 mb-10">${historyLines}</div>`;
    }

    const userAvatar = getAvatarHTML(currentUserData?.user_metadata?.avatar_url, "Tú", "w-16 h-16 sm:w-24 sm:h-24");
    // Optional chaining en display_name: puede ser null si RLS bloquea el join
    const friendName = otherUser.display_name || 'Usuario';
    const isRobot = friendName.toUpperCase().includes('ROBOT');
    const friendAvatar = getAvatarHTML(otherUser.avatar_url, friendName, "w-16 h-16 sm:w-24 sm:h-24", isRobot);

    container.innerHTML = `
        <div class="glass w-full rounded-[3rem] sm:rounded-[4rem] p-8 sm:p-20 relative overflow-hidden flex flex-col items-center">
            <div class="flex items-center justify-center gap-6 sm:gap-24 mb-10 sm:mb-16 w-full">
                <div class="flex flex-col items-center gap-4 sm:gap-6 flex-1 min-w-0">
                    <div class="relative shrink-0">${userAvatar}</div>
                    <div class="text-center w-full">
                        <p class="text-[8px] sm:text-[10px] font-black uppercase text-[#1DB954] tracking-[0.2em] sm:tracking-[0.3em] mb-1 sm:mb-2">Tú</p>
                        <p class="text-xl sm:text-4xl font-black italic tracking-tighter text-gradient truncate">${formatTime(myTime)}</p>
                    </div>
                </div>

                <div class="text-[8px] sm:text-[10px] font-black text-white/10 uppercase tracking-[0.3em] sm:tracking-[0.5em] mt-4 shrink-0">vs</div>

                <div class="flex flex-col items-center gap-4 sm:gap-6 flex-1 min-w-0">
                    <div class="relative shrink-0">${friendAvatar}</div>
                    <div class="text-center w-full">
                        <p class="text-[8px] sm:text-[10px] font-black uppercase text-neutral-500 tracking-[0.2em] sm:tracking-[0.3em] mb-1 sm:mb-2">${otherUser.display_name.split(' ')[0]}</p>
                        <p class="text-xl sm:text-4xl font-black italic tracking-tighter truncate">${formatTime(friendTime)}</p>
                    </div>
                </div>
            </div>

            <div class="w-full max-w-lg mb-8 sm:mb-12">
                <div class="h-1.5 sm:h-2 bg-white/5 rounded-full flex overflow-hidden p-0.5">
                    <div class="h-full bg-[#1DB954] transition-all duration-1000 shadow-[0_0_15px_rgba(29,185,84,0.4)]" style="width: ${myPercent}%"></div>
                    <div class="h-full bg-white/5 transition-all duration-1000" style="width: ${friendPercent}%"></div>
                </div>
                <div class="flex justify-between px-2 mt-3 sm:mt-4 text-[8px] sm:text-[9px] font-black text-neutral-600 uppercase tracking-widest">
                    <span>${Math.round(myPercent)}%</span>
                    <span>${Math.round(friendPercent)}%</span>
                </div>
            </div>

            ${winHistoryHTML}

            ${(() => {
                if (myTime > friendTime) return `
                    <div class="py-3 px-8 sm:py-4 sm:px-12 bg-[#1DB954]/10 rounded-2xl sm:rounded-3xl border border-[#1DB954]/30 backdrop-blur-md shadow-[0_0_20px_rgba(29,185,84,0.15)]">
                        <p class="text-center text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] sm:tracking-[0.5em] text-[#1DB954] italic">
                            🏆 ¡Vas ganando!
                        </p>
                    </div>`;
                if (myTime < friendTime) return `
                    <div class="py-3 px-8 sm:py-4 sm:px-12 bg-red-500/10 rounded-2xl sm:rounded-3xl border border-red-500/30 backdrop-blur-md shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                        <p class="text-center text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] sm:tracking-[0.5em] text-red-400 italic">
                            📉 Vas perdiendo
                        </p>
                    </div>`;
                return `
                    <div class="py-3 px-8 sm:py-4 sm:px-12 bg-amber-500/10 rounded-2xl sm:rounded-3xl border border-amber-500/30 backdrop-blur-md shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                        <p class="text-center text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] sm:tracking-[0.5em] text-amber-400 italic">
                            ⚖️ Empate exacto
                        </p>
                    </div>`;
            })()}
        </div>
    `;
}



async function getWinHistoryOptimized(userId, friendId, challengeStart) {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); sevenDaysAgo.setHours(0,0,0,0);
    const startDate = new Date(Math.max(sevenDaysAgo, new Date(challengeStart)));
    const { data: myS } = await supabaseClient.from('listening_sessions').select('duration_ms, played_at').eq('user_id', userId).gte('played_at', startDate.toISOString());
    const { data: friS } = await supabaseClient.from('listening_sessions').select('duration_ms, played_at').eq('user_id', friendId).gte('played_at', startDate.toISOString());
    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0);
        const dayStr = d.toDateString();
        const myD = (myS || []).filter(s => new Date(s.played_at).toDateString() === dayStr).reduce((acc, s) => acc + s.duration_ms, 0);
        const friD = (friS || []).filter(s => new Date(s.played_at).toDateString() === dayStr).reduce((acc, s) => acc + s.duration_ms, 0);
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
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);

    // Optimización: 2 queries en lugar de hasta 60. Traemos 30 días de una vez y calculamos en JS.
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); thirtyDaysAgo.setHours(0,0,0,0);
    const [{ data: myAll }, { data: friAll }] = await Promise.all([
        supabaseClient.from('listening_sessions').select('duration_ms, played_at, track_id').eq('user_id', userId).gte('played_at', thirtyDaysAgo.toISOString()),
        supabaseClient.from('listening_sessions').select('duration_ms, played_at, track_id').eq('user_id', friendId).gte('played_at', thirtyDaysAgo.toISOString())
    ]);

    let streakCount = 0;
    for (let i = 1; i < 30; i++) {
        const dayStart = new Date(); dayStart.setDate(dayStart.getDate() - i); dayStart.setHours(0,0,0,0);
        const dayEnd = new Date(dayStart); dayEnd.setHours(23,59,59,999);
        if (dayStart < new Date(ch.start_date)) break;
        const myD = (myAll || []).filter(s => { const t = new Date(s.played_at); return t >= dayStart && t <= dayEnd; }).reduce((a, s) => a + s.duration_ms, 0);
        const friD = (friAll || []).filter(s => { const t = new Date(s.played_at); return t >= dayStart && t <= dayEnd; }).reduce((a, s) => a + s.duration_ms, 0);
        if (myD > friD) streakCount++; else break;
    }

    if (streakCount > 0) { streakCard.classList.remove('hidden'); document.getElementById('streak-days').textContent = streakCount; }
    else streakCard.classList.add('hidden');

    // Canciones en común hoy
    const myTodayTracks = new Set((myAll || []).filter(s => new Date(s.played_at) >= startOfToday).map(s => s.track_id));
    const common = (friAll || []).filter(s => new Date(s.played_at) >= startOfToday && myTodayTracks.has(s.track_id));
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
    container.innerHTML = (requests || []).length === 0 ? '<p class="text-center text-neutral-600 text-[9px] py-10 uppercase tracking-[0.3em]">Sin solicitudes</p>' : '';
    requests?.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-5 bg-white/5 rounded-3xl border border-white/5";
        // Null-guard: req.creator es null cuando RLS bloquea la lectura del perfil del remitente
        const creatorName = req.creator?.display_name || 'Usuario';
        const creatorAvatar = req.creator?.avatar_url || '';
        div.innerHTML = `<div class="flex items-center gap-3">${getAvatarHTML(creatorAvatar, creatorName, 'w-10 h-10')}<span class="text-sm font-bold text-white">${creatorName}</span></div><button class="bg-white text-black text-[10px] font-black px-6 py-2.5 rounded-full transition-opacity">Aceptar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Aceptando...';
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            await respondChallenge(req.id, 'active', userId);
        });
    });
}

async function respondChallenge(challengeId, status, userId) {
    const { error } = await supabaseClient.from('challenges').update({ status }).eq('id', challengeId);
    if (!error) {
        if (status === 'active') {
            showToast('¡Solicitud aceptada! Ya puedes comparar música');
            document.getElementById('friend-modal').classList.add('hidden');
        } else if (status === 'finished') {
            showToast('Comparativa eliminada correctamente', 'error');
            document.getElementById('friend-modal').classList.add('hidden');
        } else {
            showToast('Solicitud rechazada', 'error');
            document.getElementById('friend-modal').classList.add('hidden');
        }
    } else {
        showToast('Error: no tienes permiso o ya fue procesado', 'error');
        console.error('respondChallenge error:', error);
    }
    loadSocialPage(userId);
}

async function loadActiveChallengesList(userId) {
    const list = document.getElementById('active-duels-list');
    list.innerHTML = activeChallenges.length === 0 ? '<p class="text-center text-neutral-600 text-[9px] py-10 uppercase tracking-[0.3em]">Sin comparativas activas</p>' : '';
    activeChallenges.forEach(ch => {
        const otherUser = ch.creator_id === userId ? ch.opponent : ch.creator;
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-5 bg-white/5 rounded-3xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3">${getAvatarHTML(otherUser.avatar_url, otherUser.display_name, 'w-12 h-12')}<div><p class="text-sm font-bold text-white">${otherUser.display_name}</p><p class="text-[8px] text-neutral-500 uppercase tracking-widest font-black">Activo</p></div></div><button class="text-[9px] font-black text-neutral-600 hover:text-red-500 uppercase">Remover</button>`;
        list.appendChild(div);
        div.querySelector('button').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (btn.dataset.confirmed === '1') {
                // Estado de carga en el segundo click
                btn.disabled = true;
                btn.textContent = 'Eliminando...';
                btn.classList.add('opacity-50', 'cursor-not-allowed');
                await respondChallenge(ch.id, 'finished', userId);
            } else {
                btn.dataset.confirmed = '1';
                btn.textContent = '¿Confirmar?';
                btn.classList.remove('text-neutral-600');
                btn.classList.add('text-red-400');
                setTimeout(() => {
                    if (btn.isConnected && btn.dataset.confirmed === '1') {
                        btn.dataset.confirmed = '0';
                        btn.textContent = 'Remover';
                        btn.classList.remove('text-red-400');
                        btn.classList.add('text-neutral-600');
                    }
                }, 3000);
            }
        });
    });
}

function renderSearchResults(users, currentUserId) {
    const container = document.getElementById('friend-results');
    container.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-5 bg-white/5 rounded-3xl border border-white/5";
        div.innerHTML = `<div class="flex items-center gap-3">${getAvatarHTML(u.avatar_url, u.display_name, 'w-12 h-12')}<span class="text-sm font-bold text-white">${u.display_name}</span></div><button class="bg-white text-black text-[10px] font-black px-6 py-2.5 rounded-full">Invitar</button>`;
        container.appendChild(div);
        div.querySelector('button').addEventListener('click', async () => {
            const start = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 1);
            await supabaseClient.from('challenges').insert({ creator_id: currentUserId, opponent_id: u.id, start_date: start.toISOString(), end_date: end.toISOString(), status: 'pending' });
            showToast(`Solicitud enviada a ${u.display_name} ✅`);
        });
    });
}

// ══════════════════════════════════════════════════════════
// SONG SHARES — Compartir canciones
// ══════════════════════════════════════════════════════════

/**
 * Abre el picker mostrando la canción actual o recientes
 */
async function openSharePicker(userId, receiverId) {
    if (sharePickerOpen) { closeSharePicker(); return; }
    sharePickerOpen = true;

    const picker = document.getElementById('share-picker');
    const list   = document.getElementById('share-tracks-list');
    if (!picker || !list) return;

    picker.classList.remove('hidden');
    list.innerHTML = '<p class="text-[9px] text-neutral-600 text-center py-4">Cargando...</p>';

    const token = await getValidToken(userId);
    if (!token) {
        list.innerHTML = '<p class="text-[9px] text-red-400 text-center py-4">No se pudo obtener el token de Spotify</p>';
        return;
    }

    let tracks = [];

    // Intentar obtener la canción actual primero
    try {
        const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 200) {
            const data = await res.json();
            if (data?.item) tracks.push({ ...data.item, _isCurrent: true });
        }
    } catch (_) {}

    // Completar con recientes (hasta 5 únicas)
    try {
        const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=8', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const seen = new Set(tracks.map(t => t.id));
            for (const item of (data.items || [])) {
                if (!seen.has(item.track.id)) {
                    seen.add(item.track.id);
                    tracks.push(item.track);
                    if (tracks.length >= 6) break;
                }
            }
        }
    } catch (_) {}

    if (tracks.length === 0) {
        list.innerHTML = '<p class="text-[9px] text-neutral-500 text-center py-4">No se encontraron canciones recientes</p>';
        return;
    }

    list.innerHTML = '';
    tracks.forEach(track => {
        const art    = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '';
        const name   = track.name || 'Sin título';
        const artist = track.artists?.map(a => a.name).join(', ') || '';
        const spotUrl = track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`;
        const isCurrent = track._isCurrent || false;

        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-[#1DB954]/30 hover:bg-[#1DB954]/5 cursor-pointer transition-all group';
        row.innerHTML = `
            <img src="${art}" class="w-10 h-10 rounded-xl object-cover shrink-0 shadow-lg">
            <div class="flex-1 min-w-0">
                <p class="text-[11px] font-bold text-white truncate">${name}</p>
                <p class="text-[9px] text-neutral-500 truncate">${artist}</p>
            </div>
            ${isCurrent ? '<span class="text-[7px] font-black uppercase tracking-widest text-[#1DB954] shrink-0">▶ Ahora</span>' : ''}
            <svg class="w-4 h-4 text-neutral-700 group-hover:text-[#1DB954] shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
        `;
        row.addEventListener('click', () => confirmAndSendShare(userId, receiverId, {
            track_id: track.id,
            track_name: name,
            artist_name: artist,
            album_art_url: art,
            spotify_url: spotUrl
        }));
        list.appendChild(row);
    });
}

function closeSharePicker() {
    sharePickerOpen = false;
    document.getElementById('share-picker')?.classList.add('hidden');
    const input = document.getElementById('share-message-input');
    if (input) input.value = '';
}

/**
 * Confirma y guarda el share en Supabase
 */
async function confirmAndSendShare(senderId, receiverId, trackData) {
    const message = document.getElementById('share-message-input')?.value.trim() || null;

    const { error } = await supabaseClient.from('song_shares').insert({
        sender_id:     senderId,
        receiver_id:   receiverId,
        track_id:      trackData.track_id,
        track_name:    trackData.track_name,
        artist_name:   trackData.artist_name,
        album_art_url: trackData.album_art_url,
        spotify_url:   trackData.spotify_url,
        message:       message,
        seen:          false
    });

    if (error) {
        showToast('No se pudo enviar. Inténtalo de nuevo', 'error');
        console.error('song_shares insert error:', error);
    } else {
        closeSharePicker();
        showToast('🎵 ¡Canción compartida!');
    }
}

/**
 * Carga la pestaña "Para ti" con las canciones recibidas
 */
export async function loadForYouTab(userId) {
    const container = document.getElementById('foryou-list');
    if (!container) return;

    container.innerHTML = '<p class="text-[9px] text-neutral-600 text-center py-8">Cargando...</p>';

    const { data: shares, error } = await supabaseClient
        .from('song_shares')
        .select('*, sender:sender_id (display_name, avatar_url)')
        .eq('receiver_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error || !shares || shares.length === 0) {
        container.innerHTML = '<p class="text-[9px] text-neutral-600 text-center py-8 uppercase tracking-[0.3em]">Aún no tienes canciones compartidas</p>';
        return;
    }

    // Marcar todas como vistas
    const unseenIds = shares.filter(s => !s.seen).map(s => s.id);
    if (unseenIds.length > 0) {
        await supabaseClient.from('song_shares').update({ seen: true }).in('id', unseenIds);
        updateForYouBadge(userId);
    }

    container.innerHTML = '';
    shares.forEach(share => {
        const senderName = share.sender?.display_name || 'Alguien';
        const art        = share.album_art_url || '';
        const date       = new Date(share.created_at);
        const dateStr    = date.toLocaleDateString('es', { day: '2-digit', month: 'short' });

        const card = document.createElement('div');
        card.className = `flex items-center gap-4 p-4 rounded-3xl border transition-all ${
            share.seen ? 'bg-white/3 border-white/5' : 'bg-[#1DB954]/5 border-[#1DB954]/20'
        }`;
        card.innerHTML = `
            <img src="${art}" class="w-12 h-12 rounded-2xl object-cover shrink-0 shadow-lg">
            <div class="flex-1 min-w-0">
                <p class="text-[10px] font-black text-white truncate">${share.track_name}</p>
                <p class="text-[9px] text-neutral-500 truncate mb-1">${share.artist_name}</p>
                ${share.message ? `<p class="text-[9px] text-[#1DB954]/80 italic truncate">"${share.message}"</p>` : ''}
                <p class="text-[8px] text-neutral-700 uppercase tracking-widest mt-1">${senderName} · ${dateStr}</p>
            </div>
            <a href="${share.spotify_url}" target="_blank" rel="noopener noreferrer"
               class="shrink-0 flex items-center gap-1.5 bg-[#1DB954] text-black text-[8px] font-black px-3 py-2 rounded-xl hover:bg-[#1ed760] transition-colors shadow-[0_0_12px_rgba(29,185,84,0.25)]">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15.001 10.62 18.661 12.9c.42.18.6.78.3 1.14zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.721 1.62.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                Abrir
            </a>
        `;
        container.appendChild(card);
    });
}

/**
 * Cuenta shares no vistos y actualiza el badge en la UI
 */
export async function updateForYouBadge(userId) {
    const { count } = await supabaseClient
        .from('song_shares')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userId)
        .eq('seen', false);

    const badge = document.getElementById('foryou-badge');
    if (!badge) return;

    if (count && count > 0) {
        badge.textContent = count > 9 ? '9+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}
