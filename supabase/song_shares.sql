-- ============================================================
-- SONG SHARES — Recomendaciones de canciones entre amigos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. Crear tabla ──
CREATE TABLE IF NOT EXISTS public.song_shares (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Metadata de la canción (guardada en nuestra DB, no depende de Spotify)
    track_id        TEXT NOT NULL,
    track_name      TEXT NOT NULL,
    artist_name     TEXT NOT NULL,
    album_art_url   TEXT,
    spotify_url     TEXT NOT NULL,   -- open.spotify.com/track/...

    -- Opcional: mensaje corto del remitente
    message         TEXT CHECK (char_length(message) <= 120),

    -- Estado de lectura
    seen            BOOLEAN NOT NULL DEFAULT false,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para las queries más comunes
CREATE INDEX IF NOT EXISTS song_shares_receiver_idx ON public.song_shares (receiver_id, seen, created_at DESC);
CREATE INDEX IF NOT EXISTS song_shares_sender_idx   ON public.song_shares (sender_id, created_at DESC);

-- ── 2. Habilitar RLS ──
ALTER TABLE public.song_shares ENABLE ROW LEVEL SECURITY;

-- ── 3. Limpiar políticas previas (por si se re-ejecuta) ──
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname FROM pg_policies 
             WHERE tablename = 'song_shares' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.song_shares', r.policyname);
    END LOOP;
END $$;

-- ── 4. SELECT: solo puedes ver shares donde eres el remitente o el receptor ──
CREATE POLICY "song_shares: select own"
ON public.song_shares FOR SELECT
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- ── 5. INSERT: solo puedes crear shares donde tú eres el remitente ──
CREATE POLICY "song_shares: insert own"
ON public.song_shares FOR INSERT
WITH CHECK (auth.uid() = sender_id);

-- ── 6. UPDATE: solo el receptor puede marcar como visto (seen = true) ──
CREATE POLICY "song_shares: update seen"
ON public.song_shares FOR UPDATE
USING (auth.uid() = receiver_id)
WITH CHECK (auth.uid() = receiver_id);

-- ── 7. DELETE: tanto el remitente como el receptor pueden borrar ──
CREATE POLICY "song_shares: delete own"
ON public.song_shares FOR DELETE
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- ── Verificar que todo quedó correcto ──
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename = 'song_shares' AND schemaname = 'public'
ORDER BY cmd;
