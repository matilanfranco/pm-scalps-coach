import { getSupabaseClient } from "@/lib/supabaseClient";

export async function ensureAuth() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client no inicializado (env vars).");

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const user = data.session?.user;
  if (!user) throw new Error("NO SESSION");

  return user; // { id, email, ... }
}