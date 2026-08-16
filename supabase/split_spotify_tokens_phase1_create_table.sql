-- ============================================================
-- SEGURIDAD — FASE 1: separar los tokens de Spotify de `users`
--
-- Por qué: la policy "users: select any authenticated" (de rls_fixes.sql)
-- deja que CUALQUIER usuario logueado en la app lea la fila completa de
-- CUALQUIER otro usuario — incluyendo spotify_access_token y
-- spotify_refresh_token. Postgres/RLS no puede restringir columnas dentro
-- de una misma policy de fila, así que la única forma correcta de arreglarlo
-- es sacar los tokens a su propia tabla con su propia regla ("solo tú
-- puedes ver la tuya").
--
-- Esta fase es 100% aditiva y segura de correr en cualquier momento:
-- crea la tabla nueva y copia los tokens que ya existan, pero NO toca ni
-- borra las columnas viejas en `users` todavía (eso es la fase 2, que se
-- corre después, una vez confirmado que todo sigue funcionando).
--
-- Ejecutar en Supabase SQL Editor. Seguro de volver a correr.
-- ============================================================

-- 1. Tabla nueva: un renglón por usuario, solo tokens de Spotify.
CREATE TABLE IF NOT EXISTS public.user_spotify_tokens (
  id                        UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  spotify_access_token      TEXT,
  spotify_refresh_token     TEXT,
  spotify_token_expires_at  TIMESTAMPTZ,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. RLS: cada quien solo puede leer/escribir su propia fila. Sin policy
--    para "cualquier autenticado" — a propósito, es justo lo que arregla esto.
ALTER TABLE public.user_spotify_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_spotify_tokens: own row only" ON public.user_spotify_tokens;
CREATE POLICY "user_spotify_tokens: own row only" ON public.user_spotify_tokens
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. El rol authenticated necesita permiso a nivel de tabla además de la
--    policy de RLS (Postgres revisa GRANT primero, RLS filtra después).
GRANT SELECT, INSERT, UPDATE ON public.user_spotify_tokens TO authenticated;

-- 4. Copiar los tokens que ya existan en `users` — sin pisar filas que la
--    app ya haya escrito en la tabla nueva (por si este script se corre
--    más de una vez después de que el código nuevo ya esté desplegado).
INSERT INTO public.user_spotify_tokens (id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at)
SELECT id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at
FROM public.users
WHERE spotify_access_token IS NOT NULL OR spotify_refresh_token IS NOT NULL
ON CONFLICT (id) DO NOTHING;


-- 5. El trigger de usuarios nuevos (new_user_trigger.sql) todavía guarda
--    provider_token en la columna vieja `users.spotify_access_token` al
--    registrarse. Ya no hace falta — el login en dashboard.html guarda el
--    token en user_spotify_tokens un instante después de todos modos — así
--    que dejamos de escribirlo ahí para no seguir poblando la columna que
--    vamos a retirar en la fase 2.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    spotify_id,
    display_name,
    avatar_url,
    registered_at,
    preferences
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Usuario'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
    NOW(),
    '{"merge_history": true}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


-- =============================================
-- VERIFICACIÓN MANUAL (opcional):
-- =============================================
-- SELECT count(*) FROM public.user_spotify_tokens;
--
-- Confirmar que ya NO puedes leer el token de otro usuario cualquiera
-- (debería devolver 0 filas o error de permisos si pruebas con otro id):
-- SELECT spotify_access_token FROM public.user_spotify_tokens WHERE id <> auth.uid();
