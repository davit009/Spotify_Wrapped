import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization' }, 401);

    // Verificar el usuario con el token de Supabase que llega del frontend
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userErr || !user) return json({ error: 'Usuario inválido' }, 401);

    // Obtener el refresh_token de la BD. Vive en user_spotify_tokens (aislada
    // por RLS de `users`, que cualquier usuario autenticado puede leer para
    // buscar amigos); si esa tabla todavía no existe porque no se ha corrido
    // la migración, caemos de vuelta a la columna vieja en `users`.
    let refreshToken: string | undefined;
    const { data: tokenRow } = await supabaseAdmin
      .from('user_spotify_tokens')
      .select('spotify_refresh_token')
      .eq('id', user.id)
      .maybeSingle();
    refreshToken = tokenRow?.spotify_refresh_token;

    if (!refreshToken) {
      const { data: legacyRow } = await supabaseAdmin
        .from('users')
        .select('spotify_refresh_token')
        .eq('id', user.id)
        .maybeSingle();
      refreshToken = legacyRow?.spotify_refresh_token;
    }

    if (!refreshToken) {
      return json({ error: 'No hay refresh_token guardado. El usuario debe volver a iniciar sesión.' }, 400);
    }

    // Llamar a Spotify para obtener un access_token nuevo
    const clientId     = Deno.env.get('SPOTIFY_CLIENT_ID')!;
    const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;
    const credentials  = btoa(`${clientId}:${clientSecret}`);

    const spotifyRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!spotifyRes.ok) {
      const errBody = await spotifyRes.text();
      console.error('Spotify rechazó el refresh:', errBody);
      return json({ error: 'Spotify rechazó el refresh. Necesita nuevo login.', detail: errBody }, 502);
    }

    const spotifyData = await spotifyRes.json();
    const newAccessToken   = spotifyData.access_token;
    const newRefreshToken  = spotifyData.refresh_token; // Spotify a veces rota el refresh_token
    const expiresIn        = spotifyData.expires_in ?? 3600;

    // Guardar en BD (y el nuevo refresh_token si Spotify lo rotó) junto con
    // la fecha de expiración, para que el frontend sepa cuándo volver a refrescar.
    const updatePayload: Record<string, string> = {
      spotify_access_token: newAccessToken,
      spotify_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
    if (newRefreshToken) updatePayload.spotify_refresh_token = newRefreshToken;

    const { error: upsertErr } = await supabaseAdmin
      .from('user_spotify_tokens')
      .upsert({ id: user.id, ...updatePayload });

    if (upsertErr) {
      // La tabla nueva todavía no existe (migración no corrida) — no
      // perdemos el refresh, seguimos guardando en la columna vieja.
      await supabaseAdmin.from('users').update(updatePayload).eq('id', user.id);
    }

    return json({ access_token: newAccessToken, expires_in: expiresIn });
  } catch (e) {
    console.error('Error inesperado:', e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
