-- ============================================================
-- SEGURIDAD — FASE 2: retirar los tokens de Spotify de `users`
--
-- ⚠️ CORRER SOLO DESPUÉS DE, EN ESTE ORDEN:
--   1. Haber corrido split_spotify_tokens_phase1_create_table.sql
--   2. Haber fusionado y desplegado el código de esta PR (usa
--      user_spotify_tokens en vez de las columnas viejas de users)
--   3. Haber probado la app un rato y confirmado que el login, la
--      reproducción actual y el conteo siguen funcionando normal
--
-- Hasta que esto se corra, los tokens técnicamente siguen expuestos a
-- cualquier usuario autenticado a través de `users` (aunque cada vez más
-- viejos/inútiles, porque el código ya dejó de escribir ahí una vez
-- desplegado el paso 2) — esta fase es la que cierra el hueco del todo.
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.users
  DROP COLUMN IF EXISTS spotify_access_token,
  DROP COLUMN IF EXISTS spotify_refresh_token,
  DROP COLUMN IF EXISTS spotify_token_expires_at;


-- =============================================
-- VERIFICACIÓN MANUAL (opcional):
-- Debe devolver error "column does not exist" — confirma que ya no está:
-- =============================================
-- SELECT spotify_access_token FROM public.users LIMIT 1;
