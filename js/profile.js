import { supabaseClient } from './supabase.js';
import { getValidToken } from './token_manager.js';

// ============================================================
// CACHÉ DE IMÁGENES (localStorage, TTL 24h)
// ============================================================
const IMG_CACHE_PREFIX = 'spotistats_img_';
const IMG_CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedImage(key) {
    try {
        const raw = localStorage.getItem(IMG_CACHE_PREFIX + key);
        if (!raw) return null;
        const { url, ts } = JSON.parse(raw);
        if (Date.now() - ts > IMG_CACHE_TTL) { localStorage.removeItem(IMG_CACHE_PREFIX + key); return null; }
        return url;
    } catch { return null; }
}
function setCachedImage(key, url) {
    try { localStorage.setItem(IMG_CACHE_PREFIX + key, JSON.stringify({ url, ts: Date.now() })); } catch {}
}

// ============================================================
// ANIMACIÓN COUNT-UP
// ============================================================
function animateCounter(el, target, suffix = '') {
    if (!el || !target) { if (el) el.textContent = (target || 0).toLocaleString() + suffix; return; }
    const dur = 1200, t0 = performance.now();
    const tick = t => {
        const p = Math.min((t - t0) / dur, 1);
        el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

// ============================================================
// PLACEHOLDERS SVG (sin dependencias externas)
// ============================================================
const TRACK_PLACEHOLDER  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%23282828'/%3E%3Ctext x='75' y='95' font-size='64' text-anchor='middle' fill='%231DB954'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E";
const ARTIST_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%23282828'/%3E%3Ctext x='75' y='95' font-size='64' text-anchor='middle' fill='%231DB954'%3E%F0%9F%8E%99%EF%B8%8F%3C/text%3E%3C/svg%3E";

// Estado del reproductor
let currentAudio = null;
let currentPlayingBtn = null;

// Stats globales (para el filtro de año)
let globalStats = null;
let globalToken = null;
let globalUserId = null;

// Sesiones crudas (una fila por reproducción), para el detalle día a día
// y la lista completa de canciones cuando se elige un mes puntual.
let rawSessions = [];
let monthTrackListFull = []; // lista completa del mes activo, sin filtrar por búsqueda
let monthDetailRequestToken = null; // evita pisar la vista si el usuario cambia de mes a media resolución

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    // FASE 1: Controles críticos — disponibles SIEMPRE
    const settingsModal = document.getElementById('settings-modal');
    const settingsModalContent = document.getElementById('settings-modal-content');

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    // Toggle dropdown
    const menu = document.getElementById('profile-dropdown');
    const toggleMenu = (e) => { 
        e.stopPropagation(); 
        menu.classList.toggle('active'); 
    };
    document.getElementById('profile-btn')?.addEventListener('click', toggleMenu);
    document.getElementById('profile-btn-mobile')?.addEventListener('click', toggleMenu);
    document.addEventListener('click', () => menu.classList.remove('active'));

    document.getElementById('settings-btn')?.addEventListener('click', () => {
        menu.classList.remove('active'); // Cerrar dropdown al abrir ajustes
        settingsModal.classList.remove('hidden');
        setTimeout(() => {
            settingsModalContent.classList.remove('scale-95', 'opacity-0');
            settingsModalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
    });

    document.getElementById('close-settings-btn')?.addEventListener('click', closeSettingsModal);
    settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) closeSettingsModal(); });

    function closeSettingsModal() {
        settingsModalContent.classList.remove('scale-100', 'opacity-100');
        settingsModalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => settingsModal.classList.add('hidden'), 150);
    }

    // FASE 2: Lógica dependiente de sesión
    let redirectTimeout;
    let dataInitialized = false;

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            if (redirectTimeout) clearTimeout(redirectTimeout);
            if (dataInitialized) return;
            dataInitialized = true;

            // Poblar UI de usuario
            const user = session.user;
            const nameEl = document.getElementById('user-name');
            const avatarEl = document.getElementById('user-avatar');
            const avatarMobileEl = document.getElementById('user-avatar-mobile');
            if (nameEl) nameEl.textContent = user.user_metadata.display_name || user.email.split('@')[0];
            const avatarUrl = user.user_metadata.avatar_url || '';
            if (avatarEl) avatarEl.src = avatarUrl;
            if (avatarMobileEl) avatarMobileEl.src = avatarUrl;

            // Fondo dinámico
            updateBackground(user.id);
            setInterval(() => updateBackground(user.id), 10000);

            // Toggle fusionar historial
            document.getElementById('toggle-history')?.addEventListener('change', async (e) => {
                await supabaseClient.from('users').update({
                    preferences: { merge_history: e.target.checked }
                }).eq('id', session.user.id);
                checkSavedStats(session);
            });

            // Botón borrar historial
            document.getElementById('delete-history-btn')?.addEventListener('click', async () => {
                if (!confirm('¿Seguro que quieres borrar tu historial importado? Esta acción no se puede deshacer.')) return;
                await supabaseClient.from('users')
                    .update({ historical_stats: null })
                    .eq('id', session.user.id);
                closeSettingsModal();
                checkSavedStats(session); // Recargar desde base de datos en tiempo real
            });

            // Buscador de la lista completa de canciones del mes seleccionado
            document.getElementById('month-track-search')?.addEventListener('input', (e) => {
                renderMonthTrackList(filterTrackList(e.target.value));
            });

            // Dropzone
            const dropzone = document.getElementById('dropzone');
            const fileInput = document.getElementById('file-upload');
            dropzone?.addEventListener('click', e => { if (e.target.id !== 'file-upload') fileInput.click(); });
            dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('border-[#1DB954]', 'bg-[#1DB954]/5'); });
            dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('border-[#1DB954]', 'bg-[#1DB954]/5'));
            dropzone?.addEventListener('drop', e => {
                e.preventDefault();
                dropzone.classList.remove('border-[#1DB954]', 'bg-[#1DB954]/5');
                if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files, session);
            });
            fileInput?.addEventListener('change', e => {
                if (e.target.files.length > 0) processFiles(e.target.files, session);
            });

            checkSavedStats(session);

        } else {
            if (!dataInitialized) {
                redirectTimeout = setTimeout(() => { window.location.href = 'index.html'; }, 2000);
            }
        }
    });
});

