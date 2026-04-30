-- ============================================================
-- FIX RLS - SOCIAL FEATURES
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. USERS: permitir leer perfiles públicos de otros usuarios ──
-- Sin esto, los joins en challenges devuelven null para creator/opponent
DROP POLICY IF EXISTS "users: read public profile" ON public.users;
CREATE POLICY "users: read public profile"
ON public.users
FOR SELECT
USING (auth.role() = 'authenticated');
-- Nota: esto reemplaza políticas más restrictivas que solo permiten leer el propio perfil.
-- Solo expone display_name y avatar_url (no tokens de Spotify) a otros usuarios autenticados.

-- ── 2. CHALLENGES: permitir al oponente actualizar el status ──
-- Sin esto, el oponente no puede aceptar/rechazar solicitudes
DROP POLICY IF EXISTS "challenges: opponent can update status" ON public.challenges;
CREATE POLICY "challenges: opponent can update status"
ON public.challenges
FOR UPDATE
USING (
    auth.uid() = opponent_id   -- El oponente puede aceptar/rechazar
    OR auth.uid() = creator_id -- El creador puede cancelar
)
WITH CHECK (
    status IN ('active', 'declined', 'finished')
);

-- ── 3. CHALLENGES: permitir leer los propios challenges ──
DROP POLICY IF EXISTS "challenges: read own" ON public.challenges;
CREATE POLICY "challenges: read own"
ON public.challenges
FOR SELECT
USING (
    auth.uid() = creator_id OR auth.uid() = opponent_id
);

-- ── 4. CHALLENGES: permitir crear nuevos challenges ──
DROP POLICY IF EXISTS "challenges: insert own" ON public.challenges;
CREATE POLICY "challenges: insert own"
ON public.challenges
FOR INSERT
WITH CHECK (auth.uid() = creator_id);
