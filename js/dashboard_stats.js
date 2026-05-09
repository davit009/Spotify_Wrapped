import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

let dailyTracks  = [];
let weeklyTracks = [];
let currentFilter = 'total';

// Se inyecta desde dashboard.html tras cargar la sesión
export let currentSession = null;
export let friendId       = null; // ID del amigo para compartir

export async function initDashboard(session) {
    currentSession = session;
    const userId = session.user.id;

    // Buscar el amigo activo (challenge activo)
    const { data: challenges } = await supabaseClient
        .from('challenges')
        .select('creator_id, opponent_id')
        .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
        .eq('status', 'active')
        .limit(1);

    if (challenges && challenges.length > 0) {
        const ch = challenges[0];
        friendId = ch.creator_id === userId ? ch.opponent_id : ch.creator_id;
    }

    await Promise.all([
        loadTotalTime(userId),
        loadTops(userId, session),
        loadRecentHistory(userId, session)
    ]);
    setupClickHandlers(userId);
}

async function loadTotalTime(userId) {
    const { data: user } = await supabaseClient.from('users').select('historical_stats, preferences').eq('id', userId).single();
    
    let query = supabaseClient.from('listening_sessions').select('duration_ms').eq('user_id', userId);
    
    const now = new Date();
    if (currentFilter === 'today') {
        now.setHours(0,0,0,0);
        query = query.gte('played_at', now.toISOString());
    } else if (currentFilter === 'week') {
        now.setDate(now.getDate() - 7);
        query = query.gte('played_at', now.toISOString());
    } else if (currentFilter === 'month') {
        now.setDate(now.getDate() - 30);
        query = query.gte('played_at', now.toISOString());
    }

    const { data: realtime } = await query;
    
    let totalMs = (realtime || []).reduce((acc, s) => acc + s.duration_ms, 0);
    
    if (currentFilter === 'total' && user?.preferences?.merge_history && user?.historical_stats) {
        totalMs += user.historical_stats.totalMsPlayed || 0;
    }
    
    const hours   = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const el = document.getElementById('stats-total-hours');
    if (el) el.innerHTML = `${hours}<span class="text-xl text-white/50 ml-1 not-italic">h</span> ${minutes}<span class="text-xl text-white/50 ml-1 not-italic">m</span>`;
    
    const titleEl = document.getElementById('stats-title');
    if (titleEl) {
        const titles = { today: 'Tiempo Hoy', week: 'Tiempo Semanal', month: 'Tiempo Mensual', total: 'Tiempo Total' };
        titleEl.textContent = titles[currentFilter];
    }
}

async function loadTops(userId, session) {
    const today = new Date(); today.setHours(0,0,0,0);
    const week  = new Date(); week.setDate(week.getDate() - 7);
    const [todayData, weekData] = await Promise.all([
        getTopTracks(userId, today.toISOString(), session),
        getTopTracks(userId, week.toISOString(), session)
    ]);
    dailyTracks  = todayData;
    weeklyTracks = weekData;
    renderTopCard('card-top-today', todayData[0]);
    renderTopCard('card-top-week',  weekData[0]);
}

async function getTopTracks(userId, sinceIso, session) {
    const { data } = await supabaseClient.from('listening_sessions').select('track_id').eq('user_id', userId).gte('played_at', sinceIso);
    if (!data || data.length === 0) return [];
    const counts = {};
    data.forEach(s => counts[s.track_id] = (counts[s.track_id] || 0) + 1);
    const sortedIds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const tracks = [];
    const token  = await getValidToken(userId);

    for (const id of sortedIds) {
        let track = JSON.parse(localStorage.getItem('spotify_track_' + id));
        if (!track && token) {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                track = await res.json();
                localStorage.setItem('spotify_track_' + id, JSON.stringify(track));
            }
        }
        if (track) tracks.push({ ...track, play_count: counts[id] });
    }
    return tracks;
}

