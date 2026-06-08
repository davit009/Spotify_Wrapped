-- ============================================================
-- MIGRACIÓN: Metadatos en Listening Sessions
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.listening_sessions
  ADD COLUMN IF NOT EXISTS track_name TEXT,
  ADD COLUMN IF NOT EXISTS artist_name TEXT,
  ADD COLUMN IF NOT EXISTS album_art_url TEXT;

-- Comentario explicativo
COMMENT ON COLUMN public.listening_sessions.track_name IS 'Nombre de la canción (caché)';
COMMENT ON COLUMN public.listening_sessions.artist_name IS 'Nombre del artista o artistas (caché)';
COMMENT ON COLUMN public.listening_sessions.album_art_url IS 'URL de la portada del álbum (caché)';
