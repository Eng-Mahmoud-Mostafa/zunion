import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

// Only construct the client when real values are configured. When no Supabase
// project is wired up, consumers (src/services/statsService.ts) skip remote
// reads and fall back to the backend/local data instead of hitting a fake URL.
export const supabase: SupabaseClient | null = hasSupabaseConfig ? createClient(supabaseUrl!, supabaseKey!) : null;