function renderTopCard(elementId, track) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const titleText = elementId === 'card-top-today' ? 'Hoy' : 'Semanal';
    
    if (!track) {
        el.innerHTML = `<h3 class="text-[8px] font-black uppercase text-white/40 mb-1 tracking-widest absolute top-5 left-5 z-20">${titleText}</h3><p class="text-[9px] text-neutral-600 italic relative z-10">Sin datos.</p>`;
        return;
    }

    const imgUrl = track.album?.images[0]?.url || '';
    el.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 40%), linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%), url(${imgUrl})`;
    el.style.backgroundSize     = 'cover';
    el.style.backgroundPosition = 'center';
    
    el.innerHTML = `<h3 class="text-[8px] font-black uppercase text-white mb-1 tracking-widest absolute top-5 left-5 z-20 shadow-sm">${titleText}</h3>`;
    
    const content = document.createElement('div');
    content.className = 'relative z-10';
    content.innerHTML = `<p class="text-[10px] font-black text-white truncate w-full mb-0.5">${track.name}</p><p class="text-[8px] text-[#1DB954] font-bold uppercase tracking-widest">${track.play_count} escuchas</p>`;
    el.appendChild(content);
}

function setupClickHandlers(userId) {
    const periods = ['today', 'week', 'month', 'total'];
    periods.forEach(p => {
        const btn = document.getElementById(`filter-${p}`);
        if (btn) {
            btn.onclick = () => {
                currentFilter = p;
                loadTotalTime(userId);
                periods.forEach(id => {
                    const b = document.getElementById(`filter-${id}`);
                    if (id === currentFilter) {
                        b.classList.add('bg-[#1DB954]', 'text-black');
                        b.classList.remove('text-neutral-500');
                    } else {
                        b.classList.remove('bg-[#1DB954]', 'text-black');
                        b.classList.add('text-neutral-500');
                    }
                });
            };
        }
    });

    document.getElementById('card-top-today')?.addEventListener('click', () => showListModal('Top de Hoy',     dailyTracks));
    document.getElementById('card-top-week')?.addEventListener('click',  () => showListModal('Top Semanal', weeklyTracks));
}

// ── Modal Top 5 con swipe-to-share ──────────────────────────────────────────

function showListModal(title, tracks) {
    const modal  = document.getElementById('list-modal');
    const body   = document.getElementById('list-modal-body');
    const titleEl= document.getElementById('list-modal-title');
    if (!modal || !body) return;
    titleEl.textContent = title;
    body.innerHTML = tracks.length === 0
        ? '<p class="text-center text-neutral-500 py-10 italic text-xs">Sin datos.</p>'
        : '';

    tracks.forEach((track, index) => {
        const row = buildSwipeRow({
            index: index + 1,
            name:   track.name,
            artist: track.artists[0].name,
            art:    track.album?.images[0]?.url || '',
            badge:  `${track.play_count}`,
            badgeColor: '#1DB954',
            trackData: buildTrackPayload(track)
        });
        body.appendChild(row);
    });

    modal.classList.remove('hidden');
}

// ── Historial reciente con swipe-to-share ───────────────────────────────────

export async function loadRecentHistory(userId, session) {
    const { data } = await supabaseClient
        .from('listening_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(20);

    const list = document.getElementById('recent-tracks-list');
    if (!list) return;
    list.innerHTML = '';
    const token = await getValidToken(userId);

    // Agrupar consecutivas
    const grouped = [];
    if (data && data.length > 0) {
        data.forEach(item => {
            const last = grouped[grouped.length - 1];
            if (last && last.track_id === item.track_id) {
                last.count = (last.count || 1) + 1;
            } else if (grouped.length < 5) {
                grouped.push({ ...item, count: 1 });
            }
        });
    }

    for (const sessionItem of grouped) {
        let track = JSON.parse(localStorage.getItem('spotify_track_' + sessionItem.track_id));
        if (!track && token) {
            const res = await fetch(`https://api.spotify.com/v1/tracks/${sessionItem.track_id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                track = await res.json();
                localStorage.setItem('spotify_track_' + sessionItem.track_id, JSON.stringify(track));
            }
        }
        if (!track) continue;

        const timeStr = new Date(sessionItem.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const row = buildSwipeRow({
            name:   track.name,
            artist: track.artists[0].name,
            art:    track.album?.images[0]?.url || '',
            badge:  sessionItem.count > 1 ? `x${sessionItem.count}` : null,
            badgeColor: '#1DB954',
            extra:  timeStr,
            trackData: buildTrackPayload(track)
        });
        list.appendChild(row);
    }
}

// ── Swipe row builder ─────────────────────────────────────────────────────────

/**
 * Construye una fila con efecto swipe-to-share.
 * Al deslizar ≥ 60px a la derecha se dispara el share.
 */