// ============================================================
// FUSIONAR REPRODUCCIONES EN TIEMPO REAL A LOS TOPS
// ============================================================
async function mergePeriodTops(periodStats, periodTrackDurations, spotifyToken, realtimeTracksMetadata = {}) {
    if (!periodStats || !periodTrackDurations || Object.keys(periodTrackDurations).length === 0) return;

    const topIds = Object.keys(periodTrackDurations)
        .sort((a, b) => periodTrackDurations[b] - periodTrackDurations[a])
        .slice(0, 10);

    const freshTracks = (await Promise.all(
        topIds.map(async id => {
            if (realtimeTracksMetadata[id]) {
                const meta = realtimeTracksMetadata[id];
                return {
                    id: id,
                    name: meta.name,
                    artists: [{ name: meta.artistName }],
                    album: { images: [{ url: meta.albumArtUrl }] },
                    external_urls: { spotify: `https://open.spotify.com/track/${id}` }
                };
            }
            let track = JSON.parse(localStorage.getItem('spotify_track_' + id));
            if (!track && spotifyToken) {
                try {
                    const r = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                        headers: { Authorization: `Bearer ${spotifyToken}` }
                    });
                    if (r.ok) {
                        track = await r.json();
                        localStorage.setItem('spotify_track_' + id, JSON.stringify(track));
                    }
                } catch {}
            }
            return track;
        })
    )).filter(Boolean);

    if (!periodStats.topTracks) periodStats.topTracks = [];
    if (!periodStats.topArtists) periodStats.topArtists = [];

    freshTracks.forEach(t => {
        const dur = periodTrackDurations[t.id];
        const exTrack = periodStats.topTracks.find(x => x.trackName === t.name && x.artistName === t.artists[0].name);
        if (exTrack) {
            exTrack.ms += dur;
        } else {
            periodStats.topTracks.push({
                trackName: t.name,
                artistName: t.artists[0].name,
                ms: dur
            });
        }

        t.artists.forEach(a => {
            const exArtist = periodStats.topArtists.find(x => x.name === a.name);
            if (exArtist) {
                exArtist.ms += dur;
            } else {
                periodStats.topArtists.push({
                    name: a.name,
                    ms: dur
                });
            }
        });
    });

    periodStats.topTracks = periodStats.topTracks.sort((a, b) => b.ms - a.ms).slice(0, 10);
    periodStats.topArtists = periodStats.topArtists.sort((a, b) => b.ms - a.ms).slice(0, 10);
}

// ============================================================
// TRAER TODO EL HISTORIAL (paginado, sin depender del tope por defecto de Supabase)
// ============================================================
const SESSIONS_PAGE_SIZE = 1000;

async function fetchAllListeningSessions(userId) {
    let rows = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabaseClient
            .from('listening_sessions')
            .select('track_id, duration_ms, played_at, track_name, artist_name, album_art_url')
            .eq('user_id', userId)
            .order('played_at', { ascending: true })
            .range(from, from + SESSIONS_PAGE_SIZE - 1);

        if (error) {
            console.error('Error leyendo listening_sessions:', error);
            break;
        }
        if (!data || data.length === 0) break;

        rows = rows.concat(data);
        if (data.length < SESSIONS_PAGE_SIZE) break; // última página
        from += SESSIONS_PAGE_SIZE;
    }
    return rows;
}

