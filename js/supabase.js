const SUPABASE_URL = 'https://qiyhlhmhxgimbcvomqvu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpeWhsaG1oeGdpbWJjdm9tcXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTQ5MzUsImV4cCI6MjA5MjYzMDkzNX0.EUc09RpuBY7R_NYCoFl3zmmvxhhfDaWiwzaCJ36qZBw';

// Usar el objeto global si ya existe (para compatibilidad con scripts legacy) o crear uno nuevo
export const supabaseClient = (typeof supabase !== 'undefined') 
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null; // Esto fallaría si el CDN no carga, pero es para ES Modules.

// Para que funcione en navegadores modernos sin el CDN global si se prefiere (opcional)
if (!supabaseClient && typeof window !== 'undefined') {
    console.error("Supabase CDN no encontrado. Asegúrate de incluir <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js'></script>");
}
