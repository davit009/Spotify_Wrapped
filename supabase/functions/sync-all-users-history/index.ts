import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Reubicado desde spotify_background_job.ts (raíz del repo), que nunca llegó
// a desplegarse como función real porque no vivía en supabase/functions/ —
// Supabase solo despliega lo que está en esa carpeta. Sin esto corriendo
// periódicamente, el historial de un usuario que cierra la pestaña por un
// rato y escucha más de 50 canciones mientras tanto se pierde para siempre
// (la API de Spotify solo expone las últimas 50 — ver supabase/schedule_history_sync.sql).

const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID') || '';
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

serve(async (req: Request) => {
    // Esta función corre con el service role (puede tocar los datos de
    // cualquier usuario), así que no puede quedar abierta al público —
    // solo el cron job programado (que manda este mismo secreto) puede
    // dispararla. Configura CRON_SECRET como variable de entorno de la
    // función y usa el mismo valor en schedule_history_sync.sql.
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
        // 1. Iniciar conexión administrativa a Supabase
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 2. Obtener usuarios que tengan un refresh token guardado.
        // Vive en user_spotify_tokens (aislada por RLS de `users`, que
        // cualquier usuario autenticado puede leer para buscar amigos); si esa
        // tabla todavía no existe porque no se corrió la migración, caemos de
        // vuelta a la columna vieja en `users`.
        let users: { id: string; spotify_refresh_token: string }[] | null = null;
        const { data: tokenRows, error: tokenRowsError } = await supabaseAdmin
            .from('user_spotify_tokens')
            .select('id, spotify_refresh_token')
            .not('spotify_refresh_token', 'is', null);

        if (!tokenRowsError && tokenRows) {
            users = tokenRows;
        } else {
            const { data: legacyUsers, error: legacyError } = await supabaseAdmin
                .from('users')
                .select('id, spotify_refresh_token')
                .not('spotify_refresh_token', 'is', null);
            if (legacyError || !legacyUsers) {
                throw new Error('Error buscando usuarios: ' + (legacyError?.message ?? tokenRowsError?.message));
            }
            users = legacyUsers;
        }

        let tracksSavedCount = 0;
        let usersProcessed = 0;

        // 3. Procesar historial de cada usuario
        for (const user of users) {
            // A. Renovar el token de acceso usando el Refresh Token
            const authString = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
            const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: user.spotify_refresh_token,
                }),
            });

            const tokenData = await tokenResponse.json();
            if (!tokenResponse.ok) {
                console.error(`Fallo renovando token para usuario ${user.id}:`, tokenData);
                continue; // Saltar a siguiente usuario
            }

            const accessToken = tokenData.access_token;
            const expiresIn = tokenData.expires_in ?? 3600;

            // Guardar el nuevo token en la BD para que el frontend pueda usarlo
            const updatePayload: any = {
                spotify_access_token: accessToken,
                spotify_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
            };
            if (tokenData.refresh_token) {
                updatePayload.spotify_refresh_token = tokenData.refresh_token;
            }
            const { error: upsertErr } = await supabaseAdmin
                .from('user_spotify_tokens')
                .upsert({ id: user.id, ...updatePayload });
            if (upsertErr) {
                // Tabla nueva todavía no existe — no perdemos el refresh,
                // seguimos guardando en la columna vieja.
                await supabaseAdmin.from('users').update(updatePayload).eq('id', user.id);
            }

            // B. Pedir el historial de canciones a Spotify (últimas 50 — es el
            // máximo que la API permite, sin importar el rango de fechas que se pida)
            const historyResponse = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const historyData = await historyResponse.json();
            if (!historyResponse.ok || !historyData.items) continue;

            // C. Preparar datos para la base de datos
            const sessionsToInsert = historyData.items.map((item: any) => ({
                user_id: user.id,
                track_id: item.track.id,
                duration_ms: item.track.duration_ms,
                played_at: item.played_at, // La fecha exacta milimétrica en que la escuchó
                track_name: item.track.name || null,
                artist_name: item.track.artists?.map((a: any) => a.name).join(', ') || null,
                album_art_url: item.track.album?.images?.[0]?.url || null
            }));

            usersProcessed++;
            if (sessionsToInsert.length === 0) continue;

            // D. Insertar evitando duplicados (upsert basado en el played_at)
            // .select() hace que Postgres/PostgREST devuelva solo las filas que
            // realmente se insertaron (las duplicadas se descartan por ignoreDuplicates
            // y no vienen en la respuesta), así el contador refleja canciones nuevas reales.
            const { data: insertedRows, error: insertError } = await supabaseAdmin
                .from('listening_sessions')
                .upsert(sessionsToInsert, { onConflict: 'user_id, played_at', ignoreDuplicates: true })
                .select('user_id');

            if (insertError) {
                console.error(`Error guardando listening_sessions para usuario ${user.id}:`, insertError);
            } else {
                tracksSavedCount += insertedRows?.length ?? 0;
            }
        }

        return new Response(JSON.stringify({ success: true, usersProcessed, tracksSaved: tracksSavedCount }), {
            headers: { "Content-Type": "application/json" },
        });

    } catch (err: any) {
        console.error('Error inesperado:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
