-- ============================================================
-- BACKUP AUTOMÁTICO MENSUAL: listening_sessions + conteo en users
--
-- Guarda una copia (snapshot) de los datos que alimentan el conteo
-- (tiempo escuchado, historial de canciones) el primer día de cada
-- mes, como red de seguridad. Se corre una sola vez para dejarlo
-- programado — de ahí en adelante Postgres lo dispara solo.
--
-- No se respaldan spotify_access_token / spotify_refresh_token
-- (no hace falta y evita tener copias extra de credenciales).
--
-- Ejecutar en Supabase SQL Editor. Es seguro volver a correrlo
-- (no duplica la tabla, la extensión, ni el trabajo programado).
-- ============================================================

-- 1. Habilitar pg_cron (si el proyecto no lo tenía activo)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Tabla de respaldo de listening_sessions.
--    INCLUDING DEFAULTS (sin constraints/índices) a propósito: cada fila
--    original se va a guardar de nuevo cada mes que siga existiendo, así
--    que no debe haber una unique/primary key que choque entre snapshots.
CREATE TABLE IF NOT EXISTS public.listening_sessions_backup (
  LIKE public.listening_sessions INCLUDING DEFAULTS
);
ALTER TABLE public.listening_sessions_backup
  ADD COLUMN IF NOT EXISTS backup_taken_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_listening_sessions_backup_taken_at
  ON public.listening_sessions_backup (backup_taken_at);

-- 3. Tabla de respaldo de los campos de conteo en users (sin tokens).
CREATE TABLE IF NOT EXISTS public.users_stats_backup (
  id                    UUID NOT NULL,
  cumulative_ms_played  BIGINT,
  historical_stats      JSONB,
  preferences           JSONB,
  backup_taken_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_stats_backup_taken_at
  ON public.users_stats_backup (backup_taken_at);

-- 4. Función que toma el snapshot y borra respaldos de más de 6 meses
--    (para que las tablas de backup no crezcan para siempre).
CREATE OR REPLACE FUNCTION public.run_scheduled_backup()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.listening_sessions_backup
  SELECT ls.*, now() FROM public.listening_sessions ls;

  INSERT INTO public.users_stats_backup (id, cumulative_ms_played, historical_stats, preferences, backup_taken_at)
  SELECT id, cumulative_ms_played, historical_stats, preferences, now()
  FROM public.users;

  DELETE FROM public.listening_sessions_backup WHERE backup_taken_at < now() - interval '6 months';
  DELETE FROM public.users_stats_backup       WHERE backup_taken_at < now() - interval '6 months';
END;
$$;

-- 5. Programar: el día 1 de cada mes a las 03:00 UTC.
--    Re-programable sin duplicar: si ya existe un job con este nombre, se reemplaza.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-data-backup') THEN
    PERFORM cron.unschedule('monthly-data-backup');
  END IF;
END $$;

SELECT cron.schedule(
  'monthly-data-backup',
  '0 3 1 * *',
  $$ SELECT public.run_scheduled_backup(); $$
);

-- 6. Tomar un primer respaldo ahora mismo, sin esperar al próximo mes.
SELECT public.run_scheduled_backup();


-- =============================================
-- VERIFICACIÓN MANUAL (opcional):
-- =============================================
-- Ver que el job quedó programado:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'monthly-data-backup';
--
-- Ver los snapshots guardados:
-- SELECT backup_taken_at, COUNT(*) FROM public.listening_sessions_backup GROUP BY backup_taken_at ORDER BY 1 DESC;
--
-- Para restaurar una fila puntual desde un respaldo (ejemplo):
-- SELECT * FROM public.listening_sessions_backup WHERE user_id = '...' AND backup_taken_at = '...';
