-- ============================================================
-- FIX RLS - SOCIAL FEATURES
-- Ejecutar en Supabase SQL Editor
-- El error 409 Conflict en PATCH significa que hay una política
-- WITH CHECK bloqueando el UPDATE. Este script lo resuelve.
-- ============================================================

-- ── Ver políticas actuales (diagnóstico) ──
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies 
WHERE tablename IN ('challenges', 'users')
ORDER BY tablename, policyname;

-- ── 1. Limpiar TODAS las políticas existentes en challenges ──
-- (evita conflictos con WITH CHECK de políticas anteriores)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'challenges' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.challenges', r.policyname);
    END LOOP;
END $$;

-- ── 2. CHALLENGES: SELECT - leer propios challenges ──
CREATE POLICY "challenges: select own"
ON public.challenges FOR SELECT
USING (auth.uid() = creator_id OR auth.uid() = opponent_id);

-- ── 3. CHALLENGES: INSERT - crear nuevos challenges ──
CREATE POLICY "challenges: insert own"
ON public.challenges FOR INSERT
WITH CHECK (auth.uid() = creator_id);

-- ── 4. CHALLENGES: UPDATE - creator u oponente pueden cambiar status ──
CREATE POLICY "challenges: update own"
ON public.challenges FOR UPDATE
USING (auth.uid() = creator_id OR auth.uid() = opponent_id);
-- Sin WITH CHECK restrictivo para evitar el 409

-- ── 5. USERS: permitir leer perfiles de otros usuarios autenticados ──
DROP POLICY IF EXISTS "users: read public profile" ON public.users;
CREATE POLICY "users: read public profile"
ON public.users FOR SELECT
USING (auth.role() = 'authenticated');

-- ── Verificar que quedaron bien ──
SELECT tablename, policyname, cmd
FROM pg_policies 
WHERE tablename IN ('challenges', 'users') AND schemaname = 'public'
ORDER BY tablename, policyname;
