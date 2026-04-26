import { supabaseClient } from './supabase.js';

/**
 * Inicializa la lógica social y de desafíos
 */
export async function initSocial(currentUser) {
    const socialModal = document.getElementById('social-modal');
    const socialModalContent = document.getElementById('social-modal-content');
    const openBtn = document.getElementById('open-social-btn');
    const closeBtn = document.getElementById('close-social-modal');
    const tabs = document.querySelectorAll('.social-tab');
    const searchInput = document.getElementById('user-search-input');
    const searchResults = document.getElementById('user-search-results');
    const activeChallengesList = document.getElementById('social-tab-active');

    if (!openBtn) return;

    // --- Lógica del Modal ---
    openBtn.addEventListener('click', () => {
        socialModal.classList.remove('hidden');
        setTimeout(() => {
            socialModalContent.classList.remove('scale-95', 'opacity-0');
            socialModalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
        loadActiveChallenges(currentUser.id);
    });

    closeBtn.addEventListener('click', () => {
        socialModalContent.classList.remove('scale-100', 'opacity-100');
        socialModalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => socialModal.classList.add('hidden'), 150);
    });

    // --- Lógica de Pestañas ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active', 'text-[#1DB954]', 'border-b-2', 'border-[#1DB954]');
                t.classList.add('text-neutral-400');
            });
            tab.classList.add('active', 'text-[#1DB954]', 'border-b-2', 'border-[#1DB954]');
            tab.classList.remove('text-neutral-400');

            const target = tab.dataset.tab;
            document.getElementById('social-tab-active').classList.toggle('hidden', target !== 'active');
            document.getElementById('social-tab-search').classList.toggle('hidden', target !== 'search');
        });
    });

    // --- Lógica de Búsqueda ---
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length < 2) {
            searchResults.innerHTML = '<p class="text-center text-neutral-600 text-sm py-4">Escribe un nombre para buscar...</p>';
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

    function renderSearchResults(users, currentUserId) {
        if (users.length === 0) {
            searchResults.innerHTML = '<p class="text-center text-neutral-600 text-sm py-4">No se encontraron usuarios.</p>';
            return;
        }

        searchResults.innerHTML = '';
        users.forEach(user => {
            const div = document.createElement('div');
            div.className = "flex items-center justify-between p-3 bg-neutral-900/50 rounded-2xl border border-neutral-800/50 hover:border-neutral-700 transition-colors";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <img src="${user.avatar_url || 'https://www.gravatar.com/avatar/0000?d=mp&f=y'}" class="w-10 h-10 rounded-full border border-neutral-800">
                    <span class="font-bold text-white">${user.display_name}</span>
                </div>
                <button class="challenge-btn bg-[#1DB954] text-black text-xs font-bold py-2 px-4 rounded-full hover:scale-105 transition-transform" data-id="${user.id}">
                    Invitar
                </button>
            `;
            searchResults.appendChild(div);

            div.querySelector('.challenge-btn').addEventListener('click', () => createChallenge(user.id));
        });
    }

    async function createChallenge(opponentId) {
        const start = new Date();
        const end = new Date();
        end.setFullYear(end.getFullYear() + 10); // Prácticamente para siempre

        const { error } = await supabaseClient
            .from('challenges')
            .insert({
                creator_id: currentUser.id,
                opponent_id: opponentId,
                start_date: start.toISOString(),
                end_date: end.toISOString(),
                status: 'pending'
            });

        if (error) {
            alert("Ya existe un desafío pendiente con este usuario.");
        } else {
            alert("¡Invitación enviada!");
            searchInput.value = '';
            document.querySelector('.social-tab[data-tab="active"]').click();
            loadActiveChallenges(currentUser.id);
        }
    }

    async function loadActiveChallenges(userId) {
        const { data, error } = await supabaseClient
            .from('challenges')
            .select(`
                *,
                creator:creator_id (display_name, avatar_url),
                opponent:opponent_id (display_name, avatar_url)
            `)
            .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
            .neq('status', 'declined')
            .neq('status', 'finished')
            .order('created_at', { ascending: false });

        if (error) return;
        renderActiveChallenges(data, userId);
    }

    function renderActiveChallenges(challenges, userId) {
        if (challenges.length === 0) {
            activeChallengesList.innerHTML = '<div class="text-center py-10 text-neutral-500"><p>No tienes desafíos activos.</p></div>';
            return;
        }

        activeChallengesList.innerHTML = '';
        challenges.forEach(ch => {
            const isCreator = ch.creator_id === userId;
            const otherUser = isCreator ? ch.opponent : ch.creator;
            const isPending = ch.status === 'pending';
            
            const div = document.createElement('div');
            div.className = "p-4 bg-neutral-900/80 rounded-2xl border border-neutral-800 flex items-center justify-between group";
            div.innerHTML = `
                <div class="flex items-center gap-4">
                    <img src="${otherUser.avatar_url || 'https://www.gravatar.com/avatar/0?d=mp'}" class="w-12 h-12 rounded-full">
                    <div>
                        <h4 class="font-bold text-white">${otherUser.display_name}</h4>
                        <p class="text-xs ${isPending ? 'text-amber-500' : 'text-[#1DB954]'}">${isPending ? 'Invitación recibida' : 'Dúo activo'}</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    ${!isCreator && isPending ? `
                        <button class="accept-btn bg-[#1DB954] text-black text-xs font-bold py-2 px-4 rounded-full">Aceptar</button>
                    ` : `
                        <button class="view-btn bg-neutral-800 text-white text-xs font-bold py-2 px-4 rounded-full hover:bg-neutral-700">${isPending ? 'Esperando' : 'Ver Dúo'}</button>
                    `}
                    <!-- Botón cancelar (un poco escondido en hover o al final) -->
                    <button class="cancel-btn p-2 text-neutral-600 hover:text-red-500 transition-colors" title="Cancelar Dúo">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            `;
            activeChallengesList.appendChild(div);

            div.querySelector('.accept-btn')?.addEventListener('click', () => respondChallenge(ch.id, 'active'));
            div.querySelector('.cancel-btn')?.addEventListener('click', () => {
                if(confirm("¿Seguro que quieres terminar este Dúo?")) respondChallenge(ch.id, 'finished');
            });
            div.querySelector('.view-btn')?.addEventListener('click', () => {
                if (!isPending) window.location.href = `duel.html?id=${ch.id}`;
            });
        });
    }

    async function respondChallenge(challengeId, status) {
        const { error } = await supabaseClient
            .from('challenges')
            .update({ status })
            .eq('id', challengeId);
        
        if (!error) loadActiveChallenges(currentUser.id);
    }
}
