-- =============================================
-- CORRECCIÓN: Tiempo total acumulado real
-- El problema: la API de Spotify solo devuelve
-- las últimas 50 canciones, por lo que
-- listening_sessions no captura todo el historial.
-- La solución: acumular el tiempo total en un campo
-- dedicado en users que nunca se pierde.
--
-- Ejecutar en Supabase SQL Editor
-- =============================================


-- =============================================
-- PASO 1: Agregar columna cumulative_ms_played
-- a la tabla users (si no existe)
-- =============================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cumulative_ms_played BIGINT DEFAULT 0;


-- =============================================
-- PASO 2: Poblar el campo con el historial
-- ya existente en listening_sessions
-- (recálculo inicial — solo afecta el pasado)
-- =============================================
UPDATE public.users u
SET cumulative_ms_played = COALESCE((
  SELECT SUM(ls.duration_ms)
  FROM public.listening_sessions ls
  WHERE ls.user_id = u.id
), 0)
WHERE true;


-- =============================================
-- PASO 3: Función que se ejecuta en cada INSERT
-- a listening_sessions para sumar el tiempo
-- =============================================
CREATE OR REPLACE FUNCTION public.increment_cumulative_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo sumar si es un INSERT real (no UPDATE del upsert que no cambia nada)
  UPDATE public.users
  SET cumulative_ms_played = COALESCE(cumulative_ms_played, 0) + NEW.duration_ms
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;


-- =============================================
-- PASO 4: Crear el trigger en listening_sessions
-- =============================================
DROP TRIGGER IF EXISTS on_listening_session_insert ON public.listening_sessions;

CREATE TRIGGER on_listening_session_insert
  AFTER INSERT ON public.listening_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_cumulative_time();


-- =============================================
-- PASO 5: Función RPC para incremento atómico
-- desde el cliente JS (respaldo al trigger)
-- =============================================
CREATE OR REPLACE FUNCTION public.increment_user_cumulative_ms(
  p_user_id UUID,
  p_ms      BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET cumulative_ms_played = COALESCE(cumulative_ms_played, 0) + p_ms
  WHERE id = p_user_id;
END;
$$;


-- =============================================
-- PASO 6: Verificación — confirma que el campo
-- tiene datos (deberías ver un valor > 0)
-- =============================================
-- SELECT id, cumulative_ms_played,
--   ROUND(cumulative_ms_played / 3600000.0, 2) AS horas_totales
-- FROM public.users
-- LIMIT 5;
