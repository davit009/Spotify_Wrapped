-- =============================================
-- CORRECCIÓN: Usuarios nuevos — Playcount
-- Ejecutar en Supabase SQL Editor
-- Esto soluciona el error de login para usuarios nuevos
-- =============================================


-- =============================================
-- PASO 1: Función que se ejecuta al crear un nuevo usuario
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insertar perfil básico en public.users cuando alguien se registra por primera vez
  -- Columnas reales de la tabla: id, spotify_id, display_name, avatar_url, registered_at, preferences
  INSERT INTO public.users (
    id,
    spotify_id,
    display_name,
    avatar_url,
    spotify_access_token,
    registered_at,
    preferences
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Usuario'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
    COALESCE(NEW.raw_user_meta_data->>'provider_token', ''),
    NOW(),
    '{"merge_history": true}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


-- =============================================
-- PASO 2: Crear el trigger que llama a la función
-- =============================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- =============================================
-- PASO 3: Políticas RLS para INSERT y UPDATE en public.users
-- =============================================
DROP POLICY IF EXISTS "users: insert own" ON public.users;

CREATE POLICY "users: insert own" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "users: update own" ON public.users;

CREATE POLICY "users: update own" ON public.users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- =============================================
-- PASO 4 (OPCIONAL): Crear perfiles para usuarios que ya existen
-- en auth.users pero no tienen fila en public.users
-- =============================================
INSERT INTO public.users (id, spotify_id, display_name, avatar_url, registered_at, preferences)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'provider_id', au.raw_user_meta_data->>'sub', ''),
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', 'Usuario'),
  COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture', ''),
  au.created_at,
  '{"merge_history": true}'::jsonb
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users pu WHERE pu.id = au.id
)
ON CONFLICT (id) DO NOTHING;
