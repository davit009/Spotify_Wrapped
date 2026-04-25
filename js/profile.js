document.addEventListener('DOMContentLoaded', async () => {
    // Verificar si el usuario está logueado
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    // Configurar Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-upload');

    // Manejar clics y arrastrar/soltar en la zona de carga
    dropzone.addEventListener('click', (e) => {
        // Evitar bucle infinito si el clic vino del input mismo
        if (e.target.id !== 'file-upload') {
            fileInput.click();
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-[#1DB954]', 'bg-[#1DB954]/5');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-[#1DB954]', 'bg-[#1DB954]/5');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-[#1DB954]', 'bg-[#1DB954]/5');
        if (e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFiles(e.target.files);
        }
    });
});

async function processFiles(files) {
    let allData = [];
    
    // Cambiar UI temporalmente a estado de carga
    document.getElementById('dropzone').querySelector('h3').textContent = 'Procesando historial...';

    // Leer todos los archivos JSON seleccionados
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith('.json')) {
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                if (Array.isArray(json)) {
                    allData = allData.concat(json);
                }
            } catch (err) {
                console.error("Error leyendo archivo:", file.name, err);
            }
        }
    }

    if (allData.length === 0) {
        alert("No se encontraron datos válidos de Spotify en los archivos seleccionados.");
        document.getElementById('dropzone').querySelector('h3').textContent = 'Selecciona o arrastra tus archivos JSON aquí';
        return;
    }

    analyzeData(allData);
}

function analyzeData(data) {
    let totalMs = 0;
    const artistsCount = {};
    const tracksCount = {};

    data.forEach(item => {
        // Spotify proporciona diferentes campos según si es el historial Standard o Extended.
        // Standard usa 'msPlayed', 'artistName', 'trackName'.
        // Extended usa 'ms_played', 'master_metadata_album_artist_name', 'master_metadata_track_name'.
        const ms = item.ms_played || item.msPlayed || 0;
        const artist = item.master_metadata_album_artist_name || item.artistName;
        const track = item.master_metadata_track_name || item.trackName;

        // Regla: Solo contar si se escuchó al menos 30 segundos
        if (ms < 30000) return;

        totalMs += ms;

        if (artist) {
            artistsCount[artist] = (artistsCount[artist] || 0) + ms;
        }

        if (track && artist) {
            const trackKey = `${track} - ${artist}`;
            tracksCount[trackKey] = (tracksCount[trackKey] || 0) + ms;
        }
    });

    // Cálculos de horas y formateo
    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    
    // Ordenar los mejores 10 artistas y canciones
    const sortedArtists = Object.entries(artistsCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
        
    const sortedTracks = Object.entries(tracksCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    // Plasmar datos en el HTML
    document.getElementById('stat-hours').textContent = `${hours}h`;
    document.getElementById('stat-artists').textContent = Object.keys(artistsCount).length.toLocaleString();
    document.getElementById('stat-tracks').textContent = Object.keys(tracksCount).length.toLocaleString();

    // Llenar lista de Artistas
    const artistList = document.getElementById('list-artists');
    artistList.innerHTML = '';
    sortedArtists.forEach(([name, ms], index) => {
        const h = Math.floor(ms / (1000 * 60 * 60));
        artistList.innerHTML += `
            <li class="flex justify-between items-center p-2 hover:bg-white/5 rounded-lg transition-colors border-b border-neutral-800/50 last:border-0">
                <div class="flex items-center gap-4">
                    <span class="text-neutral-500 font-bold w-4 text-center">${index + 1}</span>
                    <span class="font-bold text-white text-sm md:text-base">${name}</span>
                </div>
                <span class="text-xs font-bold text-[#1DB954] bg-[#1DB954]/10 px-3 py-1 rounded-full">${h}h</span>
            </li>
        `;
    });

    // Llenar lista de Canciones
    const trackList = document.getElementById('list-tracks');
    trackList.innerHTML = '';
    sortedTracks.forEach(([name, ms], index) => {
        const m = Math.floor(ms / (1000 * 60));
        const [trackName, artistName] = name.split(' - ');
        trackList.innerHTML += `
            <li class="flex justify-between items-center p-2 hover:bg-white/5 rounded-lg transition-colors border-b border-neutral-800/50 last:border-0">
                <div class="flex items-center gap-4 overflow-hidden pr-2">
                    <span class="text-neutral-500 font-bold w-4 text-center flex-shrink-0">${index + 1}</span>
                    <div class="flex flex-col overflow-hidden">
                        <span class="font-bold text-white text-sm md:text-base truncate">${trackName}</span>
                        <span class="text-xs text-neutral-400 truncate">${artistName}</span>
                    </div>
                </div>
                <span class="text-xs font-bold text-[#1DB954] bg-[#1DB954]/10 px-3 py-1 rounded-full flex-shrink-0">${m}m</span>
            </li>
        `;
    });

    // Mostrar sección de resultados
    document.getElementById('dropzone').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
}
