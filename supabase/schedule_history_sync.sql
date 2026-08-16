-- ============================================================
-- PROGRAMAR captura de historial en segundo plano (cada 15 min)
--
-- Por qué: la API de Spotify solo expone las últimas 50 canciones
-- reproducidas (/me/player/recently-played) — no existe forma de pedir
-- "lo que escuché hace un mes". Si el usuario cierra la pestaña y escucha
-- más de 50 canciones antes de volver a abrirla, esas se pierden para
-- siempre. La función sync-all-users-history (antes spotify_background_job.ts,
-- nunca desplegada) hace exactamente lo mismo que el tracking del navegador
-- pero corriendo sola en el servidor, sin depender de que la pestaña esté
-- abierta — así el conteo queda lo más completo y preciso posible dentro
-- de lo que Spotify permite.
--
-- PASOS (en orden):
--   1. Desplegar la función Edge Function `sync-all-users-history`
--      (supabase/functions/sync-all-users-history/index.ts) — con
--      Supabase CLI: `supabase functions deploy sync-all-users-history`,
--      o pegando el código desde el dashboard (Edge Functions > Create).
--   2. En esa función, agregar la variable de entorno CRON_SECRET con un
--      valor largo que inventes tú (cualquier texto random de ~40+
--      caracteres sirve). Esto evita que cualquiera en internet pueda
--      llamar a la función y gastar tus tokens/cuota de Spotify.
--   3. Reemplazar los dos placeholders de abajo (TU-PROYECTO y
--      TU-CRON-SECRET, debe ser IGUAL al que pusiste en el paso 2) y
--      correr este script completo en el SQL Editor.
--
-- El secreto NO queda en texto plano en la base — Vault lo guarda cifrado
-- y el cron job lo lee solo al momento de ejecutarse.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Guardar la URL de la función y el secreto compartido en Vault.
-- ⚠️ Reemplaza los dos valores de abajo antes de correr esto.
SELECT vault.create_secret(
  'https://TU-PROYECTO.supabase.co/functions/v1/sync-all-users-history',
  'history_sync_url'
);
SELECT vault.create_secret(
  'TU-CRON-SECRET',
  'history_sync_secret'
);

-- Programar: cada 15 minutos. Reemplaza si ya existía (seguro de re-correr).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-all-users-history') THEN
    PERFORM cron.unschedule('sync-all-users-history');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-all-users-history',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'history_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'history_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);


-- =============================================
-- VERIFICACIÓN MANUAL (opcional):
-- =============================================
-- Confirmar que quedó programado:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-all-users-history';
--
-- Ver las últimas corridas y si tuvieron éxito (status, response):
-- SELECT * FROM net._http_response ORDER BY id DESC LIMIT 5;
--
-- Para cambiar la frecuencia más adelante, solo actualiza el 2do argumento:
-- SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sync-all-users-history'), schedule := '*/10 * * * *');