// ============================================================
// LEER ESTADÍSTICAS GUARDADAS
// ============================================================
async function checkSavedStats(session) {
    const { data } = await supabaseClient
        .from('users')
        .select('historical_stats, preferences')
        .eq('id', session.user.id)
        .single();

    const spotifyToken = (await getValidToken(session.user.id)) || session.provider_token;
    globalToken = spotifyToken;
    globalUserId = session.user.id;

    const toggleEl = document.getElementById('toggle-history');
    const prefs = data?.preferences || { merge_history: false };
    if (toggleEl) toggleEl.checked = prefs.merge_history;

    // Inicializar objeto stats (con template vacío si es necesario)
    let stats = data?.historical_stats
        ? JSON.parse(JSON.stringify(data.historical_stats))
        : {
            hours: 0,
            totalMsPlayed: 0,
            totalDays: 0,
            totalUniqueArtists: 0,
            totalUniqueTracks: 0,
            topArtists: [],
            topTracks: [],
            yearlyStats: {},
            availableYears: []
        };

    // Consultar TODAS las sesiones de tiempo real (paginado — sin esto,
    // Supabase corta el resultado en su tope por defecto y los meses más
    // viejos o más nuevos que no entraran en esa primera página
    // simplemente desaparecían de las estadísticas).
    const realtimeSessions = await fetchAllListeningSessions(session.user.id);
    rawSessions = realtimeSessions;

    if (realtimeSessions.length > 0) {
        const realtimeDaysGlobal = new Set();
        const realtimeDaysByYear = {}; // { "2026": Set }
        const realtimeDaysByMonth = {}; // { "2026-05": Set }

        const realtimeMsByYear = {};
        const realtimeMsByMonth = {};
        let realtimeMsGlobal = 0;

        const realtimeTracksGlobal = {};
        const realtimeTracksByYear = {};
        const realtimeTracksByMonth = {};

        // Mapeo local de metadatos para evitar llamadas a Spotify
        const realtimeTracksMetadata = {};

        // Inicializar arreglos de distribución global si no existen
        if (!stats.hourlyMs) stats.hourlyMs = Array(24).fill(0);
        if (!stats.weekdayMs) stats.weekdayMs = Array(7).fill(0);

        realtimeSessions.forEach(s => {
            const date = new Date(s.played_at);
            const yr = date.getFullYear().toString();
            const mo = (date.getMonth() + 1).toString().padStart(2, '0');
            const moKey = `${yr}-${mo}`;
            const dayKey = s.played_at.substring(0, 10);
            const hour = date.getHours();
            const day = date.getDay();

            // Mapear metadatos locales
            if (s.track_name && s.artist_name && !realtimeTracksMetadata[s.track_id]) {
                realtimeTracksMetadata[s.track_id] = {
                    name: s.track_name,
                    artistName: s.artist_name,
                    albumArtUrl: s.album_art_url
                };
            }

            // Global
            realtimeMsGlobal += s.duration_ms;
            realtimeDaysGlobal.add(dayKey);
            realtimeTracksGlobal[s.track_id] = (realtimeTracksGlobal[s.track_id] || 0) + s.duration_ms;
            stats.hourlyMs[hour] = (stats.hourlyMs[hour] || 0) + s.duration_ms;
            stats.weekdayMs[day] = (stats.weekdayMs[day] || 0) + s.duration_ms;

            // Year
            realtimeMsByYear[yr] = (realtimeMsByYear[yr] || 0) + s.duration_ms;
            if (!realtimeDaysByYear[yr]) realtimeDaysByYear[yr] = new Set();
            realtimeDaysByYear[yr].add(dayKey);
            if (!realtimeTracksByYear[yr]) realtimeTracksByYear[yr] = {};
            realtimeTracksByYear[yr][s.track_id] = (realtimeTracksByYear[yr][s.track_id] || 0) + s.duration_ms;

            if (!stats.yearlyStats) stats.yearlyStats = {};
            if (!stats.yearlyStats[yr]) {
                stats.yearlyStats[yr] = { 
                    hours: 0, totalMsPlayed: 0, totalDays: 0, totalUniqueArtists: 0, totalUniqueTracks: 0, 
                    topArtists: [], topTracks: [], months: {},
                    hourlyMs: Array(24).fill(0), weekdayMs: Array(7).fill(0)
                };
            }
            if (!stats.yearlyStats[yr].hourlyMs) stats.yearlyStats[yr].hourlyMs = Array(24).fill(0);
            if (!stats.yearlyStats[yr].weekdayMs) stats.yearlyStats[yr].weekdayMs = Array(7).fill(0);
            stats.yearlyStats[yr].hourlyMs[hour] = (stats.yearlyStats[yr].hourlyMs[hour] || 0) + s.duration_ms;
            stats.yearlyStats[yr].weekdayMs[day] = (stats.yearlyStats[yr].weekdayMs[day] || 0) + s.duration_ms;

            // Month
            realtimeMsByMonth[moKey] = (realtimeMsByMonth[moKey] || 0) + s.duration_ms;
            if (!realtimeDaysByMonth[moKey]) realtimeDaysByMonth[moKey] = new Set();
            realtimeDaysByMonth[moKey].add(dayKey);
            if (!realtimeTracksByMonth[moKey]) realtimeTracksByMonth[moKey] = {};
            realtimeTracksByMonth[moKey][s.track_id] = (realtimeTracksByMonth[moKey][s.track_id] || 0) + s.duration_ms;

            if (!stats.yearlyStats[yr].months) stats.yearlyStats[yr].months = {};
            if (!stats.yearlyStats[yr].months[mo]) {
                stats.yearlyStats[yr].months[mo] = { 
                    hours: 0, totalMsPlayed: 0, totalDays: 0, totalUniqueArtists: 0, totalUniqueTracks: 0, 
                    topArtists: [], topTracks: [],
                    hourlyMs: Array(24).fill(0), weekdayMs: Array(7).fill(0)
                };
            }
            const moStat = stats.yearlyStats[yr].months[mo];
            if (!moStat.hourlyMs) moStat.hourlyMs = Array(24).fill(0);
            if (!moStat.weekdayMs) moStat.weekdayMs = Array(7).fill(0);
            moStat.hourlyMs[hour] = (moStat.hourlyMs[hour] || 0) + s.duration_ms;
            moStat.weekdayMs[day] = (moStat.weekdayMs[day] || 0) + s.duration_ms;
        });

        // Merge Global
        stats.totalMsPlayed = (stats.totalMsPlayed || stats.hours * 3600000) + realtimeMsGlobal;
        stats.hours = Math.floor(stats.totalMsPlayed / 3600000);
        stats.totalDays = (stats.totalDays || 0) + realtimeDaysGlobal.size;

        if (prefs.merge_history && spotifyToken) {
            await mergePeriodTops(stats, realtimeTracksGlobal, spotifyToken, realtimeTracksMetadata);
        }

        // Merge Years
        for (const [yr, ms] of Object.entries(realtimeMsByYear)) {
            const yrStat = stats.yearlyStats[yr];
            yrStat.totalMsPlayed += ms;
            yrStat.hours = Math.floor(yrStat.totalMsPlayed / 3600000);
            yrStat.totalDays = (yrStat.totalDays || 0) + realtimeDaysByYear[yr].size;

            if (prefs.merge_history && spotifyToken) {
                await mergePeriodTops(yrStat, realtimeTracksByYear[yr], spotifyToken, realtimeTracksMetadata);
            }
        }

        // Merge Months
        for (const [moKey, ms] of Object.entries(realtimeMsByMonth)) {
            const [yr, mo] = moKey.split('-');
            const moStat = stats.yearlyStats[yr].months[mo];
            moStat.totalMsPlayed += ms;
            moStat.hours = Math.floor(moStat.totalMsPlayed / 3600000);
            moStat.totalDays = (moStat.totalDays || 0) + realtimeDaysByMonth[moKey].size;

            if (prefs.merge_history && spotifyToken) {
                await mergePeriodTops(moStat, realtimeTracksByMonth[moKey], spotifyToken, realtimeTracksMetadata);
            }
        }

        // Refresh availableYears
        stats.availableYears = Object.keys(stats.yearlyStats || {}).sort().reverse();
    }

    globalStats = stats;
    renderYearTabs(stats, spotifyToken);
    renderStats(stats, spotifyToken);
}

