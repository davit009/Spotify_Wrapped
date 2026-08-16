-- =============================================
-- VERIFICACIÓN: constraint único en listening_sessions
--
-- El upsert de js/tracking.js, spotify_background_job.ts y el resto
-- del tracking usa:
--   .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true })
--
-- Eso solo funciona (deduplica sin insertar filas repetidas) si existe
-- un UNIQUE constraint real sobre (user_id, played_at) en la tabla.
-- Como esa tabla se creó fuera de este repo (directo en el dashboard
-- de Supabase), no hay forma de confirmar desde el código que el
-- constraint siga existiendo. Este script lo garantiza sin romper
-- nada si ya está: si el nombre ya existe, no hace nada.
--
-- Ejecutar en Supabase SQL Editor.
-- =============================================

DO $$
BEGIN
  ALTER TABLE public.listening_sessions
    ADD CONSTRAINT listening_sessions_user_played_at_key UNIQUE (user_id, played_at);
  RAISE NOTICE 'Constraint creado correctamente.';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'El constraint ya existía (con este nombre) — no se hizo ningún cambio.';
  WHEN duplicate_table THEN
    RAISE NOTICE 'Ya existe un índice/constraint equivalente — no se hizo ningún cambio.';
END $$;


-- =============================================
-- VERIFICACIÓN MANUAL (opcional):
-- Corre esto para confirmar que el constraint quedó activo.
-- Debe devolver al menos una fila con conname = 'listening_sessions_user_played_at_key'
-- (o cualquier otro UNIQUE que cubra user_id + played_at).
-- =============================================
-- SELECT conname, contype, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.listening_sessions'::regclass;


-- =============================================
-- OPCIONAL: detectar si YA hay duplicados guardados por este bug
-- (filas con mismo user_id + played_at). Si esta consulta devuelve
-- filas, esas canciones se contaron de más en cumulative_ms_played
-- y en los Top Tracks hasta ahora.
-- =============================================
-- SELECT user_id, played_at, COUNT(*) AS veces
-- FROM public.listening_sessions
-- GROUP BY user_id, played_at
-- HAVING COUNT(*) > 1
-- ORDER BY veces DESC
-- LIMIT 50;
