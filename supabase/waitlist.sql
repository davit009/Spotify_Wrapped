-- =============================================
-- WAITLIST TABLE — Playcount
-- Ejecutar en Supabase SQL Editor
-- =============================================

-- Crear tabla de lista de espera
CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  spotify_email text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  CONSTRAINT waitlist_pkey PRIMARY KEY (id)
);

-- Activar RLS
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Permitir INSERT a cualquiera (incluso no autenticados, para que puedan registrarse)
DROP POLICY IF EXISTS "waitlist: insert anon" ON public.waitlist;
CREATE POLICY "waitlist: insert anon" ON public.waitlist
  FOR INSERT WITH CHECK (true);

-- Solo el admin (service role) puede ver la lista completa
-- Los usuarios normales no pueden leer la lista de otros
DROP POLICY IF EXISTS "waitlist: select none" ON public.waitlist;
CREATE POLICY "waitlist: select none" ON public.waitlist
  FOR SELECT USING (false);
