import { supabaseClient } from './supabase.js';

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
                document.getElementById('results').classList.add('hidden');
                document.getElementById('upload-section').classList.remove('hidden');
                document.getElementById('header-desc').classList.remove('hidden');
                document.getElementById('year-filter').classList.add('hidden');
                globalStats = null;
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
// LEER ESTADÍSTICAS GUARDADAS
// ============================================================
async function checkSavedStats(session) {
    const { data } = await supabaseClient
        .from('users')
        .select('historical_stats, preferences, spotify_access_token')
        .eq('id', session.user.id)
        .single();

    const spotifyToken = data?.spotify_access_token || session.provider_token;
    globalToken = spotifyToken;

    const toggleEl = document.getElementById('toggle-history');
    const prefs = data?.preferences || { merge_history: false };
    if (toggleEl) toggleEl.checked = prefs.merge_history;

    if (data?.historical_stats) {
        document.getElementById('upload-section').classList.add('hidden');
        document.getElementById('header-desc').classList.add('hidden');

        let stats = JSON.parse(JSON.stringify(data.historical_stats));

        // === SIEMPRE: sumar horas acumuladas en tiempo real al total ===
        // (independientemente del toggle)
        const { data: realtimeSessions } = await supabaseClient
            .from('listening_sessions')
            .select('track_id, duration_ms')
            .eq('user_id', session.user.id);

        let totalRealtimeMs = 0;
        const trackDurations = {};
        if (realtimeSessions?.length > 0) {
            realtimeSessions.forEach(s => {
                trackDurations[s.track_id] = (trackDurations[s.track_id] || 0) + s.duration_ms;
                totalRealtimeMs += s.duration_ms;
            });
            // Sumar horas al total siempre
            const combinedMs = (stats.totalMsPlayed || stats.hours * 3600000) + totalRealtimeMs;
            stats.hours = Math.floor(combinedMs / 3600000);
            stats.totalMsPlayed = combinedMs;
        }

        // === OPCIONAL (toggle): fusionar top artistas/canciones con los de tiempo real ===
        if (prefs.merge_history && totalRealtimeMs > 0 && spotifyToken) {
            const topIds = Object.keys(trackDurations).sort((a,b) => trackDurations[b]-trackDurations[a]).slice(0,10);
            const freshTracks = (await Promise.all(
                topIds.map(async id => {
                    const r = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: { Authorization: `Bearer ${spotifyToken}` } });
                    return r.ok ? r.json() : null;
                })
            )).filter(Boolean);

            freshTracks.forEach(t => {
                const dur = trackDurations[t.id];
                const ex = stats.topTracks.find(x => x.trackName === t.name);
                if (ex) ex.ms += dur; else stats.topTracks.push({ trackName: t.name, artistName: t.artists[0].name, ms: dur });
                t.artists.forEach(a => {
                    const ea = stats.topArtists.find(x => x.name === a.name);
                    if (ea) ea.ms += dur; else stats.topArtists.push({ name: a.name, ms: dur });
                });
            });
            stats.topTracks  = stats.topTracks.sort((a,b)  => b.ms-a.ms).slice(0,10);
            stats.topArtists = stats.topArtists.sort((a,b) => b.ms-a.ms).slice(0,10);
        }

        globalStats = stats;
        renderYearTabs(stats, spotifyToken);
        renderStats(stats, spotifyToken);
    }
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

    allData.forEach(item => {
        const ms     = item.ms_played || item.msPlayed || 0;
        const artist = item.master_metadata_album_artist_name || item.artistName;
        const track  = item.master_metadata_track_name || item.trackName;
        const uri    = item.spotify_track_uri || null;

        let year = null, dayKey = null;
        if (item.ts)      { year = item.ts.substring(0, 4);      dayKey = item.ts.substring(0, 10); }
        else if (item.endTime) { year = item.endTime.substring(0, 4); dayKey = item.endTime.substring(0, 10); }
        if (dayKey) activeDays.add(dayKey);

        if (ms < 30000 || !artist || !track) return;

        totalMs += ms;
        artistsCount[artist] = (artistsCount[artist] || 0) + ms;

        const key = `${track}|||${artist}`;
        if (!tracksCount[key]) tracksCount[key] = { ms: 0, uri, trackName: track, artistName: artist };
        tracksCount[key].ms += ms;

        if (year) {
            if (!yearlyData[year]) yearlyData[year] = { totalMs: 0, artistsCount: {}, tracksCount: {} };
            yearlyData[year].totalMs += ms;
            yearlyData[year].artistsCount[artist] = (yearlyData[year].artistsCount[artist] || 0) + ms;
            if (!yearlyData[year].tracksCount[key]) yearlyData[year].tracksCount[key] = { ms: 0, uri, trackName: track, artistName: artist };
            yearlyData[year].tracksCount[key].ms += ms;
        }
    });

    setProgress(progressFill, progressText, 80, 'Construyendo estadísticas por año...');

    const yearlyStats = {};
    Object.entries(yearlyData).forEach(([yr, yd]) => {
        yearlyStats[yr] = {
            hours: Math.floor(yd.totalMs / 3600000),
            totalMsPlayed: yd.totalMs,
            totalUniqueArtists: Object.keys(yd.artistsCount).length,
            totalUniqueTracks:  Object.keys(yd.tracksCount).length,
            topArtists: Object.entries(yd.artistsCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(x=>({ name:x[0], ms:x[1] })),
            topTracks:  Object.values(yd.tracksCount).sort((a,b)=>b.ms-a.ms).slice(0,10)
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
        availableYears: Object.keys(yearlyStats).sort().reverse()
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
        .update({ historical_stats: statsToSave })
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

    const { data: uData } = await supabaseClient.from('users').select('spotify_access_token').eq('id', session.user.id).single();
    const token = uData?.spotify_access_token || session.provider_token;
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
// TABS DE AÑO
// ============================================================
let activeYear = 'all';

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
            document.querySelectorAll('.year-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const displayStats = yr === 'all' ? stats : stats.yearlyStats[yr];
            if (displayStats) renderStats(displayStats, token, yr);
        });
        container.appendChild(btn);
    });
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