// ============================================================
// PROCESAR ARCHIVOS JSON SUBIDOS
// ============================================================
async function processFiles(files, _closureSession) {
    // Siempre leer la sesión más fresca — no depender del closure que puede estar desactualizado
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user?.id) {
        console.error('No hay sesión activa. No se puede guardar el historial.');
        return;
    }
    let allData = [];
    const dropzoneTitle = document.querySelector('#dropzone h3');
    const progressBar  = document.getElementById('upload-progress');
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');

    progressBar?.classList.remove('hidden');
    setProgress(progressFill, progressText, 0, 'Leyendo archivos...');

    for (let i = 0; i < files.length; i++) {
        if (dropzoneTitle) dropzoneTitle.textContent = `Leyendo archivo ${i+1} de ${files.length}...`;
        setProgress(progressFill, progressText, Math.round((i / files.length) * 40), `Archivo ${i+1}/${files.length}...`);
        if (files[i].name.endsWith('.json')) {
            try {
                const json = JSON.parse(await files[i].text());
                if (Array.isArray(json)) allData = allData.concat(json);
            } catch (e) { console.error('Error leyendo', files[i].name); }
        }
    }

    if (allData.length === 0) {
        if (dropzoneTitle) dropzoneTitle.textContent = 'No se encontraron datos válidos. Intenta con otro archivo.';
        progressBar?.classList.add('hidden');
        return;
    }

    // Detección de formato
    const sample = allData[0];
    const isNewFormat = sample?.ts !== undefined;
    const isOldFormat = sample?.endTime !== undefined;
    if (!isNewFormat && !isOldFormat) {
        if (dropzoneTitle) dropzoneTitle.textContent = 'Formato no reconocido. Usa StreamingHistory.json o endsong.json';
        progressBar?.classList.add('hidden');
        return;
    }

    setProgress(progressFill, progressText, 50, 'Calculando estadísticas...');
    if (dropzoneTitle) dropzoneTitle.textContent = 'Analizando tus datos...';

    let totalMs = 0;
    const artistsCount = {}, tracksCount = {};
    const yearlyData = {};
    const activeDays = new Set();
    const hourlyMs = Array(24).fill(0);
    const weekdayMs = Array(7).fill(0);

    allData.forEach(item => {
        const ms     = item.ms_played || item.msPlayed || 0;
        const artist = item.master_metadata_album_artist_name || item.artistName;
        const track  = item.master_metadata_track_name || item.trackName;
        const uri    = item.spotify_track_uri || null;

        let year = null, month = null, dayKey = null, dateObj = null;
        if (item.ts) {
            year = item.ts.substring(0, 4);
            month = item.ts.substring(5, 7);
            dayKey = item.ts.substring(0, 10);
            dateObj = new Date(item.ts);
        } else if (item.endTime) {
            year = item.endTime.substring(0, 4);
            month = item.endTime.substring(5, 7);
            dayKey = item.endTime.substring(0, 10);
            dateObj = new Date(item.endTime.replace(' ', 'T'));
        }
        if (dayKey) activeDays.add(dayKey);

        if (ms < 30000 || !artist || !track) return;

        totalMs += ms;
        artistsCount[artist] = (artistsCount[artist] || 0) + ms;

        const key = `${track}|||${artist}`;
        if (!tracksCount[key]) tracksCount[key] = { ms: 0, uri, trackName: track, artistName: artist };
        tracksCount[key].ms += ms;

        if (dateObj && !isNaN(dateObj.getTime())) {
            const h = dateObj.getHours();
            const d = dateObj.getDay();
            hourlyMs[h] = (hourlyMs[h] || 0) + ms;
            weekdayMs[d] = (weekdayMs[d] || 0) + ms;
        }

        if (year) {
            if (!yearlyData[year]) {
                yearlyData[year] = { 
                    totalMs: 0, 
                    artistsCount: {}, 
                    tracksCount: {}, 
                    activeDays: new Set(),
                    months: {},
                    hourlyMs: Array(24).fill(0),
                    weekdayMs: Array(7).fill(0)
                };
            }
            yearlyData[year].totalMs += ms;
            yearlyData[year].artistsCount[artist] = (yearlyData[year].artistsCount[artist] || 0) + ms;
            if (!yearlyData[year].tracksCount[key]) yearlyData[year].tracksCount[key] = { ms: 0, uri, trackName: track, artistName: artist };
            yearlyData[year].tracksCount[key].ms += ms;
            if (dayKey) yearlyData[year].activeDays.add(dayKey);
            
            if (dateObj && !isNaN(dateObj.getTime())) {
                const h = dateObj.getHours();
                const d = dateObj.getDay();
                yearlyData[year].hourlyMs[h] = (yearlyData[year].hourlyMs[h] || 0) + ms;
                yearlyData[year].weekdayMs[d] = (yearlyData[year].weekdayMs[d] || 0) + ms;
            }

            if (month) {
                if (!yearlyData[year].months[month]) {
                    yearlyData[year].months[month] = { 
                        totalMs: 0, 
                        artistsCount: {}, 
                        tracksCount: {}, 
                        activeDays: new Set(),
                        hourlyMs: Array(24).fill(0),
                        weekdayMs: Array(7).fill(0)
                    };
                }
                const mData = yearlyData[year].months[month];
                mData.totalMs += ms;
                mData.artistsCount[artist] = (mData.artistsCount[artist] || 0) + ms;
                if (!mData.tracksCount[key]) mData.tracksCount[key] = { ms: 0, uri, trackName: track, artistName: artist };
                mData.tracksCount[key].ms += ms;
                if (dayKey) mData.activeDays.add(dayKey);

                if (dateObj && !isNaN(dateObj.getTime())) {
                    const h = dateObj.getHours();
                    const d = dateObj.getDay();
                    mData.hourlyMs[h] = (mData.hourlyMs[h] || 0) + ms;
                    mData.weekdayMs[d] = (mData.weekdayMs[d] || 0) + ms;
                }
            }
        }
    });

    setProgress(progressFill, progressText, 80, 'Construyendo estadísticas por año y mes...');

    const yearlyStats = {};
    Object.entries(yearlyData).forEach(([yr, yd]) => {
        const months = {};
        Object.entries(yd.months).forEach(([mo, md]) => {
            months[mo] = {
                hours: Math.floor(md.totalMs / 3600000),
                totalMsPlayed: md.totalMs,
                totalDays: md.activeDays.size,
                totalUniqueArtists: Object.keys(md.artistsCount).length,
                totalUniqueTracks:  Object.keys(md.tracksCount).length,
                topArtists: Object.entries(md.artistsCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(x=>({ name:x[0], ms:x[1] })),
                topTracks:  Object.values(md.tracksCount).sort((a,b)=>b.ms-a.ms).slice(0,10),
                hourlyMs: md.hourlyMs,
                weekdayMs: md.weekdayMs
            };
        });

        yearlyStats[yr] = {
            hours: Math.floor(yd.totalMs / 3600000),
            totalMsPlayed: yd.totalMs,
            totalDays: yd.activeDays.size,
            totalUniqueArtists: Object.keys(yd.artistsCount).length,
            totalUniqueTracks:  Object.keys(yd.tracksCount).length,
            topArtists: Object.entries(yd.artistsCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(x=>({ name:x[0], ms:x[1] })),
            topTracks:  Object.values(yd.tracksCount).sort((a,b)=>b.ms-a.ms).slice(0,10),
            months,
            hourlyMs: yd.hourlyMs,
            weekdayMs: yd.weekdayMs
        };
    });

    const statsObj = {
        hours: Math.floor(totalMs / 3600000),
        totalMsPlayed: totalMs,
        totalDays: activeDays.size,
        totalUniqueArtists: Object.keys(artistsCount).length,
        totalUniqueTracks:  Object.keys(tracksCount).length,
        topArtists: Object.entries(artistsCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(x=>({ name:x[0], ms:x[1] })),
        topTracks:  Object.values(tracksCount).sort((a,b)=>b.ms-a.ms).slice(0,10),
        yearlyStats,
        availableYears: Object.keys(yearlyStats).sort().reverse(),
        hourlyMs,
        weekdayMs
    };

    setProgress(progressFill, progressText, 90, 'Guardando en la nube...');

    // Limpiar URIs para reducir tamaño
    const statsToSave = JSON.parse(JSON.stringify(statsObj));
    statsToSave.topTracks.forEach(t => delete t.uri);
    Object.values(statsToSave.yearlyStats || {}).forEach(ys => ys.topTracks?.forEach(t => delete t.uri));

    const payloadSize = JSON.stringify(statsToSave).length;
    console.log(`📦 Payload: ${(payloadSize / 1024).toFixed(1)} KB | User: ${session.user.id}`);

    const { error: saveError } = await supabaseClient
        .from('users')
        .update({ 
            historical_stats: statsToSave,
            preferences: { merge_history: true }
        })
        .eq('id', session.user.id);

    if (saveError) {
        console.error('❌ Error al guardar en Supabase:', JSON.stringify(saveError));
        setProgress(progressFill, progressText, 100, '⚠️ Error al guardar — revisa la consola');
    } else {
        console.log('✅ Historial guardado correctamente en Supabase.');
        setProgress(progressFill, progressText, 100, '¡Guardado correctamente!');
    }

    setTimeout(() => progressBar?.classList.add('hidden'), 1200);



    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('header-desc').classList.add('hidden');

    const token = (await getValidToken(session.user.id)) || session.provider_token;
    globalStats = statsObj;
    globalToken = token;
    renderYearTabs(statsObj, token);
    renderStats(statsObj, token);
}

function setProgress(fill, text, pct, label) {
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = label;
}
   // ============================================================
// TABS DE AÑO Y MES
// ============================================================
let activeYear = 'all';
let activeMonth = 'all';

const MONTH_SHORT_NAMES = {
    'all': 'Todos los meses',
    '01': 'Ene',
    '02': 'Feb',
    '03': 'Mar',
    '04': 'Abr',
    '05': 'May',
    '06': 'Jun',
    '07': 'Jul',
    '08': 'Ago',
    '09': 'Sep',
    '10': 'Oct',
    '11': 'Nov',
    '12': 'Dic'
};

const MONTH_NAMES_FULL = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio',
    '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
};

function renderYearTabs(stats, token) {
    const container = document.getElementById('year-filter');
    if (!container || !stats.availableYears?.length) return;
    container.classList.remove('hidden');
    container.innerHTML = '';

    const years = ['all', ...stats.availableYears];
    years.forEach(yr => {
        const btn = document.createElement('button');
        btn.className = 'year-tab' + (yr === activeYear ? ' active' : '');
        btn.textContent = yr === 'all' ? 'Todos los años' : yr;
        btn.addEventListener('click', () => {
            activeYear = yr;
            activeMonth = 'all'; // Reset active month on year change
            document.querySelectorAll('#year-filter .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const displayStats = yr === 'all' ? stats : stats.yearlyStats[yr];
            if (displayStats) {
                renderStats(displayStats, token, yr);
            }
            hideMonthDetail(); // "Todos los años" no es un mes puntual
            renderMonthTabs(stats, token, yr);
        });
        container.appendChild(btn);
    });

    // Initial render of month filter (will hide if year is 'all')
    renderMonthTabs(stats, token, activeYear);
}

function renderMonthTabs(stats, token, year) {
    const container = document.getElementById('month-filter');
    if (!container) return;

    if (year === 'all') {
        container.classList.add('hidden');
        return;
    }

    const yrStats = stats.yearlyStats?.[year];
    const availableMonths = new Set();

    if (yrStats?.months) {
        Object.keys(yrStats.months).forEach(m => availableMonths.add(m));
    }

    if (availableMonths.size === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = '';

    // Render "Todos los meses"
    const allBtn = document.createElement('button');
    allBtn.className = 'year-tab' + (activeMonth === 'all' ? ' active' : '');
    allBtn.textContent = 'Todos los meses';
    allBtn.addEventListener('click', () => {
        activeMonth = 'all';
        container.querySelectorAll('#month-filter .year-tab').forEach(b => b.classList.remove('active'));
        allBtn.classList.add('active');
        renderStats(yrStats, token, year);
        hideMonthDetail(); // "Todos los meses" tampoco es un mes puntual
    });
    container.appendChild(allBtn);

    // Render months chronologically
    const sortedMonths = Array.from(availableMonths).sort();
    sortedMonths.forEach(mo => {
        const btn = document.createElement('button');
        btn.className = 'year-tab' + (mo === activeMonth ? ' active' : '');
        btn.textContent = MONTH_SHORT_NAMES[mo] || mo;
        btn.addEventListener('click', () => {
            activeMonth = mo;
            container.querySelectorAll('#month-filter .year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const monthStats = yrStats.months?.[mo];
            if (monthStats) {
                renderStats(monthStats, token, year);
            }
            renderMonthDetail(year, mo);
        });
        container.appendChild(btn);
    });
}

// ============================================================
// DETALLE DEL MES: actividad diaria + lista completa de canciones
//
// Se calcula al vuelo desde rawSessions (las filas crudas de
// listening_sessions ya cargadas), no desde el resumen top-10 guardado
// en historical_stats — así que solo está disponible para meses
// trackeados en vivo por la app, no para meses que solo vienen de un
// Wrapped importado (esos no tienen fila por reproducción).
// ============================================================
function hideMonthDetail() {
    document.getElementById('month-detail')?.classList.add('hidden');
}

function getMonthDetail(year, month) {
    const rows = rawSessions.filter(s => {
        const d = new Date(s.played_at);
        return d.getFullYear().toString() === year && (d.getMonth() + 1).toString().padStart(2, '0') === month;
    });
    if (rows.length === 0) return null;

    const daysInMonth = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
    const dailyMs = Array(daysInMonth).fill(0);
    const tracks = {};

    rows.forEach(s => {
        const day = new Date(s.played_at).getDate();
        dailyMs[day - 1] += s.duration_ms;

        if (!tracks[s.track_id]) {
            tracks[s.track_id] = {
                id: s.track_id,
                name: s.track_name || null,
                artist: s.artist_name || null,
                art: s.album_art_url || '',
                ms: 0,
                count: 0
            };
        }
        tracks[s.track_id].ms += s.duration_ms;
        tracks[s.track_id].count += 1;
    });

    return { daysInMonth, dailyMs, trackList: Object.values(tracks).sort((a, b) => b.ms - a.ms) };
}

async function renderMonthDetail(year, month) {
    const section = document.getElementById('month-detail');
    if (!section) return;

    const detail = getMonthDetail(year, month);
    if (!detail) {
        // Mes cubierto solo por historial importado — sin filas crudas no hay
        // forma de reconstruir el detalle día a día ni la lista completa.
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    const title = document.getElementById('month-detail-title');
    if (title) title.textContent = `${MONTH_NAMES_FULL[month] || month} ${year}`;

    renderDailyChart(detail.dailyMs, year, month);

    monthTrackListFull = detail.trackList;
    const searchInput = document.getElementById('month-track-search');
    if (searchInput) searchInput.value = '';
    renderMonthTrackList(monthTrackListFull);

    // Canciones guardadas antes de que la app cacheara nombre/artista/portada
    // llegan sin ese detalle (track_name/artist_name nulos) — se completan
    // consultando a Spotify por su track_id y se guardan en la BD de una vez,
    // para no tener que volver a pedirlas la próxima vez.
    const thisRequestMonth = `${year}-${month}`;
    monthDetailRequestToken = thisRequestMonth;
    const missingIds = [...new Set(monthTrackListFull.filter(t => !t.name).map(t => t.id))];
    if (missingIds.length > 0) {
        await resolveMissingTrackMetadata(missingIds);
        // Si el usuario ya cambió de mes mientras resolvíamos, no pisamos su vista actual.
        if (monthDetailRequestToken !== thisRequestMonth) return;
        renderMonthTrackList(searchInput?.value ? filterTrackList(searchInput.value) : monthTrackListFull);
    }
}

function filterTrackList(query) {
    const q = query.trim().toLowerCase();
    if (!q) return monthTrackListFull;
    return monthTrackListFull.filter(t =>
        (t.name || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q)
    );
}

/**
 * Completa nombre/artista/portada para track_ids sin metadatos cacheados,
 * pidiéndolos a Spotify en lotes de 50 (máximo permitido por /v1/tracks), y
 * los guarda en listening_sessions para que no vuelvan a faltar.
 */
async function resolveMissingTrackMetadata(trackIds) {
    if (!globalToken) return;

    for (let i = 0; i < trackIds.length; i += 50) {
        const batch = trackIds.slice(i, i + 50);
        try {
            const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, {
                headers: { Authorization: `Bearer ${globalToken}` }
            });
            if (!res.ok) continue;
            const data = await res.json();

            for (const t of (data.tracks || [])) {
                if (!t) continue; // Spotify devuelve null si el id ya no existe en su catálogo
                const meta = {
                    name: t.name,
                    artist: t.artists?.map(a => a.name).join(', ') || '',
                    art: t.album?.images?.[t.album.images.length - 1]?.url || t.album?.images?.[0]?.url || ''
                };

                const entry = monthTrackListFull.find(x => x.id === t.id);
                if (entry) Object.assign(entry, meta);

                // Guardar en BD — puede haber varias filas con el mismo track_id
                // (la misma canción escuchada varias veces ese mes).
                supabaseClient.from('listening_sessions')
                    .update({ track_name: meta.name, artist_name: meta.artist, album_art_url: meta.art })
                    .eq('user_id', globalUserId)
                    .eq('track_id', t.id)
                    .then(({ error }) => { if (error) console.warn('No se pudo guardar metadatos de', t.id, error); });
            }

            // Ritmo suave para no pegarle a Spotify con demasiadas llamadas seguidas.
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            console.warn('Error resolviendo metadatos de tracks:', e);
        }
    }

    // Lo que Spotify no pudo resolver (id ya no existe) se marca aparte,
    // en vez de quedarse en "cargando" para siempre.
    monthTrackListFull.forEach(t => { if (!t.name) t.name = '__unavailable__'; });
}

function renderDailyChart(dailyMs, year, month) {
    const chart = document.getElementById('daily-chart');
    const caption = document.getElementById('daily-chart-caption');
    const defaultCaption = 'Pasa el cursor sobre un día para ver el detalle';
    if (!chart) return;

    const max = Math.max(...dailyMs, 1);
    chart.innerHTML = '';

    dailyMs.forEach((ms, idx) => {
        const day = idx + 1;
        const hasData = ms > 0;
        const pct = hasData ? Math.max(Math.round((ms / max) * 100), 4) : 2;

        const bar = document.createElement('div');
        bar.className = 'daily-bar' + (hasData ? '' : ' daily-bar-empty');
        bar.style.height = `${pct}%`;

        const hh = Math.floor(ms / 3600000);
        const mm = Math.floor((ms % 3600000) / 60000);
        const dateLabel = new Date(parseInt(year, 10), parseInt(month, 10) - 1, day)
            .toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
        const detailText = hasData ? `${dateLabel} — ${hh}h ${mm}m` : `${dateLabel} — sin reproducciones`;
        bar.title = detailText;

        bar.addEventListener('mouseenter', () => { if (caption) caption.textContent = detailText; });
        chart.appendChild(bar);
    });

    if (caption) {
        caption.textContent = defaultCaption;
        chart.onmouseleave = () => { caption.textContent = defaultCaption; };
    }
}

function renderMonthTrackList(list) {
    const ul = document.getElementById('month-track-list');
    const countEl = document.getElementById('month-track-count');
    if (!ul) return;

    if (countEl) countEl.textContent = `(${list.length})`;

    if (list.length === 0) {
        ul.innerHTML = '<li class="text-center text-neutral-600 text-xs py-8">Sin resultados.</li>';
        return;
    }

    ul.innerHTML = list.map((t, i) => {
        const m = Math.floor(t.ms / 60000);
        const art = t.art || TRACK_PLACEHOLDER;
        const isUnavailable = t.name === '__unavailable__';
        const displayName = isUnavailable ? 'Pista no disponible' : (t.name || 'Cargando…');
        const displayArtist = isUnavailable ? 'Ya no existe en Spotify' : (t.artist || '');
        return `
            <li class="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl transition-colors">
                <span class="text-neutral-600 font-bold w-6 text-center text-xs flex-shrink-0">${i + 1}</span>
                <img src="${art}" class="w-9 h-9 rounded object-cover shadow-md flex-shrink-0">
                <div class="flex-1 overflow-hidden min-w-0">
                    <span class="font-bold text-sm block truncate ${t.name ? 'text-white' : 'text-neutral-500 italic'}">${displayName}</span>
                    <span class="text-neutral-400 text-xs block truncate">${displayArtist}</span>
                </div>
                <span class="text-[10px] font-bold text-neutral-500 flex-shrink-0">${t.count}×</span>
                <span class="text-xs font-bold text-[#1DB954] flex-shrink-0 w-12 text-right">${m}m</span>
            </li>`;
    }).join('');
}

// ============================================================
// CALCULAR Y RENDERIZAR INSIGHTS AVANZADOS
// ============================================================
function renderAdvancedInsights(stats) {
    const hourlyMs = stats.hourlyMs || Array(24).fill(0);
    const weekdayMs = stats.weekdayMs || Array(7).fill(0);

    const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const MONTH_NAMES = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio',
        '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
    };

    // 1. Peak Hour
    let peakHour = 0;
    let maxHourMs = 0;
    let totalHourMs = 0;
    for (let h = 0; h < 24; h++) {
        const ms = hourlyMs[h] || 0;
        totalHourMs += ms;
        if (ms > maxHourMs) {
            maxHourMs = ms;
            peakHour = h;
        }
    }
    const hourEl = document.getElementById('insight-peak-hour');
    const hourSubEl = document.getElementById('insight-peak-hour-sub');
    if (hourEl && hourSubEl) {
        if (totalHourMs > 0) {
            const endHour = (peakHour + 1) % 24;
            const pct = Math.round((maxHourMs / totalHourMs) * 100);
            
            let momentIcon = '🌙';
            if (peakHour >= 6 && peakHour < 12) momentIcon = '🌅';
            else if (peakHour >= 12 && peakHour < 18) momentIcon = '☀️';
            else if (peakHour >= 18 && peakHour < 24) momentIcon = '🌙';
            else momentIcon = '🌌';
            
            hourEl.textContent = `${momentIcon} ${peakHour.toString().padStart(2, '0')}:00 - ${endHour.toString().padStart(2, '0')}:00`;
            hourSubEl.textContent = `${pct}% de tus reproducciones`;
        } else {
            hourEl.textContent = 'Sin datos';
            hourSubEl.textContent = 'Sigue escuchando';
        }
    }

    // 2. Favorite Day
    let peakDay = 0;
    let maxDayMs = 0;
    let totalDayMs = 0;
    for (let d = 0; d < 7; d++) {
        const ms = weekdayMs[d] || 0;
        totalDayMs += ms;
        if (ms > maxDayMs) {
            maxDayMs = ms;
            peakDay = d;
        }
    }
    const dayEl = document.getElementById('insight-peak-day');
    const daySubEl = document.getElementById('insight-peak-day-sub');
    if (dayEl && daySubEl) {
        if (totalDayMs > 0) {
            const pct = Math.round((maxDayMs / totalDayMs) * 100);
            dayEl.textContent = WEEKDAY_NAMES[peakDay];
            daySubEl.textContent = `${pct}% de tu música total`;
        } else {
            dayEl.textContent = 'Sin datos';
            daySubEl.textContent = 'Sigue escuchando';
        }
    }

    // 3. Peak Month
    let maxMonthName = 'Sin datos';
    let maxMonthMs = 0;
    
    if (stats.yearlyStats) {
        Object.entries(stats.yearlyStats).forEach(([year, yData]) => {
            if (yData.months) {
                Object.entries(yData.months).forEach(([month, mData]) => {
                    if (mData.totalMsPlayed > maxMonthMs) {
                        maxMonthMs = mData.totalMsPlayed;
                        maxMonthName = `${MONTH_NAMES[month] || month} ${year}`;
                    }
                });
            }
        });
    } else if (stats.months) {
        Object.entries(stats.months).forEach(([month, mData]) => {
            if (mData.totalMsPlayed > maxMonthMs) {
                maxMonthMs = mData.totalMsPlayed;
                maxMonthName = `${MONTH_NAMES[month] || month}`;
            }
        });
    } else {
        maxMonthMs = stats.totalMsPlayed || 0;
        maxMonthName = stats.totalMsPlayed > 0 ? 'Este mes' : 'Sin datos';
    }

    const monthEl = document.getElementById('insight-peak-month');
    const monthSubEl = document.getElementById('insight-peak-month-sub');
    if (monthEl && monthSubEl) {
        if (maxMonthMs > 0) {
            const hours = Math.round(maxMonthMs / 3600000);
            monthEl.textContent = maxMonthName;
            monthSubEl.textContent = `${hours}h de reproducción`;
        } else {
            monthEl.textContent = 'Sin datos';
            monthSubEl.textContent = 'Sigue escuchando';
        }
    }

    // 4. Moments of Day Breakdown
    let dawnMs = 0, morningMs = 0, afternoonMs = 0, nightMs = 0;
    for (let h = 0; h < 24; h++) {
        const ms = hourlyMs[h] || 0;
        if (h >= 0 && h < 6) dawnMs += ms;
        else if (h >= 6 && h < 12) morningMs += ms;
        else if (h >= 12 && h < 18) afternoonMs += ms;
        else nightMs += ms;
    }
    const totalMomentsMs = dawnMs + morningMs + afternoonMs + nightMs || 1;
    const dawnPct = Math.round((dawnMs / totalMomentsMs) * 100);
    const morningPct = Math.round((morningMs / totalMomentsMs) * 100);
    const afternoonPct = Math.round((afternoonMs / totalMomentsMs) * 100);
    const nightPct = Math.round((nightMs / totalMomentsMs) * 100);

    const updateBar = (id, pctId, pct) => {
        const bar = document.getElementById(id);
        const val = document.getElementById(pctId);
        if (bar && val) {
            val.textContent = `${pct}%`;
            setTimeout(() => {
                bar.style.width = `${pct}%`;
            }, 100);
        }
    };
    updateBar('bar-dawn', 'pct-dawn-val', dawnPct);
    updateBar('bar-morning', 'pct-morning-val', morningPct);
    updateBar('bar-afternoon', 'pct-afternoon-val', afternoonPct);
    updateBar('bar-night', 'pct-night-val', nightPct);
}

// ============================================================
// RENDERIZAR ESTADÍSTICAS
// ============================================================
async function renderStats(stats, spotifyToken, year = 'all') {
    document.getElementById('results').classList.remove('hidden');

    // Count-up animado
    animateCounter(document.getElementById('stat-hours'),   stats.hours,             'h');
    animateCounter(document.getElementById('stat-days'),    stats.totalDays || 0,    '');
    animateCounter(document.getElementById('stat-tracks'),  stats.totalUniqueTracks, '');
    animateCounter(document.getElementById('stat-artists'), stats.totalUniqueArtists,'');

    // Renderizar insights y distribución de momentos
    renderAdvancedInsights(stats);

    // Mostrar skeletons, ocultar listas
    showSkeletons();

    // Top Artistas
    const artistMax = stats.topArtists[0]?.ms || 1;
    const artistResults = [];
    for (let i = 0; i < stats.topArtists.length; i++) {
        const artist = stats.topArtists[i];
        const h   = Math.floor(artist.ms / 3600000);
        const pct = Math.round((artist.ms / artistMax) * 100);
        let imgUrl = getCachedImage('artist_' + artist.name) || ARTIST_PLACEHOLDER;
        const needsFetch = imgUrl === ARTIST_PLACEHOLDER;

        if (needsFetch && spotifyToken) {
            try {
                const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(artist.name)}&type=artist&limit=1`, { headers: { Authorization: `Bearer ${spotifyToken}` } });
                if (r.ok) {
                    const d = await r.json();
                    if (d.artists.items[0]?.images[0]?.url) {
                        imgUrl = d.artists.items[0].images[0].url;
                        setCachedImage('artist_' + artist.name, imgUrl);
                    }
                }
                // Retraso de 100ms para evitar Error 429 de Spotify (Too Many Requests)
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch {}
        }

        artistResults.push({ i, html: `
            <li class="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl transition-colors">
                <span class="text-neutral-500 font-bold w-4 text-center text-sm flex-shrink-0">${i+1}</span>
                <img src="${imgUrl}" class="track-img w-10 h-10 rounded-full object-cover shadow-md flex-shrink-0" onload="this.classList.add('loaded')">
                <div class="flex-1 overflow-hidden min-w-0">
                    <span class="font-bold text-white text-sm block truncate">${artist.name}</span>
                    <div class="artist-bar"><div class="artist-bar-fill" data-pct="${pct}"></div></div>
                </div>
                <span class="text-xs font-bold text-[#1DB954] bg-[#1DB954]/10 px-2 py-1 rounded-full flex-shrink-0">${h}h</span>
            </li>` });
    }

    const artistList = document.getElementById('list-artists');
    document.getElementById('skeleton-artists').classList.add('hidden');
    artistList.classList.remove('hidden');
    artistList.innerHTML = '';
    artistResults.sort((a,b)=>a.i-b.i).forEach(r => artistList.innerHTML += r.html);
    // Animar barras con pequeño delay
    setTimeout(() => {
        artistList.querySelectorAll('.artist-bar-fill').forEach(bar => {
            bar.style.width = bar.dataset.pct + '%';
        });
    }, 100);

    // Top Canciones
    const trackResults = [];
    for (let i = 0; i < stats.topTracks.length; i++) {
        const track = stats.topTracks[i];
        const m = Math.floor(track.ms / 60000);
        let imgUrl = getCachedImage('track_' + track.trackName + track.artistName) || TRACK_PLACEHOLDER;
        const needsFetch = imgUrl === TRACK_PLACEHOLDER;
        let previewUrl = null, spotifyUrl = null;

        if (needsFetch && spotifyToken) {
            try {
                const query = `${track.trackName} ${track.artistName}`;
                const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, { headers: { Authorization: `Bearer ${spotifyToken}` } });
                if (r.ok) {
                    const d = await r.json();
                    const t = d.tracks?.items[0];
                    if (t) {
                        if (t.album?.images[0]?.url) {
                            imgUrl = t.album.images[0].url;
                            setCachedImage('track_' + track.trackName + track.artistName, imgUrl);
                        }
                        if (t.preview_url) previewUrl = t.preview_url;
                        if (t.external_urls?.spotify) spotifyUrl = t.external_urls.spotify;
                    }
                }
                // Retraso de 100ms para evitar Error 429 de Spotify (Too Many Requests)
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch {}
        }

        trackResults.push({ i, html: `
            <li class="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl transition-colors group cursor-pointer"
                data-preview="${previewUrl || ''}" data-spotify="${spotifyUrl || ''}">
                <span class="text-neutral-500 font-bold w-4 text-center text-sm flex-shrink-0">${i+1}</span>
                <div class="relative w-10 h-10 flex-shrink-0">
                    <img src="${imgUrl}" class="track-img w-full h-full rounded shadow-md object-cover" onload="this.classList.add('loaded')">
                    ${previewUrl ? `<div class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded">
                        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>` : ''}
                </div>
                <div class="flex-1 overflow-hidden min-w-0">
                    <span class="font-bold text-white text-sm block truncate">${track.trackName}</span>
                    <span class="text-neutral-400 text-xs block truncate">${track.artistName}</span>
                </div>
                <span class="text-xs font-bold text-[#1DB954] flex-shrink-0">${m}m</span>
            </li>` });
    }

    const trackList = document.getElementById('list-tracks');
    document.getElementById('skeleton-tracks').classList.add('hidden');
    trackList.classList.remove('hidden');
    trackList.innerHTML = '';
    trackResults.sort((a,b)=>a.i-b.i).forEach(r => trackList.innerHTML += r.html);
}

function showSkeletons() {
    document.getElementById('skeleton-artists')?.classList.remove('hidden');
    document.getElementById('skeleton-tracks')?.classList.remove('hidden');
    document.getElementById('list-artists')?.classList.add('hidden');
    document.getElementById('list-tracks')?.classList.add('hidden');
}

// ============================================================
// REPRODUCTOR DE PREVIAS
// ============================================================
window.togglePlay = function(url, el) {
    if (!url || url === 'null') return;
    const icon = el.querySelector('.play-icon');
    if (currentAudio?.src === url) {
        if (!currentAudio.paused) { currentAudio.pause(); icon.textContent = '▶'; }
        else { currentAudio.play(); icon.textContent = '⏸'; }
        return;
    }
    if (currentAudio) { currentAudio.pause(); if (currentPlayingBtn) currentPlayingBtn.textContent = '▶'; }
    currentAudio = new Audio(url);
    currentAudio.volume = 0.5;
    currentAudio.play();
    icon.textContent = '⏸';
    currentPlayingBtn = icon;
    currentAudio.onended = () => { icon.textContent = '▶'; };
};

// ============================================================
// FONDO DINÁMICO
// ============================================================
async function updateBackground(userId) {
    const token = await getValidToken(userId);
    if (!token) return;
    try {
        const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 200) {
            const data = await res.json();
            if (data && data.item && data.item.album && data.item.album.images.length > 0) {
                const imgUrl = data.item.album.images[0].url;
                const bg = document.getElementById('album-bg');
                if (bg) {
                    bg.style.backgroundImage = `url(${imgUrl})`;
                    bg.classList.add('visible');
                }
            }
        }
        // Si no hay nada sonando (204/pausado), dejamos el fondo como está —
        // no lo reemplazamos con /recently-played porque esa canción puede no
        // ser la misma que se acaba de pausar (Spotify tarda en registrarla
        // ahí), y pondría una portada que no corresponde.
    } catch (e) {}
}