function buildSwipeRow({ index, name, artist, art, badge, badgeColor = '#1DB954', extra, trackData }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-row-wrapper relative overflow-hidden rounded-xl';
    wrapper.style.cssText = 'touch-action: pan-y;';

    // Fondo verde que aparece al deslizar
    const bgReveal = document.createElement('div');
    bgReveal.className = 'swipe-bg-reveal';
    bgReveal.innerHTML = `
        <svg class="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15.001 10.62 18.661 12.9c.42.18.6.78.3 1.14zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.721 1.62.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
        <span class="text-[9px] font-black uppercase tracking-widest text-black">Compartir</span>
    `;
    wrapper.appendChild(bgReveal);

    // Contenido real de la fila
    const row = document.createElement('div');
    row.className = 'swipe-row flex items-center gap-3 p-3 bg-[#0a0a0a] border border-white/5 rounded-xl';

    row.innerHTML = `
        ${index ? `<span class="text-lg font-black text-neutral-800 w-5 shrink-0">${index}</span>` : ''}
        <img src="${art}" class="w-10 h-10 rounded-lg shadow-lg shrink-0 object-cover">
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
                <p class="text-xs font-bold text-white truncate">${name}</p>
                ${badge ? `<span class="shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded-md" style="background:${badgeColor}22;color:${badgeColor}">${badge}</span>` : ''}
            </div>
            <p class="text-[10px] text-neutral-500 truncate">${artist}</p>
        </div>
        ${extra ? `<p class="text-[9px] font-mono text-neutral-600 shrink-0">${extra}</p>` : ''}
        <div class="swipe-hint shrink-0 flex items-center gap-1 text-neutral-700 opacity-60">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
        </div>
    `;
    wrapper.appendChild(row);

    // ── Lógica de swipe ───────────────────────────────────────────────────────
    let startX = 0, currentX = 0, dragging = false;
    const THRESHOLD = 70; // px para activar

    const onStart = (x) => { startX = x; dragging = true; row.style.transition = 'none'; };
    const onMove  = (x) => {
        if (!dragging) return;
        currentX = Math.max(0, Math.min(x - startX, 110)); // solo a la derecha, máx 110px
        row.style.transform = `translateX(${currentX}px)`;
        const ratio = Math.min(currentX / THRESHOLD, 1);
        bgReveal.style.opacity = ratio;
        bgReveal.style.width   = `${currentX}px`;
    };
    const onEnd = () => {
        if (!dragging) return;
        dragging = false;
        row.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
        if (currentX >= THRESHOLD) {
            // Animación de confirmación
            row.style.transform = 'translateX(110px)';
            setTimeout(() => {
                row.style.transition = 'transform 0.35s ease';
                row.style.transform  = 'translateX(0)';
                bgReveal.style.opacity = '0';
                bgReveal.style.width   = '0';
                sendShare(trackData);
            }, 320);
        } else {
            row.style.transform    = 'translateX(0)';
            bgReveal.style.opacity = '0';
            bgReveal.style.width   = '0';
        }
        currentX = 0;
    };

    // Touch events
    row.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
    row.addEventListener('touchmove',  e => onMove(e.touches[0].clientX),  { passive: true });
    row.addEventListener('touchend',   onEnd);

    // Mouse events (para desktop)
    row.addEventListener('mousedown', e => { onStart(e.clientX); });
    document.addEventListener('mousemove', e => { if (dragging) onMove(e.clientX); });
    document.addEventListener('mouseup',   () => { if (dragging) onEnd(); });

    return wrapper;
}

// ── Share helpers ─────────────────────────────────────────────────────────────

function buildTrackPayload(track) {
    return {
        track_id:      track.id,
        track_name:    track.name,
        artist_name:   track.artists?.map(a => a.name).join(', ') || '',
        album_art_url: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
        spotify_url:   track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`
    };
}

async function sendShare(trackData) {
    if (!currentSession || !friendId) {
        showShareToast('No hay amigo activo para compartir', 'error');
        return;
    }

    const { error } = await supabaseClient.from('song_shares').insert({
        sender_id:     currentSession.user.id,
        receiver_id:   friendId,
        track_id:      trackData.track_id,
        track_name:    trackData.track_name,
        artist_name:   trackData.artist_name,
        album_art_url: trackData.album_art_url,
        spotify_url:   trackData.spotify_url,
        seen:          false
    });

    if (error) {
        console.error('sendShare error:', error);
        showShareToast('No se pudo enviar', 'error');
    } else {
        showShareToast(`🎵 "${trackData.track_name}" compartida`);
    }
}

function showShareToast(message, type = 'success') {
    // Reutiliza el contenedor de toast si existe, si no crea uno temporal
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column-reverse;gap:8px;z-index:9999;pointer-events:none;align-items:center;';
        document.body.appendChild(container);
    }
    const color  = type === 'success' ? '#1DB954' : '#ef4444';
    const toast  = document.createElement('div');
    toast.style.cssText = `background:rgba(10,10,10,0.95);backdrop-filter:blur(24px);border:1px solid ${color}55;border-radius:100px;padding:10px 20px;font-size:0.72rem;font-weight:800;color:white;display:flex;align-items:center;gap:8px;font-family:Inter,sans-serif;white-space:nowrap;animation:toastIn 0.35s cubic-bezier(0.16,1,0.3,1) both;box-shadow:0 0 20px ${color}22;`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'scale(0.9)'; toast.style.transition = 'all 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}
