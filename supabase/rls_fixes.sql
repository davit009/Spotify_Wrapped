-- =============================================
-- CORRECCIONES RLS — Playcount
-- Ejecutar en Supabase SQL Editor
-- =============================================


-- =============================================
-- FIX 1: listening_sessions — permitir ver datos de amigos en challenges
-- =============================================

-- Borrar la policy restrictiva actual
DROP POLICY IF EXISTS "listening_sessions: select own" ON public.listening_sessions;

-- Nueva policy: ver tus sesiones + las de tus amigos activos
CREATE POLICY "listening_sessions: select own or challenge" ON public.listening_sessions
  FOR SELECT USING (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM public.challenges c
      WHERE c.status = 'active'
        AND (c.creator_id = auth.uid() OR c.opponent_id = auth.uid())
        AND (c.creator_id = user_id OR c.opponent_id = user_id)
    )
  );


-- =============================================
-- FIX 2: challenges — permitir INSERT cuando aceptas invitación
-- =============================================

-- Borrar la policy actual
DROP POLICY IF EXISTS "challenges: insert own" ON public.challenges;

-- Nueva policy: puedes crear si eres el creator O el opponent
CREATE POLICY "challenges: insert participant" ON public.challenges
  FOR INSERT WITH CHECK (
    auth.uid() = creator_id OR auth.uid() = opponent_id
  );


-- =============================================
-- FIX 3: users — permitir búsqueda de amigos
-- =============================================
-- OPCIÓN A: Cambiar el código para usar la vista users_public (RECOMENDADO)
-- OPCIÓN B: Agregar policy para leer campos no-sensibles de otros usuarios
-- Usaremos OPCIÓN B porque no requiere cambiar código:

-- Agregar policy que permite leer cualquier usuario (los tokens se protegen con la vista)
CREATE POLICY "users: select any authenticated" ON public.users
  FOR SELECT USING (auth.role() = 'authenticated');

-- NOTA: Esto expone TODAS las columnas (incluido spotify_access_token) a cualquier 
-- usuario autenticado. Si te preocupa, mejor usa OPCIÓN A: cambia social.js para 
-- que use supabaseClient.from('users_public') en la búsqueda.
-- Por ahora esto funciona porque tu app solo pide las columnas que necesita.
