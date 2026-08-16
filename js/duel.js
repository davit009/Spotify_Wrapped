import { supabaseClient, getSessionResilient } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const challengeId = urlParams.get('id');

    if (!challengeId) {
        window.location.href = 'dashboard.html';
        return;
    }

    const session = await getSessionResilient();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    const currentUserId = session.user.id;
    await initDuel(challengeId, currentUserId);
});

async function initDuel(challengeId, userId) {
    // 1. Obtener datos del desafío
    const { data: challenge, error } = await supabaseClient
        .from('challenges')
        .select(`
            *,
            creator:creator_id (id, display_name, avatar_url),
            opponent:opponent_id (id, display_name, avatar_url)
        `)
        .eq('id', challengeId)
        .single();

    if (error || !challenge) {
        console.error("Error cargando desafío:", error);
        return;
    }

    const isCreator = challenge.creator_id === userId;
    const u1 = isCreator ? challenge.creator : challenge.opponent;
    const u2 = isCreator ? challenge.opponent : challenge.creator;

    // Renderizar info básica
    document.getElementById('u1-name').textContent = u1.display_name;
    document.getElementById('u1-avatar').src = u1.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp';
    
    document.getElementById('u2-name').textContent = u2.display_name;
    document.getElementById('u2-avatar').src = u2.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp';

    // Tiempo restante
    const end = new Date(challenge.end_date);
    const now = new Date();
    const diff = end - now;
    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    document.getElementById('days-left').textContent = days;
    document.getElementById('date-range').textContent = `Del ${new Date(challenge.start_date).toLocaleDateString()} al ${end.toLocaleDateString()}`;

    // 2. Cargar Estadísticas de ambos
    await Promise.all([
        updateUserStats(u1.id, challenge.start_date, 'u1'),
        updateUserStats(u2.id, challenge.start_date, 'u2')
    ]);

    // 3. Ajustar barra de progreso comparativa
    updateComparisonBar();
}

async function updateUserStats(userId, startDate, prefix) {
    // Obtener todas las sesiones desde que inició el reto
    const { data: sessions, error } = await supabaseClient
        .from('listening_sessions')
        .select('duration_ms, track_id')
        .eq('user_id', userId)
        .gte('played_at', startDate)
        .limit(10000);

    if (error) return;

    let totalMs = 0;
    const trackCounts = {};
    
    sessions.forEach(s => {
        totalMs += s.duration_ms;
        trackCounts[s.track_id] = (trackCounts[s.track_id] || 0) + 1;
    });

    // Formatear tiempo
    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    const mins = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
    
    document.getElementById(`${prefix}-time`).innerHTML = `${hours}<span class="text-sm font-normal text-neutral-500">h</span> ${mins}<span class="text-sm font-normal text-neutral-500">m</span>`;
    document.getElementById(`${prefix}-time`).dataset.ms = totalMs;

    // Intentar sacar el top track (Metadata simplificada desde caché local si existe)
    const topTrackId = Object.entries(trackCounts).sort((a,b) => b[1] - a[1])[0]?.[0];
    if (topTrackId) {
        const cached = localStorage.getItem('spotify_track_' + topTrackId);
        if (cached) {
            const track = JSON.parse(cached);
            document.getElementById(`${prefix}-top-track`).textContent = track.name;
            document.getElementById(`${prefix}-top-artist`).textContent = track.artists[0].name;
        } else {
            document.getElementById(`${prefix}-top-track`).textContent = "Escuchando...";
            document.getElementById(`${prefix}-top-artist`).textContent = "Buscando...";
        }
    }
}

function updateComparisonBar() {
    const ms1 = parseInt(document.getElementById('u1-time').dataset.ms || 0);
    const ms2 = parseInt(document.getElementById('u2-time').dataset.ms || 0);
    const total = ms1 + ms2;

    const bar = document.getElementById('u1-progress');
    if (total === 0) {
        bar.style.width = '50%';
    } else {
        const pct = (ms1 / total) * 100;
        bar.style.width = `${pct}%`;
    }
}
