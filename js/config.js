// Configuración global (Reemplaza con tus llaves del Dashboard de Supabase)
const SUPABASE_URL = 'https://qiyhlhmhxgimbcvomqvu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpeWhsaG1oeGdpbWJjdm9tcXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTQ5MzUsImV4cCI6MjA5MjYzMDkzNX0.EUc09RpuBY7R_NYCoFl3zmmvxhhfDaWiwzaCJ36qZBw';

// Inicializar cliente Supabase.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
