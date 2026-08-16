-- ============================================================
-- MIGRACIÓN: fecha de expiración del access_token de Spotify
--
-- Sin esto, getValidToken() no tiene forma de saber si el
-- spotify_access_token guardado sigue vivo o ya venció (Spotify
-- los emite con expires_in=3600, es decir 1 hora), así que las
-- llamadas a la API de Spotify empiezan a fallar con 401 hasta
-- que el usuario vuelve a iniciar sesión manualmente.
--
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS spotify_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.spotify_token_expires_at IS 'Cuándo vence spotify_access_token — se usa para refrescarlo antes de que la API de Spotify empiece a rechazarlo';
